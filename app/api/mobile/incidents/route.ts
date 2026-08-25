import { NextRequest, NextResponse } from "next/server";
import { asText, parseError, requireApiContext } from "@/lib/employee-relations-api";
import { incidentPriority, incidentUrgencyReason, reportIncident } from "@/lib/mobile/incidents";

async function readJson(request: NextRequest): Promise<Record<string, unknown>> {
  try {
    const parsed = await request.json();
    return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}
function fail(message: string, status: number): NextResponse {
  return NextResponse.json({ ok: false, error: message }, { status });
}
function num(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Resolves the signed-in user to their employee record.
 *
 * The employee is NEVER taken from the request body. An employee id in a
 * payload is a claim; this is the fact.
 */
async function resolveEmployeeId(
  supabase: Parameters<typeof reportIncident>[0],
  companyId: string,
  email: string
): Promise<string | null> {
  const { data } = await supabase
    .from("employees")
    .select("id")
    .eq("company_id", companyId)
    .ilike("email", email)
    .eq("active", true)
    .maybeSingle();
  return data ? String((data as { id: string }).id) : null;
}

/**
 * Files an employee incident.
 *
 * Idempotent by construction: the client's operationId becomes the incident's
 * primary key, so a queued report retried after a lost response cannot create a
 * second incident. See lib/mobile/incidents.ts.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await readJson(request);
    const context = await requireApiContext(request, body.companyId);
    if (!context.ok) return fail(context.message, context.status);

    const { companyId, auth } = context.ctx;
    const employeeId = await resolveEmployeeId(auth.supabase, companyId, auth.email);
    if (!employeeId) {
      return fail(
        "Your sign-in is not linked to an active employee record in this workspace, so an incident cannot be attributed to you.",
        403
      );
    }

    const result = await reportIncident(auth.supabase, {
      // The outbox sends its operation id under this name.
      incidentId: asText(body.operationId) || asText(body.incidentId),
      companyId,
      employeeId,
      title: asText(body.title),
      description: asText(body.description),
      category: asText(body.category) || null,
      severity: asText(body.severity) || null,
      latitude: num(body.latitude),
      longitude: num(body.longitude),
      gpsAccuracy: num(body.accuracy),
      occurredAt: asText(body.occurredAt) || null,
      peopleInvolved: asText(body.peopleInvolved) || null,
      immediateDanger: body.immediateDanger === true,
      emergencyRequired: body.emergencyRequired === true,
      metadata:
        typeof body.metadata === "object" && body.metadata !== null && !Array.isArray(body.metadata)
          ? (body.metadata as Record<string, unknown>)
          : {},
    });

    if (!result.ok) return fail(result.error, result.status);

    const response = NextResponse.json({
      ok: true,
      incidentId: result.incidentId,
      // Lets the app's queue tell "this filed now" from "this had already filed",
      // exactly as x-rr-operation does for Road & Recovery.
      replayed: !result.created,
    });
    response.headers.set("x-rr-operation", result.created ? "executed" : "replayed");
    return response;
  } catch (error: unknown) {
    return fail(parseError(error), 500);
  }
}

/**
 * The employee's own incidents, newest first.
 *
 * Scoped to the signed-in employee. RLS on mobile_workforce_incidents is
 * tenant-wide because supervisors legitimately read the whole company's list,
 * so the narrowing to "mine" is done here — the same pattern the Road & Recovery
 * notification feed uses.
 */
export async function GET(request: NextRequest) {
  try {
    const companyId = request.nextUrl.searchParams.get("companyId");
    const context = await requireApiContext(request, companyId);
    if (!context.ok) return fail(context.message, context.status);

    const { auth } = context.ctx;
    const employeeId = await resolveEmployeeId(auth.supabase, context.ctx.companyId, auth.email);
    if (!employeeId) return NextResponse.json({ ok: true, incidents: [] });

    const { data, error } = await auth.supabase
      .from("mobile_workforce_incidents")
      .select(
        "id,title,description,category,severity,status,latitude,longitude,gps_accuracy,occurred_at,people_involved,immediate_danger,emergency_required,created_at,updated_at"
      )
      .eq("company_id", context.ctx.companyId)
      .eq("employee_id", employeeId)
      .order("created_at", { ascending: false })
      .limit(100);

    if (error) return fail("Could not load your incidents.", 500);

    const incidents = (data || []).map((row) => {
      const typed = row as Record<string, unknown>;
      const flags = {
        immediateDanger: typed.immediate_danger === true,
        emergencyRequired: typed.emergency_required === true,
        severity: (typed.severity as string) ?? null,
      };
      return {
        ...typed,
        priority: incidentPriority(flags),
        urgencyReason: incidentUrgencyReason(flags),
      };
    });

    return NextResponse.json({ ok: true, incidents });
  } catch (error: unknown) {
    return fail(parseError(error), 500);
  }
}

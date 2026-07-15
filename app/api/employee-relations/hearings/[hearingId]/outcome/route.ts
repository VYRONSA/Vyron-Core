import { NextRequest, NextResponse } from "next/server";
import { appendTimelineEvent, asText, parseError, requireApiContext, safeAudit } from "@/lib/employee-relations-api";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ hearingId: string }> }
) {
  try {
    const body = await request.json();
    const context = await requireApiContext(request, body.companyId);
    if (!context.ok) return NextResponse.json({ error: context.message }, { status: context.status });

    const hearingId = asText((await params).hearingId);
    const outcome = asText(body.outcome);
    if (!hearingId || !outcome) {
      return NextResponse.json({ error: "hearingId and outcome are required." }, { status: 400 });
    }

    const { data, error } = await context.ctx.auth.supabase
      .from("hearing_cases")
      .update({
        outcome_summary: outcome,
        outcome_code: asText(body.outcomeCode) || null,
        outcome_payload: body.outcomePayload || {},
        appeal_status: asText(body.appealStatus) || "not_started",
      })
      .eq("id", hearingId)
      .eq("company_id", context.ctx.companyId)
      .select("id,employee_id")
      .maybeSingle();

    if (error) return NextResponse.json({ error: "Could not record hearing outcome." }, { status: 500 });
    if (!data) return NextResponse.json({ error: "Hearing not found." }, { status: 404 });

    await appendTimelineEvent(context.ctx.auth.supabase, {
      companyId: context.ctx.companyId,
      employeeId: data.employee_id,
      eventType: "hearing_outcome_recorded",
      sourceTable: "hearing_cases",
      sourceId: hearingId,
      title: "Hearing outcome recorded",
      summary: outcome,
      metadata: {
        appealStatus: asText(body.appealStatus) || "not_started",
      },
      createdBy: context.ctx.auth.email,
    });

    await safeAudit(context.ctx.auth.supabase, {
      companyId: context.ctx.companyId,
      email: context.ctx.auth.email,
      action: "update",
      entityType: "hearing_case_outcome",
      entityId: hearingId,
      metadata: {
        outcomeCode: asText(body.outcomeCode) || null,
      },
    });

    return NextResponse.json({ ok: true });
  } catch (error: unknown) {
    return NextResponse.json({ error: parseError(error) }, { status: 500 });
  }
}

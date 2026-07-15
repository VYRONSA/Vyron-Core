import { NextRequest, NextResponse } from "next/server";
import {
  appendTimelineEvent,
  asMaybeText,
  asText,
  assertEmployeeBelongsToCompany,
  parseError,
  requireApiContext,
  safeAudit,
} from "@/lib/employee-relations-api";

export async function GET(request: NextRequest) {
  try {
    const companyId = request.nextUrl.searchParams.get("companyId");
    const context = await requireApiContext(request, companyId);
    if (!context.ok) {
      return NextResponse.json({ error: context.message }, { status: context.status });
    }

    const employeeId = asText(request.nextUrl.searchParams.get("employeeId") || "");
    const status = asText(request.nextUrl.searchParams.get("status") || "");
    const limit = Math.min(Number(request.nextUrl.searchParams.get("limit") || 50) || 50, 200);

    let query = context.ctx.auth.supabase
      .from("hearing_cases")
      .select("id,company_id,employee_id,hearing_type,hearing_status,scheduled_at,venue,chairperson_user_id,initiator_email,appeal_status,outcome_summary,created_at")
      .eq("company_id", context.ctx.companyId)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (employeeId) query = query.eq("employee_id", employeeId);
    if (status) query = query.eq("hearing_status", status);

    const { data, error } = await query;
    if (error) {
      return NextResponse.json({ error: "Could not load hearings." }, { status: 500 });
    }

    return NextResponse.json({ ok: true, hearings: data || [] });
  } catch (error: unknown) {
    return NextResponse.json({ error: parseError(error) }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const context = await requireApiContext(request, body.companyId);
    if (!context.ok) {
      return NextResponse.json({ error: context.message }, { status: context.status });
    }

    const employeeId = asText(body.employeeId);
    if (!employeeId) {
      return NextResponse.json({ error: "employeeId is required." }, { status: 400 });
    }

    const employeeCheck = await assertEmployeeBelongsToCompany(
      context.ctx.auth.supabase,
      context.ctx.companyId,
      employeeId
    );
    if (!employeeCheck.ok) {
      return NextResponse.json({ error: employeeCheck.message }, { status: employeeCheck.status });
    }

    const payload = {
      company_id: context.ctx.companyId,
      employee_id: employeeId,
      hr_case_id: asMaybeText(body.caseId),
      hearing_type: asText(body.hearingType) || "disciplinary",
      hearing_status: "draft",
      scheduled_at: asMaybeText(body.scheduledAt),
      venue: asMaybeText(body.venue),
      chairperson_user_id: asMaybeText(body.chairpersonUserId),
      initiator_email: asText(body.initiatorEmail) || context.ctx.auth.email,
      appeal_status: asText(body.appealStatus) || "not_started",
      outcome_summary: null,
    };

    const { data, error } = await context.ctx.auth.supabase
      .from("hearing_cases")
      .insert(payload)
      .select("id,employee_id,hearing_status,scheduled_at")
      .single();

    if (error || !data) {
      return NextResponse.json({ error: "Could not create hearing." }, { status: 500 });
    }

    await appendTimelineEvent(context.ctx.auth.supabase, {
      companyId: context.ctx.companyId,
      employeeId,
      eventType: "hearing_created",
      sourceTable: "hearing_cases",
      sourceId: data.id,
      title: "Hearing created",
      summary: payload.hearing_type,
      metadata: {
        status: payload.hearing_status,
        scheduledAt: payload.scheduled_at,
      },
      createdBy: context.ctx.auth.email,
    });

    await safeAudit(context.ctx.auth.supabase, {
      companyId: context.ctx.companyId,
      email: context.ctx.auth.email,
      action: "create",
      entityType: "hearing_case",
      entityId: data.id,
      metadata: { employeeId, hearingType: payload.hearing_type },
    });

    return NextResponse.json({ ok: true, hearing: data }, { status: 201 });
  } catch (error: unknown) {
    return NextResponse.json({ error: parseError(error) }, { status: 500 });
  }
}

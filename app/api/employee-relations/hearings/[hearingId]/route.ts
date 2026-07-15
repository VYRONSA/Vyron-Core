import { NextRequest, NextResponse } from "next/server";
import {
  appendTimelineEvent,
  asMaybeText,
  asText,
  parseError,
  requireApiContext,
  safeAudit,
} from "@/lib/employee-relations-api";

async function loadHearing(supabase: any, hearingId: string, companyId: string) {
  const { data, error } = await supabase
    .from("hearing_cases")
    .select("id,company_id,employee_id,hearing_status,hearing_type")
    .eq("id", hearingId)
    .eq("company_id", companyId)
    .maybeSingle();

  if (error) return { ok: false as const, status: 500, message: "Could not load hearing." };
  if (!data) return { ok: false as const, status: 404, message: "Hearing not found." };
  return { ok: true as const, data };
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ hearingId: string }> }
) {
  try {
    const companyId = request.nextUrl.searchParams.get("companyId");
    const context = await requireApiContext(request, companyId);
    if (!context.ok) return NextResponse.json({ error: context.message }, { status: context.status });

    const hearingId = asText((await params).hearingId);
    if (!hearingId) return NextResponse.json({ error: "hearingId is required." }, { status: 400 });

    const found = await loadHearing(context.ctx.auth.supabase, hearingId, context.ctx.companyId);
    if (!found.ok) return NextResponse.json({ error: found.message }, { status: found.status });

    const { data, error } = await context.ctx.auth.supabase
      .from("hearing_cases")
      .select("id,company_id,hr_case_id,employee_id,hearing_type,hearing_status,scheduled_at,venue,chairperson_user_id,initiator_email,appeal_status,outcome_summary,outcome_code,outcome_payload,cancelled_at,cancelled_reason,completed_at,created_at,updated_at")
      .eq("id", hearingId)
      .eq("company_id", context.ctx.companyId)
      .single();

    if (error) return NextResponse.json({ error: "Could not load hearing details." }, { status: 500 });

    return NextResponse.json({ ok: true, hearing: data });
  } catch (error: unknown) {
    return NextResponse.json({ error: parseError(error) }, { status: 500 });
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ hearingId: string }> }
) {
  try {
    const body = await request.json();
    const context = await requireApiContext(request, body.companyId);
    if (!context.ok) return NextResponse.json({ error: context.message }, { status: context.status });

    const hearingId = asText((await params).hearingId);
    if (!hearingId) return NextResponse.json({ error: "hearingId is required." }, { status: 400 });

    const found = await loadHearing(context.ctx.auth.supabase, hearingId, context.ctx.companyId);
    if (!found.ok) return NextResponse.json({ error: found.message }, { status: found.status });

    const updates: Record<string, unknown> = {};
    if (body.venue !== undefined) updates.venue = asMaybeText(body.venue);
    if (body.scheduledAt !== undefined) updates.scheduled_at = asMaybeText(body.scheduledAt);
    if (body.chairpersonUserId !== undefined) updates.chairperson_user_id = asMaybeText(body.chairpersonUserId);
    if (body.initiatorEmail !== undefined) updates.initiator_email = asMaybeText(body.initiatorEmail);
    if (body.appealStatus !== undefined) updates.appeal_status = asMaybeText(body.appealStatus);
    if (body.hearingType !== undefined) updates.hearing_type = asMaybeText(body.hearingType);

    const { data, error } = await context.ctx.auth.supabase
      .from("hearing_cases")
      .update(updates)
      .eq("id", hearingId)
      .eq("company_id", context.ctx.companyId)
      .select("id,employee_id,hearing_status,scheduled_at")
      .single();

    if (error) return NextResponse.json({ error: "Could not update hearing." }, { status: 500 });

    await appendTimelineEvent(context.ctx.auth.supabase, {
      companyId: context.ctx.companyId,
      employeeId: found.data.employee_id,
      eventType: "hearing_updated",
      sourceTable: "hearing_cases",
      sourceId: hearingId,
      title: "Hearing updated",
      metadata: { fields: Object.keys(updates) },
      createdBy: context.ctx.auth.email,
    });

    await safeAudit(context.ctx.auth.supabase, {
      companyId: context.ctx.companyId,
      email: context.ctx.auth.email,
      action: "update",
      entityType: "hearing_case",
      entityId: hearingId,
      metadata: { fields: Object.keys(updates) },
    });

    return NextResponse.json({ ok: true, hearing: data });
  } catch (error: unknown) {
    return NextResponse.json({ error: parseError(error) }, { status: 500 });
  }
}

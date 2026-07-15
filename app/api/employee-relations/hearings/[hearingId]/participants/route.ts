import { NextRequest, NextResponse } from "next/server";
import { appendTimelineEvent, asMaybeText, asText, parseError, requireApiContext, safeAudit } from "@/lib/employee-relations-api";

async function findHearing(supabase: any, hearingId: string, companyId: string) {
  return supabase
    .from("hearing_cases")
    .select("id,employee_id")
    .eq("id", hearingId)
    .eq("company_id", companyId)
    .maybeSingle();
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ hearingId: string }> }
) {
  try {
    const body = await request.json();
    const context = await requireApiContext(request, body.companyId);
    if (!context.ok) return NextResponse.json({ error: context.message }, { status: context.status });

    const hearingId = asText((await params).hearingId);
    const participantType = asText(body.participantType);
    if (!hearingId || !participantType) {
      return NextResponse.json({ error: "hearingId and participantType are required." }, { status: 400 });
    }

    const hearing = await findHearing(context.ctx.auth.supabase, hearingId, context.ctx.companyId);
    if (hearing.error) return NextResponse.json({ error: "Could not load hearing." }, { status: 500 });
    if (!hearing.data) return NextResponse.json({ error: "Hearing not found." }, { status: 404 });

    const { data, error } = await context.ctx.auth.supabase
      .from("hearing_participants")
      .insert({
        company_id: context.ctx.companyId,
        hearing_case_id: hearingId,
        participant_type: participantType,
        employee_id: asMaybeText(body.employeeId),
        external_name: asMaybeText(body.externalName),
        representative_role: asMaybeText(body.representativeRole),
        contact: asMaybeText(body.contact),
        attendance_status: asText(body.attendanceStatus) || "invited",
        notes: asMaybeText(body.notes),
      })
      .select("id,participant_type,employee_id,external_name")
      .single();

    if (error || !data) return NextResponse.json({ error: "Could not add participant." }, { status: 500 });

    await appendTimelineEvent(context.ctx.auth.supabase, {
      companyId: context.ctx.companyId,
      employeeId: hearing.data.employee_id,
      eventType: "hearing_participant_added",
      sourceTable: "hearing_participants",
      sourceId: data.id,
      title: "Hearing participant added",
      summary: `${data.participant_type}: ${data.external_name || data.employee_id || "participant"}`,
      createdBy: context.ctx.auth.email,
    });

    await safeAudit(context.ctx.auth.supabase, {
      companyId: context.ctx.companyId,
      email: context.ctx.auth.email,
      action: "create",
      entityType: "hearing_participant",
      entityId: data.id,
      metadata: {
        hearingId,
        participantType: data.participant_type,
      },
    });

    return NextResponse.json({ ok: true, participant: data }, { status: 201 });
  } catch (error: unknown) {
    return NextResponse.json({ error: parseError(error) }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ hearingId: string }> }
) {
  try {
    const body = await request.json();
    const context = await requireApiContext(request, body.companyId);
    if (!context.ok) return NextResponse.json({ error: context.message }, { status: context.status });

    const hearingId = asText((await params).hearingId);
    const participantId = asText(body.participantId);
    if (!hearingId || !participantId) {
      return NextResponse.json({ error: "hearingId and participantId are required." }, { status: 400 });
    }

    const hearing = await findHearing(context.ctx.auth.supabase, hearingId, context.ctx.companyId);
    if (hearing.error) return NextResponse.json({ error: "Could not load hearing." }, { status: 500 });
    if (!hearing.data) return NextResponse.json({ error: "Hearing not found." }, { status: 404 });

    const { data, error } = await context.ctx.auth.supabase
      .from("hearing_participants")
      .update({
        removed_at: new Date().toISOString(),
        removed_by: context.ctx.auth.email,
      })
      .eq("id", participantId)
      .eq("hearing_case_id", hearingId)
      .eq("company_id", context.ctx.companyId)
      .is("removed_at", null)
      .select("id,participant_type")
      .maybeSingle();

    if (error) return NextResponse.json({ error: "Could not remove participant." }, { status: 500 });
    if (!data) return NextResponse.json({ error: "Participant not found." }, { status: 404 });

    await appendTimelineEvent(context.ctx.auth.supabase, {
      companyId: context.ctx.companyId,
      employeeId: hearing.data.employee_id,
      eventType: "hearing_participant_removed",
      sourceTable: "hearing_participants",
      sourceId: participantId,
      title: "Hearing participant removed",
      summary: data.participant_type,
      createdBy: context.ctx.auth.email,
    });

    await safeAudit(context.ctx.auth.supabase, {
      companyId: context.ctx.companyId,
      email: context.ctx.auth.email,
      action: "archive",
      entityType: "hearing_participant",
      entityId: participantId,
      metadata: { hearingId },
    });

    return NextResponse.json({ ok: true });
  } catch (error: unknown) {
    return NextResponse.json({ error: parseError(error) }, { status: 500 });
  }
}

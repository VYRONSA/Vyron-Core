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
    const scheduledAt = asText(body.scheduledAt);
    if (!hearingId || !scheduledAt) {
      return NextResponse.json({ error: "hearingId and scheduledAt are required." }, { status: 400 });
    }

    const { data, error } = await context.ctx.auth.supabase
      .from("hearing_cases")
      .update({ hearing_status: "scheduled", scheduled_at: scheduledAt, venue: asText(body.venue) || null })
      .eq("id", hearingId)
      .eq("company_id", context.ctx.companyId)
      .select("id,employee_id,scheduled_at")
      .maybeSingle();

    if (error) return NextResponse.json({ error: "Could not schedule hearing." }, { status: 500 });
    if (!data) return NextResponse.json({ error: "Hearing not found." }, { status: 404 });

    await appendTimelineEvent(context.ctx.auth.supabase, {
      companyId: context.ctx.companyId,
      employeeId: data.employee_id,
      eventType: "hearing_scheduled",
      sourceTable: "hearing_cases",
      sourceId: hearingId,
      title: "Hearing scheduled",
      summary: `Scheduled for ${data.scheduled_at}`,
      createdBy: context.ctx.auth.email,
      eventDate: data.scheduled_at,
    });

    await safeAudit(context.ctx.auth.supabase, {
      companyId: context.ctx.companyId,
      email: context.ctx.auth.email,
      action: "update",
      entityType: "hearing_case",
      entityId: hearingId,
      metadata: { status: "scheduled", scheduledAt: data.scheduled_at },
    });

    return NextResponse.json({ ok: true, hearing: data });
  } catch (error: unknown) {
    return NextResponse.json({ error: parseError(error) }, { status: 500 });
  }
}

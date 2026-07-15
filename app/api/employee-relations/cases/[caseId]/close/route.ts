import { NextRequest, NextResponse } from "next/server";
import {
  appendTimelineEvent,
  asText,
  parseError,
  requireApiContext,
  safeAudit,
} from "@/lib/employee-relations-api";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ caseId: string }> }
) {
  try {
    const body = await request.json();
    const context = await requireApiContext(request, body.companyId);
    if (!context.ok) {
      return NextResponse.json({ error: context.message }, { status: context.status });
    }

    const resolved = await params;
    const caseId = asText(resolved.caseId);
    if (!caseId) {
      return NextResponse.json({ error: "caseId is required." }, { status: 400 });
    }

    const reason = asText(body.reason) || "Case closed";

    const { data, error } = await context.ctx.auth.supabase
      .from("hr_cases")
      .update({
        status: "closed",
        closure_reason: reason,
        due_at: null,
      })
      .eq("id", caseId)
      .eq("company_id", context.ctx.companyId)
      .select("id,employee_id,title,status")
      .maybeSingle();

    if (error) {
      return NextResponse.json({ error: "Could not close case." }, { status: 500 });
    }

    if (!data) {
      return NextResponse.json({ error: "Case not found." }, { status: 404 });
    }

    await appendTimelineEvent(context.ctx.auth.supabase, {
      companyId: context.ctx.companyId,
      employeeId: data.employee_id,
      eventType: "case_closed",
      sourceTable: "hr_cases",
      sourceId: data.id,
      title: "Employee relations case closed",
      summary: reason,
      createdBy: context.ctx.auth.email,
    });

    await safeAudit(context.ctx.auth.supabase, {
      companyId: context.ctx.companyId,
      email: context.ctx.auth.email,
      action: "update",
      entityType: "employee_relations_case",
      entityId: caseId,
      metadata: { status: "closed", reason },
    });

    return NextResponse.json({ ok: true, case: data });
  } catch (error: unknown) {
    return NextResponse.json({ error: parseError(error) }, { status: 500 });
  }
}

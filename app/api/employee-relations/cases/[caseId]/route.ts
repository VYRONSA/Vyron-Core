import { NextRequest, NextResponse } from "next/server";
import {
  appendTimelineEvent,
  asArrayOfStrings,
  asMaybeText,
  asText,
  parseError,
  requireApiContext,
  safeAudit,
} from "@/lib/employee-relations-api";

async function loadCaseForCompany(
  supabase: any,
  caseId: string,
  companyId: string
): Promise<{ ok: true; row: any } | { ok: false; status: number; message: string }> {
  const { data, error } = await supabase
    .from("hr_cases")
    .select("id,company_id,employee_id,title,category,status")
    .eq("id", caseId)
    .eq("company_id", companyId)
    .maybeSingle();

  if (error) return { ok: false, status: 500, message: "Could not load case." };
  if (!data) return { ok: false, status: 404, message: "Case not found." };
  return { ok: true, row: data };
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ caseId: string }> }
) {
  try {
    const companyId = request.nextUrl.searchParams.get("companyId");
    const context = await requireApiContext(request, companyId);
    if (!context.ok) {
      return NextResponse.json({ error: context.message }, { status: context.status });
    }

    const resolved = await params;
    const caseId = asText(resolved.caseId);
    if (!caseId) {
      return NextResponse.json({ error: "caseId is required." }, { status: 400 });
    }

    const found = await loadCaseForCompany(context.ctx.auth.supabase, caseId, context.ctx.companyId);
    if (!found.ok) {
      return NextResponse.json({ error: found.message }, { status: found.status });
    }

    const { data, error } = await context.ctx.auth.supabase
      .from("hr_cases")
      .select("id,company_id,employee_id,category,incident_date,title,description,manager_email,status,priority_score,owner_user_id,due_at,note_items,attachment_items,created_at")
      .eq("id", caseId)
      .eq("company_id", context.ctx.companyId)
      .single();

    if (error) {
      return NextResponse.json({ error: "Could not load case details." }, { status: 500 });
    }

    return NextResponse.json({ ok: true, case: data });
  } catch (error: unknown) {
    return NextResponse.json({ error: parseError(error) }, { status: 500 });
  }
}

export async function PATCH(
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

    const found = await loadCaseForCompany(context.ctx.auth.supabase, caseId, context.ctx.companyId);
    if (!found.ok) {
      return NextResponse.json({ error: found.message }, { status: found.status });
    }

    const updates: Record<string, unknown> = {};
    if (body.category !== undefined) updates.category = asMaybeText(body.category);
    if (body.incidentDate !== undefined) updates.incident_date = asMaybeText(body.incidentDate);
    if (body.description !== undefined) updates.description = asText(body.description);
    if (body.managerEmail !== undefined) updates.manager_email = asMaybeText(body.managerEmail);
    if (body.status !== undefined) updates.status = asMaybeText(body.status);
    if (body.priority !== undefined) updates.priority_score = Number(body.priority);
    if (body.ownerUserId !== undefined) updates.owner_user_id = asMaybeText(body.ownerUserId);
    if (body.dueDate !== undefined) updates.due_at = asMaybeText(body.dueDate);
    if (body.notes !== undefined) updates.note_items = asArrayOfStrings(body.notes);
    if (body.attachments !== undefined) updates.attachment_items = asArrayOfStrings(body.attachments);
    if (body.title !== undefined) updates.title = asMaybeText(body.title);

    const { data, error } = await context.ctx.auth.supabase
      .from("hr_cases")
      .update(updates)
      .eq("id", caseId)
      .eq("company_id", context.ctx.companyId)
      .select("id,company_id,employee_id,status,priority_score,due_at")
      .single();

    if (error) {
      return NextResponse.json({ error: "Could not update case." }, { status: 500 });
    }

    await appendTimelineEvent(context.ctx.auth.supabase, {
      companyId: context.ctx.companyId,
      employeeId: found.row.employee_id,
      eventType: "case_updated",
      sourceTable: "hr_cases",
      sourceId: caseId,
      title: "Employee relations case updated",
      summary: found.row.title,
      metadata: {
        updates: Object.keys(updates),
      },
      createdBy: context.ctx.auth.email,
    });

    await safeAudit(context.ctx.auth.supabase, {
      companyId: context.ctx.companyId,
      email: context.ctx.auth.email,
      action: "update",
      entityType: "employee_relations_case",
      entityId: caseId,
      metadata: {
        fields: Object.keys(updates),
      },
    });

    return NextResponse.json({ ok: true, case: data });
  } catch (error: unknown) {
    return NextResponse.json({ error: parseError(error) }, { status: 500 });
  }
}

import { NextRequest, NextResponse } from "next/server";
import {
  appendTimelineEvent,
  asArrayOfStrings,
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

    const status = asText(request.nextUrl.searchParams.get("status") || "");
    const priorityMin = Number(request.nextUrl.searchParams.get("priorityMin") || "");
    const employeeId = asText(request.nextUrl.searchParams.get("employeeId") || "");
    const limit = Math.min(Number(request.nextUrl.searchParams.get("limit") || 50) || 50, 200);

    let query = context.ctx.auth.supabase
      .from("hr_cases")
      .select("id,company_id,employee_id,category,incident_date,title,description,manager_email,status,priority_score,owner_user_id,due_at,note_items,attachment_items,created_at")
      .eq("company_id", context.ctx.companyId)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (status) query = query.eq("status", status);
    if (employeeId) query = query.eq("employee_id", employeeId);
    if (!Number.isNaN(priorityMin)) query = query.gte("priority_score", priorityMin);

    const { data, error } = await query;
    if (error) {
      return NextResponse.json({ error: "Could not load employee relation cases." }, { status: 500 });
    }

    return NextResponse.json({ ok: true, cases: data || [] });
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
    const category = asText(body.category);
    const description = asText(body.description);

    if (!employeeId) {
      return NextResponse.json({ error: "employeeId is required." }, { status: 400 });
    }

    if (!category) {
      return NextResponse.json({ error: "category is required." }, { status: 400 });
    }

    if (!description) {
      return NextResponse.json({ error: "description is required." }, { status: 400 });
    }

    const employeeCheck = await assertEmployeeBelongsToCompany(
      context.ctx.auth.supabase,
      context.ctx.companyId,
      employeeId
    );
    if (!employeeCheck.ok) {
      return NextResponse.json({ error: employeeCheck.message }, { status: employeeCheck.status });
    }

    const notes = asArrayOfStrings(body.notes);
    const attachments = asArrayOfStrings(body.attachments);

    const insertPayload = {
      company_id: context.ctx.companyId,
      employee_id: employeeId,
      case_type: asText(body.caseType) || "disciplinary",
      category,
      incident_date: asMaybeText(body.incidentDate),
      title: asText(body.title) || `Employee relations: ${category}`,
      description,
      manager_email: asText(body.managerEmail) || context.ctx.auth.email,
      status: asText(body.status) || "open",
      priority_score: Number(body.priority ?? 50),
      owner_user_id: asMaybeText(body.ownerUserId),
      due_at: asMaybeText(body.dueDate),
      note_items: notes,
      attachment_items: attachments,
      validity_status: "review_required",
      employee_response_required: Boolean(body.employeeResponseRequired ?? false),
    };

    const { data, error } = await context.ctx.auth.supabase
      .from("hr_cases")
      .insert(insertPayload)
      .select("id,company_id,employee_id,status,priority_score,due_at,created_at")
      .single();

    if (error || !data) {
      return NextResponse.json({ error: "Could not create employee relations case." }, { status: 500 });
    }

    await appendTimelineEvent(context.ctx.auth.supabase, {
      companyId: context.ctx.companyId,
      employeeId,
      eventType: "case_created",
      sourceTable: "hr_cases",
      sourceId: data.id,
      title: "Employee relations case created",
      summary: insertPayload.title,
      metadata: {
        category,
        priority: insertPayload.priority_score,
        status: insertPayload.status,
      },
      createdBy: context.ctx.auth.email,
    });

    await safeAudit(context.ctx.auth.supabase, {
      companyId: context.ctx.companyId,
      email: context.ctx.auth.email,
      action: "create",
      entityType: "employee_relations_case",
      entityId: data.id,
      metadata: {
        employeeId,
        category,
      },
    });

    return NextResponse.json({ ok: true, case: data }, { status: 201 });
  } catch (error: unknown) {
    return NextResponse.json({ error: parseError(error) }, { status: 500 });
  }
}

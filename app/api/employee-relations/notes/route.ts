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
    if (!context.ok) return NextResponse.json({ error: context.message }, { status: context.status });

    const employeeId = asText(request.nextUrl.searchParams.get("employeeId") || "");
    const category = asText(request.nextUrl.searchParams.get("category") || "");
    const includeDeleted = asText(request.nextUrl.searchParams.get("includeDeleted") || "") === "true";
    const limit = Math.min(Number(request.nextUrl.searchParams.get("limit") || 100) || 100, 200);

    let query = context.ctx.auth.supabase
      .from("employee_notes")
      .select("id,company_id,employee_id,note_body,note_category,follow_up_date,attachment_items,ai_summary,mention_links,created_by,created_at,note_status,deleted_at")
      .eq("company_id", context.ctx.companyId)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (!includeDeleted) query = query.is("deleted_at", null);
    if (employeeId) query = query.eq("employee_id", employeeId);
    if (category) query = query.eq("note_category", category);

    const { data, error } = await query;
    if (error) return NextResponse.json({ error: "Could not load notes." }, { status: 500 });

    return NextResponse.json({ ok: true, notes: data || [] });
  } catch (error: unknown) {
    return NextResponse.json({ error: parseError(error) }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const context = await requireApiContext(request, body.companyId);
    if (!context.ok) return NextResponse.json({ error: context.message }, { status: context.status });

    const employeeId = asText(body.employeeId);
    const noteBody = asText(body.noteBody);

    if (!employeeId || !noteBody) {
      return NextResponse.json({ error: "employeeId and noteBody are required." }, { status: 400 });
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
      note_body: noteBody,
      note_category: asText(body.category) || "general",
      follow_up_date: asMaybeText(body.followUpDate),
      attachment_items: Array.isArray(body.attachments) ? body.attachments : [],
      mention_links: Array.isArray(body.mentionLinks) ? body.mentionLinks : [],
      ai_summary: asMaybeText(body.aiSummary),
      created_by: context.ctx.auth.email,
      note_status: "active",
      audit_metadata: {
        created_by_email: context.ctx.auth.email,
      },
    };

    const { data, error } = await context.ctx.auth.supabase
      .from("employee_notes")
      .insert(payload)
      .select("id,employee_id,note_category,created_at")
      .single();

    if (error || !data) return NextResponse.json({ error: "Could not create note." }, { status: 500 });

    await appendTimelineEvent(context.ctx.auth.supabase, {
      companyId: context.ctx.companyId,
      employeeId,
      eventType: "employee_note_created",
      sourceTable: "employee_notes",
      sourceId: data.id,
      title: "Employee note created",
      summary: noteBody.slice(0, 120),
      metadata: {
        category: payload.note_category,
      },
      createdBy: context.ctx.auth.email,
    });

    await safeAudit(context.ctx.auth.supabase, {
      companyId: context.ctx.companyId,
      email: context.ctx.auth.email,
      action: "create",
      entityType: "employee_note",
      entityId: data.id,
      metadata: {
        employeeId,
        category: payload.note_category,
      },
    });

    return NextResponse.json({ ok: true, note: data }, { status: 201 });
  } catch (error: unknown) {
    return NextResponse.json({ error: parseError(error) }, { status: 500 });
  }
}

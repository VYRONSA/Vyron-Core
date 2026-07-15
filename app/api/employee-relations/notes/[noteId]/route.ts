import { NextRequest, NextResponse } from "next/server";
import { appendTimelineEvent, asMaybeText, asText, parseError, requireApiContext, safeAudit } from "@/lib/employee-relations-api";

async function loadNote(supabase: any, companyId: string, noteId: string) {
  return supabase
    .from("employee_notes")
    .select("id,employee_id,note_body,note_status,deleted_at")
    .eq("id", noteId)
    .eq("company_id", companyId)
    .maybeSingle();
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ noteId: string }> }
) {
  try {
    const body = await request.json();
    const context = await requireApiContext(request, body.companyId);
    if (!context.ok) return NextResponse.json({ error: context.message }, { status: context.status });

    const noteId = asText((await params).noteId);
    if (!noteId) return NextResponse.json({ error: "noteId is required." }, { status: 400 });

    const found = await loadNote(context.ctx.auth.supabase, context.ctx.companyId, noteId);
    if (found.error) return NextResponse.json({ error: "Could not load note." }, { status: 500 });
    if (!found.data) return NextResponse.json({ error: "Note not found." }, { status: 404 });
    if (found.data.deleted_at) return NextResponse.json({ error: "Cannot update a deleted note." }, { status: 409 });

    const updates: Record<string, unknown> = {
      audit_metadata: {
        updated_by_email: context.ctx.auth.email,
      },
    };
    if (body.noteBody !== undefined) updates.note_body = asText(body.noteBody);
    if (body.category !== undefined) updates.note_category = asText(body.category);
    if (body.followUpDate !== undefined) updates.follow_up_date = asMaybeText(body.followUpDate);
    if (body.attachments !== undefined) updates.attachment_items = Array.isArray(body.attachments) ? body.attachments : [];
    if (body.mentionLinks !== undefined) updates.mention_links = Array.isArray(body.mentionLinks) ? body.mentionLinks : [];

    const { data, error } = await context.ctx.auth.supabase
      .from("employee_notes")
      .update(updates)
      .eq("id", noteId)
      .eq("company_id", context.ctx.companyId)
      .select("id,employee_id,note_category")
      .single();

    if (error || !data) return NextResponse.json({ error: "Could not update note." }, { status: 500 });

    await appendTimelineEvent(context.ctx.auth.supabase, {
      companyId: context.ctx.companyId,
      employeeId: data.employee_id,
      eventType: "employee_note_updated",
      sourceTable: "employee_notes",
      sourceId: noteId,
      title: "Employee note updated",
      metadata: {
        fields: Object.keys(updates),
      },
      createdBy: context.ctx.auth.email,
    });

    await safeAudit(context.ctx.auth.supabase, {
      companyId: context.ctx.companyId,
      email: context.ctx.auth.email,
      action: "update",
      entityType: "employee_note",
      entityId: noteId,
      metadata: { fields: Object.keys(updates) },
    });

    return NextResponse.json({ ok: true, note: data });
  } catch (error: unknown) {
    return NextResponse.json({ error: parseError(error) }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ noteId: string }> }
) {
  try {
    const body = await request.json();
    const context = await requireApiContext(request, body.companyId);
    if (!context.ok) return NextResponse.json({ error: context.message }, { status: context.status });

    const noteId = asText((await params).noteId);
    if (!noteId) return NextResponse.json({ error: "noteId is required." }, { status: 400 });

    const found = await loadNote(context.ctx.auth.supabase, context.ctx.companyId, noteId);
    if (found.error) return NextResponse.json({ error: "Could not load note." }, { status: 500 });
    if (!found.data) return NextResponse.json({ error: "Note not found." }, { status: 404 });

    const { data, error } = await context.ctx.auth.supabase
      .from("employee_notes")
      .update({
        note_status: "deleted",
        deleted_at: new Date().toISOString(),
        deleted_by: context.ctx.auth.email,
      })
      .eq("id", noteId)
      .eq("company_id", context.ctx.companyId)
      .is("deleted_at", null)
      .select("id,employee_id")
      .maybeSingle();

    if (error) return NextResponse.json({ error: "Could not delete note." }, { status: 500 });
    if (!data) return NextResponse.json({ error: "Note already deleted or not found." }, { status: 404 });

    await appendTimelineEvent(context.ctx.auth.supabase, {
      companyId: context.ctx.companyId,
      employeeId: data.employee_id,
      eventType: "employee_note_deleted",
      sourceTable: "employee_notes",
      sourceId: noteId,
      title: "Employee note deleted",
      createdBy: context.ctx.auth.email,
    });

    await safeAudit(context.ctx.auth.supabase, {
      companyId: context.ctx.companyId,
      email: context.ctx.auth.email,
      action: "archive",
      entityType: "employee_note",
      entityId: noteId,
      metadata: { softDelete: true },
    });

    return NextResponse.json({ ok: true });
  } catch (error: unknown) {
    return NextResponse.json({ error: parseError(error) }, { status: 500 });
  }
}

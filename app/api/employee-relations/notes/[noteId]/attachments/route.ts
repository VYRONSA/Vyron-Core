import { NextRequest, NextResponse } from "next/server";
import { appendTimelineEvent, asText, parseError, requireApiContext, safeAudit } from "@/lib/employee-relations-api";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ noteId: string }> }
) {
  try {
    const body = await request.json();
    const context = await requireApiContext(request, body.companyId);
    if (!context.ok) return NextResponse.json({ error: context.message }, { status: context.status });

    const noteId = asText((await params).noteId);
    if (!noteId) return NextResponse.json({ error: "noteId is required." }, { status: 400 });

    const fileBase64 = asText(body.fileBase64);
    const fileName = asText(body.fileName) || "attachment.bin";
    const contentType = asText(body.contentType) || "application/octet-stream";

    if (!fileBase64) {
      return NextResponse.json({ error: "fileBase64 is required." }, { status: 400 });
    }

    const { data: note, error: noteError } = await context.ctx.auth.supabase
      .from("employee_notes")
      .select("id,employee_id")
      .eq("id", noteId)
      .eq("company_id", context.ctx.companyId)
      .is("deleted_at", null)
      .maybeSingle();

    if (noteError) return NextResponse.json({ error: "Could not load note." }, { status: 500 });
    if (!note) return NextResponse.json({ error: "Note not found." }, { status: 404 });

    const path = `${context.ctx.companyId}/${note.employee_id}/${noteId}/${Date.now()}-${fileName.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
    const buffer = Buffer.from(fileBase64, "base64");

    const upload = await context.ctx.auth.supabase.storage
      .from("employee-note-attachments")
      .upload(path, buffer, {
        contentType,
        upsert: false,
      });

    if (upload.error) {
      return NextResponse.json({ error: "Could not upload note attachment." }, { status: 500 });
    }

    const { data: attachment, error: insertError } = await context.ctx.auth.supabase
      .from("employee_note_attachments")
      .insert({
        company_id: context.ctx.companyId,
        employee_note_id: noteId,
        file_bucket: "employee-note-attachments",
        file_path: path,
        file_name: fileName,
      })
      .select("id,file_bucket,file_path,file_name,created_at")
      .single();

    if (insertError || !attachment) {
      return NextResponse.json({ error: "Could not save note attachment metadata." }, { status: 500 });
    }

    await appendTimelineEvent(context.ctx.auth.supabase, {
      companyId: context.ctx.companyId,
      employeeId: note.employee_id,
      eventType: "employee_note_attachment_added",
      sourceTable: "employee_note_attachments",
      sourceId: attachment.id,
      title: "Note attachment added",
      summary: attachment.file_name,
      createdBy: context.ctx.auth.email,
    });

    await safeAudit(context.ctx.auth.supabase, {
      companyId: context.ctx.companyId,
      email: context.ctx.auth.email,
      action: "create",
      entityType: "employee_note_attachment",
      entityId: attachment.id,
      metadata: {
        noteId,
        fileName: attachment.file_name,
      },
    });

    return NextResponse.json({ ok: true, attachment }, { status: 201 });
  } catch (error: unknown) {
    return NextResponse.json({ error: parseError(error) }, { status: 500 });
  }
}

import { NextRequest, NextResponse } from "next/server";
import {
  asText,
  parseError,
  requireApiContext,
  safeAudit,
} from "@/lib/employee-relations-api";
import {
  parseSourceTable,
  replaceCurrentDocumentVersion,
} from "@/lib/employee-document-centre";

export const runtime = "nodejs";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ sourceTable: string; documentId: string }> }
) {
  try {
    const { sourceTable, documentId } = await params;
    const form = await request.formData();

    const companyId = asText(form.get("companyId"));
    const employeeId = asText(form.get("employeeId"));
    const classification = asText(form.get("classification")) || "hr_document";
    const changeReason = asText(form.get("changeReason")) || null;
    const file = form.get("file");

    const context = await requireApiContext(request, companyId);
    if (!context.ok) return NextResponse.json({ error: context.message }, { status: context.status });

    if (!employeeId) {
      return NextResponse.json({ error: "employeeId is required." }, { status: 400 });
    }

    if (!(file instanceof File)) {
      return NextResponse.json({ error: "New version file is required." }, { status: 400 });
    }

    const source = parseSourceTable(sourceTable);

    const replaced = await replaceCurrentDocumentVersion(context.ctx.auth.supabase, {
      companyId: context.ctx.companyId,
      employeeId,
      sourceTable: source,
      sourceDocumentId: documentId,
      classification,
      fileName: file.name,
      mimeType: file.type || null,
      fileBuffer: Buffer.from(await file.arrayBuffer()),
      actor: context.ctx.auth.email,
      changeReason,
    });

    await safeAudit(context.ctx.auth.supabase, {
      companyId: context.ctx.companyId,
      email: context.ctx.auth.email,
      action: "update",
      entityType: "employee_document",
      entityId: documentId,
      metadata: {
        sourceTable: source,
        versionId: replaced.versionId,
        versionNumber: replaced.versionNumber,
      },
    });

    return NextResponse.json({ ok: true, ...replaced });
  } catch (error: unknown) {
    return NextResponse.json({ error: parseError(error) }, { status: 500 });
  }
}

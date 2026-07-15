import { NextRequest, NextResponse } from "next/server";
import {
  asText,
  parseError,
  requireApiContext,
  safeAudit,
} from "@/lib/employee-relations-api";
import { getSignatureProvider } from "@/lib/signature-provider";
import { parseSourceTable } from "@/lib/employee-document-centre";

export const runtime = "nodejs";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  try {
    const { sessionId } = await params;
    const form = await request.formData();

    const companyId = asText(form.get("companyId"));
    const employeeId = asText(form.get("employeeId"));
    const documentId = asText(form.get("documentId"));
    const sourceTable = parseSourceTable(form.get("sourceTable"));
    const provider = getSignatureProvider(asText(form.get("provider")) || "native");
    const file = form.get("file");

    const context = await requireApiContext(request, companyId);
    if (!context.ok) return NextResponse.json({ error: context.message }, { status: context.status });

    if (!employeeId || !documentId) {
      return NextResponse.json({ error: "employeeId and documentId are required." }, { status: 400 });
    }

    if (!(file instanceof File)) {
      return NextResponse.json({ error: "Signed copy file is required." }, { status: 400 });
    }

    const uploaded = await provider.uploadSignedCopy(context.ctx.auth.supabase, {
      companyId: context.ctx.companyId,
      employeeId,
      sessionId,
      signingLinkId: asText(form.get("signingLinkId")) || null,
      documentId,
      sourceTable,
      fileName: file.name,
      mimeType: file.type || null,
      fileBuffer: Buffer.from(await file.arrayBuffer()),
      actor: context.ctx.auth.email,
      metadata: {
        uploadedVia: "api",
      },
    });

    await safeAudit(context.ctx.auth.supabase, {
      companyId: context.ctx.companyId,
      email: context.ctx.auth.email,
      action: "create",
      entityType: "signed_copy_upload",
      entityId: uploaded.versionId,
      metadata: {
        sessionId,
        documentId,
        sourceTable,
        signatureId: uploaded.signatureId,
      },
    });

    return NextResponse.json({ ok: true, ...uploaded });
  } catch (error: unknown) {
    return NextResponse.json({ error: parseError(error) }, { status: 500 });
  }
}

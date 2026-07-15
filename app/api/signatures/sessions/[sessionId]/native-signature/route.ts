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

function requestIp(request: NextRequest): string | null {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    null
  );
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  try {
    const { sessionId } = await params;
    const body = await request.json();

    const context = await requireApiContext(request, body.companyId);
    if (!context.ok) return NextResponse.json({ error: context.message }, { status: context.status });

    const employeeId = asText(body.employeeId);
    const documentId = asText(body.documentId);
    const sourceTable = parseSourceTable(body.sourceTable);
    const provider = getSignatureProvider(asText(body.provider) || "native");

    if (!employeeId || !documentId) {
      return NextResponse.json({ error: "employeeId and documentId are required." }, { status: 400 });
    }

    const saved = await provider.saveNativeSignature(context.ctx.auth.supabase, {
      companyId: context.ctx.companyId,
      employeeId,
      sessionId,
      signingLinkId: asText(body.signingLinkId) || null,
      documentId,
      sourceTable,
      signerName: asText(body.signerName) || "Unknown signer",
      signerRole: asText(body.signerRole) || "employee",
      signatureBase64Png: asText(body.signatureBase64Png),
      userAgent: request.headers.get("user-agent"),
      ipAddress: requestIp(request),
      consentText: asText(body.consentText) || null,
      actor: context.ctx.auth.email,
    });

    await safeAudit(context.ctx.auth.supabase, {
      companyId: context.ctx.companyId,
      email: context.ctx.auth.email,
      action: "create",
      entityType: "digital_signature",
      entityId: saved.signatureId,
      metadata: {
        sessionId,
        documentId,
        sourceTable,
        signatureHash: saved.signatureHash,
      },
    });

    return NextResponse.json({ ok: true, ...saved });
  } catch (error: unknown) {
    return NextResponse.json({ error: parseError(error) }, { status: 500 });
  }
}

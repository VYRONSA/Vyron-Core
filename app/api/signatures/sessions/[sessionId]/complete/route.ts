import { NextRequest, NextResponse } from "next/server";
import {
  asText,
  parseError,
  requireApiContext,
  safeAudit,
} from "@/lib/employee-relations-api";
import { getSignatureProvider } from "@/lib/signature-provider";
import { parseSourceTable } from "@/lib/employee-document-centre";

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

    await provider.completeSession(context.ctx.auth.supabase, {
      companyId: context.ctx.companyId,
      employeeId,
      sessionId,
      documentId,
      sourceTable,
      actor: context.ctx.auth.email,
    });

    await safeAudit(context.ctx.auth.supabase, {
      companyId: context.ctx.companyId,
      email: context.ctx.auth.email,
      action: "update",
      entityType: "signature_session",
      entityId: sessionId,
      metadata: {
        status: "completed",
        documentId,
      },
    });

    return NextResponse.json({ ok: true, sessionId, status: "completed" });
  } catch (error: unknown) {
    return NextResponse.json({ error: parseError(error) }, { status: 500 });
  }
}

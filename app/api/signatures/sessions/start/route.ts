import { NextRequest, NextResponse } from "next/server";
import {
  asArrayOfStrings,
  asText,
  assertEmployeeBelongsToCompany,
  parseError,
  requireApiContext,
  safeAudit,
} from "@/lib/employee-relations-api";
import { getSignatureProvider } from "@/lib/signature-provider";
import { parseSourceTable } from "@/lib/employee-document-centre";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    const context = await requireApiContext(request, body.companyId);
    if (!context.ok) return NextResponse.json({ error: context.message }, { status: context.status });

    const employeeId = asText(body.employeeId);
    const documentId = asText(body.documentId);
    const sourceTable = parseSourceTable(body.sourceTable);
    const providerKey = asText(body.provider) || "native";

    if (!employeeId || !documentId) {
      return NextResponse.json({ error: "employeeId and documentId are required." }, { status: 400 });
    }

    const employeeCheck = await assertEmployeeBelongsToCompany(
      context.ctx.auth.supabase,
      context.ctx.companyId,
      employeeId
    );
    if (!employeeCheck.ok) {
      return NextResponse.json({ error: employeeCheck.message }, { status: employeeCheck.status });
    }

    const provider = getSignatureProvider(providerKey);

    const signerRoles = asArrayOfStrings(body.signerRoles);
    const roles = signerRoles.length > 0 ? signerRoles : ["employee", "employer"];

    const started = await provider.startSession(context.ctx.auth.supabase, {
      companyId: context.ctx.companyId,
      employeeId,
      documentId,
      sourceTable,
      provider: provider.key,
      signerRoles: roles,
      startedBy: context.ctx.auth.email,
      recipientPhone: asText(body.recipientPhone) || null,
      deliveryChannel: asText(body.deliveryChannel) || "native",
      expiresAt: asText(body.expiresAt) || null,
      metadata: (body.metadata || {}) as Record<string, unknown>,
    });

    await safeAudit(context.ctx.auth.supabase, {
      companyId: context.ctx.companyId,
      email: context.ctx.auth.email,
      action: "create",
      entityType: "signature_session",
      entityId: started.sessionId,
      metadata: {
        sourceTable,
        documentId,
        signingLinkId: started.signingLinkId,
        provider: provider.key,
      },
    });

    return NextResponse.json({ ok: true, ...started, provider: provider.key });
  } catch (error: unknown) {
    return NextResponse.json({ error: parseError(error) }, { status: 500 });
  }
}

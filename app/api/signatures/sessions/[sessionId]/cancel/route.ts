import { NextRequest, NextResponse } from "next/server";
import {
  asText,
  parseError,
  requireApiContext,
  safeAudit,
} from "@/lib/employee-relations-api";
import { getSignatureProvider } from "@/lib/signature-provider";

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
    if (!employeeId) {
      return NextResponse.json({ error: "employeeId is required." }, { status: 400 });
    }

    const provider = getSignatureProvider(asText(body.provider) || "native");

    await provider.cancelSession(context.ctx.auth.supabase, {
      companyId: context.ctx.companyId,
      employeeId,
      sessionId,
      actor: context.ctx.auth.email,
      reason: asText(body.reason) || null,
    });

    await safeAudit(context.ctx.auth.supabase, {
      companyId: context.ctx.companyId,
      email: context.ctx.auth.email,
      action: "update",
      entityType: "signature_session",
      entityId: sessionId,
      metadata: {
        status: "cancelled",
        reason: asText(body.reason) || null,
      },
    });

    return NextResponse.json({ ok: true, sessionId, status: "cancelled" });
  } catch (error: unknown) {
    return NextResponse.json({ error: parseError(error) }, { status: 500 });
  }
}

import { NextRequest, NextResponse } from "next/server";
import {
  assertCompanyWorkspaceAccess,
  authenticateApiRequest,
  getSupabaseAdminClient,
} from "@/lib/server-api-auth";
import {
  isWhatsAppMockMode,
  loadWhatsAppCommandDashboard,
  processWhatsAppWorkforceCommand,
  sendWhatsAppWorkforceReply,
} from "@/lib/whatsapp-workforce-command";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const auth = await authenticateApiRequest(request);
  if (!auth.ok) {
    return NextResponse.json({ ok: false, error: auth.message }, { status: auth.status });
  }

  const companyId = (request.nextUrl.searchParams.get("companyId") || "").trim();
  if (companyId) {
    const access = await assertCompanyWorkspaceAccess(auth.supabase, auth.email, companyId, {
      platformOperator: auth.platformOperator,
    });
    if (!access.ok) {
      return NextResponse.json({ ok: false, error: access.message }, { status: access.status });
    }
  }

  const mockMode = isWhatsAppMockMode();
  return NextResponse.json({
    ok: true,
    service: "VYRON WhatsApp Workforce Command",
    mockMode,
    examples: [
      "Who is late today?",
      "Show pending approvals",
      "Approve action ACT-001",
      "Show field jobs active today",
    ],
    hasWhatsAppCredentials: Boolean(
      process.env.WHATSAPP_ACCESS_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID
    ),
    companyId: companyId || null,
  });
}

export async function POST(request: NextRequest) {
  try {
    const auth = await authenticateApiRequest(request);
    if (!auth.ok) {
      return NextResponse.json({ ok: false, error: auth.message }, { status: auth.status });
    }

    const body = await request.json();
    const phone = String(body?.phone || body?.to || "").trim();
    const message = String(body?.message || body?.text || "").trim();
    const forceMock = process.env.NODE_ENV !== "production" && body?.mock === true;
    const sendReply = body?.sendReply !== false;
    const companyId = String(body?.companyId || request.nextUrl.searchParams.get("companyId") || "").trim();

    if (!message) {
      return NextResponse.json({ ok: false, error: "message is required." }, { status: 400 });
    }

    if (!companyId) {
      return NextResponse.json({ ok: false, error: "companyId is required." }, { status: 400 });
    }

    const access = await assertCompanyWorkspaceAccess(auth.supabase, auth.email, companyId, {
      platformOperator: auth.platformOperator,
    });
    if (!access.ok) {
      return NextResponse.json({ ok: false, error: access.message }, { status: access.status });
    }

    const supabase = getSupabaseAdminClient();
    const result = await processWhatsAppWorkforceCommand(supabase, {
      phone: phone || "27000000000",
      messageText: message,
      companyId,
      managerEmail: auth.email,
      forceMock: forceMock || isWhatsAppMockMode(),
    });

    let sendResult: { ok: boolean; mock: boolean; error?: string } | null = null;
    if (sendReply && phone) {
      sendResult = await sendWhatsAppWorkforceReply(phone, result.reply);
    }

    if (companyId) {
      const dashboard = await loadWhatsAppCommandDashboard(supabase, companyId);
      return NextResponse.json({
        ok: result.success,
        result,
        sendResult,
        dashboardCounts: {
          sessions: dashboard.sessions.length,
          pending: dashboard.pendingApprovals.length,
          failed: dashboard.failedCommands.length,
        },
      });
    }

    return NextResponse.json({ ok: result.success, result, sendResult });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "WhatsApp command failed.";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

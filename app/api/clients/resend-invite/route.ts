import { NextRequest, NextResponse } from "next/server";
import { isVyronMasterOperator } from "@/lib/company-access";
import { resendClientActivationEmail } from "@/lib/client-invite-resend";
import { authenticateApiRequest } from "@/lib/server-api-auth";

export const runtime = "nodejs";

async function assertMasterOperator(request: NextRequest) {
  const auth = await authenticateApiRequest(request);
  if (!auth.ok) {
    return { ok: false as const, status: auth.status, message: auth.message };
  }

  if (!isVyronMasterOperator(auth.role) && !auth.platformOperator) {
    return {
      ok: false as const,
      status: 403,
      message: "Master operator access is required to resend client invites.",
    };
  }

  return { ok: true as const };
}

export async function GET() {
  return NextResponse.json({
    ok: true,
    route: "/api/clients/resend-invite",
    hasSupabaseUrl: Boolean((process.env.NEXT_PUBLIC_SUPABASE_URL || "").trim()),
    hasAnonKey: Boolean((process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "").trim()),
    hasServiceRoleKey: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()),
  });
}

export async function POST(request: NextRequest) {
  try {
    const auth = await assertMasterOperator(request);
    if (!auth.ok) {
      return NextResponse.json({ ok: false, error: auth.message }, { status: auth.status });
    }

    const body = await request.json();
    const email = String(body.email || "").trim();
    const inviteRedirectTo = String(body.inviteRedirectTo || "").trim();

    const result = await resendClientActivationEmail(email, inviteRedirectTo);

    if (!result.ok) {
      return NextResponse.json(
        { ok: false, code: result.code, error: result.message },
        { status: result.code === "rate_limit" ? 429 : 400 }
      );
    }

    return NextResponse.json({
      ok: true,
      kind: result.kind,
      message: result.message,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown resend invite error.";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

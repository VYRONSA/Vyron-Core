import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { isVyronMasterOperator } from "@/lib/company-access";
import { resendClientActivationEmail } from "@/lib/client-invite-resend";

export const runtime = "nodejs";

const supabaseUrl = (process.env.NEXT_PUBLIC_SUPABASE_URL || "").trim();
const supabaseAnonKey = (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "").trim();

function stripQuotes(value: string): string {
  const t = value.trim();
  if (t.length >= 2 && ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'")))) {
    return t.slice(1, -1).trim();
  }
  return t;
}

async function assertMasterOperator(request: NextRequest) {
  const authHeader = request.headers.get("authorization") || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
  if (!token) {
    return { ok: false as const, status: 401, message: "Sign in required." };
  }

  if (!supabaseUrl || !supabaseAnonKey) {
    return { ok: false as const, status: 500, message: "Server auth is not configured." };
  }

  const supabase = createClient(supabaseUrl, stripQuotes(supabaseAnonKey), {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user?.email) {
    return { ok: false as const, status: 401, message: "Invalid or expired session." };
  }

  if (!isVyronMasterOperator("", data.user.email)) {
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
    hasSupabaseUrl: Boolean(supabaseUrl),
    hasAnonKey: Boolean(stripQuotes(supabaseAnonKey)),
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

import { NextRequest, NextResponse } from "next/server";
import { requirePlatformOperator } from "@/app/api/platform/_shared";
import { startImpersonationSession, endImpersonationSession } from "@/lib/platform/impersonation";
import { IMPERSONATION_COOKIE } from "@/lib/platform/impersonation-context";

export const runtime = "nodejs";

const IMPERSONATION_TTL_SECONDS = 4 * 60 * 60; // 4 hours — matches the maintenance-override bypass window

/**
 * Reading impersonation status is deliberately allowed without elevation: the
 * "Viewing as <customer>" banner renders on every tenant page, and it must not
 * disappear when Platform Mode expires — an operator who cannot see that they are
 * impersonating is far more dangerous than one reading their own session state.
 */
export async function GET(request: NextRequest) {
  const auth = await requirePlatformOperator(request, { allowUnelevated: true });
  if (!auth.ok) return auth.response;
  return NextResponse.json({ ok: true, impersonating: auth.context.impersonating });
}

/** Starting impersonation IS privileged — elevation required (enforced by the gate). */
export async function POST(request: NextRequest) {
  const auth = await requirePlatformOperator(request);
  if (!auth.ok) return auth.response;
  const { supabase, email } = auth.context;

  const body = await request.json().catch(() => null);
  const companyId = body?.companyId ? String(body.companyId) : "";
  if (!companyId) return NextResponse.json({ ok: false, message: "companyId is required." }, { status: 400 });

  const result = await startImpersonationSession(supabase, { operatorEmail: email, companyId });
  if (!result.ok) return NextResponse.json({ ok: false, message: result.message }, { status: 400 });

  const response = NextResponse.json({ ok: true, sessionToken: result.sessionToken });
  response.cookies.set(IMPERSONATION_COOKIE, result.sessionToken, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    maxAge: IMPERSONATION_TTL_SECONDS,
    path: "/",
  });
  return response;
}

/**
 * Ending impersonation is a de-escalation, so it is allowed without elevation. If it
 * required Platform Mode, an expired elevation would strand the operator inside a
 * customer's workspace with no way out — the exact opposite of what this control is for.
 */
export async function DELETE(request: NextRequest) {
  const auth = await requirePlatformOperator(request, { allowUnelevated: true });
  if (!auth.ok) return auth.response;
  const { supabase, email } = auth.context;

  const sessionToken =
    request.nextUrl.searchParams.get("sessionToken") || request.cookies.get(IMPERSONATION_COOKIE)?.value || "";
  if (!sessionToken) {
    return NextResponse.json({ ok: false, message: "sessionToken is required." }, { status: 400 });
  }

  const result = await endImpersonationSession(supabase, { operatorEmail: email, sessionToken });
  if (!result.ok) return NextResponse.json({ ok: false, message: result.message }, { status: 400 });

  const response = NextResponse.json({ ok: true });
  response.cookies.delete(IMPERSONATION_COOKIE);
  return response;
}

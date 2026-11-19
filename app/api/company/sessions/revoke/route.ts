/**
 * Force Logout (audit D29).
 *
 * 1. Revokes the tracked session row — middleware and the API refuse it from the next request,
 *    and deleting the session cookie does not undo that (lib/server/session-validation.ts).
 * 2. Signs the person out at the authentication server: all of their auth sessions and refresh
 *    tokens are deleted (public.vyron_revoke_auth_sessions, service role only), so no new access
 *    token can be issued. An access token already issued stays valid until its JWT expiry.
 *
 * Only an owner or administrator of the session's own company may do this. The account is
 * resolved from Auth by the session's e-mail (never from a row id), and VYRONSOFT platform
 * accounts are never signed out from a customer workspace.
 */

import { NextResponse, type NextRequest } from "next/server";
import { requireCompanyUserContext } from "@/lib/tenant/api-auth";
import { readJsonBody } from "@/lib/tenant/api-response";
import { getSupabaseAdminClient } from "@/lib/server-api-auth";
import { isPlatformOperatorSessionUser } from "@/lib/server/platform-operator";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const gate = await requireCompanyUserContext(request);
  if (!gate.ok) return gate.response;
  const { actor, store } = gate.context;

  if (actor.role !== "owner" && actor.role !== "admin") {
    return NextResponse.json(
      { ok: false, message: "Only a company owner or administrator can force a logout." },
      { status: 403 }
    );
  }

  const body = await readJsonBody(request);
  const sessionToken = String(body.sessionToken || "").trim();
  if (!sessionToken) {
    return NextResponse.json({ ok: false, message: "sessionToken is required." }, { status: 400 });
  }

  const admin = getSupabaseAdminClient();
  const { data: session, error: sessionError } = await admin
    .from("vyron_user_sessions")
    .select("id,user_email,company_id,revoked_at")
    .eq("session_token", sessionToken)
    .eq("company_id", actor.companyId)
    .maybeSingle();
  if (sessionError) {
    return NextResponse.json({ ok: false, message: sessionError.message }, { status: 500 });
  }
  if (!session) {
    return NextResponse.json({ ok: false, message: "Session not found in this company." }, { status: 404 });
  }

  const notices: string[] = [];
  if (!session.revoked_at) {
    const { error: revokeError } = await admin
      .from("vyron_user_sessions")
      .update({ revoked_at: new Date().toISOString() })
      .eq("id", session.id);
    if (revokeError) {
      return NextResponse.json({ ok: false, message: revokeError.message }, { status: 500 });
    }
  }

  let authSessionsRevoked = 0;
  const authUser = await store.findAuthUserByEmail(String(session.user_email || ""));
  if (!authUser) {
    notices.push("No sign-in account matches this session; the tracked session was revoked.");
  } else if (isPlatformOperatorSessionUser(authUser)) {
    notices.push("This is a VYRONSOFT platform account: the workspace session was revoked, the sign-in account was not.");
  } else {
    const { data, error } = await admin.rpc("vyron_revoke_auth_sessions", { p_user_id: authUser.id });
    if (error) {
      notices.push(`The workspace session was revoked, but signing out at the authentication server failed: ${error.message}`);
    } else {
      authSessionsRevoked = Number(data || 0);
      notices.push("Signed out on every device. Any page already open loses access within the token lifetime.");
    }
  }

  await admin.from("vyron_audit_log").insert({
    company_id: actor.companyId,
    user_email: actor.email,
    action: "force_logout",
    entity_type: "user_session",
    entity_id: session.id,
    metadata: { targetEmail: session.user_email, authSessionsRevoked },
  });

  return NextResponse.json({ ok: true, authSessionsRevoked, notices });
}

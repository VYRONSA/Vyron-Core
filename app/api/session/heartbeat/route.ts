import { NextRequest, NextResponse } from "next/server";
import { authenticateApiRequest } from "@/lib/server-api-auth";
import { touchUserSession } from "@/lib/session-management";
import { VYRON_SESSION_TOKEN_COOKIE } from "@/lib/server/auth-routing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Phase 1C Task 2 — polled by useSessionTimeoutGuard so the client can show an
 * idle/absolute timeout warning and auto-logout without waiting for the user to
 * trigger some other authenticated request. Reuses authenticateApiRequest (which
 * already rejects revoked/idle/absolute-timed-out sessions) rather than a new
 * validity check. `active: true` refreshes last_seen_at so idle timeout reflects
 * real activity instead of counting down from login regardless of use.
 */
export async function POST(request: NextRequest) {
  try {
    const sessionToken = request.cookies.get(VYRON_SESSION_TOKEN_COOKIE)?.value || "";
    const auth = await authenticateApiRequest(request);
    if (!auth.ok) {
      return NextResponse.json({ ok: false, error: auth.message }, { status: auth.status });
    }

    const body = await request.json().catch(() => ({}));
    const active = Boolean((body as { active?: boolean })?.active);

    let session = auth.session;
    if (active && sessionToken) {
      await touchUserSession(auth.supabase, sessionToken);
      if (session) {
        session = {
          ...session,
          secondsUntilIdleTimeout: session.idleTimeoutMinutes * 60,
        };
      }
    }

    return NextResponse.json({ ok: true, session });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Heartbeat failed." },
      { status: 500 }
    );
  }
}

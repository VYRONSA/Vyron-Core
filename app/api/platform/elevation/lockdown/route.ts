/**
 * Emergency Lockdown — revoke every live Platform Mode session at once.
 *
 * Scope is deliberately narrow: this revokes PRIVILEGE, not access. Ordinary
 * application logins are untouched — operators and tenant users stay signed in and
 * keep working; every operator simply drops back to unelevated and must re-enter the
 * Platform Supervisor Password before any privileged action.
 *
 * The caller's own session is revoked along with the rest — a lockdown that exempted
 * whoever triggered it would be a poor emergency control.
 */

import { NextRequest, NextResponse } from "next/server";
import { requirePlatformOperator, requestIp, requestUserAgent } from "@/app/api/platform/_shared";
import { writeAuditLog } from "@/lib/audit-log";
import { ELEVATION_COOKIE, elevationCookieOptions } from "@/lib/platform/elevation";
import { revokeAllElevationSessions } from "@/lib/platform/elevation-registry";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const auth = await requirePlatformOperator(request);
  if (!auth.ok) return auth.response;
  const { supabase, email } = auth.context;

  const body = await request.json().catch(() => null);
  const reason = String(body?.reason || "emergency_lockdown").slice(0, 200);

  const result = await revokeAllElevationSessions(supabase, {
    revokedBy: email,
    reason,
  });

  if (!result.ok) {
    // Never report a lockdown as successful when nothing could actually be revoked.
    return NextResponse.json(
      { ok: false, available: result.available, message: result.message },
      { status: result.available ? 400 : 503 }
    );
  }

  await writeAuditLog(supabase, {
    userEmail: email,
    action: "platform_lockdown",
    entityType: "platform_elevation",
    metadata: {
      ip: requestIp(request),
      userAgent: requestUserAgent(request),
      revokedCount: result.revokedCount,
      reason,
      scope: "platform_mode_only",
    },
  });

  const response = NextResponse.json({
    ok: true,
    revokedCount: result.revokedCount,
    message: `Emergency lockdown complete. ${result.revokedCount} elevated session(s) revoked. Application logins were not affected.`,
  });
  // Clear the initiator's own cookie so the UI drops to the verification screen
  // immediately rather than waiting for the next gate check to notice.
  response.cookies.set(ELEVATION_COOKIE, "", { ...elevationCookieOptions(), maxAge: 0 });
  return response;
}

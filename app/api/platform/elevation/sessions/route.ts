/**
 * Active Platform Sessions.
 *
 *   GET    → every live elevated session (operator, IP, browser, started, remaining)
 *   DELETE → terminate one session by jti
 *
 * Both require Platform Mode themselves: viewing and killing other operators'
 * privileged sessions is itself a privileged action.
 */

import { NextRequest, NextResponse } from "next/server";
import { requirePlatformOperator, requestIp, requestUserAgent } from "@/app/api/platform/_shared";
import { writeAuditLog } from "@/lib/audit-log";
import {
  listActiveElevationSessions,
  revokeElevationSession,
} from "@/lib/platform/elevation-registry";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const auth = await requirePlatformOperator(request);
  if (!auth.ok) return auth.response;
  const { supabase, elevation } = auth.context;

  const result = await listActiveElevationSessions(supabase);
  if (!result.ok) {
    // Registry not installed — say so plainly rather than reporting "no sessions",
    // which would read as "nobody is elevated" and be actively misleading.
    return NextResponse.json(
      { ok: false, available: false, message: result.message },
      { status: 503 }
    );
  }

  const currentJti = elevation.elevated ? elevation.claims.jti : null;
  return NextResponse.json({
    ok: true,
    available: true,
    sessions: result.sessions.map((session) => ({
      ...session,
      // Lets the UI label "This device" and avoid offering a confusing self-terminate.
      isCurrent: session.jti === currentJti,
    })),
  });
}

export async function DELETE(request: NextRequest) {
  const auth = await requirePlatformOperator(request);
  if (!auth.ok) return auth.response;
  const { supabase, email } = auth.context;

  const jti = request.nextUrl.searchParams.get("jti") || "";
  if (!jti) {
    return NextResponse.json({ ok: false, message: "jti is required." }, { status: 400 });
  }

  const result = await revokeElevationSession(supabase, {
    jti,
    revokedBy: email,
    reason: "terminated_by_operator",
  });

  if (!result.ok) {
    return NextResponse.json(
      { ok: false, available: result.available, message: result.message },
      { status: result.available ? 400 : 503 }
    );
  }

  await writeAuditLog(supabase, {
    userEmail: email,
    action: "platform_elevation_revoked",
    entityType: "platform_elevation",
    entityId: jti,
    metadata: {
      ip: requestIp(request),
      userAgent: requestUserAgent(request),
      terminatedSession: jti,
      alreadyInactive: !result.revoked,
    },
  });

  return NextResponse.json({ ok: true, terminated: result.revoked });
}

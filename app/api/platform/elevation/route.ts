/**
 * Privilege elevation endpoint — enter, inspect and leave "Platform Mode".
 *
 *   GET    → current elevation state (no secrets, ever)
 *   POST   → verify the Platform Supervisor Password and start an elevated session
 *   DELETE → destroy the elevated session immediately
 *
 * This is the ONLY route allowed to run unelevated (allowUnelevated), because it is
 * the route that creates elevation in the first place. It still requires a fully
 * authenticated platform operator: elevation raises privilege, it never grants access
 * to someone who is not already an operator.
 *
 * The supervisor password is compared against a scrypt hash held server-side. Neither
 * the password nor the hash is ever returned to the browser.
 */

import { NextRequest, NextResponse } from "next/server";
import { requirePlatformOperator, requestIp, requestUserAgent } from "@/app/api/platform/_shared";
import { writeAuditLog } from "@/lib/audit-log";
import {
  ELEVATION_COOKIE,
  buildElevationClaims,
  checkAttemptLock,
  clearFailedAttempts,
  elevationCookieOptions,
  elevationIdleMinutes,
  elevationTtlMinutes,
  getSupervisorSecrets,
  issueElevationToken,
  matchSupervisorSecret,
  recordFailedAttempt,
} from "@/lib/platform/elevation";
import { registerElevationSession, revokeElevationSession } from "@/lib/platform/elevation-registry";

export const runtime = "nodejs";

function statusPayload(auth: Awaited<ReturnType<typeof requirePlatformOperator>>) {
  if (!auth.ok) return null;
  const { elevation } = auth.context;
  return elevation.elevated
    ? {
        ok: true as const,
        elevated: true as const,
        expiresAt: new Date(elevation.claims.exp * 1000).toISOString(),
        secondsRemaining: elevation.secondsRemaining,
        idleTimeoutMinutes: elevationIdleMinutes(),
      }
    : {
        ok: true as const,
        elevated: false as const,
        reason: elevation.reason,
        ttlMinutes: elevationTtlMinutes(),
      };
}

export async function GET(request: NextRequest) {
  const auth = await requirePlatformOperator(request, { allowUnelevated: true });
  if (!auth.ok) return auth.response;

  const secrets = getSupervisorSecrets();
  return NextResponse.json({
    ...statusPayload(auth),
    // Whether Platform Mode is configured at all — a boolean, never the secret.
    configured: secrets.ok,
    configurationMessage: secrets.ok ? null : secrets.message,
  });
}

export async function POST(request: NextRequest) {
  const auth = await requirePlatformOperator(request, { allowUnelevated: true });
  if (!auth.ok) return auth.response;

  const { supabase, email } = auth.context;
  const ip = requestIp(request);
  const userAgent = requestUserAgent(request);

  const secrets = getSupervisorSecrets();
  if (!secrets.ok) {
    // Misconfiguration, not a credential failure — fail closed and say so.
    return NextResponse.json({ ok: false, message: secrets.message }, { status: 503 });
  }

  const lockKey = `${email}|${ip}`;
  const lock = checkAttemptLock(lockKey);
  if (lock.locked) {
    return NextResponse.json(
      {
        ok: false,
        code: "locked_out",
        message: `Too many failed attempts. Try again in ${Math.ceil(lock.retryAfterSeconds / 60)} minute(s).`,
        retryAfterSeconds: lock.retryAfterSeconds,
      },
      { status: 429 }
    );
  }

  const body = await request.json().catch(() => null);
  const password = String(body?.password || "");

  if (!password) {
    return NextResponse.json(
      { ok: false, message: "The Platform Supervisor Password is required." },
      { status: 400 }
    );
  }

  const matched = matchSupervisorSecret(password, secrets);

  if (!matched) {
    const outcome = recordFailedAttempt(lockKey);
    await writeAuditLog(supabase, {
      userEmail: email,
      action: outcome.locked ? "platform_elevation_locked" : "platform_elevation_denied",
      entityType: "platform_elevation",
      metadata: {
        ip,
        userAgent,
        success: false,
        failures: outcome.failures,
        lockedOut: outcome.locked,
      },
    });

    if (outcome.locked) {
      return NextResponse.json(
        {
          ok: false,
          code: "locked_out",
          message: "Too many failed attempts. Platform Mode is locked for 15 minutes.",
        },
        { status: 429 }
      );
    }

    // Deliberately does not say how many attempts remain.
    return NextResponse.json(
      { ok: false, code: "invalid_password", message: "Incorrect Platform Supervisor Password." },
      { status: 401 }
    );
  }

  clearFailedAttempts(lockKey);

  const claims = buildElevationClaims(email, matched);
  // Always signed with the primary hash so verification has a single key, even when
  // the emergency secret was the one presented.
  const token = issueElevationToken(claims, secrets.primary);

  // Registry entry powers Active Platform Sessions / Terminate / Lockdown (sql/067).
  // Best-effort by design: the cookie is what authorises, so a registry outage must
  // not deny an operator a legitimately earned elevation.
  await registerElevationSession(supabase, {
    jti: claims.jti,
    operatorEmail: email,
    ip,
    userAgent,
    issuedAt: new Date(claims.iat * 1000),
    expiresAt: new Date(claims.exp * 1000),
  });

  await writeAuditLog(supabase, {
    userEmail: email,
    action: "platform_elevation_granted",
    entityType: "platform_elevation",
    entityId: claims.jti,
    metadata: {
      ip,
      userAgent,
      success: true,
      via: matched,
      grantedAt: new Date(claims.iat * 1000).toISOString(),
      expiresAt: new Date(claims.exp * 1000).toISOString(),
      durationMinutes: elevationTtlMinutes(),
    },
  });

  const response = NextResponse.json({
    ok: true,
    elevated: true,
    expiresAt: new Date(claims.exp * 1000).toISOString(),
    secondsRemaining: claims.exp - Math.floor(Date.now() / 1000),
    idleTimeoutMinutes: elevationIdleMinutes(),
  });
  response.cookies.set(ELEVATION_COOKIE, token, elevationCookieOptions());
  return response;
}

export async function DELETE(request: NextRequest) {
  const auth = await requirePlatformOperator(request, { allowUnelevated: true });
  if (!auth.ok) return auth.response;

  const { supabase, email, elevation } = auth.context;
  const body = await request.json().catch(() => null);
  // "manual" (Exit Platform Mode), "idle", "expired" — recorded verbatim for audit.
  const exitReason = String(body?.reason || "manual").slice(0, 40);

  if (elevation.elevated) {
    // Mark the registry row revoked too, so an exited session disappears from Active
    // Platform Sessions instead of lingering until its absolute expiry.
    await revokeElevationSession(supabase, {
      jti: elevation.claims.jti,
      revokedBy: email,
      reason: exitReason,
    });

    await writeAuditLog(supabase, {
      userEmail: email,
      action: "platform_elevation_exited",
      entityType: "platform_elevation",
      entityId: elevation.claims.jti,
      metadata: {
        ip: requestIp(request),
        userAgent: requestUserAgent(request),
        exitReason,
        grantedAt: new Date(elevation.claims.iat * 1000).toISOString(),
        // How long Platform Mode was actually held, not how long it was granted for.
        durationSeconds: Math.max(0, Math.floor(Date.now() / 1000) - elevation.claims.iat),
      },
    });
  }

  const response = NextResponse.json({ ok: true, elevated: false });
  response.cookies.set(ELEVATION_COOKIE, "", { ...elevationCookieOptions(), maxAge: 0 });
  return response;
}

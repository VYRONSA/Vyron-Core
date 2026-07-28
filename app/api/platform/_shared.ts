import { NextRequest, NextResponse } from "next/server";
import { authenticateApiRequest, getSupabaseAdminClient, type AuthenticatedApiContext } from "@/lib/server-api-auth";
import { getActiveImpersonation, type ActiveImpersonation } from "@/lib/platform/impersonation-context";
import {
  ELEVATION_COOKIE,
  getSupervisorSecrets,
  verifyElevationToken,
  type ElevationState,
} from "@/lib/platform/elevation";
import { isElevationRevoked } from "@/lib/platform/elevation-registry";

export type PlatformAuthContext = {
  supabase: ReturnType<typeof getSupabaseAdminClient>;
  email: string;
  /** Non-null when this operator is currently in an active "view as customer"
   * session — every app/api/platform/* handler receives this automatically. */
  impersonating: ActiveImpersonation | null;
  /** Live Platform Mode state for this request. `elevated: false` only reaches a
   * handler that explicitly opted out via `allowUnelevated`. */
  elevation: ElevationState;
};

export type PlatformGateOptions = {
  /**
   * Skip the privilege-elevation requirement for this handler. Reserved for the
   * elevation endpoint itself, which by definition runs before Platform Mode exists.
   * Everything else must stay elevated — see requirePlatformOperator below.
   */
  allowUnelevated?: boolean;
};

/**
 * Shared gate for every app/api/platform/* route.
 *
 * Two independent checks, in order:
 *   1. Authentication + the platform-operator claim (who is this?).
 *   2. Privilege elevation / Platform Mode (may they act right now?).
 *
 * Elevation is enforced HERE rather than route-by-route so it cannot be forgotten:
 * a new privileged endpoint is protected the moment it calls this function. GET is
 * treated exactly like a mutation, because the Platform Console's reads expose the
 * whole customer base.
 *
 * The one deliberate exception is `allowUnelevated`, used only by
 * /api/platform/elevation. (/api/platform/bootstrap does not call this gate at all —
 * by definition no operator exists yet when it runs.)
 */
export async function requirePlatformOperator(
  request: NextRequest,
  options: PlatformGateOptions = {}
): Promise<{ ok: true; context: PlatformAuthContext } | { ok: false; response: NextResponse }> {
  const auth: AuthenticatedApiContext = await authenticateApiRequest(request);

  if (!auth.ok) {
    return {
      ok: false,
      response: NextResponse.json({ ok: false, message: auth.message }, { status: auth.status }),
    };
  }

  if (!auth.platformOperator) {
    return {
      ok: false,
      response: NextResponse.json(
        { ok: false, message: "Platform operator access required." },
        { status: 403 }
      ),
    };
  }

  const supabaseForGate = getSupabaseAdminClient();
  let elevation = readElevation(request, auth.email);

  // Revocation layer (sql/067). The signature, binding and expiry checks above are
  // unchanged — this only adds "…and has it been revoked?", which a stateless cookie
  // cannot answer on its own. Powers Terminate Session and Emergency Lockdown.
  if (elevation.elevated) {
    const { revoked } = await isElevationRevoked(supabaseForGate, elevation.claims.jti);
    if (revoked) elevation = { elevated: false, reason: "revoked" };
  }

  if (!options.allowUnelevated && !elevation.elevated) {
    return {
      ok: false,
      response: NextResponse.json(
        {
          ok: false,
          // Machine-readable so the client can open the elevation screen instead of
          // showing a generic permission error.
          code: "elevation_required",
          reason: elevation.reason,
          message: "Platform Mode required. Enter the Platform Supervisor Password to continue.",
        },
        { status: 403 }
      ),
    };
  }

  const impersonating = await getActiveImpersonation(request, supabaseForGate);

  return {
    ok: true,
    context: { supabase: supabaseForGate, email: auth.email, impersonating, elevation },
  };
}

/** Reads and verifies the Platform Mode cookie for an already-authenticated operator. */
export function readElevation(request: NextRequest, email: string): ElevationState {
  const secrets = getSupervisorSecrets();
  if (!secrets.ok) return { elevated: false, reason: "absent" };

  return verifyElevationToken(
    request.cookies.get(ELEVATION_COOKIE)?.value,
    email,
    secrets.primary
  );
}

/** Best-effort client IP for the audit trail — proxy headers, so advisory only. */
export function requestIp(request: NextRequest): string {
  const forwarded = request.headers.get("x-forwarded-for") || "";
  return forwarded.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "unknown";
}

export function requestUserAgent(request: NextRequest): string {
  return (request.headers.get("user-agent") || "unknown").slice(0, 400);
}

/**
 * Platform Console gate.
 *
 * Two separate concepts, enforced in order:
 *   1. Authentication — middleware.ts already proved this request carries a valid
 *      session with the platform-operator claim. It is re-checked here so the console
 *      never renders on the strength of a client-side assumption alone.
 *   2. Privilege elevation — a valid Platform Mode session, entered with the dedicated
 *      Platform Supervisor Password (NOT the login password).
 *
 * An authenticated operator without elevation is deliberately NOT redirected to
 * /dashboard: they are shown the supervisor verification screen in place of the
 * console, so the route they asked for is the route they stay on.
 *
 * This is a server component, so the elevation cookie is verified before any console
 * markup is produced. The matching server-side enforcement for data lives in
 * app/api/platform/_shared.ts — this gate protects the UI, that one protects the API.
 */

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { VYRON_SESSION_TOKEN_COOKIE } from "@/lib/server/auth-routing";
import { resolveServerAuthorizationContext } from "@/lib/server/authorization";
import { getServerUser } from "@/lib/supabase-server";
import {
  ELEVATION_COOKIE,
  elevationIdleMinutes,
  elevationTtlMinutes,
  getSupervisorSecrets,
  verifyElevationToken,
  type ElevationState,
} from "@/lib/platform/elevation";
import { isElevationRevoked } from "@/lib/platform/elevation-registry";
import { getSupabaseAdminClient } from "@/lib/server-api-auth";
import PlatformConsoleChrome from "@/components/platform/PlatformConsoleChrome";
import PlatformElevationScreen from "@/components/platform/PlatformElevationScreen";

export default async function PlatformLayout({ children }: { children: React.ReactNode }) {
  const cookieStore = await cookies();
  const sessionToken = cookieStore.get(VYRON_SESSION_TOKEN_COOKIE)?.value || "";

  // Same verified session middleware used — read from the one Supabase auth cookie.
  const { supabase, user } = await getServerUser();
  const authz = await resolveServerAuthorizationContext(supabase, user, sessionToken);
  if (!authz.authenticated || !authz.sessionValid) {
    redirect("/login?next=%2Fplatform");
  }
  if (authz.role !== "platform_operator") {
    redirect("/dashboard");
  }

  const email = authz.email || "";
  const secrets = getSupervisorSecrets();
  let elevation: ElevationState = secrets.ok
    ? verifyElevationToken(cookieStore.get(ELEVATION_COOKIE)?.value, email, secrets.primary)
    : { elevated: false, reason: "absent" };

  // Revocation layer (sql/067) — mirrors the API gate so a terminated session or an
  // emergency lockdown drops the console UI too, not just the data endpoints.
  if (elevation.elevated) {
    const { revoked } = await isElevationRevoked(getSupabaseAdminClient(), elevation.claims.jti);
    if (revoked) elevation = { elevated: false, reason: "revoked" };
  }

  if (!elevation.elevated) {
    return (
      <PlatformElevationScreen
        configured={secrets.ok}
        configurationMessage={secrets.ok ? null : secrets.message}
        reason={elevation.reason}
        ttlMinutes={elevationTtlMinutes()}
        operatorEmail={email}
      />
    );
  }

  return (
    <PlatformConsoleChrome
      expiresAt={new Date(elevation.claims.exp * 1000).toISOString()}
      idleTimeoutMinutes={elevationIdleMinutes()}
      operatorEmail={email}
    >
      {children}
    </PlatformConsoleChrome>
  );
}

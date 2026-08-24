import { NextResponse, type NextRequest } from "next/server";
import {
  VYRON_SESSION_TOKEN_COOKIE,
  canAccessRouteForRole,
  isAuthPath,
  isMarketingPath,
  isPasswordResetPath,
  isProtectedPath,
  requiredModuleForRoute,
} from "@/lib/server/auth-routing";
import { resolveServerAuthorizationContext } from "@/lib/server/authorization";
import { hasModuleEntitlement } from "@/lib/server/module-entitlement";
import { getMaintenanceMode, MAINTENANCE_BYPASS_COOKIE } from "@/lib/platform/maintenance-mode";
import { createMiddlewareSupabase, withSessionCookies } from "@/lib/supabase-middleware";

function redirectToLogin(request: NextRequest, session: NextResponse): NextResponse {
  const next = `${request.nextUrl.pathname}${request.nextUrl.search}`;
  const url = request.nextUrl.clone();
  url.pathname = "/login";
  url.search = `?next=${encodeURIComponent(next)}`;
  return withSessionCookies(session, NextResponse.redirect(url));
}

function redirectToDashboard(request: NextRequest, session: NextResponse): NextResponse {
  const url = request.nextUrl.clone();
  url.pathname = "/dashboard";
  url.search = "";
  return withSessionCookies(session, NextResponse.redirect(url));
}

export async function middleware(request: NextRequest) {
  const pathname = request.nextUrl.pathname;

  // Single authentication authority: getUser() verifies the session against Supabase
  // and, when the access token has rotated, writes the refreshed auth cookies onto
  // `response`. Every redirect below carries those cookies forward.
  const { supabase, user, response, configured } = await createMiddlewareSupabase(request);

  if (!configured) {
    // Supabase env not set — fail closed on protected routes rather than letting
    // unauthenticated traffic through.
    if (isProtectedPath(pathname)) return redirectToLogin(request, response);
    return response;
  }

  const sessionToken = request.cookies.get(VYRON_SESSION_TOKEN_COOKIE)?.value || "";

  // The same client that verified the user performs the authorization reads, so they
  // run under that user's RLS. No token is passed around and no second session is
  // looked up anywhere in this request.
  const authz = user
    ? await resolveServerAuthorizationContext(
        supabase,
        { id: user.id, email: user.email ?? undefined, app_metadata: user.app_metadata },
        sessionToken
      )
    : null;

  // A revoked (Force Logout) or timed-out tracked session is treated the same as an
  // invalid session everywhere in this file — otherwise a session killed server-side
  // would still bounce between /login and /dashboard via the isAuthPath redirect below.
  const authenticated = Boolean(authz?.authenticated && authz.sessionValid);

  if (isProtectedPath(pathname)) {
    if (!authenticated || !authz) return redirectToLogin(request, response);
    if (!authz.membershipActive || !authz.companyActive || !authz.workspaceActive) {
      return redirectToLogin(request, response);
    }
    if (!authz.role || !canAccessRouteForRole(authz.role, pathname)) {
      return redirectToDashboard(request, response);
    }

    /**
     * Subscription entitlement for module-gated verticals (Road & Recovery today).
     *
     * The check above answers whether the ROLE may open the route. It cannot answer
     * whether the WORKSPACE bought the vertical, so without this a tenant with
     * road_recovery absent from companies.enabled_modules reached every board simply by
     * typing the URL — the entitlement was enforced only by hiding navigation.
     *
     * Read lazily, and only for the handful of gated prefixes, so the overwhelming
     * majority of protected requests still cost no extra query.
     *
     * Platform operators are NOT exempt here, and that is deliberate. Their exemption in
     * canAccessRouteForRole() is on the ROLE axis — VYRON staff see every route their
     * tenant seat can reach. Entitlement is a different axis: these pages resolve the
     * operator's OWN workspace (useRoadRecoveryCompany -> getCompanyAccess), never a
     * supported tenant's, so an operator whose workspace lacks the module would only ever
     * be shown an empty vertical. Gating them keeps one answer for one workspace — the
     * route now agrees with the navigation, which already hides the module from them.
     */
    const requiredModule = requiredModuleForRoute(pathname);
    if (requiredModule) {
      const entitled = await hasModuleEntitlement(
        supabase,
        { userId: authz.userId, email: authz.email, companyId: authz.companyId },
        requiredModule
      );
      if (!entitled) return redirectToDashboard(request, response);
    }

    if (authz.role !== "platform_operator") {
      const maintenance = await getMaintenanceMode();
      const bypassCookie = request.cookies.get(MAINTENANCE_BYPASS_COOKIE)?.value === "1";
      if (maintenance.enabled && !bypassCookie) {
        const url = request.nextUrl.clone();
        url.pathname = "/maintenance";
        url.search = `?next=${encodeURIComponent(pathname)}`;
        return withSessionCookies(response, NextResponse.redirect(url));
      }
    }

    return response;
  }

  if (authenticated && (isAuthPath(pathname) || isMarketingPath(pathname))) {
    if (isPasswordResetPath(pathname)) {
      return response;
    }
    if (request.nextUrl.searchParams.get("public") === "1") {
      return response;
    }
    return redirectToDashboard(request, response);
  }

  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|robots.txt|sitemap.xml|api|.*\\..*).*)",
  ],
};

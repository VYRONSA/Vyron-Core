import { NextResponse, type NextRequest } from "next/server";
import {
  VYRON_AUTH_COOKIE,
  canAccessRouteForRole,
  isAuthPath,
  isMarketingPath,
  isProtectedPath,
} from "@/lib/server/auth-routing";
import { resolveServerAuthorizationContext } from "@/lib/server/authorization";

function redirectToLogin(request: NextRequest): NextResponse {
  const next = `${request.nextUrl.pathname}${request.nextUrl.search}`;
  const url = request.nextUrl.clone();
  url.pathname = "/login";
  url.search = `?next=${encodeURIComponent(next)}`;
  return NextResponse.redirect(url);
}

function redirectToDashboard(request: NextRequest): NextResponse {
  const url = request.nextUrl.clone();
  url.pathname = "/dashboard";
  url.search = "";
  return NextResponse.redirect(url);
}

export async function middleware(request: NextRequest) {
  const pathname = request.nextUrl.pathname;

  const rawToken = request.cookies.get(VYRON_AUTH_COOKIE)?.value || "";
  const authz = await resolveServerAuthorizationContext(rawToken);
  const authenticated = authz.authenticated;

  if (isProtectedPath(pathname)) {
    if (!authenticated) return redirectToLogin(request);
    if (!authz.membershipActive || !authz.companyActive || !authz.workspaceActive) {
      return redirectToLogin(request);
    }
    if (!authz.role || !canAccessRouteForRole(authz.role, pathname)) {
      return redirectToDashboard(request);
    }
    return NextResponse.next();
  }

  if (authenticated && (isAuthPath(pathname) || isMarketingPath(pathname))) {
    if (request.nextUrl.searchParams.get("public") === "1") {
      return NextResponse.next();
    }
    return redirectToDashboard(request);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|robots.txt|sitemap.xml|api|.*\\..*).*)",
  ],
};

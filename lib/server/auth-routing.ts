import { isPlatformOperatorRole } from "@/lib/server/platform-operator";

/**
 * Carries the vyron_user_sessions.session_token so the server can enforce Force Logout
 * / idle / absolute timeout (see lib/server/session-validation.ts).
 *
 * This is NOT an authentication credential — it names a tracked-session row and grants
 * nothing by itself. Authentication lives entirely in the Supabase auth cookies managed
 * by @supabase/ssr. The former `vyron_access_token` cookie (a client-written duplicate
 * of the access token) and `vyron_role` (a client-written role hint no server code ever
 * read) were removed in the authentication consolidation.
 */
export const VYRON_SESSION_TOKEN_COOKIE = "vyron_session_id";

export const AUTH_ROUTES = [
  "/login",
  "/signup",
  "/forgot-password",
  "/reset-password",
  "/invite",
] as const;

export const MARKETING_ROUTES = [
  "/",
  "/about",
  "/contact",
  "/features",
  "/industries",
  "/pricing",
  "/solutions",
  "/resources",
  "/privacy",
  "/products",
  "/terms",
] as const;

export const PUBLIC_ROUTE_PREFIXES = ["/sign-contract", "/maintenance"] as const;

export const PROTECTED_ROUTE_PREFIXES = [
  "/dashboard",
  "/automation",
  "/client-portal",
  "/clock",
  "/clock-review",
  "/design-preview",
  "/employee-leave",
  "/employees",
  "/enterprise",
  "/field-mobile",
  "/growth",
  "/hr-cases",
  "/hr-warnings",
  "/intelligence",
  "/kiosk",
  "/leave",
  "/leave-application",
  "/leave-status",
  "/mobile-workforce",
  "/operations",
  "/owner",
  "/platform",
  "/payroll-exceptions",
  "/payroll-forecast",
  "/payroll-intelligence",
  "/payroll-leakage",
  "/payroll-readiness",
  "/profitability-intelligence",
  "/recruitment-applicants",
  "/recruitment-intelligence",
  "/recruitment-interviews",
  "/recruitment-skills",
  "/recruitment-succession",
  "/recruitment-vacancies",
  "/reports",
  "/route-history",
  "/settings",
  "/staff-leave",
  "/documents",
  "/manager-centre",
  "/travel-intelligence",
  "/vehicle-intelligence",
  "/whatsapp-command",
  "/workforce-ai-copilot",
  "/workforce-cost",
  "/workforce-digital-twin",
  "/workforce-intelligence",
  "/workforce-journey",
  "/workforce-lifecycle",
  "/workforce-operating-system",
  "/workforce-risk",
] as const;

export type VyronRbacRole = "platform_operator" | "owner" | "supervisor" | "manager" | "employee";

/** Routes reserved for VYRON's own platform operators (Platform Console). */
export const PLATFORM_ONLY_ROUTE_PREFIXES = ["/platform"] as const;

const EMPLOYEE_ALLOWED_PREFIXES = [
  "/dashboard",
  "/leave",
  "/leave-application",
  "/leave-status",
  "/employee-leave",
  "/clock",
  "/kiosk",
  "/staff-leave",
  "/mobile-workforce",
] as const;

// /settings is the workspace governance area (Users & Access). Company owners and
// admins reach it — note that normalizeRbacRole maps the tenant "admin" role onto
// "manager", so managers are allowed through here and the real owner/admin check is
// enforced server-side by lib/tenant/user-management.ts, which is the security boundary.
const MANAGER_BLOCKED_PREFIXES = ["/owner", "/enterprise"] as const;
const SUPERVISOR_BLOCKED_PREFIXES = ["/owner", "/settings"] as const;

function matchesRoutePrefix(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

function parseJwtPayload(token: string): Record<string, unknown> | null {
  const parts = token.split(".");
  if (parts.length < 2) return null;

  try {
    const base64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const normalized = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), "=");
    const raw = atob(normalized);
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function normalizeRbacRole(input?: string | null): VyronRbacRole {
  const value = String(input || "").trim().toLowerCase();
  if (isPlatformOperatorRole([value])) return "platform_operator";
  if (value === "owner" || value === "super_user" || value === "superuser") return "owner";
  if (value === "supervisor") return "supervisor";
  if (value === "manager" || value === "admin") return "manager";
  return "employee";
}

export function isProtectedPath(pathname: string): boolean {
  if (isAuthPath(pathname) || isMarketingPath(pathname)) return false;
  if (PUBLIC_ROUTE_PREFIXES.some((prefix) => matchesRoutePrefix(pathname, prefix))) return false;

  // Default deny for non-public routes to avoid accidental exposure when new modules are added.
  return true;
}

export function isAuthPath(pathname: string): boolean {
  return AUTH_ROUTES.some((route) => matchesRoutePrefix(pathname, route));
}

export function isMarketingPath(pathname: string): boolean {
  return MARKETING_ROUTES.some((route) => matchesRoutePrefix(pathname, route));
}

/** Password-recovery/invite-acceptance links must render even for an already-authenticated
 * browser session — the token that matters lives in the URL hash fragment, which the server
 * never sees, so an existing cookie must not bounce the user away before it's processed. */
export function isPasswordResetPath(pathname: string): boolean {
  return matchesRoutePrefix(pathname, "/reset-password");
}

export function canAccessRouteForRole(role: VyronRbacRole, pathname: string): boolean {
  if (!isProtectedPath(pathname)) return true;

  const knownProtectedRoute = PROTECTED_ROUTE_PREFIXES.some((prefix) =>
    matchesRoutePrefix(pathname, prefix)
  );
  if (!knownProtectedRoute) return false;

  const isPlatformOnlyRoute = PLATFORM_ONLY_ROUTE_PREFIXES.some((prefix) =>
    matchesRoutePrefix(pathname, prefix)
  );
  if (isPlatformOnlyRoute) return role === "platform_operator";

  // Platform operators (VYRON staff) get full tenant-side access too — this
  // preserves today's implicit behavior where VYRON DEV rides on whatever
  // protected route (e.g. /dashboard) the operator is already authenticated into.
  if (role === "platform_operator") return true;

  if (role === "owner") return true;

  if (role === "supervisor") {
    return !SUPERVISOR_BLOCKED_PREFIXES.some(
      (prefix) => matchesRoutePrefix(pathname, prefix)
    );
  }

  if (role === "manager") {
    return !MANAGER_BLOCKED_PREFIXES.some(
      (prefix) => matchesRoutePrefix(pathname, prefix)
    );
  }

  return EMPLOYEE_ALLOWED_PREFIXES.some(
    (prefix) => matchesRoutePrefix(pathname, prefix)
  );
}

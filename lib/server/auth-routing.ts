export const VYRON_AUTH_COOKIE = "vyron_access_token";
export const VYRON_ROLE_COOKIE = "vyron_role";
/** Carries the vyron_user_sessions.session_token so the server can enforce Force
 * Logout / idle / absolute timeout (see lib/server/session-validation.ts). Written
 * alongside the local-storage copy in lib/session-management.ts. */
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

export const PUBLIC_ROUTE_PREFIXES = ["/sign-contract"] as const;

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

export type VyronRbacRole = "owner" | "supervisor" | "manager" | "employee";

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

const MANAGER_BLOCKED_PREFIXES = ["/owner", "/enterprise"] as const;
const SUPERVISOR_BLOCKED_PREFIXES = ["/owner"] as const;

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

export function isTokenUsable(token?: string | null): boolean {
  if (!token) return false;
  const payload = parseJwtPayload(token);
  if (!payload) return false;

  const exp = Number(payload.exp);
  if (!Number.isFinite(exp)) return true;
  const now = Math.floor(Date.now() / 1000);
  return exp > now;
}

export function normalizeRbacRole(input?: string | null): VyronRbacRole {
  const value = String(input || "").trim().toLowerCase();
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

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getAvailableCompanies } from "@/lib/company-access";
import { evaluateSessionValidity, type SessionRow } from "@/lib/server/session-validation";

export type AuthenticatedApiContext =
  | {
      ok: true;
      supabase: SupabaseClient;
      email: string;
      role: string;
      roles: string[];
      platformOperator: boolean;
      /** Null when no session cookie was presented at all (see session-validation.ts —
       * that case is treated as valid, not rejected, so there is nothing to report). */
      session: {
        idleTimeoutMinutes: number;
        absoluteTimeoutMinutes: number;
        secondsUntilIdleTimeout: number;
        secondsUntilAbsoluteTimeout: number;
      } | null;
    }
  | { ok: false; status: number; message: string };

const PLATFORM_OPERATOR_ROLES = new Set([
  "super_admin",
  "platform_admin",
  "platform_operator",
  "supervisor tools",
]);

function toRoleList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((item) => String(item || "").trim().toLowerCase()).filter(Boolean);
  }
  if (typeof value === "string") {
    const role = value.trim().toLowerCase();
    return role ? [role] : [];
  }
  return [];
}

function extractAuthRoles(user: {
  role?: string;
  app_metadata?: Record<string, unknown>;
  user_metadata?: Record<string, unknown>;
}): string[] {
  // Only app_metadata is trusted for authorization: it can only be written via the
  // Supabase Admin API (service role). user_metadata is self-editable by the signed-in
  // user via supabase.auth.updateUser() and must never be treated as a privilege claim.
  const appRole = user.app_metadata?.role;
  const appRoles = user.app_metadata?.roles;

  const merged = [
    ...toRoleList(user.role),
    ...toRoleList(appRole),
    ...toRoleList(appRoles),
  ];
  return Array.from(new Set(merged));
}

function isPlatformOperatorByClaims(roles: string[]): boolean {
  return roles.some((role) => PLATFORM_OPERATOR_ROLES.has(role));
}

function stripEnvQuotes(value: string): string {
  const t = value.trim();
  if (
    t.length >= 2 &&
    ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'")))
  ) {
    return t.slice(1, -1).trim();
  }
  return t;
}

export function getSupabasePublicConfig(): { url: string; anonKey: string } {
  return {
    url: stripEnvQuotes(process.env.NEXT_PUBLIC_SUPABASE_URL || ""),
    anonKey: stripEnvQuotes(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ""),
  };
}

/** Service-role client for server routes — lazy; safe at build time. */
export function getSupabaseAdminClient(): SupabaseClient {
  const url = stripEnvQuotes(process.env.NEXT_PUBLIC_SUPABASE_URL || "");
  const key = stripEnvQuotes(process.env.SUPABASE_SERVICE_ROLE_KEY || "");
  if (!url) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL is required.");
  }
  if (!key) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY is required for admin operations.");
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

const SESSION_INVALID_MESSAGE: Record<"revoked" | "idle_timeout" | "absolute_timeout", string> = {
  revoked: "Your session was ended by an administrator. Please sign in again.",
  idle_timeout: "Your session expired due to inactivity. Please sign in again.",
  absolute_timeout: "Your session has expired. Please sign in again.",
};

/**
 * Bearer JWT session → Supabase client scoped to the signed-in user (RLS).
 * sessionToken is the vyron_session_id cookie (see lib/server/session-validation.ts) —
 * required so Force Logout / idle / absolute timeout are enforced on every API call, not
 * just page navigation. Pass an empty string only when the caller genuinely cannot read
 * cookies (there are no such callers today); every route handler has access to
 * request.cookies.
 */
export async function authenticateApiRequest(
  authorizationHeader: string | null,
  sessionToken: string
): Promise<AuthenticatedApiContext> {
  const token = (authorizationHeader || "").startsWith("Bearer ")
    ? (authorizationHeader || "").slice(7).trim()
    : "";

  if (!token) {
    return { ok: false, status: 401, message: "Sign in required." };
  }

  const { url, anonKey } = getSupabasePublicConfig();
  if (!url || !anonKey) {
    return { ok: false, status: 500, message: "Server auth is not configured." };
  }

  const supabase = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });

  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user?.email) {
    return { ok: false, status: 401, message: "Invalid or expired session." };
  }

  let sessionRow: SessionRow | null = null;
  if (sessionToken) {
    const { data: sessionData } = await supabase
      .from("vyron_user_sessions")
      .select("session_token,revoked_at,last_seen_at,created_at,company_id")
      .eq("session_token", sessionToken)
      .maybeSingle();
    sessionRow = (sessionData as SessionRow | null) || null;
  }

  let companyTimeoutConfig: { session_idle_timeout_minutes: number | null; session_absolute_timeout_minutes: number | null } | null = null;
  if (sessionRow?.company_id) {
    const { data: companyData } = await supabase
      .from("companies")
      .select("session_idle_timeout_minutes,session_absolute_timeout_minutes")
      .eq("id", sessionRow.company_id)
      .maybeSingle();
    companyTimeoutConfig = companyData || null;
  }

  const sessionValidity = evaluateSessionValidity(sessionRow, companyTimeoutConfig);
  if (!sessionValidity.valid) {
    return { ok: false, status: 401, message: SESSION_INVALID_MESSAGE[sessionValidity.reason] };
  }

  const roles = extractAuthRoles(data.user);
  const role = roles[0] || "employee";

  return {
    ok: true,
    supabase,
    email: data.user.email.trim().toLowerCase(),
    role,
    roles,
    platformOperator: isPlatformOperatorByClaims(roles),
    session: {
      idleTimeoutMinutes: sessionValidity.idleTimeoutMinutes,
      absoluteTimeoutMinutes: sessionValidity.absoluteTimeoutMinutes,
      secondsUntilIdleTimeout: sessionValidity.secondsUntilIdleTimeout,
      secondsUntilAbsoluteTimeout: sessionValidity.secondsUntilAbsoluteTimeout,
    },
  };
}

export async function assertCompanyWorkspaceAccess(
  supabase: SupabaseClient,
  email: string,
  companyId: string,
  options?: { platformOperator?: boolean }
): Promise<{ ok: true } | { ok: false; status: number; message: string }> {
  const normalizedId = (companyId || "").trim();
  if (!normalizedId) {
    return { ok: false, status: 400, message: "companyId is required." };
  }

  if (options?.platformOperator) {
    return { ok: true };
  }

  const { companies, error } = await getAvailableCompanies(supabase);
  if (error) {
    return { ok: false, status: 403, message: error };
  }

  const allowed = companies.some((c) => c.company_id === normalizedId);
  if (!allowed) {
    return {
      ok: false,
      status: 403,
      message: "You do not have access to this company workspace.",
    };
  }

  return { ok: true };
}

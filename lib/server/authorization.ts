import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizeRbacRole, type VyronRbacRole } from "@/lib/server/auth-routing";
import { evaluateSessionValidity, type SessionRow } from "@/lib/server/session-validation";
import { isPlatformOperatorRole } from "@/lib/server/platform-operator";

/** Shape of the verified user from supabase.auth.getUser(). */
export type SupabaseUser = {
  id?: string;
  email?: string | null;
  app_metadata?: Record<string, unknown>;
};

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

/** Only app_metadata is trusted for authorization — see lib/server-api-auth.ts's
 * extractAuthRoles for the matching rationale (user_metadata is self-editable). */
function isPlatformOperatorUser(user: SupabaseUser): boolean {
  const appRole = user.app_metadata?.role;
  const appRoles = user.app_metadata?.roles;
  return isPlatformOperatorRole([...toRoleList(appRole), ...toRoleList(appRoles)]);
}

type CompanyUserRow = {
  company_id?: string;
  role?: string;
  status?: string;
  user_id?: string | null;
  user_email?: string | null;
};

type CompanyRow = {
  id?: string;
  status?: string | null;
  subscription_status?: string | null;
  customer_status?: string | null;
  session_idle_timeout_minutes?: number | null;
  session_absolute_timeout_minutes?: number | null;
};

type RpcAccessRow = {
  company_id?: string;
  user_role?: string;
  user_status?: string;
  subscription_status?: string;
  subscription_locked?: boolean;
};

export type ServerAuthorizationContext = {
  authenticated: boolean;
  userId: string | null;
  email: string | null;
  role: VyronRbacRole | null;
  companyId: string | null;
  membershipActive: boolean;
  companyActive: boolean;
  workspaceActive: boolean;
  /** False when the tracked session (vyron_user_sessions) is missing, force-logout
   * revoked, idle-timed-out, or past its absolute lifetime. See Task 1/2 (Phase 1C). */
  sessionValid: boolean;
};

const ACTIVE_COMPANY_STATUSES = new Set(["", "active", "trial", "trialing", "demo"]);
const ACTIVE_WORKSPACE_STATUSES = new Set(["", "active", "trial", "trialing", "demo"]);
/** Platform Console customer_status values that must block sign-in (sql/062). */
const BLOCKED_CUSTOMER_STATUSES = new Set(["suspended", "cancelled", "expired"]);

function isCustomerStatusBlocked(company: CompanyRow | null): boolean {
  return BLOCKED_CUSTOMER_STATUSES.has(normalizeStatus(company?.customer_status));
}

function normalizeEmail(email?: string | null): string {
  return (email || "").trim().toLowerCase();
}

function normalizeStatus(value?: string | null): string {
  return (value || "").trim().toLowerCase();
}

function baseDeniedContext(userId: string | null, email: string | null): ServerAuthorizationContext {
  return {
    authenticated: true,
    userId,
    email,
    role: null,
    companyId: null,
    membershipActive: false,
    companyActive: false,
    workspaceActive: false,
    sessionValid: false,
  };
}

function unauthenticatedContext(): ServerAuthorizationContext {
  return {
    authenticated: false,
    userId: null,
    email: null,
    role: null,
    companyId: null,
    membershipActive: false,
    companyActive: false,
    workspaceActive: false,
    sessionValid: false,
  };
}

async function fetchCompanyById(
  supabase: SupabaseClient,
  companyId: string
): Promise<CompanyRow | null> {
  const { data } = await supabase
    .from("companies")
    .select(
      "id,status,subscription_status,customer_status,session_idle_timeout_minutes,session_absolute_timeout_minutes"
    )
    .eq("id", companyId)
    .limit(1)
    .maybeSingle();
  return (data as CompanyRow | null) || null;
}

async function fetchMembershipViaCompanyUsers(
  supabase: SupabaseClient,
  userId: string,
  email: string
): Promise<CompanyUserRow | null> {
  // Commas would break PostgREST's or() grammar; the address is only ever compared.
  const escapedEmail = email.replace(/,/g, "");
  const { data } = await supabase
    .from("company_users")
    .select("company_id,role,status,user_id,user_email,created_at")
    .eq("status", "active")
    .or(`user_id.eq.${userId},user_email.eq.${escapedEmail}`)
    .order("created_at", { ascending: true })
    .limit(20);

  const rows = (data as CompanyUserRow[] | null) || [];
  if (rows.length === 0) return null;

  const byUserId = rows.find((row) => (row.user_id || "") === userId);
  if (byUserId) return byUserId;

  const byEmail = rows.find((row) => normalizeEmail(row.user_email) === normalizeEmail(email));
  return byEmail || null;
}

async function fetchMembershipViaRpc(supabase: SupabaseClient): Promise<RpcAccessRow | null> {
  const { data, error } = await supabase.rpc("vyron_get_company_access");
  if (error) return null;
  if (Array.isArray(data)) return (data[0] as RpcAccessRow) || null;
  return (data as RpcAccessRow) || null;
}

async function fetchSessionByToken(
  supabase: SupabaseClient,
  sessionToken: string
): Promise<SessionRow | null> {
  if (!sessionToken) return null;
  const { data } = await supabase
    .from("vyron_user_sessions")
    .select("session_token,revoked_at,last_seen_at,created_at,company_id")
    .eq("session_token", sessionToken)
    .limit(1)
    .maybeSingle();
  return (data as SessionRow | null) || null;
}

/**
 * Resolves authorization for an already-authenticated Supabase user.
 *
 * `user` comes from supabase.auth.getUser() — the one verified identity for the
 * request (middleware or a Server Component). `accessToken` is that same session's
 * token, used only so the PostgREST reads below run under the caller's RLS rather than
 * with elevated rights. There is no second session lookup and no second token store.
 */
export async function resolveServerAuthorizationContext(
  supabase: SupabaseClient,
  user: SupabaseUser | null,
  sessionToken: string
): Promise<ServerAuthorizationContext> {
  if (!user?.id) {
    return unauthenticatedContext();
  }

  try {
    const userId = user.id;
    const email = normalizeEmail(user.email);
    const denied = baseDeniedContext(userId, email || null);
    // Platform operators (VYRON staff) may have no tenant company_users seat at
    // all — their access must never hinge on one existing. When true, the
    // resolved role is forced to "platform_operator" below regardless of which
    // branch (membership / RPC / neither) is reached.
    const platformOperator = isPlatformOperatorUser(user);

    const membership = await fetchMembershipViaCompanyUsers(supabase, userId, email);

    if (membership?.company_id) {
      const [company, session] = await Promise.all([
        fetchCompanyById(supabase, membership.company_id),
        fetchSessionByToken(supabase, sessionToken),
      ]);

      const role = platformOperator ? "platform_operator" : normalizeRbacRole(membership.role || "employee");
      const membershipActive = normalizeStatus(membership.status || "active") === "active";
      const companyStatus = normalizeStatus(company?.status);
      const workspaceStatus = normalizeStatus(company?.subscription_status);
      const companyActive =
        ACTIVE_COMPANY_STATUSES.has(companyStatus) && !isCustomerStatusBlocked(company);
      const workspaceActive = ACTIVE_WORKSPACE_STATUSES.has(workspaceStatus);
      const sessionValid = evaluateSessionValidity(session, company).valid;

      return {
        authenticated: true,
        userId,
        email: email || null,
        role,
        companyId: membership.company_id,
        membershipActive: membershipActive || platformOperator,
        companyActive: companyActive || platformOperator,
        workspaceActive: workspaceActive || platformOperator,
        sessionValid,
      };
    }

    const rpc = await fetchMembershipViaRpc(supabase);

    if (!rpc?.company_id) {
      if (!platformOperator) return denied;
      const session = await fetchSessionByToken(supabase, sessionToken);
      return {
        authenticated: true,
        userId,
        email: email || null,
        role: "platform_operator",
        companyId: null,
        membershipActive: true,
        companyActive: true,
        workspaceActive: true,
        sessionValid: evaluateSessionValidity(session, null).valid,
      };
    }

    const [company, session] = await Promise.all([
      fetchCompanyById(supabase, rpc.company_id),
      fetchSessionByToken(supabase, sessionToken),
    ]);
    const role = platformOperator ? "platform_operator" : normalizeRbacRole(rpc.user_role || "employee");
    const membershipActive = normalizeStatus(rpc.user_status || "active") === "active";
    const companyStatus = normalizeStatus(company?.status);
    const workspaceStatus = normalizeStatus(
      company?.subscription_status || rpc.subscription_status || "active"
    );
    const companyActive =
      ACTIVE_COMPANY_STATUSES.has(companyStatus) && !isCustomerStatusBlocked(company);
    const workspaceActive =
      ACTIVE_WORKSPACE_STATUSES.has(workspaceStatus) && rpc.subscription_locked !== true;
    const sessionValid = evaluateSessionValidity(session, company).valid;

    return {
      authenticated: true,
      userId,
      email: email || null,
      role,
      companyId: rpc.company_id,
      membershipActive: membershipActive || platformOperator,
      companyActive: companyActive || platformOperator,
      workspaceActive: workspaceActive || platformOperator,
      sessionValid,
    };
  } catch {
    return unauthenticatedContext();
  }
}
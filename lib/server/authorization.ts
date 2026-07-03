import { normalizeRbacRole, type VyronRbacRole } from "@/lib/server/auth-routing";

type SupabaseUser = {
  id?: string;
  email?: string;
};

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
};

const ACTIVE_COMPANY_STATUSES = new Set(["", "active", "trial", "trialing", "demo"]);
const ACTIVE_WORKSPACE_STATUSES = new Set(["", "active", "trial", "trialing", "demo"]);

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
  };
}

async function fetchSupabaseUser(
  supabaseUrl: string,
  supabaseAnonKey: string,
  token: string
): Promise<SupabaseUser | null> {
  const response = await fetch(`${supabaseUrl}/auth/v1/user`, {
    method: "GET",
    headers: {
      apikey: supabaseAnonKey,
      Authorization: `Bearer ${token}`,
    },
    cache: "no-store",
  });

  if (!response.ok) return null;
  return (await response.json()) as SupabaseUser;
}

async function fetchCompanyById(
  supabaseUrl: string,
  supabaseAnonKey: string,
  token: string,
  companyId: string
): Promise<CompanyRow | null> {
  const params = new URLSearchParams({
    select: "id,status,subscription_status",
    id: `eq.${companyId}`,
    limit: "1",
  });

  const response = await fetch(`${supabaseUrl}/rest/v1/companies?${params.toString()}`, {
    method: "GET",
    headers: {
      apikey: supabaseAnonKey,
      Authorization: `Bearer ${token}`,
    },
    cache: "no-store",
  });

  if (!response.ok) return null;
  const rows = (await response.json()) as CompanyRow[];
  return rows[0] || null;
}

async function fetchMembershipViaCompanyUsers(
  supabaseUrl: string,
  supabaseAnonKey: string,
  token: string,
  userId: string,
  email: string
): Promise<CompanyUserRow | null> {
  const params = new URLSearchParams({
    select: "company_id,role,status,user_id,user_email,created_at",
    status: "eq.active",
    order: "created_at.asc",
    limit: "20",
  });

  const escapedEmail = email.replace(/,/g, "");
  params.set("or", `(user_id.eq.${userId},user_email.eq.${escapedEmail})`);

  const response = await fetch(`${supabaseUrl}/rest/v1/company_users?${params.toString()}`, {
    method: "GET",
    headers: {
      apikey: supabaseAnonKey,
      Authorization: `Bearer ${token}`,
    },
    cache: "no-store",
  });

  if (!response.ok) return null;

  const rows = (await response.json()) as CompanyUserRow[];
  if (!Array.isArray(rows) || rows.length === 0) return null;

  const byUserId = rows.find((row) => (row.user_id || "") === userId);
  if (byUserId) return byUserId;

  const byEmail = rows.find(
    (row) => normalizeEmail(row.user_email) === normalizeEmail(email)
  );
  return byEmail || null;
}

async function fetchMembershipViaRpc(
  supabaseUrl: string,
  supabaseAnonKey: string,
  token: string
): Promise<RpcAccessRow | null> {
  const response = await fetch(`${supabaseUrl}/rest/v1/rpc/vyron_get_company_access`, {
    method: "POST",
    headers: {
      apikey: supabaseAnonKey,
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: "{}",
    cache: "no-store",
  });

  if (!response.ok) return null;

  const data = (await response.json()) as RpcAccessRow[] | RpcAccessRow;
  if (Array.isArray(data)) return data[0] || null;
  return data || null;
}

export async function resolveServerAuthorizationContext(
  token: string
): Promise<ServerAuthorizationContext> {
  const supabaseUrl = (process.env.NEXT_PUBLIC_SUPABASE_URL || "").trim();
  const supabaseAnonKey = (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "").trim();
  if (!supabaseUrl || !supabaseAnonKey || !token) {
    return {
      authenticated: false,
      userId: null,
      email: null,
      role: null,
      companyId: null,
      membershipActive: false,
      companyActive: false,
      workspaceActive: false,
    };
  }

  try {
    const user = await fetchSupabaseUser(supabaseUrl, supabaseAnonKey, token);
    if (!user?.id) {
      return {
        authenticated: false,
        userId: null,
        email: null,
        role: null,
        companyId: null,
        membershipActive: false,
        companyActive: false,
        workspaceActive: false,
      };
    }

    const userId = user.id;
    const email = normalizeEmail(user.email);
    const denied = baseDeniedContext(userId, email || null);

    const membership = await fetchMembershipViaCompanyUsers(
      supabaseUrl,
      supabaseAnonKey,
      token,
      userId,
      email
    );

    if (membership?.company_id) {
      const company = await fetchCompanyById(
        supabaseUrl,
        supabaseAnonKey,
        token,
        membership.company_id
      );

      const role = normalizeRbacRole(membership.role || "employee");
      const membershipActive = normalizeStatus(membership.status || "active") === "active";
      const companyStatus = normalizeStatus(company?.status);
      const workspaceStatus = normalizeStatus(company?.subscription_status);
      const companyActive = ACTIVE_COMPANY_STATUSES.has(companyStatus);
      const workspaceActive = ACTIVE_WORKSPACE_STATUSES.has(workspaceStatus);

      return {
        authenticated: true,
        userId,
        email: email || null,
        role,
        companyId: membership.company_id,
        membershipActive,
        companyActive,
        workspaceActive,
      };
    }

    const rpc = await fetchMembershipViaRpc(supabaseUrl, supabaseAnonKey, token);
    if (!rpc?.company_id) return denied;

    const company = await fetchCompanyById(
      supabaseUrl,
      supabaseAnonKey,
      token,
      rpc.company_id
    );
    const role = normalizeRbacRole(rpc.user_role || "employee");
    const membershipActive = normalizeStatus(rpc.user_status || "active") === "active";
    const companyStatus = normalizeStatus(company?.status);
    const workspaceStatus = normalizeStatus(
      company?.subscription_status || rpc.subscription_status || "active"
    );
    const companyActive = ACTIVE_COMPANY_STATUSES.has(companyStatus);
    const workspaceActive =
      ACTIVE_WORKSPACE_STATUSES.has(workspaceStatus) && rpc.subscription_locked !== true;

    return {
      authenticated: true,
      userId,
      email: email || null,
      role,
      companyId: rpc.company_id,
      membershipActive,
      companyActive,
      workspaceActive,
    };
  } catch {
    return {
      authenticated: false,
      userId: null,
      email: null,
      role: null,
      companyId: null,
      membershipActive: false,
      companyActive: false,
      workspaceActive: false,
    };
  }
}
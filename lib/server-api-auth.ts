import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getAvailableCompanies, isVyronMasterOperator } from "@/lib/company-access";

export type AuthenticatedApiContext =
  | { ok: true; supabase: SupabaseClient; email: string }
  | { ok: false; status: number; message: string };

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

/** Service-role (or anon fallback) client for server routes — lazy; safe at build time. */
export function getSupabaseAdminClient(): SupabaseClient {
  const url = stripEnvQuotes(process.env.NEXT_PUBLIC_SUPABASE_URL || "");
  const key = stripEnvQuotes(
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
      ""
  );
  if (!url) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL is required.");
  }
  if (!key) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY or NEXT_PUBLIC_SUPABASE_ANON_KEY is required."
    );
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** Bearer JWT session → Supabase client scoped to the signed-in user (RLS). */
export async function authenticateApiRequest(
  authorizationHeader: string | null
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

  return { ok: true, supabase, email: data.user.email.trim().toLowerCase() };
}

export async function assertCompanyWorkspaceAccess(
  supabase: SupabaseClient,
  email: string,
  companyId: string
): Promise<{ ok: true } | { ok: false; status: number; message: string }> {
  const normalizedId = (companyId || "").trim();
  if (!normalizedId) {
    return { ok: false, status: 400, message: "companyId is required." };
  }

  if (isVyronMasterOperator("", email)) {
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

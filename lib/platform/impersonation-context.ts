import type { NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";

/** Set by POST /api/platform/support/impersonate; cleared on DELETE. */
export const IMPERSONATION_COOKIE = "vyron_impersonation_session";

export type ActiveImpersonation = {
  sessionToken: string;
  companyId: string;
  companyName: string;
  operatorEmail: string;
  startedAt: string;
};

/** Shared lookup used by both the API-route path (token from the request cookie)
 * and the server-component path (token read via next/headers cookies()). */
export async function getActiveImpersonationByToken(
  sessionToken: string,
  supabase: SupabaseClient
): Promise<ActiveImpersonation | null> {
  if (!sessionToken) return null;

  const { data } = await supabase
    .from("platform_impersonation_sessions")
    .select("session_token,operator_email,started_at,company_id,companies(name)")
    .eq("session_token", sessionToken)
    .eq("status", "active")
    .maybeSingle();

  if (!data) return null;

  const company = data.companies as { name?: string } | { name?: string }[] | null;
  const companyName = Array.isArray(company) ? company[0]?.name : company?.name;

  return {
    sessionToken: data.session_token,
    companyId: data.company_id,
    companyName: companyName || "Customer",
    operatorEmail: data.operator_email,
    startedAt: data.started_at,
  };
}

/** Every app/api/platform/* request goes through requirePlatformOperator (_shared.ts),
 * which calls this so every handler can see whether the operator is currently
 * impersonating a customer — satisfies "every API request must know". */
export async function getActiveImpersonation(
  request: NextRequest,
  supabase: SupabaseClient
): Promise<ActiveImpersonation | null> {
  const sessionToken = request.cookies.get(IMPERSONATION_COOKIE)?.value || "";
  return getActiveImpersonationByToken(sessionToken, supabase);
}

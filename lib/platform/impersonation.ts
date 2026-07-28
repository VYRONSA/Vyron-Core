import type { SupabaseClient } from "@supabase/supabase-js";
import { writeAuditLog } from "@/lib/audit-log";

/**
 * "Impersonation" here means a Platform Operator's own already-privileged session
 * (role: "platform_operator", full access per lib/server/auth-routing.ts) is scoped
 * to view one customer's workspace — it never mints or assumes the customer's own
 * identity/token. This is the safer of the two designs (no real credential/session
 * spoofing) while still satisfying "every impersonation session must be logged."
 */
export async function startImpersonationSession(
  supabase: SupabaseClient,
  params: { operatorEmail: string; companyId: string }
): Promise<{ ok: true; sessionToken: string } | { ok: false; message: string }> {
  const sessionToken = crypto.randomUUID();

  const { error } = await supabase.from("platform_impersonation_sessions").insert({
    session_token: sessionToken,
    operator_email: params.operatorEmail,
    company_id: params.companyId,
    status: "active",
  });

  if (error) return { ok: false, message: error.message };

  await writeAuditLog(supabase, {
    companyId: params.companyId,
    userEmail: params.operatorEmail,
    action: "login_as_client",
    entityType: "platform_impersonation",
    entityId: sessionToken,
    metadata: { companyId: params.companyId },
  });

  return { ok: true, sessionToken };
}

export async function endImpersonationSession(
  supabase: SupabaseClient,
  params: { operatorEmail: string; sessionToken: string }
): Promise<{ ok: true } | { ok: false; message: string }> {
  const { data, error } = await supabase
    .from("platform_impersonation_sessions")
    .update({ status: "ended", ended_at: new Date().toISOString() })
    .eq("session_token", params.sessionToken)
    .eq("status", "active")
    .select("company_id")
    .maybeSingle();

  if (error) return { ok: false, message: error.message };

  if (data?.company_id) {
    await writeAuditLog(supabase, {
      companyId: data.company_id,
      userEmail: params.operatorEmail,
      action: "exit_client_mode",
      entityType: "platform_impersonation",
      entityId: params.sessionToken,
      metadata: {},
    });
  }

  return { ok: true };
}

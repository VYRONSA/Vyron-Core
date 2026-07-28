import type { SupabaseClient } from "@supabase/supabase-js";
import { isSupabaseMissingTableError, shouldSuppressWorkspaceLoadError } from "@/lib/company-access";

export const AUDIT_ACTIONS = [
  "create",
  "update",
  "delete",
  "archive",
  "restore",
  "approve",
  "reject",
  "login_as_client",
  "exit_client_mode",
  "force_logout",
  "suspend",
  "reactivate",
  "cancel",
  "maintenance_enable",
  "maintenance_disable",
  "maintenance_override_used",
  "maintenance_override_failed",
  "platform_bootstrap",
  "platform_bootstrap_blocked",
  // Privilege elevation ("Platform Mode") — see lib/platform/elevation.ts.
  "platform_elevation_granted",
  "platform_elevation_denied",
  "platform_elevation_locked",
  "platform_elevation_exited",
  "platform_elevation_revoked",
  "platform_lockdown",
] as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[number];

export type WriteAuditLogInput = {
  companyId?: string | null;
  userEmail: string;
  action: AuditAction;
  entityType: string;
  entityId?: string | null;
  metadata?: Record<string, unknown> | null;
};

export type AuditLogRow = {
  id: string;
  company_id: string | null;
  user_email: string;
  action: string;
  entity_type: string;
  entity_id: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
};

export async function writeAuditLog(
  supabase: SupabaseClient,
  input: WriteAuditLogInput
): Promise<{ ok: boolean; error: string | null }> {
  const row = {
    company_id: input.companyId || null,
    user_email: input.userEmail.trim().toLowerCase(),
    action: input.action,
    entity_type: input.entityType,
    entity_id: input.entityId || null,
    metadata: input.metadata || null,
  };

  const { error } = await supabase.from("vyron_audit_log").insert(row);

  if (!error) return { ok: true, error: null };
  if (
    isSupabaseMissingTableError(error, "vyron_audit_log") ||
    shouldSuppressWorkspaceLoadError(error)
  ) {
    return { ok: false, error: null };
  }
  return { ok: false, error: error.message };
}

export async function fetchAuditLogForCompany(
  supabase: SupabaseClient,
  companyId: string,
  limit = 100
): Promise<{ rows: AuditLogRow[]; error: string | null }> {
  if (!companyId) return { rows: [], error: null };

  const { data, error } = await supabase
    .from("vyron_audit_log")
    .select("id,company_id,user_email,action,entity_type,entity_id,metadata,created_at")
    .eq("company_id", companyId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    if (
      isSupabaseMissingTableError(error, "vyron_audit_log") ||
      shouldSuppressWorkspaceLoadError(error)
    ) {
      return { rows: [], error: null };
    }
    return { rows: [], error: error.message };
  }

  return { rows: (data || []) as AuditLogRow[], error: null };
}

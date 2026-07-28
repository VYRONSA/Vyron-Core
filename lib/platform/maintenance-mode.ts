function stripEnvQuotes(value: string): string {
  const t = value.trim();
  if (t.length >= 2 && ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'")))) {
    return t.slice(1, -1).trim();
  }
  return t;
}

/** Set by POST /api/platform/maintenance-override after a valid emergency code;
 * checked by middleware.ts to skip the maintenance redirect. */
export const MAINTENANCE_BYPASS_COOKIE = "vyron_maintenance_bypass";

export type MaintenanceModeStatus = {
  enabled: boolean;
  message: string;
  expectedReturnAt: string | null;
};

const DISABLED_STATUS: MaintenanceModeStatus = { enabled: false, message: "", expectedReturnAt: null };

/** Reads maintenance status via a narrow SECURITY DEFINER RPC (sql/064) — safe to
 * call with the anon key since it only ever returns {enabled, message, expected_return_at}. */
export async function getMaintenanceMode(): Promise<MaintenanceModeStatus> {
  const supabaseUrl = stripEnvQuotes(process.env.NEXT_PUBLIC_SUPABASE_URL || "");
  const anonKey = stripEnvQuotes(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "");
  if (!supabaseUrl || !anonKey) return DISABLED_STATUS;

  try {
    const response = await fetch(`${supabaseUrl}/rest/v1/rpc/vyron_get_maintenance_mode`, {
      method: "POST",
      headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}`, "Content-Type": "application/json" },
      body: "{}",
      cache: "no-store",
    });
    if (!response.ok) return DISABLED_STATUS;
    const data = (await response.json()) as { enabled?: boolean; message?: string; expected_return_at?: string | null };
    return {
      enabled: Boolean(data.enabled),
      message: data.message || "",
      expectedReturnAt: data.expected_return_at || null,
    };
  } catch {
    return DISABLED_STATUS;
  }
}

/** Validates an emergency override code against the stored value without ever
 * exposing the code itself (sql/064 vyron_validate_maintenance_override). */
export async function validateMaintenanceOverride(code: string): Promise<boolean> {
  if (!code) return false;
  const supabaseUrl = stripEnvQuotes(process.env.NEXT_PUBLIC_SUPABASE_URL || "");
  const anonKey = stripEnvQuotes(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "");
  if (!supabaseUrl || !anonKey) return false;

  try {
    const response = await fetch(`${supabaseUrl}/rest/v1/rpc/vyron_validate_maintenance_override`, {
      method: "POST",
      headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ p_code: code }),
      cache: "no-store",
    });
    if (!response.ok) return false;
    return (await response.json()) === true;
  } catch {
    return false;
  }
}

/** Records every override attempt (success and failure) so emergency bypass
 * usage is never silent (sql/065 vyron_log_maintenance_override_attempt).
 * Best-effort: never throws, since a logging failure must not block the
 * redirect the user is waiting on. */
export async function logMaintenanceOverrideAttempt(success: boolean): Promise<void> {
  const supabaseUrl = stripEnvQuotes(process.env.NEXT_PUBLIC_SUPABASE_URL || "");
  const anonKey = stripEnvQuotes(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "");
  if (!supabaseUrl || !anonKey) return;

  try {
    await fetch(`${supabaseUrl}/rest/v1/rpc/vyron_log_maintenance_override_attempt`, {
      method: "POST",
      headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ p_success: success }),
      cache: "no-store",
    });
  } catch {
    // best-effort — swallow
  }
}

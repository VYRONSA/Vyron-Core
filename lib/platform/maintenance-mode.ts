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

/*
 * The bypass cookie is a signed, expiring token ("<expiresAtMs>.<hmac>"), not a constant:
 * a fixed value could be set by anyone in their own browser. The HMAC key is derived from
 * the server-side Supabase secret, so no extra environment variable is required and the
 * value cannot be forged without server secrets. Web Crypto works in middleware and routes.
 */
const BYPASS_SIGNING_LABEL = "umora-maintenance-bypass-v1";

function bypassSigningSecret(): string {
  return stripEnvQuotes(process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY || "");
}

function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function signBypassPayload(payload: string): Promise<string | null> {
  const secret = bypassSigningSecret();
  if (!secret) return null;
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(`${BYPASS_SIGNING_LABEL}:${secret}`),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  return toHex(await crypto.subtle.sign("HMAC", key, encoder.encode(payload)));
}

/** Cookie value for a valid emergency override, or null when signing is unavailable. */
export async function createMaintenanceBypassToken(ttlSeconds: number): Promise<string | null> {
  const expiresAt = String(Date.now() + ttlSeconds * 1000);
  const signature = await signBypassPayload(expiresAt);
  return signature ? `${expiresAt}.${signature}` : null;
}

/** True only for an unexpired token signed by this server. */
export async function verifyMaintenanceBypassToken(value: string | null | undefined): Promise<boolean> {
  if (!value) return false;
  const [expiresAt, signature] = value.split(".");
  if (!expiresAt || !signature || !/^\d+$/.test(expiresAt)) return false;
  if (Number(expiresAt) < Date.now()) return false;
  const expected = await signBypassPayload(expiresAt);
  if (!expected || expected.length !== signature.length) return false;
  let diff = 0;
  for (let index = 0; index < expected.length; index += 1) {
    diff |= expected.charCodeAt(index) ^ signature.charCodeAt(index);
  }
  return diff === 0;
}

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

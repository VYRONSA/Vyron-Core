/**
 * Server-side registry for Platform Mode sessions (sql/067).
 *
 * The signed cookie in lib/platform/elevation.ts is still the credential and is still
 * what proves identity, binding and expiry. This module adds the one capability a
 * stateless cookie cannot provide: revocation — listing live sessions, terminating
 * one, and emergency lockdown.
 *
 * Graceful degradation: sql/067 may not be installed yet. When the table is missing,
 * `available: false` is reported so callers can say so out loud. Revocation checks then
 * fall back to "not revoked", which is exactly the behaviour before this table existed
 * — no regression — while the management endpoints refuse with a clear "run sql/067"
 * message rather than pretending a lockdown succeeded.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { isSupabaseMissingTableError } from "@/lib/company-access";

export const ELEVATION_SESSIONS_TABLE = "vyron_platform_elevation_sessions";

export const REGISTRY_MISSING_MESSAGE =
  "Platform session registry is not installed. Run sql/067-platform-elevation-sessions.sql in the Supabase SQL editor.";

export type ElevationSessionRow = {
  jti: string;
  operator_email: string;
  ip: string | null;
  user_agent: string | null;
  issued_at: string;
  expires_at: string;
  revoked_at: string | null;
  revoked_by: string | null;
  revoke_reason: string | null;
};

export type ActiveElevationSession = {
  jti: string;
  operatorEmail: string;
  ip: string | null;
  userAgent: string | null;
  issuedAt: string;
  expiresAt: string;
  secondsRemaining: number;
};

function missing(error: { code?: string; message?: string } | null | undefined): boolean {
  return isSupabaseMissingTableError(error, ELEVATION_SESSIONS_TABLE);
}

/** Records a newly granted elevation. Best-effort: a registry write must never block
 * an otherwise valid elevation, since the cookie alone is what authorises. */
export async function registerElevationSession(
  supabase: SupabaseClient,
  input: {
    jti: string;
    operatorEmail: string;
    ip: string;
    userAgent: string;
    issuedAt: Date;
    expiresAt: Date;
  }
): Promise<{ available: boolean }> {
  const { error } = await supabase.from(ELEVATION_SESSIONS_TABLE).insert({
    jti: input.jti,
    operator_email: input.operatorEmail,
    ip: input.ip,
    user_agent: input.userAgent,
    issued_at: input.issuedAt.toISOString(),
    expires_at: input.expiresAt.toISOString(),
  });

  if (error) return { available: !missing(error) };
  return { available: true };
}

/**
 * Revocation check performed on every elevated request, on top of the unchanged
 * signature/expiry/binding checks.
 *
 * Fails OPEN when the table is absent — that is the pre-sql/067 behaviour, so an
 * uninstalled migration cannot lock operators out. It is safe precisely because the
 * lockdown/terminate endpoints refuse loudly in the same situation, so revocation is
 * never silently believed to be working.
 */
export async function isElevationRevoked(
  supabase: SupabaseClient,
  jti: string
): Promise<{ revoked: boolean; available: boolean }> {
  if (!jti) return { revoked: false, available: true };

  const { data, error } = await supabase
    .from(ELEVATION_SESSIONS_TABLE)
    .select("revoked_at")
    .eq("jti", jti)
    .maybeSingle();

  if (error) return { revoked: false, available: !missing(error) };
  // An unknown jti is treated as live: sessions issued before sql/067 was installed
  // have no row, and must not be invalidated retroactively.
  if (!data) return { revoked: false, available: true };

  return { revoked: Boolean(data.revoked_at), available: true };
}

export async function listActiveElevationSessions(
  supabase: SupabaseClient
): Promise<
  { ok: true; sessions: ActiveElevationSession[] } | { ok: false; available: false; message: string }
> {
  const { data, error } = await supabase
    .from(ELEVATION_SESSIONS_TABLE)
    .select("jti,operator_email,ip,user_agent,issued_at,expires_at,revoked_at")
    .is("revoked_at", null)
    .gt("expires_at", new Date().toISOString())
    .order("issued_at", { ascending: false })
    .limit(100);

  if (error) {
    if (missing(error)) return { ok: false, available: false, message: REGISTRY_MISSING_MESSAGE };
    return { ok: false, available: false, message: error.message };
  }

  const now = Date.now();
  const sessions = ((data || []) as ElevationSessionRow[]).map((row) => ({
    jti: row.jti,
    operatorEmail: row.operator_email,
    ip: row.ip,
    userAgent: row.user_agent,
    issuedAt: row.issued_at,
    expiresAt: row.expires_at,
    secondsRemaining: Math.max(0, Math.floor((new Date(row.expires_at).getTime() - now) / 1000)),
  }));

  return { ok: true, sessions };
}

export async function revokeElevationSession(
  supabase: SupabaseClient,
  input: { jti: string; revokedBy: string; reason: string }
): Promise<{ ok: true; revoked: boolean } | { ok: false; available: boolean; message: string }> {
  const { data, error } = await supabase
    .from(ELEVATION_SESSIONS_TABLE)
    .update({
      revoked_at: new Date().toISOString(),
      revoked_by: input.revokedBy,
      revoke_reason: input.reason,
    })
    .eq("jti", input.jti)
    .is("revoked_at", null)
    .select("jti");

  if (error) {
    if (missing(error)) return { ok: false, available: false, message: REGISTRY_MISSING_MESSAGE };
    return { ok: false, available: true, message: error.message };
  }

  return { ok: true, revoked: (data || []).length > 0 };
}

/**
 * Emergency lockdown — revoke every live elevated session.
 *
 * Scoped strictly to Platform Mode. Ordinary application logins (auth.users sessions
 * and vyron_user_sessions) are deliberately untouched: operators and tenant users stay
 * signed in, they simply lose privileged platform access until they re-verify.
 */
export async function revokeAllElevationSessions(
  supabase: SupabaseClient,
  input: { revokedBy: string; reason: string }
): Promise<{ ok: true; revokedCount: number } | { ok: false; available: boolean; message: string }> {
  const { data, error } = await supabase
    .from(ELEVATION_SESSIONS_TABLE)
    .update({
      revoked_at: new Date().toISOString(),
      revoked_by: input.revokedBy,
      revoke_reason: input.reason,
    })
    .is("revoked_at", null)
    .gt("expires_at", new Date().toISOString())
    .select("jti");

  if (error) {
    if (missing(error)) return { ok: false, available: false, message: REGISTRY_MISSING_MESSAGE };
    return { ok: false, available: true, message: error.message };
  }

  return { ok: true, revokedCount: (data || []).length };
}

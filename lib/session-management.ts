import type { SupabaseClient } from "@supabase/supabase-js";
import { isSupabaseMissingTableError, shouldSuppressWorkspaceLoadError } from "@/lib/company-access";
import { VYRON_SESSION_TOKEN_COOKIE } from "@/lib/server/auth-routing";
import { setVyronCookie, clearVyronCookie } from "@/app/_app-shell-session";

export type UserSessionRow = {
  id: string;
  user_email: string;
  company_id: string | null;
  session_token: string;
  user_agent: string | null;
  ip_address: string | null;
  last_seen_at: string;
  expires_at: string | null;
  revoked_at: string | null;
  created_at: string;
};

const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 14; // 14 days

function sessionStorageKey(email: string): string {
  return `vyron_session_token_${email.trim().toLowerCase()}`;
}

export function readLocalSessionToken(email: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(sessionStorageKey(email));
  } catch {
    return null;
  }
}

export function writeLocalSessionToken(email: string, token: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(sessionStorageKey(email), token);
  } catch {
    /* ignore */
  }
  // Also carried as a cookie so the server (middleware.ts, lib/server-api-auth.ts) can
  // validate revocation/idle/absolute timeout on every request — see
  // lib/server/session-validation.ts.
  setVyronCookie(VYRON_SESSION_TOKEN_COOKIE, token, Math.floor(SESSION_TTL_MS / 1000));
}

export function clearLocalSessionToken(email: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(sessionStorageKey(email));
  } catch {
    /* ignore */
  }
  clearVyronCookie(VYRON_SESSION_TOKEN_COOKIE);
}

function generateSessionToken(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `sess_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

export async function registerUserSession(
  supabase: SupabaseClient,
  params: {
    userEmail: string;
    companyId?: string | null;
    userAgent?: string | null;
    ipAddress?: string | null;
  }
): Promise<{ token: string | null; error: string | null }> {
  const email = params.userEmail.trim().toLowerCase();
  const token = readLocalSessionToken(email) || generateSessionToken();
  writeLocalSessionToken(email, token);

  const now = new Date();
  const expiresAt = new Date(now.getTime() + SESSION_TTL_MS).toISOString();

  const { error } = await supabase.from("vyron_user_sessions").upsert(
    {
      user_email: email,
      company_id: params.companyId || null,
      session_token: token,
      user_agent: params.userAgent || null,
      ip_address: params.ipAddress || null,
      last_seen_at: now.toISOString(),
      expires_at: expiresAt,
      revoked_at: null,
    },
    { onConflict: "session_token" }
  );

  if (!error) {
    await supabase
      .from("company_users")
      .update({ last_login_at: now.toISOString() })
      .eq("user_email", email);
    return { token, error: null };
  }

  if (
    isSupabaseMissingTableError(error, "vyron_user_sessions") ||
    shouldSuppressWorkspaceLoadError(error)
  ) {
    return { token, error: null };
  }

  return { token: null, error: error.message };
}

export async function fetchActiveSessionsForCompany(
  supabase: SupabaseClient,
  companyId: string
): Promise<{ rows: UserSessionRow[]; error: string | null }> {
  if (!companyId) return { rows: [], error: null };

  const { data, error } = await supabase
    .from("vyron_user_sessions")
    .select("*")
    .eq("company_id", companyId)
    .is("revoked_at", null)
    .order("last_seen_at", { ascending: false })
    .limit(50);

  if (error) {
    if (
      isSupabaseMissingTableError(error, "vyron_user_sessions") ||
      shouldSuppressWorkspaceLoadError(error)
    ) {
      return { rows: [], error: null };
    }
    return { rows: [], error: error.message };
  }

  return { rows: (data || []) as UserSessionRow[], error: null };
}

export async function revokeUserSession(
  supabase: SupabaseClient,
  sessionToken: string
): Promise<{ ok: boolean; error: string | null }> {
  const { error } = await supabase
    .from("vyron_user_sessions")
    .update({ revoked_at: new Date().toISOString() })
    .eq("session_token", sessionToken);

  if (!error) return { ok: true, error: null };
  if (
    isSupabaseMissingTableError(error, "vyron_user_sessions") ||
    shouldSuppressWorkspaceLoadError(error)
  ) {
    return { ok: false, error: null };
  }
  return { ok: false, error: error.message };
}

export async function touchUserSession(
  supabase: SupabaseClient,
  sessionToken: string
): Promise<void> {
  await supabase
    .from("vyron_user_sessions")
    .update({ last_seen_at: new Date().toISOString() })
    .eq("session_token", sessionToken)
    .is("revoked_at", null);
}

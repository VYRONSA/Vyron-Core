/**
 * Client-side storage helpers.
 *
 * Authentication is deliberately absent from this file. The Supabase session lives in
 * the auth cookies managed by @supabase/ssr (see lib/supabase.ts) and is the only
 * session store in the app. The cookie helpers below remain solely for the tracked
 * session-token cookie (vyron_session_id), which identifies a row in
 * vyron_user_sessions for Force Logout / idle timeout — it is not a credential and
 * grants nothing on its own.
 */

/** URL query key for invitation-only signup (also accepts legacy `token`). */
export const VYRON_INVITE_URL_PARAM = "invite";
export const VYRON_PENDING_INVITES_STORAGE_KEY = "vyron-pending-invites";
export const VYRON_CLIENT_DIRECTORY_STORAGE_KEY = "vyron-master-client-directory";
export const VYRON_CLIENT_RECOMMENDATIONS_STORAGE_KEY = "vyron-master-client-recommendations";

function secureCookieSuffix(): string {
  return typeof location !== "undefined" && location.protocol === "https:" ? "; Secure" : "";
}

export function setVyronCookie(name: string, value: string, maxAgeSeconds: number) {
  if (typeof document === "undefined") return;
  document.cookie = `${name}=${encodeURIComponent(value)}; Path=/; Max-Age=${maxAgeSeconds}; SameSite=Lax${secureCookieSuffix()}`;
}

export function clearVyronCookie(name: string) {
  if (typeof document === "undefined") return;
  document.cookie = `${name}=; Path=/; Max-Age=0; SameSite=Lax${secureCookieSuffix()}`;
}

const VYRON_LOGOUT_SESSION_STORAGE_KEYS = [VYRON_PENDING_INVITES_STORAGE_KEY] as const;

export function clearVyronSessionLocalStorage(): readonly string[] {
  if (typeof window === "undefined") return [];
  for (const key of VYRON_LOGOUT_SESSION_STORAGE_KEYS) {
    try {
      window.localStorage.removeItem(key);
    } catch {
      /* ignore quota / privacy mode */
    }
  }
  return VYRON_LOGOUT_SESSION_STORAGE_KEYS;
}

/** UMORA "Logout / Exit Workspace" control: white outline pill, red hover. Identifier kept for existing imports. */
export const VYRON_PREMIUM_LOGOUT_BUTTON_CLASS =
  "inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-800 shadow-sm transition hover:-translate-y-0.5 hover:border-red-200 hover:bg-red-50 hover:text-red-700 active:translate-y-0 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-500";

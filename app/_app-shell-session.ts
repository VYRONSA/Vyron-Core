import {
  VYRON_AUTH_COOKIE,
  VYRON_ROLE_COOKIE,
  normalizeRbacRole,
} from "@/lib/server/auth-routing";

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

export function syncVyronAuthCookies(sessionEmail: string | null, accessToken: string | null) {
  if (!sessionEmail || !accessToken) {
    clearVyronCookie(VYRON_AUTH_COOKIE);
    return;
  }
  setVyronCookie(VYRON_AUTH_COOKIE, accessToken, 60 * 60 * 8);
}

export function syncVyronRoleCookie(inputRole: string | null | undefined) {
  const normalized = normalizeRbacRole(inputRole);
  setVyronCookie(VYRON_ROLE_COOKIE, normalized, 60 * 60 * 8);
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

/** High-contrast dashboard logout (charcoal pill, red hover — matches rounded VYRON shell). */
export const VYRON_PREMIUM_LOGOUT_BUTTON_CLASS =
  "rounded-full bg-[#292524] px-5 py-2.5 text-sm font-semibold text-white shadow-md shadow-black/20 transition hover:-translate-y-0.5 hover:bg-red-600 hover:shadow-lg hover:shadow-red-950/35 active:translate-y-0 active:shadow-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-300";

export { VYRON_AUTH_COOKIE, VYRON_ROLE_COOKIE };

/**
 * Session security (Phase 1C) — a single, framework-agnostic place to decide whether a
 * tracked vyron_user_sessions row is still valid (not revoked, not idle-timed-out, not
 * past its absolute lifetime). Both middleware.ts (page routes, via
 * lib/server/authorization.ts) and lib/server-api-auth.ts (API routes) fetch the session
 * row through their own existing, already-established mechanisms (raw PostgREST fetch vs
 * supabase-js) and then call the same evaluateSessionValidity() here, so the actual
 * validity rule is defined exactly once.
 */

export const DEFAULT_SESSION_IDLE_TIMEOUT_MINUTES = 30;
export const DEFAULT_SESSION_ABSOLUTE_TIMEOUT_MINUTES = 720; // 12 hours

/** Must match the CHECK constraints added in sql/061-session-security-hardening.sql. */
export const MIN_SESSION_IDLE_TIMEOUT_MINUTES = 5;
export const MAX_SESSION_IDLE_TIMEOUT_MINUTES = 480; // 8 hours
export const MIN_SESSION_ABSOLUTE_TIMEOUT_MINUTES = 30;
export const MAX_SESSION_ABSOLUTE_TIMEOUT_MINUTES = 20160; // 14 days

/** How long before the idle timeout the client should warn the user (Task 2). */
export const SESSION_TIMEOUT_WARNING_SECONDS = 120;

export type SessionRow = {
  session_token: string;
  revoked_at: string | null;
  last_seen_at: string | null;
  created_at: string | null;
  company_id: string | null;
};

export type CompanyTimeoutConfig = {
  session_idle_timeout_minutes?: number | null;
  session_absolute_timeout_minutes?: number | null;
};

export type SessionValidityResult =
  | {
      valid: true;
      idleTimeoutMinutes: number;
      absoluteTimeoutMinutes: number;
      secondsUntilIdleTimeout: number;
      secondsUntilAbsoluteTimeout: number;
    }
  | { valid: false; reason: "revoked" | "idle_timeout" | "absolute_timeout" };

/** Company-configured minutes, clamped to safe bounds; falls back to safe defaults when unset/invalid. */
export function resolveSessionTimeoutMinutes(
  company: CompanyTimeoutConfig | null | undefined
): { idleMinutes: number; absoluteMinutes: number } {
  const idle = company?.session_idle_timeout_minutes;
  const absolute = company?.session_absolute_timeout_minutes;

  const idleMinutes =
    typeof idle === "number" &&
    Number.isFinite(idle) &&
    idle >= MIN_SESSION_IDLE_TIMEOUT_MINUTES &&
    idle <= MAX_SESSION_IDLE_TIMEOUT_MINUTES
      ? idle
      : DEFAULT_SESSION_IDLE_TIMEOUT_MINUTES;

  const absoluteMinutes =
    typeof absolute === "number" &&
    Number.isFinite(absolute) &&
    absolute >= MIN_SESSION_ABSOLUTE_TIMEOUT_MINUTES &&
    absolute <= MAX_SESSION_ABSOLUTE_TIMEOUT_MINUTES
      ? absolute
      : DEFAULT_SESSION_ABSOLUTE_TIMEOUT_MINUTES;

  return { idleMinutes, absoluteMinutes };
}

export function evaluateSessionValidity(
  session: SessionRow | null,
  company: CompanyTimeoutConfig | null | undefined,
  now: Date = new Date()
): SessionValidityResult {
  const { idleMinutes, absoluteMinutes } = resolveSessionTimeoutMinutes(company);

  // No tracked row yet is treated as valid, not rejected: the session-token cookie is
  // written during the post-login dashboard bootstrap (registerUserSession), slightly
  // after the auth cookie itself, and a brand-new company/session may not have a row on
  // the very first request either. Force Logout and idle/absolute timeout only ever need
  // to reject a row that DOES exist and is explicitly bad (revoked, or past a deadline) —
  // failing closed on "no row yet" would only create a login race condition without
  // adding real protection, since there is nothing yet to have been compromised.
  if (!session) {
    return {
      valid: true,
      idleTimeoutMinutes: idleMinutes,
      absoluteTimeoutMinutes: absoluteMinutes,
      secondsUntilIdleTimeout: idleMinutes * 60,
      secondsUntilAbsoluteTimeout: absoluteMinutes * 60,
    };
  }
  if (session.revoked_at) return { valid: false, reason: "revoked" };

  const lastSeenMs = session.last_seen_at ? new Date(session.last_seen_at).getTime() : null;
  const secondsUntilIdleTimeout =
    lastSeenMs !== null && Number.isFinite(lastSeenMs)
      ? idleMinutes * 60 - Math.floor((now.getTime() - lastSeenMs) / 1000)
      : idleMinutes * 60;
  if (secondsUntilIdleTimeout <= 0) {
    return { valid: false, reason: "idle_timeout" };
  }

  const createdAtMs = session.created_at ? new Date(session.created_at).getTime() : null;
  const secondsUntilAbsoluteTimeout =
    createdAtMs !== null && Number.isFinite(createdAtMs)
      ? absoluteMinutes * 60 - Math.floor((now.getTime() - createdAtMs) / 1000)
      : absoluteMinutes * 60;
  if (secondsUntilAbsoluteTimeout <= 0) {
    return { valid: false, reason: "absolute_timeout" };
  }

  return {
    valid: true,
    idleTimeoutMinutes: idleMinutes,
    absoluteTimeoutMinutes: absoluteMinutes,
    secondsUntilIdleTimeout,
    secondsUntilAbsoluteTimeout,
  };
}

-- 067-platform-elevation-sessions.sql
-- Server-side registry for Platform Mode (privilege elevation) sessions.
--
-- This does NOT change how elevation is granted or verified. The signed
-- vyron_platform_elevation cookie remains the credential: its HMAC signature,
-- operator binding and absolute expiry are still checked in
-- lib/platform/elevation.ts exactly as before.
--
-- What this adds is the one thing a stateless cookie cannot do — revocation:
--   * list currently active elevated sessions (operator, IP, browser, remaining time)
--   * terminate one session
--   * emergency lockdown: revoke every elevated session at once, without touching
--     ordinary application logins (those are auth.users / vyron_user_sessions and are
--     deliberately untouched here)
--
-- Verification therefore becomes: valid signature AND not expired AND not revoked.
-- The first two are unchanged; only the third is new.
--
-- Idempotent. Run after sql/066.

BEGIN;

CREATE TABLE IF NOT EXISTS public.vyron_platform_elevation_sessions (
  -- Matches the `jti` claim inside the signed elevation cookie.
  jti text PRIMARY KEY,
  operator_email text NOT NULL,
  ip text,
  user_agent text,
  issued_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  revoked_by text,
  revoke_reason text
);

COMMENT ON TABLE public.vyron_platform_elevation_sessions IS
  'Registry of Platform Mode (privilege elevation) sessions. Enables listing, single-session termination and emergency lockdown. The signed cookie remains the credential; this table only adds revocation.';

CREATE INDEX IF NOT EXISTS idx_platform_elevation_sessions_operator
  ON public.vyron_platform_elevation_sessions (operator_email);

-- Supports the "active sessions" query: not revoked and not yet expired.
CREATE INDEX IF NOT EXISTS idx_platform_elevation_sessions_active
  ON public.vyron_platform_elevation_sessions (expires_at)
  WHERE revoked_at IS NULL;

ALTER TABLE public.vyron_platform_elevation_sessions ENABLE ROW LEVEL SECURITY;

-- No policies on purpose: with RLS on and zero policies, anon and authenticated can
-- read and write nothing. Only the service role (which bypasses RLS) touches this
-- table, and only from server-side platform routes.
REVOKE ALL ON public.vyron_platform_elevation_sessions FROM PUBLIC;
REVOKE ALL ON public.vyron_platform_elevation_sessions FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.vyron_platform_elevation_sessions TO service_role;

COMMIT;

NOTIFY pgrst, 'reload schema';

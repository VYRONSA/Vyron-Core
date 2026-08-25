-- ============================================================================
-- sql/097-mobile-device-registrations.sql
--
-- GATE E — which physical devices a push notification may be sent to.
--
-- WHY A NEW TABLE IS UNAVOIDABLE
--
--   Nothing in the schema records a device. mobile_workforce_notifications
--   records WHAT to tell somebody and whether they have read it; it has no idea
--   which handset is in whose pocket. A push cannot be addressed without that,
--   so this is the one genuinely missing fact rather than a convenience.
--
-- HOW IDENTITY IS KEYED, AND WHY BY EMAIL
--
--   This codebase resolves a caller to a tenant by EMAIL, not by auth user id:
--   vyron_user_company_ids() matches lower(company_users.user_email) against
--   the JWT email, and employees are found with employees.email ILIKE the same.
--   There is no employees.user_id column. Keying this table the same way means
--   one identity model, not two that can disagree — and it lets the RLS policy
--   below be the exact shape already proven on rr_operation_receipts.
--
-- THE THING THIS TABLE MUST NEVER DO
--
--   A device token is a capability: whoever holds it can push to that handset.
--   So `authenticated` is granted NOTHING AT ALL. Registration, revocation and
--   sending are all service_role work behind an API route that has already
--   verified the session; the client supplies a token and is told "registered",
--   never anything it could read back.
--
--   An earlier draft of this file granted INSERT and UPDATE to `authenticated`
--   so the app could revoke its own row on logout. That does not work and the
--   attempt is instructive: revoking means UPDATE ... WHERE device_token = ?,
--   and filtering on a column requires SELECT on it. Granting enough privilege
--   to revoke a token is granting enough privilege to read one. The two cannot
--   be separated, so the whole operation belongs on the server.
--
-- SHARED DEVICES
--
--   A yard tablet passed between shifts is the dangerous case: the previous
--   employee's registration must stop receiving pushes the moment somebody else
--   signs in. The partial unique index below enforces "one ACTIVE claim per
--   token", so a handover is a revoke followed by an insert, and two people can
--   never simultaneously own the same handset.
--
-- Idempotent and transactional: safe to re-run, all-or-nothing.
-- Rollback: sql/097-rollback.sql
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.mobile_device_registrations (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,

  -- Resolved from the verified session, never from the request body.
  user_email    text NOT NULL,

  -- The employee record, when the signed-in user has one. Nullable because a
  -- controller signing in on a phone is a legitimate user without being an
  -- employee of the tenant.
  employee_id   uuid,

  platform      text NOT NULL,
  provider      text NOT NULL,

  -- The capability itself. Never returned to an employee session; see the
  -- grants at the foot of this file.
  device_token  text NOT NULL,

  -- A stable per-install identifier, so a reinstall can be told from a new
  -- phone. NOT a hardware serial: nothing here should be able to follow a
  -- person between employers.
  device_label  text,
  app_version   text,

  last_seen_at  timestamptz NOT NULL DEFAULT now(),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),

  -- Set on logout, on handover, or when the provider reports the token dead.
  -- Rows are revoked rather than deleted so an audit can answer "what was this
  -- phone allowed to receive, and until when".
  revoked_at    timestamptz,

  CONSTRAINT mobile_device_registrations_platform_check
    CHECK (platform IN ('android','ios','web')),
  CONSTRAINT mobile_device_registrations_provider_check
    CHECK (provider IN ('fcm','apns','webpush')),
  CONSTRAINT mobile_device_registrations_token_present
    CHECK (length(btrim(device_token)) > 0),
  CONSTRAINT mobile_device_registrations_email_present
    CHECK (length(btrim(user_email)) > 0)
);

-- ── One ACTIVE claim per physical device ────────────────────────────────────
-- The shared-tablet guarantee. A handover must revoke before it registers.
CREATE UNIQUE INDEX IF NOT EXISTS mobile_device_registrations_active_token
  ON public.mobile_device_registrations (provider, device_token)
  WHERE revoked_at IS NULL;

-- "Which devices do I push this notification to?" — the send path's only query.
CREATE INDEX IF NOT EXISTS mobile_device_registrations_active_recipient
  ON public.mobile_device_registrations (company_id, lower(user_email))
  WHERE revoked_at IS NULL;

-- Housekeeping: retiring devices nobody has carried for months.
CREATE INDEX IF NOT EXISTS mobile_device_registrations_last_seen
  ON public.mobile_device_registrations (company_id, last_seen_at DESC);

ALTER TABLE public.mobile_device_registrations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS mobile_device_registrations_own ON public.mobile_device_registrations;

-- Tenant isolation PLUS own-rows-only, the same shape as rr_operation_receipts.
--
-- `authenticated` is named explicitly rather than left to PUBLIC, so this policy
-- can never grant anon anything — the mistake sql/090 had to undo.
--
-- Platform operators may read for support, but the WITH CHECK deliberately omits
-- them: nobody, however privileged, may register a device in somebody else's
-- name.
CREATE POLICY mobile_device_registrations_own ON public.mobile_device_registrations
  FOR ALL
  TO authenticated
  USING (
    public.vyron_is_platform_operator()
    OR (
      company_id IN (SELECT public.vyron_user_company_ids())
      AND lower(user_email) = lower(auth.jwt() ->> 'email')
    )
  )
  WITH CHECK (
    company_id IN (SELECT public.vyron_user_company_ids())
    AND lower(user_email) = lower(auth.jwt() ->> 'email')
  );

-- ── Grants ──────────────────────────────────────────────────────────────────
--
-- Nothing for `authenticated`, nothing for `anon`. Every read and write goes
-- through service_role inside an API route that has already established who the
-- caller is. The RLS policy above is kept as defence in depth: if a future
-- change ever does grant a session access to this table, the policy already
-- confines it to that user's own rows in their own tenant.
-- Corrective, not just declarative: an earlier draft of this file granted
-- INSERT and UPDATE to `authenticated`, so a database that ran that draft must
-- have them taken away rather than merely not re-granted. GRANT is additive;
-- only REVOKE converges.
REVOKE ALL ON public.mobile_device_registrations FROM authenticated;
REVOKE ALL ON public.mobile_device_registrations FROM anon;

GRANT ALL ON public.mobile_device_registrations TO service_role;

COMMENT ON TABLE public.mobile_device_registrations IS
  'Physical devices a tenant user may receive push notifications on. Tokens are '
  'capabilities, so no authenticated session touches this table at all: register, '
  'revoke and send are service_role operations behind a session-verified API.';

COMMENT ON COLUMN public.mobile_device_registrations.revoked_at IS
  'Set on logout, device handover, or provider-reported dead token. Rows are '
  'revoked rather than deleted so the audit trail survives.';

COMMIT;

NOTIFY pgrst, 'reload schema';

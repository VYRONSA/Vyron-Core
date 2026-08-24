-- ============================================================================
-- sql/095-rr-operation-receipts.sql
--
-- GATE B — idempotency receipts for offline-queued Road & Recovery mutations.
--
-- THE FAILURE THIS EXISTS TO MAKE IMPOSSIBLE
--
--     driver taps Complete -> request sent -> network dies before the response
--                          -> queue retries -> the job completes TWICE:
--                             two state events, two billable legs, and an audit
--                             trail that says the driver did it twice.
--
-- rr_service_state_events is append-only by trigger (sql/083), so a duplicate
-- is not something that can be tidied up afterwards. It is permanent. The only
-- safe place for the uniqueness is the DATABASE: an application-level "have I
-- seen this id before?" check loses the race between two concurrent retries,
-- a unique index cannot lose it.
--
-- THE PROTOCOL every mutating route follows
--
--   1. INSERT the receipt ... ON CONFLICT (company_id, operation_id) DO NOTHING
--   2. 0 rows inserted -> this operation already ran (or is running).
--        - stored fingerprint matches   -> return the stored result verbatim
--        - stored fingerprint differs   -> 409 OPERATION_CONFLICT
--        Either way: DO NOT execute the mutation again.
--   3. 1 row inserted -> we own this operation. Execute it, then write the
--      outcome back so a later retry is answered from step 2.
--
-- The server receipt is authoritative. A client believing it has not yet run
-- an operation is never sufficient reason to execute one.
--
-- Idempotent and transactional: safe to re-run, all-or-nothing.
-- Rollback: sql/095-rollback.sql
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.rr_operation_receipts (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id          uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,

  -- Generated on the DEVICE before the first attempt and reused by every retry.
  -- Stamped at enqueue time, never at send time: a new id per attempt would
  -- defeat the entire mechanism.
  operation_id        uuid NOT NULL,

  operation_kind      text NOT NULL,
  service_job_id      uuid REFERENCES public.rr_service_jobs(id) ON DELETE SET NULL,

  -- Resolved server-side from the session at first execution, never from the body.
  actor_email         text NOT NULL,

  -- sha256 of the canonicalised request body. Guards the case a naive design
  -- misses: the same operation_id arriving with a DIFFERENT payload. That is a
  -- client bug or an attack, never a legitimate retry, and it must be refused
  -- rather than silently answered with someone else's result.
  request_fingerprint text NOT NULL,

  status              text NOT NULL DEFAULT 'in_progress',
  -- The response the first execution produced, replayed verbatim to retries.
  result              jsonb,
  error_message       text,

  created_at          timestamptz NOT NULL DEFAULT now(),
  completed_at        timestamptz,

  CONSTRAINT rr_operation_receipts_status
    CHECK (status IN ('in_progress','succeeded','failed')),
  CONSTRAINT rr_operation_receipts_kind
    CHECK (operation_kind IN (
      'transition','accept_assignment','decline_assignment',
      'capture_evidence','add_note','start_travel','arrive','complete'
    )),
  CONSTRAINT rr_operation_receipts_fingerprint
    CHECK (request_fingerprint ~ '^[0-9a-f]{64}$'),
  -- A terminal receipt is completed; an in-progress one is not. Keeps the
  -- staleness sweep honest.
  CONSTRAINT rr_operation_receipts_terminal_completed
    CHECK ((status = 'in_progress') = (completed_at IS NULL))
);

-- ── THE constraint. Everything else in this file supports it. ───────────────
-- Scoped by company so one tenant's operation id can neither collide with, nor
-- be probed for, another's.
CREATE UNIQUE INDEX IF NOT EXISTS rr_operation_receipts_idempotency_key
  ON public.rr_operation_receipts (company_id, operation_id);

-- Retention sweep: receipts are transient, not a record.
CREATE INDEX IF NOT EXISTS rr_operation_receipts_created_idx
  ON public.rr_operation_receipts (company_id, created_at);

-- Reconciling a device that was offline for a while.
CREATE INDEX IF NOT EXISTS rr_operation_receipts_job_idx
  ON public.rr_operation_receipts (company_id, service_job_id)
  WHERE service_job_id IS NOT NULL;

ALTER TABLE public.rr_operation_receipts ENABLE ROW LEVEL SECURITY;

-- Idempotent re-run: drop this migration's own policy before recreating it.
DROP POLICY IF EXISTS rr_operation_receipts_tenant ON public.rr_operation_receipts;

-- Tenant isolation, PLUS own-rows-only.
--
-- A receipt carries the result payload of a mutation, so a cross-user read
-- inside a tenant would leak operational detail the reader may not be entitled
-- to. `authenticated` is named explicitly rather than left to PUBLIC, so this
-- policy can never grant anon anything (the mistake sql/090 had to undo).
CREATE POLICY rr_operation_receipts_tenant ON public.rr_operation_receipts
  FOR ALL
  TO authenticated
  USING (
    public.vyron_is_platform_operator()
    OR (
      company_id IN (SELECT public.vyron_user_company_ids())
      AND lower(actor_email) = lower(auth.jwt() ->> 'email')
    )
  )
  WITH CHECK (
    company_id IN (SELECT public.vyron_user_company_ids())
    AND lower(actor_email) = lower(auth.jwt() ->> 'email')
  );

-- No DELETE for tenants: erasing a receipt would re-enable a duplicate
-- execution, which is the one thing this table exists to prevent. Cleanup is
-- service_role only. anon is granted nothing at all.
GRANT SELECT, INSERT, UPDATE ON public.rr_operation_receipts TO authenticated;
GRANT ALL ON public.rr_operation_receipts TO service_role;

COMMENT ON TABLE public.rr_operation_receipts IS
  'Idempotency receipts for offline-queued Road & Recovery mutations. The unique '
  '(company_id, operation_id) index is what makes a retry safe; the server receipt '
  'is authoritative over any client belief about what has already run.';

COMMENT ON COLUMN public.rr_operation_receipts.request_fingerprint IS
  'sha256 of the canonicalised request body. Same operation_id + different '
  'fingerprint is refused with 409 OPERATION_CONFLICT.';

COMMIT;

NOTIFY pgrst, 'reload schema';

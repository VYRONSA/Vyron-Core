-- 077-road-recovery-storage.sql
-- VYRON CORE — Road & Recovery Phase 4, Step 3: storage as a first-class operation.
--
-- ---------------------------------------------------------------------------
-- STORAGE IS NOT A DESTINATION FLAG
-- ---------------------------------------------------------------------------
--
-- A stored vehicle has a facility, a bay, a start, an end, a condition, a rate basis and
-- an accruing charge. None of that fits in "destination_type = 'storage_yard'", which only
-- ever said where a vehicle was headed.
--
-- ---------------------------------------------------------------------------
-- STORAGE IS NOT CUSTODY EITHER
-- ---------------------------------------------------------------------------
--
-- Checking a vehicle in produces TWO facts, recorded separately because they answer
-- different questions and are disputed separately:
--
--   custody (sql/076)  possession moved to the yard              — legal
--   booking (here)     the vehicle occupies a bay and is charged — commercial
--
-- A booking therefore REFERENCES the custody events that opened and closed it rather than
-- restating them.
--
-- ---------------------------------------------------------------------------
-- ACCRUAL FOLLOWS THE PHASE 2 STANDBY PATTERN
-- ---------------------------------------------------------------------------
--
--   pure calculator -> no clock read -> no I/O -> deterministic -> SEALED append-only
--
-- rr_storage_accrual is the frozen commercial fact billing reads, and it carries the
-- calculator version that produced it. A changed algorithm NEVER silently re-prices
-- history: a correction seals a NEW row under a new version, and the old one stays
-- readable next to the invoice it justified. This is exactly how rr_standby_summary
-- (sql/072) already works.
--
-- Idempotent and safe to re-run. Requires sql/070, sql/075 and sql/076.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $prereq$
BEGIN
  IF to_regclass('public.rr_service_jobs') IS NULL THEN
    RAISE EXCEPTION 'Prerequisite missing: public.rr_service_jobs. Run sql/070 before sql/077.';
  END IF;
  IF to_regclass('public.rr_custody_yards') IS NULL THEN
    RAISE EXCEPTION 'Prerequisite missing: public.rr_custody_yards. Run sql/076 before sql/077.';
  END IF;
  IF to_regclass('public.rr_release_authorisations') IS NULL THEN
    RAISE EXCEPTION 'Prerequisite missing: public.rr_release_authorisations. Run sql/075 before sql/077.';
  END IF;
END
$prereq$;

-- ---------------------------------------------------------------------------
-- 1. rr_storage_bookings
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.rr_storage_bookings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies (id) ON DELETE CASCADE,

  -- RESTRICT: a stored vehicle is a commercial and legal position, not a detail.
  service_job_id uuid NOT NULL REFERENCES public.rr_service_jobs (id) ON DELETE RESTRICT,
  yard_id uuid NOT NULL,

  /** Where in the yard. A dispute over a damaged vehicle starts with "which bay". */
  bay_reference text,

  status text NOT NULL DEFAULT 'stored',

  -- --- The storage period ---------------------------------------------------
  --
  -- Server-stamped on check-in and check-out. Never supplied by a caller: a chargeable
  -- clock a client can set is a chargeable clock a client can move.
  checked_in_at timestamptz NOT NULL DEFAULT now(),
  checked_out_at timestamptz,

  /** The custody events that opened and closed this occupancy. */
  check_in_event_id uuid,
  check_out_event_id uuid,

  -- --- Commercial terms -----------------------------------------------------
  rate_basis text NOT NULL DEFAULT 'per_day',
  /** The rate for ONE unit of rate_basis — one day, one week, one month, or the flat fee. */
  rate_amount numeric(12, 2),
  currency text NOT NULL DEFAULT 'ZAR',
  /** A grace period the counterparty contract allows before charging starts. */
  free_days integer NOT NULL DEFAULT 0,

  -- --- Condition ------------------------------------------------------------
  storage_condition text NOT NULL DEFAULT 'outdoor',
  condition_on_arrival text,
  condition_on_departure text,

  notes text,
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT rr_storage_bookings_company_id_id_key UNIQUE (company_id, id),
  CONSTRAINT rr_storage_bookings_job_fk
    FOREIGN KEY (company_id, service_job_id)
    REFERENCES public.rr_service_jobs (company_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT rr_storage_bookings_yard_fk
    FOREIGN KEY (company_id, yard_id)
    REFERENCES public.rr_custody_yards (company_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT rr_storage_bookings_check_in_event_fk
    FOREIGN KEY (company_id, check_in_event_id)
    REFERENCES public.rr_custody_events (company_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT rr_storage_bookings_check_out_event_fk
    FOREIGN KEY (company_id, check_out_event_id)
    REFERENCES public.rr_custody_events (company_id, id)
    ON DELETE RESTRICT,

  CONSTRAINT rr_storage_bookings_status_check CHECK (
    status IN ('stored', 'release_pending', 'checked_out', 'disposed', 'cancelled')
  ),
  CONSTRAINT rr_storage_bookings_rate_basis_check CHECK (
    rate_basis IN ('per_day', 'per_calendar_day', 'per_week', 'per_month', 'flat')
  ),
  CONSTRAINT rr_storage_bookings_condition_check CHECK (
    storage_condition IN ('indoor', 'outdoor', 'covered', 'secure_compound')
  ),
  CONSTRAINT rr_storage_bookings_rate_check CHECK (rate_amount IS NULL OR rate_amount >= 0),
  CONSTRAINT rr_storage_bookings_free_days_check CHECK (free_days >= 0),
  -- Time only runs forwards.
  CONSTRAINT rr_storage_bookings_period_check CHECK (
    checked_out_at IS NULL OR checked_out_at >= checked_in_at
  ),
  -- A checked-out booking must say when.
  CONSTRAINT rr_storage_bookings_checkout_recorded CHECK (
    status NOT IN ('checked_out', 'disposed') OR checked_out_at IS NOT NULL
  )
);

-- One OPEN booking per job. A vehicle cannot occupy two bays at once, and a second open
-- booking would double-charge the same days.
CREATE UNIQUE INDEX IF NOT EXISTS idx_rr_storage_bookings_open
  ON public.rr_storage_bookings (company_id, service_job_id)
  WHERE checked_out_at IS NULL AND status NOT IN ('cancelled');

CREATE INDEX IF NOT EXISTS idx_rr_storage_bookings_yard
  ON public.rr_storage_bookings (company_id, yard_id, status);

COMMENT ON TABLE public.rr_storage_bookings IS
  'A vehicle occupying a bay in a yard: period, condition and commercial terms. References the custody events that opened and closed the occupancy rather than restating possession, because possession and charging are disputed separately.';

-- ---------------------------------------------------------------------------
-- 2. rr_storage_accrual — SEALED, APPEND-ONLY
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.rr_storage_accrual (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies (id) ON DELETE CASCADE,
  service_job_id uuid NOT NULL,
  booking_id uuid NOT NULL,

  /** Why this seal was written. */
  sealed_reason text NOT NULL,

  period_start timestamptz NOT NULL,
  period_end timestamptz NOT NULL,

  chargeable_days integer NOT NULL,
  free_days_applied integer NOT NULL DEFAULT 0,
  elapsed_days integer NOT NULL,

  rate_basis text NOT NULL,
  /** The rate for ONE unit of rate_basis, as it stood when this accrual was sealed. */
  rate_amount numeric(12, 2),
  /** How many units of rate_basis were charged. */
  billable_units integer NOT NULL DEFAULT 0,
  currency text NOT NULL DEFAULT 'ZAR',
  amount numeric(12, 2),

  /**
   * The algorithm that produced these numbers. A changed calculator seals a NEW row under
   * a new version rather than re-pricing what was already invoiced.
   */
  calculator_version text NOT NULL,

  sealed_by text,
  sealed_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT rr_storage_accrual_company_id_id_key UNIQUE (company_id, id),
  CONSTRAINT rr_storage_accrual_job_fk
    FOREIGN KEY (company_id, service_job_id)
    REFERENCES public.rr_service_jobs (company_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT rr_storage_accrual_booking_fk
    FOREIGN KEY (company_id, booking_id)
    REFERENCES public.rr_storage_bookings (company_id, id)
    ON DELETE RESTRICT,

  CONSTRAINT rr_storage_accrual_reason_check CHECK (
    sealed_reason IN ('check_out', 'periodic', 'release', 'disposal', 'cancellation')
  ),
  CONSTRAINT rr_storage_accrual_period_check CHECK (period_end >= period_start),
  CONSTRAINT rr_storage_accrual_days_check CHECK (
    chargeable_days >= 0 AND elapsed_days >= 0 AND free_days_applied >= 0
    AND billable_units >= 0
  ),
  -- Charging for more days than elapsed is arithmetically impossible.
  CONSTRAINT rr_storage_accrual_days_consistent CHECK (chargeable_days <= elapsed_days),
  CONSTRAINT rr_storage_accrual_amount_check CHECK (amount IS NULL OR amount >= 0)
);

CREATE INDEX IF NOT EXISTS idx_rr_storage_accrual_job
  ON public.rr_storage_accrual (company_id, service_job_id, sealed_at DESC);

COMMENT ON TABLE public.rr_storage_accrual IS
  'SEALED, APPEND-ONLY storage charge. Billing reads this frozen fact. It records the calculator version that produced it, so a changed algorithm seals a new row rather than silently re-pricing an invoice that was already issued.';

CREATE OR REPLACE FUNCTION public.rr_storage_accrual_forbid_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $forbid$
BEGIN
  RAISE EXCEPTION
    'public.rr_storage_accrual is a sealed append-only billing record: % is not permitted. Seal a new accrual instead.',
    TG_OP;
END
$forbid$;

DROP TRIGGER IF EXISTS rr_storage_accrual_append_only ON public.rr_storage_accrual;

CREATE TRIGGER rr_storage_accrual_append_only
  BEFORE UPDATE OR DELETE ON public.rr_storage_accrual
  FOR EACH ROW
  EXECUTE FUNCTION public.rr_storage_accrual_forbid_mutation();

-- ---------------------------------------------------------------------------
-- 3. Row level security + tenant isolation
-- ---------------------------------------------------------------------------
ALTER TABLE public.rr_storage_bookings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rr_storage_accrual ENABLE ROW LEVEL SECURITY;

DO $tenant$
DECLARE
  tbl text;
BEGIN
  IF to_regprocedure('public.vyron_user_company_ids()') IS NULL
     OR to_regprocedure('public.vyron_is_platform_operator()') IS NULL THEN
    RAISE NOTICE
      'Tenant helper functions missing (sql/030). Phase 4 storage tables have RLS enabled with NO policy, which denies all access until sql/030 and then sql/077 are run.';
    RETURN;
  END IF;

  FOR tbl IN SELECT unnest(ARRAY['rr_storage_bookings', 'rr_storage_accrual'])
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I_tenant_isolation ON public.%I', tbl, tbl);
    EXECUTE format(
      'CREATE POLICY %I_tenant_isolation ON public.%I FOR ALL TO authenticated USING (
         public.vyron_is_platform_operator()
         OR EXISTS (
           SELECT 1
           FROM public.vyron_user_company_ids() as c(company_id)
           WHERE c.company_id::text = public.%I.company_id::text
         )
       ) WITH CHECK (
         public.vyron_is_platform_operator()
         OR EXISTS (
           SELECT 1
           FROM public.vyron_user_company_ids() as c(company_id)
           WHERE c.company_id::text = public.%I.company_id::text
         )
       )',
      tbl, tbl, tbl, tbl
    );
  END LOOP;
END
$tenant$;

REVOKE ALL ON public.rr_storage_bookings FROM anon;
REVOKE ALL ON public.rr_storage_accrual FROM anon;

-- A booking is edited while it is open (bay moves, condition notes, check-out) but is
-- never destroyed: it underpins a charge.
GRANT SELECT, INSERT, UPDATE ON public.rr_storage_bookings TO authenticated;
REVOKE DELETE, TRUNCATE ON public.rr_storage_bookings FROM authenticated;

-- Sealed. See the trigger above.
GRANT SELECT, INSERT ON public.rr_storage_accrual TO authenticated;
REVOKE UPDATE, DELETE, TRUNCATE ON public.rr_storage_accrual FROM authenticated;

COMMIT;

NOTIFY pgrst, 'reload schema';

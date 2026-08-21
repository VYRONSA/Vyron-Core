-- 079-road-recovery-billable-facts.sql
-- VYRON CORE — Road & Recovery Phase 5, step 2: billable facts and sealed charges.
--
-- ---------------------------------------------------------------------------
-- PRODUCT BOUNDARY
-- ---------------------------------------------------------------------------
--
-- These tables hold OPERATIONAL FACTS and EXPECTED CHARGES. They are not financial
-- transactions. Nothing here is an invoice, a payment, a credit note, a debtor or a
-- ledger entry — those belong to VYRON FINANCE. A sealed calculation says what a job
-- SHOULD be billed and why; issuing the invoice happens elsewhere.
--
-- ---------------------------------------------------------------------------
-- FACTS ARE APPEND-ONLY, AND A CORRECTION IS A NEW FACT
-- ---------------------------------------------------------------------------
--
-- rr_billable_facts records quantities, never money. The driver's odometer reading is the
-- primary commercial distance source and is IMMUTABLE: a controller who disagrees records
-- a dispute and, if a corrected value is needed, a NEW fact that supersedes the original.
-- The original driver fact always survives, because it is the thing a counterparty will
-- challenge months later.
--
-- ---------------------------------------------------------------------------
-- CHARGES ARE SEALED
-- ---------------------------------------------------------------------------
--
-- rr_charge_calculations and rr_charge_lines are append-only and carry the engine version
-- AND the rate-card version that produced them, exactly as rr_standby_summary (sql/072)
-- and rr_storage_accrual (sql/077) already do. A re-calculation seals a NEW row; it never
-- re-prices information a counterparty has already been shown.
--
-- Idempotent and safe to re-run. Requires sql/070, sql/072, sql/077 and sql/078.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $prereq$
BEGIN
  IF to_regclass('public.rr_service_jobs') IS NULL THEN
    RAISE EXCEPTION 'Prerequisite missing: public.rr_service_jobs. Run sql/070 before sql/079.';
  END IF;
  IF to_regclass('public.rr_job_rate_snapshot') IS NULL THEN
    RAISE EXCEPTION 'Prerequisite missing: public.rr_job_rate_snapshot. Run sql/078 before sql/079.';
  END IF;
  IF to_regclass('public.mobile_workforce_evidence') IS NULL THEN
    RAISE EXCEPTION 'Prerequisite missing: public.mobile_workforce_evidence. Run sql/031 before sql/079.';
  END IF;
END
$prereq$;

-- ---------------------------------------------------------------------------
-- 1. rr_billable_facts — APPEND-ONLY
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.rr_billable_facts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies (id) ON DELETE CASCADE,

  -- RESTRICT: a job that has been priced is a commercial position, not a detail.
  service_job_id uuid NOT NULL REFERENCES public.rr_service_jobs (id) ON DELETE RESTRICT,

  fact_code text NOT NULL,
  /** Quantities only. Money is never stored on a fact. */
  quantity numeric(14, 3) NOT NULL,
  unit text NOT NULL,

  /** Where the number came from. Never inferred. */
  source text NOT NULL,
  /** The sealed row or event this was derived from (accrual id, standby summary id, …). */
  source_ref uuid,
  /** The calculator that produced a derived quantity, carried through from the seal. */
  calculation_version text,

  /**
   * Structured capture detail. For tow_distance this holds the driver's odometer
   * readings, the vehicle, the GPS position and the dispatch estimate it was compared
   * against — see the constraint below. Kept as jsonb rather than a ninth table.
   */
  source_detail jsonb NOT NULL DEFAULT '{}'::jsonb,

  status text NOT NULL DEFAULT 'provisional',
  /** Set when a later fact replaces this one. The original is never deleted or edited. */
  superseded_by uuid,

  evidence_id uuid REFERENCES public.mobile_workforce_evidence (id) ON DELETE SET NULL,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  recorded_by text NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  notes text,

  CONSTRAINT rr_billable_facts_company_id_id_key UNIQUE (company_id, id),
  CONSTRAINT rr_billable_facts_job_fk
    FOREIGN KEY (company_id, service_job_id)
    REFERENCES public.rr_service_jobs (company_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT rr_billable_facts_superseded_fk
    FOREIGN KEY (company_id, superseded_by)
    REFERENCES public.rr_billable_facts (company_id, id)
    ON DELETE RESTRICT,

  CONSTRAINT rr_billable_facts_code_check CHECK (
    fact_code IN (
      'callout','tow_distance','travel_time','standing_time','paused_time','recovery_hours',
      'loading','unloading','delivery','storage_days','equipment','additional_service',
      'cancellation','no_show'
    )
  ),
  CONSTRAINT rr_billable_facts_source_check CHECK (
    source IN ('sealed_summary','state_events','gps','captured','manual','system')
  ),
  CONSTRAINT rr_billable_facts_status_check CHECK (
    status IN ('provisional','frozen','disputed','superseded')
  ),
  CONSTRAINT rr_billable_facts_quantity_check CHECK (quantity >= 0),
  CONSTRAINT rr_billable_facts_detail_is_object CHECK (jsonb_typeof(source_detail) = 'object'),

  -- The driver odometer capture is the primary commercial distance source, so a captured
  -- distance must actually carry its readings rather than an unexplained number.
  CONSTRAINT rr_billable_facts_odometer_recorded CHECK (
    fact_code <> 'tow_distance'
    OR source <> 'captured'
    OR (source_detail ? 'odometer_start_km' AND source_detail ? 'odometer_end_km')
  ),
  -- superseded_by is a back-reference set immediately after the replacement exists.
  --
  -- It is deliberately NOT constrained to be present the moment a fact is retired: a
  -- partial unique index permits only one ACTIVE fact per code, so the original must be
  -- retired BEFORE its replacement can be inserted, and the replacement's id cannot exist
  -- until then. The guarantee that actually matters — that a recorded fact is never
  -- altered and never deleted — is enforced by the trigger below, not by this column.
  CONSTRAINT rr_billable_facts_supersede_self CHECK (
    superseded_by IS NULL OR superseded_by <> id
  )
);

-- One ACTIVE fact per code per job. A correction supersedes rather than duplicating.
CREATE UNIQUE INDEX IF NOT EXISTS idx_rr_billable_facts_active
  ON public.rr_billable_facts (company_id, service_job_id, fact_code)
  WHERE status IN ('provisional', 'frozen', 'disputed');

CREATE INDEX IF NOT EXISTS idx_rr_billable_facts_job
  ON public.rr_billable_facts (company_id, service_job_id, fact_code);

COMMENT ON TABLE public.rr_billable_facts IS
  'APPEND-ONLY operational billing facts: quantities, sources and evidence. Never money, never a financial transaction. The driver odometer capture is immutable; a corrected distance is a NEW fact that supersedes it, so the original driver reading always survives a dispute.';

CREATE OR REPLACE FUNCTION public.rr_billable_facts_forbid_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $forbid$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION
      'public.rr_billable_facts is append-only: DELETE is not permitted. Supersede the fact instead.';
  END IF;

  -- The ONLY permitted update is retiring a fact by pointing it at its replacement.
  -- Everything that made the fact what it is stays exactly as recorded — which is the
  -- whole point when a counterparty disputes the distance six months later.
  IF NEW.fact_code IS DISTINCT FROM OLD.fact_code
     OR NEW.quantity IS DISTINCT FROM OLD.quantity
     OR NEW.unit IS DISTINCT FROM OLD.unit
     OR NEW.source IS DISTINCT FROM OLD.source
     OR NEW.source_ref IS DISTINCT FROM OLD.source_ref
     OR NEW.source_detail IS DISTINCT FROM OLD.source_detail
     OR NEW.evidence_id IS DISTINCT FROM OLD.evidence_id
     OR NEW.occurred_at IS DISTINCT FROM OLD.occurred_at
     OR NEW.recorded_by IS DISTINCT FROM OLD.recorded_by
     OR NEW.service_job_id IS DISTINCT FROM OLD.service_job_id THEN
    RAISE EXCEPTION
      'public.rr_billable_facts is append-only: a recorded fact cannot be altered. Record a NEW fact and supersede this one.';
  END IF;

  RETURN NEW;
END
$forbid$;

DROP TRIGGER IF EXISTS rr_billable_facts_append_only ON public.rr_billable_facts;

CREATE TRIGGER rr_billable_facts_append_only
  BEFORE UPDATE OR DELETE ON public.rr_billable_facts
  FOR EACH ROW
  EXECUTE FUNCTION public.rr_billable_facts_forbid_mutation();

-- ---------------------------------------------------------------------------
-- 2. rr_charge_calculations — SEALED, APPEND-ONLY
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.rr_charge_calculations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies (id) ON DELETE CASCADE,
  service_job_id uuid NOT NULL,

  status text NOT NULL,

  subtotal_ex_vat numeric(14, 2) NOT NULL DEFAULT 0,
  vat_amount numeric(14, 2) NOT NULL DEFAULT 0,
  total_incl_vat numeric(14, 2) NOT NULL DEFAULT 0,
  currency text NOT NULL DEFAULT 'ZAR',
  vat_rate numeric(6, 4) NOT NULL DEFAULT 0,

  /** Gaps that made this calculation incomplete, named so a human can close them. */
  missing_facts text[] NOT NULL DEFAULT ARRAY[]::text[],
  unrated_facts text[] NOT NULL DEFAULT ARRAY[]::text[],

  /** Which rate card produced these numbers. */
  rate_policy_key text,
  rate_version integer,
  rate_snapshot_id uuid,

  after_hours boolean NOT NULL DEFAULT false,
  public_holiday boolean NOT NULL DEFAULT false,

  engine_version text NOT NULL,
  rate_engine_version text NOT NULL,
  calculated_at timestamptz NOT NULL DEFAULT now(),
  calculated_by text,

  CONSTRAINT rr_charge_calculations_company_id_id_key UNIQUE (company_id, id),
  CONSTRAINT rr_charge_calculations_job_fk
    FOREIGN KEY (company_id, service_job_id)
    REFERENCES public.rr_service_jobs (company_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT rr_charge_calculations_snapshot_fk
    FOREIGN KEY (company_id, rate_snapshot_id)
    REFERENCES public.rr_job_rate_snapshot (company_id, id)
    ON DELETE RESTRICT,

  CONSTRAINT rr_charge_calculations_status_check CHECK (
    status IN ('calculated','incomplete','not_chargeable')
  ),
  CONSTRAINT rr_charge_calculations_amounts_check CHECK (
    subtotal_ex_vat >= 0 AND vat_amount >= 0 AND total_incl_vat >= 0
  ),
  -- The total must equal what it claims to be the sum of.
  CONSTRAINT rr_charge_calculations_total_consistent CHECK (
    total_incl_vat = subtotal_ex_vat + vat_amount
  ),
  -- A calculation that reports gaps cannot claim to be complete.
  CONSTRAINT rr_charge_calculations_status_consistent CHECK (
    status <> 'calculated'
    OR (cardinality(missing_facts) = 0 AND cardinality(unrated_facts) = 0)
  )
);

CREATE INDEX IF NOT EXISTS idx_rr_charge_calculations_job
  ON public.rr_charge_calculations (company_id, service_job_id, calculated_at DESC);

COMMENT ON TABLE public.rr_charge_calculations IS
  'SEALED, APPEND-ONLY expected-charge calculation. Carries the charge-engine version AND the rate-card version that produced it, so a changed algorithm or a republished rate card seals a NEW calculation rather than re-pricing information already shown. This is billing information, not an invoice.';

CREATE OR REPLACE FUNCTION public.rr_charge_calculations_forbid_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $forbid$
BEGIN
  RAISE EXCEPTION
    'public.rr_charge_calculations is a sealed append-only calculation: % is not permitted. Seal a new calculation instead.',
    TG_OP;
END
$forbid$;

DROP TRIGGER IF EXISTS rr_charge_calculations_append_only ON public.rr_charge_calculations;

CREATE TRIGGER rr_charge_calculations_append_only
  BEFORE UPDATE OR DELETE ON public.rr_charge_calculations
  FOR EACH ROW
  EXECUTE FUNCTION public.rr_charge_calculations_forbid_mutation();

-- ---------------------------------------------------------------------------
-- 3. rr_charge_lines — SEALED, APPEND-ONLY
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.rr_charge_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies (id) ON DELETE CASCADE,
  calculation_id uuid NOT NULL,
  service_job_id uuid NOT NULL,

  charge_code text NOT NULL,
  label text NOT NULL,
  /** The rate-card rule that produced this line, for audit. */
  rule_id text NOT NULL,
  basis text NOT NULL,
  unit text NOT NULL,

  quantity numeric(14, 3) NOT NULL DEFAULT 0,
  chargeable_quantity numeric(14, 3) NOT NULL DEFAULT 0,
  rate_amount numeric(12, 4) NOT NULL DEFAULT 0,
  subtotal_ex_vat numeric(14, 2) NOT NULL DEFAULT 0,
  minimum_applied boolean NOT NULL DEFAULT false,

  vat_treatment text NOT NULL DEFAULT 'standard',
  vat_rate numeric(6, 4) NOT NULL DEFAULT 0,
  vat_amount numeric(14, 2) NOT NULL DEFAULT 0,
  total_incl_vat numeric(14, 2) NOT NULL DEFAULT 0,

  /** Plain-language explanation a controller or counterparty can read. */
  reason text NOT NULL,
  fact_code text,
  source_ref uuid,
  sort_order integer NOT NULL DEFAULT 100,

  CONSTRAINT rr_charge_lines_company_id_id_key UNIQUE (company_id, id),
  CONSTRAINT rr_charge_lines_calculation_fk
    FOREIGN KEY (company_id, calculation_id)
    REFERENCES public.rr_charge_calculations (company_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT rr_charge_lines_job_fk
    FOREIGN KEY (company_id, service_job_id)
    REFERENCES public.rr_service_jobs (company_id, id)
    ON DELETE RESTRICT,

  CONSTRAINT rr_charge_lines_vat_treatment_check CHECK (
    vat_treatment IN ('standard','zero_rated','exempt')
  ),
  CONSTRAINT rr_charge_lines_amounts_check CHECK (
    subtotal_ex_vat >= 0 AND vat_amount >= 0 AND total_incl_vat >= 0
  ),
  CONSTRAINT rr_charge_lines_total_consistent CHECK (
    total_incl_vat = subtotal_ex_vat + vat_amount
  ),
  -- A zero-rated or exempt line cannot carry VAT.
  CONSTRAINT rr_charge_lines_vat_consistent CHECK (
    vat_treatment = 'standard' OR vat_amount = 0
  ),
  -- Every line must explain itself. An unexplained charge is an indefensible one.
  CONSTRAINT rr_charge_lines_explained CHECK (length(trim(reason)) > 0)
);

CREATE INDEX IF NOT EXISTS idx_rr_charge_lines_calculation
  ON public.rr_charge_lines (company_id, calculation_id, sort_order);

CREATE INDEX IF NOT EXISTS idx_rr_charge_lines_job
  ON public.rr_charge_lines (company_id, service_job_id, charge_code);

CREATE OR REPLACE FUNCTION public.rr_charge_lines_forbid_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $forbid$
BEGIN
  RAISE EXCEPTION
    'public.rr_charge_lines belongs to a sealed calculation: % is not permitted. Seal a new calculation instead.',
    TG_OP;
END
$forbid$;

DROP TRIGGER IF EXISTS rr_charge_lines_append_only ON public.rr_charge_lines;

CREATE TRIGGER rr_charge_lines_append_only
  BEFORE UPDATE OR DELETE ON public.rr_charge_lines
  FOR EACH ROW
  EXECUTE FUNCTION public.rr_charge_lines_forbid_mutation();

-- ---------------------------------------------------------------------------
-- 4. Row level security + tenant isolation
-- ---------------------------------------------------------------------------
ALTER TABLE public.rr_billable_facts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rr_charge_calculations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rr_charge_lines ENABLE ROW LEVEL SECURITY;

DO $tenant$
DECLARE
  tbl text;
BEGIN
  IF to_regprocedure('public.vyron_user_company_ids()') IS NULL
     OR to_regprocedure('public.vyron_is_platform_operator()') IS NULL THEN
    RAISE NOTICE
      'Tenant helper functions missing (sql/030). Phase 5 fact tables have RLS enabled with NO policy, which denies all access until sql/030 and then sql/079 are run.';
    RETURN;
  END IF;

  FOR tbl IN
    SELECT unnest(ARRAY['rr_billable_facts', 'rr_charge_calculations', 'rr_charge_lines'])
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

REVOKE ALL ON public.rr_billable_facts FROM anon;
REVOKE ALL ON public.rr_charge_calculations FROM anon;
REVOKE ALL ON public.rr_charge_lines FROM anon;

-- Facts take SELECT/INSERT plus a NARROW update, allowed only so a fact can be retired
-- by pointing it at its replacement. The trigger enforces which columns may move.
GRANT SELECT, INSERT, UPDATE ON public.rr_billable_facts TO authenticated;
REVOKE DELETE, TRUNCATE ON public.rr_billable_facts FROM authenticated;

-- Sealed. See the triggers above.
GRANT SELECT, INSERT ON public.rr_charge_calculations TO authenticated;
REVOKE UPDATE, DELETE, TRUNCATE ON public.rr_charge_calculations FROM authenticated;

GRANT SELECT, INSERT ON public.rr_charge_lines TO authenticated;
REVOKE UPDATE, DELETE, TRUNCATE ON public.rr_charge_lines FROM authenticated;

COMMIT;

NOTIFY pgrst, 'reload schema';

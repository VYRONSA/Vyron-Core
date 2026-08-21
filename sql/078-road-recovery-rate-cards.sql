-- 078-road-recovery-rate-cards.sql
-- VYRON CORE — Road & Recovery Phase 5, step 1: rate cards and the immutable job snapshot.
--
-- ---------------------------------------------------------------------------
-- PRODUCT BOUNDARY
-- ---------------------------------------------------------------------------
--
-- VYRON CORE produces BILLING INFORMATION. It does not invoice.
--
-- A rate card is operational commercial configuration: what a job SHOULD be charged, and
-- why. Nothing in this file is an invoice, a payment, a credit note, a debtor, a tax
-- table or a ledger entry. Those belong to VYRON FINANCE.
--
-- ---------------------------------------------------------------------------
-- RATES ARE DATA, AND THE SHIPPED DEFAULTS CARRY NO PRICES
-- ---------------------------------------------------------------------------
--
-- South African towing rates are NOT regulated. There is no national tariff and no
-- published association schedule; the AA, SATRA and Arrive Alive all tell consumers to
-- agree the rate up front, in writing. What ships here is therefore the SHAPE of a South
-- African tow tariff with every rate set to ZERO — an operator must enter their own
-- numbers, and until they do the charge engine reports `not_chargeable` and billing
-- readiness BLOCKS. A zero rate is never a free tow.
--
-- ---------------------------------------------------------------------------
-- HOLIDAY CALENDAR: REUSED, NOT DUPLICATED
-- ---------------------------------------------------------------------------
--
-- public.leave_public_holidays already exists (sql/045), is tenant-scoped, and is
-- hardened by sql/049. Road & Recovery READS it for the public-holiday rate modifier and
-- does NOT create a second calendar. Two additive columns are added so a holiday can be
-- de-activated without deleting it; both are IF NOT EXISTS with behaviour-preserving
-- defaults, and the Leave module selects and inserts explicit column lists, so neither
-- can break it.
--
-- Idempotent and safe to re-run. Requires sql/070 and sql/071.
-- sql/045 (the Leave holiday calendar) is OPTIONAL — see section 1.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $prereq$
BEGIN
  IF to_regclass('public.rr_service_jobs') IS NULL THEN
    RAISE EXCEPTION 'Prerequisite missing: public.rr_service_jobs. Run sql/070 before sql/078.';
  END IF;
  IF to_regclass('public.rr_counterparties') IS NULL THEN
    RAISE EXCEPTION 'Prerequisite missing: public.rr_counterparties. Run sql/071 before sql/078.';
  END IF;
  -- The holiday calendar is an OPTIONAL dependency, deliberately.
  --
  -- public.leave_public_holidays belongs to the Leave module (sql/045). A tenant running
  -- Road & Recovery without Leave must still be able to install rate cards, so its
  -- absence is a NOTICE rather than a failure: with no calendar there are no holidays,
  -- the public-holiday loading never fires, and that is the SAFE default — no loading
  -- rather than a wrong one.
  IF to_regclass('public.leave_public_holidays') IS NULL THEN
    RAISE NOTICE
      'public.leave_public_holidays is absent (Leave module not installed). Road & Recovery will treat every day as a non-holiday until it exists.';
  END IF;
END
$prereq$;

-- ---------------------------------------------------------------------------
-- 1. Public holiday calendar — ADDITIVE reuse of the Leave module's table
-- ---------------------------------------------------------------------------
DO $holidays$
BEGIN
  IF to_regclass('public.leave_public_holidays') IS NULL THEN
    RETURN;
  END IF;

  ALTER TABLE public.leave_public_holidays
    ADD COLUMN IF NOT EXISTS active boolean NOT NULL DEFAULT true;

  ALTER TABLE public.leave_public_holidays
    ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

  COMMENT ON COLUMN public.leave_public_holidays.active IS
    'Added by sql/078. Lets a holiday be de-activated rather than deleted, so a rate modifier applied on a past job stays explicable. Defaults true, so existing rows are unchanged.';
END
$holidays$;

-- ---------------------------------------------------------------------------
-- 2. rr_rate_cards — versioned, effective-dated, counterparty x service
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.rr_rate_cards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies (id) ON DELETE CASCADE,

  policy_key text NOT NULL,
  /** NULL = applies to every counterparty (tenant default). */
  counterparty_id uuid,
  /** NULL = applies to every service type. */
  service_code text,

  version integer NOT NULL DEFAULT 1,
  active boolean NOT NULL DEFAULT true,
  effective_from timestamptz,
  effective_to timestamptz,

  currency text NOT NULL DEFAULT 'ZAR',
  /**
   * The tenant VAT rate in force for this card, as a fraction. CORE computes VAT-relevant
   * amounts because accurate billing information requires them; the DEFINITIVE tax
   * treatment belongs to VYRON FINANCE. This is not a tax table.
   */
  vat_rate numeric(6, 4) NOT NULL DEFAULT 0.15,

  label text,
  notes text,
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT rr_rate_cards_key_version_unique UNIQUE (company_id, policy_key, version),
  CONSTRAINT rr_rate_cards_company_id_id_key UNIQUE (company_id, id),

  CONSTRAINT rr_rate_cards_counterparty_fk
    FOREIGN KEY (company_id, counterparty_id)
    REFERENCES public.rr_counterparties (company_id, id)
    ON DELETE CASCADE,

  CONSTRAINT rr_rate_cards_version_check CHECK (version >= 1),
  CONSTRAINT rr_rate_cards_key_format CHECK (policy_key ~ '^[a-z0-9_]+$'),
  CONSTRAINT rr_rate_cards_vat_rate_check CHECK (vat_rate >= 0 AND vat_rate <= 1),
  CONSTRAINT rr_rate_cards_service_code_check CHECK (
    service_code IS NULL OR service_code IN (
      'accident_recovery','tow_in','jump_start','roadside_assistance',
      'bystand','heavy_recovery','vehicle_movement','storage'
    )
  ),
  CONSTRAINT rr_rate_cards_window_check CHECK (
    effective_from IS NULL OR effective_to IS NULL OR effective_to >= effective_from
  )
);

-- Only one ACTIVE version per rate card key per company.
CREATE UNIQUE INDEX IF NOT EXISTS idx_rr_rate_cards_active
  ON public.rr_rate_cards (company_id, policy_key)
  WHERE active;

CREATE INDEX IF NOT EXISTS idx_rr_rate_cards_resolution
  ON public.rr_rate_cards (company_id, service_code, counterparty_id, active);

COMMENT ON TABLE public.rr_rate_cards IS
  'Versioned Road & Recovery rate cards, configurable per counterparty and service type. South African towing rates are unregulated and every commercial term is negotiated, so rates are DATA here and are never hardcoded. Operational configuration, not an accounting price list.';

-- ---------------------------------------------------------------------------
-- 3. rr_rate_card_items — the charges inside a card
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.rr_rate_card_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies (id) ON DELETE CASCADE,
  rate_card_id uuid NOT NULL,

  charge_code text NOT NULL,
  label text NOT NULL,
  basis text NOT NULL,
  unit text NOT NULL DEFAULT 'each',

  rate_amount numeric(12, 4) NOT NULL DEFAULT 0,
  minimum_charge numeric(12, 2),
  /** Free kilometres, an included first hour, a storage grace day. */
  included_quantity numeric(12, 3) NOT NULL DEFAULT 0,
  band_from numeric(12, 3),
  band_to numeric(12, 3),
  /** Billing granularity: 0.25 bills quarter-hours. */
  increment numeric(12, 3) NOT NULL DEFAULT 1,

  vat_treatment text NOT NULL DEFAULT 'standard',
  /**
   * True when this charge is only sometimes used. An optional charge with no recorded
   * fact means "not used", never "missing", so declaring a rate for specialised equipment
   * does not make every job of that service report an incomplete calculation.
   */
  optional boolean NOT NULL DEFAULT false,
  /** Declarative, never executable. Same grammar as Phase 3 requirement conditions. */
  condition jsonb NOT NULL DEFAULT '{"always":true}'::jsonb,
  /** For percentage loadings: which charge codes the loading applies to. */
  applies_to text[] NOT NULL DEFAULT ARRAY[]::text[],
  sort_order integer NOT NULL DEFAULT 100,
  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT rr_rate_card_items_company_id_id_key UNIQUE (company_id, id),
  -- A charge code may repeat ONLY as distinct bands.
  CONSTRAINT rr_rate_card_items_band_unique
    UNIQUE (company_id, rate_card_id, charge_code, band_from, band_to),
  CONSTRAINT rr_rate_card_items_card_fk
    FOREIGN KEY (company_id, rate_card_id)
    REFERENCES public.rr_rate_cards (company_id, id)
    ON DELETE CASCADE,

  CONSTRAINT rr_rate_card_items_charge_code_check CHECK (
    charge_code IN (
      'callout','tow_distance','travel_time','standing_time','paused_time','recovery_hours',
      'loading','unloading','delivery','storage_days','custody_handling','equipment',
      'additional_service','cancellation','no_show','release_fee','admin_fee','security_fee',
      'after_hours_loading','public_holiday_loading'
    )
  ),
  CONSTRAINT rr_rate_card_items_basis_check CHECK (
    basis IN ('flat','per_km','per_hour','per_day','per_unit','percentage')
  ),
  CONSTRAINT rr_rate_card_items_vat_treatment_check CHECK (
    vat_treatment IN ('standard','zero_rated','exempt')
  ),
  CONSTRAINT rr_rate_card_items_rate_check CHECK (rate_amount >= 0),
  CONSTRAINT rr_rate_card_items_minimum_check CHECK (minimum_charge IS NULL OR minimum_charge >= 0),
  CONSTRAINT rr_rate_card_items_included_check CHECK (included_quantity >= 0),
  CONSTRAINT rr_rate_card_items_increment_check CHECK (increment > 0),
  CONSTRAINT rr_rate_card_items_band_check CHECK (
    band_from IS NULL OR band_to IS NULL OR band_to >= band_from
  ),
  -- A percentage loading must say what it loads.
  CONSTRAINT rr_rate_card_items_percentage_targets CHECK (
    basis <> 'percentage' OR cardinality(applies_to) > 0
  )
);

CREATE INDEX IF NOT EXISTS idx_rr_rate_card_items_card
  ON public.rr_rate_card_items (company_id, rate_card_id, sort_order);

-- ---------------------------------------------------------------------------
-- 3a. BYSTAND SEPARATION — enforced at the database
-- ---------------------------------------------------------------------------
--
-- A bystand attendance moves nothing and stores nothing. Phase 0 pins the service type
-- (requires_destination/custody/storage = false, billing basis per_hour_standing) and
-- forbids destination data on the job. This is the COMMERCIAL half of the same invariant.
--
-- A CHECK constraint cannot reach the parent card's service_code, so this is a trigger.
-- It is unbypassable: writing straight to the table is refused too.
CREATE OR REPLACE FUNCTION public.rr_rate_card_items_bystand_separation()
RETURNS trigger
LANGUAGE plpgsql
AS $bystand$
DECLARE
  card_service text;
BEGIN
  SELECT service_code INTO card_service
    FROM public.rr_rate_cards
   WHERE id = NEW.rate_card_id;

  IF card_service = 'bystand' AND NEW.charge_code IN (
    'tow_distance','loading','unloading','delivery','storage_days',
    'custody_handling','recovery_hours','release_fee'
  ) THEN
    RAISE EXCEPTION
      'A BYSTAND rate card cannot charge "%": a bystand attendance moves nothing and stores nothing. Convert to a recovery job instead.',
      NEW.charge_code;
  END IF;

  RETURN NEW;
END
$bystand$;

DROP TRIGGER IF EXISTS rr_rate_card_items_bystand ON public.rr_rate_card_items;

CREATE TRIGGER rr_rate_card_items_bystand
  BEFORE INSERT OR UPDATE ON public.rr_rate_card_items
  FOR EACH ROW
  EXECUTE FUNCTION public.rr_rate_card_items_bystand_separation();

-- ---------------------------------------------------------------------------
-- 4. rr_job_rate_snapshot — IMMUTABLE
-- ---------------------------------------------------------------------------
--
-- The rate card as it stood when the job was priced, frozen onto the job. A completed
-- job must NEVER change price because someone published a new card afterwards, so this
-- table refuses UPDATE at both layers. DELETE stays available only for the
-- calculation-rollback path.
CREATE TABLE IF NOT EXISTS public.rr_job_rate_snapshot (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies (id) ON DELETE CASCADE,
  service_job_id uuid NOT NULL,

  rate_card_id uuid,
  policy_key text NOT NULL,
  policy_version integer NOT NULL,
  counterparty_id uuid,
  service_code text,
  currency text NOT NULL DEFAULT 'ZAR',
  vat_rate numeric(6, 4) NOT NULL,

  /** The complete resolved card, exactly as the engine consumed it. */
  items jsonb NOT NULL,
  /** Why this card won, for audit: specificity, version, and what else applied. */
  resolution_reason text,

  resolved_at timestamptz NOT NULL DEFAULT now(),
  resolved_by text,

  CONSTRAINT rr_job_rate_snapshot_job_unique UNIQUE (company_id, service_job_id),
  CONSTRAINT rr_job_rate_snapshot_company_id_id_key UNIQUE (company_id, id),
  CONSTRAINT rr_job_rate_snapshot_job_fk
    FOREIGN KEY (company_id, service_job_id)
    REFERENCES public.rr_service_jobs (company_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT rr_job_rate_snapshot_items_is_array CHECK (jsonb_typeof(items) = 'array'),
  CONSTRAINT rr_job_rate_snapshot_version_check CHECK (policy_version >= 1),
  CONSTRAINT rr_job_rate_snapshot_vat_rate_check CHECK (vat_rate >= 0 AND vat_rate <= 1)
);

CREATE INDEX IF NOT EXISTS idx_rr_job_rate_snapshot_job
  ON public.rr_job_rate_snapshot (company_id, service_job_id);

COMMENT ON TABLE public.rr_job_rate_snapshot IS
  'IMMUTABLE per-job rate-card snapshot, frozen when the job is first priced. Publishing a new rate card can never re-price a completed job.';

CREATE OR REPLACE FUNCTION public.rr_job_rate_snapshot_forbid_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $forbid$
BEGIN
  RAISE EXCEPTION
    'public.rr_job_rate_snapshot is an immutable per-job rate snapshot: % is not permitted. A completed job keeps the rate card it was priced under.',
    TG_OP;
END
$forbid$;

DROP TRIGGER IF EXISTS rr_job_rate_snapshot_immutable ON public.rr_job_rate_snapshot;

CREATE TRIGGER rr_job_rate_snapshot_immutable
  BEFORE UPDATE ON public.rr_job_rate_snapshot
  FOR EACH ROW
  EXECUTE FUNCTION public.rr_job_rate_snapshot_forbid_mutation();

-- ---------------------------------------------------------------------------
-- 5. Row level security + tenant isolation
-- ---------------------------------------------------------------------------
ALTER TABLE public.rr_rate_cards ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rr_rate_card_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rr_job_rate_snapshot ENABLE ROW LEVEL SECURITY;

DO $tenant$
DECLARE
  tbl text;
BEGIN
  IF to_regprocedure('public.vyron_user_company_ids()') IS NULL
     OR to_regprocedure('public.vyron_is_platform_operator()') IS NULL THEN
    RAISE NOTICE
      'Tenant helper functions missing (sql/030). Phase 5 rate tables have RLS enabled with NO policy, which denies all access until sql/030 and then sql/078 are run.';
    RETURN;
  END IF;

  FOR tbl IN
    SELECT unnest(ARRAY['rr_rate_cards', 'rr_rate_card_items', 'rr_job_rate_snapshot'])
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

REVOKE ALL ON public.rr_rate_cards FROM anon;
REVOKE ALL ON public.rr_rate_card_items FROM anon;
REVOKE ALL ON public.rr_job_rate_snapshot FROM anon;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.rr_rate_cards TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.rr_rate_card_items TO authenticated;

-- Immutable per-job snapshot: written once, never rewritten.
GRANT SELECT, INSERT, DELETE ON public.rr_job_rate_snapshot TO authenticated;
REVOKE UPDATE ON public.rr_job_rate_snapshot FROM authenticated;

-- ---------------------------------------------------------------------------
-- 6. Seeding: the researched default rate-card STRUCTURES
-- ---------------------------------------------------------------------------
--
-- Generated from lib/road-recovery/rate-card-catalogue.ts; the parity test fails if the
-- two diverge. Every rate is ZERO by design — see the header. These are tenant defaults
-- with counterparty_id NULL; a counterparty-specific card outranks them.
CREATE OR REPLACE FUNCTION public.rr_seed_rate_cards(p_company_id uuid)
RETURNS void
LANGUAGE plpgsql
AS $seed$
DECLARE
  seed record;
  card_id uuid;
  item jsonb;
BEGIN
  IF p_company_id IS NULL THEN
    RAISE EXCEPTION 'rr_seed_rate_cards: p_company_id is required.';
  END IF;

  FOR seed IN
    SELECT * FROM (VALUES
-- >>> GENERATED: RATE CARDS (see header) >>>
    ('default_rate_accident_recovery', 'accident_recovery', 1, 'ZAR', 0.15, $rr_rate$[{"charge_code":"callout","label":"Call-out fee","basis":"flat","unit":"each","rate_amount":0,"minimum_charge":null,"included_quantity":0,"band_from":null,"band_to":null,"increment":1,"vat_treatment":"standard","optional":false,"condition":{"always":true},"applies_to":[],"sort_order":10},{"charge_code":"tow_distance","label":"Towing distance (included)","basis":"per_km","unit":"km","rate_amount":0,"minimum_charge":null,"included_quantity":0,"band_from":0,"band_to":50,"increment":1,"vat_treatment":"standard","optional":false,"condition":{"always":true},"applies_to":[],"sort_order":20},{"charge_code":"tow_distance","label":"Towing distance (long haul)","basis":"per_km","unit":"km","rate_amount":0,"minimum_charge":null,"included_quantity":0,"band_from":50,"band_to":null,"increment":1,"vat_treatment":"standard","optional":false,"condition":{"always":true},"applies_to":[],"sort_order":21},{"charge_code":"loading","label":"Loading","basis":"per_unit","unit":"each","rate_amount":0,"minimum_charge":null,"included_quantity":0,"band_from":null,"band_to":null,"increment":1,"vat_treatment":"standard","optional":true,"condition":{"always":true},"applies_to":[],"sort_order":30},{"charge_code":"unloading","label":"Unloading","basis":"per_unit","unit":"each","rate_amount":0,"minimum_charge":null,"included_quantity":0,"band_from":null,"band_to":null,"increment":1,"vat_treatment":"standard","optional":true,"condition":{"always":true},"applies_to":[],"sort_order":40},{"charge_code":"delivery","label":"Delivery / handover","basis":"per_unit","unit":"each","rate_amount":0,"minimum_charge":null,"included_quantity":0,"band_from":null,"band_to":null,"increment":1,"vat_treatment":"standard","optional":true,"condition":{"field":"has_destination","op":"eq","value":true},"applies_to":[],"sort_order":50},{"charge_code":"equipment","label":"Specialised equipment","basis":"per_unit","unit":"each","rate_amount":0,"minimum_charge":null,"included_quantity":0,"band_from":null,"band_to":null,"increment":1,"vat_treatment":"standard","optional":true,"condition":{"always":true},"applies_to":[],"sort_order":60},{"charge_code":"additional_service","label":"Additional service","basis":"per_unit","unit":"each","rate_amount":0,"minimum_charge":null,"included_quantity":0,"band_from":null,"band_to":null,"increment":1,"vat_treatment":"standard","optional":true,"condition":{"always":true},"applies_to":[],"sort_order":70},{"charge_code":"admin_fee","label":"Administration fee","basis":"flat","unit":"each","rate_amount":0,"minimum_charge":null,"included_quantity":0,"band_from":null,"band_to":null,"increment":1,"vat_treatment":"standard","optional":false,"condition":{"always":true},"applies_to":[],"sort_order":700},{"charge_code":"cancellation","label":"Cancellation charge","basis":"flat","unit":"each","rate_amount":0,"minimum_charge":null,"included_quantity":0,"band_from":null,"band_to":null,"increment":1,"vat_treatment":"standard","optional":false,"condition":{"field":"cancelled","op":"eq","value":true},"applies_to":[],"sort_order":800},{"charge_code":"no_show","label":"No-show charge","basis":"flat","unit":"each","rate_amount":0,"minimum_charge":null,"included_quantity":0,"band_from":null,"band_to":null,"increment":1,"vat_treatment":"standard","optional":false,"condition":{"field":"no_show","op":"eq","value":true},"applies_to":[],"sort_order":810},{"charge_code":"after_hours_loading","label":"After-hours loading","basis":"percentage","unit":"%","rate_amount":0,"minimum_charge":null,"included_quantity":0,"band_from":null,"band_to":null,"increment":1,"vat_treatment":"standard","optional":false,"condition":{"field":"after_hours","op":"eq","value":true},"applies_to":["callout","tow_distance","loading","unloading","delivery"],"sort_order":900},{"charge_code":"public_holiday_loading","label":"Public holiday loading","basis":"percentage","unit":"%","rate_amount":0,"minimum_charge":null,"included_quantity":0,"band_from":null,"band_to":null,"increment":1,"vat_treatment":"standard","optional":false,"condition":{"field":"public_holiday","op":"eq","value":true},"applies_to":["callout","tow_distance","loading","unloading","delivery"],"sort_order":910}]$rr_rate$::jsonb),
    ('default_rate_tow_in', 'tow_in', 1, 'ZAR', 0.15, $rr_rate$[{"charge_code":"callout","label":"Call-out fee","basis":"flat","unit":"each","rate_amount":0,"minimum_charge":null,"included_quantity":0,"band_from":null,"band_to":null,"increment":1,"vat_treatment":"standard","optional":false,"condition":{"always":true},"applies_to":[],"sort_order":10},{"charge_code":"tow_distance","label":"Towing distance (included)","basis":"per_km","unit":"km","rate_amount":0,"minimum_charge":null,"included_quantity":0,"band_from":0,"band_to":50,"increment":1,"vat_treatment":"standard","optional":false,"condition":{"always":true},"applies_to":[],"sort_order":20},{"charge_code":"tow_distance","label":"Towing distance (long haul)","basis":"per_km","unit":"km","rate_amount":0,"minimum_charge":null,"included_quantity":0,"band_from":50,"band_to":null,"increment":1,"vat_treatment":"standard","optional":false,"condition":{"always":true},"applies_to":[],"sort_order":21},{"charge_code":"loading","label":"Loading","basis":"per_unit","unit":"each","rate_amount":0,"minimum_charge":null,"included_quantity":0,"band_from":null,"band_to":null,"increment":1,"vat_treatment":"standard","optional":true,"condition":{"always":true},"applies_to":[],"sort_order":30},{"charge_code":"unloading","label":"Unloading","basis":"per_unit","unit":"each","rate_amount":0,"minimum_charge":null,"included_quantity":0,"band_from":null,"band_to":null,"increment":1,"vat_treatment":"standard","optional":true,"condition":{"always":true},"applies_to":[],"sort_order":40},{"charge_code":"delivery","label":"Delivery / handover","basis":"per_unit","unit":"each","rate_amount":0,"minimum_charge":null,"included_quantity":0,"band_from":null,"band_to":null,"increment":1,"vat_treatment":"standard","optional":true,"condition":{"field":"has_destination","op":"eq","value":true},"applies_to":[],"sort_order":50},{"charge_code":"equipment","label":"Specialised equipment","basis":"per_unit","unit":"each","rate_amount":0,"minimum_charge":null,"included_quantity":0,"band_from":null,"band_to":null,"increment":1,"vat_treatment":"standard","optional":true,"condition":{"always":true},"applies_to":[],"sort_order":60},{"charge_code":"additional_service","label":"Additional service","basis":"per_unit","unit":"each","rate_amount":0,"minimum_charge":null,"included_quantity":0,"band_from":null,"band_to":null,"increment":1,"vat_treatment":"standard","optional":true,"condition":{"always":true},"applies_to":[],"sort_order":70},{"charge_code":"admin_fee","label":"Administration fee","basis":"flat","unit":"each","rate_amount":0,"minimum_charge":null,"included_quantity":0,"band_from":null,"band_to":null,"increment":1,"vat_treatment":"standard","optional":false,"condition":{"always":true},"applies_to":[],"sort_order":700},{"charge_code":"cancellation","label":"Cancellation charge","basis":"flat","unit":"each","rate_amount":0,"minimum_charge":null,"included_quantity":0,"band_from":null,"band_to":null,"increment":1,"vat_treatment":"standard","optional":false,"condition":{"field":"cancelled","op":"eq","value":true},"applies_to":[],"sort_order":800},{"charge_code":"no_show","label":"No-show charge","basis":"flat","unit":"each","rate_amount":0,"minimum_charge":null,"included_quantity":0,"band_from":null,"band_to":null,"increment":1,"vat_treatment":"standard","optional":false,"condition":{"field":"no_show","op":"eq","value":true},"applies_to":[],"sort_order":810},{"charge_code":"after_hours_loading","label":"After-hours loading","basis":"percentage","unit":"%","rate_amount":0,"minimum_charge":null,"included_quantity":0,"band_from":null,"band_to":null,"increment":1,"vat_treatment":"standard","optional":false,"condition":{"field":"after_hours","op":"eq","value":true},"applies_to":["callout","tow_distance","loading","unloading","delivery"],"sort_order":900},{"charge_code":"public_holiday_loading","label":"Public holiday loading","basis":"percentage","unit":"%","rate_amount":0,"minimum_charge":null,"included_quantity":0,"band_from":null,"band_to":null,"increment":1,"vat_treatment":"standard","optional":false,"condition":{"field":"public_holiday","op":"eq","value":true},"applies_to":["callout","tow_distance","loading","unloading","delivery"],"sort_order":910}]$rr_rate$::jsonb),
    ('default_rate_jump_start', 'jump_start', 1, 'ZAR', 0.15, $rr_rate$[{"charge_code":"callout","label":"Call-out fee","basis":"flat","unit":"each","rate_amount":0,"minimum_charge":null,"included_quantity":0,"band_from":null,"band_to":null,"increment":1,"vat_treatment":"standard","optional":false,"condition":{"always":true},"applies_to":[],"sort_order":10},{"charge_code":"travel_time","label":"Labour on scene","basis":"per_hour","unit":"hour","rate_amount":0,"minimum_charge":null,"included_quantity":1,"band_from":null,"band_to":null,"increment":0.25,"vat_treatment":"standard","optional":false,"condition":{"always":true},"applies_to":[],"sort_order":20},{"charge_code":"equipment","label":"Specialised equipment","basis":"per_unit","unit":"each","rate_amount":0,"minimum_charge":null,"included_quantity":0,"band_from":null,"band_to":null,"increment":1,"vat_treatment":"standard","optional":true,"condition":{"always":true},"applies_to":[],"sort_order":60},{"charge_code":"additional_service","label":"Additional service","basis":"per_unit","unit":"each","rate_amount":0,"minimum_charge":null,"included_quantity":0,"band_from":null,"band_to":null,"increment":1,"vat_treatment":"standard","optional":true,"condition":{"always":true},"applies_to":[],"sort_order":70},{"charge_code":"cancellation","label":"Cancellation charge","basis":"flat","unit":"each","rate_amount":0,"minimum_charge":null,"included_quantity":0,"band_from":null,"band_to":null,"increment":1,"vat_treatment":"standard","optional":false,"condition":{"field":"cancelled","op":"eq","value":true},"applies_to":[],"sort_order":800},{"charge_code":"no_show","label":"No-show charge","basis":"flat","unit":"each","rate_amount":0,"minimum_charge":null,"included_quantity":0,"band_from":null,"band_to":null,"increment":1,"vat_treatment":"standard","optional":false,"condition":{"field":"no_show","op":"eq","value":true},"applies_to":[],"sort_order":810},{"charge_code":"after_hours_loading","label":"After-hours loading","basis":"percentage","unit":"%","rate_amount":0,"minimum_charge":null,"included_quantity":0,"band_from":null,"band_to":null,"increment":1,"vat_treatment":"standard","optional":false,"condition":{"field":"after_hours","op":"eq","value":true},"applies_to":["callout","travel_time"],"sort_order":900},{"charge_code":"public_holiday_loading","label":"Public holiday loading","basis":"percentage","unit":"%","rate_amount":0,"minimum_charge":null,"included_quantity":0,"band_from":null,"band_to":null,"increment":1,"vat_treatment":"standard","optional":false,"condition":{"field":"public_holiday","op":"eq","value":true},"applies_to":["callout","travel_time"],"sort_order":910}]$rr_rate$::jsonb),
    ('default_rate_roadside_assistance', 'roadside_assistance', 1, 'ZAR', 0.15, $rr_rate$[{"charge_code":"callout","label":"Call-out fee","basis":"flat","unit":"each","rate_amount":0,"minimum_charge":null,"included_quantity":0,"band_from":null,"band_to":null,"increment":1,"vat_treatment":"standard","optional":false,"condition":{"always":true},"applies_to":[],"sort_order":10},{"charge_code":"travel_time","label":"Labour on scene","basis":"per_hour","unit":"hour","rate_amount":0,"minimum_charge":null,"included_quantity":1,"band_from":null,"band_to":null,"increment":0.25,"vat_treatment":"standard","optional":false,"condition":{"always":true},"applies_to":[],"sort_order":20},{"charge_code":"equipment","label":"Specialised equipment","basis":"per_unit","unit":"each","rate_amount":0,"minimum_charge":null,"included_quantity":0,"band_from":null,"band_to":null,"increment":1,"vat_treatment":"standard","optional":true,"condition":{"always":true},"applies_to":[],"sort_order":60},{"charge_code":"additional_service","label":"Additional service","basis":"per_unit","unit":"each","rate_amount":0,"minimum_charge":null,"included_quantity":0,"band_from":null,"band_to":null,"increment":1,"vat_treatment":"standard","optional":true,"condition":{"always":true},"applies_to":[],"sort_order":70},{"charge_code":"cancellation","label":"Cancellation charge","basis":"flat","unit":"each","rate_amount":0,"minimum_charge":null,"included_quantity":0,"band_from":null,"band_to":null,"increment":1,"vat_treatment":"standard","optional":false,"condition":{"field":"cancelled","op":"eq","value":true},"applies_to":[],"sort_order":800},{"charge_code":"no_show","label":"No-show charge","basis":"flat","unit":"each","rate_amount":0,"minimum_charge":null,"included_quantity":0,"band_from":null,"band_to":null,"increment":1,"vat_treatment":"standard","optional":false,"condition":{"field":"no_show","op":"eq","value":true},"applies_to":[],"sort_order":810},{"charge_code":"after_hours_loading","label":"After-hours loading","basis":"percentage","unit":"%","rate_amount":0,"minimum_charge":null,"included_quantity":0,"band_from":null,"band_to":null,"increment":1,"vat_treatment":"standard","optional":false,"condition":{"field":"after_hours","op":"eq","value":true},"applies_to":["callout","travel_time"],"sort_order":900},{"charge_code":"public_holiday_loading","label":"Public holiday loading","basis":"percentage","unit":"%","rate_amount":0,"minimum_charge":null,"included_quantity":0,"band_from":null,"band_to":null,"increment":1,"vat_treatment":"standard","optional":false,"condition":{"field":"public_holiday","op":"eq","value":true},"applies_to":["callout","travel_time"],"sort_order":910}]$rr_rate$::jsonb),
    ('default_rate_bystand', 'bystand', 1, 'ZAR', 0.15, $rr_rate$[{"charge_code":"callout","label":"Attendance call-out","basis":"flat","unit":"each","rate_amount":0,"minimum_charge":null,"included_quantity":0,"band_from":null,"band_to":null,"increment":1,"vat_treatment":"standard","optional":false,"condition":{"always":true},"applies_to":[],"sort_order":10},{"charge_code":"standing_time","label":"Standing time on scene","basis":"per_hour","unit":"hour","rate_amount":0,"minimum_charge":null,"included_quantity":0,"band_from":null,"band_to":null,"increment":0.25,"vat_treatment":"standard","optional":false,"condition":{"always":true},"applies_to":[],"sort_order":20},{"charge_code":"paused_time","label":"Paused time (not billed)","basis":"per_hour","unit":"hour","rate_amount":0,"minimum_charge":null,"included_quantity":0,"band_from":null,"band_to":null,"increment":0.25,"vat_treatment":"zero_rated","optional":false,"condition":{"always":true},"applies_to":[],"sort_order":30},{"charge_code":"cancellation","label":"Cancellation charge","basis":"flat","unit":"each","rate_amount":0,"minimum_charge":null,"included_quantity":0,"band_from":null,"band_to":null,"increment":1,"vat_treatment":"standard","optional":false,"condition":{"field":"cancelled","op":"eq","value":true},"applies_to":[],"sort_order":800},{"charge_code":"no_show","label":"No-show charge","basis":"flat","unit":"each","rate_amount":0,"minimum_charge":null,"included_quantity":0,"band_from":null,"band_to":null,"increment":1,"vat_treatment":"standard","optional":false,"condition":{"field":"no_show","op":"eq","value":true},"applies_to":[],"sort_order":810},{"charge_code":"after_hours_loading","label":"After-hours loading","basis":"percentage","unit":"%","rate_amount":0,"minimum_charge":null,"included_quantity":0,"band_from":null,"band_to":null,"increment":1,"vat_treatment":"standard","optional":false,"condition":{"field":"after_hours","op":"eq","value":true},"applies_to":["callout","standing_time"],"sort_order":900},{"charge_code":"public_holiday_loading","label":"Public holiday loading","basis":"percentage","unit":"%","rate_amount":0,"minimum_charge":null,"included_quantity":0,"band_from":null,"band_to":null,"increment":1,"vat_treatment":"standard","optional":false,"condition":{"field":"public_holiday","op":"eq","value":true},"applies_to":["callout","standing_time"],"sort_order":910}]$rr_rate$::jsonb),
    ('default_rate_heavy_recovery', 'heavy_recovery', 1, 'ZAR', 0.15, $rr_rate$[{"charge_code":"callout","label":"Call-out fee","basis":"flat","unit":"each","rate_amount":0,"minimum_charge":null,"included_quantity":0,"band_from":null,"band_to":null,"increment":1,"vat_treatment":"standard","optional":false,"condition":{"always":true},"applies_to":[],"sort_order":10},{"charge_code":"recovery_hours","label":"Recovery hours","basis":"per_hour","unit":"hour","rate_amount":0,"minimum_charge":null,"included_quantity":0,"band_from":null,"band_to":null,"increment":0.5,"vat_treatment":"standard","optional":false,"condition":{"always":true},"applies_to":[],"sort_order":20},{"charge_code":"tow_distance","label":"Towing distance","basis":"per_km","unit":"km","rate_amount":0,"minimum_charge":null,"included_quantity":0,"band_from":null,"band_to":null,"increment":1,"vat_treatment":"standard","optional":false,"condition":{"always":true},"applies_to":[],"sort_order":30},{"charge_code":"equipment","label":"Specialised equipment","basis":"per_unit","unit":"each","rate_amount":0,"minimum_charge":null,"included_quantity":0,"band_from":null,"band_to":null,"increment":1,"vat_treatment":"standard","optional":true,"condition":{"always":true},"applies_to":[],"sort_order":40},{"charge_code":"additional_service","label":"Additional service","basis":"per_unit","unit":"each","rate_amount":0,"minimum_charge":null,"included_quantity":0,"band_from":null,"band_to":null,"increment":1,"vat_treatment":"standard","optional":true,"condition":{"always":true},"applies_to":[],"sort_order":50},{"charge_code":"cancellation","label":"Cancellation charge","basis":"flat","unit":"each","rate_amount":0,"minimum_charge":null,"included_quantity":0,"band_from":null,"band_to":null,"increment":1,"vat_treatment":"standard","optional":false,"condition":{"field":"cancelled","op":"eq","value":true},"applies_to":[],"sort_order":800},{"charge_code":"no_show","label":"No-show charge","basis":"flat","unit":"each","rate_amount":0,"minimum_charge":null,"included_quantity":0,"band_from":null,"band_to":null,"increment":1,"vat_treatment":"standard","optional":false,"condition":{"field":"no_show","op":"eq","value":true},"applies_to":[],"sort_order":810},{"charge_code":"after_hours_loading","label":"After-hours loading","basis":"percentage","unit":"%","rate_amount":0,"minimum_charge":null,"included_quantity":0,"band_from":null,"band_to":null,"increment":1,"vat_treatment":"standard","optional":false,"condition":{"field":"after_hours","op":"eq","value":true},"applies_to":["callout","recovery_hours","tow_distance","equipment"],"sort_order":900},{"charge_code":"public_holiday_loading","label":"Public holiday loading","basis":"percentage","unit":"%","rate_amount":0,"minimum_charge":null,"included_quantity":0,"band_from":null,"band_to":null,"increment":1,"vat_treatment":"standard","optional":false,"condition":{"field":"public_holiday","op":"eq","value":true},"applies_to":["callout","recovery_hours","tow_distance","equipment"],"sort_order":910}]$rr_rate$::jsonb),
    ('default_rate_vehicle_movement', 'vehicle_movement', 1, 'ZAR', 0.15, $rr_rate$[{"charge_code":"tow_distance","label":"Movement distance","basis":"per_km","unit":"km","rate_amount":0,"minimum_charge":null,"included_quantity":0,"band_from":null,"band_to":null,"increment":1,"vat_treatment":"standard","optional":false,"condition":{"always":true},"applies_to":[],"sort_order":10},{"charge_code":"delivery","label":"Delivery / handover","basis":"per_unit","unit":"each","rate_amount":0,"minimum_charge":null,"included_quantity":0,"band_from":null,"band_to":null,"increment":1,"vat_treatment":"standard","optional":true,"condition":{"always":true},"applies_to":[],"sort_order":20},{"charge_code":"additional_service","label":"Additional service","basis":"per_unit","unit":"each","rate_amount":0,"minimum_charge":null,"included_quantity":0,"band_from":null,"band_to":null,"increment":1,"vat_treatment":"standard","optional":true,"condition":{"always":true},"applies_to":[],"sort_order":30},{"charge_code":"cancellation","label":"Cancellation charge","basis":"flat","unit":"each","rate_amount":0,"minimum_charge":null,"included_quantity":0,"band_from":null,"band_to":null,"increment":1,"vat_treatment":"standard","optional":false,"condition":{"field":"cancelled","op":"eq","value":true},"applies_to":[],"sort_order":800},{"charge_code":"no_show","label":"No-show charge","basis":"flat","unit":"each","rate_amount":0,"minimum_charge":null,"included_quantity":0,"band_from":null,"band_to":null,"increment":1,"vat_treatment":"standard","optional":false,"condition":{"field":"no_show","op":"eq","value":true},"applies_to":[],"sort_order":810},{"charge_code":"after_hours_loading","label":"After-hours loading","basis":"percentage","unit":"%","rate_amount":0,"minimum_charge":null,"included_quantity":0,"band_from":null,"band_to":null,"increment":1,"vat_treatment":"standard","optional":false,"condition":{"field":"after_hours","op":"eq","value":true},"applies_to":["tow_distance","delivery"],"sort_order":900},{"charge_code":"public_holiday_loading","label":"Public holiday loading","basis":"percentage","unit":"%","rate_amount":0,"minimum_charge":null,"included_quantity":0,"band_from":null,"band_to":null,"increment":1,"vat_treatment":"standard","optional":false,"condition":{"field":"public_holiday","op":"eq","value":true},"applies_to":["tow_distance","delivery"],"sort_order":910}]$rr_rate$::jsonb),
    ('default_rate_storage', 'storage', 1, 'ZAR', 0.15, $rr_rate$[{"charge_code":"storage_days","label":"Storage","basis":"per_day","unit":"day","rate_amount":0,"minimum_charge":null,"included_quantity":1,"band_from":null,"band_to":null,"increment":1,"vat_treatment":"standard","optional":false,"condition":{"always":true},"applies_to":[],"sort_order":10},{"charge_code":"release_fee","label":"Release fee","basis":"flat","unit":"each","rate_amount":0,"minimum_charge":null,"included_quantity":0,"band_from":null,"band_to":null,"increment":1,"vat_treatment":"standard","optional":true,"condition":{"always":true},"applies_to":[],"sort_order":20},{"charge_code":"security_fee","label":"Security fee","basis":"per_day","unit":"day","rate_amount":0,"minimum_charge":null,"included_quantity":0,"band_from":null,"band_to":null,"increment":1,"vat_treatment":"standard","optional":true,"condition":{"always":true},"applies_to":[],"sort_order":30},{"charge_code":"admin_fee","label":"Administration fee","basis":"flat","unit":"each","rate_amount":0,"minimum_charge":null,"included_quantity":0,"band_from":null,"band_to":null,"increment":1,"vat_treatment":"standard","optional":false,"condition":{"always":true},"applies_to":[],"sort_order":40},{"charge_code":"after_hours_loading","label":"After-hours loading","basis":"percentage","unit":"%","rate_amount":0,"minimum_charge":null,"included_quantity":0,"band_from":null,"band_to":null,"increment":1,"vat_treatment":"standard","optional":false,"condition":{"field":"after_hours","op":"eq","value":true},"applies_to":["storage_days"],"sort_order":900},{"charge_code":"public_holiday_loading","label":"Public holiday loading","basis":"percentage","unit":"%","rate_amount":0,"minimum_charge":null,"included_quantity":0,"band_from":null,"band_to":null,"increment":1,"vat_treatment":"standard","optional":false,"condition":{"field":"public_holiday","op":"eq","value":true},"applies_to":["storage_days"],"sort_order":910}]$rr_rate$::jsonb)
-- <<< GENERATED: RATE CARDS <<<
    ) AS v(policy_key, service_code, version, currency, vat_rate, items)
  LOOP
    IF EXISTS (
      SELECT 1 FROM public.rr_rate_cards
      WHERE company_id = p_company_id AND policy_key = seed.policy_key AND version = seed.version
    ) THEN
      CONTINUE;
    END IF;

    INSERT INTO public.rr_rate_cards
      (company_id, policy_key, counterparty_id, service_code, version, active,
       currency, vat_rate, label, created_by)
    VALUES (
      p_company_id, seed.policy_key, NULL, seed.service_code, seed.version, true,
      seed.currency, seed.vat_rate,
      'Default rates for ' || replace(coalesce(seed.service_code, 'all services'), '_', ' '),
      'sql/078'
    )
    RETURNING id INTO card_id;

    FOR item IN SELECT * FROM jsonb_array_elements(seed.items)
    LOOP
      INSERT INTO public.rr_rate_card_items
        (company_id, rate_card_id, charge_code, label, basis, unit, rate_amount,
         minimum_charge, included_quantity, band_from, band_to, increment,
         vat_treatment, condition, applies_to, sort_order, optional)
      VALUES (
        p_company_id,
        card_id,
        item ->> 'charge_code',
        item ->> 'label',
        item ->> 'basis',
        item ->> 'unit',
        (item ->> 'rate_amount')::numeric,
        (item ->> 'minimum_charge')::numeric,
        (item ->> 'included_quantity')::numeric,
        (item ->> 'band_from')::numeric,
        (item ->> 'band_to')::numeric,
        (item ->> 'increment')::numeric,
        item ->> 'vat_treatment',
        item -> 'condition',
        ARRAY(SELECT jsonb_array_elements_text(item -> 'applies_to'))::text[],
        (item ->> 'sort_order')::integer,
        COALESCE((item ->> 'optional')::boolean, false)
      );
    END LOOP;
  END LOOP;
END
$seed$;

COMMENT ON FUNCTION public.rr_seed_rate_cards(uuid) IS
  'Idempotently seeds the default Road & Recovery rate-card STRUCTURES for one company. All rates are zero: South African towing rates are unregulated, so an operator must set their own before a job can be priced.';

REVOKE ALL ON FUNCTION public.rr_seed_rate_cards(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rr_seed_rate_cards(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.rr_seed_rate_cards(uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.rr_seed_rate_cards(uuid) TO service_role;

-- ---------------------------------------------------------------------------
-- 7. Back-fill: seed every company that already holds the module
-- ---------------------------------------------------------------------------
DO $backfill$
DECLARE
  target uuid;
  applied integer := 0;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='companies' AND column_name='enabled_modules'
  ) THEN
    RAISE NOTICE 'companies.enabled_modules is absent; skipping rate-card seeding.';
    RETURN;
  END IF;

  FOR target IN
    SELECT c.id FROM public.companies c
     WHERE COALESCE(c.enabled_modules, '[]'::jsonb) @> '["road_recovery"]'::jsonb
  LOOP
    PERFORM public.rr_seed_rate_cards(target);
    applied := applied + 1;
  END LOOP;

  RAISE NOTICE 'Road & Recovery rate cards seeded for % companies.', applied;
END
$backfill$;

COMMIT;

NOTIFY pgrst, 'reload schema';

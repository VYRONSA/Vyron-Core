-- 073-road-recovery-requirements.sql
-- VYRON CORE — Road & Recovery Phase 3 (Requirements, Evidence & Compliance).
--
-- ===========================================================================
-- WHAT THIS ADDS
-- ===========================================================================
--
--   public.rr_requirement_policies    versioned policy header (counterparty x service)
--   public.rr_requirement_items       the individual requirements in a policy
--   public.rr_evidence_requirements   the IMMUTABLE per-job requirement snapshot
--   public.rr_evidence_links          evidence item  <->  requirement  (many-to-many)
--   public.rr_requirement_waivers     append-only waivers, with reason and authoriser
--   public.rr_compliance_evaluations  append-only deterministic verdicts
--   public.rr_job_exceptions          operational exceptions and their resolution
--
-- Plus additive claim-form columns on public.rr_service_jobs.
--
-- ===========================================================================
-- THE PROBLEM THIS SOLVES
-- ===========================================================================
--
-- Phase 0 wired an `evidence_complete` guard onto `ready_to_invoice` in four workflows
-- (and `release_authorised` / `disposal_authorised` in storage). Guards fail closed, and
-- the service layer resolved only `authorisation_valid` — so NO job could reach
-- invoice_ready through the service layer. Phase 3 supplies the engine that answers that
-- guard. The guard itself is untouched and is not weakened.
--
-- ===========================================================================
-- WHAT THIS REUSES RATHER THAN REBUILDS
-- ===========================================================================
--
--   public.mobile_workforce_evidence  THE evidence repository. NOT modified again: it was
--       already extended in sql/072 with storage_bucket, storage_path, service_job_id,
--       captured_by_role and metadata. Phase 3 adds only LINKS to it.
--
--       Note on evidence_type: its CHECK is deliberately left alone. The semantic meaning
--       of an item ("this is the VIN photograph") lives on the LINK, not on the evidence
--       row — which is also the only correct place for it, because one photograph may
--       satisfy several requirements at once.
--
--   public.rr_authorisations     already models the authorisation requirement
--   public.rr_service_state_events  the timeline; unchanged
--   public.vyron_audit_log       audit history for waivers and evaluations
--   public.workforce_automation_actions  action routing for exceptions (no parallel
--       action system is created here)
--   sql/030 tenant helpers, sql/049 hardening pattern
--
-- ===========================================================================
-- IMMUTABILITY
-- ===========================================================================
--
-- A job resolves its policy ONCE, at creation, into rr_evidence_requirements. Editing a
-- policy afterwards can never change what an existing job was required to produce —
-- otherwise a tightened policy would retroactively make closed, invoiced jobs
-- non-compliant. rr_compliance_evaluations and rr_requirement_waivers are append-only:
-- a re-evaluation writes a NEW row, and a correction is a new waiver, never an edit.
--
-- Idempotent. Requires sql/070, sql/071, sql/072. Run after sql/072.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------------------------------------------------------------------------
-- 0. Prerequisites
-- ---------------------------------------------------------------------------
DO $prereq$
BEGIN
  IF to_regclass('public.rr_service_jobs') IS NULL THEN
    RAISE EXCEPTION 'Prerequisite missing: public.rr_service_jobs. Run sql/070 before sql/073.';
  END IF;
  IF to_regclass('public.rr_counterparties') IS NULL THEN
    RAISE EXCEPTION 'Prerequisite missing: public.rr_counterparties. Run sql/071 before sql/073.';
  END IF;
  IF to_regclass('public.mobile_workforce_evidence') IS NULL THEN
    RAISE EXCEPTION 'Prerequisite missing: public.mobile_workforce_evidence. Run sql/031 and sql/072 before sql/073.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='mobile_workforce_evidence' AND column_name='service_job_id'
  ) THEN
    RAISE EXCEPTION 'Prerequisite missing: mobile_workforce_evidence.service_job_id. Run sql/072 before sql/073.';
  END IF;
END
$prereq$;

-- ---------------------------------------------------------------------------
-- 1. rr_service_jobs — additive claim-form fields
-- ---------------------------------------------------------------------------
--
-- Every column below is named on the Santam Motor Vehicle Accident Claim Form, which is
-- the most concrete public statement of what a South African insurer asks for. The
-- vehicle already carries registration, VIN, make, model and colour from sql/070.
ALTER TABLE public.rr_service_jobs
  ADD COLUMN IF NOT EXISTS vehicle_engine_number text;

ALTER TABLE public.rr_service_jobs
  ADD COLUMN IF NOT EXISTS customer_licence_number text;

ALTER TABLE public.rr_service_jobs
  ADD COLUMN IF NOT EXISTS customer_licence_expiry date;

ALTER TABLE public.rr_service_jobs
  ADD COLUMN IF NOT EXISTS customer_licence_class text;

ALTER TABLE public.rr_service_jobs
  ADD COLUMN IF NOT EXISTS customer_name text;

ALTER TABLE public.rr_service_jobs
  ADD COLUMN IF NOT EXISTS customer_contact text;

-- Third parties and witnesses are lists; a claim may involve several of each.
ALTER TABLE public.rr_service_jobs
  ADD COLUMN IF NOT EXISTS third_party_details jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE public.rr_service_jobs
  ADD COLUMN IF NOT EXISTS witness_details jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE public.rr_service_jobs
  ADD COLUMN IF NOT EXISTS damage_description text;

ALTER TABLE public.rr_service_jobs
  ADD COLUMN IF NOT EXISTS point_of_impact text;

DO $job_checks$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='rr_service_jobs_third_party_is_array') THEN
    ALTER TABLE public.rr_service_jobs
      ADD CONSTRAINT rr_service_jobs_third_party_is_array
      CHECK (jsonb_typeof(third_party_details) = 'array');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='rr_service_jobs_witness_is_array') THEN
    ALTER TABLE public.rr_service_jobs
      ADD CONSTRAINT rr_service_jobs_witness_is_array
      CHECK (jsonb_typeof(witness_details) = 'array');
  END IF;
END
$job_checks$;

COMMENT ON COLUMN public.rr_service_jobs.vehicle_engine_number IS
  'Engine number. Required alongside the VIN on South African motor claim forms.';

-- ---------------------------------------------------------------------------
-- 2. rr_requirement_policies — versioned, counterparty x service type
-- ---------------------------------------------------------------------------
--
-- counterparty_id NULL = applies to every counterparty (tenant default).
-- service_code    NULL = applies to every service type.
-- Resolution is most-specific-wins; see lib/road-recovery/requirements.ts.
CREATE TABLE IF NOT EXISTS public.rr_requirement_policies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies (id) ON DELETE CASCADE,

  policy_key text NOT NULL,
  counterparty_id uuid,
  service_code text,

  version integer NOT NULL DEFAULT 1,
  active boolean NOT NULL DEFAULT true,
  effective_from timestamptz,
  effective_to timestamptz,

  label text,
  notes text,
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT rr_requirement_policies_key_version_unique UNIQUE (company_id, policy_key, version),
  CONSTRAINT rr_requirement_policies_company_id_id_key UNIQUE (company_id, id),

  CONSTRAINT rr_requirement_policies_counterparty_fk
    FOREIGN KEY (company_id, counterparty_id)
    REFERENCES public.rr_counterparties (company_id, id)
    ON DELETE CASCADE,

  CONSTRAINT rr_requirement_policies_version_check CHECK (version >= 1),
  CONSTRAINT rr_requirement_policies_key_format CHECK (policy_key ~ '^[a-z0-9_]+$'),
  CONSTRAINT rr_requirement_policies_service_code_check CHECK (
    service_code IS NULL OR service_code IN (
      'accident_recovery','tow_in','jump_start','roadside_assistance',
      'bystand','heavy_recovery','vehicle_movement','storage'
    )
  ),
  CONSTRAINT rr_requirement_policies_window_check CHECK (
    effective_from IS NULL OR effective_to IS NULL OR effective_to >= effective_from
  )
);

-- Only one ACTIVE version per policy key per company.
CREATE UNIQUE INDEX IF NOT EXISTS idx_rr_requirement_policies_active
  ON public.rr_requirement_policies (company_id, policy_key)
  WHERE active;

CREATE INDEX IF NOT EXISTS idx_rr_requirement_policies_resolution
  ON public.rr_requirement_policies (company_id, service_code, counterparty_id, active);

COMMENT ON TABLE public.rr_requirement_policies IS
  'Versioned evidence-requirement policies, configurable per counterparty and service type. Insurer requirements are contractual and differ per counterparty, so they are data here and are never hardcoded in application logic.';

-- ---------------------------------------------------------------------------
-- 3. rr_requirement_items — the requirements inside a policy
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.rr_requirement_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies (id) ON DELETE CASCADE,
  policy_id uuid NOT NULL,

  requirement_code text NOT NULL,
  label text NOT NULL,
  evidence_kind text NOT NULL,
  mandatory boolean NOT NULL DEFAULT true,
  /** Declarative condition, never executable code. See lib/road-recovery/requirements.ts. */
  condition jsonb NOT NULL DEFAULT '{"always":true}'::jsonb,
  min_count integer NOT NULL DEFAULT 1,
  blocking_scopes text[] NOT NULL DEFAULT ARRAY['invoice']::text[],
  guidance text,
  sort_order integer NOT NULL DEFAULT 100,
  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT rr_requirement_items_unique UNIQUE (company_id, policy_id, requirement_code),
  CONSTRAINT rr_requirement_items_company_id_id_key UNIQUE (company_id, id),
  CONSTRAINT rr_requirement_items_policy_fk
    FOREIGN KEY (company_id, policy_id)
    REFERENCES public.rr_requirement_policies (company_id, id)
    ON DELETE CASCADE,

  CONSTRAINT rr_requirement_items_code_format CHECK (requirement_code ~ '^[a-z0-9_]+$'),
  CONSTRAINT rr_requirement_items_kind_check CHECK (
    evidence_kind IN ('photo','document','field','signature','gps','authorisation','reference','handover')
  ),
  CONSTRAINT rr_requirement_items_min_count_check CHECK (min_count >= 1),
  CONSTRAINT rr_requirement_items_scopes_check CHECK (
    blocking_scopes <@ ARRAY['transition','invoice','release','pack']::text[]
  ),
  -- An optional requirement that blocks something is a contradiction.
  CONSTRAINT rr_requirement_items_optional_never_blocks CHECK (
    mandatory OR cardinality(blocking_scopes) = 0
  )
);

CREATE INDEX IF NOT EXISTS idx_rr_requirement_items_policy
  ON public.rr_requirement_items (company_id, policy_id, sort_order);

-- ---------------------------------------------------------------------------
-- 4. rr_evidence_requirements — the IMMUTABLE per-job snapshot
-- ---------------------------------------------------------------------------
--
-- Resolved once when the job is created. A later policy edit must never change what an
-- existing job was required to produce: a tightened policy would otherwise retroactively
-- make already-invoiced jobs non-compliant, which is indefensible to a counterparty.
CREATE TABLE IF NOT EXISTS public.rr_evidence_requirements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies (id) ON DELETE CASCADE,
  service_job_id uuid NOT NULL,

  /** Which policy produced this snapshot. Recorded for provenance, not for lookup. */
  policy_id uuid,
  policy_key text,
  policy_version integer,
  resolved_at timestamptz NOT NULL DEFAULT now(),

  requirement_code text NOT NULL,
  label text NOT NULL,
  evidence_kind text NOT NULL,
  mandatory boolean NOT NULL DEFAULT true,
  condition jsonb NOT NULL DEFAULT '{"always":true}'::jsonb,
  min_count integer NOT NULL DEFAULT 1,
  blocking_scopes text[] NOT NULL DEFAULT ARRAY['invoice']::text[],
  guidance text,
  sort_order integer NOT NULL DEFAULT 100,

  CONSTRAINT rr_evidence_requirements_unique UNIQUE (company_id, service_job_id, requirement_code),
  CONSTRAINT rr_evidence_requirements_company_id_id_key UNIQUE (company_id, id),
  CONSTRAINT rr_evidence_requirements_job_fk
    FOREIGN KEY (company_id, service_job_id)
    REFERENCES public.rr_service_jobs (company_id, id)
    ON DELETE CASCADE,
  CONSTRAINT rr_evidence_requirements_kind_check CHECK (
    evidence_kind IN ('photo','document','field','signature','gps','authorisation','reference','handover')
  ),
  CONSTRAINT rr_evidence_requirements_min_count_check CHECK (min_count >= 1),
  CONSTRAINT rr_evidence_requirements_scopes_check CHECK (
    blocking_scopes <@ ARRAY['transition','invoice','release','pack']::text[]
  )
);

CREATE INDEX IF NOT EXISTS idx_rr_evidence_requirements_job
  ON public.rr_evidence_requirements (company_id, service_job_id, sort_order);

COMMENT ON TABLE public.rr_evidence_requirements IS
  'Immutable per-job requirement snapshot, resolved at job creation. Editing a policy never alters the requirements of an existing job.';

-- The snapshot is frozen once written: a job cannot have its requirements rewritten.
CREATE OR REPLACE FUNCTION public.rr_evidence_requirements_forbid_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $forbid$
BEGIN
  RAISE EXCEPTION
    'public.rr_evidence_requirements is an immutable per-job snapshot: % is not permitted. Requirements are resolved once, at job creation.',
    TG_OP;
END
$forbid$;

DROP TRIGGER IF EXISTS rr_evidence_requirements_immutable ON public.rr_evidence_requirements;

CREATE TRIGGER rr_evidence_requirements_immutable
  BEFORE UPDATE ON public.rr_evidence_requirements
  FOR EACH ROW
  EXECUTE FUNCTION public.rr_evidence_requirements_forbid_mutation();

-- ---------------------------------------------------------------------------
-- 5. rr_evidence_links — evidence item <-> requirement, many-to-many
-- ---------------------------------------------------------------------------
--
-- One photograph may satisfy several requirements (a plate shot that also evidences
-- arrival condition), and one requirement may need several items (four-corner condition
-- sets). Hence a link table rather than a column on either side.
--
-- This is ALSO where the semantic meaning of an evidence item lives. mobile_workforce_
-- evidence.evidence_type stays coarse and unmodified; the requirement code says what the
-- item is being relied on for.
CREATE TABLE IF NOT EXISTS public.rr_evidence_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies (id) ON DELETE CASCADE,
  service_job_id uuid NOT NULL,

  /** The captured item in the EXISTING evidence repository. */
  evidence_id uuid NOT NULL REFERENCES public.mobile_workforce_evidence (id) ON DELETE CASCADE,
  requirement_id uuid NOT NULL,
  requirement_code text NOT NULL,

  verification_status text NOT NULL DEFAULT 'accepted',
  verified_by text,
  verified_at timestamptz,
  rejected_reason text,

  linked_by text,
  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT rr_evidence_links_unique UNIQUE (company_id, evidence_id, requirement_id),
  CONSTRAINT rr_evidence_links_company_id_id_key UNIQUE (company_id, id),
  CONSTRAINT rr_evidence_links_job_fk
    FOREIGN KEY (company_id, service_job_id)
    REFERENCES public.rr_service_jobs (company_id, id)
    ON DELETE CASCADE,
  CONSTRAINT rr_evidence_links_requirement_fk
    FOREIGN KEY (company_id, requirement_id)
    REFERENCES public.rr_evidence_requirements (company_id, id)
    ON DELETE CASCADE,
  CONSTRAINT rr_evidence_links_status_check CHECK (
    verification_status IN ('pending','accepted','rejected')
  ),
  CONSTRAINT rr_evidence_links_rejection_recorded CHECK (
    verification_status <> 'rejected' OR rejected_reason IS NOT NULL
  )
);

CREATE INDEX IF NOT EXISTS idx_rr_evidence_links_job
  ON public.rr_evidence_links (company_id, service_job_id, requirement_code);

CREATE INDEX IF NOT EXISTS idx_rr_evidence_links_evidence
  ON public.rr_evidence_links (company_id, evidence_id);

-- ---------------------------------------------------------------------------
-- 6. rr_requirement_waivers — append-only, always visible
-- ---------------------------------------------------------------------------
--
-- A waiver SATISFIES a requirement but never HIDES it. The compliance result reports
-- waived requirements separately from evidenced ones, and `waived_compliant` is a
-- distinct status from `compliant`, so a counterparty can see at a glance whether a job
-- was fully evidenced or partly excused.
--
-- Waivers exist because the operational reality demands them: police take a vehicle, a
-- customer refuses to sign, a basement has no GPS. Without an honest waiver, staff enter
-- false data to clear a checklist — which is far worse.
CREATE TABLE IF NOT EXISTS public.rr_requirement_waivers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies (id) ON DELETE CASCADE,
  service_job_id uuid NOT NULL,
  requirement_id uuid NOT NULL,
  requirement_code text NOT NULL,

  reason_code text NOT NULL,
  reason_detail text,

  waived_by text NOT NULL,
  approved_at timestamptz NOT NULL DEFAULT now(),
  /** The exception that justifies this waiver, where one was raised. */
  exception_id uuid,

  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT rr_requirement_waivers_company_id_id_key UNIQUE (company_id, id),
  CONSTRAINT rr_requirement_waivers_job_fk
    FOREIGN KEY (company_id, service_job_id)
    REFERENCES public.rr_service_jobs (company_id, id)
    ON DELETE CASCADE,
  CONSTRAINT rr_requirement_waivers_requirement_fk
    FOREIGN KEY (company_id, requirement_id)
    REFERENCES public.rr_evidence_requirements (company_id, id)
    ON DELETE CASCADE,
  CONSTRAINT rr_requirement_waivers_reason_check CHECK (
    reason_code IN (
      'police_took_custody','customer_refused','gps_unavailable','vehicle_inaccessible',
      'third_party_uncooperative','not_applicable_on_scene','counterparty_agreed','other'
    )
  ),
  -- "other" must be explained; a bare "other" is not an audit trail.
  CONSTRAINT rr_requirement_waivers_other_explained CHECK (
    reason_code <> 'other' OR (reason_detail IS NOT NULL AND length(btrim(reason_detail)) > 0)
  ),
  CONSTRAINT rr_requirement_waivers_authoriser_present CHECK (length(btrim(waived_by)) > 0)
);

CREATE INDEX IF NOT EXISTS idx_rr_requirement_waivers_job
  ON public.rr_requirement_waivers (company_id, service_job_id, requirement_code);

CREATE OR REPLACE FUNCTION public.rr_requirement_waivers_forbid_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $forbid$
BEGIN
  RAISE EXCEPTION
    'public.rr_requirement_waivers is append-only: % is not permitted. Record a new waiver instead.',
    TG_OP;
END
$forbid$;

DROP TRIGGER IF EXISTS rr_requirement_waivers_append_only ON public.rr_requirement_waivers;

CREATE TRIGGER rr_requirement_waivers_append_only
  BEFORE UPDATE OR DELETE ON public.rr_requirement_waivers
  FOR EACH ROW
  EXECUTE FUNCTION public.rr_requirement_waivers_forbid_mutation();

-- ---------------------------------------------------------------------------
-- 7. rr_compliance_evaluations — append-only deterministic verdicts
-- ---------------------------------------------------------------------------
--
-- A compliance verdict may be shown to an insurer in a dispute, so it is frozen with the
-- engine version that produced it. A re-evaluation writes a NEW row.
CREATE TABLE IF NOT EXISTS public.rr_compliance_evaluations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies (id) ON DELETE CASCADE,
  service_job_id uuid NOT NULL,

  status text NOT NULL,
  /** The answer to the Phase 0 `evidence_complete` guard. */
  evidence_complete boolean NOT NULL,
  scope text NOT NULL DEFAULT 'invoice',

  results jsonb NOT NULL DEFAULT '[]'::jsonb,
  missing_codes text[] NOT NULL DEFAULT ARRAY[]::text[],
  waived_codes text[] NOT NULL DEFAULT ARRAY[]::text[],
  blocking_codes text[] NOT NULL DEFAULT ARRAY[]::text[],

  satisfied_count integer NOT NULL DEFAULT 0,
  applicable_count integer NOT NULL DEFAULT 0,
  completeness_percent numeric(5,1) NOT NULL DEFAULT 0,

  policy_key text,
  policy_version integer,
  engine_version text NOT NULL,
  job_state text,
  evaluated_by text,
  evaluated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT rr_compliance_evaluations_company_id_id_key UNIQUE (company_id, id),
  CONSTRAINT rr_compliance_evaluations_job_fk
    FOREIGN KEY (company_id, service_job_id)
    REFERENCES public.rr_service_jobs (company_id, id)
    ON DELETE CASCADE,
  CONSTRAINT rr_compliance_evaluations_status_check CHECK (
    status IN ('compliant','waived_compliant','incomplete','non_compliant')
  ),
  CONSTRAINT rr_compliance_evaluations_scope_check CHECK (
    scope IN ('transition','invoice','release','pack')
  ),
  -- The verdict and the guard must agree: blocking requirements mean not complete.
  CONSTRAINT rr_compliance_evaluations_guard_consistent CHECK (
    evidence_complete = (cardinality(blocking_codes) = 0)
  ),
  CONSTRAINT rr_compliance_evaluations_non_compliant_consistent CHECK (
    (status = 'non_compliant') = (cardinality(blocking_codes) > 0)
  ),
  CONSTRAINT rr_compliance_evaluations_counts_check CHECK (
    satisfied_count >= 0 AND applicable_count >= 0 AND satisfied_count <= applicable_count
  ),
  CONSTRAINT rr_compliance_evaluations_percent_check CHECK (
    completeness_percent >= 0 AND completeness_percent <= 100
  ),
  CONSTRAINT rr_compliance_evaluations_results_is_array CHECK (jsonb_typeof(results) = 'array')
);

CREATE INDEX IF NOT EXISTS idx_rr_compliance_evaluations_job
  ON public.rr_compliance_evaluations (company_id, service_job_id, evaluated_at DESC);

COMMENT ON TABLE public.rr_compliance_evaluations IS
  'Append-only deterministic compliance verdicts. AI never produces one; it may later explain one. Frozen with the engine version that computed it.';

CREATE OR REPLACE FUNCTION public.rr_compliance_evaluations_forbid_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $forbid$
BEGIN
  RAISE EXCEPTION
    'public.rr_compliance_evaluations is append-only: % is not permitted. Re-evaluate to produce a new verdict instead.',
    TG_OP;
END
$forbid$;

DROP TRIGGER IF EXISTS rr_compliance_evaluations_append_only ON public.rr_compliance_evaluations;

CREATE TRIGGER rr_compliance_evaluations_append_only
  BEFORE UPDATE OR DELETE ON public.rr_compliance_evaluations
  FOR EACH ROW
  EXECUTE FUNCTION public.rr_compliance_evaluations_forbid_mutation();

-- ---------------------------------------------------------------------------
-- 8. rr_job_exceptions
-- ---------------------------------------------------------------------------
--
-- Road & Recovery specific on purpose: VYRON CORE has no generic exception platform
-- (only domain-specific event tables such as time_exceptions and workforce_risk_events),
-- and inventing one for a single consumer would be premature. Action ROUTING reuses the
-- existing workforce_automation_actions pipeline rather than creating a parallel system.
CREATE TABLE IF NOT EXISTS public.rr_job_exceptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies (id) ON DELETE CASCADE,
  service_job_id uuid NOT NULL,

  exception_code text NOT NULL,
  severity text NOT NULL DEFAULT 'medium',
  detail text,

  detected_by text NOT NULL DEFAULT 'system',
  detected_by_actor text,
  /** The workflow state the job was in when this was raised. */
  state_at_detection text,
  requirement_code text,

  resolution_status text NOT NULL DEFAULT 'open',
  resolution_action text,
  resolution_notes text,
  resolved_by text,
  resolved_at timestamptz,

  /** Set when this exception justified waiving a requirement. */
  waiver_id uuid,
  /** Set when this exception was routed into the existing automation pipeline. */
  automation_action_id uuid,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT rr_job_exceptions_company_id_id_key UNIQUE (company_id, id),
  CONSTRAINT rr_job_exceptions_job_fk
    FOREIGN KEY (company_id, service_job_id)
    REFERENCES public.rr_service_jobs (company_id, id)
    ON DELETE CASCADE,
  CONSTRAINT rr_job_exceptions_waiver_fk
    FOREIGN KEY (company_id, waiver_id)
    REFERENCES public.rr_requirement_waivers (company_id, id)
    ON DELETE SET NULL,

  CONSTRAINT rr_job_exceptions_code_check CHECK (
    exception_code IN (
      'missing_photograph','gps_unavailable','expired_certification','missing_authorisation',
      'expired_authorisation','destination_changed','customer_refused_signature',
      'vehicle_damage_disputed','police_custody','vehicle_inaccessible','cancelled_job',
      'no_show','wrong_vehicle','wrong_destination','storage_overrun','third_party_uncooperative'
    )
  ),
  CONSTRAINT rr_job_exceptions_severity_check CHECK (
    severity IN ('low','medium','high','critical')
  ),
  CONSTRAINT rr_job_exceptions_detected_by_check CHECK (
    detected_by IN ('system','controller','driver','counterparty')
  ),
  CONSTRAINT rr_job_exceptions_resolution_check CHECK (
    resolution_status IN ('open','acknowledged','resolved','waived','cancelled')
  ),
  -- A resolved exception must say who resolved it and when.
  CONSTRAINT rr_job_exceptions_resolution_recorded CHECK (
    resolution_status NOT IN ('resolved','waived')
    OR (resolved_at IS NOT NULL AND resolved_by IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_rr_job_exceptions_job
  ON public.rr_job_exceptions (company_id, service_job_id, resolution_status);

CREATE INDEX IF NOT EXISTS idx_rr_job_exceptions_open
  ON public.rr_job_exceptions (company_id, severity, created_at DESC)
  WHERE resolution_status IN ('open','acknowledged');

-- ---------------------------------------------------------------------------
-- 9. Row level security + tenant isolation
-- ---------------------------------------------------------------------------
ALTER TABLE public.rr_requirement_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rr_requirement_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rr_evidence_requirements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rr_evidence_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rr_requirement_waivers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rr_compliance_evaluations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rr_job_exceptions ENABLE ROW LEVEL SECURITY;

DO $tenant$
DECLARE
  tbl text;
BEGIN
  IF to_regprocedure('public.vyron_user_company_ids()') IS NULL
     OR to_regprocedure('public.vyron_is_platform_operator()') IS NULL THEN
    RAISE NOTICE
      'Tenant helper functions missing (sql/030). Phase 3 tables have RLS enabled with NO policy, which denies all access until sql/030 and then sql/073 are run.';
    RETURN;
  END IF;

  FOR tbl IN
    SELECT unnest(ARRAY[
      'rr_requirement_policies',
      'rr_requirement_items',
      'rr_evidence_requirements',
      'rr_evidence_links',
      'rr_requirement_waivers',
      'rr_compliance_evaluations',
      'rr_job_exceptions'
    ])
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

REVOKE ALL ON public.rr_requirement_policies FROM anon;
REVOKE ALL ON public.rr_requirement_items FROM anon;
REVOKE ALL ON public.rr_evidence_requirements FROM anon;
REVOKE ALL ON public.rr_evidence_links FROM anon;
REVOKE ALL ON public.rr_requirement_waivers FROM anon;
REVOKE ALL ON public.rr_compliance_evaluations FROM anon;
REVOKE ALL ON public.rr_job_exceptions FROM anon;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.rr_requirement_policies TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.rr_requirement_items TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.rr_evidence_links TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.rr_job_exceptions TO authenticated;

-- Immutable per-job snapshot: written once, never rewritten.
GRANT SELECT, INSERT, DELETE ON public.rr_evidence_requirements TO authenticated;
REVOKE UPDATE ON public.rr_evidence_requirements FROM authenticated;

-- Append-only. See the triggers above.
GRANT SELECT, INSERT ON public.rr_requirement_waivers TO authenticated;
REVOKE UPDATE, DELETE, TRUNCATE ON public.rr_requirement_waivers FROM authenticated;

GRANT SELECT, INSERT ON public.rr_compliance_evaluations TO authenticated;
REVOKE UPDATE, DELETE, TRUNCATE ON public.rr_compliance_evaluations FROM authenticated;

-- ---------------------------------------------------------------------------
-- 10. Seeding: the researched tenant-default policies
-- ---------------------------------------------------------------------------
--
-- Generated from lib/road-recovery/requirement-catalogue.ts; the parity test fails if
-- the two diverge. These are DEFAULTS: a counterparty-specific policy outranks them, and
-- a tenant may edit or deactivate any of them without a migration.
CREATE OR REPLACE FUNCTION public.rr_seed_requirement_policies(p_company_id uuid)
RETURNS void
LANGUAGE plpgsql
AS $seed$
DECLARE
  seed record;
  policy_id uuid;
  item jsonb;
BEGIN
  IF p_company_id IS NULL THEN
    RAISE EXCEPTION 'rr_seed_requirement_policies: p_company_id is required.';
  END IF;

  FOR seed IN
    SELECT * FROM (VALUES
-- >>> GENERATED: REQUIREMENT POLICIES (see header) >>>
    ('default_accident_recovery', 'accident_recovery', 1, $rr_req$[{"requirement_code":"authorisation_record","label":"Authorisation to proceed","evidence_kind":"authorisation","mandatory":true,"condition":{"field":"counterparty_present","op":"eq","value":true},"min_count":1,"blocking_scopes":["invoice"],"guidance":"Assistance providers exclude work arranged without prior authorisation. Capture the authorisation number and who gave it.","sort_order":10},{"requirement_code":"claim_reference","label":"Claim or policy reference","evidence_kind":"reference","mandatory":true,"condition":{"field":"counterparty_present","op":"eq","value":true},"min_count":1,"blocking_scopes":["invoice"],"guidance":"The reference the counterparty will use to match this job to their claim.","sort_order":20},{"requirement_code":"saps_ar_number","label":"SAPS accident report (AR) number","evidence_kind":"reference","mandatory":true,"condition":{"any":[{"field":"police_involved","op":"eq","value":true},{"field":"casualty_flag","op":"eq","value":true}]},"min_count":1,"blocking_scopes":["invoice"],"guidance":"The National Road Traffic Act requires accidents involving injury or death to be reported to SAPS within 24 hours. Insurers ask for the AR number on third-party claims.","sort_order":25},{"requirement_code":"registration_photo","label":"Photograph of the registration plate","evidence_kind":"photo","mandatory":true,"condition":{"always":true},"min_count":1,"blocking_scopes":["invoice"],"guidance":"A legible plate photograph ties every other item of evidence to this vehicle.","sort_order":30},{"requirement_code":"vin_photo","label":"Photograph of the VIN","evidence_kind":"photo","mandatory":true,"condition":{"always":true},"min_count":1,"blocking_scopes":["invoice"],"guidance":"Insurers require the VIN on the claim form; a photograph prevents transcription disputes.","sort_order":40},{"requirement_code":"engine_number","label":"Engine number recorded","evidence_kind":"field","mandatory":true,"condition":{"always":true},"min_count":1,"blocking_scopes":["invoice"],"guidance":"Required on the motor claim form alongside the VIN.","sort_order":50},{"requirement_code":"gps_arrival","label":"GPS-verified arrival on scene","evidence_kind":"gps","mandatory":true,"condition":{"always":true},"min_count":1,"blocking_scopes":["invoice"],"guidance":"Recorded automatically when the driver reports arrival within the scene radius.","sort_order":60},{"requirement_code":"scene_photos","label":"Scene photographs","evidence_kind":"photo","mandatory":true,"condition":{"always":true},"min_count":2,"blocking_scopes":["invoice"],"guidance":"Wide shots showing the vehicle in its surroundings before anything is moved.","sort_order":70},{"requirement_code":"pre_service_condition","label":"Pre-service condition photographs","evidence_kind":"photo","mandatory":true,"condition":{"always":true},"min_count":4,"blocking_scopes":["invoice"],"guidance":"Four corners before the vehicle is touched. This is the operator's primary defence against a later claim of pre-existing damage.","sort_order":80},{"requirement_code":"damage_description","label":"Damage description and point of impact","evidence_kind":"field","mandatory":true,"condition":{"always":true},"min_count":1,"blocking_scopes":["invoice"],"guidance":"Structured description matching the claim form's damage and point-of-impact fields.","sort_order":90},{"requirement_code":"loading_secured","label":"Vehicle loaded and secured","evidence_kind":"photo","mandatory":true,"condition":{"always":true},"min_count":1,"blocking_scopes":["invoice"],"guidance":"Shows the casualty vehicle correctly secured before transit.","sort_order":100},{"requirement_code":"delivery_proof","label":"Delivery at destination","evidence_kind":"photo","mandatory":true,"condition":{"field":"has_destination","op":"eq","value":true},"min_count":1,"blocking_scopes":["invoice"],"guidance":"The vehicle at the destination, showing where it was left.","sort_order":110},{"requirement_code":"handover_record","label":"Handover to receiving party","evidence_kind":"handover","mandatory":true,"condition":{"field":"has_destination","op":"eq","value":true},"min_count":1,"blocking_scopes":["invoice"],"guidance":"Who received the vehicle, when and where. Phase 4 extends this into a full chain of custody.","sort_order":120},{"requirement_code":"customer_acknowledgement","label":"Customer acknowledgement","evidence_kind":"signature","mandatory":true,"condition":{"always":true},"min_count":1,"blocking_scopes":["invoice"],"guidance":"Customer confirmation that the service was performed. Waive with a reason if the customer is absent or refuses.","sort_order":130},{"requirement_code":"third_party_details","label":"Third party details","evidence_kind":"field","mandatory":true,"condition":{"field":"third_party_involved","op":"eq","value":true},"min_count":1,"blocking_scopes":["invoice"],"guidance":"Driver, vehicle and insurer of the other party, as the claim form requires.","sort_order":140},{"requirement_code":"witness_details","label":"Witness details","evidence_kind":"field","mandatory":false,"condition":{"always":true},"min_count":1,"blocking_scopes":[],"guidance":"Optional but valuable: witness names and contacts strengthen a disputed claim.","sort_order":150},{"requirement_code":"customer_licence","label":"Customer driving licence","evidence_kind":"document","mandatory":true,"condition":{"field":"counterparty_present","op":"eq","value":true},"min_count":1,"blocking_scopes":["invoice"],"guidance":"Licence number, expiry and class — required on the motor claim form.","sort_order":160}]$rr_req$::jsonb),
    ('default_tow_in', 'tow_in', 1, $rr_req$[{"requirement_code":"authorisation_record","label":"Authorisation to proceed","evidence_kind":"authorisation","mandatory":true,"condition":{"field":"counterparty_present","op":"eq","value":true},"min_count":1,"blocking_scopes":["invoice"],"guidance":"Assistance providers exclude work arranged without prior authorisation. Capture the authorisation number and who gave it.","sort_order":10},{"requirement_code":"claim_reference","label":"Claim or policy reference","evidence_kind":"reference","mandatory":true,"condition":{"field":"counterparty_present","op":"eq","value":true},"min_count":1,"blocking_scopes":["invoice"],"guidance":"The reference the counterparty will use to match this job to their claim.","sort_order":20},{"requirement_code":"registration_photo","label":"Photograph of the registration plate","evidence_kind":"photo","mandatory":true,"condition":{"always":true},"min_count":1,"blocking_scopes":["invoice"],"guidance":"A legible plate photograph ties every other item of evidence to this vehicle.","sort_order":30},{"requirement_code":"vin_photo","label":"Photograph of the VIN","evidence_kind":"photo","mandatory":true,"condition":{"always":true},"min_count":1,"blocking_scopes":["invoice"],"guidance":"Insurers require the VIN on the claim form; a photograph prevents transcription disputes.","sort_order":40},{"requirement_code":"engine_number","label":"Engine number recorded","evidence_kind":"field","mandatory":true,"condition":{"always":true},"min_count":1,"blocking_scopes":["invoice"],"guidance":"Required on the motor claim form alongside the VIN.","sort_order":50},{"requirement_code":"gps_arrival","label":"GPS-verified arrival on scene","evidence_kind":"gps","mandatory":true,"condition":{"always":true},"min_count":1,"blocking_scopes":["invoice"],"guidance":"Recorded automatically when the driver reports arrival within the scene radius.","sort_order":60},{"requirement_code":"pre_service_condition","label":"Pre-service condition photographs","evidence_kind":"photo","mandatory":true,"condition":{"always":true},"min_count":4,"blocking_scopes":["invoice"],"guidance":"Four corners before the vehicle is touched. This is the operator's primary defence against a later claim of pre-existing damage.","sort_order":80},{"requirement_code":"damage_description","label":"Damage description and point of impact","evidence_kind":"field","mandatory":true,"condition":{"always":true},"min_count":1,"blocking_scopes":["invoice"],"guidance":"Structured description matching the claim form's damage and point-of-impact fields.","sort_order":90},{"requirement_code":"loading_secured","label":"Vehicle loaded and secured","evidence_kind":"photo","mandatory":true,"condition":{"always":true},"min_count":1,"blocking_scopes":["invoice"],"guidance":"Shows the casualty vehicle correctly secured before transit.","sort_order":100},{"requirement_code":"delivery_proof","label":"Delivery at destination","evidence_kind":"photo","mandatory":true,"condition":{"field":"has_destination","op":"eq","value":true},"min_count":1,"blocking_scopes":["invoice"],"guidance":"The vehicle at the destination, showing where it was left.","sort_order":110},{"requirement_code":"handover_record","label":"Handover to receiving party","evidence_kind":"handover","mandatory":true,"condition":{"field":"has_destination","op":"eq","value":true},"min_count":1,"blocking_scopes":["invoice"],"guidance":"Who received the vehicle, when and where. Phase 4 extends this into a full chain of custody.","sort_order":120},{"requirement_code":"customer_acknowledgement","label":"Customer acknowledgement","evidence_kind":"signature","mandatory":true,"condition":{"always":true},"min_count":1,"blocking_scopes":["invoice"],"guidance":"Customer confirmation that the service was performed. Waive with a reason if the customer is absent or refuses.","sort_order":130},{"requirement_code":"customer_licence","label":"Customer driving licence","evidence_kind":"document","mandatory":true,"condition":{"field":"counterparty_present","op":"eq","value":true},"min_count":1,"blocking_scopes":["invoice"],"guidance":"Licence number, expiry and class — required on the motor claim form.","sort_order":160},{"requirement_code":"tow_distance","label":"Distance towed","evidence_kind":"field","mandatory":true,"condition":{"always":true},"min_count":1,"blocking_scopes":["invoice"],"guidance":"Origin to destination distance — assistance providers rate and cap on it.","sort_order":115}]$rr_req$::jsonb),
    ('default_jump_start', 'jump_start', 1, $rr_req$[{"requirement_code":"authorisation_record","label":"Authorisation to proceed","evidence_kind":"authorisation","mandatory":true,"condition":{"field":"counterparty_present","op":"eq","value":true},"min_count":1,"blocking_scopes":["invoice"],"guidance":"Assistance providers exclude work arranged without prior authorisation. Capture the authorisation number and who gave it.","sort_order":10},{"requirement_code":"claim_reference","label":"Claim or policy reference","evidence_kind":"reference","mandatory":true,"condition":{"field":"counterparty_present","op":"eq","value":true},"min_count":1,"blocking_scopes":["invoice"],"guidance":"The reference the counterparty will use to match this job to their claim.","sort_order":20},{"requirement_code":"registration_photo","label":"Photograph of the registration plate","evidence_kind":"photo","mandatory":true,"condition":{"always":true},"min_count":1,"blocking_scopes":["invoice"],"guidance":null,"sort_order":30},{"requirement_code":"gps_arrival","label":"GPS-verified arrival on scene","evidence_kind":"gps","mandatory":true,"condition":{"always":true},"min_count":1,"blocking_scopes":["invoice"],"guidance":"Recorded automatically when the driver reports arrival within the scene radius.","sort_order":60},{"requirement_code":"diagnosis_outcome","label":"Diagnosis and outcome","evidence_kind":"field","mandatory":true,"condition":{"always":true},"min_count":1,"blocking_scopes":["invoice"],"guidance":"What was wrong, what was done, and whether it was resolved on scene. Assistance providers require the repair attempt and outcome.","sort_order":90},{"requirement_code":"service_photo","label":"Photograph of the service performed","evidence_kind":"photo","mandatory":false,"condition":{"always":true},"min_count":1,"blocking_scopes":[],"guidance":null,"sort_order":100},{"requirement_code":"customer_acknowledgement","label":"Customer acknowledgement","evidence_kind":"signature","mandatory":true,"condition":{"always":true},"min_count":1,"blocking_scopes":["invoice"],"guidance":"Customer confirmation that the service was performed. Waive with a reason if the customer is absent or refuses.","sort_order":130}]$rr_req$::jsonb),
    ('default_roadside_assistance', 'roadside_assistance', 1, $rr_req$[{"requirement_code":"authorisation_record","label":"Authorisation to proceed","evidence_kind":"authorisation","mandatory":true,"condition":{"field":"counterparty_present","op":"eq","value":true},"min_count":1,"blocking_scopes":["invoice"],"guidance":"Assistance providers exclude work arranged without prior authorisation. Capture the authorisation number and who gave it.","sort_order":10},{"requirement_code":"claim_reference","label":"Claim or policy reference","evidence_kind":"reference","mandatory":true,"condition":{"field":"counterparty_present","op":"eq","value":true},"min_count":1,"blocking_scopes":["invoice"],"guidance":"The reference the counterparty will use to match this job to their claim.","sort_order":20},{"requirement_code":"registration_photo","label":"Photograph of the registration plate","evidence_kind":"photo","mandatory":true,"condition":{"always":true},"min_count":1,"blocking_scopes":["invoice"],"guidance":null,"sort_order":30},{"requirement_code":"gps_arrival","label":"GPS-verified arrival on scene","evidence_kind":"gps","mandatory":true,"condition":{"always":true},"min_count":1,"blocking_scopes":["invoice"],"guidance":"Recorded automatically when the driver reports arrival within the scene radius.","sort_order":60},{"requirement_code":"diagnosis_outcome","label":"Diagnosis and outcome","evidence_kind":"field","mandatory":true,"condition":{"always":true},"min_count":1,"blocking_scopes":["invoice"],"guidance":"What was wrong, what was done, and whether it was resolved on scene. Assistance providers require the repair attempt and outcome.","sort_order":90},{"requirement_code":"service_photo","label":"Photograph of the service performed","evidence_kind":"photo","mandatory":false,"condition":{"always":true},"min_count":1,"blocking_scopes":[],"guidance":null,"sort_order":100},{"requirement_code":"customer_acknowledgement","label":"Customer acknowledgement","evidence_kind":"signature","mandatory":true,"condition":{"always":true},"min_count":1,"blocking_scopes":["invoice"],"guidance":"Customer confirmation that the service was performed. Waive with a reason if the customer is absent or refuses.","sort_order":130}]$rr_req$::jsonb),
    ('default_bystand', 'bystand', 1, $rr_req$[{"requirement_code":"authorisation_record","label":"Authorisation to proceed","evidence_kind":"authorisation","mandatory":true,"condition":{"field":"counterparty_present","op":"eq","value":true},"min_count":1,"blocking_scopes":["invoice"],"guidance":"Assistance providers exclude work arranged without prior authorisation. Capture the authorisation number and who gave it.","sort_order":10},{"requirement_code":"claim_reference","label":"Claim or policy reference","evidence_kind":"reference","mandatory":true,"condition":{"field":"counterparty_present","op":"eq","value":true},"min_count":1,"blocking_scopes":["invoice"],"guidance":"The reference the counterparty will use to match this job to their claim.","sort_order":20},{"requirement_code":"bystand_reason","label":"Reason for attendance","evidence_kind":"field","mandatory":true,"condition":{"always":true},"min_count":1,"blocking_scopes":["invoice"],"guidance":"The configured attendance reason, plus detail where the reason requires it.","sort_order":25},{"requirement_code":"gps_arrival","label":"GPS-verified arrival on scene","evidence_kind":"gps","mandatory":true,"condition":{"always":true},"min_count":1,"blocking_scopes":["invoice"],"guidance":"Recorded automatically when the driver reports arrival within the scene radius.","sort_order":60},{"requirement_code":"bystand_scene_photo","label":"Scene photograph on arrival","evidence_kind":"photo","mandatory":true,"condition":{"always":true},"min_count":1,"blocking_scopes":["invoice"],"guidance":"Establishes what the crew found on arrival.","sort_order":70},{"requirement_code":"bystand_periodic_presence","label":"Periodic presence records","evidence_kind":"gps","mandatory":true,"condition":{"always":true},"min_count":2,"blocking_scopes":["invoice"],"guidance":"Periodic presence captured while standing by. Captured while the driver app is open — VYRON does not claim unattended background tracking.","sort_order":75},{"requirement_code":"bystand_observation_report","label":"Observation report","evidence_kind":"document","mandatory":true,"condition":{"always":true},"min_count":1,"blocking_scopes":["invoice"],"guidance":"What happened on scene, who attended, and how the attendance ended.","sort_order":90},{"requirement_code":"bystand_stand_down_record","label":"Stand-down record","evidence_kind":"field","mandatory":true,"condition":{"always":true},"min_count":1,"blocking_scopes":["invoice"],"guidance":"Who released the crew, when and by what channel.","sort_order":120},{"requirement_code":"bystand_conversion_reason","label":"Conversion reason","evidence_kind":"field","mandatory":true,"condition":{"field":"converted_to_recovery","op":"eq","value":true},"min_count":1,"blocking_scopes":["invoice"],"guidance":"Why a separate recovery job was raised. The attendance still bills its own standing time.","sort_order":125}]$rr_req$::jsonb),
    ('default_heavy_recovery', 'heavy_recovery', 1, $rr_req$[{"requirement_code":"authorisation_record","label":"Authorisation to proceed","evidence_kind":"authorisation","mandatory":true,"condition":{"field":"counterparty_present","op":"eq","value":true},"min_count":1,"blocking_scopes":["invoice"],"guidance":"Assistance providers exclude work arranged without prior authorisation. Capture the authorisation number and who gave it.","sort_order":10},{"requirement_code":"claim_reference","label":"Claim or policy reference","evidence_kind":"reference","mandatory":true,"condition":{"field":"counterparty_present","op":"eq","value":true},"min_count":1,"blocking_scopes":["invoice"],"guidance":"The reference the counterparty will use to match this job to their claim.","sort_order":20},{"requirement_code":"saps_ar_number","label":"SAPS accident report (AR) number","evidence_kind":"reference","mandatory":true,"condition":{"any":[{"field":"police_involved","op":"eq","value":true},{"field":"casualty_flag","op":"eq","value":true}]},"min_count":1,"blocking_scopes":["invoice"],"guidance":"The National Road Traffic Act requires accidents involving injury or death to be reported to SAPS within 24 hours. Insurers ask for the AR number on third-party claims.","sort_order":25},{"requirement_code":"registration_photo","label":"Photograph of the registration plate","evidence_kind":"photo","mandatory":true,"condition":{"always":true},"min_count":1,"blocking_scopes":["invoice"],"guidance":"A legible plate photograph ties every other item of evidence to this vehicle.","sort_order":30},{"requirement_code":"vin_photo","label":"Photograph of the VIN","evidence_kind":"photo","mandatory":true,"condition":{"always":true},"min_count":1,"blocking_scopes":["invoice"],"guidance":"Insurers require the VIN on the claim form; a photograph prevents transcription disputes.","sort_order":40},{"requirement_code":"engine_number","label":"Engine number recorded","evidence_kind":"field","mandatory":true,"condition":{"always":true},"min_count":1,"blocking_scopes":["invoice"],"guidance":"Required on the motor claim form alongside the VIN.","sort_order":50},{"requirement_code":"gps_arrival","label":"GPS-verified arrival on scene","evidence_kind":"gps","mandatory":true,"condition":{"always":true},"min_count":1,"blocking_scopes":["invoice"],"guidance":"Recorded automatically when the driver reports arrival within the scene radius.","sort_order":60},{"requirement_code":"scene_photos","label":"Scene photographs","evidence_kind":"photo","mandatory":true,"condition":{"always":true},"min_count":2,"blocking_scopes":["invoice"],"guidance":"Wide shots showing the vehicle in its surroundings before anything is moved.","sort_order":70},{"requirement_code":"pre_service_condition","label":"Pre-service condition photographs","evidence_kind":"photo","mandatory":true,"condition":{"always":true},"min_count":4,"blocking_scopes":["invoice"],"guidance":"Four corners before the vehicle is touched. This is the operator's primary defence against a later claim of pre-existing damage.","sort_order":80},{"requirement_code":"damage_description","label":"Damage description and point of impact","evidence_kind":"field","mandatory":true,"condition":{"always":true},"min_count":1,"blocking_scopes":["invoice"],"guidance":"Structured description matching the claim form's damage and point-of-impact fields.","sort_order":90},{"requirement_code":"recovery_plan","label":"Recovery plan and approval","evidence_kind":"document","mandatory":true,"condition":{"always":true},"min_count":1,"blocking_scopes":["invoice"],"guidance":"The agreed recovery method and its authorised cost ceiling, before rigging begins.","sort_order":85},{"requirement_code":"rigging_photos","label":"Rigging and recovery photographs","evidence_kind":"photo","mandatory":true,"condition":{"always":true},"min_count":2,"blocking_scopes":["invoice"],"guidance":null,"sort_order":95},{"requirement_code":"scene_cleared","label":"Scene cleared","evidence_kind":"photo","mandatory":true,"condition":{"always":true},"min_count":1,"blocking_scopes":["invoice"],"guidance":"Evidence the carriageway was left clear.","sort_order":105},{"requirement_code":"loading_secured","label":"Vehicle loaded and secured","evidence_kind":"photo","mandatory":true,"condition":{"always":true},"min_count":1,"blocking_scopes":["invoice"],"guidance":"Shows the casualty vehicle correctly secured before transit.","sort_order":100},{"requirement_code":"delivery_proof","label":"Delivery at destination","evidence_kind":"photo","mandatory":true,"condition":{"field":"has_destination","op":"eq","value":true},"min_count":1,"blocking_scopes":["invoice"],"guidance":"The vehicle at the destination, showing where it was left.","sort_order":110},{"requirement_code":"handover_record","label":"Handover to receiving party","evidence_kind":"handover","mandatory":true,"condition":{"field":"has_destination","op":"eq","value":true},"min_count":1,"blocking_scopes":["invoice"],"guidance":"Who received the vehicle, when and where. Phase 4 extends this into a full chain of custody.","sort_order":120},{"requirement_code":"customer_acknowledgement","label":"Customer acknowledgement","evidence_kind":"signature","mandatory":true,"condition":{"always":true},"min_count":1,"blocking_scopes":["invoice"],"guidance":"Customer confirmation that the service was performed. Waive with a reason if the customer is absent or refuses.","sort_order":130},{"requirement_code":"third_party_details","label":"Third party details","evidence_kind":"field","mandatory":true,"condition":{"field":"third_party_involved","op":"eq","value":true},"min_count":1,"blocking_scopes":["invoice"],"guidance":"Driver, vehicle and insurer of the other party, as the claim form requires.","sort_order":140}]$rr_req$::jsonb),
    ('default_vehicle_movement', 'vehicle_movement', 1, $rr_req$[{"requirement_code":"authorisation_record","label":"Authorisation to proceed","evidence_kind":"authorisation","mandatory":true,"condition":{"field":"counterparty_present","op":"eq","value":true},"min_count":1,"blocking_scopes":["invoice"],"guidance":"Assistance providers exclude work arranged without prior authorisation. Capture the authorisation number and who gave it.","sort_order":10},{"requirement_code":"claim_reference","label":"Claim or policy reference","evidence_kind":"reference","mandatory":true,"condition":{"field":"counterparty_present","op":"eq","value":true},"min_count":1,"blocking_scopes":["invoice"],"guidance":"The reference the counterparty will use to match this job to their claim.","sort_order":20},{"requirement_code":"registration_photo","label":"Photograph of the registration plate","evidence_kind":"photo","mandatory":true,"condition":{"always":true},"min_count":1,"blocking_scopes":["invoice"],"guidance":"A legible plate photograph ties every other item of evidence to this vehicle.","sort_order":30},{"requirement_code":"vin_photo","label":"Photograph of the VIN","evidence_kind":"photo","mandatory":true,"condition":{"always":true},"min_count":1,"blocking_scopes":["invoice"],"guidance":"Insurers require the VIN on the claim form; a photograph prevents transcription disputes.","sort_order":40},{"requirement_code":"engine_number","label":"Engine number recorded","evidence_kind":"field","mandatory":true,"condition":{"always":true},"min_count":1,"blocking_scopes":["invoice"],"guidance":"Required on the motor claim form alongside the VIN.","sort_order":50},{"requirement_code":"gps_arrival","label":"GPS-verified arrival on scene","evidence_kind":"gps","mandatory":true,"condition":{"always":true},"min_count":1,"blocking_scopes":["invoice"],"guidance":"Recorded automatically when the driver reports arrival within the scene radius.","sort_order":60},{"requirement_code":"pre_move_condition","label":"Pre-move condition photographs","evidence_kind":"photo","mandatory":true,"condition":{"always":true},"min_count":4,"blocking_scopes":["invoice"],"guidance":"Four corners before collection.","sort_order":80},{"requirement_code":"post_move_condition","label":"Post-move condition photographs","evidence_kind":"photo","mandatory":true,"condition":{"always":true},"min_count":4,"blocking_scopes":["invoice"],"guidance":"Four corners after delivery. The delta is the dispute record.","sort_order":108},{"requirement_code":"delivery_proof","label":"Delivery at destination","evidence_kind":"photo","mandatory":true,"condition":{"field":"has_destination","op":"eq","value":true},"min_count":1,"blocking_scopes":["invoice"],"guidance":"The vehicle at the destination, showing where it was left.","sort_order":110},{"requirement_code":"handover_record","label":"Handover to receiving party","evidence_kind":"handover","mandatory":true,"condition":{"field":"has_destination","op":"eq","value":true},"min_count":1,"blocking_scopes":["invoice"],"guidance":"Who received the vehicle, when and where. Phase 4 extends this into a full chain of custody.","sort_order":120},{"requirement_code":"customer_acknowledgement","label":"Customer acknowledgement","evidence_kind":"signature","mandatory":true,"condition":{"always":true},"min_count":1,"blocking_scopes":["invoice"],"guidance":"Customer confirmation that the service was performed. Waive with a reason if the customer is absent or refuses.","sort_order":130}]$rr_req$::jsonb),
    ('default_storage', 'storage', 1, $rr_req$[{"requirement_code":"authorisation_record","label":"Authorisation to proceed","evidence_kind":"authorisation","mandatory":true,"condition":{"field":"counterparty_present","op":"eq","value":true},"min_count":1,"blocking_scopes":["invoice"],"guidance":"Assistance providers exclude work arranged without prior authorisation. Capture the authorisation number and who gave it.","sort_order":10},{"requirement_code":"claim_reference","label":"Claim or policy reference","evidence_kind":"reference","mandatory":true,"condition":{"field":"counterparty_present","op":"eq","value":true},"min_count":1,"blocking_scopes":["invoice"],"guidance":"The reference the counterparty will use to match this job to their claim.","sort_order":20},{"requirement_code":"registration_photo","label":"Photograph of the registration plate","evidence_kind":"photo","mandatory":true,"condition":{"always":true},"min_count":1,"blocking_scopes":["invoice"],"guidance":"A legible plate photograph ties every other item of evidence to this vehicle.","sort_order":30},{"requirement_code":"vin_photo","label":"Photograph of the VIN","evidence_kind":"photo","mandatory":true,"condition":{"always":true},"min_count":1,"blocking_scopes":["invoice"],"guidance":"Insurers require the VIN on the claim form; a photograph prevents transcription disputes.","sort_order":40},{"requirement_code":"engine_number","label":"Engine number recorded","evidence_kind":"field","mandatory":true,"condition":{"always":true},"min_count":1,"blocking_scopes":["invoice"],"guidance":"Required on the motor claim form alongside the VIN.","sort_order":50},{"requirement_code":"storage_checkin_photo","label":"Condition at check-in","evidence_kind":"photo","mandatory":true,"condition":{"always":true},"min_count":4,"blocking_scopes":["invoice"],"guidance":"Condition on arrival at the yard, before storage begins.","sort_order":80},{"requirement_code":"storage_location","label":"Storage location recorded","evidence_kind":"field","mandatory":true,"condition":{"always":true},"min_count":1,"blocking_scopes":["invoice"],"guidance":"The motor claim form asks where the vehicle is now, and for the storage facility's contact details.","sort_order":110},{"requirement_code":"keys_documents_record","label":"Keys and documents recorded","evidence_kind":"field","mandatory":true,"condition":{"always":true},"min_count":1,"blocking_scopes":["invoice"],"guidance":"The industry salvage code requires keys and documents to be held under restricted, auditable access. Phase 4 extends this into full custody control.","sort_order":115},{"requirement_code":"release_authorisation","label":"Release authorisation","evidence_kind":"authorisation","mandatory":true,"condition":{"always":true},"min_count":1,"blocking_scopes":["release"],"guidance":"Who authorised release of the vehicle. Blocks release, not invoicing.","sort_order":200}]$rr_req$::jsonb)
-- <<< GENERATED: REQUIREMENT POLICIES <<<
    ) AS v(policy_key, service_code, version, requirements)
  LOOP
    IF EXISTS (
      SELECT 1 FROM public.rr_requirement_policies
      WHERE company_id = p_company_id AND policy_key = seed.policy_key AND version = seed.version
    ) THEN
      CONTINUE;
    END IF;

    INSERT INTO public.rr_requirement_policies
      (company_id, policy_key, counterparty_id, service_code, version, active, label, created_by)
    VALUES (
      p_company_id, seed.policy_key, NULL, seed.service_code, seed.version, true,
      'Default requirements for ' || replace(seed.service_code, '_', ' '), 'sql/073'
    )
    RETURNING id INTO policy_id;

    FOR item IN SELECT * FROM jsonb_array_elements(seed.requirements)
    LOOP
      INSERT INTO public.rr_requirement_items
        (company_id, policy_id, requirement_code, label, evidence_kind, mandatory,
         condition, min_count, blocking_scopes, guidance, sort_order)
      VALUES (
        p_company_id,
        policy_id,
        item ->> 'requirement_code',
        item ->> 'label',
        item ->> 'evidence_kind',
        (item ->> 'mandatory')::boolean,
        item -> 'condition',
        (item ->> 'min_count')::integer,
        ARRAY(SELECT jsonb_array_elements_text(item -> 'blocking_scopes'))::text[],
        item ->> 'guidance',
        (item ->> 'sort_order')::integer
      );
    END LOOP;
  END LOOP;
END
$seed$;

COMMENT ON FUNCTION public.rr_seed_requirement_policies(uuid) IS
  'Idempotently seeds the researched default requirement policies for one company. Called by sql/073 for companies holding the road_recovery module, and by module provisioning thereafter.';

REVOKE ALL ON FUNCTION public.rr_seed_requirement_policies(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rr_seed_requirement_policies(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.rr_seed_requirement_policies(uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.rr_seed_requirement_policies(uuid) TO service_role;

DO $apply$
DECLARE
  target uuid;
  applied integer := 0;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='companies' AND column_name='enabled_modules'
  ) THEN
    RAISE NOTICE 'companies.enabled_modules is absent; skipping requirement policy seeding.';
    RETURN;
  END IF;

  FOR target IN
    SELECT c.id FROM public.companies c
    WHERE COALESCE(c.enabled_modules, '[]'::jsonb) @> '["road_recovery"]'::jsonb
  LOOP
    PERFORM public.rr_seed_requirement_policies(target);
    applied := applied + 1;
  END LOOP;

  RAISE NOTICE 'Requirement policies seeded for % company/companies holding the road_recovery module.', applied;
END
$apply$;

COMMIT;

NOTIFY pgrst, 'reload schema';

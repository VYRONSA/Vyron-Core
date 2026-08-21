-- 071-road-recovery-dispatch.sql
-- VYRON CORE — Road & Recovery vertical, Phase 1 (Dispatch & Live Operations).
--
-- ===========================================================================
-- WHAT THIS ADDS
-- ===========================================================================
--
--   public.rr_counterparties          insurers, assistance providers, fleet clients
--   public.rr_counterparty_contacts   named controllers / 24h numbers
--   public.rr_authorisations          authorisation + claim reference (LEGAL RECORD)
--   public.rr_tow_truck_profiles      1:1 capability extension of public.field_vehicles
--   public.rr_driver_certifications   licence / PrDP / competency, with expiry
--   public.rr_dispatch_candidates     immutable scored evaluation (explainability)
--   public.rr_dispatch_assignments    offer -> accept / decline / reassign
--
-- Plus two additive columns and one uniqueness constraint used for cross-tenant
-- composite foreign keys.
--
-- ===========================================================================
-- WHAT THIS REUSES RATHER THAN REBUILDS
-- ===========================================================================
--
--   public.employees            the person. There is NO second employee system;
--                               rr_driver_certifications references it.
--   public.employee_documents   the document vault. A certification may LINK to a
--                               scanned copy there; it never stores a second copy.
--   public.field_vehicles       truck identity (registration, type, VIN, make/model).
--                               rr_tow_truck_profiles adds only tow capability.
--   public.field_jobs           the work-order spine. UNCHANGED, including its
--                               `status` CHECK constraint.
--   public.field_job_events     driver events. UNCHANGED: 'Start Travel' and
--                               'Arrive Site' already exist and already map onto
--                               field_jobs.status via statusForEventType(), and
--                               lib/field-cost-intelligence.ts already derives travel
--                               time from those pairs. Phase 1 needs no new event type.
--   public.field_job_assignments the CONFIRMED operational crew record that existing
--                               VYRON engines consume. Written on ACCEPTANCE only.
--   public.mobile_gps_validations GPS-verified arrival, via the existing
--                               validateMobileGpsRadius() implementation.
--   public.vyron_audit_log      authorisation and dispatch audit history.
--
-- ===========================================================================
-- DESIGN NOTES
-- ===========================================================================
--
-- 1. NO `rr_service_jobs.authorisation_id`.
--    The authorisation points at the job, not the reverse. A back-pointer would create
--    a circular foreign key AND would wrongly imply one authorisation per job;
--    supplementary authorisations are normal in recovery work. The active authorisation
--    is derived (status = 'active', latest authorised_at).
--
-- 2. AUTHORISATIONS ARE LEGAL RECORDS.
--    rr_authorisations.service_job_id is ON DELETE RESTRICT. Deleting a field job that
--    carries an authorisation now FAILS rather than cascading the record away. Records
--    are voided, never destroyed.
--
-- 3. DISPATCH IS EXPLAINABLE.
--    rr_dispatch_candidates retains, per candidate, the eligibility result, every
--    eligibility failure, distance, capability result, certification result,
--    availability, conflicting assignment, score components, final score and the
--    recommendation reason. It is append-only: a re-evaluation is a new evaluation_id,
--    never an edit.
--
-- 4. DECLINED OFFERS NEVER BECOME CREW.
--    Only an ACCEPTED rr_dispatch_assignments row produces a field_job_assignments row.
--
-- Idempotent. Requires sql/070. Run after sql/070.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------------------------------------------------------------------------
-- 0. Prerequisites
-- ---------------------------------------------------------------------------
DO $prereq$
BEGIN
  IF to_regclass('public.rr_service_jobs') IS NULL THEN
    RAISE EXCEPTION
      'Prerequisite missing: public.rr_service_jobs. Run sql/070-road-recovery-foundation.sql before sql/071.';
  END IF;
  IF to_regclass('public.employees') IS NULL THEN
    RAISE EXCEPTION 'Prerequisite missing: public.employees.';
  END IF;
  IF to_regclass('public.field_vehicles') IS NULL THEN
    RAISE EXCEPTION 'Prerequisite missing: public.field_vehicles. Run sql/014.';
  END IF;
  IF to_regclass('public.field_job_assignments') IS NULL THEN
    RAISE EXCEPTION 'Prerequisite missing: public.field_job_assignments. Run sql/014.';
  END IF;
END
$prereq$;

-- ---------------------------------------------------------------------------
-- 1. Uniqueness needed for cross-tenant composite foreign keys
-- ---------------------------------------------------------------------------
--
-- Additive and non-destructive: (company_id, id) is trivially unique wherever id is
-- already the primary key. It exists so a child row can be pinned to a parent IN THE
-- SAME COMPANY by the foreign key itself, which is the defence that proved effective in
-- the Phase 0 runtime tests. No column is altered and no semantics change.
DO $unique_keys$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'employees_company_id_id_key') THEN
    ALTER TABLE public.employees ADD CONSTRAINT employees_company_id_id_key UNIQUE (company_id, id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'field_vehicles_company_id_id_key') THEN
    ALTER TABLE public.field_vehicles ADD CONSTRAINT field_vehicles_company_id_id_key UNIQUE (company_id, id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'rr_service_jobs_company_id_id_key') THEN
    ALTER TABLE public.rr_service_jobs ADD CONSTRAINT rr_service_jobs_company_id_id_key UNIQUE (company_id, id);
  END IF;
END
$unique_keys$;

-- ---------------------------------------------------------------------------
-- 2. rr_counterparties
-- ---------------------------------------------------------------------------
--
-- Deliberately NOT unique on name: an insurer has branches, and
-- client_billing_profiles' UNIQUE (company_id, client_name) is exactly the collision
-- this vertical must avoid. Identity is a tenant-assigned counterparty_code.
CREATE TABLE IF NOT EXISTS public.rr_counterparties (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies (id) ON DELETE CASCADE,
  counterparty_code text NOT NULL,
  counterparty_type text NOT NULL,
  legal_name text NOT NULL,
  trading_name text,
  branch_label text,
  registration_number text,
  vat_number text,
  /** Whether a job for this counterparty needs an authorisation before dispatch. */
  requires_authorisation boolean NOT NULL DEFAULT true,
  payment_terms_days integer,
  status text NOT NULL DEFAULT 'active',
  notes text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT rr_counterparties_code_unique UNIQUE (company_id, counterparty_code),
  CONSTRAINT rr_counterparties_company_id_id_key UNIQUE (company_id, id),
  CONSTRAINT rr_counterparties_type_check CHECK (
    counterparty_type IN (
      'insurer',
      'assistance_provider',
      'broker',
      'fleet_client',
      'dealership',
      'auction',
      'private'
    )
  ),
  CONSTRAINT rr_counterparties_status_check CHECK (
    status IN ('active', 'suspended', 'inactive')
  ),
  CONSTRAINT rr_counterparties_payment_terms_check CHECK (
    payment_terms_days IS NULL OR payment_terms_days >= 0
  )
);

CREATE INDEX IF NOT EXISTS idx_rr_counterparties_company
  ON public.rr_counterparties (company_id, status, counterparty_type);

COMMENT ON TABLE public.rr_counterparties IS
  'Insurers, assistance providers and other operational counterparties for Road & Recovery. Separate from client_billing_profiles, whose UNIQUE (company_id, client_name) cannot represent insurer branches.';

-- ---------------------------------------------------------------------------
-- 3. rr_counterparty_contacts
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.rr_counterparty_contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies (id) ON DELETE CASCADE,
  counterparty_id uuid NOT NULL,
  contact_name text NOT NULL,
  role_label text,
  phone text,
  phone_after_hours text,
  email text,
  is_primary boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'active',
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT rr_counterparty_contacts_counterparty_fk
    FOREIGN KEY (company_id, counterparty_id)
    REFERENCES public.rr_counterparties (company_id, id)
    ON DELETE CASCADE,
  CONSTRAINT rr_counterparty_contacts_status_check CHECK (
    status IN ('active', 'inactive')
  )
);

CREATE INDEX IF NOT EXISTS idx_rr_counterparty_contacts_counterparty
  ON public.rr_counterparty_contacts (company_id, counterparty_id, status);

-- ---------------------------------------------------------------------------
-- 4. rr_authorisations  — LEGAL RECORD, RESTRICT ON DELETE
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.rr_authorisations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies (id) ON DELETE CASCADE,

  -- RESTRICT: an authorised job cannot be deleted out from under its authorisation.
  service_job_id uuid NOT NULL REFERENCES public.rr_service_jobs (id) ON DELETE RESTRICT,
  counterparty_id uuid NOT NULL,

  authorisation_number text NOT NULL,
  claim_reference text,
  po_number text,

  /** The service code this authorisation covers (rr_service_types.service_code). */
  authorised_service_code text NOT NULL,
  authorised_amount numeric(12, 2),
  currency text NOT NULL DEFAULT 'ZAR',

  authorised_by_name text,
  authorised_by_contact text,
  authorised_at timestamptz NOT NULL DEFAULT now(),
  channel text NOT NULL DEFAULT 'phone',
  expires_at timestamptz,

  status text NOT NULL DEFAULT 'active',
  void_reason text,
  voided_at timestamptz,
  voided_by text,

  notes text,
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT rr_authorisations_number_unique
    UNIQUE (company_id, counterparty_id, authorisation_number),
  CONSTRAINT rr_authorisations_company_id_id_key UNIQUE (company_id, id),

  CONSTRAINT rr_authorisations_service_job_fk
    FOREIGN KEY (company_id, service_job_id)
    REFERENCES public.rr_service_jobs (company_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT rr_authorisations_counterparty_fk
    FOREIGN KEY (company_id, counterparty_id)
    REFERENCES public.rr_counterparties (company_id, id)
    ON DELETE RESTRICT,

  CONSTRAINT rr_authorisations_status_check CHECK (
    status IN ('active', 'expired', 'void', 'superseded')
  ),
  CONSTRAINT rr_authorisations_channel_check CHECK (
    channel IN ('phone', 'email', 'portal', 'whatsapp', 'in_person', 'system')
  ),
  CONSTRAINT rr_authorisations_amount_check CHECK (
    authorised_amount IS NULL OR authorised_amount >= 0
  ),
  -- Voiding is recorded, never implied.
  CONSTRAINT rr_authorisations_void_recorded CHECK (
    status <> 'void' OR (voided_at IS NOT NULL AND void_reason IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_rr_authorisations_job
  ON public.rr_authorisations (company_id, service_job_id, status, authorised_at DESC);

CREATE INDEX IF NOT EXISTS idx_rr_authorisations_counterparty
  ON public.rr_authorisations (company_id, counterparty_id, status);

COMMENT ON TABLE public.rr_authorisations IS
  'Authorisation to proceed, from an insurer or assistance provider. LEGAL RECORD: ON DELETE RESTRICT against the service job, and voided rather than deleted. Audit history is written to public.vyron_audit_log.';

-- ---------------------------------------------------------------------------
-- 5. rr_tow_truck_profiles — 1:1 capability extension of field_vehicles
-- ---------------------------------------------------------------------------
--
-- Truck IDENTITY stays in field_vehicles (registration, vehicle_type, VIN, make,
-- model, year, odometer, service interval). This table adds ONLY what dispatch needs
-- and field_vehicles cannot express.
CREATE TABLE IF NOT EXISTS public.rr_tow_truck_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies (id) ON DELETE CASCADE,

  field_vehicle_id uuid NOT NULL,

  tow_class text NOT NULL,
  gvm_kg numeric(10, 2),
  payload_capacity_kg numeric(10, 2),
  max_vehicle_length_m numeric(6, 2),
  carries_count integer NOT NULL DEFAULT 1,

  has_winch boolean NOT NULL DEFAULT false,
  winch_capacity_kg numeric(10, 2),
  has_boom boolean NOT NULL DEFAULT false,
  boom_capacity_kg numeric(10, 2),
  has_underlift boolean NOT NULL DEFAULT false,
  has_dollies boolean NOT NULL DEFAULT false,
  equipment jsonb NOT NULL DEFAULT '[]'::jsonb,

  availability_status text NOT NULL DEFAULT 'available',
  operational_status text NOT NULL DEFAULT 'operational',

  base_label text,
  base_latitude numeric(10, 7),
  base_longitude numeric(10, 7),
  current_latitude numeric(10, 7),
  current_longitude numeric(10, 7),
  location_updated_at timestamptz,

  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT rr_tow_truck_profiles_vehicle_unique UNIQUE (field_vehicle_id),
  CONSTRAINT rr_tow_truck_profiles_company_id_id_key UNIQUE (company_id, id),

  CONSTRAINT rr_tow_truck_profiles_vehicle_fk
    FOREIGN KEY (company_id, field_vehicle_id)
    REFERENCES public.field_vehicles (company_id, id)
    ON DELETE CASCADE,

  CONSTRAINT rr_tow_truck_profiles_tow_class_check CHECK (
    tow_class IN ('light_duty', 'flatbed', 'underlift', 'wrecker', 'rotator', 'lowbed')
  ),
  CONSTRAINT rr_tow_truck_profiles_availability_check CHECK (
    availability_status IN ('available', 'on_job', 'off_shift', 'maintenance', 'out_of_service')
  ),
  CONSTRAINT rr_tow_truck_profiles_operational_check CHECK (
    operational_status IN ('operational', 'limited', 'grounded')
  ),
  CONSTRAINT rr_tow_truck_profiles_carries_check CHECK (carries_count >= 1),
  CONSTRAINT rr_tow_truck_profiles_winch_consistent CHECK (
    has_winch OR winch_capacity_kg IS NULL
  ),
  CONSTRAINT rr_tow_truck_profiles_boom_consistent CHECK (
    has_boom OR boom_capacity_kg IS NULL
  )
);

CREATE INDEX IF NOT EXISTS idx_rr_tow_truck_profiles_dispatch
  ON public.rr_tow_truck_profiles (company_id, availability_status, operational_status, tow_class);

COMMENT ON TABLE public.rr_tow_truck_profiles IS
  '1:1 capability extension of public.field_vehicles. Truck identity stays in field_vehicles; this adds only tow class, capacity, equipment and dispatch availability.';

-- ---------------------------------------------------------------------------
-- 6. rr_driver_certifications
-- ---------------------------------------------------------------------------
--
-- References the EXISTING public.employees. There is no second employee system here.
-- employee_document_id optionally points at the scanned copy already held in the
-- EXISTING public.employee_documents vault; no document is duplicated.
CREATE TABLE IF NOT EXISTS public.rr_driver_certifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies (id) ON DELETE CASCADE,

  employee_id uuid NOT NULL,
  certification_type text NOT NULL,
  identifier text,
  issuing_authority text,
  issued_at date,
  expires_at date,

  /** Optional link to the scanned copy in the existing document vault. */
  employee_document_id uuid,

  verified_by text,
  verified_at timestamptz,

  /** When true, an expired or non-active certification makes the driver INELIGIBLE. */
  blocks_dispatch boolean NOT NULL DEFAULT true,

  status text NOT NULL DEFAULT 'active',
  notes text,
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT rr_driver_certifications_unique
    UNIQUE (company_id, employee_id, certification_type),

  CONSTRAINT rr_driver_certifications_employee_fk
    FOREIGN KEY (company_id, employee_id)
    REFERENCES public.employees (company_id, id)
    ON DELETE CASCADE,

  CONSTRAINT rr_driver_certifications_type_check CHECK (
    certification_type IN (
      'drivers_licence',
      'prdp',
      'medical_certificate',
      'hazmat',
      'crane_operator',
      'first_aid',
      'recovery_competency'
    )
  ),
  CONSTRAINT rr_driver_certifications_status_check CHECK (
    status IN ('active', 'suspended', 'revoked')
  ),
  CONSTRAINT rr_driver_certifications_dates_check CHECK (
    issued_at IS NULL OR expires_at IS NULL OR expires_at >= issued_at
  )
);

CREATE INDEX IF NOT EXISTS idx_rr_driver_certifications_employee
  ON public.rr_driver_certifications (company_id, employee_id, status);

CREATE INDEX IF NOT EXISTS idx_rr_driver_certifications_expiry
  ON public.rr_driver_certifications (company_id, expires_at)
  WHERE blocks_dispatch;

COMMENT ON TABLE public.rr_driver_certifications IS
  'Road & Recovery driver competency register. References the existing public.employees; optionally links a scanned copy in public.employee_documents. An expired blocks_dispatch certification makes the driver ineligible for dispatch.';

-- ---------------------------------------------------------------------------
-- 7. rr_dispatch_candidates — immutable explainability record
-- ---------------------------------------------------------------------------
--
-- One row per candidate per evaluation. Retains WHY a candidate was or was not
-- eligible, so a dispatch decision can be defended after the fact. Append-only: a
-- re-evaluation writes a new evaluation_id rather than editing history.
CREATE TABLE IF NOT EXISTS public.rr_dispatch_candidates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies (id) ON DELETE CASCADE,

  service_job_id uuid NOT NULL,
  /** Groups every candidate produced by one evaluation run. */
  evaluation_id uuid NOT NULL,
  evaluated_at timestamptz NOT NULL DEFAULT now(),
  evaluated_by text,

  employee_id uuid,
  field_vehicle_id uuid,
  tow_truck_profile_id uuid,

  eligible boolean NOT NULL,
  eligibility_failures jsonb NOT NULL DEFAULT '[]'::jsonb,

  distance_km numeric(10, 3),
  capability_result jsonb NOT NULL DEFAULT '{}'::jsonb,
  certification_result jsonb NOT NULL DEFAULT '{}'::jsonb,
  availability_status text,
  conflicting_assignment_id uuid,

  score_components jsonb NOT NULL DEFAULT '{}'::jsonb,
  final_score numeric(8, 3),
  rank integer,
  recommended boolean NOT NULL DEFAULT false,
  recommendation_reason text,

  /** The deterministic engine version that produced this row. */
  engine_version text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT rr_dispatch_candidates_company_id_id_key UNIQUE (company_id, id),
  CONSTRAINT rr_dispatch_candidates_service_job_fk
    FOREIGN KEY (company_id, service_job_id)
    REFERENCES public.rr_service_jobs (company_id, id)
    ON DELETE CASCADE,
  -- An ineligible candidate must say why; an eligible one must not claim failures.
  CONSTRAINT rr_dispatch_candidates_failures_consistent CHECK (
    (eligible AND jsonb_array_length(eligibility_failures) = 0)
    OR (NOT eligible AND jsonb_array_length(eligibility_failures) > 0)
  ),
  -- Only an eligible candidate may be recommended.
  CONSTRAINT rr_dispatch_candidates_recommendation_check CHECK (
    NOT recommended OR eligible
  ),
  CONSTRAINT rr_dispatch_candidates_distance_check CHECK (
    distance_km IS NULL OR distance_km >= 0
  )
);

CREATE INDEX IF NOT EXISTS idx_rr_dispatch_candidates_evaluation
  ON public.rr_dispatch_candidates (company_id, evaluation_id, rank);

CREATE INDEX IF NOT EXISTS idx_rr_dispatch_candidates_job
  ON public.rr_dispatch_candidates (company_id, service_job_id, evaluated_at DESC);

COMMENT ON TABLE public.rr_dispatch_candidates IS
  'Append-only record of every dispatch candidate evaluation, retaining eligibility result, failures, distance, capability, certification, availability, conflicts, score components and recommendation reason. The deterministic engine is the sole authority for eligibility.';

CREATE OR REPLACE FUNCTION public.rr_dispatch_candidates_forbid_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $forbid$
BEGIN
  RAISE EXCEPTION
    'public.rr_dispatch_candidates is append-only: % is not permitted. Re-evaluate to produce a new evaluation_id instead.',
    TG_OP;
END
$forbid$;

DROP TRIGGER IF EXISTS rr_dispatch_candidates_append_only ON public.rr_dispatch_candidates;

CREATE TRIGGER rr_dispatch_candidates_append_only
  BEFORE UPDATE OR DELETE ON public.rr_dispatch_candidates
  FOR EACH ROW
  EXECUTE FUNCTION public.rr_dispatch_candidates_forbid_mutation();

-- ---------------------------------------------------------------------------
-- 8. rr_dispatch_assignments — the dispatch decision record
-- ---------------------------------------------------------------------------
--
-- This is the OFFER and its outcome. It is NOT the confirmed crew record: on
-- acceptance the application also writes public.field_job_assignments, which is what
-- the existing Field Operations, travel and cost engines already consume. A DECLINED
-- offer never produces a field_job_assignments row.
CREATE TABLE IF NOT EXISTS public.rr_dispatch_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies (id) ON DELETE CASCADE,

  service_job_id uuid NOT NULL,
  candidate_id uuid,

  employee_id uuid NOT NULL,
  field_vehicle_id uuid,

  assignment_status text NOT NULL DEFAULT 'offered',
  sequence_number integer NOT NULL DEFAULT 1,

  offered_at timestamptz NOT NULL DEFAULT now(),
  offered_by text,
  responded_at timestamptz,
  decline_reason text,
  cancelled_at timestamptz,
  cancelled_by text,
  cancel_reason text,

  /** Set when this offer was superseded by a reassignment. */
  superseded_by_assignment_id uuid,
  /** The confirmed crew row, written only on acceptance. */
  field_job_assignment_id uuid REFERENCES public.field_job_assignments (id) ON DELETE SET NULL,

  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT rr_dispatch_assignments_company_id_id_key UNIQUE (company_id, id),

  CONSTRAINT rr_dispatch_assignments_service_job_fk
    FOREIGN KEY (company_id, service_job_id)
    REFERENCES public.rr_service_jobs (company_id, id)
    ON DELETE CASCADE,
  CONSTRAINT rr_dispatch_assignments_employee_fk
    FOREIGN KEY (company_id, employee_id)
    REFERENCES public.employees (company_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT rr_dispatch_assignments_candidate_fk
    FOREIGN KEY (company_id, candidate_id)
    REFERENCES public.rr_dispatch_candidates (company_id, id)
    ON DELETE SET NULL,
  CONSTRAINT rr_dispatch_assignments_superseded_fk
    FOREIGN KEY (company_id, superseded_by_assignment_id)
    REFERENCES public.rr_dispatch_assignments (company_id, id)
    ON DELETE SET NULL,

  CONSTRAINT rr_dispatch_assignments_status_check CHECK (
    assignment_status IN ('offered', 'accepted', 'declined', 'cancelled', 'reassigned', 'completed')
  ),
  CONSTRAINT rr_dispatch_assignments_sequence_check CHECK (sequence_number >= 1),
  CONSTRAINT rr_dispatch_assignments_not_self CHECK (
    superseded_by_assignment_id IS NULL OR superseded_by_assignment_id <> id
  ),
  -- A decline must say why, and must be timestamped.
  CONSTRAINT rr_dispatch_assignments_decline_recorded CHECK (
    assignment_status <> 'declined'
    OR (responded_at IS NOT NULL AND decline_reason IS NOT NULL)
  ),
  -- Acceptance must be timestamped.
  CONSTRAINT rr_dispatch_assignments_accept_recorded CHECK (
    assignment_status <> 'accepted' OR responded_at IS NOT NULL
  ),
  -- Only an accepted (or later completed) assignment may carry a confirmed crew row.
  CONSTRAINT rr_dispatch_assignments_crew_row_check CHECK (
    field_job_assignment_id IS NULL
    OR assignment_status IN ('accepted', 'completed', 'reassigned')
  )
);

-- At most ONE live offer or acceptance per job. A reassignment must first move the
-- previous row out of 'offered'/'accepted'.
CREATE UNIQUE INDEX IF NOT EXISTS idx_rr_dispatch_assignments_one_live
  ON public.rr_dispatch_assignments (company_id, service_job_id)
  WHERE assignment_status IN ('offered', 'accepted');

CREATE INDEX IF NOT EXISTS idx_rr_dispatch_assignments_job
  ON public.rr_dispatch_assignments (company_id, service_job_id, sequence_number);

CREATE INDEX IF NOT EXISTS idx_rr_dispatch_assignments_driver
  ON public.rr_dispatch_assignments (company_id, employee_id, assignment_status);

COMMENT ON TABLE public.rr_dispatch_assignments IS
  'Dispatch offer and its outcome (offered / accepted / declined / cancelled / reassigned). NOT the confirmed crew record: acceptance also writes public.field_job_assignments, which existing VYRON engines consume. A declined offer never produces a crew row.';

-- ---------------------------------------------------------------------------
-- 9. rr_service_jobs — counterparty link
-- ---------------------------------------------------------------------------
ALTER TABLE public.rr_service_jobs
  ADD COLUMN IF NOT EXISTS counterparty_id uuid;

DO $counterparty_fk$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'rr_service_jobs_counterparty_fk'
  ) THEN
    ALTER TABLE public.rr_service_jobs
      ADD CONSTRAINT rr_service_jobs_counterparty_fk
      FOREIGN KEY (company_id, counterparty_id)
      REFERENCES public.rr_counterparties (company_id, id)
      ON DELETE RESTRICT;
  END IF;
END
$counterparty_fk$;

CREATE INDEX IF NOT EXISTS idx_rr_service_jobs_counterparty
  ON public.rr_service_jobs (company_id, counterparty_id)
  WHERE counterparty_id IS NOT NULL;

COMMENT ON COLUMN public.rr_service_jobs.counterparty_id IS
  'The insurer / assistance provider this job is worked for. There is deliberately no authorisation_id back-pointer: authorisations point at the job, a job may carry supplementary authorisations, and a back-pointer would create a circular foreign key.';

-- ---------------------------------------------------------------------------
-- 10. Row level security + tenant isolation
-- ---------------------------------------------------------------------------
ALTER TABLE public.rr_counterparties ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rr_counterparty_contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rr_authorisations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rr_tow_truck_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rr_driver_certifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rr_dispatch_candidates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rr_dispatch_assignments ENABLE ROW LEVEL SECURITY;

DO $tenant$
DECLARE
  tbl text;
BEGIN
  IF to_regprocedure('public.vyron_user_company_ids()') IS NULL
     OR to_regprocedure('public.vyron_is_platform_operator()') IS NULL THEN
    RAISE NOTICE
      'Tenant helper functions missing (sql/030). Phase 1 tables have RLS enabled with NO policy, which denies all access until sql/030 and then sql/071 are run.';
    RETURN;
  END IF;

  FOR tbl IN
    SELECT unnest(ARRAY[
      'rr_counterparties',
      'rr_counterparty_contacts',
      'rr_authorisations',
      'rr_tow_truck_profiles',
      'rr_driver_certifications',
      'rr_dispatch_candidates',
      'rr_dispatch_assignments'
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

REVOKE ALL ON public.rr_counterparties FROM anon;
REVOKE ALL ON public.rr_counterparty_contacts FROM anon;
REVOKE ALL ON public.rr_authorisations FROM anon;
REVOKE ALL ON public.rr_tow_truck_profiles FROM anon;
REVOKE ALL ON public.rr_driver_certifications FROM anon;
REVOKE ALL ON public.rr_dispatch_candidates FROM anon;
REVOKE ALL ON public.rr_dispatch_assignments FROM anon;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.rr_counterparties TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.rr_counterparty_contacts TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.rr_tow_truck_profiles TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.rr_driver_certifications TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.rr_dispatch_assignments TO authenticated;

-- Authorisations are voided, never deleted.
GRANT SELECT, INSERT, UPDATE ON public.rr_authorisations TO authenticated;
REVOKE DELETE, TRUNCATE ON public.rr_authorisations FROM authenticated;

-- Append-only: see the trigger above.
GRANT SELECT, INSERT ON public.rr_dispatch_candidates TO authenticated;
REVOKE UPDATE, DELETE, TRUNCATE ON public.rr_dispatch_candidates FROM authenticated;

COMMIT;

NOTIFY pgrst, 'reload schema';

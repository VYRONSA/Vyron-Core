-- 075-road-recovery-release-authority.sql
-- VYRON CORE — Road & Recovery Phase 4, Step 1: release and disposal authority.
--
-- ---------------------------------------------------------------------------
-- WHY THIS SHIPS IN STEP 1 RATHER THAN WITH STORAGE
-- ---------------------------------------------------------------------------
--
-- The storage workflow has declared two guards since Phase 0 that nothing ever resolved:
--
--     release_authorisation_pending -> release_authorised   guards: release_authorised
--     disposal_notice_issued        -> disposal_authorised  guards: disposal_authorised
--
-- That is the exact defect class Phase 3 closed for `evidence_complete`: guards fail
-- closed, so those transitions were unreachable through the service layer. Resolving them
-- needs a source of truth, and this is it. Shipping the table with storage would mean
-- knowingly carrying an unresolvable guard through another phase.
--
-- ---------------------------------------------------------------------------
-- WHY NOT REUSE rr_authorisations
-- ---------------------------------------------------------------------------
--
-- public.rr_authorisations (sql/071) answers "may we perform this service, and who pays".
-- It has no notion of authority TYPE, and it is a protected legal record that later phases
-- were explicitly forbidden to alter. Release and disposal answer a different question —
-- "who may take this vehicle away, and on whose authority" — and carry data that has no
-- meaning for a service authorisation: the identity of the person collecting, their
-- capacity to collect, and for disposal the statutory notice that preceded it.
--
-- ---------------------------------------------------------------------------
-- ONE TABLE, TWO AUTHORITIES
-- ---------------------------------------------------------------------------
--
-- authority_type is 'release' or 'disposal'. They share a shape (issuing party, reference,
-- validity window, explicit verification, void-not-delete lifecycle) and differ in
-- meaning, so they share a table and NEVER share a row.
--
-- A release authority can never satisfy the disposal guard: the resolvers filter on
-- authority_type independently, and a CHECK constraint requires each type to carry the
-- fields its own decision depends on. Permission to hand a car back to its owner is not
-- permission to scrap it.
--
-- Idempotent and safe to re-run. Requires sql/070 and sql/071.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $prereq$
BEGIN
  IF to_regclass('public.rr_service_jobs') IS NULL THEN
    RAISE EXCEPTION 'Prerequisite missing: public.rr_service_jobs. Run sql/070 before sql/075.';
  END IF;
  IF to_regclass('public.rr_counterparties') IS NULL THEN
    RAISE EXCEPTION 'Prerequisite missing: public.rr_counterparties. Run sql/071 before sql/075.';
  END IF;
END
$prereq$;

-- ---------------------------------------------------------------------------
-- 1. rr_release_authorisations
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.rr_release_authorisations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies (id) ON DELETE CASCADE,

  -- RESTRICT: a job under a release or disposal authority is a legal record and cannot be
  -- deleted out from under it. Matches rr_authorisations (sql/071).
  service_job_id uuid NOT NULL REFERENCES public.rr_service_jobs (id) ON DELETE RESTRICT,

  /** 'release' = the vehicle may leave. 'disposal' = the vehicle may be disposed of. */
  authority_type text NOT NULL,

  -- --- Who gave the authority ------------------------------------------------
  --
  -- Not always a counterparty: an owner, the SAPS, a court or a finance house may all
  -- authorise a release, and none of them is necessarily on the counterparty register.
  counterparty_id uuid,
  authority_party text NOT NULL,
  authority_party_name text NOT NULL,
  authority_reference text NOT NULL,
  authority_contact text,

  -- --- Validity ---------------------------------------------------------------
  issued_at timestamptz NOT NULL DEFAULT now(),
  valid_from timestamptz,
  expires_at timestamptz,

  status text NOT NULL DEFAULT 'active',
  void_reason text,
  voided_at timestamptz,
  voided_by text,

  -- --- Explicit verification ---------------------------------------------------
  --
  -- Recorded is not the same as verified. A controller must positively confirm the
  -- authority before it can unlock anything, and the guard requires this to be set.
  verified_by text,
  verified_at timestamptz,
  verification_method text,

  -- --- Who is collecting (release only) ---------------------------------------
  collector_name text,
  collector_id_number text,
  collector_capacity text,
  collector_contact text,

  -- --- Disposal specifics -------------------------------------------------------
  /** The statutory or contractual notice that preceded disposal. */
  disposal_notice_reference text,
  disposal_notice_served_at timestamptz,
  disposal_method text,

  /** Optional supporting document in the EXISTING evidence repository. */
  evidence_id uuid REFERENCES public.mobile_workforce_evidence (id) ON DELETE SET NULL,

  notes text,
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT rr_release_authorisations_company_id_id_key UNIQUE (company_id, id),
  CONSTRAINT rr_release_authorisations_reference_unique
    UNIQUE (company_id, service_job_id, authority_type, authority_reference),

  CONSTRAINT rr_release_authorisations_job_fk
    FOREIGN KEY (company_id, service_job_id)
    REFERENCES public.rr_service_jobs (company_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT rr_release_authorisations_counterparty_fk
    FOREIGN KEY (company_id, counterparty_id)
    REFERENCES public.rr_counterparties (company_id, id)
    ON DELETE RESTRICT,

  CONSTRAINT rr_release_authorisations_type_check CHECK (
    authority_type IN ('release', 'disposal')
  ),
  CONSTRAINT rr_release_authorisations_party_check CHECK (
    authority_party IN ('insurer', 'owner', 'finance_house', 'fleet_operator', 'saps', 'court', 'municipality')
  ),
  CONSTRAINT rr_release_authorisations_status_check CHECK (
    status IN ('active', 'expired', 'void', 'superseded')
  ),
  CONSTRAINT rr_release_authorisations_window_check CHECK (
    valid_from IS NULL OR expires_at IS NULL OR expires_at >= valid_from
  ),
  -- Voiding is recorded, never implied. Matches rr_authorisations.
  CONSTRAINT rr_release_authorisations_void_recorded CHECK (
    status <> 'void' OR (voided_at IS NOT NULL AND void_reason IS NOT NULL)
  ),
  -- Verification is a pair of facts or neither.
  CONSTRAINT rr_release_authorisations_verification_recorded CHECK (
    (verified_at IS NULL AND verified_by IS NULL)
    OR (verified_at IS NOT NULL AND verified_by IS NOT NULL)
  ),
  -- A release hands a vehicle to a PERSON. Recording who took it is the whole point.
  CONSTRAINT rr_release_authorisations_collector_recorded CHECK (
    authority_type <> 'release'
    OR (collector_name IS NOT NULL AND collector_capacity IS NOT NULL)
  ),
  -- Disposal without a served notice is not an authority; it is a liability.
  CONSTRAINT rr_release_authorisations_disposal_notice_recorded CHECK (
    authority_type <> 'disposal'
    OR (disposal_notice_reference IS NOT NULL AND disposal_notice_served_at IS NOT NULL)
  ),
  -- A release authority must not carry disposal fields, and the reverse. The two are
  -- separate decisions and a row must state exactly one of them.
  CONSTRAINT rr_release_authorisations_no_cross_authority CHECK (
    (authority_type = 'disposal')
    OR (disposal_notice_reference IS NULL
        AND disposal_notice_served_at IS NULL
        AND disposal_method IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_rr_release_authorisations_job
  ON public.rr_release_authorisations (company_id, service_job_id, authority_type, status);

COMMENT ON TABLE public.rr_release_authorisations IS
  'Release and disposal authority for a Road & Recovery job. LEGAL RECORD: ON DELETE RESTRICT against the service job, and voided rather than deleted. Resolves the release_authorised and disposal_authorised workflow guards; a release authority never satisfies the disposal guard.';

COMMENT ON COLUMN public.rr_release_authorisations.verified_at IS
  'Set when a controller positively verified the authority. The workflow guards require this: recorded is not the same as verified.';

-- ---------------------------------------------------------------------------
-- 2. Row level security + tenant isolation
-- ---------------------------------------------------------------------------
ALTER TABLE public.rr_release_authorisations ENABLE ROW LEVEL SECURITY;

DO $tenant$
BEGIN
  IF to_regprocedure('public.vyron_user_company_ids()') IS NULL
     OR to_regprocedure('public.vyron_is_platform_operator()') IS NULL THEN
    RAISE NOTICE
      'Tenant helper functions missing (sql/030). rr_release_authorisations has RLS enabled with NO policy, which denies all access until sql/030 and then sql/075 are run.';
    RETURN;
  END IF;

  EXECUTE 'DROP POLICY IF EXISTS rr_release_authorisations_tenant_isolation ON public.rr_release_authorisations';
  EXECUTE
    'CREATE POLICY rr_release_authorisations_tenant_isolation ON public.rr_release_authorisations FOR ALL TO authenticated USING (
       public.vyron_is_platform_operator()
       OR EXISTS (
         SELECT 1
         FROM public.vyron_user_company_ids() as c(company_id)
         WHERE c.company_id::text = public.rr_release_authorisations.company_id::text
       )
     ) WITH CHECK (
       public.vyron_is_platform_operator()
       OR EXISTS (
         SELECT 1
         FROM public.vyron_user_company_ids() as c(company_id)
         WHERE c.company_id::text = public.rr_release_authorisations.company_id::text
       )
     )';
END
$tenant$;

REVOKE ALL ON public.rr_release_authorisations FROM anon;

-- NON-DELETABLE, like rr_authorisations: an authority is voided (status, void_reason,
-- voided_at), never destroyed, so UPDATE is required and DELETE must not be granted.
GRANT SELECT, INSERT, UPDATE ON public.rr_release_authorisations TO authenticated;
REVOKE DELETE, TRUNCATE ON public.rr_release_authorisations FROM authenticated;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- 070-road-recovery-foundation.sql
-- VYRON CORE — Road & Recovery vertical, Phase 0 (foundations only).
--
-- ===========================================================================
-- WHAT THIS ADDS
-- ===========================================================================
--
--   public.rr_service_types          the service catalogue (8 seeded services)
--   public.rr_workflow_definitions   the state machines, stored as data (6 workflows)
--   public.rr_service_jobs           1:1 EXTENSION of public.field_jobs
--   public.rr_service_state_events   append-only workflow transition history
--
-- Plus one seeding function, module registration, and tenant-isolation policies.
--
-- ===========================================================================
-- WHAT THIS DOES *NOT* DO
-- ===========================================================================
--
-- No existing table is altered. Not one ADD COLUMN, not one DROP, not one
-- constraint change. In particular:
--
--   public.field_jobs is NOT modified, and its `status` CHECK constraint is NOT
--   widened.
--
-- That is deliberate and load-bearing. Three shipped engines hard-code the open-job
-- set against the six existing field_jobs.status values:
--
--   lib/payroll-intelligence.ts    ~line 730
--   lib/workforce-ai-copilot.ts    ~line 466
--   lib/workforce-digital-twin.ts  ~line 269
--
-- each testing ["Pending", "Dispatched", "Travelling", "On Site"]. Adding recovery
-- states to field_jobs.status would silently mis-bucket recovery work inside payroll
-- readiness, the AI Copilot and the Digital Twin.
--
-- So Road & Recovery uses a TWO-LEVEL STATUS MODEL:
--
--   field_jobs.status              coarse PHYSICAL status  — unchanged, 6 values
--   rr_service_jobs.service_state  fine-grained WORKFLOW state — this vertical only
--
-- Every workflow state declares the physical status it maps down to, inside its
-- workflow definition. lib/road-recovery/state-machine.ts#physicalStatusFor() is the
-- only sanctioned way to derive one from the other.
--
-- ===========================================================================
-- SINGLE SOURCE OF TRUTH FOR THE SEED
-- ===========================================================================
--
-- The service catalogue VALUES list and the workflow definition JSON below were
-- GENERATED from:
--
--   lib/road-recovery/service-types.ts   serviceTypeSeedRows()
--   lib/road-recovery/state-machine.ts   workflowDefinitionSeedJson()
--
-- tests/road-recovery-seed-parity.test.ts parses this file on every test run and fails
-- if either drifts from the TypeScript. Read the TypeScript for the human-readable
-- definitions; the JSON here is the machine copy the database needs.
--
-- ===========================================================================
-- BYSTAND
-- ===========================================================================
--
-- BYSTAND is a first-class service, NOT a tow subtype. There is no `tow_subtype`
-- column anywhere in this migration. The separation is enforced by CHECK constraints
-- that make the wrong shape unrepresentable rather than merely discouraged:
--
--   * rr_service_types_bystand_workflow_exclusive
--         service_code = 'bystand'  IF AND ONLY IF  workflow_key = 'bystand'
--   * rr_service_types_bystand_shape
--         a bystand service may not require a destination, custody or storage, must
--         bill standing time, must own the bystand KPI set, and must be able to spawn
--         a separate linked recovery job
--   * rr_service_jobs_bystand_no_destination
--         a bystand JOB cannot carry destination data at all
--
-- Idempotent and safe to re-run. Requires sql/001 (companies), sql/014 (field_jobs)
-- and, for policies, sql/030 (tenant helper functions). Run after sql/069.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------------------------------------------------------------------------
-- 0. Prerequisites
-- ---------------------------------------------------------------------------
DO $prereq$
BEGIN
  IF to_regclass('public.companies') IS NULL THEN
    RAISE EXCEPTION
      'Prerequisite missing: public.companies. Run sql/001-create-companies-tables.sql before sql/070.';
  END IF;

  IF to_regclass('public.field_jobs') IS NULL THEN
    RAISE EXCEPTION
      'Prerequisite missing: public.field_jobs. Run sql/014-field-operations.sql before sql/070. Road & Recovery EXTENDS field_jobs 1:1 and does not replace it.';
  END IF;
END
$prereq$;

-- ---------------------------------------------------------------------------
-- 1. rr_service_types — the service catalogue
-- ---------------------------------------------------------------------------
--
-- Per company, so a tenant can retire a service or rename it without a migration.
-- A service type DECLARES its workflow, billing basis, operational requirements and
-- KPI set. Everything downstream reads those declarations instead of branching on a
-- service name.
CREATE TABLE IF NOT EXISTS public.rr_service_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies (id) ON DELETE CASCADE,
  service_code text NOT NULL,
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  workflow_key text NOT NULL,
  billing_basis text NOT NULL,
  kpi_set_key text NOT NULL,
  requires_authorisation boolean NOT NULL DEFAULT false,
  requires_destination boolean NOT NULL DEFAULT false,
  requires_custody boolean NOT NULL DEFAULT false,
  requires_storage boolean NOT NULL DEFAULT false,
  can_spawn_recovery_job boolean NOT NULL DEFAULT false,
  bills_standing_time boolean NOT NULL DEFAULT false,
  sort_order integer NOT NULL DEFAULT 100,
  active boolean NOT NULL DEFAULT true,
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT rr_service_types_company_code_unique UNIQUE (company_id, service_code),

  CONSTRAINT rr_service_types_service_code_check CHECK (
    service_code IN (
      'accident_recovery',
      'tow_in',
      'jump_start',
      'roadside_assistance',
      'bystand',
      'heavy_recovery',
      'vehicle_movement',
      'storage'
    )
  ),
  CONSTRAINT rr_service_types_workflow_key_check CHECK (
    workflow_key IN (
      'tow_recovery',
      'heavy_recovery',
      'roadside_assist',
      'bystand',
      'vehicle_movement',
      'storage'
    )
  ),
  CONSTRAINT rr_service_types_billing_basis_check CHECK (
    billing_basis IN (
      'callout_plus_distance',
      'callout_plus_recovery_hours',
      'callout_only',
      'per_hour_standing',
      'per_km',
      'per_day_storage'
    )
  ),
  CONSTRAINT rr_service_types_kpi_set_check CHECK (
    kpi_set_key IN (
      'recovery',
      'heavy_recovery',
      'roadside',
      'bystand',
      'movement',
      'storage'
    )
  ),

  -- The BYSTAND workflow belongs to the BYSTAND service and to nothing else, in both
  -- directions. This is what makes "bystand is not a tow subtype" a schema fact.
  CONSTRAINT rr_service_types_bystand_workflow_exclusive CHECK (
    (service_code = 'bystand') = (workflow_key = 'bystand')
  ),

  -- A bystand service cannot be given tow characteristics.
  CONSTRAINT rr_service_types_bystand_shape CHECK (
    service_code <> 'bystand'
    OR (
      requires_destination = false
      AND requires_custody = false
      AND requires_storage = false
      AND billing_basis = 'per_hour_standing'
      AND bills_standing_time = true
      AND can_spawn_recovery_job = true
      AND kpi_set_key = 'bystand'
    )
  ),

  -- Standing-time billing and the standing-time basis are one fact, stated once.
  CONSTRAINT rr_service_types_standing_time_consistent CHECK (
    bills_standing_time = (billing_basis = 'per_hour_standing')
  ),

  -- Storage is custodial by definition.
  CONSTRAINT rr_service_types_storage_implies_custody CHECK (
    requires_storage = false OR requires_custody = true
  ),

  -- Referenced by the composite foreign key on rr_service_jobs (see section 3): it
  -- pins a job to a service type in the SAME company with a MATCHING workflow key,
  -- which no single-column FK could express.
  CONSTRAINT rr_service_types_company_id_workflow_unique UNIQUE (company_id, id, workflow_key)
);

CREATE INDEX IF NOT EXISTS idx_rr_service_types_company
  ON public.rr_service_types (company_id, active, sort_order);

COMMENT ON TABLE public.rr_service_types IS
  'Road & Recovery service catalogue. A service type declares its workflow, billing basis, operational requirements and KPI set. BYSTAND is a peer service, never a tow subtype. Mirrors RR_SERVICE_CATALOGUE in lib/road-recovery/service-types.ts.';

COMMENT ON COLUMN public.rr_service_types.bills_standing_time IS
  'True only for BYSTAND: the billable unit is time spent standing by on scene, not distance or recovery hours.';

-- ---------------------------------------------------------------------------
-- 2. rr_workflow_definitions — state machines as data
-- ---------------------------------------------------------------------------
--
-- The state machine is DATA, not code. `definition` holds the states (each with the
-- coarse field_jobs.status it maps down to) and the permitted transitions with their
-- guards. Versioned and immutable in practice: a change is a new version, so historical
-- jobs keep the graph they actually ran under.
CREATE TABLE IF NOT EXISTS public.rr_workflow_definitions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies (id) ON DELETE CASCADE,
  workflow_key text NOT NULL,
  version integer NOT NULL DEFAULT 1,
  active boolean NOT NULL DEFAULT true,
  definition jsonb NOT NULL,
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT rr_workflow_definitions_key_version_unique
    UNIQUE (company_id, workflow_key, version),

  CONSTRAINT rr_workflow_definitions_workflow_key_check CHECK (
    workflow_key IN (
      'tow_recovery',
      'heavy_recovery',
      'roadside_assist',
      'bystand',
      'vehicle_movement',
      'storage'
    )
  ),
  CONSTRAINT rr_workflow_definitions_version_check CHECK (version >= 1),

  -- The stored graph must describe the workflow it is filed under, and must actually
  -- contain states and transitions.
  CONSTRAINT rr_workflow_definitions_self_consistent CHECK (
    definition ->> 'workflow_key' = workflow_key
    AND jsonb_typeof(definition -> 'states') = 'array'
    AND jsonb_typeof(definition -> 'transitions') = 'array'
    AND jsonb_array_length(definition -> 'states') > 0
    AND jsonb_array_length(definition -> 'transitions') > 0
    AND definition ->> 'initial_state' IS NOT NULL
  ),

  -- Compared as text rather than cast to integer: a non-numeric value would make a
  -- cast raise instead of simply failing the constraint.
  CONSTRAINT rr_workflow_definitions_version_matches CHECK (
    definition ->> 'version' = version::text
  )
);

-- Exactly one active version per workflow per company.
CREATE UNIQUE INDEX IF NOT EXISTS idx_rr_workflow_definitions_active
  ON public.rr_workflow_definitions (company_id, workflow_key)
  WHERE active;

COMMENT ON TABLE public.rr_workflow_definitions IS
  'Road & Recovery state machines stored as versioned data. Each state declares the coarse field_jobs.status it maps to (two-level status model). Mirrors RR_WORKFLOW_DEFINITIONS in lib/road-recovery/state-machine.ts.';

-- ---------------------------------------------------------------------------
-- 3. rr_service_jobs — the 1:1 extension of field_jobs
-- ---------------------------------------------------------------------------
--
-- This is the Road & Recovery spine, and it EXTENDS field_jobs rather than replacing
-- it. field_job_id is UNIQUE, which is what makes the relationship 1:1.
--
-- Extending buys the whole existing field-operations stack for free, because all of it
-- already keys off field_jobs.id: assignments, GPS-stamped field_job_events, routes and
-- route segments, job costs, revenue, profitability, vehicle/trailer/asset links, the
-- client portal and GPS radius validation. A parallel job table would have duplicated
-- nine working engines.
CREATE TABLE IF NOT EXISTS public.rr_service_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies (id) ON DELETE CASCADE,

  -- THE 1:1 LINK. UNIQUE, so a field job has at most one Road & Recovery extension.
  field_job_id uuid NOT NULL REFERENCES public.field_jobs (id) ON DELETE CASCADE,

  service_type_id uuid NOT NULL,
  workflow_key text NOT NULL,
  workflow_version integer NOT NULL DEFAULT 1,

  -- The fine-grained Road & Recovery state. field_jobs.status keeps the coarse physical
  -- status and is NOT touched by this vertical's ladder.
  service_state text NOT NULL,
  previous_service_state text,
  state_entered_at timestamptz NOT NULL DEFAULT now(),

  -- Incident context
  incident_at timestamptz,
  reported_by text,
  reported_channel text,
  scene_description text,
  police_reference text,
  casualty_flag boolean NOT NULL DEFAULT false,
  hazmat_flag boolean NOT NULL DEFAULT false,

  -- Subject vehicle (the customer's vehicle, not the tow truck — the truck is
  -- field_jobs.vehicle_id in the existing fleet tables)
  vehicle_registration text,
  vehicle_make text,
  vehicle_model text,
  vehicle_vin text,
  vehicle_colour text,
  vehicle_is_drivable boolean,
  vehicle_condition_notes text,
  occupant_count integer,

  -- Origin (the scene). Destination is deliberately separate and is forbidden for
  -- bystand jobs by rr_service_jobs_bystand_no_destination below.
  origin_label text,
  origin_address text,
  origin_latitude numeric(10, 7),
  origin_longitude numeric(10, 7),

  destination_type text,
  destination_label text,
  destination_address text,
  destination_latitude numeric(10, 7),
  destination_longitude numeric(10, 7),

  -- Linked-job spawning. A BYSTAND job that turns into a recovery, or a roadside job
  -- that escalates, creates a SEPARATE job that points back here. The original job
  -- keeps its own service type, bills its own time and closes on its own terms — it is
  -- never mutated into a tow.
  spawned_from_service_job_id uuid REFERENCES public.rr_service_jobs (id) ON DELETE SET NULL,
  spawn_reason text,

  -- Soft lifecycle, matching lib/record-lifecycle.ts (active | archived | deleted).
  record_status text NOT NULL DEFAULT 'active',

  created_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT rr_service_jobs_field_job_unique UNIQUE (field_job_id),

  -- A job may only use a service type belonging to the SAME company whose workflow_key
  -- MATCHES the one recorded here. Defence in depth beyond RLS, and it keeps the
  -- denormalised workflow_key (needed by the CHECK constraints below, which cannot
  -- join) honest.
  CONSTRAINT rr_service_jobs_service_type_fk
    FOREIGN KEY (company_id, service_type_id, workflow_key)
    REFERENCES public.rr_service_types (company_id, id, workflow_key)
    ON DELETE RESTRICT,

  CONSTRAINT rr_service_jobs_workflow_fk
    FOREIGN KEY (company_id, workflow_key, workflow_version)
    REFERENCES public.rr_workflow_definitions (company_id, workflow_key, version)
    ON DELETE RESTRICT,

  CONSTRAINT rr_service_jobs_record_status_check CHECK (
    record_status IN ('active', 'archived', 'deleted')
  ),

  CONSTRAINT rr_service_jobs_destination_type_check CHECK (
    destination_type IS NULL
    OR destination_type IN (
      'repairer',
      'dealership',
      'storage_yard',
      'residential',
      'auction',
      'salvage',
      'police_pound',
      'other'
    )
  ),

  -- ==================================================================
  -- BYSTAND: a bystand job cannot carry destination data AT ALL.
  --
  -- This is the job-level half of the structural separation. Even if application code
  -- were to try, a bystand row with a delivery destination cannot exist. A bystand
  -- attendance moves no vehicle and takes custody of nothing.
  -- ==================================================================
  CONSTRAINT rr_service_jobs_bystand_no_destination CHECK (
    workflow_key <> 'bystand'
    OR (
      destination_type IS NULL
      AND destination_label IS NULL
      AND destination_address IS NULL
      AND destination_latitude IS NULL
      AND destination_longitude IS NULL
    )
  ),

  -- A job cannot have spawned itself.
  CONSTRAINT rr_service_jobs_spawn_not_self CHECK (
    spawned_from_service_job_id IS NULL OR spawned_from_service_job_id <> id
  ),

  CONSTRAINT rr_service_jobs_occupant_count_check CHECK (
    occupant_count IS NULL OR occupant_count >= 0
  ),

  CONSTRAINT rr_service_jobs_workflow_version_check CHECK (workflow_version >= 1)
);

CREATE INDEX IF NOT EXISTS idx_rr_service_jobs_company_state
  ON public.rr_service_jobs (company_id, service_state);

CREATE INDEX IF NOT EXISTS idx_rr_service_jobs_company_workflow
  ON public.rr_service_jobs (company_id, workflow_key, service_state);

CREATE INDEX IF NOT EXISTS idx_rr_service_jobs_service_type
  ON public.rr_service_jobs (company_id, service_type_id);

CREATE INDEX IF NOT EXISTS idx_rr_service_jobs_spawned_from
  ON public.rr_service_jobs (spawned_from_service_job_id)
  WHERE spawned_from_service_job_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_rr_service_jobs_vehicle_registration
  ON public.rr_service_jobs (company_id, vehicle_registration)
  WHERE vehicle_registration IS NOT NULL;

COMMENT ON TABLE public.rr_service_jobs IS
  'Road & Recovery 1:1 extension of public.field_jobs (field_job_id is UNIQUE). field_jobs remains the work-order spine so the existing cost, travel, profitability, vehicle, GPS and portal engines keep working unchanged.';

COMMENT ON COLUMN public.rr_service_jobs.service_state IS
  'Fine-grained Road & Recovery workflow state (two-level status model). The coarse physical status stays in field_jobs.status, whose CHECK constraint is deliberately NOT widened — see the header of sql/070.';

COMMENT ON COLUMN public.rr_service_jobs.spawned_from_service_job_id IS
  'Set on a job that was raised FROM another job (BYSTAND converting to recovery, roadside escalating to tow). The originating job is never mutated: it keeps its own service type, bills its own time and closes on its own terms.';

-- ---------------------------------------------------------------------------
-- 4. rr_service_state_events — append-only transition history
-- ---------------------------------------------------------------------------
--
-- One row per state transition, forever. This is the operational and evidentiary
-- record of how a job actually progressed, including who moved it, from where (GPS) and
-- how long it sat in the previous state. Later phases compute SLA clocks and BYSTAND
-- standing time from these rows, so they must never be edited.
--
-- Append-only is enforced twice: narrow grants (SELECT, INSERT) and a trigger that
-- rejects UPDATE and DELETE outright — the trigger also binds the service role, which
-- grants alone would not.
CREATE TABLE IF NOT EXISTS public.rr_service_state_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies (id) ON DELETE CASCADE,
  service_job_id uuid NOT NULL REFERENCES public.rr_service_jobs (id) ON DELETE CASCADE,

  workflow_key text NOT NULL,
  workflow_version integer NOT NULL DEFAULT 1,
  transition_code text NOT NULL,
  from_state text,
  to_state text NOT NULL,

  -- The coarse status on both sides, recorded so an audit can prove the two-level
  -- mapping that was applied at the time without re-deriving it from today's code.
  physical_status_before text,
  physical_status_after text,

  occurred_at timestamptz NOT NULL DEFAULT now(),
  seconds_in_previous_state integer,

  actor_email text,
  actor_role text,

  latitude numeric(10, 7),
  longitude numeric(10, 7),
  gps_accuracy numeric(10, 2),

  reason text,
  spawns_linked_job boolean NOT NULL DEFAULT false,
  enters_billable_standing_clock boolean NOT NULL DEFAULT false,
  leaves_billable_standing_clock boolean NOT NULL DEFAULT false,

  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),

  -- Only the six existing field_jobs.status values may appear here. This is the
  -- database-level guard on the two-level status model: it makes it impossible to
  -- record a physical status that field_jobs could not itself hold.
  CONSTRAINT rr_service_state_events_physical_before_check CHECK (
    physical_status_before IS NULL
    OR physical_status_before IN (
      'Pending', 'Dispatched', 'Travelling', 'On Site', 'Completed', 'Cancelled'
    )
  ),
  CONSTRAINT rr_service_state_events_physical_after_check CHECK (
    physical_status_after IS NULL
    OR physical_status_after IN (
      'Pending', 'Dispatched', 'Travelling', 'On Site', 'Completed', 'Cancelled'
    )
  ),
  CONSTRAINT rr_service_state_events_seconds_check CHECK (
    seconds_in_previous_state IS NULL OR seconds_in_previous_state >= 0
  ),
  -- A single transition cannot both start and stop the standing clock.
  CONSTRAINT rr_service_state_events_standing_clock_check CHECK (
    NOT (enters_billable_standing_clock AND leaves_billable_standing_clock)
  )
);

CREATE INDEX IF NOT EXISTS idx_rr_service_state_events_job
  ON public.rr_service_state_events (service_job_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_rr_service_state_events_company
  ON public.rr_service_state_events (company_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_rr_service_state_events_standing_clock
  ON public.rr_service_state_events (company_id, service_job_id, occurred_at)
  WHERE enters_billable_standing_clock OR leaves_billable_standing_clock;

COMMENT ON TABLE public.rr_service_state_events IS
  'Append-only Road & Recovery state transition history. Never updated or deleted (enforced by trigger). SLA clocks and BYSTAND standing time are derived from these rows in later phases.';

-- Append-only enforcement.
CREATE OR REPLACE FUNCTION public.rr_service_state_events_forbid_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $forbid$
BEGIN
  RAISE EXCEPTION
    'public.rr_service_state_events is append-only: % is not permitted. Record a corrective transition instead.',
    TG_OP;
END
$forbid$;

DROP TRIGGER IF EXISTS rr_service_state_events_append_only
  ON public.rr_service_state_events;

CREATE TRIGGER rr_service_state_events_append_only
  BEFORE UPDATE OR DELETE ON public.rr_service_state_events
  FOR EACH ROW
  EXECUTE FUNCTION public.rr_service_state_events_forbid_mutation();

-- ---------------------------------------------------------------------------
-- 5. Row level security + tenant isolation
-- ---------------------------------------------------------------------------
--
-- Same policy shape sql/049 generates for every company-scoped table, written out
-- explicitly here so these tables are isolated the moment they are created rather than
-- waiting for 049 to be re-run. Every company_id is `uuid NOT NULL REFERENCES
-- companies(id)`, which is what keeps the 049 generator working on them too (see
-- docs/SCHEMA_NORMALIZATION_PLAN.md for the text-vs-uuid failure this avoids).
ALTER TABLE public.rr_service_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rr_workflow_definitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rr_service_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rr_service_state_events ENABLE ROW LEVEL SECURITY;

DO $tenant$
DECLARE
  tbl text;
BEGIN
  IF to_regprocedure('public.vyron_user_company_ids()') IS NULL
     OR to_regprocedure('public.vyron_is_platform_operator()') IS NULL THEN
    RAISE NOTICE
      'Tenant helper functions missing (sql/030). Road & Recovery tables have RLS enabled with NO policy, which denies all access until sql/030 and then sql/070 are run.';
    RETURN;
  END IF;

  FOR tbl IN
    SELECT unnest(ARRAY[
      'rr_service_types',
      'rr_workflow_definitions',
      'rr_service_jobs',
      'rr_service_state_events'
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

-- Grants. anon never reaches this vertical.
REVOKE ALL ON public.rr_service_types FROM anon;
REVOKE ALL ON public.rr_workflow_definitions FROM anon;
REVOKE ALL ON public.rr_service_jobs FROM anon;
REVOKE ALL ON public.rr_service_state_events FROM anon;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.rr_service_types TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.rr_workflow_definitions TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.rr_service_jobs TO authenticated;

-- Append-only: no UPDATE, no DELETE, for anyone.
GRANT SELECT, INSERT ON public.rr_service_state_events TO authenticated;

-- ---------------------------------------------------------------------------
-- 6. Seeding function
-- ---------------------------------------------------------------------------
--
-- The catalogue and the workflows are company-scoped, so they are seeded PER COMPANY.
-- They are seeded only for companies that actually hold the Road & Recovery module —
-- a retail or healthcare tenant has no business acquiring towing service types. Phase 1
-- provisioning calls this function when the module is switched on.
--
-- Idempotent: existing rows are left exactly as they are, so a tenant that has renamed
-- or deactivated a service keeps their change across re-runs.
CREATE OR REPLACE FUNCTION public.rr_seed_service_catalogue(p_company_id uuid)
RETURNS void
LANGUAGE plpgsql
AS $seed$
BEGIN
  IF p_company_id IS NULL THEN
    RAISE EXCEPTION 'rr_seed_service_catalogue: p_company_id is required.';
  END IF;

  -- Workflow definitions first: rr_service_jobs later depends on both, and the
  -- catalogue is meaningless without the graphs.
  INSERT INTO public.rr_workflow_definitions (
    company_id, workflow_key, version, active, definition, created_by
  )
  SELECT p_company_id, seed.workflow_key, seed.version, true, seed.definition, 'sql/070'
  FROM (
    VALUES
-- >>> GENERATED: WORKFLOW DEFINITIONS (see header) >>>
    ('tow_recovery', 1, $rr_wf${"workflow_key":"tow_recovery","version":1,"initial_state":"draft","states":[{"state":"draft","kind":"active","physical_status":"Pending","billable_standing_clock":false,"description":"Captured but not yet logged."},{"state":"logged","kind":"active","physical_status":"Pending","billable_standing_clock":false,"description":"Accepted into the operation."},{"state":"authorisation_pending","kind":"active","physical_status":"Pending","billable_standing_clock":false,"description":null},{"state":"authorised","kind":"active","physical_status":"Pending","billable_standing_clock":false,"description":null},{"state":"dispatch_pending","kind":"active","physical_status":"Pending","billable_standing_clock":false,"description":null},{"state":"assigned","kind":"active","physical_status":"Dispatched","billable_standing_clock":false,"description":null},{"state":"accepted","kind":"active","physical_status":"Dispatched","billable_standing_clock":false,"description":null},{"state":"en_route","kind":"active","physical_status":"Travelling","billable_standing_clock":false,"description":null},{"state":"on_scene","kind":"active","physical_status":"On Site","billable_standing_clock":false,"description":null},{"state":"assessing","kind":"active","physical_status":"On Site","billable_standing_clock":false,"description":null},{"state":"loading","kind":"active","physical_status":"On Site","billable_standing_clock":false,"description":null},{"state":"secured","kind":"active","physical_status":"On Site","billable_standing_clock":false,"description":null},{"state":"departing_scene","kind":"active","physical_status":"On Site","billable_standing_clock":false,"description":null},{"state":"in_transit","kind":"active","physical_status":"Travelling","billable_standing_clock":false,"description":null},{"state":"arrived_destination","kind":"active","physical_status":"On Site","billable_standing_clock":false,"description":null},{"state":"offloading","kind":"active","physical_status":"On Site","billable_standing_clock":false,"description":null},{"state":"storage_in","kind":"active","physical_status":"On Site","billable_standing_clock":false,"description":"Handed into the storage sub-workflow instead of a third party."},{"state":"handover_pending","kind":"active","physical_status":"On Site","billable_standing_clock":false,"description":null},{"state":"handed_over","kind":"active","physical_status":"On Site","billable_standing_clock":false,"description":null},{"state":"paperwork_complete","kind":"active","physical_status":"On Site","billable_standing_clock":false,"description":null},{"state":"evidence_complete","kind":"active","physical_status":"On Site","billable_standing_clock":false,"description":null},{"state":"invoice_ready","kind":"active","physical_status":"Completed","billable_standing_clock":false,"description":null},{"state":"invoiced","kind":"active","physical_status":"Completed","billable_standing_clock":false,"description":null},{"state":"closed","kind":"terminal","physical_status":"Completed","billable_standing_clock":false,"description":null},{"state":"cancelled","kind":"terminal","physical_status":"Cancelled","billable_standing_clock":false,"description":null},{"state":"declined","kind":"active","physical_status":"Cancelled","billable_standing_clock":false,"description":"Authorisation refused. Must still be closed out by a controller."},{"state":"no_show","kind":"active","physical_status":"Cancelled","billable_standing_clock":false,"description":"Nothing to attend on arrival. Must still be closed out by a controller."}],"transitions":[{"code":"log","from":"draft","to":"logged","guards":[],"spawns_linked_job":false,"requires_reason":false},{"code":"request_authorisation","from":"logged","to":"authorisation_pending","guards":[],"spawns_linked_job":false,"requires_reason":false},{"code":"skip_authorisation","from":"logged","to":"dispatch_pending","guards":["authorisation_not_required"],"spawns_linked_job":false,"requires_reason":false},{"code":"authorise","from":"authorisation_pending","to":"authorised","guards":[],"spawns_linked_job":false,"requires_reason":false},{"code":"decline","from":"authorisation_pending","to":"declined","guards":[],"spawns_linked_job":false,"requires_reason":true},{"code":"release_to_dispatch","from":"authorised","to":"dispatch_pending","guards":["authorisation_valid"],"spawns_linked_job":false,"requires_reason":false},{"code":"assign","from":"dispatch_pending","to":"assigned","guards":[],"spawns_linked_job":false,"requires_reason":false},{"code":"unassign","from":"assigned","to":"dispatch_pending","guards":[],"spawns_linked_job":false,"requires_reason":true},{"code":"accept","from":"assigned","to":"accepted","guards":[],"spawns_linked_job":false,"requires_reason":false},{"code":"depart","from":"accepted","to":"en_route","guards":[],"spawns_linked_job":false,"requires_reason":false},{"code":"arrive_scene","from":"en_route","to":"on_scene","guards":[],"spawns_linked_job":false,"requires_reason":false},{"code":"record_no_show","from":"en_route","to":"no_show","guards":[],"spawns_linked_job":false,"requires_reason":true},{"code":"begin_assessment","from":"on_scene","to":"assessing","guards":[],"spawns_linked_job":false,"requires_reason":false},{"code":"begin_loading","from":"assessing","to":"loading","guards":[],"spawns_linked_job":false,"requires_reason":false},{"code":"secure_load","from":"loading","to":"secured","guards":[],"spawns_linked_job":false,"requires_reason":false},{"code":"clear_scene","from":"secured","to":"departing_scene","guards":[],"spawns_linked_job":false,"requires_reason":false},{"code":"begin_transit","from":"departing_scene","to":"in_transit","guards":[],"spawns_linked_job":false,"requires_reason":false},{"code":"arrive_destination","from":"in_transit","to":"arrived_destination","guards":[],"spawns_linked_job":false,"requires_reason":false},{"code":"begin_offload","from":"arrived_destination","to":"offloading","guards":[],"spawns_linked_job":false,"requires_reason":false},{"code":"route_to_storage","from":"arrived_destination","to":"storage_in","guards":[],"spawns_linked_job":false,"requires_reason":false},{"code":"ready_for_handover","from":"offloading","to":"handover_pending","guards":[],"spawns_linked_job":false,"requires_reason":false},{"code":"complete_handover","from":"handover_pending","to":"handed_over","guards":[],"spawns_linked_job":false,"requires_reason":false},{"code":"storage_accepted","from":"storage_in","to":"handed_over","guards":[],"spawns_linked_job":false,"requires_reason":false},{"code":"complete_paperwork","from":"handed_over","to":"paperwork_complete","guards":[],"spawns_linked_job":false,"requires_reason":false},{"code":"verify_evidence","from":"paperwork_complete","to":"evidence_complete","guards":[],"spawns_linked_job":false,"requires_reason":false},{"code":"ready_to_invoice","from":"evidence_complete","to":"invoice_ready","guards":["evidence_complete"],"spawns_linked_job":false,"requires_reason":false},{"code":"issue_invoice","from":"invoice_ready","to":"invoiced","guards":[],"spawns_linked_job":false,"requires_reason":false},{"code":"close","from":"invoiced","to":"closed","guards":[],"spawns_linked_job":false,"requires_reason":false},{"code":"cancel_after_decline","from":"declined","to":"cancelled","guards":[],"spawns_linked_job":false,"requires_reason":true},{"code":"close_no_show","from":"no_show","to":"cancelled","guards":[],"spawns_linked_job":false,"requires_reason":true},{"code":"cancel","from":"*","to":"cancelled","guards":[],"spawns_linked_job":false,"requires_reason":true}]}$rr_wf$::jsonb),
    ('heavy_recovery', 1, $rr_wf${"workflow_key":"heavy_recovery","version":1,"initial_state":"draft","states":[{"state":"draft","kind":"active","physical_status":"Pending","billable_standing_clock":false,"description":"Captured but not yet logged."},{"state":"logged","kind":"active","physical_status":"Pending","billable_standing_clock":false,"description":"Accepted into the operation."},{"state":"authorisation_pending","kind":"active","physical_status":"Pending","billable_standing_clock":false,"description":null},{"state":"authorised","kind":"active","physical_status":"Pending","billable_standing_clock":false,"description":null},{"state":"dispatch_pending","kind":"active","physical_status":"Pending","billable_standing_clock":false,"description":null},{"state":"assigned","kind":"active","physical_status":"Dispatched","billable_standing_clock":false,"description":null},{"state":"accepted","kind":"active","physical_status":"Dispatched","billable_standing_clock":false,"description":null},{"state":"en_route","kind":"active","physical_status":"Travelling","billable_standing_clock":false,"description":null},{"state":"on_scene","kind":"active","physical_status":"On Site","billable_standing_clock":false,"description":null},{"state":"scene_assessment","kind":"active","physical_status":"On Site","billable_standing_clock":false,"description":null},{"state":"recovery_plan_pending","kind":"active","physical_status":"On Site","billable_standing_clock":false,"description":null},{"state":"recovery_plan_approved","kind":"active","physical_status":"On Site","billable_standing_clock":false,"description":"Second authorisation: the recovery plan and its cost ceiling."},{"state":"additional_resources_requested","kind":"paused","physical_status":"On Site","billable_standing_clock":false,"description":null},{"state":"rigging","kind":"active","physical_status":"On Site","billable_standing_clock":false,"description":null},{"state":"recovery_in_progress","kind":"active","physical_status":"On Site","billable_standing_clock":false,"description":null},{"state":"uprighted","kind":"active","physical_status":"On Site","billable_standing_clock":false,"description":null},{"state":"load_secured","kind":"active","physical_status":"On Site","billable_standing_clock":false,"description":null},{"state":"scene_cleared","kind":"active","physical_status":"On Site","billable_standing_clock":false,"description":null},{"state":"in_transit","kind":"active","physical_status":"Travelling","billable_standing_clock":false,"description":null},{"state":"arrived_destination","kind":"active","physical_status":"On Site","billable_standing_clock":false,"description":null},{"state":"offloading","kind":"active","physical_status":"On Site","billable_standing_clock":false,"description":null},{"state":"storage_in","kind":"active","physical_status":"On Site","billable_standing_clock":false,"description":null},{"state":"handover_pending","kind":"active","physical_status":"On Site","billable_standing_clock":false,"description":null},{"state":"handed_over","kind":"active","physical_status":"On Site","billable_standing_clock":false,"description":null},{"state":"paperwork_complete","kind":"active","physical_status":"On Site","billable_standing_clock":false,"description":null},{"state":"evidence_complete","kind":"active","physical_status":"On Site","billable_standing_clock":false,"description":null},{"state":"invoice_ready","kind":"active","physical_status":"Completed","billable_standing_clock":false,"description":null},{"state":"invoiced","kind":"active","physical_status":"Completed","billable_standing_clock":false,"description":null},{"state":"closed","kind":"terminal","physical_status":"Completed","billable_standing_clock":false,"description":null},{"state":"cancelled","kind":"terminal","physical_status":"Cancelled","billable_standing_clock":false,"description":null},{"state":"declined","kind":"active","physical_status":"Cancelled","billable_standing_clock":false,"description":"Authorisation refused. Must still be closed out by a controller."},{"state":"no_show","kind":"active","physical_status":"Cancelled","billable_standing_clock":false,"description":"Nothing to attend on arrival. Must still be closed out by a controller."}],"transitions":[{"code":"log","from":"draft","to":"logged","guards":[],"spawns_linked_job":false,"requires_reason":false},{"code":"request_authorisation","from":"logged","to":"authorisation_pending","guards":[],"spawns_linked_job":false,"requires_reason":false},{"code":"skip_authorisation","from":"logged","to":"dispatch_pending","guards":["authorisation_not_required"],"spawns_linked_job":false,"requires_reason":false},{"code":"authorise","from":"authorisation_pending","to":"authorised","guards":[],"spawns_linked_job":false,"requires_reason":false},{"code":"decline","from":"authorisation_pending","to":"declined","guards":[],"spawns_linked_job":false,"requires_reason":true},{"code":"release_to_dispatch","from":"authorised","to":"dispatch_pending","guards":["authorisation_valid"],"spawns_linked_job":false,"requires_reason":false},{"code":"assign","from":"dispatch_pending","to":"assigned","guards":[],"spawns_linked_job":false,"requires_reason":false},{"code":"unassign","from":"assigned","to":"dispatch_pending","guards":[],"spawns_linked_job":false,"requires_reason":true},{"code":"accept","from":"assigned","to":"accepted","guards":[],"spawns_linked_job":false,"requires_reason":false},{"code":"depart","from":"accepted","to":"en_route","guards":[],"spawns_linked_job":false,"requires_reason":false},{"code":"arrive_scene","from":"en_route","to":"on_scene","guards":[],"spawns_linked_job":false,"requires_reason":false},{"code":"record_no_show","from":"en_route","to":"no_show","guards":[],"spawns_linked_job":false,"requires_reason":true},{"code":"begin_scene_assessment","from":"on_scene","to":"scene_assessment","guards":[],"spawns_linked_job":false,"requires_reason":false},{"code":"submit_recovery_plan","from":"scene_assessment","to":"recovery_plan_pending","guards":[],"spawns_linked_job":false,"requires_reason":false},{"code":"approve_recovery_plan","from":"recovery_plan_pending","to":"recovery_plan_approved","guards":["authorisation_valid"],"spawns_linked_job":false,"requires_reason":false},{"code":"request_additional_resources","from":"recovery_plan_approved","to":"additional_resources_requested","guards":[],"spawns_linked_job":false,"requires_reason":true},{"code":"resources_on_scene","from":"additional_resources_requested","to":"recovery_plan_approved","guards":[],"spawns_linked_job":false,"requires_reason":false},{"code":"begin_rigging","from":"recovery_plan_approved","to":"rigging","guards":[],"spawns_linked_job":false,"requires_reason":false},{"code":"begin_recovery","from":"rigging","to":"recovery_in_progress","guards":[],"spawns_linked_job":false,"requires_reason":false},{"code":"upright_vehicle","from":"recovery_in_progress","to":"uprighted","guards":[],"spawns_linked_job":false,"requires_reason":false},{"code":"secure_load","from":"uprighted","to":"load_secured","guards":[],"spawns_linked_job":false,"requires_reason":false},{"code":"clear_scene","from":"load_secured","to":"scene_cleared","guards":[],"spawns_linked_job":false,"requires_reason":false},{"code":"begin_transit","from":"scene_cleared","to":"in_transit","guards":[],"spawns_linked_job":false,"requires_reason":false},{"code":"arrive_destination","from":"in_transit","to":"arrived_destination","guards":[],"spawns_linked_job":false,"requires_reason":false},{"code":"begin_offload","from":"arrived_destination","to":"offloading","guards":[],"spawns_linked_job":false,"requires_reason":false},{"code":"route_to_storage","from":"arrived_destination","to":"storage_in","guards":[],"spawns_linked_job":false,"requires_reason":false},{"code":"ready_for_handover","from":"offloading","to":"handover_pending","guards":[],"spawns_linked_job":false,"requires_reason":false},{"code":"complete_handover","from":"handover_pending","to":"handed_over","guards":[],"spawns_linked_job":false,"requires_reason":false},{"code":"storage_accepted","from":"storage_in","to":"handed_over","guards":[],"spawns_linked_job":false,"requires_reason":false},{"code":"complete_paperwork","from":"handed_over","to":"paperwork_complete","guards":[],"spawns_linked_job":false,"requires_reason":false},{"code":"verify_evidence","from":"paperwork_complete","to":"evidence_complete","guards":[],"spawns_linked_job":false,"requires_reason":false},{"code":"ready_to_invoice","from":"evidence_complete","to":"invoice_ready","guards":["evidence_complete"],"spawns_linked_job":false,"requires_reason":false},{"code":"issue_invoice","from":"invoice_ready","to":"invoiced","guards":[],"spawns_linked_job":false,"requires_reason":false},{"code":"close","from":"invoiced","to":"closed","guards":[],"spawns_linked_job":false,"requires_reason":false},{"code":"cancel_after_decline","from":"declined","to":"cancelled","guards":[],"spawns_linked_job":false,"requires_reason":true},{"code":"close_no_show","from":"no_show","to":"cancelled","guards":[],"spawns_linked_job":false,"requires_reason":true},{"code":"cancel","from":"*","to":"cancelled","guards":[],"spawns_linked_job":false,"requires_reason":true}]}$rr_wf$::jsonb),
    ('roadside_assist', 1, $rr_wf${"workflow_key":"roadside_assist","version":1,"initial_state":"draft","states":[{"state":"draft","kind":"active","physical_status":"Pending","billable_standing_clock":false,"description":"Captured but not yet logged."},{"state":"logged","kind":"active","physical_status":"Pending","billable_standing_clock":false,"description":"Accepted into the operation."},{"state":"authorisation_pending","kind":"active","physical_status":"Pending","billable_standing_clock":false,"description":null},{"state":"authorised","kind":"active","physical_status":"Pending","billable_standing_clock":false,"description":null},{"state":"dispatch_pending","kind":"active","physical_status":"Pending","billable_standing_clock":false,"description":null},{"state":"assigned","kind":"active","physical_status":"Dispatched","billable_standing_clock":false,"description":null},{"state":"accepted","kind":"active","physical_status":"Dispatched","billable_standing_clock":false,"description":null},{"state":"en_route","kind":"active","physical_status":"Travelling","billable_standing_clock":false,"description":null},{"state":"on_scene","kind":"active","physical_status":"On Site","billable_standing_clock":false,"description":null},{"state":"diagnosing","kind":"active","physical_status":"On Site","billable_standing_clock":false,"description":null},{"state":"service_in_progress","kind":"active","physical_status":"On Site","billable_standing_clock":false,"description":null},{"state":"resolved_on_scene","kind":"active","physical_status":"On Site","billable_standing_clock":false,"description":null},{"state":"customer_signed_off","kind":"active","physical_status":"On Site","billable_standing_clock":false,"description":null},{"state":"unresolved","kind":"active","physical_status":"On Site","billable_standing_clock":false,"description":null},{"state":"escalated_to_tow","kind":"active","physical_status":"On Site","billable_standing_clock":false,"description":"A separate linked recovery job is raised. This job still bills its own callout and closes on its own terms."},{"state":"evidence_complete","kind":"active","physical_status":"On Site","billable_standing_clock":false,"description":null},{"state":"invoice_ready","kind":"active","physical_status":"Completed","billable_standing_clock":false,"description":null},{"state":"invoiced","kind":"active","physical_status":"Completed","billable_standing_clock":false,"description":null},{"state":"closed","kind":"terminal","physical_status":"Completed","billable_standing_clock":false,"description":null},{"state":"cancelled","kind":"terminal","physical_status":"Cancelled","billable_standing_clock":false,"description":null},{"state":"declined","kind":"active","physical_status":"Cancelled","billable_standing_clock":false,"description":"Authorisation refused. Must still be closed out by a controller."},{"state":"no_show","kind":"active","physical_status":"Cancelled","billable_standing_clock":false,"description":"Nothing to attend on arrival. Must still be closed out by a controller."}],"transitions":[{"code":"log","from":"draft","to":"logged","guards":[],"spawns_linked_job":false,"requires_reason":false},{"code":"request_authorisation","from":"logged","to":"authorisation_pending","guards":[],"spawns_linked_job":false,"requires_reason":false},{"code":"skip_authorisation","from":"logged","to":"dispatch_pending","guards":["authorisation_not_required"],"spawns_linked_job":false,"requires_reason":false},{"code":"authorise","from":"authorisation_pending","to":"authorised","guards":[],"spawns_linked_job":false,"requires_reason":false},{"code":"decline","from":"authorisation_pending","to":"declined","guards":[],"spawns_linked_job":false,"requires_reason":true},{"code":"release_to_dispatch","from":"authorised","to":"dispatch_pending","guards":["authorisation_valid"],"spawns_linked_job":false,"requires_reason":false},{"code":"assign","from":"dispatch_pending","to":"assigned","guards":[],"spawns_linked_job":false,"requires_reason":false},{"code":"unassign","from":"assigned","to":"dispatch_pending","guards":[],"spawns_linked_job":false,"requires_reason":true},{"code":"accept","from":"assigned","to":"accepted","guards":[],"spawns_linked_job":false,"requires_reason":false},{"code":"depart","from":"accepted","to":"en_route","guards":[],"spawns_linked_job":false,"requires_reason":false},{"code":"arrive_scene","from":"en_route","to":"on_scene","guards":[],"spawns_linked_job":false,"requires_reason":false},{"code":"record_no_show","from":"en_route","to":"no_show","guards":[],"spawns_linked_job":false,"requires_reason":true},{"code":"begin_diagnosis","from":"on_scene","to":"diagnosing","guards":[],"spawns_linked_job":false,"requires_reason":false},{"code":"begin_service","from":"diagnosing","to":"service_in_progress","guards":[],"spawns_linked_job":false,"requires_reason":false},{"code":"resolve_on_scene","from":"service_in_progress","to":"resolved_on_scene","guards":[],"spawns_linked_job":false,"requires_reason":false},{"code":"record_unresolved","from":"service_in_progress","to":"unresolved","guards":[],"spawns_linked_job":false,"requires_reason":true},{"code":"escalate_to_tow","from":"unresolved","to":"escalated_to_tow","guards":[],"spawns_linked_job":true,"requires_reason":true},{"code":"customer_sign_off","from":"resolved_on_scene","to":"customer_signed_off","guards":[],"spawns_linked_job":false,"requires_reason":false},{"code":"verify_evidence","from":"customer_signed_off","to":"evidence_complete","guards":[],"spawns_linked_job":false,"requires_reason":false},{"code":"verify_evidence_after_escalation","from":"escalated_to_tow","to":"evidence_complete","guards":[],"spawns_linked_job":false,"requires_reason":false},{"code":"ready_to_invoice","from":"evidence_complete","to":"invoice_ready","guards":["evidence_complete"],"spawns_linked_job":false,"requires_reason":false},{"code":"issue_invoice","from":"invoice_ready","to":"invoiced","guards":[],"spawns_linked_job":false,"requires_reason":false},{"code":"close","from":"invoiced","to":"closed","guards":[],"spawns_linked_job":false,"requires_reason":false},{"code":"cancel_after_decline","from":"declined","to":"cancelled","guards":[],"spawns_linked_job":false,"requires_reason":true},{"code":"close_no_show","from":"no_show","to":"cancelled","guards":[],"spawns_linked_job":false,"requires_reason":true},{"code":"cancel","from":"*","to":"cancelled","guards":[],"spawns_linked_job":false,"requires_reason":true}]}$rr_wf$::jsonb),
    ('bystand', 1, $rr_wf${"workflow_key":"bystand","version":1,"initial_state":"draft","states":[{"state":"draft","kind":"active","physical_status":"Pending","billable_standing_clock":false,"description":null},{"state":"logged","kind":"active","physical_status":"Pending","billable_standing_clock":false,"description":null},{"state":"bystand_requested","kind":"active","physical_status":"Pending","billable_standing_clock":false,"description":"A bystand attendance specifically has been requested."},{"state":"authorisation_pending","kind":"active","physical_status":"Pending","billable_standing_clock":false,"description":null},{"state":"authorised","kind":"active","physical_status":"Pending","billable_standing_clock":false,"description":null},{"state":"assigned","kind":"active","physical_status":"Dispatched","billable_standing_clock":false,"description":null},{"state":"accepted","kind":"active","physical_status":"Dispatched","billable_standing_clock":false,"description":null},{"state":"en_route","kind":"active","physical_status":"Travelling","billable_standing_clock":false,"description":null},{"state":"arrived_on_scene","kind":"active","physical_status":"On Site","billable_standing_clock":false,"description":null},{"state":"standing_by","kind":"active","physical_status":"On Site","billable_standing_clock":true,"description":"Billable standing time accrues here and nowhere else."},{"state":"scene_handover_to_authority","kind":"paused","physical_status":"On Site","billable_standing_clock":false,"description":"Scene under authority control; standing clock paused."},{"state":"weather_hold","kind":"paused","physical_status":"On Site","billable_standing_clock":false,"description":null},{"state":"converted_to_recovery","kind":"active","physical_status":"On Site","billable_standing_clock":false,"description":"A SEPARATE linked recovery job has been raised. This bystand job bills its own standing time and closes on its own terms."},{"state":"stand_down_requested","kind":"active","physical_status":"On Site","billable_standing_clock":false,"description":null},{"state":"stood_down","kind":"active","physical_status":"On Site","billable_standing_clock":false,"description":null},{"state":"departed_scene","kind":"active","physical_status":"On Site","billable_standing_clock":false,"description":null},{"state":"report_submitted","kind":"active","physical_status":"On Site","billable_standing_clock":false,"description":null},{"state":"evidence_complete","kind":"active","physical_status":"On Site","billable_standing_clock":false,"description":null},{"state":"invoice_ready","kind":"active","physical_status":"Completed","billable_standing_clock":false,"description":null},{"state":"invoiced","kind":"active","physical_status":"Completed","billable_standing_clock":false,"description":null},{"state":"closed","kind":"terminal","physical_status":"Completed","billable_standing_clock":false,"description":null},{"state":"cancelled","kind":"terminal","physical_status":"Cancelled","billable_standing_clock":false,"description":null},{"state":"declined","kind":"active","physical_status":"Cancelled","billable_standing_clock":false,"description":null},{"state":"no_show","kind":"active","physical_status":"Cancelled","billable_standing_clock":false,"description":null}],"transitions":[{"code":"log","from":"draft","to":"logged","guards":[],"spawns_linked_job":false,"requires_reason":false},{"code":"request_bystand","from":"logged","to":"bystand_requested","guards":[],"spawns_linked_job":false,"requires_reason":false},{"code":"request_authorisation","from":"bystand_requested","to":"authorisation_pending","guards":[],"spawns_linked_job":false,"requires_reason":false},{"code":"authorise","from":"authorisation_pending","to":"authorised","guards":[],"spawns_linked_job":false,"requires_reason":false},{"code":"decline","from":"authorisation_pending","to":"declined","guards":[],"spawns_linked_job":false,"requires_reason":true},{"code":"assign","from":"authorised","to":"assigned","guards":["authorisation_valid"],"spawns_linked_job":false,"requires_reason":false},{"code":"unassign","from":"assigned","to":"authorised","guards":[],"spawns_linked_job":false,"requires_reason":true},{"code":"accept","from":"assigned","to":"accepted","guards":[],"spawns_linked_job":false,"requires_reason":false},{"code":"depart","from":"accepted","to":"en_route","guards":[],"spawns_linked_job":false,"requires_reason":false},{"code":"arrive_scene","from":"en_route","to":"arrived_on_scene","guards":[],"spawns_linked_job":false,"requires_reason":false},{"code":"record_no_show","from":"en_route","to":"no_show","guards":[],"spawns_linked_job":false,"requires_reason":true},{"code":"begin_standing_by","from":"arrived_on_scene","to":"standing_by","guards":[],"spawns_linked_job":false,"requires_reason":false},{"code":"hand_scene_to_authority","from":"standing_by","to":"scene_handover_to_authority","guards":[],"spawns_linked_job":false,"requires_reason":true},{"code":"resume_from_authority","from":"scene_handover_to_authority","to":"standing_by","guards":[],"spawns_linked_job":false,"requires_reason":false},{"code":"weather_hold","from":"standing_by","to":"weather_hold","guards":[],"spawns_linked_job":false,"requires_reason":true},{"code":"resume_from_weather","from":"weather_hold","to":"standing_by","guards":[],"spawns_linked_job":false,"requires_reason":false},{"code":"convert_to_recovery","from":"standing_by","to":"converted_to_recovery","guards":[],"spawns_linked_job":true,"requires_reason":true},{"code":"request_stand_down","from":"standing_by","to":"stand_down_requested","guards":[],"spawns_linked_job":false,"requires_reason":false},{"code":"request_stand_down_after_conversion","from":"converted_to_recovery","to":"stand_down_requested","guards":[],"spawns_linked_job":false,"requires_reason":false},{"code":"stand_down","from":"stand_down_requested","to":"stood_down","guards":[],"spawns_linked_job":false,"requires_reason":false},{"code":"depart_scene","from":"stood_down","to":"departed_scene","guards":[],"spawns_linked_job":false,"requires_reason":false},{"code":"submit_report","from":"departed_scene","to":"report_submitted","guards":[],"spawns_linked_job":false,"requires_reason":false},{"code":"verify_evidence","from":"report_submitted","to":"evidence_complete","guards":[],"spawns_linked_job":false,"requires_reason":false},{"code":"ready_to_invoice","from":"evidence_complete","to":"invoice_ready","guards":["evidence_complete"],"spawns_linked_job":false,"requires_reason":false},{"code":"issue_invoice","from":"invoice_ready","to":"invoiced","guards":[],"spawns_linked_job":false,"requires_reason":false},{"code":"close","from":"invoiced","to":"closed","guards":[],"spawns_linked_job":false,"requires_reason":false},{"code":"cancel_after_decline","from":"declined","to":"cancelled","guards":[],"spawns_linked_job":false,"requires_reason":true},{"code":"close_no_show","from":"no_show","to":"cancelled","guards":[],"spawns_linked_job":false,"requires_reason":true},{"code":"cancel","from":"*","to":"cancelled","guards":[],"spawns_linked_job":false,"requires_reason":true}]}$rr_wf$::jsonb),
    ('vehicle_movement', 1, $rr_wf${"workflow_key":"vehicle_movement","version":1,"initial_state":"draft","states":[{"state":"draft","kind":"active","physical_status":"Pending","billable_standing_clock":false,"description":null},{"state":"logged","kind":"active","physical_status":"Pending","billable_standing_clock":false,"description":null},{"state":"collection_scheduled","kind":"active","physical_status":"Pending","billable_standing_clock":false,"description":null},{"state":"assigned","kind":"active","physical_status":"Dispatched","billable_standing_clock":false,"description":null},{"state":"accepted","kind":"active","physical_status":"Dispatched","billable_standing_clock":false,"description":null},{"state":"en_route_collection","kind":"active","physical_status":"Travelling","billable_standing_clock":false,"description":null},{"state":"at_collection","kind":"active","physical_status":"On Site","billable_standing_clock":false,"description":null},{"state":"pre_move_inspection","kind":"active","physical_status":"On Site","billable_standing_clock":false,"description":null},{"state":"collected","kind":"active","physical_status":"On Site","billable_standing_clock":false,"description":null},{"state":"in_transit","kind":"active","physical_status":"Travelling","billable_standing_clock":false,"description":null},{"state":"at_delivery","kind":"active","physical_status":"On Site","billable_standing_clock":false,"description":null},{"state":"post_move_inspection","kind":"active","physical_status":"On Site","billable_standing_clock":false,"description":null},{"state":"delivered","kind":"active","physical_status":"On Site","billable_standing_clock":false,"description":null},{"state":"handover_signed","kind":"active","physical_status":"On Site","billable_standing_clock":false,"description":null},{"state":"evidence_complete","kind":"active","physical_status":"On Site","billable_standing_clock":false,"description":null},{"state":"invoice_ready","kind":"active","physical_status":"Completed","billable_standing_clock":false,"description":null},{"state":"invoiced","kind":"active","physical_status":"Completed","billable_standing_clock":false,"description":null},{"state":"closed","kind":"terminal","physical_status":"Completed","billable_standing_clock":false,"description":null},{"state":"cancelled","kind":"terminal","physical_status":"Cancelled","billable_standing_clock":false,"description":null},{"state":"no_show","kind":"active","physical_status":"Cancelled","billable_standing_clock":false,"description":null}],"transitions":[{"code":"log","from":"draft","to":"logged","guards":[],"spawns_linked_job":false,"requires_reason":false},{"code":"schedule_collection","from":"logged","to":"collection_scheduled","guards":[],"spawns_linked_job":false,"requires_reason":false},{"code":"assign","from":"collection_scheduled","to":"assigned","guards":[],"spawns_linked_job":false,"requires_reason":false},{"code":"unassign","from":"assigned","to":"collection_scheduled","guards":[],"spawns_linked_job":false,"requires_reason":true},{"code":"accept","from":"assigned","to":"accepted","guards":[],"spawns_linked_job":false,"requires_reason":false},{"code":"depart_for_collection","from":"accepted","to":"en_route_collection","guards":[],"spawns_linked_job":false,"requires_reason":false},{"code":"arrive_collection","from":"en_route_collection","to":"at_collection","guards":[],"spawns_linked_job":false,"requires_reason":false},{"code":"record_no_show","from":"en_route_collection","to":"no_show","guards":[],"spawns_linked_job":false,"requires_reason":true},{"code":"begin_pre_move_inspection","from":"at_collection","to":"pre_move_inspection","guards":[],"spawns_linked_job":false,"requires_reason":false},{"code":"collect_vehicle","from":"pre_move_inspection","to":"collected","guards":[],"spawns_linked_job":false,"requires_reason":false},{"code":"begin_transit","from":"collected","to":"in_transit","guards":[],"spawns_linked_job":false,"requires_reason":false},{"code":"arrive_delivery","from":"in_transit","to":"at_delivery","guards":[],"spawns_linked_job":false,"requires_reason":false},{"code":"begin_post_move_inspection","from":"at_delivery","to":"post_move_inspection","guards":[],"spawns_linked_job":false,"requires_reason":false},{"code":"deliver_vehicle","from":"post_move_inspection","to":"delivered","guards":[],"spawns_linked_job":false,"requires_reason":false},{"code":"sign_handover","from":"delivered","to":"handover_signed","guards":[],"spawns_linked_job":false,"requires_reason":false},{"code":"verify_evidence","from":"handover_signed","to":"evidence_complete","guards":[],"spawns_linked_job":false,"requires_reason":false},{"code":"ready_to_invoice","from":"evidence_complete","to":"invoice_ready","guards":["evidence_complete"],"spawns_linked_job":false,"requires_reason":false},{"code":"issue_invoice","from":"invoice_ready","to":"invoiced","guards":[],"spawns_linked_job":false,"requires_reason":false},{"code":"close","from":"invoiced","to":"closed","guards":[],"spawns_linked_job":false,"requires_reason":false},{"code":"close_no_show","from":"no_show","to":"cancelled","guards":[],"spawns_linked_job":false,"requires_reason":true},{"code":"cancel","from":"*","to":"cancelled","guards":[],"spawns_linked_job":false,"requires_reason":true}]}$rr_wf$::jsonb),
    ('storage', 1, $rr_wf${"workflow_key":"storage","version":1,"initial_state":"storage_pending","states":[{"state":"storage_pending","kind":"active","physical_status":"Pending","billable_standing_clock":false,"description":null},{"state":"checked_in","kind":"active","physical_status":"On Site","billable_standing_clock":false,"description":null},{"state":"stored","kind":"active","physical_status":"On Site","billable_standing_clock":false,"description":"Daily storage accrual runs here."},{"state":"release_requested","kind":"active","physical_status":"On Site","billable_standing_clock":false,"description":null},{"state":"release_authorisation_pending","kind":"active","physical_status":"On Site","billable_standing_clock":false,"description":null},{"state":"release_authorised","kind":"active","physical_status":"On Site","billable_standing_clock":false,"description":null},{"state":"checked_out","kind":"active","physical_status":"On Site","billable_standing_clock":false,"description":null},{"state":"released","kind":"terminal","physical_status":"Completed","billable_standing_clock":false,"description":null},{"state":"unclaimed","kind":"active","physical_status":"On Site","billable_standing_clock":false,"description":null},{"state":"disposal_notice_issued","kind":"active","physical_status":"On Site","billable_standing_clock":false,"description":null},{"state":"disposal_authorised","kind":"active","physical_status":"On Site","billable_standing_clock":false,"description":null},{"state":"disposed","kind":"terminal","physical_status":"Completed","billable_standing_clock":false,"description":null},{"state":"cancelled","kind":"terminal","physical_status":"Cancelled","billable_standing_clock":false,"description":null}],"transitions":[{"code":"check_in","from":"storage_pending","to":"checked_in","guards":[],"spawns_linked_job":false,"requires_reason":false},{"code":"begin_storage","from":"checked_in","to":"stored","guards":[],"spawns_linked_job":false,"requires_reason":false},{"code":"request_release","from":"stored","to":"release_requested","guards":[],"spawns_linked_job":false,"requires_reason":false},{"code":"request_release_authorisation","from":"release_requested","to":"release_authorisation_pending","guards":[],"spawns_linked_job":false,"requires_reason":false},{"code":"authorise_release","from":"release_authorisation_pending","to":"release_authorised","guards":["release_authorised"],"spawns_linked_job":false,"requires_reason":false},{"code":"check_out","from":"release_authorised","to":"checked_out","guards":[],"spawns_linked_job":false,"requires_reason":false},{"code":"release","from":"checked_out","to":"released","guards":["evidence_complete"],"spawns_linked_job":false,"requires_reason":false},{"code":"mark_unclaimed","from":"stored","to":"unclaimed","guards":[],"spawns_linked_job":false,"requires_reason":true},{"code":"issue_disposal_notice","from":"unclaimed","to":"disposal_notice_issued","guards":[],"spawns_linked_job":false,"requires_reason":false},{"code":"authorise_disposal","from":"disposal_notice_issued","to":"disposal_authorised","guards":["disposal_authorised"],"spawns_linked_job":false,"requires_reason":false},{"code":"dispose","from":"disposal_authorised","to":"disposed","guards":[],"spawns_linked_job":false,"requires_reason":true},{"code":"cancel","from":"*","to":"cancelled","guards":[],"spawns_linked_job":false,"requires_reason":true}]}$rr_wf$::jsonb)
-- <<< GENERATED: WORKFLOW DEFINITIONS <<<
  ) AS seed(workflow_key, version, definition)
  WHERE NOT EXISTS (
    SELECT 1
    FROM public.rr_workflow_definitions existing
    WHERE existing.company_id = p_company_id
      AND existing.workflow_key = seed.workflow_key
      AND existing.version = seed.version
  );

  INSERT INTO public.rr_service_types (
    company_id,
    service_code,
    name,
    description,
    workflow_key,
    billing_basis,
    kpi_set_key,
    requires_authorisation,
    requires_destination,
    requires_custody,
    requires_storage,
    can_spawn_recovery_job,
    bills_standing_time,
    sort_order
  )
  SELECT
    p_company_id,
    seed.service_code,
    seed.name,
    seed.description,
    seed.workflow_key,
    seed.billing_basis,
    seed.kpi_set_key,
    seed.requires_authorisation,
    seed.requires_destination,
    seed.requires_custody,
    seed.requires_storage,
    seed.can_spawn_recovery_job,
    seed.bills_standing_time,
    seed.sort_order
  FROM (
    VALUES
-- >>> GENERATED: SERVICE CATALOGUE (see header) >>>
    ('accident_recovery', 'Accident Recovery', 'Recovery of an accident-damaged vehicle from a scene, including insurer evidence and chain of custody.', 'tow_recovery', 'callout_plus_distance', 'recovery', true, true, true, true, false, false, 10),
    ('tow_in', 'Tow-In', 'Planned or breakdown tow of a vehicle to a nominated destination such as a dealership or repairer.', 'tow_recovery', 'callout_plus_distance', 'recovery', true, true, true, true, false, false, 20),
    ('jump_start', 'Jump Start', 'Roadside battery assistance resolved on scene. No custody is taken and no destination applies.', 'roadside_assist', 'callout_only', 'roadside', false, false, false, false, true, false, 30),
    ('roadside_assistance', 'Roadside Assistance', 'General roadside attendance (tyre, fuel, lockout, minor mechanical) resolved on scene where possible.', 'roadside_assist', 'callout_only', 'roadside', false, false, false, false, true, false, 40),
    ('bystand', 'BYSTAND', 'Attend and remain on scene under instruction. Billed on standing time. Takes no custody and has no destination. Any recovery that follows is a separate linked job.', 'bystand', 'per_hour_standing', 'bystand', true, false, false, false, true, true, 50),
    ('heavy_recovery', 'Heavy Recovery', 'Commercial vehicle and specialised recovery requiring a recovery plan, rigging and scene clearance.', 'heavy_recovery', 'callout_plus_recovery_hours', 'heavy_recovery', true, true, true, true, false, false, 60),
    ('vehicle_movement', 'Vehicle Movement', 'Non-incident movement of a vehicle between sites, with pre-move and post-move condition inspections.', 'vehicle_movement', 'per_km', 'movement', false, true, true, false, false, false, 70),
    ('storage', 'Storage', 'Custodial storage of a vehicle in a yard, accruing daily and released only on authorisation.', 'storage', 'per_day_storage', 'storage', true, false, true, true, false, false, 80)
-- <<< GENERATED: SERVICE CATALOGUE <<<
  ) AS seed(
    service_code,
    name,
    description,
    workflow_key,
    billing_basis,
    kpi_set_key,
    requires_authorisation,
    requires_destination,
    requires_custody,
    requires_storage,
    can_spawn_recovery_job,
    bills_standing_time,
    sort_order
  )
  WHERE NOT EXISTS (
    SELECT 1
    FROM public.rr_service_types existing
    WHERE existing.company_id = p_company_id
      AND existing.service_code = seed.service_code
  );
END
$seed$;

COMMENT ON FUNCTION public.rr_seed_service_catalogue(uuid) IS
  'Idempotently seeds the 8 Road & Recovery service types and 6 workflow definitions for one company. Called by sql/070 for companies already holding the road_recovery module, and by module provisioning thereafter.';

-- Not SECURITY DEFINER: it runs with the caller's rights, so the tenant-isolation
-- policies above still apply to everything it inserts. Seeding is an operator/
-- provisioning action, so only the service role may call it — an ordinary customer user
-- cannot re-seed or resurrect service types they have deactivated.
REVOKE ALL ON FUNCTION public.rr_seed_service_catalogue(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rr_seed_service_catalogue(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.rr_seed_service_catalogue(uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.rr_seed_service_catalogue(uuid) TO service_role;

-- ---------------------------------------------------------------------------
-- 7. Apply the seed to companies that already hold the module
-- ---------------------------------------------------------------------------
--
-- On a project where nobody has been granted road_recovery yet this correctly seeds
-- NOTHING. That is the intended outcome: no tenant gains towing service types by
-- accident.
DO $seed_existing$
DECLARE
  target uuid;
  seeded integer := 0;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'companies'
      AND column_name = 'enabled_modules'
  ) THEN
    RAISE NOTICE 'companies.enabled_modules is absent; skipping Road & Recovery catalogue seeding.';
    RETURN;
  END IF;

  -- companies.enabled_modules is jsonb NOT NULL DEFAULT '[]' (sql/062), so a
  -- containment test is both correct and index-friendly.
  FOR target IN
    SELECT c.id
    FROM public.companies c
    WHERE COALESCE(c.enabled_modules, '[]'::jsonb) @> '["road_recovery"]'::jsonb
  LOOP
    PERFORM public.rr_seed_service_catalogue(target);
    seeded := seeded + 1;
  END LOOP;

  RAISE NOTICE 'Road & Recovery catalogue seeded for % company/companies holding the road_recovery module.', seeded;
END
$seed_existing$;

-- ---------------------------------------------------------------------------
-- 8. Module registration (existing module-access architecture)
-- ---------------------------------------------------------------------------
--
-- Registration only. Nothing is enabled for any customer here — a Platform Operator
-- grants the module per company, exactly as with every other module. The matching
-- catalogue entry for the application layer is lib/platform/module-catalog.ts.
DO $modules$
BEGIN
  IF to_regclass('public.platform_modules') IS NOT NULL THEN
    INSERT INTO public.platform_modules (module_code, name, requires_enterprise, requires_ai_credits)
    VALUES ('road_recovery', 'Road & Recovery', true, false)
    ON CONFLICT (module_code) DO NOTHING;
  ELSE
    RAISE NOTICE 'public.platform_modules is absent (sql/063); skipping Road & Recovery module registration.';
  END IF;
END
$modules$;

-- The towing_recovery solution template already exists (seeded by sql/062) and already
-- selects route_intelligence, vehicle_intelligence and mobile_workforce. Add the
-- vertical's own module code to it so provisioning a towing customer enables Road &
-- Recovery too. Idempotent: the code is appended only if it is not already present.
DO $template$
BEGIN
  IF to_regclass('public.solution_templates') IS NULL THEN
    RAISE NOTICE 'public.solution_templates is absent (sql/062); skipping towing_recovery template update.';
    RETURN;
  END IF;

  UPDATE public.solution_templates
  SET default_modules = COALESCE(default_modules, '[]'::jsonb) || '["road_recovery"]'::jsonb
  WHERE code = 'towing_recovery'
    AND NOT (COALESCE(default_modules, '[]'::jsonb) @> '["road_recovery"]'::jsonb);
END
$template$;

COMMIT;

NOTIFY pgrst, 'reload schema';

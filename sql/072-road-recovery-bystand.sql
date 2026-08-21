-- 072-road-recovery-bystand.sql
-- VYRON CORE — Road & Recovery vertical, Phase 2 (BYSTAND Operations).
--
-- ===========================================================================
-- WHAT THIS ADDS
-- ===========================================================================
--
--   public.rr_bystand_reason_codes   configurable attendance reasons (seeded, extensible)
--   public.rr_bystand_details        1:1 BYSTAND facts on a service job
--   public.rr_standby_summary        SEALED, append-only billable standing result
--
--   BYSTAND workflow VERSION 2 seeded into public.rr_workflow_definitions
--   Storage bucket `rr-evidence` with tenant-aware policies
--   Additive columns on public.mobile_workforce_evidence + widened evidence_type
--
-- ===========================================================================
-- WHAT THIS REUSES RATHER THAN REBUILDS
-- ===========================================================================
--
--   public.rr_service_jobs         the spine. BYSTAND is a service ON it, not beside it.
--   public.rr_service_state_events the TIMER SOURCE. Phase 0 already stamps
--                                  enters/leaves_billable_standing_clock on every
--                                  transition, so billable standing time is derived from
--                                  data already being captured. No new event table.
--   public.mobile_workforce_evidence  the ONE evidence system. Extended, not duplicated.
--   public.mobile_gps_validations  GPS-verified arrival, unchanged.
--   public.field_jobs / field_job_events / field_job_assignments  UNCHANGED.
--   public.rr_dispatch_candidates / rr_dispatch_assignments  BYSTAND dispatches through
--                                  the same Phase 1 pipeline as every other service.
--
-- ===========================================================================
-- WORKFLOW VERSIONING
-- ===========================================================================
--
-- BYSTAND v1 (seeded by sql/070) is left completely intact and is merely de-activated.
-- Jobs created under v1 keep running v1 — rr_service_jobs.workflow_version still points
-- at it and the foreign key still resolves. New jobs pick up v2, which adds four
-- transitions so a PAUSED crew (scene under authority control, or a weather hold) can be
-- stood down or converted WITHOUT first resuming billable standing time. Resuming merely
-- to stand down would have overbilled the counterparty.
--
-- ===========================================================================
-- EVIDENCE
-- ===========================================================================
--
-- Files go to Supabase Storage (`rr-evidence`); PostgreSQL stores only bucket, path and
-- metadata. mobile_workforce_evidence previously held base64 data URLs in photo_url,
-- which BYSTAND — an inherently periodic-photography service — would have turned into
-- tens of megabytes per job inside table rows.
--
-- The evidence_type CHECK is WIDENED, never narrowed. Every existing value keeps working.
-- Consumers inspected before this change:
--   lib/client-portal-platform.ts:310  reads (photo_url, evidence_type); filters
--                                      photo_url IS NOT NULL, so GPS-only BYSTAND
--                                      presence rows never reach the client portal
--   lib/mobile-workforce-platform.ts   reads + inserts the original six values
--   components/mobile-workforce/MobileWorkforceHub.tsx  writes four of the six
-- (public.hearing_evidence.evidence_type is a DIFFERENT table and is untouched.)
--
-- Idempotent. Requires sql/070 and sql/071. Run after sql/071.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------------------------------------------------------------------------
-- 0. Prerequisites
-- ---------------------------------------------------------------------------
DO $prereq$
BEGIN
  IF to_regclass('public.rr_service_jobs') IS NULL THEN
    RAISE EXCEPTION 'Prerequisite missing: public.rr_service_jobs. Run sql/070 before sql/072.';
  END IF;
  IF to_regclass('public.rr_dispatch_assignments') IS NULL THEN
    RAISE EXCEPTION 'Prerequisite missing: public.rr_dispatch_assignments. Run sql/071 before sql/072.';
  END IF;
  IF to_regclass('public.mobile_workforce_evidence') IS NULL THEN
    RAISE EXCEPTION 'Prerequisite missing: public.mobile_workforce_evidence. Run sql/031 before sql/072.';
  END IF;
END
$prereq$;

-- ---------------------------------------------------------------------------
-- 1. rr_bystand_reason_codes — configurable, not a hardcoded list
-- ---------------------------------------------------------------------------
--
-- Per company so a tenant can add its own reasons, retire ones it does not use and
-- reorder them, without a migration. Seeded with a sensible starting set.
CREATE TABLE IF NOT EXISTS public.rr_bystand_reason_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies (id) ON DELETE CASCADE,
  reason_code text NOT NULL,
  label text NOT NULL,
  description text,
  /** When true the controller must supply free-text detail alongside the code. */
  requires_detail boolean NOT NULL DEFAULT false,
  /** Marks reasons that typically precede a recovery, for board prioritisation. */
  commonly_converts boolean NOT NULL DEFAULT false,
  sort_order integer NOT NULL DEFAULT 100,
  active boolean NOT NULL DEFAULT true,
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT rr_bystand_reason_codes_unique UNIQUE (company_id, reason_code),
  CONSTRAINT rr_bystand_reason_codes_company_id_id_key UNIQUE (company_id, id),
  CONSTRAINT rr_bystand_reason_codes_code_format CHECK (reason_code ~ '^[a-z0-9_]+$')
);

CREATE INDEX IF NOT EXISTS idx_rr_bystand_reason_codes_company
  ON public.rr_bystand_reason_codes (company_id, active, sort_order);

COMMENT ON TABLE public.rr_bystand_reason_codes IS
  'Configurable BYSTAND attendance reasons. Deliberately data rather than a CHECK constraint: operators add and retire reasons without a migration.';

-- ---------------------------------------------------------------------------
-- 2. rr_bystand_details — 1:1 BYSTAND facts
-- ---------------------------------------------------------------------------
--
-- Kept off rr_service_jobs so a tow never carries null BYSTAND columns, exactly as
-- rr_service_jobs itself is kept off field_jobs.
CREATE TABLE IF NOT EXISTS public.rr_bystand_details (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies (id) ON DELETE CASCADE,
  service_job_id uuid NOT NULL,

  reason_code_id uuid,
  reason_detail text,

  requested_by_name text,
  requested_by_contact text,
  requesting_authority text,

  /** Who is controlling the scene, when it is not the operator. */
  authority_on_scene text,
  authority_reference text,

  -- Stand-down, recorded when the controller releases the crew.
  stand_down_requested_by text,
  stand_down_channel text,
  stand_down_reason text,

  -- Observation report, submitted by the driver at the end of the attendance.
  report_summary text,
  report_observations jsonb NOT NULL DEFAULT '{}'::jsonb,
  report_submitted_at timestamptz,
  report_submitted_by text,

  /** Set when this attendance produced a separate linked recovery job. */
  converted_service_job_id uuid,
  converted_at timestamptz,
  conversion_reason text,

  created_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT rr_bystand_details_service_job_unique UNIQUE (service_job_id),
  CONSTRAINT rr_bystand_details_company_id_id_key UNIQUE (company_id, id),

  CONSTRAINT rr_bystand_details_service_job_fk
    FOREIGN KEY (company_id, service_job_id)
    REFERENCES public.rr_service_jobs (company_id, id)
    ON DELETE CASCADE,
  CONSTRAINT rr_bystand_details_reason_fk
    FOREIGN KEY (company_id, reason_code_id)
    REFERENCES public.rr_bystand_reason_codes (company_id, id)
    ON DELETE RESTRICT,
  -- The spawned recovery job is a SEPARATE job in the same company.
  CONSTRAINT rr_bystand_details_converted_fk
    FOREIGN KEY (company_id, converted_service_job_id)
    REFERENCES public.rr_service_jobs (company_id, id)
    ON DELETE SET NULL,
  CONSTRAINT rr_bystand_details_not_self CHECK (
    converted_service_job_id IS NULL OR converted_service_job_id <> service_job_id
  ),
  CONSTRAINT rr_bystand_details_conversion_recorded CHECK (
    converted_service_job_id IS NULL OR (converted_at IS NOT NULL AND conversion_reason IS NOT NULL)
  ),
  CONSTRAINT rr_bystand_details_stand_down_channel_check CHECK (
    stand_down_channel IS NULL
    OR stand_down_channel IN ('phone', 'radio', 'whatsapp', 'email', 'in_person', 'system')
  )
);

CREATE INDEX IF NOT EXISTS idx_rr_bystand_details_company
  ON public.rr_bystand_details (company_id, service_job_id);

CREATE INDEX IF NOT EXISTS idx_rr_bystand_details_converted
  ON public.rr_bystand_details (company_id, converted_service_job_id)
  WHERE converted_service_job_id IS NOT NULL;

COMMENT ON COLUMN public.rr_bystand_details.converted_service_job_id IS
  'The SEPARATE recovery job this attendance spawned. The BYSTAND job keeps its own service type, standing billing and evidence, and never becomes a tow.';

-- ---------------------------------------------------------------------------
-- 3. rr_standby_summary — the SEALED billable result (append-only)
-- ---------------------------------------------------------------------------
--
-- Billable standing time is DERIVED from rr_service_state_events, which is append-only
-- and authoritative. At stand-down the derived figure is sealed here so billing reads a
-- frozen fact rather than a recomputation that could drift when the calculator changes.
--
-- Append-only, enforced by grants AND a trigger (the trigger also binds the service
-- role, which grants alone would not) — the same standard as rr_service_state_events.
CREATE TABLE IF NOT EXISTS public.rr_standby_summary (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies (id) ON DELETE CASCADE,
  service_job_id uuid NOT NULL,

  /** Why this seal was written: stand_down, conversion, or close. */
  sealed_reason text NOT NULL DEFAULT 'stand_down',
  sealed_at timestamptz NOT NULL DEFAULT now(),
  sealed_by text,

  total_billable_seconds integer NOT NULL,
  total_paused_seconds integer NOT NULL,
  standing_interval_count integer NOT NULL DEFAULT 0,
  paused_interval_count integer NOT NULL DEFAULT 0,

  first_standing_at timestamptz,
  last_standing_ended_at timestamptz,

  /** Full interval breakdown, so the number can be defended line by line. */
  interval_breakdown jsonb NOT NULL DEFAULT '[]'::jsonb,
  paused_breakdown jsonb NOT NULL DEFAULT '[]'::jsonb,
  /** Anything odd the calculator noticed (out-of-order events, unclosed intervals). */
  anomalies jsonb NOT NULL DEFAULT '[]'::jsonb,

  -- SLA-lite operational measurements. NOT an SLA engine: no targets, no breach rules.
  time_to_scene_seconds integer,
  stand_down_response_seconds integer,

  calculator_version text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT rr_standby_summary_company_id_id_key UNIQUE (company_id, id),
  CONSTRAINT rr_standby_summary_service_job_fk
    FOREIGN KEY (company_id, service_job_id)
    REFERENCES public.rr_service_jobs (company_id, id)
    ON DELETE CASCADE,

  CONSTRAINT rr_standby_summary_reason_check CHECK (
    sealed_reason IN ('stand_down', 'conversion', 'close', 'cancellation')
  ),
  CONSTRAINT rr_standby_summary_billable_check CHECK (total_billable_seconds >= 0),
  CONSTRAINT rr_standby_summary_paused_check CHECK (total_paused_seconds >= 0),
  CONSTRAINT rr_standby_summary_time_to_scene_check CHECK (
    time_to_scene_seconds IS NULL OR time_to_scene_seconds >= 0
  ),
  CONSTRAINT rr_standby_summary_stand_down_check CHECK (
    stand_down_response_seconds IS NULL OR stand_down_response_seconds >= 0
  ),
  CONSTRAINT rr_standby_summary_breakdown_check CHECK (
    jsonb_typeof(interval_breakdown) = 'array' AND jsonb_typeof(paused_breakdown) = 'array'
  )
);

CREATE INDEX IF NOT EXISTS idx_rr_standby_summary_job
  ON public.rr_standby_summary (company_id, service_job_id, sealed_at DESC);

COMMENT ON TABLE public.rr_standby_summary IS
  'Sealed, append-only BYSTAND billable standing result, derived from public.rr_service_state_events. Billing reads this frozen fact; a re-seal writes a new row rather than editing history.';

CREATE OR REPLACE FUNCTION public.rr_standby_summary_forbid_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $forbid$
BEGIN
  RAISE EXCEPTION
    'public.rr_standby_summary is append-only: % is not permitted. Seal a new summary instead.',
    TG_OP;
END
$forbid$;

DROP TRIGGER IF EXISTS rr_standby_summary_append_only ON public.rr_standby_summary;

CREATE TRIGGER rr_standby_summary_append_only
  BEFORE UPDATE OR DELETE ON public.rr_standby_summary
  FOR EACH ROW
  EXECUTE FUNCTION public.rr_standby_summary_forbid_mutation();

-- ---------------------------------------------------------------------------
-- 4. mobile_workforce_evidence — extended, NOT duplicated
-- ---------------------------------------------------------------------------
--
-- Additive only. Every existing column, value and consumer keeps working.
ALTER TABLE public.mobile_workforce_evidence
  ADD COLUMN IF NOT EXISTS storage_bucket text;

ALTER TABLE public.mobile_workforce_evidence
  ADD COLUMN IF NOT EXISTS storage_path text;

ALTER TABLE public.mobile_workforce_evidence
  ADD COLUMN IF NOT EXISTS service_job_id uuid;

ALTER TABLE public.mobile_workforce_evidence
  ADD COLUMN IF NOT EXISTS captured_by_role text;

ALTER TABLE public.mobile_workforce_evidence
  ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.mobile_workforce_evidence.storage_path IS
  'Path inside storage_bucket. New Road & Recovery evidence stores files in Supabase Storage and only the path here; photo_url remains for existing mobile flows.';

-- Widen (never narrow) the evidence type list with explicit BYSTAND types, so
-- operationally meaningful evidence is not buried under the generic 'other'.
DO $evidence_types$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'mobile_workforce_evidence_type_check'
  ) THEN
    ALTER TABLE public.mobile_workforce_evidence
      DROP CONSTRAINT mobile_workforce_evidence_type_check;
  END IF;

  ALTER TABLE public.mobile_workforce_evidence
    ADD CONSTRAINT mobile_workforce_evidence_type_check CHECK (
      evidence_type IN (
        -- Original six. Unchanged, still valid.
        'clock_in', 'clock_out', 'arrive_site', 'complete_job', 'incident', 'other',
        -- Road & Recovery BYSTAND (sql/072).
        'bystand_scene',            -- scene photograph on arrival / during attendance
        'bystand_periodic',         -- periodic presence: GPS, optionally with a photo
        'bystand_stand_down',       -- condition of the scene at stand-down
        'bystand_report_attachment' -- attachment supporting the observation report
      )
    );
END
$evidence_types$;

-- A BYSTAND evidence row belongs to a Road & Recovery job in the SAME company.
DO $evidence_fk$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'mobile_workforce_evidence_service_job_fk'
  ) THEN
    ALTER TABLE public.mobile_workforce_evidence
      ADD CONSTRAINT mobile_workforce_evidence_service_job_fk
      FOREIGN KEY (company_id, service_job_id)
      REFERENCES public.rr_service_jobs (company_id, id)
      ON DELETE CASCADE;
  END IF;
END
$evidence_fk$;

CREATE INDEX IF NOT EXISTS idx_mobile_evidence_service_job
  ON public.mobile_workforce_evidence (company_id, service_job_id, captured_at DESC)
  WHERE service_job_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 5. BYSTAND workflow VERSION 2
-- ---------------------------------------------------------------------------
--
-- v1 rows are DE-ACTIVATED, never deleted or edited: jobs already running v1 continue to
-- resolve their foreign key and to run the graph they started on.
CREATE OR REPLACE FUNCTION public.rr_publish_bystand_workflow_v2(p_company_id uuid)
RETURNS void
LANGUAGE plpgsql
AS $publish$
DECLARE
  v2_definition jsonb := $rr_wf2${"workflow_key":"bystand","version":2,"initial_state":"draft","states":[{"state":"draft","kind":"active","physical_status":"Pending","billable_standing_clock":false,"description":null},{"state":"logged","kind":"active","physical_status":"Pending","billable_standing_clock":false,"description":null},{"state":"bystand_requested","kind":"active","physical_status":"Pending","billable_standing_clock":false,"description":"A bystand attendance specifically has been requested."},{"state":"authorisation_pending","kind":"active","physical_status":"Pending","billable_standing_clock":false,"description":null},{"state":"authorised","kind":"active","physical_status":"Pending","billable_standing_clock":false,"description":null},{"state":"assigned","kind":"active","physical_status":"Dispatched","billable_standing_clock":false,"description":null},{"state":"accepted","kind":"active","physical_status":"Dispatched","billable_standing_clock":false,"description":null},{"state":"en_route","kind":"active","physical_status":"Travelling","billable_standing_clock":false,"description":null},{"state":"arrived_on_scene","kind":"active","physical_status":"On Site","billable_standing_clock":false,"description":null},{"state":"standing_by","kind":"active","physical_status":"On Site","billable_standing_clock":true,"description":"Billable standing time accrues here and nowhere else."},{"state":"scene_handover_to_authority","kind":"paused","physical_status":"On Site","billable_standing_clock":false,"description":"Scene under authority control; standing clock paused."},{"state":"weather_hold","kind":"paused","physical_status":"On Site","billable_standing_clock":false,"description":null},{"state":"converted_to_recovery","kind":"active","physical_status":"On Site","billable_standing_clock":false,"description":"A SEPARATE linked recovery job has been raised. This bystand job bills its own standing time and closes on its own terms."},{"state":"stand_down_requested","kind":"active","physical_status":"On Site","billable_standing_clock":false,"description":null},{"state":"stood_down","kind":"active","physical_status":"On Site","billable_standing_clock":false,"description":null},{"state":"departed_scene","kind":"active","physical_status":"On Site","billable_standing_clock":false,"description":null},{"state":"report_submitted","kind":"active","physical_status":"On Site","billable_standing_clock":false,"description":null},{"state":"evidence_complete","kind":"active","physical_status":"On Site","billable_standing_clock":false,"description":null},{"state":"invoice_ready","kind":"active","physical_status":"Completed","billable_standing_clock":false,"description":null},{"state":"invoiced","kind":"active","physical_status":"Completed","billable_standing_clock":false,"description":null},{"state":"closed","kind":"terminal","physical_status":"Completed","billable_standing_clock":false,"description":null},{"state":"cancelled","kind":"terminal","physical_status":"Cancelled","billable_standing_clock":false,"description":null},{"state":"declined","kind":"active","physical_status":"Cancelled","billable_standing_clock":false,"description":null},{"state":"no_show","kind":"active","physical_status":"Cancelled","billable_standing_clock":false,"description":null}],"transitions":[{"code":"log","from":"draft","to":"logged","guards":[],"spawns_linked_job":false,"requires_reason":false},{"code":"request_bystand","from":"logged","to":"bystand_requested","guards":[],"spawns_linked_job":false,"requires_reason":false},{"code":"request_authorisation","from":"bystand_requested","to":"authorisation_pending","guards":[],"spawns_linked_job":false,"requires_reason":false},{"code":"authorise","from":"authorisation_pending","to":"authorised","guards":[],"spawns_linked_job":false,"requires_reason":false},{"code":"decline","from":"authorisation_pending","to":"declined","guards":[],"spawns_linked_job":false,"requires_reason":true},{"code":"assign","from":"authorised","to":"assigned","guards":["authorisation_valid"],"spawns_linked_job":false,"requires_reason":false},{"code":"unassign","from":"assigned","to":"authorised","guards":[],"spawns_linked_job":false,"requires_reason":true},{"code":"accept","from":"assigned","to":"accepted","guards":[],"spawns_linked_job":false,"requires_reason":false},{"code":"depart","from":"accepted","to":"en_route","guards":[],"spawns_linked_job":false,"requires_reason":false},{"code":"arrive_scene","from":"en_route","to":"arrived_on_scene","guards":[],"spawns_linked_job":false,"requires_reason":false},{"code":"record_no_show","from":"en_route","to":"no_show","guards":[],"spawns_linked_job":false,"requires_reason":true},{"code":"begin_standing_by","from":"arrived_on_scene","to":"standing_by","guards":[],"spawns_linked_job":false,"requires_reason":false},{"code":"hand_scene_to_authority","from":"standing_by","to":"scene_handover_to_authority","guards":[],"spawns_linked_job":false,"requires_reason":true},{"code":"resume_from_authority","from":"scene_handover_to_authority","to":"standing_by","guards":[],"spawns_linked_job":false,"requires_reason":false},{"code":"weather_hold","from":"standing_by","to":"weather_hold","guards":[],"spawns_linked_job":false,"requires_reason":true},{"code":"resume_from_weather","from":"weather_hold","to":"standing_by","guards":[],"spawns_linked_job":false,"requires_reason":false},{"code":"convert_to_recovery","from":"standing_by","to":"converted_to_recovery","guards":[],"spawns_linked_job":true,"requires_reason":true},{"code":"request_stand_down","from":"standing_by","to":"stand_down_requested","guards":[],"spawns_linked_job":false,"requires_reason":false},{"code":"request_stand_down_after_conversion","from":"converted_to_recovery","to":"stand_down_requested","guards":[],"spawns_linked_job":false,"requires_reason":false},{"code":"stand_down","from":"stand_down_requested","to":"stood_down","guards":[],"spawns_linked_job":false,"requires_reason":false},{"code":"depart_scene","from":"stood_down","to":"departed_scene","guards":[],"spawns_linked_job":false,"requires_reason":false},{"code":"submit_report","from":"departed_scene","to":"report_submitted","guards":[],"spawns_linked_job":false,"requires_reason":false},{"code":"verify_evidence","from":"report_submitted","to":"evidence_complete","guards":[],"spawns_linked_job":false,"requires_reason":false},{"code":"ready_to_invoice","from":"evidence_complete","to":"invoice_ready","guards":["evidence_complete"],"spawns_linked_job":false,"requires_reason":false},{"code":"issue_invoice","from":"invoice_ready","to":"invoiced","guards":[],"spawns_linked_job":false,"requires_reason":false},{"code":"close","from":"invoiced","to":"closed","guards":[],"spawns_linked_job":false,"requires_reason":false},{"code":"cancel_after_decline","from":"declined","to":"cancelled","guards":[],"spawns_linked_job":false,"requires_reason":true},{"code":"close_no_show","from":"no_show","to":"cancelled","guards":[],"spawns_linked_job":false,"requires_reason":true},{"code":"cancel","from":"*","to":"cancelled","guards":[],"spawns_linked_job":false,"requires_reason":true},{"code":"request_stand_down_from_authority_hold","from":"scene_handover_to_authority","to":"stand_down_requested","guards":[],"spawns_linked_job":false,"requires_reason":false},{"code":"request_stand_down_from_weather_hold","from":"weather_hold","to":"stand_down_requested","guards":[],"spawns_linked_job":false,"requires_reason":false},{"code":"convert_to_recovery_from_authority_hold","from":"scene_handover_to_authority","to":"converted_to_recovery","guards":[],"spawns_linked_job":true,"requires_reason":true},{"code":"convert_to_recovery_from_weather_hold","from":"weather_hold","to":"converted_to_recovery","guards":[],"spawns_linked_job":true,"requires_reason":true}]}$rr_wf2$::jsonb;
BEGIN
  IF p_company_id IS NULL THEN
    RAISE EXCEPTION 'rr_publish_bystand_workflow_v2: p_company_id is required.';
  END IF;

  -- Nothing to do if this company has no BYSTAND workflow at all.
  IF NOT EXISTS (
    SELECT 1 FROM public.rr_workflow_definitions
    WHERE company_id = p_company_id AND workflow_key = 'bystand'
  ) THEN
    RETURN;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.rr_workflow_definitions
    WHERE company_id = p_company_id AND workflow_key = 'bystand' AND version = 2
  ) THEN
    RETURN;
  END IF;

  -- De-activate v1 first: exactly one active version per workflow is enforced by a
  -- partial unique index. v1 itself is NOT modified beyond the active flag.
  UPDATE public.rr_workflow_definitions
     SET active = false
   WHERE company_id = p_company_id AND workflow_key = 'bystand' AND active;

  INSERT INTO public.rr_workflow_definitions
    (company_id, workflow_key, version, active, definition, created_by)
  VALUES (p_company_id, 'bystand', 2, true, v2_definition, 'sql/072');
END
$publish$;

COMMENT ON FUNCTION public.rr_publish_bystand_workflow_v2(uuid) IS
  'Publishes BYSTAND workflow v2 for one company and de-activates v1. v1 is retained so jobs created under it keep running it.';

REVOKE ALL ON FUNCTION public.rr_publish_bystand_workflow_v2(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rr_publish_bystand_workflow_v2(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.rr_publish_bystand_workflow_v2(uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.rr_publish_bystand_workflow_v2(uuid) TO service_role;

-- ---------------------------------------------------------------------------
-- 6. Seed reason codes + publish v2 for companies holding the module
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rr_seed_bystand_reasons(p_company_id uuid)
RETURNS void
LANGUAGE plpgsql
AS $seed$
BEGIN
  IF p_company_id IS NULL THEN
    RAISE EXCEPTION 'rr_seed_bystand_reasons: p_company_id is required.';
  END IF;

  INSERT INTO public.rr_bystand_reason_codes
    (company_id, reason_code, label, description, requires_detail, commonly_converts, sort_order, created_by)
  SELECT p_company_id, seed.reason_code, seed.label, seed.description,
         seed.requires_detail, seed.commonly_converts, seed.sort_order, 'sql/072'
  FROM (
    VALUES
      ('customer_safety', 'Customer safety', 'Remaining on scene to keep the customer safe.', false, false, 10),
      ('accident_scene', 'Accident scene', 'Attending and securing an accident scene.', false, true, 20),
      ('waiting_for_recovery', 'Waiting for recovery', 'Holding the scene until a recovery unit arrives.', false, true, 30),
      ('waiting_for_police', 'Waiting for police', 'Scene cannot be released until police attend.', false, true, 40),
      ('waiting_for_medical', 'Waiting for medical assistance', 'Holding the scene pending medical response.', false, true, 50),
      ('vulnerable_person', 'Vulnerable person', 'Remaining with a vulnerable person until support arrives.', false, false, 60),
      ('security_concern', 'Security concern', 'Standing by because of a security risk at the location.', true, false, 70),
      ('other', 'Other', 'Any other instructed attendance. Detail is required.', true, false, 900)
  ) AS seed(reason_code, label, description, requires_detail, commonly_converts, sort_order)
  WHERE NOT EXISTS (
    SELECT 1 FROM public.rr_bystand_reason_codes existing
    WHERE existing.company_id = p_company_id AND existing.reason_code = seed.reason_code
  );
END
$seed$;

REVOKE ALL ON FUNCTION public.rr_seed_bystand_reasons(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rr_seed_bystand_reasons(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.rr_seed_bystand_reasons(uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.rr_seed_bystand_reasons(uuid) TO service_role;

DO $apply$
DECLARE
  target uuid;
  applied integer := 0;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'companies' AND column_name = 'enabled_modules'
  ) THEN
    RAISE NOTICE 'companies.enabled_modules is absent; skipping BYSTAND seeding.';
    RETURN;
  END IF;

  FOR target IN
    SELECT c.id FROM public.companies c
    WHERE COALESCE(c.enabled_modules, '[]'::jsonb) @> '["road_recovery"]'::jsonb
  LOOP
    PERFORM public.rr_seed_bystand_reasons(target);
    PERFORM public.rr_publish_bystand_workflow_v2(target);
    applied := applied + 1;
  END LOOP;

  RAISE NOTICE 'BYSTAND reasons seeded and workflow v2 published for % company/companies.', applied;
END
$apply$;

-- ---------------------------------------------------------------------------
-- 7. Row level security + tenant isolation
-- ---------------------------------------------------------------------------
ALTER TABLE public.rr_bystand_reason_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rr_bystand_details ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rr_standby_summary ENABLE ROW LEVEL SECURITY;

DO $tenant$
DECLARE
  tbl text;
BEGIN
  IF to_regprocedure('public.vyron_user_company_ids()') IS NULL
     OR to_regprocedure('public.vyron_is_platform_operator()') IS NULL THEN
    RAISE NOTICE
      'Tenant helper functions missing (sql/030). Phase 2 tables have RLS enabled with NO policy, which denies all access until sql/030 and then sql/072 are run.';
    RETURN;
  END IF;

  FOR tbl IN
    SELECT unnest(ARRAY[
      'rr_bystand_reason_codes',
      'rr_bystand_details',
      'rr_standby_summary'
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

REVOKE ALL ON public.rr_bystand_reason_codes FROM anon;
REVOKE ALL ON public.rr_bystand_details FROM anon;
REVOKE ALL ON public.rr_standby_summary FROM anon;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.rr_bystand_reason_codes TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.rr_bystand_details TO authenticated;

-- Sealed billing facts: append-only. See the trigger above.
GRANT SELECT, INSERT ON public.rr_standby_summary TO authenticated;
REVOKE UPDATE, DELETE, TRUNCATE ON public.rr_standby_summary FROM authenticated;

-- ---------------------------------------------------------------------------
-- 8. Storage bucket `rr-evidence` with tenant-aware policies
-- ---------------------------------------------------------------------------
--
-- Object paths are <company_id>/<service_job_id>/<file>, so the first path segment IS
-- the tenant key and the policy can compare it against the caller's own companies.
DO $storage$
BEGIN
  IF to_regclass('storage.buckets') IS NULL THEN
    RAISE NOTICE 'storage.buckets is absent (not a Supabase project); skipping the rr-evidence bucket.';
    RETURN;
  END IF;

  INSERT INTO storage.buckets (id, name, public)
  VALUES ('rr-evidence', 'rr-evidence', false)
  ON CONFLICT (id) DO UPDATE SET public = false;

  IF to_regprocedure('public.vyron_user_company_ids()') IS NULL THEN
    RAISE NOTICE 'Tenant helpers missing; rr-evidence bucket created WITHOUT policies (deny-all).';
    RETURN;
  END IF;

  EXECUTE 'DROP POLICY IF EXISTS rr_evidence_tenant_select ON storage.objects';
  EXECUTE 'DROP POLICY IF EXISTS rr_evidence_tenant_insert ON storage.objects';
  EXECUTE 'DROP POLICY IF EXISTS rr_evidence_tenant_update ON storage.objects';
  EXECUTE 'DROP POLICY IF EXISTS rr_evidence_tenant_delete ON storage.objects';

  EXECUTE $pol$
    CREATE POLICY rr_evidence_tenant_select ON storage.objects
    FOR SELECT TO authenticated
    USING (
      bucket_id = 'rr-evidence'
      AND (
        public.vyron_is_platform_operator()
        OR EXISTS (
          SELECT 1 FROM public.vyron_user_company_ids() AS c(company_id)
          WHERE c.company_id::text = split_part(storage.objects.name, '/', 1)
        )
      )
    )
  $pol$;

  EXECUTE $pol$
    CREATE POLICY rr_evidence_tenant_insert ON storage.objects
    FOR INSERT TO authenticated
    WITH CHECK (
      bucket_id = 'rr-evidence'
      AND EXISTS (
        SELECT 1 FROM public.vyron_user_company_ids() AS c(company_id)
        WHERE c.company_id::text = split_part(storage.objects.name, '/', 1)
      )
    )
  $pol$;

  -- Evidence is not editable or removable by ordinary users; it is evidence.
  EXECUTE $pol$
    CREATE POLICY rr_evidence_tenant_update ON storage.objects
    FOR UPDATE TO authenticated
    USING (bucket_id = 'rr-evidence' AND public.vyron_is_platform_operator())
    WITH CHECK (bucket_id = 'rr-evidence' AND public.vyron_is_platform_operator())
  $pol$;

  EXECUTE $pol$
    CREATE POLICY rr_evidence_tenant_delete ON storage.objects
    FOR DELETE TO authenticated
    USING (bucket_id = 'rr-evidence' AND public.vyron_is_platform_operator())
  $pol$;
END
$storage$;

COMMIT;

NOTIFY pgrst, 'reload schema';

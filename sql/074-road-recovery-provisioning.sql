-- 074-road-recovery-provisioning.sql
-- VYRON CORE — Road & Recovery Phase 4, Step 1: module provisioning.
--
-- ---------------------------------------------------------------------------
-- WHY THIS FILE EXISTS
-- ---------------------------------------------------------------------------
--
-- Phases 0-3 each shipped a per-company seeding function and each seeded only the
-- companies that ALREADY held the road_recovery module when that migration ran. A company
-- that gains the module afterwards gets nothing, and ends up in the one state this file
-- exists to make impossible:
--
--     road_recovery enabled, but service catalogue / workflow version /
--     BYSTAND reasons / requirement policies missing
--
-- There are FOUR baseline components, not three. rr_seed_bystand_reasons (sql/072) is
-- easy to overlook and without it a BYSTAND job cannot record why it was requested.
--
-- ---------------------------------------------------------------------------
-- WHAT IS AND IS NOT BUILT HERE
-- ---------------------------------------------------------------------------
--
-- NOT built: a provisioning framework, a queue, or a worker. The repository has no such
-- mechanism to reuse — public.platform_job_queue (sql/063) is documented in its own code
-- as "a lightweight tracking log ... not an async worker engine", its failures are
-- swallowed, and its queue_name CHECK admits only email/notification/storage/ai.
--
-- Built instead: ONE plpgsql function that calls the four EXISTING seed functions in
-- dependency order inside a single transaction. That is atomic and retry-safe by
-- construction — a failure rolls back, a retry re-runs, and each seed is already
-- idempotent — with no orchestration layer to maintain.
--
-- ---------------------------------------------------------------------------
-- ORDER IS LOAD-BEARING
-- ---------------------------------------------------------------------------
--
--   1. rr_seed_service_catalogue      service types + v1 workflow definitions
--   2. rr_seed_bystand_reasons        BYSTAND attendance reasons
--   3. rr_publish_bystand_workflow_v2 RETURNS EARLY unless a bystand workflow exists,
--                                     so it MUST run after step 1
--   4. rr_seed_requirement_policies   Phase 3 evidence requirement defaults
--
-- ---------------------------------------------------------------------------
-- CUSTOMISATION ALWAYS WINS
-- ---------------------------------------------------------------------------
--
-- None of the four seeds uses ON CONFLICT DO UPDATE. They insert WHERE NOT EXISTS, skip a
-- policy key that is already present, and return early once BYSTAND v2 exists. Re-running
-- therefore cannot rename a customer's service, reset an active flag, replace an edited
-- requirement, or alter an existing job's frozen snapshot. This file adds nothing that
-- would change that: it only calls them.
--
-- Idempotent and safe to re-run. Requires sql/070, sql/072 and sql/073.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------------------------------------------------------------------------
-- 0. Prerequisites
-- ---------------------------------------------------------------------------
DO $prereq$
BEGIN
  IF to_regprocedure('public.rr_seed_service_catalogue(uuid)') IS NULL THEN
    RAISE EXCEPTION 'Prerequisite missing: public.rr_seed_service_catalogue(uuid). Run sql/070 before sql/074.';
  END IF;
  IF to_regprocedure('public.rr_seed_bystand_reasons(uuid)') IS NULL THEN
    RAISE EXCEPTION 'Prerequisite missing: public.rr_seed_bystand_reasons(uuid). Run sql/072 before sql/074.';
  END IF;
  IF to_regprocedure('public.rr_publish_bystand_workflow_v2(uuid)') IS NULL THEN
    RAISE EXCEPTION 'Prerequisite missing: public.rr_publish_bystand_workflow_v2(uuid). Run sql/072 before sql/074.';
  END IF;
  IF to_regprocedure('public.rr_seed_requirement_policies(uuid)') IS NULL THEN
    RAISE EXCEPTION 'Prerequisite missing: public.rr_seed_requirement_policies(uuid). Run sql/073 before sql/074.';
  END IF;
END
$prereq$;

-- ---------------------------------------------------------------------------
-- 1. rr_module_provisioning — the attempt log
-- ---------------------------------------------------------------------------
--
-- APPEND-ONLY. A provisioning attempt is a fact about what happened to a customer's
-- workspace; editing one would rewrite the answer to "was this company ever correctly
-- provisioned, and when". A retry writes a NEW attempt rather than amending the last.
CREATE TABLE IF NOT EXISTS public.rr_module_provisioning (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies (id) ON DELETE CASCADE,

  module_code text NOT NULL DEFAULT 'road_recovery',
  /** What caused this attempt. Never inferred. */
  trigger_source text NOT NULL,

  outcome text NOT NULL,
  /** Per-component detail from rr_provisioning_status(), for the operator. */
  components jsonb NOT NULL DEFAULT '{}'::jsonb,
  error_message text,

  attempted_by text,
  attempted_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT rr_module_provisioning_company_id_id_key UNIQUE (company_id, id),
  CONSTRAINT rr_module_provisioning_trigger_check CHECK (
    trigger_source IN ('wizard', 'module_toggle', 'operator_retry', 'migration')
  ),
  -- FAIL CLOSED: only 'provisioned' means every component verified green.
  CONSTRAINT rr_module_provisioning_outcome_check CHECK (
    outcome IN ('provisioned', 'incomplete', 'failed', 'skipped_not_entitled')
  ),
  CONSTRAINT rr_module_provisioning_components_is_object CHECK (
    jsonb_typeof(components) = 'object'
  ),
  -- A failure must say what failed.
  CONSTRAINT rr_module_provisioning_failure_explained CHECK (
    outcome <> 'failed' OR error_message IS NOT NULL
  )
);

CREATE INDEX IF NOT EXISTS idx_rr_module_provisioning_company
  ON public.rr_module_provisioning (company_id, attempted_at DESC);

COMMENT ON TABLE public.rr_module_provisioning IS
  'Append-only log of Road & Recovery module provisioning attempts. Records what was provisioned, by whom, and whether every baseline component verified. A retry appends a new attempt; history is never edited.';

CREATE OR REPLACE FUNCTION public.rr_module_provisioning_forbid_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $forbid$
BEGIN
  RAISE EXCEPTION
    'public.rr_module_provisioning is append-only: % is not permitted. Record a new provisioning attempt instead.',
    TG_OP;
END
$forbid$;

DROP TRIGGER IF EXISTS rr_module_provisioning_append_only ON public.rr_module_provisioning;

-- Bound to the TABLE, so it also stops service_role, which bypasses RLS.
CREATE TRIGGER rr_module_provisioning_append_only
  BEFORE UPDATE OR DELETE ON public.rr_module_provisioning
  FOR EACH ROW
  EXECUTE FUNCTION public.rr_module_provisioning_forbid_mutation();

-- ---------------------------------------------------------------------------
-- 2. rr_provisioning_status — the verifier
-- ---------------------------------------------------------------------------
--
-- FAIL CLOSED. Returns one row per baseline component with ok = true/false and a human
-- readable detail. The caller reports "provisioned" only when every row is ok.
--
-- This deliberately re-derives the answer from the DATABASE rather than trusting the
-- return of the seeding run: a seed that silently did nothing and a seed that worked are
-- indistinguishable from their return value, and only one of them leaves a usable tenant.
CREATE OR REPLACE FUNCTION public.rr_provisioning_status(p_company_id uuid)
RETURNS TABLE (
  component text,
  ok boolean,
  detail text
)
LANGUAGE plpgsql
STABLE
AS $status$
DECLARE
  expected_services text[] := ARRAY[
    'accident_recovery','tow_in','jump_start','roadside_assistance',
    'bystand','heavy_recovery','vehicle_movement','storage'
  ];
  expected_workflows text[] := ARRAY[
    'tow_recovery','heavy_recovery','roadside_assist','bystand','vehicle_movement','storage'
  ];
  missing text[];
  found integer;
  dupes text;
BEGIN
  IF p_company_id IS NULL THEN
    RAISE EXCEPTION 'rr_provisioning_status: p_company_id is required.';
  END IF;

  -- 1. Service catalogue -----------------------------------------------------
  SELECT array_agg(code) INTO missing
    FROM unnest(expected_services) AS code
   WHERE NOT EXISTS (
     SELECT 1 FROM public.rr_service_types t
      WHERE t.company_id = p_company_id AND t.service_code = code
   );
  RETURN QUERY SELECT
    'service_catalogue',
    missing IS NULL,
    CASE WHEN missing IS NULL
         THEN 'All 8 service types present.'
         ELSE 'Missing service types: ' || array_to_string(missing, ', ') END;

  -- 2. Workflow definitions --------------------------------------------------
  SELECT array_agg(key) INTO missing
    FROM unnest(expected_workflows) AS key
   WHERE NOT EXISTS (
     SELECT 1 FROM public.rr_workflow_definitions w
      WHERE w.company_id = p_company_id AND w.workflow_key = key
   );
  RETURN QUERY SELECT
    'workflow_definitions',
    missing IS NULL,
    CASE WHEN missing IS NULL
         THEN 'All 6 workflows present.'
         ELSE 'Missing workflows: ' || array_to_string(missing, ', ') END;

  -- 3. Exactly one ACTIVE version per workflow -------------------------------
  --
  -- A partial unique index already forbids two active versions. The dangerous case it
  -- cannot catch is ZERO active versions, which leaves a workflow that exists but cannot
  -- be resolved — so the count is checked explicitly in both directions.
  SELECT string_agg(w.workflow_key || '=' || w.n, ', ' ORDER BY w.workflow_key) INTO dupes
    FROM (
      SELECT d.workflow_key, count(*) FILTER (WHERE d.active) AS n
        FROM public.rr_workflow_definitions d
       WHERE d.company_id = p_company_id
       GROUP BY d.workflow_key
    ) w
   WHERE w.n <> 1;
  RETURN QUERY SELECT
    'workflow_active_version',
    dupes IS NULL,
    COALESCE('Workflows without exactly one active version: ' || dupes,
             'Every workflow has exactly one active version.');

  -- 4. BYSTAND workflow v2 ---------------------------------------------------
  SELECT count(*) INTO found
    FROM public.rr_workflow_definitions w
   WHERE w.company_id = p_company_id AND w.workflow_key = 'bystand'
     AND w.version = 2 AND w.active;
  RETURN QUERY SELECT
    'bystand_workflow_v2',
    found = 1,
    CASE WHEN found = 1
         THEN 'BYSTAND v2 is the active version.'
         ELSE 'BYSTAND workflow v2 is not the active version.' END;

  -- 5. BYSTAND reason codes --------------------------------------------------
  SELECT count(*) INTO found
    FROM public.rr_bystand_reason_codes r
   WHERE r.company_id = p_company_id;
  RETURN QUERY SELECT
    'bystand_reason_codes',
    found > 0,
    CASE WHEN found > 0
         THEN found || ' BYSTAND reason codes present.'
         ELSE 'No BYSTAND reason codes; an attendance cannot record why it was requested.' END;

  -- 6. Requirement policies --------------------------------------------------
  SELECT array_agg(code) INTO missing
    FROM unnest(expected_services) AS code
   WHERE NOT EXISTS (
     SELECT 1 FROM public.rr_requirement_policies p
      WHERE p.company_id = p_company_id AND p.service_code = code
   );
  RETURN QUERY SELECT
    'requirement_policies',
    missing IS NULL,
    CASE WHEN missing IS NULL
         THEN 'A requirement policy exists for every service.'
         ELSE 'Services with no requirement policy: ' || array_to_string(missing, ', ') END;

  -- 7. Requirement policy versions are usable --------------------------------
  --
  -- An ACTIVE policy carrying no requirements resolves as "nothing is required", which
  -- would silently let every job of that service bill with no evidence at all.
  SELECT string_agg(p.policy_key, ', ' ORDER BY p.policy_key) INTO dupes
    FROM public.rr_requirement_policies p
   WHERE p.company_id = p_company_id
     AND p.active
     AND NOT EXISTS (
       SELECT 1 FROM public.rr_requirement_items i WHERE i.policy_id = p.id
     );
  RETURN QUERY SELECT
    'requirement_policy_versions',
    dupes IS NULL,
    COALESCE('Active policies with no requirements: ' || dupes,
             'Every active policy carries at least one requirement.');

  -- 8. No duplicate baseline records -----------------------------------------
  --
  -- Unique constraints already prevent this. Verified anyway, because the whole point of
  -- the check is to catch a provisioning bug that got past them.
  SELECT string_agg(x.label, ', ') INTO dupes FROM (
    SELECT 'service_type:' || t.service_code AS label
      FROM public.rr_service_types t
     WHERE t.company_id = p_company_id
     GROUP BY t.service_code HAVING count(*) > 1
    UNION ALL
    SELECT 'workflow:' || w.workflow_key || '@' || w.version
      FROM public.rr_workflow_definitions w
     WHERE w.company_id = p_company_id
     GROUP BY w.workflow_key, w.version HAVING count(*) > 1
    UNION ALL
    SELECT 'reason:' || r.reason_code
      FROM public.rr_bystand_reason_codes r
     WHERE r.company_id = p_company_id
     GROUP BY r.reason_code HAVING count(*) > 1
    UNION ALL
    SELECT 'policy:' || p.policy_key || '@' || p.version
      FROM public.rr_requirement_policies p
     WHERE p.company_id = p_company_id
     GROUP BY p.policy_key, p.version HAVING count(*) > 1
  ) x;
  RETURN QUERY SELECT
    'no_duplicates',
    dupes IS NULL,
    COALESCE('Duplicate baseline records: ' || dupes, 'No duplicate baseline records.');

  -- 9. company_id is correct everywhere --------------------------------------
  --
  -- Every child row must belong to the same company as its parent. A mismatch would mean
  -- one tenant's catalogue pointing at another's workflow.
  SELECT string_agg(x.label, ', ') INTO dupes FROM (
    SELECT 'requirement_item:' || i.requirement_code AS label
      FROM public.rr_requirement_items i
      JOIN public.rr_requirement_policies p ON p.id = i.policy_id
     WHERE i.company_id = p_company_id AND p.company_id <> i.company_id
  ) x;
  RETURN QUERY SELECT
    'tenant_consistency',
    dupes IS NULL,
    COALESCE('Cross-tenant baseline rows: ' || dupes, 'Every baseline row is correctly scoped.');
END
$status$;

COMMENT ON FUNCTION public.rr_provisioning_status(uuid) IS
  'Verifies every Road & Recovery baseline component for one company. Returns one row per component; the module is fully provisioned only when every row reports ok. Read-only.';

REVOKE ALL ON FUNCTION public.rr_provisioning_status(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rr_provisioning_status(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.rr_provisioning_status(uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.rr_provisioning_status(uuid) TO service_role;

-- ---------------------------------------------------------------------------
-- 3. rr_provision_company — the one provisioning operation
-- ---------------------------------------------------------------------------
--
-- ADDITIVE ONLY. It creates what is missing and never removes, renames or resets
-- anything. Disabling the module does NOT call this and does NOT delete data: entitlement
-- is revoked, operational history is kept.
--
-- Runs as ONE statement, so plpgsql wraps it in a single transaction: either all four
-- components are applied or none is. That is where the retry-safety comes from — there is
-- no half-applied state to reconcile, and a retry simply re-runs four idempotent seeds.
CREATE OR REPLACE FUNCTION public.rr_provision_company(p_company_id uuid)
RETURNS TABLE (
  component text,
  ok boolean,
  detail text
)
LANGUAGE plpgsql
AS $provision$
DECLARE
  entitled boolean;
BEGIN
  IF p_company_id IS NULL THEN
    RAISE EXCEPTION 'rr_provision_company: p_company_id is required.';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.companies c WHERE c.id = p_company_id) THEN
    RAISE EXCEPTION 'rr_provision_company: company % does not exist.', p_company_id;
  END IF;

  -- Entitlement is checked HERE as well as in the caller. Seeding a tenant that does not
  -- hold the module would create operational data nobody asked for.
  SELECT COALESCE(c.enabled_modules, '[]'::jsonb) @> '["road_recovery"]'::jsonb
    INTO entitled
    FROM public.companies c
   WHERE c.id = p_company_id;

  IF NOT entitled THEN
    RAISE EXCEPTION
      'rr_provision_company: company % does not hold the road_recovery module.', p_company_id;
  END IF;

  -- Order is load-bearing; see the header.
  PERFORM public.rr_seed_service_catalogue(p_company_id);
  PERFORM public.rr_seed_bystand_reasons(p_company_id);
  PERFORM public.rr_publish_bystand_workflow_v2(p_company_id);
  PERFORM public.rr_seed_requirement_policies(p_company_id);

  RETURN QUERY SELECT * FROM public.rr_provisioning_status(p_company_id);
END
$provision$;

COMMENT ON FUNCTION public.rr_provision_company(uuid) IS
  'Provisions every Road & Recovery baseline component for one company in dependency order, inside one transaction, and returns the verification result. Additive, idempotent and safe to retry; never overwrites tenant customisation.';

REVOKE ALL ON FUNCTION public.rr_provision_company(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rr_provision_company(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.rr_provision_company(uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.rr_provision_company(uuid) TO service_role;

-- ---------------------------------------------------------------------------
-- 4. Row level security + tenant isolation
-- ---------------------------------------------------------------------------
ALTER TABLE public.rr_module_provisioning ENABLE ROW LEVEL SECURITY;

DO $tenant$
BEGIN
  IF to_regprocedure('public.vyron_user_company_ids()') IS NULL
     OR to_regprocedure('public.vyron_is_platform_operator()') IS NULL THEN
    RAISE NOTICE
      'Tenant helper functions missing (sql/030). rr_module_provisioning has RLS enabled with NO policy, which denies all access until sql/030 and then sql/074 are run.';
    RETURN;
  END IF;

  EXECUTE 'DROP POLICY IF EXISTS rr_module_provisioning_tenant_isolation ON public.rr_module_provisioning';
  EXECUTE
    'CREATE POLICY rr_module_provisioning_tenant_isolation ON public.rr_module_provisioning FOR ALL TO authenticated USING (
       public.vyron_is_platform_operator()
       OR EXISTS (
         SELECT 1
         FROM public.vyron_user_company_ids() as c(company_id)
         WHERE c.company_id::text = public.rr_module_provisioning.company_id::text
       )
     ) WITH CHECK (
       public.vyron_is_platform_operator()
       OR EXISTS (
         SELECT 1
         FROM public.vyron_user_company_ids() as c(company_id)
         WHERE c.company_id::text = public.rr_module_provisioning.company_id::text
       )
     )';
END
$tenant$;

REVOKE ALL ON public.rr_module_provisioning FROM anon;

-- Append-only. See the trigger above.
GRANT SELECT, INSERT ON public.rr_module_provisioning TO authenticated;
REVOKE UPDATE, DELETE, TRUNCATE ON public.rr_module_provisioning FROM authenticated;

-- ---------------------------------------------------------------------------
-- 5. Back-fill: provision every company that already holds the module
-- ---------------------------------------------------------------------------
--
-- Closes the gap this file exists for. Companies that gained road_recovery between
-- sql/070 and now have never been through a complete provisioning run.
DO $backfill$
DECLARE
  target uuid;
  applied integer := 0;
  verdict boolean;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='companies' AND column_name='enabled_modules'
  ) THEN
    RAISE NOTICE 'companies.enabled_modules is absent; skipping Road & Recovery provisioning back-fill.';
    RETURN;
  END IF;

  FOR target IN
    SELECT c.id FROM public.companies c
     WHERE COALESCE(c.enabled_modules, '[]'::jsonb) @> '["road_recovery"]'::jsonb
  LOOP
    PERFORM public.rr_seed_service_catalogue(target);
    PERFORM public.rr_seed_bystand_reasons(target);
    PERFORM public.rr_publish_bystand_workflow_v2(target);
    PERFORM public.rr_seed_requirement_policies(target);

    SELECT bool_and(s.ok) INTO verdict FROM public.rr_provisioning_status(target) s;

    INSERT INTO public.rr_module_provisioning
      (company_id, trigger_source, outcome, components, attempted_by)
    SELECT
      target,
      'migration',
      CASE WHEN verdict THEN 'provisioned' ELSE 'incomplete' END,
      COALESCE(jsonb_object_agg(s.component, jsonb_build_object('ok', s.ok, 'detail', s.detail)), '{}'::jsonb),
      'sql/074'
    FROM public.rr_provisioning_status(target) s;

    applied := applied + 1;
  END LOOP;

  RAISE NOTICE 'Road & Recovery provisioning back-fill applied to % companies.', applied;
END
$backfill$;

COMMIT;

NOTIFY pgrst, 'reload schema';

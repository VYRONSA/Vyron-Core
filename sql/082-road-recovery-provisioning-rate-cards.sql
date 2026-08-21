-- 082-road-recovery-provisioning-rate-cards.sql
-- VYRON CORE — Road & Recovery Phase 7: rate cards join provisioning.
--
-- ---------------------------------------------------------------------------
-- THE DEFECT
-- ---------------------------------------------------------------------------
--
-- sql/074 defined provisioning as FOUR components:
--
--     rr_seed_service_catalogue      service types + workflow definitions
--     rr_seed_bystand_reasons        BYSTAND attendance reasons
--     rr_publish_bystand_workflow_v2 the BYSTAND workflow
--     rr_seed_requirement_policies   evidence requirements
--
-- sql/078 then added rr_seed_rate_cards(uuid) and eight default rate cards — and never
-- wired the function into rr_provision_company(). A customer provisioned through the
-- production path therefore received a complete operational configuration with NO RATE
-- CARDS AT ALL, and every job they completed would stop at:
--
--     "This job has no frozen rate card. Resolve and freeze a rate card before
--      calculating charges."
--
-- Worse, rr_provisioning_status() had no rate-card component, so it reported all nine
-- checks green while the customer could not bill a single job. The gap was invisible to
-- the very function whose job is to make gaps visible.
--
-- This was not caught earlier because the Phase 5 test database had its rate cards
-- inserted by hand. It surfaced the moment Phase 7 built an environment through the real
-- provisioning path — which is the entire reason that harness exists.
--
-- ---------------------------------------------------------------------------
-- THE FIX
-- ---------------------------------------------------------------------------
--
--   1. rr_provision_company() seeds rate cards as a FIFTH component.
--   2. rr_provisioning_status() reports on them, so the same gap cannot recur silently.
--
-- sql/074 is NOT edited. Phase 4 is closed and its migration text is pinned by static
-- tests; replacing the function bodies here is how this repository already evolves, and
-- it keeps the history of what changed and why.
--
-- SAFE FOR EXISTING TENANTS. rr_seed_rate_cards() only inserts a policy_key that is not
-- already present, so a customer who has published their own commercial rates keeps them:
-- re-running provisioning adds the missing defaults and touches nothing else.
--
-- Idempotent and safe to re-run. Requires sql/074 and sql/078.

BEGIN;

DO $prereq$
BEGIN
  IF to_regprocedure('public.rr_provision_company(uuid)') IS NULL THEN
    RAISE EXCEPTION 'Prerequisite missing: public.rr_provision_company(uuid). Run sql/074 before sql/082.';
  END IF;
  IF to_regprocedure('public.rr_seed_rate_cards(uuid)') IS NULL THEN
    RAISE EXCEPTION 'Prerequisite missing: public.rr_seed_rate_cards(uuid). Run sql/078 before sql/082.';
  END IF;
  IF to_regclass('public.rr_rate_cards') IS NULL THEN
    RAISE EXCEPTION 'Prerequisite missing: public.rr_rate_cards. Run sql/078 before sql/082.';
  END IF;
END
$prereq$;

-- ---------------------------------------------------------------------------
-- 1. rr_provisioning_status — add the rate-card component
-- ---------------------------------------------------------------------------
--
-- Wrapping rather than rewriting. The nine checks sql/074 defined are unchanged and are
-- still produced by the function that owns them; this adds a tenth and leaves the rest
-- exactly as Phase 4 wrote them.
ALTER FUNCTION public.rr_provisioning_status(uuid) RENAME TO rr_provisioning_status_baseline;

CREATE OR REPLACE FUNCTION public.rr_provisioning_status(p_company_id uuid)
RETURNS TABLE(component text, ok boolean, detail text)
LANGUAGE plpgsql
AS $status$
DECLARE
  missing text[];
  carded integer;
BEGIN
  -- Every baseline check, verbatim from sql/074.
  RETURN QUERY SELECT * FROM public.rr_provisioning_status_baseline(p_company_id);

  -- A rate card per ACTIVE service type. A service a tenant offers but cannot price is a
  -- job they will complete and then be unable to bill.
  SELECT array_agg(DISTINCT t.service_code ORDER BY t.service_code)
    INTO missing
    FROM public.rr_service_types t
   WHERE t.company_id = p_company_id
     AND t.active
     AND NOT EXISTS (
       SELECT 1 FROM public.rr_rate_cards rc
        WHERE rc.company_id = p_company_id
          AND rc.service_code = t.service_code
          AND rc.active
     );

  RETURN QUERY SELECT
    'rate_cards'::text,
    missing IS NULL,
    CASE WHEN missing IS NULL
         THEN 'Every active service type has a rate card.'
         ELSE 'Services with no active rate card: ' || array_to_string(missing, ', ')
              || '. Jobs for these services cannot be priced or billed.' END;

  -- A rate card with no items prices nothing, which fails later and less clearly than it
  -- would fail here.
  SELECT count(*)::integer
    INTO carded
    FROM public.rr_rate_cards rc
   WHERE rc.company_id = p_company_id
     AND rc.active
     AND NOT EXISTS (
       SELECT 1 FROM public.rr_rate_card_items i
        WHERE i.company_id = rc.company_id AND i.rate_card_id = rc.id
     );

  RETURN QUERY SELECT
    'rate_card_items'::text,
    carded = 0,
    CASE WHEN carded = 0
         THEN 'Every active rate card carries at least one charge item.'
         ELSE carded || ' active rate card(s) have no charge items and would price nothing.' END;
END
$status$;

COMMENT ON FUNCTION public.rr_provisioning_status(uuid) IS
  'Road & Recovery provisioning readiness. The nine baseline components from sql/074 plus the rate-card components added in sql/082, so a tenant can never be reported fully provisioned while unable to price a job.';

-- ---------------------------------------------------------------------------
-- 2. rr_provision_company — seed rate cards
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rr_provision_company(p_company_id uuid)
RETURNS TABLE(component text, ok boolean, detail text)
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

  -- Order is load-bearing; see the sql/074 header.
  PERFORM public.rr_seed_service_catalogue(p_company_id);
  PERFORM public.rr_seed_bystand_reasons(p_company_id);
  PERFORM public.rr_publish_bystand_workflow_v2(p_company_id);
  PERFORM public.rr_seed_requirement_policies(p_company_id);

  -- Added in sql/082. LAST, because a rate card is per service code and the service
  -- catalogue has to exist before there is anything to price.
  --
  -- The seeded cards carry ZERO rates by design (sql/078): VYRON CORE does not invent a
  -- customer's commercial pricing. They give every service a priceable structure, and the
  -- operator fills in their own numbers. A zero rate BLOCKS billing with a clear reason
  -- rather than silently charging nothing, which is why seeding them is safe.
  PERFORM public.rr_seed_rate_cards(p_company_id);

  RETURN QUERY SELECT * FROM public.rr_provisioning_status(p_company_id);
END
$provision$;

COMMENT ON FUNCTION public.rr_provision_company(uuid) IS
  'Provisions Road & Recovery for one company: service catalogue, BYSTAND reasons, BYSTAND workflow v2, requirement policies and (from sql/082) default rate cards. Idempotent, entitlement-checked, and safe to retry after a partial failure.';

-- ---------------------------------------------------------------------------
-- 3. Backfill existing tenants
-- ---------------------------------------------------------------------------
--
-- Any tenant already provisioned before this migration is missing their rate cards and
-- cannot bill. Seeding them here means the fix lands on deployment rather than waiting
-- for somebody to notice and re-run provisioning by hand.
DO $backfill$
DECLARE
  target record;
  seeded integer := 0;
BEGIN
  FOR target IN
    SELECT DISTINCT t.company_id
      FROM public.rr_service_types t
     WHERE t.active
  LOOP
    PERFORM public.rr_seed_rate_cards(target.company_id);
    seeded := seeded + 1;
  END LOOP;

  IF seeded > 0 THEN
    RAISE NOTICE
      'sql/082 seeded default rate cards for % already-provisioned company(ies). Existing published rate cards were left untouched.',
      seeded;
  END IF;
END
$backfill$;

COMMIT;

NOTIFY pgrst, 'reload schema';

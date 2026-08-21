-- 049-release-candidate-security-hardening.sql
-- VYRON CORE v1.0 RC: enforce tenant isolation for all company-scoped tables.
-- Safe to re-run.

BEGIN;

DO $$
BEGIN
  IF to_regprocedure('public.vyron_user_company_ids()') IS NULL THEN
    RAISE EXCEPTION 'Prerequisite missing: public.vyron_user_company_ids(). Run 030-multi-tenant-security.sql before 049-release-candidate-security-hardening.sql.';
  END IF;

  IF to_regprocedure('public.vyron_is_platform_operator()') IS NULL THEN
    RAISE EXCEPTION 'Prerequisite missing: public.vyron_is_platform_operator(). Run 030-multi-tenant-security.sql before 049-release-candidate-security-hardening.sql.';
  END IF;
END $$;

DO $hardening$
DECLARE
  tbl text;
  pol record;
BEGIN
  FOR tbl IN
    SELECT c.table_name
    FROM information_schema.columns c
    JOIN information_schema.tables t
      ON t.table_schema = c.table_schema
     AND t.table_name = c.table_name
    WHERE c.table_schema = 'public'
      AND c.column_name = 'company_id'
      AND t.table_type = 'BASE TABLE'
      AND c.table_name NOT IN ('vyron_user_sessions')
    ORDER BY c.table_name
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', tbl);

    FOR pol IN
      SELECT p.policyname
      FROM pg_policies p
      WHERE p.schemaname = 'public'
        AND p.tablename = tbl
        AND (
          p.policyname ILIKE 'DEV allow all%%'
          OR p.policyname ILIKE '%\_all' ESCAPE '\'
        )
    LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', pol.policyname, tbl);
    END LOOP;

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
      tbl,
      tbl,
      tbl,
      tbl
    );

    EXECUTE format('REVOKE ALL ON public.%I FROM anon', tbl);

    -- Some tables take least-privilege grants instead of the generic read/write set.
    -- Granting UPDATE/DELETE on an immutable log contradicts the trigger that guards it,
    -- and leaves the permission model asserting something untrue.
    --
    -- APPEND-ONLY (SELECT, INSERT):
    --   public.rr_service_state_events (sql/070) — Road & Recovery state transition
    --     history. SLA clocks and BYSTAND standing time are derived from it, so a
    --     recorded transition must never be edited or removed; a correction is a new
    --     transition.
    --   public.rr_dispatch_candidates (sql/071) — the explainability record for every
    --     dispatch evaluation. A dispatch decision must be defensible after the fact,
    --     so a re-evaluation writes a new evaluation_id rather than editing history.
    --   public.rr_standby_summary (sql/072) — the sealed BYSTAND billable standing
    --     result. Billing reads this frozen fact; a correction seals a NEW summary
    --     rather than editing what was already billed.
    --   public.rr_compliance_evaluations (sql/073) — deterministic compliance verdicts.
    --     A verdict may be shown to an insurer in a dispute, so a re-evaluation writes a
    --     NEW row rather than editing the one already relied upon.
    --   public.rr_requirement_waivers (sql/073) — a requirement excused with a reason and
    --     a named authoriser. Editing a waiver would rewrite why a job was allowed to bill.
    --   public.rr_module_provisioning (sql/074) — the record of what was provisioned for a
    --     customer and when. A retry appends a new attempt rather than amending the last.
    --   public.rr_custody_events (sql/076) — the chain of custody. The authoritative answer
    --     to who possessed a vehicle, when, and who received it. A correction is a new
    --     event; editing one would rewrite the evidence in a possession dispute.
    --   public.rr_storage_accrual (sql/077) — the sealed storage charge. Billing reads this
    --     frozen fact; a re-calculation seals a NEW row under a new calculator version
    --     rather than re-pricing an invoice that has already been issued.
    --   public.rr_charge_calculations (sql/079) — the sealed expected-charge calculation.
    --   public.rr_charge_lines (sql/079) — the lines belonging to it. Both carry the engine
    --     and rate-card versions that produced them; a re-calculation seals a NEW row.
    --
    -- APPEND-ONLY WITH A NARROW UPDATE (SELECT, INSERT, UPDATE, no DELETE):
    --   public.rr_billable_facts (sql/079) — operational quantities and the driver's
    --     odometer capture. UPDATE is granted ONLY so a fact can be retired by pointing it
    --     at its replacement; a trigger refuses any change to what the fact actually
    --     records, so the original driver reading survives every dispute.
    --   public.rr_billing_disputes (sql/080) — a challenged quantity or rate. UPDATE is
    --     granted ONLY so the review OUTCOME can be recorded; what was originally claimed
    --     is frozen by the same kind of trigger.
    --
    -- READ-ONLY PROJECTION (SELECT):
    --   public.rr_custody_holdings (sql/076) — "who holds it right now", maintained by
    --     trigger from rr_custody_events. A hand-written row here would claim a possession
    --     the event log does not support, so a tenant user reads it and never writes it.
    --
    -- IMMUTABLE-BUT-DELETABLE (SELECT, INSERT, DELETE):
    --   public.rr_evidence_requirements (sql/073) — the per-job requirement snapshot.
    --     Never UPDATEd: a policy change must not retroactively alter what an existing job
    --     was required to produce. DELETE stays available only for the job-creation
    --     rollback path.
    --   public.rr_job_rate_snapshot (sql/078) — the per-job rate-card snapshot. Never
    --     UPDATEd: publishing a new rate card must not re-price a job that is already
    --     complete. DELETE stays available only for the calculation-rollback path.
    --
    -- NON-DELETABLE (SELECT, INSERT, UPDATE):
    --   public.rr_authorisations (sql/071) — a legal record. It is voided (status,
    --     void_reason, voided_at), never destroyed, so UPDATE is required but DELETE
    --     must not be granted.
    --   public.rr_release_authorisations (sql/075) — release and disposal authority, the
    --     same kind of legal record and voided the same way. Deleting one would erase the
    --     answer to "on whose authority did this vehicle leave, or get scrapped".
    --   public.rr_storage_bookings (sql/077) — an occupancy is edited while it is open
    --     (bay moves, condition notes, check-out) but never destroyed: it underpins a
    --     storage charge and the accrual sealed against it.
    --   public.rr_intelligence_thresholds (sql/081) — a published operational target. It
    --     is RETIRED (active, effective_to, retired_by, retired_at), never destroyed:
    --     deleting one would erase the target a past breach was measured against, and last
    --     month's critical would silently become on-target. UPDATE is required for
    --     retirement; a trigger refuses any change to what the target actually says.
    --
    --   public.discipline_progression_decisions (sql/054) — the progressive-discipline
    --     recommendation record: recommended stage, whether a hearing is required, whether
    --     dismissal was recommended, the risk level, the confidence and the reasoning.
    --     sql/054 grants SELECT and INSERT only, and it is right to: this is the record of
    --     what the system advised BEFORE an outcome was decided, and it may be produced at
    --     a CCMA arbitration. Editing one after the fact would rewrite the advice that a
    --     dismissal was based on.
    --
    --     It was NOT registered here, so every re-run of this file silently restored
    --     UPDATE and DELETE on it. sql/054 runs after this file on a clean install, which
    --     is why it looked correct — the widening only appeared when the hardening was
    --     re-applied, which is precisely what a release does. Found by the Phase 7 gate.
    --
    -- The REVOKEs are deliberate and not merely defensive: they REPAIR any project where
    -- an earlier run of this file already widened the grants. These tables are otherwise
    -- left in the loop on purpose, so they keep receiving this file's RLS enablement,
    -- tenant isolation policy and anon revocation like every other company-scoped table.
    IF tbl IN (
      'rr_service_state_events', 'rr_dispatch_candidates', 'rr_standby_summary',
      'rr_compliance_evaluations', 'rr_requirement_waivers', 'rr_module_provisioning',
      'rr_custody_events', 'rr_storage_accrual',
      'rr_charge_calculations', 'rr_charge_lines',
      'discipline_progression_decisions'
    ) THEN
      EXECUTE format('REVOKE UPDATE, DELETE, TRUNCATE ON public.%I FROM authenticated', tbl);
      EXECUTE format('GRANT SELECT, INSERT ON public.%I TO authenticated', tbl);
    ELSIF tbl IN ('rr_authorisations', 'rr_release_authorisations', 'rr_storage_bookings',
                  'rr_billable_facts', 'rr_billing_disputes', 'rr_intelligence_thresholds') THEN
      EXECUTE format('REVOKE DELETE, TRUNCATE ON public.%I FROM authenticated', tbl);
      EXECUTE format('GRANT SELECT, INSERT, UPDATE ON public.%I TO authenticated', tbl);
    ELSIF tbl IN ('rr_custody_holdings') THEN
      EXECUTE format('REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.%I FROM authenticated', tbl);
      EXECUTE format('GRANT SELECT ON public.%I TO authenticated', tbl);
    ELSIF tbl IN ('rr_evidence_requirements', 'rr_job_rate_snapshot') THEN
      EXECUTE format('REVOKE UPDATE, TRUNCATE ON public.%I FROM authenticated', tbl);
      EXECUTE format('GRANT SELECT, INSERT, DELETE ON public.%I TO authenticated', tbl);
    ELSE
      EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO authenticated', tbl);
    END IF;
  END LOOP;
END
$hardening$;

COMMIT;

NOTIFY pgrst, 'reload schema';

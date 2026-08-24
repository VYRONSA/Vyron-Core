-- 094-companies-enabled-modules.sql
-- VYRON CORE — Phase 9F: add companies.enabled_modules (module entitlement column)
--
-- Target project : gpiqkwebizuqajgaoxhm (vyron-core, eu-west-1)
-- Follows        : sql/090 (anon lockdown), sql/091 (tenant linkage), sql/092 (storage
--                  isolation + least privilege), sql/031 (mobile workforce).
--                  None of those may be rolled back.
--
-- ===========================================================================
-- WHY THIS FILE EXISTS
-- ===========================================================================
-- Road & Recovery is absent from the deployed navigation. Traced end-to-end:
--
--   Sidebar item          {roadRecoveryEnabled && (...)}   app/_app-shell.tsx:2062
--   -> useHasModule("road_recovery")                       app/_app-shell.tsx:16292
--   -> useTenantModules()                                  lib/tenant/use-module-access.ts:81
--   -> GET /api/tenant/modules?companyId=...
--   -> effectiveUserModules(company_users.module_access, companies.enabled_modules)
--
-- app/api/tenant/modules/route.ts:40 selects "enabled_modules" from public.companies.
-- That column does not exist in this project, so the query fails with
--
--   ERROR: 42703: column "enabled_modules" does not exist
--
-- and the endpoint returns HTTP 500. Verified live against the deployed preview with a
-- real signed-in session:
--
--   GET /api/tenant/modules?companyId=11111111-1111-1111-1111-111111111111
--   -> 500 {"ok":false,"error":"Could not read the company's module entitlement."}
--
-- The client deliberately falls back to modules: [] on failure (a failed read must not
-- hide the whole application), so navigation renders without Road & Recovery.
--
-- ===========================================================================
-- WHY NOT sql/062
-- ===========================================================================
-- sql/062-platform-console-foundation.sql:74 is where enabled_modules is normally
-- created. Running 062 wholesale would ALSO:
--
--   * add ~27 further columns to public.companies (trading_name, vat_number, plan_id,
--     solution_template_id, employee_limit, user_limit, storage_limit_gb,
--     ai_credit_limit, api_request_limit, licence_expires_at, billing_frequency,
--     renewal_date, invoice_reference, payment_status, customer_status, ...)
--   * add 2 CHECK constraints to public.companies
--   * create 2 new tables (subscription_plans, solution_templates)
--   * INSERT seed rows into both
--   * create 4 policies, of which 2 are USING (true) — the cross-tenant pattern
--     removed in Phases 9C and 9D
--
-- None of that is required to make the entitlement readable. This file adds the single
-- column and nothing else.
--
-- ===========================================================================
-- WHAT THIS CHANGES
-- ===========================================================================
-- Definition is copied verbatim from sql/062:
--
--     ADD COLUMN IF NOT EXISTS enabled_modules jsonb NOT NULL DEFAULT '[]'::jsonb
--
-- Every existing company row receives '[]'::jsonb — the same entitlement they have
-- today (none). No company gains a module. Road & Recovery does NOT become visible
-- as a result of this migration; that requires a separate, separately-approved grant.
--
-- Behavioural effect, precisely:
--   before : /api/tenant/modules -> HTTP 500  -> client falls back to modules: []
--   after  : /api/tenant/modules -> HTTP 200  -> {"modules": []}
-- Navigation is identical either way. The difference is a handled empty result instead
-- of a server error, which is also what six Platform Console routes already expect
-- (app/api/platform/customers, .../[companyId], .../[companyId]/modules,
--  .../dashboard, .../intelligence, lib/platform/metrics.ts).
--
-- The column is written in exactly ONE place in the application —
-- app/api/platform/customers/[companyId]/modules/route.ts:52 — a Platform Console
-- operator action. Nothing writes it implicitly.
--
-- SCOPE — this file does NOT:
--   * grant road_recovery (or any module) to any company
--   * add any other column, constraint, index, trigger, function or view
--   * create or drop any table
--   * change any RLS policy, grant or role privilege
--   * modify any existing row value other than populating the new column's default
--   * touch anon, authenticated or service_role privileges
--
-- IDEMPOTENT: ADD COLUMN IF NOT EXISTS. Re-running is a no-op.
-- LOCK PROFILE: ADD COLUMN with a non-volatile DEFAULT is metadata-only in PostgreSQL 11+
-- (this is 17.6). No table rewrite. public.companies holds 3 rows.
--
-- ROLLBACK: sql/094-rollback.sql

BEGIN;

ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS enabled_modules jsonb NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN public.companies.enabled_modules IS
  'Module codes this company''s subscription enables, e.g. ["leave","road_recovery"]. '
  'Empty array = no modules. Intersected server-side with company_users.module_access '
  'by effectiveUserModules(); see lib/tenant/module-access.ts. Written only by the '
  'Platform Console (app/api/platform/customers/[companyId]/modules).';

COMMIT;

NOTIFY pgrst, 'reload schema';

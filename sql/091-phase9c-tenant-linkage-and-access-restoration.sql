-- 091-phase9c-tenant-linkage-and-access-restoration.sql
-- VYRON CORE — PHASE 9C: tenant linkage repair + authenticated access restoration
--
-- Target project : gpiqkwebizuqajgaoxhm (vyron-core, eu-west-1)
-- Backup         : audit/backups/20260823T110011Z-pre-9c/
-- Baseline       : audit/schema-snapshots/20260823T103743Z-phase9b-baseline/
-- Follows        : sql/090-production-anon-lockdown.sql (must NOT be rolled back)
--
-- WHY THIS FILE EXISTS
--   sql/090 dropped 104 policies that carried no TO clause. A policy with no TO clause
--   applies to PUBLIC, which includes `authenticated` — not only `anon`. Dropping them
--   therefore removed authenticated access to 20 relations, six of which have live
--   application call-sites. This file restores those six with properly tenant-scoped
--   policies, repairs the company_users linkage that leaves auth.uid() policies dead,
--   and closes three pre-existing USING (true) tenant-isolation bypasses plus one
--   RLS-bypassing view.
--
-- SCOPE — this file does NOT:
--   * change any GRANT (authenticated stays at 371 privilege rows, service_role at 371)
--   * re-grant anything to anon (anon stays at 0 table and 0 function privileges)
--   * create, drop, rename or alter any table, column, constraint, index or trigger
--   * create users or tenants, or modify auth.users
--   * modify any business row except the company_users.user_id repair in Section 1
--   * use USING (true) anywhere
--
--   NOTE ON TYPES: leave_balances.employee_id, employee_notifications.employee_id and
--   leave_decision_audit.employee_id are `text`, while employees.id is `uuid`. Comparing
--   them directly raises "operator does not exist: text = uuid" — the same defect class
--   recorded in docs/SCHEMA_NORMALIZATION_PLAN.md, and it aborted the first local
--   validation run of this file. The subquery therefore projects e.id::text, matching the
--   semantics of the existing public.safe_employee_match(uuid, text) helper (a::text = b).
--   All three tables are currently empty, so no value-format risk exists.
--
-- ESTABLISHED PATTERN
--   Tenant scoping reuses the two existing SECURITY DEFINER helpers, exactly as the 20
--   working *_tenant_isolation policies already do:
--     vyron_user_company_ids()      -> companies the caller belongs to, matched on the
--                                      JWT email claim (works despite NULL user_id)
--     vyron_is_platform_operator()  -> hardcoded to info@vyronsoft.co.za
--
--   Three of the six restored relations have NO company_id column
--   (leave_balances, employee_notifications, leave_decision_audit). They are scoped
--   through employee_id -> employees.company_id. The employees table already carries
--   employees_tenant_isolation, so that subquery is itself tenant-filtered.
--
-- ROLLBACK
--   See sql/091-rollback-phase9c.sql

BEGIN;

-- ===========================================================================
-- SECTION 1 — REPAIR company_users TENANT LINKAGE
-- ===========================================================================
-- Four rows have user_id IS NULL and auth_user_id IS NULL. Exactly two of them match
-- exactly one auth.users record by email:
--
--   9ad55b60-…  info@vyronsoft.co.za  -> 15e2ae26-6912-46c3-9715-0db592f4027c
--   88d71df8-…  info@axsyssa.co.za    -> 98d0049a-0c31-43f2-bed4-86961d45c1b8
--
-- The remaining two have ZERO auth.users matches and therefore cannot be repaired:
--   3c063fa0-…  admin@vyron.local      (no account; .local is not a real domain)
--   6aa39797-…  gerhard@axsyssa.co.za  (no account)
-- They are left untouched. This is absence of a match, not ambiguity.
--
-- The = 1 guard makes the statement refuse to write on any ambiguous email.
-- auth_user_id is deliberately NOT written. auth.users is not modified.
-- The BEFORE INSERT OR UPDATE trigger set_company_user_user_id() no-ops here, because
-- it only acts when NEW.user_id IS NULL and NEW.auth_user_id IS NOT NULL.

UPDATE public.company_users cu
SET user_id = au.id
FROM auth.users au
WHERE cu.user_id IS NULL
  AND lower(au.email) = lower(cu.user_email)
  AND (SELECT count(*) FROM auth.users a2 WHERE lower(a2.email) = lower(cu.user_email)) = 1;

-- ===========================================================================
-- SECTION 2 — RESTORE AUTHENTICATED TENANT POLICIES (6 relations)
-- ===========================================================================
-- Operations were derived from 1,130 call-sites across 781 repository source files.
-- Only the operations the application actually performs are granted a policy.

-- --- leave_balances — app does SELECT (5), INSERT (3), UPDATE (2); scoped via employee
CREATE POLICY "leave_balances_tenant_select" ON public.leave_balances
  FOR SELECT TO authenticated
  USING (
    public.vyron_is_platform_operator()
    OR employee_id IN (
      SELECT e.id::text FROM public.employees e
      WHERE e.company_id IN (SELECT public.vyron_user_company_ids())
    )
  );

CREATE POLICY "leave_balances_tenant_insert" ON public.leave_balances
  FOR INSERT TO authenticated
  WITH CHECK (
    public.vyron_is_platform_operator()
    OR employee_id IN (
      SELECT e.id::text FROM public.employees e
      WHERE e.company_id IN (SELECT public.vyron_user_company_ids())
    )
  );

CREATE POLICY "leave_balances_tenant_update" ON public.leave_balances
  FOR UPDATE TO authenticated
  USING (
    public.vyron_is_platform_operator()
    OR employee_id IN (
      SELECT e.id::text FROM public.employees e
      WHERE e.company_id IN (SELECT public.vyron_user_company_ids())
    )
  )
  WITH CHECK (
    public.vyron_is_platform_operator()
    OR employee_id IN (
      SELECT e.id::text FROM public.employees e
      WHERE e.company_id IN (SELECT public.vyron_user_company_ids())
    )
  );

-- --- employee_notifications — app does SELECT only (1 call-site); scoped via employee
CREATE POLICY "employee_notifications_tenant_select" ON public.employee_notifications
  FOR SELECT TO authenticated
  USING (
    public.vyron_is_platform_operator()
    OR employee_id IN (
      SELECT e.id::text FROM public.employees e
      WHERE e.company_id IN (SELECT public.vyron_user_company_ids())
    )
  );

-- --- leave_decision_audit — app does SELECT only (1 call-site); scoped via employee
CREATE POLICY "leave_decision_audit_tenant_select" ON public.leave_decision_audit
  FOR SELECT TO authenticated
  USING (
    public.vyron_is_platform_operator()
    OR employee_id IN (
      SELECT e.id::text FROM public.employees e
      WHERE e.company_id IN (SELECT public.vyron_user_company_ids())
    )
  );

-- --- payroll_clock_checks — app does SELECT (4), UPDATE (1); has company_id
CREATE POLICY "payroll_clock_checks_tenant_select" ON public.payroll_clock_checks
  FOR SELECT TO authenticated
  USING (
    public.vyron_is_platform_operator()
    OR company_id IN (SELECT public.vyron_user_company_ids())
  );

CREATE POLICY "payroll_clock_checks_tenant_update" ON public.payroll_clock_checks
  FOR UPDATE TO authenticated
  USING (
    public.vyron_is_platform_operator()
    OR company_id IN (SELECT public.vyron_user_company_ids())
  )
  WITH CHECK (
    public.vyron_is_platform_operator()
    OR company_id IN (SELECT public.vyron_user_company_ids())
  );

-- --- payroll_export_logs — app does SELECT (1), INSERT (1); has company_id
CREATE POLICY "payroll_export_logs_tenant_select" ON public.payroll_export_logs
  FOR SELECT TO authenticated
  USING (
    public.vyron_is_platform_operator()
    OR company_id IN (SELECT public.vyron_user_company_ids())
  );

CREATE POLICY "payroll_export_logs_tenant_insert" ON public.payroll_export_logs
  FOR INSERT TO authenticated
  WITH CHECK (
    public.vyron_is_platform_operator()
    OR company_id IN (SELECT public.vyron_user_company_ids())
  );

-- --- user_roles — app does SELECT (3), INSERT (1); has company_id
CREATE POLICY "user_roles_tenant_select" ON public.user_roles
  FOR SELECT TO authenticated
  USING (
    public.vyron_is_platform_operator()
    OR company_id IN (SELECT public.vyron_user_company_ids())
  );

CREATE POLICY "user_roles_tenant_insert" ON public.user_roles
  FOR INSERT TO authenticated
  WITH CHECK (
    public.vyron_is_platform_operator()
    OR company_id IN (SELECT public.vyron_user_company_ids())
  );

-- ===========================================================================
-- SECTION 3 — CLOSE THE THREE USING (true) TENANT BYPASSES
-- ===========================================================================
-- field_assets_all, field_daily_shifts_all and field_vehicles_all are targeted at
-- authenticated with USING (true) and no tenant filter, so any authenticated user in
-- any tenant can read and write every tenant's rows. All three tables carry company_id.
--
-- Each is replaced with a FOR ALL tenant-scoped policy, matching the naming and shape
-- of the field_jobs / field_job_assignments / field_job_events policies that already
-- exist. FOR ALL is retained deliberately so no currently-working operation is lost —
-- the change removes the cross-tenant hole without narrowing legitimate behaviour.

DROP POLICY IF EXISTS "field_assets_all" ON public.field_assets;
CREATE POLICY "field_assets_tenant_isolation" ON public.field_assets
  FOR ALL TO authenticated
  USING (
    public.vyron_is_platform_operator()
    OR company_id IN (SELECT public.vyron_user_company_ids())
  )
  WITH CHECK (
    public.vyron_is_platform_operator()
    OR company_id IN (SELECT public.vyron_user_company_ids())
  );

DROP POLICY IF EXISTS "field_daily_shifts_all" ON public.field_daily_shifts;
CREATE POLICY "field_daily_shifts_tenant_isolation" ON public.field_daily_shifts
  FOR ALL TO authenticated
  USING (
    public.vyron_is_platform_operator()
    OR company_id IN (SELECT public.vyron_user_company_ids())
  )
  WITH CHECK (
    public.vyron_is_platform_operator()
    OR company_id IN (SELECT public.vyron_user_company_ids())
  );

DROP POLICY IF EXISTS "field_vehicles_all" ON public.field_vehicles;
CREATE POLICY "field_vehicles_tenant_isolation" ON public.field_vehicles
  FOR ALL TO authenticated
  USING (
    public.vyron_is_platform_operator()
    OR company_id IN (SELECT public.vyron_user_company_ids())
  )
  WITH CHECK (
    public.vyron_is_platform_operator()
    OR company_id IN (SELECT public.vyron_user_company_ids())
  );

-- ===========================================================================
-- SECTION 4 — SECURE leave_balances_live
-- ===========================================================================
-- The view is owned by postgres and has no security_invoker option, so it executes with
-- owner privileges and bypasses RLS on leave_balances. It selects
-- "FROM leave_balances lb" with no filter and exposes no company_id column, so every
-- tenant's leave balances are readable by every authenticated caller.
--
-- security_invoker = true makes the view evaluate under the caller's identity, so the
-- leave_balances policies created in Section 2 now apply through it. The view's column
-- contract is unchanged — this alters only whose permissions are used to read it.
-- Callers already hold SELECT on leave_balances and EXECUTE on leave_completed_months().

ALTER VIEW public.leave_balances_live SET (security_invoker = true);

COMMIT;

-- Reload the PostgREST schema cache so the new policy state takes effect immediately.
NOTIFY pgrst, 'reload schema';

-- 091-rollback-phase9c.sql
-- Reverses sql/091-phase9c-tenant-linkage-and-access-restoration.sql exactly.
--
-- ###########################################################################
-- # WARNING: this REOPENS two cross-tenant exposures.                       #
-- #  * field_assets / field_daily_shifts / field_vehicles return to         #
-- #    USING (true) — every authenticated user sees every tenant's rows.    #
-- #  * leave_balances_live returns to bypassing RLS on leave_balances.      #
-- # Use only to recover from an unexpected regression, never routinely.     #
-- ###########################################################################
--
-- It does NOT touch sql/090. The anon lockdown stays in force.

BEGIN;

-- SECTION 4 (reverse) — return the view to owner-privilege execution
ALTER VIEW public.leave_balances_live RESET (security_invoker);

-- SECTION 3 (reverse) — restore the original USING (true) policies verbatim
DROP POLICY IF EXISTS "field_assets_tenant_isolation" ON public.field_assets;
CREATE POLICY "field_assets_all" ON public.field_assets
  FOR ALL TO authenticated USING (true);

DROP POLICY IF EXISTS "field_daily_shifts_tenant_isolation" ON public.field_daily_shifts;
CREATE POLICY "field_daily_shifts_all" ON public.field_daily_shifts
  FOR ALL TO authenticated USING (true);

DROP POLICY IF EXISTS "field_vehicles_tenant_isolation" ON public.field_vehicles;
CREATE POLICY "field_vehicles_all" ON public.field_vehicles
  FOR ALL TO authenticated USING (true);

-- SECTION 2 (reverse) — remove the 11 restored tenant policies
DROP POLICY IF EXISTS "leave_balances_tenant_select"          ON public.leave_balances;
DROP POLICY IF EXISTS "leave_balances_tenant_insert"          ON public.leave_balances;
DROP POLICY IF EXISTS "leave_balances_tenant_update"          ON public.leave_balances;
DROP POLICY IF EXISTS "employee_notifications_tenant_select"  ON public.employee_notifications;
DROP POLICY IF EXISTS "leave_decision_audit_tenant_select"    ON public.leave_decision_audit;
DROP POLICY IF EXISTS "payroll_clock_checks_tenant_select"    ON public.payroll_clock_checks;
DROP POLICY IF EXISTS "payroll_clock_checks_tenant_update"    ON public.payroll_clock_checks;
DROP POLICY IF EXISTS "payroll_export_logs_tenant_select"     ON public.payroll_export_logs;
DROP POLICY IF EXISTS "payroll_export_logs_tenant_insert"     ON public.payroll_export_logs;
DROP POLICY IF EXISTS "user_roles_tenant_select"              ON public.user_roles;
DROP POLICY IF EXISTS "user_roles_tenant_insert"              ON public.user_roles;

-- SECTION 1 (reverse) — return the two repaired rows to user_id NULL
UPDATE public.company_users
SET user_id = NULL
WHERE id IN (
  '9ad55b60-56a6-4fe5-b8dd-286368c5152d',  -- info@vyronsoft.co.za
  '88d71df8-86be-495c-9df2-90c38aa11bd8'   -- info@axsyssa.co.za
);

COMMIT;

NOTIFY pgrst, 'reload schema';

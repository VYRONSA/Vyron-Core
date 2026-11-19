-- =====================================================================================
-- 103 rollback. WARNING: removes server-side payroll generation, period locks and the
-- payroll audit trail, and re-opens browser writes to payroll_hours (manager-only, as left
-- by 100). Exported rows lose their lock. Export payroll_hours_audit and
-- payroll_period_locks first. Run only with written approval.
-- Columns added to payroll_hours are kept (they hold data).
-- =====================================================================================
begin;

drop trigger if exists trg_vyron_guard_payroll_hours on public.payroll_hours;
drop function if exists public.vyron_guard_payroll_hours();
drop function if exists public.vyron_export_payroll_period(uuid, date, date, text);
drop function if exists public.vyron_payroll_export_rows(uuid);
drop function if exists public.vyron_set_payroll_hours_status(uuid, uuid[], text, text, boolean);
drop function if exists public.vyron_generate_payroll_hours(uuid, date, date);
drop function if exists public.vyron_night_minutes(timestamptz, timestamptz, time, time);
drop function if exists public.vyron_payroll_settings(uuid);
drop function if exists public.vyron_is_payroll_manager(uuid);
drop function if exists public.vyron_payroll_roles();

grant insert, update, delete on public.payroll_hours to authenticated;
drop policy if exists payroll_hours_insert_v100 on public.payroll_hours;
drop policy if exists payroll_hours_update_v100 on public.payroll_hours;
drop policy if exists payroll_hours_delete_v100 on public.payroll_hours;
create policy payroll_hours_insert_v100 on public.payroll_hours for insert to authenticated
  with check ((select public.vyron_is_platform_operator()) or company_id in (select public.vyron_manager_company_ids()));
create policy payroll_hours_update_v100 on public.payroll_hours for update to authenticated
  using ((select public.vyron_is_platform_operator()) or company_id in (select public.vyron_manager_company_ids()))
  with check ((select public.vyron_is_platform_operator()) or company_id in (select public.vyron_manager_company_ids()));
create policy payroll_hours_delete_v100 on public.payroll_hours for delete to authenticated
  using ((select public.vyron_is_platform_operator()) or company_id in (select public.vyron_manager_company_ids()));

drop table if exists public.payroll_hours_audit;
drop table if exists public.payroll_period_locks;
drop table if exists public.payroll_settings;

notify pgrst, 'reload schema';
commit;

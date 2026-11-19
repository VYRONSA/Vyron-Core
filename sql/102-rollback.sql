-- =====================================================================================
-- 102 rollback. WARNING: leave approval/filing break again (D08), roster publishing
-- breaks (D11) and a hard employee delete again erases attendance history (D24).
-- Drops the tables 102 created — export them first. Run only with written approval.
-- Columns added to leave_requests / hr_documents / roster_shifts are kept (they hold data).
-- =====================================================================================
begin;

drop trigger if exists trg_vyron_guard_leave_request on public.leave_requests;
drop function if exists public.vyron_guard_leave_request();

alter function public.sync_leave_request_to_balance() security invoker;
alter function public.create_leave_status_notification() security invoker;
alter function public.record_leave_decision_audit() security invoker;

alter table public.leave_requests drop constraint if exists leave_requests_status_check;
alter table public.leave_requests add constraint leave_requests_status_check
  check (status = any (array['pending','approved','declined','amended'])) not valid;
alter table public.roster_shifts drop constraint if exists roster_shifts_status_check;
alter table public.roster_shifts add constraint roster_shifts_status_check
  check (status = any (array['scheduled','changed','completed','cancelled','no_show'])) not valid;

-- Restore the 100 version of the leave update policy.
drop policy if exists leave_requests_update_v100 on public.leave_requests;
create policy leave_requests_update_v100 on public.leave_requests for update to authenticated
  using ((select public.vyron_is_platform_operator())
         or company_id in (select public.vyron_manager_company_ids())
         or (employee_id in (select m::text from public.vyron_my_employee_ids() m) and status = 'pending'))
  with check ((select public.vyron_is_platform_operator())
         or company_id in (select public.vyron_manager_company_ids())
         or (employee_id in (select m::text from public.vyron_my_employee_ids() m) and status = 'pending'));

-- Foreign keys back to ON DELETE CASCADE (pre-102 behaviour).
do $$
declare r record;
begin
  for r in
    select c.conname, c.conrelid::regclass as tbl, a.attname as col
    from pg_constraint c
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any (c.conkey)
    where c.contype = 'f' and c.confrelid = 'public.employees'::regclass and c.confdeltype = 'r'
      and c.conrelid::regclass::text in ('clock_events','roster_shifts','time_exceptions','payroll_hours',
                                         'approved_time_records','payroll_clock_checks')
  loop
    execute format('alter table %s drop constraint %I', r.tbl, r.conname);
    execute format('alter table %s add constraint %I foreign key (%I) references public.employees(id) on delete cascade',
                   r.tbl, r.conname, r.col);
  end loop;
end $$;

drop table if exists public.employee_availability_preferences;
drop table if exists public.shift_swap_requests;
drop table if exists public.roster_notifications;
drop table if exists public.roster_versions;
drop table if exists public.roster_coverage_requirements;
drop table if exists public.roster_rules;
drop table if exists public.shift_templates;
drop table if exists public.leave_planner_conflicts;
drop table if exists public.leave_forecast_snapshots;
drop table if exists public.leave_accrual_runs;
drop table if exists public.leave_public_holidays;
drop table if exists public.leave_peak_periods;
drop table if exists public.leave_blackout_periods;
drop table if exists public.leave_rules;
drop table if exists public.leave_types_config;
drop table if exists public.employee_audit_history;
drop table if exists public.employee_profiles;

notify pgrst, 'reload schema';
commit;

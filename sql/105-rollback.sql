-- 105 rollback: stops the HR change audit. WARNING: employee, roster, balance, store, access
-- and settings edits are no longer audited (D34). The audit table is dropped — export it first.
begin;
do $$
declare t text;
begin
  foreach t in array array['employees', 'roster_shifts', 'leave_balances', 'stores', 'company_users',
                           'attendance_settings', 'payroll_settings', 'employee_profiles',
                           'attendance_geofences', 'shift_templates', 'leave_public_holidays'] loop
    if to_regclass('public.' || t) is not null then
      execute format('drop trigger if exists trg_vyron_audit_hr_change on public.%I', t);
    end if;
  end loop;
end $$;
drop function if exists public.vyron_audit_hr_change();
drop table if exists public.hr_change_audit;
notify pgrst, 'reload schema';
commit;

-- 106 rollback: restores calendar-day, all-types leave balance counting (the pre-106 bug).
-- WARNING: re-opens D19 — balances become wrong again. Holiday rows already loaded are kept.
begin;
drop trigger if exists trg_vyron_set_leave_requested_days on public.leave_requests;
drop function if exists public.vyron_set_leave_requested_days();
drop function if exists public.vyron_seed_sa_public_holidays(uuid, boolean);

-- Original function (captured from the production schema copy).
CREATE OR REPLACE FUNCTION public.recalculate_leave_balance_for_employee(p_employee_id text, p_leave_type text, p_cycle_start date, p_cycle_end date)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
declare
  v_pending_days numeric := 0;
  v_taken_days numeric := 0;
begin
  -- PENDING
  select coalesce(sum((end_date - start_date + 1)), 0)
  into v_pending_days
  from public.leave_requests
  where employee_id::text = p_employee_id
  and status = 'pending';

  -- APPROVED
  select coalesce(sum((end_date - start_date + 1)), 0)
  into v_taken_days
  from public.leave_requests
  where employee_id::text = p_employee_id
  and status = 'approved';

  update public.leave_balances
  set
    pending_days = v_pending_days,
    days_taken = v_taken_days,
    updated_at = now()
  where employee_id = p_employee_id;
end;
$function$;

drop function if exists public.vyron_leave_working_days(uuid, date, date);
notify pgrst, 'reload schema';
commit;

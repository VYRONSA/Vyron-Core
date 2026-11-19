-- =====================================================================================
-- 106 — Leave counted in working days; balances per leave type and cycle; SA holidays (D19)
-- =====================================================================================
-- NOT APPLIED TO PRODUCTION. Requires separate written approval. Depends on 102, 103.
-- Idempotent. Rollback: sql/106-rollback.sql.
--
-- Before: recalculate_leave_balance_for_employee() added up EVERY leave request of the
-- employee (all types, all years) in CALENDAR days and wrote that one total into every balance
-- row — one sick day reduced annual leave too, and a weekend counted as leave. Migration 102
-- made that trigger run for real, so this must be applied with it.
-- After:
--   * a leave day is a working day: Monday–Friday (or Mon–Sat when the company works a
--     6-day week, payroll_settings.ordinary_days_per_week), excluding the company's public
--     holidays;
--   * each balance row counts only its own leave type, clipped to its own cycle;
--   * leave_requests.requested_days is set by the database (authoritative);
--   * a seed function loads the verified South African public holidays for a company.
-- Not a statutory determination: the payroll practitioner confirms the rules
-- (docs/payroll/SA-STATUTORY-REQUIREMENTS.md).
-- =====================================================================================

begin;

-- Working leave days for a company between two dates (inclusive).
create or replace function public.vyron_leave_working_days(p_company_id uuid, p_start date, p_end date)
returns numeric language sql stable security definer set search_path = public as $$
  select count(*)::numeric
  from generate_series(p_start, p_end, interval '1 day') g(d)
  where p_end >= p_start
    and extract(isodow from g.d) <= coalesce(
          (select s.ordinary_days_per_week from public.payroll_settings s where s.company_id = p_company_id), 5)
    and not exists (select 1 from public.leave_public_holidays h
                    where h.company_id = p_company_id and h.holiday_date = g.d::date);
$$;
revoke all on function public.vyron_leave_working_days(uuid, date, date) from public, anon;
grant execute on function public.vyron_leave_working_days(uuid, date, date) to authenticated, service_role;

-- Authoritative day count on every request.
create or replace function public.vyron_set_leave_requested_days()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.company_id is not null and new.start_date is not null and new.end_date is not null then
    new.requested_days := public.vyron_leave_working_days(new.company_id, new.start_date, new.end_date);
  end if;
  return new;
end $$;
revoke all on function public.vyron_set_leave_requested_days() from public, anon, authenticated;
drop trigger if exists trg_vyron_set_leave_requested_days on public.leave_requests;
create trigger trg_vyron_set_leave_requested_days
  before insert or update of start_date, end_date, company_id on public.leave_requests
  for each row execute function public.vyron_set_leave_requested_days();

-- Balances: per leave type, clipped to each balance row's own cycle, in working days.
create or replace function public.recalculate_leave_balance_for_employee(
  p_employee_id text, p_leave_type text, p_cycle_start date, p_cycle_end date)
returns void language plpgsql security definer set search_path = public as $$
declare
  b record;
  v_company uuid;
  v_pending numeric;
  v_taken numeric;
begin
  select e.company_id into v_company from public.employees e where e.id::text = p_employee_id;
  for b in
    select lb.id, lb.leave_type, lb.cycle_start, lb.cycle_end
    from public.leave_balances lb
    where lb.employee_id = p_employee_id
  loop
    select
      coalesce(sum(public.vyron_leave_working_days(coalesce(lr.company_id, v_company),
                   greatest(lr.start_date, b.cycle_start), least(lr.end_date, b.cycle_end)))
               filter (where lr.status = 'pending'), 0),
      coalesce(sum(public.vyron_leave_working_days(coalesce(lr.company_id, v_company),
                   greatest(lr.start_date, b.cycle_start), least(lr.end_date, b.cycle_end)))
               filter (where lr.status = 'approved'), 0)
      into v_pending, v_taken
    from public.leave_requests lr
    where lr.employee_id::text = p_employee_id
      and public.normalise_leave_type(lr.leave_type) = b.leave_type
      and lr.start_date <= b.cycle_end and lr.end_date >= b.cycle_start;

    update public.leave_balances
       set pending_days = v_pending, days_taken = v_taken, updated_at = now()
     where id = b.id;
  end loop;
end $$;
revoke all on function public.recalculate_leave_balance_for_employee(text, text, date, date) from public, anon, authenticated;

-- Verified South African public holidays (gov.za; 4 Nov 2026 per Presidency, s2A). Sunday
-- holidays roll to Monday (included as "observed"); Saturday holidays do not roll over.
-- 27 Dec 2027 is rule-derived but missing from gov.za's list: only loaded when explicitly asked.
create or replace function public.vyron_seed_sa_public_holidays(p_company_id uuid, p_include_unverified boolean default false)
returns integer language plpgsql security definer set search_path = public as $$
declare v_count integer;
begin
  if not ((select public.vyron_is_platform_operator()) or public.vyron_is_company_admin(p_company_id)
          or coalesce(auth.jwt() ->> 'role', '') = 'service_role' or auth.uid() is null) then
    raise exception 'Only an owner or administrator can load the public-holiday calendar.' using errcode = '42501';
  end if;
  insert into public.leave_public_holidays (company_id, holiday_date, holiday_name, region)
  select p_company_id, d::date, n, 'ZA'
  from (values
    ('2026-01-01','New Year''s Day'), ('2026-03-21','Human Rights Day'), ('2026-04-03','Good Friday'),
    ('2026-04-06','Family Day'), ('2026-04-27','Freedom Day'), ('2026-05-01','Workers'' Day'),
    ('2026-06-16','Youth Day'), ('2026-08-09','National Women''s Day'), ('2026-08-10','National Women''s Day (observed)'),
    ('2026-09-24','Heritage Day'), ('2026-11-04','Local Government Elections'), ('2026-12-16','Day of Reconciliation'),
    ('2026-12-25','Christmas Day'), ('2026-12-26','Day of Goodwill'),
    ('2027-01-01','New Year''s Day'), ('2027-03-21','Human Rights Day'), ('2027-03-22','Human Rights Day (observed)'),
    ('2027-03-26','Good Friday'), ('2027-03-29','Family Day'), ('2027-04-27','Freedom Day'), ('2027-05-01','Workers'' Day'),
    ('2027-06-16','Youth Day'), ('2027-08-09','National Women''s Day'), ('2027-09-24','Heritage Day'),
    ('2027-12-16','Day of Reconciliation'), ('2027-12-25','Christmas Day'), ('2027-12-26','Day of Goodwill')
  ) v(d, n)
  union all
  select p_company_id, date '2027-12-27', 'Day of Goodwill (observed) — unverified', 'ZA'
  where p_include_unverified
  on conflict (company_id, holiday_date, holiday_name) do nothing;
  get diagnostics v_count = row_count;
  return v_count;
end $$;
revoke all on function public.vyron_seed_sa_public_holidays(uuid, boolean) from public, anon;
grant execute on function public.vyron_seed_sa_public_holidays(uuid, boolean) to authenticated, service_role;

-- Recalculate existing requests and balances once (none in production today).
update public.leave_requests set start_date = start_date where company_id is not null;
do $$
declare r record;
begin
  for r in select distinct employee_id from public.leave_balances loop
    perform public.recalculate_leave_balance_for_employee(r.employee_id, null, null, null);
  end loop;
end $$;

notify pgrst, 'reload schema';

commit;

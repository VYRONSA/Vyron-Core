-- =====================================================================================
-- 103 — Payroll readiness (UMORA remediation, Phase 4)
-- =====================================================================================
-- NOT APPLIED TO PRODUCTION. Requires separate written approval. Depends on 100, 101, 102.
-- Idempotent. Rollback: sql/103-rollback.sql.
--
-- Payroll hours are now produced by the database, per pay period, from every clocking in the
-- period (no 1,000-row browser cap — D09), in South African time:
--   * each clock-in is paired with ITS clock-out (shift session), so overnight shifts count (D09)
--   * recorded breaks are deducted (D09)
--   * ordinary vs overtime: configurable daily and weekly limits (defaults 9 h / 45 h) (D09)
--   * Sunday, public-holiday and night (18:00–06:00) hours are REPORTED separately; no pay
--     multipliers are applied and no statutory compliance is claimed (see
--     docs/payroll/SA-STATUTORY-REQUIREMENTS.md)
--   * approved leave days and rostered absences are reported (D19)
--   * nothing is auto-approved: clean rows are 'draft' until a person approves them;
--     rows with missing clockings cannot be approved until corrected (D10)
--   * export locks the period; exported rows can never be regenerated or edited (D10)
--   * every change to payroll rows is audited
-- =====================================================================================

begin;

-- -------------------------------------------------------------------------------------
-- 1. Settings, columns, locks, audit
-- -------------------------------------------------------------------------------------
create table if not exists public.payroll_settings (
  company_id             uuid primary key references public.companies(id) on delete cascade,
  daily_ordinary_hours   numeric not null default 9  check (daily_ordinary_hours between 1 and 24),
  weekly_ordinary_hours  numeric not null default 45 check (weekly_ordinary_hours between 1 and 168),
  ordinary_days_per_week integer not null default 5  check (ordinary_days_per_week between 1 and 7),
  night_start            time    not null default '18:00',
  night_end              time    not null default '06:00',
  updated_at             timestamptz not null default now(),
  updated_by             text
);
alter table public.payroll_settings enable row level security;
drop policy if exists payroll_settings_select_v103 on public.payroll_settings;
drop policy if exists payroll_settings_write_v103 on public.payroll_settings;
create policy payroll_settings_select_v103 on public.payroll_settings for select to authenticated
  using ((select public.vyron_is_platform_operator()) or company_id in (select public.vyron_manager_company_ids()));
create policy payroll_settings_write_v103 on public.payroll_settings for all to authenticated
  using ((select public.vyron_is_platform_operator()) or company_id in (select public.vyron_admin_company_ids()))
  with check ((select public.vyron_is_platform_operator()) or company_id in (select public.vyron_admin_company_ids()));
revoke all on public.payroll_settings from anon;
grant select, insert, update on public.payroll_settings to authenticated;

alter table public.payroll_hours add column if not exists worked_hours          numeric;
alter table public.payroll_hours add column if not exists break_hours           numeric;
alter table public.payroll_hours add column if not exists sunday_hours          numeric;
alter table public.payroll_hours add column if not exists public_holiday_hours  numeric;
alter table public.payroll_hours add column if not exists night_hours           numeric;
alter table public.payroll_hours add column if not exists early_departure_minutes integer;
alter table public.payroll_hours add column if not exists absent_days           integer;
alter table public.payroll_hours add column if not exists leave_days            numeric;
alter table public.payroll_hours add column if not exists shifts_worked         integer;
alter table public.payroll_hours add column if not exists review_reasons        jsonb not null default '[]'::jsonb;
alter table public.payroll_hours add column if not exists calculation_detail    jsonb not null default '{}'::jsonb;
alter table public.payroll_hours add column if not exists calculation_version   text;
alter table public.payroll_hours add column if not exists generated_at          timestamptz;
alter table public.payroll_hours add column if not exists generated_by          text;
alter table public.payroll_hours add column if not exists approved_by           text;

create unique index if not exists payroll_hours_period_uidx
  on public.payroll_hours (company_id, employee_id, period_start, period_end);

create table if not exists public.payroll_period_locks (
  company_id      uuid not null references public.companies(id) on delete cascade,
  period_start    date not null,
  period_end      date not null,
  status          text not null default 'locked' check (status in ('locked','exported')),
  export_batch_id uuid,
  locked_at       timestamptz not null default now(),
  locked_by       text,
  primary key (company_id, period_start, period_end)
);
alter table public.payroll_period_locks enable row level security;
drop policy if exists payroll_period_locks_select_v103 on public.payroll_period_locks;
create policy payroll_period_locks_select_v103 on public.payroll_period_locks for select to authenticated
  using ((select public.vyron_is_platform_operator()) or company_id in (select public.vyron_manager_company_ids()));
revoke all on public.payroll_period_locks from anon, authenticated;
grant select on public.payroll_period_locks to authenticated;

create table if not exists public.payroll_hours_audit (
  id               uuid primary key default gen_random_uuid(),
  company_id       uuid not null,
  payroll_hours_id uuid not null,
  employee_id      uuid,
  action           text not null,
  actor_user_id    uuid,
  actor_email      text,
  reason           text,
  old_record       jsonb,
  new_record       jsonb,
  created_at       timestamptz not null default now()
);
create index if not exists payroll_hours_audit_row_idx on public.payroll_hours_audit (payroll_hours_id);
alter table public.payroll_hours_audit enable row level security;
drop policy if exists payroll_hours_audit_select_v103 on public.payroll_hours_audit;
create policy payroll_hours_audit_select_v103 on public.payroll_hours_audit for select to authenticated
  using ((select public.vyron_is_platform_operator()) or company_id in (select public.vyron_manager_company_ids()));
revoke all on public.payroll_hours_audit from anon, authenticated;
grant select on public.payroll_hours_audit to authenticated;

-- Payroll rows change only through the functions below (all audited).
drop policy if exists payroll_hours_insert_v100 on public.payroll_hours;
drop policy if exists payroll_hours_update_v100 on public.payroll_hours;
drop policy if exists payroll_hours_delete_v100 on public.payroll_hours;
revoke insert, update, delete, truncate on public.payroll_hours from authenticated, anon;

create or replace function public.vyron_payroll_roles()
returns text[] language sql immutable as $$ select array['owner','platform_admin','admin','payroll','hr_manager']; $$;

create or replace function public.vyron_is_payroll_manager(p_company_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select (select public.vyron_is_platform_operator())
      or coalesce(public.vyron_company_role(p_company_id) = any (public.vyron_payroll_roles()), false);
$$;
revoke all on function public.vyron_is_payroll_manager(uuid) from public, anon;
grant execute on function public.vyron_is_payroll_manager(uuid) to authenticated, service_role;

create or replace function public.vyron_guard_payroll_hours()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_row public.payroll_hours := case when tg_op = 'DELETE' then old else new end;
begin
  if tg_op in ('UPDATE','DELETE') and (old.status = 'exported' or old.exported_at is not null) then
    raise exception 'Exported payroll hours are locked and cannot be changed.' using errcode = '42501';
  end if;
  if tg_op in ('INSERT','UPDATE') and coalesce(current_setting('vyron.payroll_exporting', true), '') <> 'on'
     and exists (select 1 from public.payroll_period_locks l
                 where l.company_id = v_row.company_id
                   and l.period_start <= v_row.period_end and v_row.period_start <= l.period_end) then
    raise exception 'Payroll period % to % is locked.', v_row.period_start, v_row.period_end using errcode = '42501';
  end if;
  insert into public.payroll_hours_audit (company_id, payroll_hours_id, employee_id, action, actor_user_id,
                                          actor_email, reason, old_record, new_record)
  values (v_row.company_id, v_row.id, v_row.employee_id, lower(tg_op), auth.uid(), nullif(public.vyron_jwt_email(), ''),
          nullif(current_setting('vyron.payroll_reason', true), ''),
          case when tg_op = 'INSERT' then null else to_jsonb(old) end,
          case when tg_op = 'DELETE' then null else to_jsonb(new) end);
  return case when tg_op = 'DELETE' then old else new end;
end $$;
revoke all on function public.vyron_guard_payroll_hours() from public, anon, authenticated;
drop trigger if exists trg_vyron_guard_payroll_hours on public.payroll_hours;
create trigger trg_vyron_guard_payroll_hours before insert or update or delete on public.payroll_hours
  for each row execute function public.vyron_guard_payroll_hours();

-- -------------------------------------------------------------------------------------
-- 2. Helpers
-- -------------------------------------------------------------------------------------
create or replace function public.vyron_payroll_settings(p_company_id uuid)
returns public.payroll_settings language sql stable security definer set search_path = public as $$
  select coalesce(
    (select s from public.payroll_settings s where s.company_id = p_company_id),
    jsonb_populate_record(null::public.payroll_settings, jsonb_build_object(
      'company_id', p_company_id, 'daily_ordinary_hours', 9, 'weekly_ordinary_hours', 45,
      'ordinary_days_per_week', 5, 'night_start', '18:00', 'night_end', '06:00', 'updated_at', now())));
$$;
revoke all on function public.vyron_payroll_settings(uuid) from public, anon;
grant execute on function public.vyron_payroll_settings(uuid) to authenticated, service_role;

-- Minutes of [p_from, p_to) that fall inside the nightly window (SAST).
create or replace function public.vyron_night_minutes(p_from timestamptz, p_to timestamptz,
                                                     p_night_start time, p_night_end time)
returns numeric language plpgsql immutable as $$
declare
  d date;
  w_start timestamptz;
  w_end timestamptz;
  total numeric := 0;
begin
  if p_to <= p_from then return 0; end if;
  for d in select generate_series((p_from at time zone 'Africa/Johannesburg')::date - 1,
                                  (p_to at time zone 'Africa/Johannesburg')::date, interval '1 day')::date loop
    w_start := (d + p_night_start) at time zone 'Africa/Johannesburg';
    w_end := case when p_night_end <= p_night_start
                  then ((d + 1) + p_night_end) at time zone 'Africa/Johannesburg'
                  else (d + p_night_end) at time zone 'Africa/Johannesburg' end;
    total := total + greatest(0, extract(epoch from (least(p_to, w_end) - greatest(p_from, w_start))) / 60);
  end loop;
  return total;
end $$;

-- -------------------------------------------------------------------------------------
-- 3. Generate hours for a pay period
-- -------------------------------------------------------------------------------------
create or replace function public.vyron_generate_payroll_hours(p_company_id uuid, p_period_start date, p_period_end date)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_att      public.attendance_settings;
  v_pay      public.payroll_settings;
  v_emp      record;
  v_session  record;
  v_out      public.clock_events;
  v_shift    public.roster_shifts;
  v_break_minutes numeric;
  v_worked   numeric;
  v_day_minutes jsonb;
  v_day      date;
  v_week     date;
  v_week_ord jsonb;
  v_ord      numeric;
  v_ot       numeric;
  v_excess   numeric;
  v_sunday   numeric;
  v_holiday  numeric;
  v_night    numeric;
  v_breaks_total numeric;
  v_late     integer;
  v_early    integer;
  v_missing  integer;
  v_shifts   integer;
  v_absent   integer;
  v_leave    numeric;
  v_needs_review boolean;
  v_flags    integer;
  v_reasons  jsonb;
  v_detail   jsonb;
  v_existing public.payroll_hours;
  v_count_draft integer := 0;
  v_count_review integer := 0;
  v_count_locked integer := 0;
  k text;
  val numeric;
begin
  if not public.vyron_is_payroll_manager(p_company_id) then
    raise exception 'Only owners, administrators, HR and payroll users can generate payroll hours.' using errcode = '42501';
  end if;
  if p_period_end < p_period_start or p_period_end - p_period_start > 62 then
    raise exception 'A pay period must be 1 to 62 days.' using errcode = '22023';
  end if;
  if exists (select 1 from public.payroll_period_locks l
             where l.company_id = p_company_id and l.period_start <= p_period_end and p_period_start <= l.period_end) then
    raise exception 'This pay period is locked (already exported). It cannot be regenerated.' using errcode = '42501';
  end if;

  v_att := public.vyron_attendance_settings(p_company_id);
  v_pay := public.vyron_payroll_settings(p_company_id);
  perform set_config('vyron.payroll_reason', 'generated', true);

  for v_emp in
    select e.id from public.employees e
    where e.company_id = p_company_id
      and (coalesce(e.active, true) or exists (
            select 1 from public.clock_events c where c.employee_id = e.id
             and c.attendance_date between p_period_start and p_period_end))
  loop
    v_day_minutes := '{}'::jsonb; v_sunday := 0; v_holiday := 0; v_night := 0; v_breaks_total := 0;
    v_late := 0; v_early := 0; v_missing := 0; v_shifts := 0; v_flags := 0; v_reasons := '[]'::jsonb;

    for v_session in
      select ci.* from public.clock_events ci
      where ci.employee_id = v_emp.id and ci.event_type = 'clock_in'
        and ci.attendance_date between p_period_start and p_period_end
      order by ci.event_time
    loop
      select * into v_out from public.clock_events co
       where co.employee_id = v_emp.id and co.event_type = 'clock_out'
         and (co.shift_session_id = v_session.id
              or (co.shift_session_id is null and co.event_time > v_session.event_time
                  and co.event_time <= v_session.event_time + make_interval(secs => (v_att.max_shift_hours * 3600)::double precision)))
       order by co.event_time limit 1;
      if v_out.id is null then
        v_missing := v_missing + 1;
        continue;
      end if;
      v_shifts := v_shifts + 1;

      -- Recorded breaks in this session (an unclosed break ends at clock-out).
      select coalesce(sum(extract(epoch from (least(coalesce(be.event_time, v_out.event_time), v_out.event_time) - bs.event_time)) / 60), 0)
        into v_break_minutes
        from public.clock_events bs
        left join lateral (
          select b2.event_time from public.clock_events b2
           where b2.employee_id = v_emp.id and b2.event_type = 'break_end'
             and b2.event_time > bs.event_time and b2.event_time <= v_out.event_time
           order by b2.event_time limit 1) be on true
       where bs.employee_id = v_emp.id and bs.event_type = 'break_start'
         and bs.event_time > v_session.event_time and bs.event_time < v_out.event_time;

      v_worked := greatest(0, extract(epoch from (v_out.event_time - v_session.event_time)) / 60 - v_break_minutes);
      v_breaks_total := v_breaks_total + v_break_minutes;
      v_day := v_session.attendance_date;
      v_day_minutes := jsonb_set(v_day_minutes, array[v_day::text],
                                 to_jsonb(coalesce((v_day_minutes ->> v_day::text)::numeric, 0) + v_worked));
      if extract(isodow from v_day) = 7 then v_sunday := v_sunday + v_worked; end if;
      if exists (select 1 from public.leave_public_holidays h
                 where h.company_id = p_company_id and h.holiday_date = v_day) then
        v_holiday := v_holiday + v_worked;
      end if;
      v_night := v_night + public.vyron_night_minutes(v_session.event_time, v_out.event_time, v_pay.night_start, v_pay.night_end);

      if v_session.roster_shift_id is not null then
        select * into v_shift from public.roster_shifts where id = v_session.roster_shift_id;
        if v_shift.id is not null then
          if v_session.event_time > v_shift.planned_start + make_interval(mins => v_att.late_grace_minutes) then
            v_late := v_late + floor(extract(epoch from (v_session.event_time - v_shift.planned_start)) / 60);
          end if;
          if v_out.event_time < v_shift.planned_end - make_interval(mins => v_att.early_departure_grace_minutes) then
            v_early := v_early + floor(extract(epoch from (v_shift.planned_end - v_out.event_time)) / 60);
          end if;
        end if;
      end if;
      if v_session.verification_status in ('needs_review') or v_out.verification_status in ('needs_review') then
        v_flags := v_flags + 1;
      end if;
    end loop;

    -- Ordinary vs overtime: daily limit first, then the weekly limit (ISO weeks, Monday start,
    -- evaluated on the days inside this period).
    v_ord := 0; v_ot := 0; v_week_ord := '{}'::jsonb;
    for k, val in select key, value::numeric from jsonb_each_text(v_day_minutes) order by key loop
      v_week := date_trunc('week', k::date)::date;
      v_ot := v_ot + greatest(0, val - v_pay.daily_ordinary_hours * 60);
      v_week_ord := jsonb_set(v_week_ord, array[v_week::text],
        to_jsonb(coalesce((v_week_ord ->> v_week::text)::numeric, 0) + least(val, v_pay.daily_ordinary_hours * 60)));
    end loop;
    for k, val in select key, value::numeric from jsonb_each_text(v_week_ord) loop
      v_excess := greatest(0, val - v_pay.weekly_ordinary_hours * 60);
      v_ot := v_ot + v_excess;
      v_ord := v_ord + val - v_excess;
    end loop;

    -- Rostered absences (shift started, nothing clocked that day, not on approved leave).
    select count(*) into v_absent
      from public.roster_shifts rs
     where rs.employee_id = v_emp.id and rs.company_id = p_company_id
       and rs.shift_date between p_period_start and p_period_end
       and coalesce(rs.status, 'scheduled') not in ('cancelled')
       and rs.planned_start <= now()
       and not exists (select 1 from public.clock_events c where c.employee_id = v_emp.id
                        and c.event_type = 'clock_in' and c.attendance_date = rs.shift_date)
       and not exists (select 1 from public.leave_requests lr where lr.employee_id = v_emp.id::text
                        and lr.status = 'approved' and rs.shift_date between lr.start_date and lr.end_date);

    -- Approved leave: ordinary working days inside the period, excluding public holidays.
    select coalesce(count(*), 0) into v_leave
      from public.leave_requests lr
      cross join lateral generate_series(greatest(lr.start_date, p_period_start), least(lr.end_date, p_period_end), interval '1 day') g(d)
     where lr.employee_id = v_emp.id::text and lr.status = 'approved'
       and lr.start_date <= p_period_end and lr.end_date >= p_period_start
       and extract(isodow from g.d) <= v_pay.ordinary_days_per_week
       and not exists (select 1 from public.leave_public_holidays h where h.company_id = p_company_id and h.holiday_date = g.d::date);

    if v_missing > 0 then v_reasons := v_reasons || jsonb_build_array(format('%s shift(s) without a clock-out', v_missing)); end if;
    if v_absent > 0 then v_reasons := v_reasons || jsonb_build_array(format('%s rostered day(s) absent', v_absent)); end if;
    if v_ot > 0 then v_reasons := v_reasons || jsonb_build_array(format('%s h overtime to confirm', round(v_ot / 60, 2))); end if;
    if v_late > 0 then v_reasons := v_reasons || jsonb_build_array(format('%s late minute(s)', v_late)); end if;
    if v_early > 0 then v_reasons := v_reasons || jsonb_build_array(format('%s early-departure minute(s)', v_early)); end if;
    if v_flags > 0 then v_reasons := v_reasons || jsonb_build_array(format('%s clocking(s) flagged (location/offline)', v_flags)); end if;
    if v_holiday > 0 then v_reasons := v_reasons || jsonb_build_array('Public holiday hours worked'); end if;
    v_needs_review := jsonb_array_length(v_reasons) > 0;

    -- Skip employees with nothing to pay or review in the period.
    if v_shifts = 0 and v_missing = 0 and v_absent = 0 and v_leave = 0 then
      continue;
    end if;

    v_detail := jsonb_build_object('daily_minutes', v_day_minutes, 'weekly_ordinary_minutes', v_week_ord,
      'rules', jsonb_build_object('daily_ordinary_hours', v_pay.daily_ordinary_hours,
                                  'weekly_ordinary_hours', v_pay.weekly_ordinary_hours,
                                  'night', v_pay.night_start::text || '-' || v_pay.night_end::text,
                                  'late_grace_minutes', v_att.late_grace_minutes));

    select * into v_existing from public.payroll_hours
     where company_id = p_company_id and employee_id = v_emp.id
       and period_start = p_period_start and period_end = p_period_end;
    if v_existing.id is not null and (v_existing.status = 'exported' or v_existing.exported_at is not null) then
      v_count_locked := v_count_locked + 1;
      continue;
    end if;

    insert into public.payroll_hours as ph (
      company_id, employee_id, period_start, period_end, normal_hours, overtime_hours, late_minutes,
      missing_clock_events, status, approved_at, approval_note, approved_by, worked_hours, break_hours,
      sunday_hours, public_holiday_hours, night_hours, early_departure_minutes, absent_days, leave_days,
      shifts_worked, review_reasons, calculation_detail, calculation_version, generated_at, generated_by)
    values (
      p_company_id, v_emp.id, p_period_start, p_period_end, round(v_ord / 60, 2), round(v_ot / 60, 2), v_late,
      v_missing, case when v_needs_review then 'needs_review' else 'draft' end, null,
      case when v_needs_review then 'Needs review: ' || (select string_agg(r, '; ') from jsonb_array_elements_text(v_reasons) r)
           else 'Calculated — awaiting approval' end, null,
      round((v_ord + v_ot) / 60, 2), round(v_breaks_total / 60, 2), round(v_sunday / 60, 2), round(v_holiday / 60, 2),
      round(v_night / 60, 2), v_early, v_absent, v_leave, v_shifts, v_reasons, v_detail, '103.1', now(),
      nullif(public.vyron_jwt_email(), ''))
    on conflict (company_id, employee_id, period_start, period_end) do update set
      normal_hours = excluded.normal_hours, overtime_hours = excluded.overtime_hours,
      late_minutes = excluded.late_minutes, missing_clock_events = excluded.missing_clock_events,
      status = excluded.status, approved_at = null, approved_by = null, approval_note = excluded.approval_note,
      worked_hours = excluded.worked_hours, break_hours = excluded.break_hours, sunday_hours = excluded.sunday_hours,
      public_holiday_hours = excluded.public_holiday_hours, night_hours = excluded.night_hours,
      early_departure_minutes = excluded.early_departure_minutes, absent_days = excluded.absent_days,
      leave_days = excluded.leave_days, shifts_worked = excluded.shifts_worked, review_reasons = excluded.review_reasons,
      calculation_detail = excluded.calculation_detail, calculation_version = excluded.calculation_version,
      generated_at = excluded.generated_at, generated_by = excluded.generated_by;

    if v_needs_review then v_count_review := v_count_review + 1; else v_count_draft := v_count_draft + 1; end if;
  end loop;

  return jsonb_build_object('ok', true, 'period_start', p_period_start, 'period_end', p_period_end,
                            'awaiting_approval', v_count_draft, 'needs_review', v_count_review,
                            'already_exported', v_count_locked);
end $$;
revoke all on function public.vyron_generate_payroll_hours(uuid, date, date) from public, anon;
grant execute on function public.vyron_generate_payroll_hours(uuid, date, date) to authenticated, service_role;

-- -------------------------------------------------------------------------------------
-- 4. Approve / send back (a person decides; missing clockings must be fixed first)
-- -------------------------------------------------------------------------------------
create or replace function public.vyron_set_payroll_hours_status(
  p_company_id uuid, p_ids uuid[], p_status text, p_note text default null, p_only_clean boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_row public.payroll_hours;
  v_done integer := 0;
  v_skipped jsonb := '[]'::jsonb;
  v_actor text := nullif(public.vyron_jwt_email(), '');
begin
  if not public.vyron_is_payroll_manager(p_company_id) then
    raise exception 'Only owners, administrators, HR and payroll users can approve payroll hours.' using errcode = '42501';
  end if;
  if p_status not in ('approved','needs_review') then
    raise exception 'Status must be approved or needs_review.' using errcode = '22023';
  end if;
  perform set_config('vyron.payroll_reason', coalesce(p_status || ': ' || p_note, p_status), true);
  for v_row in select * from public.payroll_hours where company_id = p_company_id and id = any (p_ids) loop
    if v_row.status = 'exported' or v_row.exported_at is not null then
      v_skipped := v_skipped || jsonb_build_object('id', v_row.id, 'reason', 'already exported');
      continue;
    end if;
    if p_status = 'approved' then
      if coalesce(v_row.missing_clock_events, 0) > 0 then
        v_skipped := v_skipped || jsonb_build_object('id', v_row.id, 'reason', 'missing clock-outs must be corrected first');
        continue;
      end if;
      if p_only_clean and v_row.status <> 'draft' then
        v_skipped := v_skipped || jsonb_build_object('id', v_row.id, 'reason', 'needs individual review');
        continue;
      end if;
      if v_row.status = 'needs_review' and coalesce(btrim(p_note), '') = '' then
        v_skipped := v_skipped || jsonb_build_object('id', v_row.id, 'reason', 'a review note is required');
        continue;
      end if;
      update public.payroll_hours set status = 'approved', approved_at = now(), approved_by = v_actor,
             approval_note = coalesce(nullif(btrim(p_note), ''), 'Approved')
       where id = v_row.id;
    else
      update public.payroll_hours set status = 'needs_review', approved_at = null, approved_by = null,
             approval_note = coalesce(nullif(btrim(p_note), ''), 'Sent back for review')
       where id = v_row.id;
    end if;
    v_done := v_done + 1;
  end loop;
  return jsonb_build_object('ok', true, 'updated', v_done, 'skipped', v_skipped);
end $$;
revoke all on function public.vyron_set_payroll_hours_status(uuid, uuid[], text, text, boolean) from public, anon;
grant execute on function public.vyron_set_payroll_hours_status(uuid, uuid[], text, text, boolean) to authenticated, service_role;

-- -------------------------------------------------------------------------------------
-- 5. Export (once per period; locks it) and re-download of an exported batch
-- -------------------------------------------------------------------------------------
create or replace function public.vyron_payroll_export_rows(p_batch_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_company uuid;
begin
  select company_id into v_company from public.payroll_hours where export_batch_id = p_batch_id limit 1;
  if v_company is null then raise exception 'Export batch not found.' using errcode = 'P0002'; end if;
  if not public.vyron_is_payroll_manager(v_company) then
    raise exception 'Not permitted.' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'employee_id', ph.employee_id, 'employee_number', e.employee_number,
      'employee_name', btrim(coalesce(e.first_name, '') || ' ' || coalesce(e.last_name, '')),
      'period_start', ph.period_start, 'period_end', ph.period_end,
      'ordinary_hours', ph.normal_hours, 'overtime_hours', ph.overtime_hours, 'worked_hours', ph.worked_hours,
      'sunday_hours', ph.sunday_hours, 'public_holiday_hours', ph.public_holiday_hours, 'night_hours', ph.night_hours,
      'break_hours', ph.break_hours, 'late_minutes', ph.late_minutes, 'early_departure_minutes', ph.early_departure_minutes,
      'absent_days', ph.absent_days, 'leave_days', ph.leave_days, 'shifts_worked', ph.shifts_worked,
      'approved_by', ph.approved_by, 'approved_at', ph.approved_at, 'approval_note', ph.approval_note,
      'export_batch_id', ph.export_batch_id) order by e.employee_number, e.last_name)
    from public.payroll_hours ph join public.employees e on e.id = ph.employee_id
    where ph.export_batch_id = p_batch_id), '[]'::jsonb);
end $$;
revoke all on function public.vyron_payroll_export_rows(uuid) from public, anon;
grant execute on function public.vyron_payroll_export_rows(uuid) to authenticated, service_role;

create or replace function public.vyron_export_payroll_period(
  p_company_id uuid, p_period_start date, p_period_end date, p_payroll_system text default 'csv')
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_batch uuid := gen_random_uuid();
  v_total integer;
  v_not_approved integer;
  v_actor text := nullif(public.vyron_jwt_email(), '');
begin
  if not public.vyron_is_payroll_manager(p_company_id) then
    raise exception 'Only owners, administrators, HR and payroll users can export payroll.' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('vyron_payroll_export:' || p_company_id::text, 0));
  if exists (select 1 from public.payroll_period_locks l where l.company_id = p_company_id
               and l.period_start = p_period_start and l.period_end = p_period_end) then
    raise exception 'This pay period has already been exported. Re-download the existing export instead.' using errcode = '42501';
  end if;
  select count(*), count(*) filter (where status <> 'approved') into v_total, v_not_approved
    from public.payroll_hours
   where company_id = p_company_id and period_start = p_period_start and period_end = p_period_end;
  if v_total = 0 then
    raise exception 'There are no payroll hours for this period. Generate hours first.' using errcode = '22023';
  end if;
  if v_not_approved > 0 then
    raise exception '% payroll row(s) are not approved yet.', v_not_approved using errcode = '22023';
  end if;

  perform set_config('vyron.payroll_reason', 'exported:' || v_batch, true);
  perform set_config('vyron.payroll_exporting', 'on', true);
  update public.payroll_hours set status = 'exported', exported_at = now(), export_batch_id = v_batch
   where company_id = p_company_id and period_start = p_period_start and period_end = p_period_end;
  insert into public.payroll_period_locks (company_id, period_start, period_end, status, export_batch_id, locked_by)
  values (p_company_id, p_period_start, p_period_end, 'exported', v_batch, v_actor);
  insert into public.payroll_batches (id, company_id, batch_name, period_start, period_end, payroll_system, status,
                                      exported_at, exported_by, is_locked)
  values (v_batch, p_company_id, format('Payroll %s to %s', p_period_start, p_period_end), p_period_start, p_period_end,
          left(coalesce(p_payroll_system, 'csv'), 40), 'exported', now(), auth.uid(), true);
  insert into public.payroll_export_logs (id, company_id, export_name, export_status, employee_count, exported_at)
  values (v_batch, p_company_id, format('Payroll %s to %s (%s)', p_period_start, p_period_end, coalesce(p_payroll_system, 'csv')),
          'exported', v_total, now());
  perform set_config('vyron.payroll_exporting', 'off', true);

  return jsonb_build_object('ok', true, 'export_batch_id', v_batch, 'rows', public.vyron_payroll_export_rows(v_batch));
end $$;
revoke all on function public.vyron_export_payroll_period(uuid, date, date, text) from public, anon;
grant execute on function public.vyron_export_payroll_period(uuid, date, date, text) to authenticated, service_role;

notify pgrst, 'reload schema';

commit;

-- =====================================================================================
-- 101 — Clocking and attendance integrity (UMORA remediation, Phase 2)
-- =====================================================================================
-- NOT APPLIED TO PRODUCTION. Requires separate written approval. Depends on 100.
-- Idempotent. Rollback: sql/101-rollback.sql.
--
-- Every clock event is now written by a server function, never by the browser:
--   * server time (now()), never the device clock (D26) — offline events are the one
--     bounded, flagged exception
--   * one client_event_id per tap: a retry returns the original event (idempotent, D04)
--   * a per-employee advisory lock serialises concurrent taps (D04)
--   * state comes from the employee's last open shift, not "today" (overnight, D01)
--   * shifts open longer than the company maximum are closed as missed clock-outs and
--     raise exceptions (D13)
--   * PIN verified server-side with lockout for kiosk clocking (D03, D25)
--   * GPS compared with the store/geofence radius: flag or block (D12)
--   * roster shift + attendance date assigned at clock-in; clock-out inherits them
--   * every insert/update/delete of a clock event is audited with actor and reason (D02, D34)
--   * corrections keep the original time and are reviewed by a different person
-- =====================================================================================

begin;

-- -------------------------------------------------------------------------------------
-- 1. Per-company attendance settings
-- -------------------------------------------------------------------------------------
create table if not exists public.attendance_settings (
  company_id                    uuid primary key references public.companies(id) on delete cascade,
  timezone                      text    not null default 'Africa/Johannesburg',
  geofence_mode                 text    not null default 'flag' check (geofence_mode in ('off','flag','block')),
  geofence_accuracy_allowance_m integer not null default 50 check (geofence_accuracy_allowance_m between 0 and 1000),
  require_gps                   boolean not null default true,
  require_photo                 boolean not null default false,
  max_shift_hours               numeric not null default 16 check (max_shift_hours between 4 and 36),
  min_seconds_between_events    integer not null default 60 check (min_seconds_between_events between 0 and 3600),
  roster_match_window_minutes   integer not null default 120 check (roster_match_window_minutes between 0 and 720),
  late_grace_minutes            integer not null default 5 check (late_grace_minutes between 0 and 120),
  early_departure_grace_minutes integer not null default 5 check (early_departure_grace_minutes between 0 and 120),
  offline_max_age_hours         integer not null default 24 check (offline_max_age_hours between 1 and 168),
  updated_at                    timestamptz not null default now(),
  updated_by                    text
);
alter table public.attendance_settings enable row level security;
drop policy if exists attendance_settings_select_v101 on public.attendance_settings;
drop policy if exists attendance_settings_write_v101 on public.attendance_settings;
create policy attendance_settings_select_v101 on public.attendance_settings for select to authenticated
  using ((select public.vyron_is_platform_operator()) or company_id in (select public.vyron_user_company_ids()));
create policy attendance_settings_write_v101 on public.attendance_settings for all to authenticated
  using ((select public.vyron_is_platform_operator()) or company_id in (select public.vyron_admin_company_ids()))
  with check ((select public.vyron_is_platform_operator()) or company_id in (select public.vyron_admin_company_ids()));
grant select, insert, update on public.attendance_settings to authenticated;

create or replace function public.vyron_attendance_settings(p_company_id uuid)
returns public.attendance_settings language sql stable security definer set search_path = public as $$
  select coalesce(
    (select s from public.attendance_settings s where s.company_id = p_company_id),
    row(p_company_id, 'Africa/Johannesburg', 'flag', 50, true, false, 16, 60, 120, 5, 5, 24, now(), null)::public.attendance_settings
  );
$$;
revoke all on function public.vyron_attendance_settings(uuid) from public, anon;
grant execute on function public.vyron_attendance_settings(uuid) to authenticated, service_role;

-- -------------------------------------------------------------------------------------
-- 2. clock_events: idempotency, shift session, attendance date, correction trail
-- -------------------------------------------------------------------------------------
alter table public.clock_events add column if not exists client_event_id     uuid;
alter table public.clock_events add column if not exists shift_session_id    uuid;
alter table public.clock_events add column if not exists attendance_date     date;
alter table public.clock_events add column if not exists recorded_by         uuid;
alter table public.clock_events add column if not exists recorded_by_email   text;
alter table public.clock_events add column if not exists original_event_time timestamptz;
alter table public.clock_events add column if not exists corrected_at        timestamptz;
alter table public.clock_events add column if not exists correction_id       uuid;

create unique index if not exists clock_events_client_event_id_uidx
  on public.clock_events (client_event_id) where client_event_id is not null;
create index if not exists clock_events_company_time_idx on public.clock_events (company_id, event_time desc);
create index if not exists clock_events_session_idx on public.clock_events (shift_session_id);
create index if not exists clock_events_company_date_idx on public.clock_events (company_id, attendance_date);

-- Backfill: every existing clock-in starts its own session; later events attach to the
-- latest earlier clock-in of the same employee (within 36 h). Attendance date = SAST date
-- of the session's clock-in. Only fills NULLs; recorded times are never changed.
update public.clock_events ce
   set shift_session_id = ce.id
 where ce.event_type = 'clock_in' and ce.shift_session_id is null;
update public.clock_events ce
   set shift_session_id = (
     select ci.id from public.clock_events ci
     where ci.employee_id = ce.employee_id and ci.event_type = 'clock_in'
       and ci.event_time <= ce.event_time and ci.event_time > ce.event_time - interval '36 hours'
     order by ci.event_time desc limit 1)
 where ce.event_type <> 'clock_in' and ce.shift_session_id is null;
update public.clock_events ce
   set attendance_date = (
     select (ci.event_time at time zone 'Africa/Johannesburg')::date
     from public.clock_events ci where ci.id = ce.shift_session_id)
 where ce.attendance_date is null and ce.shift_session_id is not null;
update public.clock_events ce
   set attendance_date = (ce.event_time at time zone 'Africa/Johannesburg')::date
 where ce.attendance_date is null;

-- -------------------------------------------------------------------------------------
-- 3. Clock audit trail (every change, with actor and reason)
-- -------------------------------------------------------------------------------------
create table if not exists public.clock_event_audit (
  id             uuid primary key default gen_random_uuid(),
  company_id     uuid not null,
  clock_event_id uuid not null,
  employee_id    uuid,
  action         text not null check (action in ('insert','update','delete')),
  actor_user_id  uuid,
  actor_email    text,
  actor_role     text,
  reason         text,
  old_record     jsonb,
  new_record     jsonb,
  created_at     timestamptz not null default now()
);
create index if not exists clock_event_audit_event_idx on public.clock_event_audit (clock_event_id);
create index if not exists clock_event_audit_company_idx on public.clock_event_audit (company_id, created_at desc);
alter table public.clock_event_audit enable row level security;
drop policy if exists clock_event_audit_select_v101 on public.clock_event_audit;
create policy clock_event_audit_select_v101 on public.clock_event_audit for select to authenticated
  using ((select public.vyron_is_platform_operator()) or company_id in (select public.vyron_manager_company_ids()));
revoke all on public.clock_event_audit from anon, authenticated;
grant select on public.clock_event_audit to authenticated;

create or replace function public.vyron_audit_clock_event()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_row public.clock_events := case when tg_op = 'DELETE' then old else new end;
begin
  insert into public.clock_event_audit
    (company_id, clock_event_id, employee_id, action, actor_user_id, actor_email, actor_role,
     reason, old_record, new_record)
  values
    (v_row.company_id, v_row.id, v_row.employee_id, lower(tg_op), auth.uid(),
     nullif(public.vyron_jwt_email(), ''), coalesce(auth.jwt() ->> 'role', current_user),
     nullif(current_setting('vyron.clock_reason', true), ''),
     case when tg_op = 'INSERT' then null else to_jsonb(old) end,
     case when tg_op = 'DELETE' then null else to_jsonb(new) end);
  return null;
end $$;
revoke all on function public.vyron_audit_clock_event() from public, anon, authenticated;
drop trigger if exists trg_vyron_audit_clock_event on public.clock_events;
create trigger trg_vyron_audit_clock_event
  after insert or update or delete on public.clock_events
  for each row execute function public.vyron_audit_clock_event();

-- No browser session writes clock events directly any more.
drop policy if exists clock_events_insert_v100 on public.clock_events;
drop policy if exists clock_events_update_v100 on public.clock_events;
drop policy if exists clock_events_delete_v100 on public.clock_events;
revoke insert, update, delete, truncate on public.clock_events from authenticated, anon;

-- -------------------------------------------------------------------------------------
-- 4. Attendance tables the manager panel uses (hardened versions of 044)
-- -------------------------------------------------------------------------------------
create table if not exists public.attendance_geofences (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  geofence_type text not null default 'store',
  store_id uuid references public.stores(id) on delete cascade,
  job_id uuid,
  geofence_name text not null,
  latitude numeric not null,
  longitude numeric not null,
  radius_meters integer not null default 150 check (radius_meters between 10 and 50000),
  status text not null default 'active',
  created_at timestamptz not null default now()
);
create index if not exists attendance_geofences_company_id_idx on public.attendance_geofences (company_id);
create index if not exists attendance_geofences_store_id_idx on public.attendance_geofences (store_id);

create table if not exists public.attendance_corrections (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  employee_id uuid not null references public.employees(id) on delete cascade,
  clock_event_id uuid references public.clock_events(id) on delete set null,
  correction_type text not null,
  requested_event_time timestamptz,
  requested_store_id uuid,
  reason text not null,
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  requested_by text,
  reviewed_by text,
  reviewed_at timestamptz,
  review_notes text,
  original_record jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
alter table public.attendance_corrections add column if not exists requested_by text;
create index if not exists attendance_corrections_company_id_idx on public.attendance_corrections (company_id);
create index if not exists attendance_corrections_employee_id_idx on public.attendance_corrections (employee_id);
create index if not exists attendance_corrections_status_idx on public.attendance_corrections (status);

create table if not exists public.attendance_correction_audit (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  correction_id uuid not null,
  action text not null,
  action_by text,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists attendance_correction_audit_company_id_idx on public.attendance_correction_audit (company_id);
create index if not exists attendance_correction_audit_correction_id_idx on public.attendance_correction_audit (correction_id);

create table if not exists public.attendance_review_notes (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  employee_id uuid,
  note_scope text not null default 'daily',
  note_date date not null,
  note_body text not null,
  created_by text,
  created_at timestamptz not null default now()
);
create index if not exists attendance_review_notes_company_id_idx on public.attendance_review_notes (company_id);
create index if not exists attendance_review_notes_note_date_idx on public.attendance_review_notes (note_date);

create table if not exists public.attendance_device_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  provider text not null,
  external_event_id text,
  raw_payload jsonb not null default '{}'::jsonb,
  normalized_payload jsonb not null default '{}'::jsonb,
  ingestion_status text not null default 'received',
  ingested_at timestamptz not null default now()
);
create index if not exists attendance_device_events_company_id_idx on public.attendance_device_events (company_id);
create unique index if not exists attendance_device_events_external_uidx
  on public.attendance_device_events (company_id, provider, external_event_id) where external_event_id is not null;

create table if not exists public.attendance_pin_failures (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  employee_id uuid,
  failure_reason text not null,
  source text not null default 'kiosk',
  created_at timestamptz not null default now()
);
create index if not exists attendance_pin_failures_company_id_idx on public.attendance_pin_failures (company_id);
create index if not exists attendance_pin_failures_employee_id_idx on public.attendance_pin_failures (employee_id);

do $$
declare t text;
begin
  foreach t in array array['attendance_geofences','attendance_corrections','attendance_correction_audit',
                           'attendance_review_notes','attendance_device_events','attendance_pin_failures'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('drop policy if exists %I on public.%I', t || '_select_v101', t);
    execute format('drop policy if exists %I on public.%I', t || '_write_v101', t);
    execute format('drop policy if exists %I on public.%I', t || '_insert_v101', t);
  end loop;
end $$;

-- Geofences: members read, managers write.
create policy attendance_geofences_select_v101 on public.attendance_geofences for select to authenticated
  using ((select public.vyron_is_platform_operator()) or company_id in (select public.vyron_user_company_ids()));
create policy attendance_geofences_write_v101 on public.attendance_geofences for all to authenticated
  using ((select public.vyron_is_platform_operator()) or company_id in (select public.vyron_manager_company_ids()))
  with check ((select public.vyron_is_platform_operator()) or company_id in (select public.vyron_manager_company_ids()));
grant select, insert, update, delete on public.attendance_geofences to authenticated;

-- Corrections: managers see all; an employee sees and requests their own. Decisions are
-- made only through vyron_review_attendance_correction (no UPDATE grant).
create policy attendance_corrections_select_v101 on public.attendance_corrections for select to authenticated
  using ((select public.vyron_is_platform_operator())
         or company_id in (select public.vyron_manager_company_ids())
         or employee_id in (select public.vyron_my_employee_ids()));
create policy attendance_corrections_insert_v101 on public.attendance_corrections for insert to authenticated
  with check (status = 'pending' and reviewed_by is null and reviewed_at is null
              and ((select public.vyron_is_platform_operator())
                   or company_id in (select public.vyron_manager_company_ids())
                   or (company_id in (select public.vyron_user_company_ids())
                       and employee_id in (select public.vyron_my_employee_ids()))));
revoke update, delete on public.attendance_corrections from authenticated;
grant select, insert on public.attendance_corrections to authenticated;

-- Correction audit: managers read; rows written by the review function (and the panel's
-- own request log, manager-only).
create policy attendance_correction_audit_select_v101 on public.attendance_correction_audit for select to authenticated
  using ((select public.vyron_is_platform_operator()) or company_id in (select public.vyron_manager_company_ids()));
create policy attendance_correction_audit_insert_v101 on public.attendance_correction_audit for insert to authenticated
  with check ((select public.vyron_is_platform_operator()) or company_id in (select public.vyron_manager_company_ids()));
revoke update, delete on public.attendance_correction_audit from authenticated;
grant select, insert on public.attendance_correction_audit to authenticated;

-- Review notes, device events, PIN failures: managers only.
create policy attendance_review_notes_write_v101 on public.attendance_review_notes for all to authenticated
  using ((select public.vyron_is_platform_operator()) or company_id in (select public.vyron_manager_company_ids()))
  with check ((select public.vyron_is_platform_operator()) or company_id in (select public.vyron_manager_company_ids()));
grant select, insert, update, delete on public.attendance_review_notes to authenticated;
create policy attendance_device_events_write_v101 on public.attendance_device_events for all to authenticated
  using ((select public.vyron_is_platform_operator()) or company_id in (select public.vyron_manager_company_ids()))
  with check ((select public.vyron_is_platform_operator()) or company_id in (select public.vyron_manager_company_ids()));
grant select, insert on public.attendance_device_events to authenticated;
create policy attendance_pin_failures_select_v101 on public.attendance_pin_failures for select to authenticated
  using ((select public.vyron_is_platform_operator()) or company_id in (select public.vyron_manager_company_ids()));
revoke insert, update, delete on public.attendance_pin_failures from authenticated;
grant select on public.attendance_pin_failures to authenticated;

-- -------------------------------------------------------------------------------------
-- 5. Helpers
-- -------------------------------------------------------------------------------------
create or replace function public.vyron_distance_meters(lat1 numeric, lon1 numeric, lat2 numeric, lon2 numeric)
returns numeric language sql immutable as $$
  select (2 * 6371000 * asin(sqrt(
            power(sin(radians((lat2 - lat1) / 2)), 2)
          + cos(radians(lat1)) * cos(radians(lat2)) * power(sin(radians((lon2 - lon1) / 2)), 2))))::numeric;
$$;

-- Raise (or keep) one exception per subject: exception_key is unique.
create or replace function public.vyron_raise_time_exception(
  p_key text, p_company_id uuid, p_employee_id uuid, p_store_id uuid, p_roster_shift_id uuid,
  p_type text, p_severity text, p_description text)
returns void language plpgsql security definer set search_path = public as $$
begin
  insert into public.time_exceptions
    (company_id, employee_id, store_id, roster_shift_id, exception_type, severity, status,
     description, source, exception_key)
  values
    (p_company_id, p_employee_id, p_store_id, p_roster_shift_id, p_type, p_severity, 'open',
     p_description, 'clocking', p_key)
  on conflict (exception_key) do nothing;
end $$;
revoke all on function public.vyron_raise_time_exception(text, uuid, uuid, uuid, uuid, text, text, text) from public, anon, authenticated;

-- Close a stale open shift: no clock-out within max_shift_hours -> missed clock-out exception.
create or replace function public.vyron_flag_missed_clock_out(p_clock_in public.clock_events)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public.vyron_raise_time_exception(
    'missing_clock_out:' || p_clock_in.id, p_clock_in.company_id, p_clock_in.employee_id,
    p_clock_in.store_id, p_clock_in.roster_shift_id, 'missing_clock_out', 'high',
    format('No clock-out recorded for the shift that started %s. A manager must confirm the end time.',
           to_char(p_clock_in.event_time at time zone 'Africa/Johannesburg', 'YYYY-MM-DD HH24:MI')));
end $$;
revoke all on function public.vyron_flag_missed_clock_out(public.clock_events) from public, anon, authenticated;

-- Current state of an employee: open shift (across midnight), break, stale shift.
create or replace function public.vyron_employee_clock_state_internal(p_employee_id uuid, p_at timestamptz default now())
-- VOLATILE on purpose: a STABLE function reuses the snapshot taken before the per-employee
-- lock in vyron_record_clock_event, so concurrent taps could read stale state.
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  v_emp      public.employees;
  v_settings public.attendance_settings;
  v_last     public.clock_events;
  v_session  public.clock_events;
  v_open     boolean := false;
  v_on_break boolean := false;
  v_stale    boolean := false;
begin
  select * into v_emp from public.employees where id = p_employee_id;
  v_settings := public.vyron_attendance_settings(v_emp.company_id);
  select * into v_last from public.clock_events
   where employee_id = p_employee_id and event_time <= p_at
   order by event_time desc, created_at desc limit 1;
  if v_last.id is not null and v_last.event_type <> 'clock_out' then
    select * into v_session from public.clock_events
     where id = coalesce(v_last.shift_session_id, v_last.id);
    if v_session.id is null or v_session.event_type <> 'clock_in' then
      select * into v_session from public.clock_events
       where employee_id = p_employee_id and event_type = 'clock_in' and event_time <= v_last.event_time
       order by event_time desc limit 1;
    end if;
    if v_session.id is not null then
      if p_at - v_session.event_time > make_interval(secs => (v_settings.max_shift_hours * 3600)::double precision) then
        v_stale := true;
      else
        v_open := true;
        v_on_break := v_last.event_type = 'break_start';
      end if;
    end if;
  end if;
  return jsonb_build_object(
    'employee_id', p_employee_id,
    'open_shift', v_open,
    'on_break', v_on_break,
    'stale_open_shift', v_stale,
    'session_id', case when v_open or v_stale then v_session.id end,
    'session_started_at', case when v_open or v_stale then v_session.event_time end,
    'attendance_date', case when v_open then v_session.attendance_date end,
    'last_event_type', v_last.event_type,
    'last_event_time', v_last.event_time,
    'next_action', case when v_open then 'clock_out' else 'clock_in' end,
    'max_shift_hours', v_settings.max_shift_hours);
end $$;
revoke all on function public.vyron_employee_clock_state_internal(uuid, timestamptz) from public, anon, authenticated;

create or replace function public.vyron_employee_clock_state(p_employee_id uuid)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare v_company uuid;
begin
  select company_id into v_company from public.employees where id = p_employee_id;
  if v_company is null then
    raise exception 'Employee not found.' using errcode = 'P0002';
  end if;
  if not (public.vyron_is_clock_operator(v_company) or p_employee_id in (select public.vyron_my_employee_ids())) then
    raise exception 'Not permitted for this employee.' using errcode = '42501';
  end if;
  return public.vyron_employee_clock_state_internal(p_employee_id, now());
end $$;
revoke all on function public.vyron_employee_clock_state(uuid) from public, anon;
grant execute on function public.vyron_employee_clock_state(uuid) to authenticated, service_role;

-- -------------------------------------------------------------------------------------
-- 6. The clocking transaction
-- -------------------------------------------------------------------------------------
-- p_action: 'clock_in' | 'clock_out' | 'break_start' | 'break_end' | null (= next action)
-- p_source: 'kiosk' (operated by a manager/site login; PIN required) | 'self' (the employee
--           on their own login) | 'offline' (queued earlier; p_client_time honoured within
--           offline_max_age_hours, flagged for review)
-- Returns {ok, duplicate, event, warnings[]} or {ok:false, code, message}.
create or replace function public.vyron_record_clock_event(
  p_employee_id     uuid,
  p_client_event_id uuid,
  p_action          text    default null,
  p_store_id        uuid    default null,
  p_latitude        numeric default null,
  p_longitude       numeric default null,
  p_accuracy        numeric default null,
  p_pin             text    default null,
  p_source          text    default 'kiosk',
  p_photo_bucket    text    default null,
  p_photo_path      text    default null,
  p_device_info     text    default null,
  p_client_time     timestamptz default null,
  p_note            text    default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_emp         public.employees;
  v_settings    public.attendance_settings;
  v_existing    public.clock_events;
  v_state       jsonb;
  v_action      text;
  v_now         timestamptz;
  v_event_time  timestamptz;
  v_is_manager  boolean;
  v_is_self     boolean;
  v_pin         jsonb;
  v_store       public.stores;
  v_fence_lat   numeric;
  v_fence_lon   numeric;
  v_fence_rad   numeric;
  v_distance    numeric;
  v_gps_status  text := 'not_checked';
  v_shift       public.roster_shifts;
  v_session     public.clock_events;
  v_att_date    date;
  v_event       public.clock_events;
  v_warnings    text[] := array[]::text[];
  v_verification text := 'verified';
  v_last_time   timestamptz;
begin
  if p_client_event_id is null then
    return jsonb_build_object('ok', false, 'code', 'client_event_id_required',
      'message', 'A unique attempt id is required so that retries cannot create duplicates.');
  end if;
  if p_source not in ('kiosk','self','offline') then
    return jsonb_build_object('ok', false, 'code', 'invalid_source', 'message', 'Unknown clocking source.');
  end if;

  select * into v_emp from public.employees where id = p_employee_id;
  if v_emp.id is null then
    return jsonb_build_object('ok', false, 'code', 'employee_not_found', 'message', 'Employee not found.');
  end if;

  -- "Operator": a manager or a kiosk device login of the employee's company (PIN required).
  v_is_manager := public.vyron_is_clock_operator(v_emp.company_id);
  v_is_self    := p_employee_id in (select public.vyron_my_employee_ids());
  if not (v_is_manager or v_is_self) then
    raise exception 'Not permitted to clock for this employee.' using errcode = '42501';
  end if;

  -- Idempotency (fast path): a retried attempt returns the original event.
  select * into v_existing from public.clock_events where client_event_id = p_client_event_id;
  if v_existing.id is not null then
    if v_existing.employee_id <> p_employee_id then
      return jsonb_build_object('ok', false, 'code', 'client_event_id_conflict',
        'message', 'This attempt id belongs to a different employee.');
    end if;
    return jsonb_build_object('ok', true, 'duplicate', true, 'event', to_jsonb(v_existing),
                              'warnings', to_jsonb(array['Already recorded — this was a retry of the same tap.']));
  end if;

  -- One clocking at a time per employee (two kiosks, double taps, retries).
  perform pg_advisory_xact_lock(hashtextextended('vyron_clock:' || p_employee_id::text, 0));
  select * into v_existing from public.clock_events where client_event_id = p_client_event_id;
  if v_existing.id is not null then
    return jsonb_build_object('ok', true, 'duplicate', true, 'event', to_jsonb(v_existing),
                              'warnings', to_jsonb(array['Already recorded — this was a retry of the same tap.']));
  end if;

  -- Server time taken AFTER the per-employee lock: now() is the transaction start, which can be
  -- earlier than a tap that committed while this one waited, hiding it from the state check.
  v_now := clock_timestamp();

  if v_emp.active is false or coalesce(v_emp.record_status, 'active') <> 'active' then
    return jsonb_build_object('ok', false, 'code', 'employee_inactive', 'message', 'This employee is not active.');
  end if;

  -- Identity: kiosk clocking is operated by a site/manager login, so the employee proves
  -- who they are with their PIN. Self clocking is the employee's own login.
  if p_source = 'kiosk' or (p_source = 'offline' and not v_is_self) then
    if not v_is_manager then
      raise exception 'Kiosk clocking requires a manager or kiosk login.' using errcode = '42501';
    end if;
    v_pin := public.vyron_verify_employee_pin(p_employee_id, p_pin);
    if not coalesce((v_pin ->> 'ok')::boolean, false) then
      return jsonb_build_object('ok', false, 'code', 'pin_' || coalesce(v_pin ->> 'reason', 'failed'),
        'message', 'PIN not accepted.', 'pin', v_pin);
    end if;
  elsif p_source = 'self' and not v_is_self then
    raise exception 'Self clocking is only for your own record.' using errcode = '42501';
  end if;

  v_settings := public.vyron_attendance_settings(v_emp.company_id);

  -- Event time: always the server clock, except a bounded, flagged offline submission.
  v_event_time := v_now;
  if p_source = 'offline' then
    if p_client_time is null then
      return jsonb_build_object('ok', false, 'code', 'client_time_required', 'message', 'Offline clockings must include when they happened.');
    end if;
    if p_client_time > v_now + interval '2 minutes'
       or p_client_time < v_now - make_interval(hours => v_settings.offline_max_age_hours) then
      return jsonb_build_object('ok', false, 'code', 'client_time_out_of_range',
        'message', format('Offline clockings must be submitted within %s hours and cannot be in the future.', v_settings.offline_max_age_hours));
    end if;
    select max(event_time) into v_last_time from public.clock_events where employee_id = p_employee_id;
    if v_last_time is not null and p_client_time <= v_last_time then
      return jsonb_build_object('ok', false, 'code', 'offline_out_of_order',
        'message', 'A later clocking already exists for this employee. A manager must correct this one.');
    end if;
    v_event_time := least(p_client_time, v_now);
    v_verification := 'needs_review';
    v_warnings := array_append(v_warnings, 'Offline clocking: the device time was used and is flagged for manager review.');
  end if;

  -- State from the last open shift (works across midnight).
  v_state := public.vyron_employee_clock_state_internal(p_employee_id, v_event_time);
  if coalesce((v_state ->> 'stale_open_shift')::boolean, false) then
    select * into v_session from public.clock_events where id = (v_state ->> 'session_id')::uuid;
    perform public.vyron_flag_missed_clock_out(v_session);
    v_warnings := array_append(v_warnings, 'A previous shift had no clock-out and has been flagged for a manager.');
  end if;

  v_action := coalesce(nullif(p_action, ''), v_state ->> 'next_action');
  if v_action not in ('clock_in','clock_out','break_start','break_end') then
    return jsonb_build_object('ok', false, 'code', 'invalid_action', 'message', 'Unknown clocking action.');
  end if;
  if v_action = 'clock_in' and (v_state ->> 'open_shift')::boolean then
    return jsonb_build_object('ok', false, 'code', 'already_clocked_in', 'state', v_state,
      'message', 'Already clocked in. Clock out before clocking in again.');
  end if;
  if v_action <> 'clock_in' and not (v_state ->> 'open_shift')::boolean then
    return jsonb_build_object('ok', false, 'code', 'not_clocked_in', 'state', v_state,
      'message', 'Not clocked in. Clock in first.');
  end if;
  if v_action = 'break_start' and (v_state ->> 'on_break')::boolean then
    return jsonb_build_object('ok', false, 'code', 'already_on_break', 'state', v_state, 'message', 'Already on a break.');
  end if;
  if v_action = 'break_end' and not (v_state ->> 'on_break')::boolean then
    return jsonb_build_object('ok', false, 'code', 'not_on_break', 'state', v_state, 'message', 'Not on a break.');
  end if;
  if v_action = 'clock_out' and (v_state ->> 'on_break')::boolean then
    v_warnings := array_append(v_warnings, 'Clocked out while on a break; the break ends at clock-out.');
  end if;

  -- Debounce: a second, different tap moments after the first is almost always a double tap.
  if p_source <> 'offline' and (v_state ->> 'last_event_time') is not null
     and v_event_time - (v_state ->> 'last_event_time')::timestamptz
         < make_interval(secs => v_settings.min_seconds_between_events) then
    return jsonb_build_object('ok', false, 'code', 'too_soon', 'state', v_state,
      'message', format('The last clocking was less than %s seconds ago. Wait a moment and try again.',
                        v_settings.min_seconds_between_events));
  end if;

  -- Photo evidence (company policy).
  if v_settings.require_photo and p_photo_path is null and p_source <> 'offline' then
    return jsonb_build_object('ok', false, 'code', 'photo_required',
      'message', 'A photo is required for clocking. Allow camera access, or ask a manager to record the time.');
  end if;

  -- Location.
  if p_latitude is null or p_longitude is null then
    if v_settings.require_gps and p_source <> 'offline' then
      return jsonb_build_object('ok', false, 'code', 'gps_required',
        'message', 'Location is required for clocking. Turn on location services, or ask a manager to record the time.');
    end if;
    v_gps_status := 'no_gps';
  end if;
  if p_store_id is not null then
    select * into v_store from public.stores where id = p_store_id and company_id = v_emp.company_id;
    if v_store.id is null then
      return jsonb_build_object('ok', false, 'code', 'store_not_found', 'message', 'Store not found for this company.');
    end if;
  elsif v_emp.default_store_id is not null then
    select * into v_store from public.stores where id = v_emp.default_store_id;
  end if;
  if v_store.id is not null then
    select g.latitude, g.longitude, g.radius_meters into v_fence_lat, v_fence_lon, v_fence_rad
      from public.attendance_geofences g
     where g.store_id = v_store.id and g.status = 'active'
     order by g.created_at desc limit 1;
    if v_fence_lat is null then
      v_fence_lat := v_store.latitude; v_fence_lon := v_store.longitude;
      v_fence_rad := coalesce(v_store.gps_radius_meters, 150);
    end if;
  end if;
  if v_gps_status <> 'no_gps' and v_settings.geofence_mode <> 'off' then
    if v_fence_lat is null or v_fence_lon is null then
      v_gps_status := 'store_not_configured';
    else
      v_distance := round(public.vyron_distance_meters(p_latitude, p_longitude, v_fence_lat, v_fence_lon), 1);
      if v_distance - least(coalesce(p_accuracy, 0), v_settings.geofence_accuracy_allowance_m) > v_fence_rad then
        v_gps_status := 'outside_radius';
        if v_settings.geofence_mode = 'block' and p_source <> 'offline' then
          return jsonb_build_object('ok', false, 'code', 'outside_geofence', 'distance_m', v_distance,
            'radius_m', v_fence_rad,
            'message', format('You are %s m from %s (allowed %s m). Clocking is only possible on site.',
                              round(v_distance), coalesce(v_store.name, 'the store'), v_fence_rad));
        end if;
        v_verification := 'needs_review';
        v_warnings := array_append(v_warnings, format('Clocked %s m from %s; flagged for review.', round(v_distance), coalesce(v_store.name, 'the store')));
      else
        v_gps_status := 'within_radius';
      end if;
    end if;
  end if;

  -- Shift assignment: clock-in matches a roster shift; everything else joins its session.
  if v_action = 'clock_in' then
    select * into v_shift from public.roster_shifts rs
     where rs.employee_id = p_employee_id and coalesce(rs.status, 'scheduled') not in ('cancelled')
       and v_event_time between rs.planned_start - make_interval(mins => v_settings.roster_match_window_minutes)
                            and rs.planned_end
     order by abs(extract(epoch from (rs.planned_start - v_event_time))) limit 1;
    v_att_date := coalesce(v_shift.shift_date, (v_event_time at time zone v_settings.timezone)::date);
  else
    select * into v_session from public.clock_events where id = (v_state ->> 'session_id')::uuid;
    v_att_date := coalesce(v_session.attendance_date, (v_session.event_time at time zone v_settings.timezone)::date);
    if v_session.roster_shift_id is not null then
      select * into v_shift from public.roster_shifts where id = v_session.roster_shift_id;
    end if;
  end if;

  perform set_config('vyron.clock_reason', 'clocking:' || p_source, true);
  insert into public.clock_events (
    company_id, employee_id, store_id, roster_shift_id, event_type, event_time, source,
    latitude, longitude, gps_accuracy, gps_accuracy_meters, gps_distance_from_store_meters,
    gps_verification_status, photo_bucket, photo_path, photo_url,
    photo_verification_status, verification_status, device_info, device_user_agent, clock_note,
    client_event_id, shift_session_id, attendance_date, recorded_by, recorded_by_email)
  values (
    v_emp.company_id, p_employee_id, coalesce(v_store.id, p_store_id), v_shift.id, v_action, v_event_time, p_source,
    p_latitude, p_longitude, p_accuracy, p_accuracy, v_distance,
    v_gps_status, p_photo_bucket, p_photo_path, p_photo_path,
    case when p_photo_path is null then 'no_photo' else 'captured' end, v_verification,
    left(p_device_info, 500), left(p_device_info, 500), left(p_note, 500),
    p_client_event_id, null, v_att_date, auth.uid(), nullif(public.vyron_jwt_email(), ''))
  returning * into v_event;

  update public.clock_events
     set shift_session_id = case when v_action = 'clock_in' then v_event.id else v_session.id end
   where id = v_event.id
  returning * into v_event;

  -- Attendance exceptions against the roster.
  if v_gps_status = 'outside_radius' then
    perform public.vyron_raise_time_exception('wrong_store:' || v_event.id, v_emp.company_id, p_employee_id,
      v_event.store_id, v_shift.id, 'wrong_store', 'medium',
      format('%s recorded %s m from the store (allowed %s m).', replace(v_action, '_', ' '), round(v_distance), v_fence_rad));
  end if;
  if v_shift.id is not null and v_action = 'clock_in'
     and v_event_time > v_shift.planned_start + make_interval(mins => v_settings.late_grace_minutes) then
    perform public.vyron_raise_time_exception('late_arrival:' || v_shift.id, v_emp.company_id, p_employee_id,
      v_event.store_id, v_shift.id, 'late_arrival', 'medium',
      format('Clocked in %s minutes after the rostered start.',
             floor(extract(epoch from (v_event_time - v_shift.planned_start)) / 60)));
  end if;
  if v_shift.id is not null and v_action = 'clock_out'
     and v_event_time < v_shift.planned_end - make_interval(mins => v_settings.early_departure_grace_minutes) then
    perform public.vyron_raise_time_exception('early_departure:' || v_shift.id, v_emp.company_id, p_employee_id,
      v_event.store_id, v_shift.id, 'early_departure', 'medium',
      format('Clocked out %s minutes before the rostered end.',
             floor(extract(epoch from (v_shift.planned_end - v_event_time)) / 60)));
  end if;
  if p_source = 'offline' then
    perform public.vyron_raise_time_exception('offline_review:' || v_event.id, v_emp.company_id, p_employee_id,
      v_event.store_id, v_shift.id, 'manual_adjustment', 'low',
      'Offline clocking recorded with the device time; please confirm.');
  end if;

  return jsonb_build_object('ok', true, 'duplicate', false, 'event', to_jsonb(v_event),
                            'warnings', to_jsonb(v_warnings));
end $$;
revoke all on function public.vyron_record_clock_event(uuid, uuid, text, uuid, numeric, numeric, numeric, text, text, text, text, text, timestamptz, text) from public, anon;
grant execute on function public.vyron_record_clock_event(uuid, uuid, text, uuid, numeric, numeric, numeric, text, text, text, text, text, timestamptz, text) to authenticated, service_role;

-- Kiosk screen data. A kiosk device cannot read the employees table (manager/self policies);
-- it gets only what a clocking screen needs: names, numbers, store and whether a PIN is set.
-- No pay rates, contact details or PINs.
create or replace function public.vyron_kiosk_directory(p_company_id uuid)
returns table (id uuid, employee_number text, first_name text, last_name text, job_title text,
               default_store_id uuid, active boolean, pin_configured boolean)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.vyron_is_clock_operator(p_company_id) then
    raise exception 'Not permitted.' using errcode = '42501';
  end if;
  return query
    select e.id, e.employee_number, e.first_name, e.last_name, e.job_title, e.default_store_id,
           coalesce(e.active, true), e.pin_configured
    from public.employees e
    where e.company_id = p_company_id and coalesce(e.active, true)
      and coalesce(e.record_status, 'active') = 'active'
    order by e.first_name, e.last_name;
end $$;
revoke all on function public.vyron_kiosk_directory(uuid) from public, anon;
grant execute on function public.vyron_kiosk_directory(uuid) to authenticated, service_role;

-- An employee's clockings since a point in time (kiosk history panel), for operators or self.
create or replace function public.vyron_kiosk_recent_events(p_employee_id uuid, p_since timestamptz)
returns table (id uuid, employee_id uuid, store_id uuid, event_type text, event_time timestamptz,
               source text, latitude numeric, longitude numeric, photo_bucket text, photo_path text,
               gps_verification_status text, attendance_date date)
language plpgsql stable security definer set search_path = public as $$
declare v_company uuid;
begin
  select company_id into v_company from public.employees where employees.id = p_employee_id;
  if v_company is null or not (public.vyron_is_clock_operator(v_company)
                                or p_employee_id in (select public.vyron_my_employee_ids())) then
    raise exception 'Not permitted for this employee.' using errcode = '42501';
  end if;
  return query
    select c.id, c.employee_id, c.store_id, c.event_type, c.event_time, c.source, c.latitude,
           c.longitude, c.photo_bucket, c.photo_path, c.gps_verification_status, c.attendance_date
    from public.clock_events c
    where c.employee_id = p_employee_id and c.event_time >= greatest(p_since, now() - interval '3 days')
    order by c.event_time desc;
end $$;
revoke all on function public.vyron_kiosk_recent_events(uuid, timestamptz) from public, anon;
grant execute on function public.vyron_kiosk_recent_events(uuid, timestamptz) to authenticated, service_role;

-- -------------------------------------------------------------------------------------
-- 7. Manager-entered clock events (with a mandatory reason; fully audited)
-- -------------------------------------------------------------------------------------
create or replace function public.vyron_manager_record_clock_event(
  p_employee_id uuid, p_event_type text, p_event_time timestamptz, p_reason text,
  p_store_id uuid default null, p_roster_shift_id uuid default null, p_client_event_id uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_emp public.employees;
  v_settings public.attendance_settings;
  v_event public.clock_events;
  v_session public.clock_events;
begin
  select * into v_emp from public.employees where id = p_employee_id;
  if v_emp.id is null then raise exception 'Employee not found.' using errcode = 'P0002'; end if;
  if not public.vyron_is_company_manager(v_emp.company_id) then
    raise exception 'Only a manager can record clock times manually.' using errcode = '42501';
  end if;
  if p_employee_id in (select public.vyron_my_employee_ids()) and not (select public.vyron_is_platform_operator()) then
    raise exception 'Managers cannot record their own attendance manually.' using errcode = '42501';
  end if;
  if coalesce(btrim(p_reason), '') = '' then
    raise exception 'A reason is required for a manual clock entry.' using errcode = '22023';
  end if;
  if p_event_type not in ('clock_in','clock_out','break_start','break_end') then
    raise exception 'Unknown clocking action.' using errcode = '22023';
  end if;
  if p_event_time > now() + interval '5 minutes' then
    raise exception 'A clock time cannot be in the future.' using errcode = '22023';
  end if;
  if p_client_event_id is not null then
    select * into v_event from public.clock_events where client_event_id = p_client_event_id;
    if v_event.id is not null then
      return jsonb_build_object('ok', true, 'duplicate', true, 'event', to_jsonb(v_event));
    end if;
  end if;
  perform pg_advisory_xact_lock(hashtextextended('vyron_clock:' || p_employee_id::text, 0));
  v_settings := public.vyron_attendance_settings(v_emp.company_id);

  if p_event_type <> 'clock_in' then
    select * into v_session from public.clock_events
     where employee_id = p_employee_id and event_type = 'clock_in' and event_time <= p_event_time
       and event_time > p_event_time - make_interval(secs => (v_settings.max_shift_hours * 3600)::double precision)
     order by event_time desc limit 1;
    if v_session.id is null then
      raise exception 'No clock-in within % hours before this time.', v_settings.max_shift_hours using errcode = '22023';
    end if;
  end if;

  perform set_config('vyron.clock_reason', 'manual:' || left(p_reason, 400), true);
  insert into public.clock_events (company_id, employee_id, store_id, roster_shift_id, event_type, event_time,
    source, gps_verification_status, verification_status, clock_note, client_event_id, attendance_date,
    recorded_by, recorded_by_email)
  values (v_emp.company_id, p_employee_id, coalesce(p_store_id, v_session.store_id, v_emp.default_store_id),
    coalesce(p_roster_shift_id, v_session.roster_shift_id), p_event_type, p_event_time,
    'manager_manual', 'not_checked', 'manager_entered', left('Manual entry: ' || p_reason, 500), p_client_event_id,
    coalesce(v_session.attendance_date,
             (select rs.shift_date from public.roster_shifts rs where rs.id = p_roster_shift_id),
             (p_event_time at time zone v_settings.timezone)::date),
    auth.uid(), nullif(public.vyron_jwt_email(), ''))
  returning * into v_event;
  update public.clock_events set shift_session_id = coalesce(v_session.id, v_event.id)
   where id = v_event.id returning * into v_event;
  return jsonb_build_object('ok', true, 'duplicate', false, 'event', to_jsonb(v_event));
end $$;
revoke all on function public.vyron_manager_record_clock_event(uuid, text, timestamptz, text, uuid, uuid, uuid) from public, anon;
grant execute on function public.vyron_manager_record_clock_event(uuid, text, timestamptz, text, uuid, uuid, uuid) to authenticated, service_role;

-- -------------------------------------------------------------------------------------
-- 8. Corrections review (original kept; a different person decides)
-- -------------------------------------------------------------------------------------
create or replace function public.vyron_review_attendance_correction(
  p_correction_id uuid, p_decision text, p_notes text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_corr public.attendance_corrections;
  v_event public.clock_events;
  v_result jsonb;
  v_reviewer text := nullif(public.vyron_jwt_email(), '');
  v_new_type text;
begin
  select * into v_corr from public.attendance_corrections where id = p_correction_id for update;
  if v_corr.id is null then raise exception 'Correction not found.' using errcode = 'P0002'; end if;
  if not public.vyron_is_company_manager(v_corr.company_id) then
    raise exception 'Only a manager can review attendance corrections.' using errcode = '42501';
  end if;
  if v_corr.employee_id in (select public.vyron_my_employee_ids()) and not (select public.vyron_is_platform_operator()) then
    raise exception 'You cannot review a correction to your own attendance.' using errcode = '42501';
  end if;
  if lower(coalesce(v_corr.requested_by, '')) = coalesce(v_reviewer, '') and v_reviewer is not null
     and not (select public.vyron_is_platform_operator()) then
    raise exception 'The person who requested a correction cannot approve it.' using errcode = '42501';
  end if;
  if v_corr.status <> 'pending' then
    raise exception 'This correction has already been %.', v_corr.status using errcode = '22023';
  end if;
  if p_decision not in ('approved','rejected') then
    raise exception 'Decision must be approved or rejected.' using errcode = '22023';
  end if;

  if p_decision = 'approved' then
    if v_corr.requested_event_time is null then
      raise exception 'The correction has no requested time.' using errcode = '22023';
    end if;
    if v_corr.clock_event_id is not null then
      perform pg_advisory_xact_lock(hashtextextended('vyron_clock:' || v_corr.employee_id::text, 0));
      select * into v_event from public.clock_events where id = v_corr.clock_event_id;
      if v_event.id is null then raise exception 'The clock event no longer exists.' using errcode = 'P0002'; end if;
      perform set_config('vyron.clock_reason', 'correction:' || v_corr.id || ':' || left(v_corr.reason, 300), true);
      update public.clock_events
         set original_event_time = coalesce(original_event_time, event_time),
             event_time = v_corr.requested_event_time,
             store_id = coalesce(v_corr.requested_store_id, store_id),
             corrected_at = now(),
             correction_id = v_corr.id,
             verification_status = 'corrected'
       where id = v_event.id;
    else
      v_new_type := case v_corr.correction_type
                      when 'missing_clock_out' then 'clock_out' when 'clock_out' then 'clock_out'
                      when 'missing_clock_in' then 'clock_in' when 'clock_in' then 'clock_in'
                      else null end;
      if v_new_type is null then
        raise exception 'Correction type % needs a clock event to correct.', v_corr.correction_type using errcode = '22023';
      end if;
      v_result := public.vyron_manager_record_clock_event(v_corr.employee_id, v_new_type, v_corr.requested_event_time,
                    'Approved correction: ' || v_corr.reason, v_corr.requested_store_id, null, null);
      update public.clock_events set correction_id = v_corr.id, corrected_at = now()
       where id = ((v_result -> 'event') ->> 'id')::uuid;
    end if;
    if v_corr.correction_type in ('missing_clock_out','clock_out') then
      update public.time_exceptions set status = 'closed'
       where employee_id = v_corr.employee_id and exception_type = 'missing_clock_out' and status = 'open'
         and exception_key like 'missing_clock_out:%';
    end if;
  end if;

  update public.attendance_corrections
     set status = p_decision, reviewed_by = v_reviewer, reviewed_at = now(), review_notes = p_notes
   where id = v_corr.id returning * into v_corr;
  insert into public.attendance_correction_audit (company_id, correction_id, action, action_by, details)
  values (v_corr.company_id, v_corr.id, p_decision, v_reviewer,
          jsonb_build_object('notes', p_notes, 'requested_event_time', v_corr.requested_event_time,
                             'clock_event_id', v_corr.clock_event_id, 'original_record', v_corr.original_record));
  return jsonb_build_object('ok', true, 'correction', to_jsonb(v_corr));
end $$;
revoke all on function public.vyron_review_attendance_correction(uuid, text, text) from public, anon;
grant execute on function public.vyron_review_attendance_correction(uuid, text, text) to authenticated, service_role;

-- -------------------------------------------------------------------------------------
-- 9. Missed clock-out sweep (manager panel on load; schedulable)
-- -------------------------------------------------------------------------------------
create or replace function public.vyron_flag_stale_open_shifts(p_company_id uuid)
returns integer language plpgsql security definer set search_path = public as $$
declare
  v_settings public.attendance_settings;
  r public.clock_events;
  v_count integer := 0;
begin
  if not (public.vyron_is_company_manager(p_company_id) or coalesce(auth.jwt() ->> 'role', '') = 'service_role'
          or auth.uid() is null and current_user in ('postgres','supabase_admin')) then
    raise exception 'Not permitted.' using errcode = '42501';
  end if;
  v_settings := public.vyron_attendance_settings(p_company_id);
  for r in
    select ci.* from public.clock_events ci
     where ci.company_id = p_company_id and ci.event_type = 'clock_in'
       and ci.event_time < now() - make_interval(secs => (v_settings.max_shift_hours * 3600)::double precision)
       and ci.event_time > now() - interval '45 days'
       and not exists (select 1 from public.clock_events co
                        where co.employee_id = ci.employee_id and co.event_type = 'clock_out'
                          and co.shift_session_id = ci.id)
       and not exists (select 1 from public.time_exceptions te where te.exception_key = 'missing_clock_out:' || ci.id)
  loop
    perform public.vyron_flag_missed_clock_out(r);
    v_count := v_count + 1;
  end loop;
  return v_count;
end $$;
revoke all on function public.vyron_flag_stale_open_shifts(uuid) from public, anon;
grant execute on function public.vyron_flag_stale_open_shifts(uuid) to authenticated, service_role;

notify pgrst, 'reload schema';

commit;

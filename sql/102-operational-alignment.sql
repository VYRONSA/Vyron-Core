-- =====================================================================================
-- 102 — Operational schema alignment (UMORA remediation, Phase 3)
-- =====================================================================================
-- NOT APPLIED TO PRODUCTION. Requires separate written approval. Depends on 100.
-- Idempotent. Rollback: sql/102-rollback.sql.
--
-- The manager screens for rostering, leave and employee profiles were written against
-- migrations 042/045/046, which production never received. Those files also create
-- "DEV allow all" policies and GRANT ALL to anon, so they must never be run as-is.
-- This migration takes ONLY their table/index/column definitions (section 1, extracted
-- verbatim) and secures every table with role-aware policies (section 2). It also:
--   * lets leave approval and filing work (leave triggers run as system functions) — D08
--   * allows the status values the screens use ('cancelled' leave, 'published' shifts) — D08, D11
--   * stops a hard employee delete from erasing attendance/roster/payroll history — D24
-- =====================================================================================

begin;

-- -------------------------------------------------------------------------------------
-- 1. Tables, indexes and columns from 042 / 045 / 046 (definitions only)
-- -------------------------------------------------------------------------------------
-- ---- from 042-employee-management-profiles.sql (tables, indexes and columns only; its DEV policies are NOT used) ----
create table if not exists public.employee_profiles (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  employee_id uuid not null,
  personal_information jsonb not null default '{}'::jsonb,
  employment_information jsonb not null default '{}'::jsonb,
  company_information jsonb not null default '{}'::jsonb,
  department text,
  store_id uuid,
  position text,
  supervisor text,
  employment_status text,
  contact_details jsonb not null default '{}'::jsonb,
  emergency_contacts jsonb not null default '{}'::jsonb,
  next_of_kin jsonb not null default '{}'::jsonb,
  identification jsonb not null default '{}'::jsonb,
  payroll_information jsonb not null default '{}'::jsonb,
  clocking_information jsonb not null default '{}'::jsonb,
  training jsonb not null default '{}'::jsonb,
  notes text,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (company_id, employee_id)
);

create index if not exists employee_profiles_company_id_idx on public.employee_profiles (company_id);

create index if not exists employee_profiles_employee_id_idx on public.employee_profiles (employee_id);

create table if not exists public.employee_audit_history (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  employee_id uuid not null,
  action text not null,
  details jsonb not null default '{}'::jsonb,
  created_by text,
  created_at timestamptz not null default now()
);

create index if not exists employee_audit_history_company_id_idx on public.employee_audit_history (company_id);

create index if not exists employee_audit_history_employee_id_idx on public.employee_audit_history (employee_id);

-- ---- from 045-leave-management-excellence.sql (tables, indexes and columns only; its DEV policies are NOT used) ----
create table if not exists public.leave_types_config (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  leave_type_code text not null,
  leave_type_name text not null,
  annual_entitlement_days numeric not null default 0,
  monthly_accrual_days numeric not null default 0,
  carry_forward_limit_days numeric not null default 0,
  carry_forward_expiry_months integer not null default 0,
  maximum_balance_days numeric,
  requires_attachment boolean not null default false,
  requires_medical_certificate boolean not null default false,
  is_custom boolean not null default false,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, leave_type_code)
);

create table if not exists public.leave_rules (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  rule_name text not null,
  leave_type_code text,
  minimum_notice_days integer,
  maximum_consecutive_days integer,
  max_team_members_on_leave integer,
  enforce_peak_period_restriction boolean not null default false,
  enforce_blackout_restriction boolean not null default false,
  enforce_attachment boolean not null default false,
  enforce_medical_certificate boolean not null default false,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.leave_blackout_periods (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  period_name text not null,
  start_date date not null,
  end_date date not null,
  applies_to_leave_type text,
  applies_to_store_id uuid,
  status text not null default 'active',
  created_at timestamptz not null default now()
);

create table if not exists public.leave_peak_periods (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  period_name text not null,
  start_date date not null,
  end_date date not null,
  store_id uuid,
  department_name text,
  max_leave_headcount integer,
  status text not null default 'active',
  created_at timestamptz not null default now()
);

create table if not exists public.leave_public_holidays (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  holiday_name text not null,
  holiday_date date not null,
  region text,
  created_at timestamptz not null default now(),
  unique (company_id, holiday_date, holiday_name)
);

create table if not exists public.leave_accrual_runs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  run_for_date date not null,
  run_status text not null default 'completed',
  processed_employees integer not null default 0,
  notes text,
  created_at timestamptz not null default now(),
  unique (company_id, run_for_date)
);

create table if not exists public.leave_forecast_snapshots (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  employee_id uuid not null,
  leave_type text not null,
  projection_months integer not null,
  projected_balance numeric not null default 0,
  negative_balance_warning boolean not null default false,
  generated_at timestamptz not null default now()
);

create table if not exists public.leave_planner_conflicts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  leave_request_id uuid,
  conflict_type text not null,
  conflict_notes text,
  severity text not null default 'medium',
  created_at timestamptz not null default now()
);

alter table public.leave_requests
  add column if not exists workflow_stage text default 'submitted',
  add column if not exists submitted_at timestamptz,
  add column if not exists manager_approved_at timestamptz,
  add column if not exists hr_approved_at timestamptz,
  add column if not exists rejected_at timestamptz,
  add column if not exists cancelled_at timestamptz,
  add column if not exists completed_at timestamptz,
  add column if not exists requested_days numeric,
  add column if not exists requires_attachment boolean default false,
  add column if not exists requires_medical_certificate boolean default false,
  add column if not exists has_required_attachment boolean default false,
  add column if not exists attachment_document_id uuid,
  add column if not exists reviewed_by_manager text,
  add column if not exists reviewed_by_hr text;

alter table public.hr_documents
  add column if not exists leave_request_id uuid,
  add column if not exists archive_status text default 'active';

create index if not exists leave_types_config_company_idx on public.leave_types_config (company_id);

create index if not exists leave_rules_company_idx on public.leave_rules (company_id);

create index if not exists leave_blackout_periods_company_idx on public.leave_blackout_periods (company_id);

create index if not exists leave_peak_periods_company_idx on public.leave_peak_periods (company_id);

create index if not exists leave_public_holidays_company_idx on public.leave_public_holidays (company_id);

create index if not exists leave_accrual_runs_company_idx on public.leave_accrual_runs (company_id, run_for_date);

create index if not exists leave_forecast_snapshots_company_idx on public.leave_forecast_snapshots (company_id, employee_id);

create index if not exists leave_planner_conflicts_company_idx on public.leave_planner_conflicts (company_id, created_at);

create index if not exists leave_requests_workflow_stage_idx on public.leave_requests (company_id, workflow_stage);

create index if not exists hr_documents_leave_request_idx on public.hr_documents (leave_request_id, archive_status);

-- ---- from 046-roster-shift-planning-excellence.sql (tables, indexes and columns only; its DEV policies are NOT used) ----
create table if not exists public.shift_templates (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  template_name text not null,
  shift_type text not null,
  start_time time not null,
  end_time time not null,
  break_minutes integer not null default 0,
  recurring_pattern text,
  rotation_group text,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, template_name)
);

create table if not exists public.roster_rules (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  rule_name text not null,
  minimum_rest_hours numeric not null default 11,
  maximum_shift_hours numeric not null default 12,
  maximum_consecutive_days integer not null default 6,
  maximum_weekly_hours numeric not null default 45,
  validate_automatically boolean not null default true,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.roster_coverage_requirements (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  store_id uuid,
  department_name text,
  coverage_date date not null,
  shift_type text not null,
  required_employees integer not null default 1,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, store_id, coverage_date, shift_type)
);

create table if not exists public.roster_versions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  version_name text not null,
  period_start date not null,
  period_end date not null,
  status text not null default 'draft',
  approved_by text,
  published_by text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.roster_notifications (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  employee_id uuid,
  roster_version_id uuid,
  notification_type text not null,
  title text not null,
  body text,
  delivery_status text not null default 'pending',
  created_at timestamptz not null default now()
);

create table if not exists public.shift_swap_requests (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  requester_employee_id uuid not null,
  target_employee_id uuid,
  roster_shift_id uuid,
  requested_shift_date date,
  reason text,
  status text not null default 'requested',
  manager_notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.employee_availability_preferences (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  employee_id uuid not null,
  weekday integer not null,
  available_start time,
  available_end time,
  preferred_shift_type text,
  unavailable boolean not null default false,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, employee_id, weekday)
);

alter table public.roster_shifts
  add column if not exists shift_template_id uuid,
  add column if not exists roster_version_id uuid,
  add column if not exists planner_notes text,
  add column if not exists published boolean not null default false,
  add column if not exists approved boolean not null default false,
  add column if not exists approval_notes text,
  add column if not exists labor_cost_estimate numeric,
  add column if not exists created_by text,
  add column if not exists updated_at timestamptz;

create index if not exists shift_templates_company_idx on public.shift_templates (company_id);

create index if not exists roster_rules_company_idx on public.roster_rules (company_id);

create index if not exists roster_coverage_requirements_company_idx on public.roster_coverage_requirements (company_id, coverage_date);

create index if not exists roster_versions_company_idx on public.roster_versions (company_id, period_start, period_end);

create index if not exists roster_notifications_company_idx on public.roster_notifications (company_id, created_at);

create index if not exists shift_swap_requests_company_idx on public.shift_swap_requests (company_id, status);

create index if not exists employee_availability_preferences_company_idx on public.employee_availability_preferences (company_id, employee_id);

create index if not exists roster_shifts_version_idx on public.roster_shifts (company_id, roster_version_id, shift_date);

-- -------------------------------------------------------------------------------------
-- 2. Role-aware security for the tables above
-- -------------------------------------------------------------------------------------
do $$
declare
  t text;
  config_tables text[] := array['leave_types_config','leave_rules','leave_blackout_periods','leave_peak_periods',
                                'leave_public_holidays','shift_templates','roster_rules',
                                'roster_coverage_requirements','roster_versions'];
  manager_tables text[] := array['leave_accrual_runs','leave_forecast_snapshots','leave_planner_conflicts',
                                 'employee_audit_history'];
  employee_tables text[] := array['employee_profiles','roster_notifications','employee_availability_preferences'];
  r record;
begin
  -- Remove any policy these tables may carry (e.g. if an old DEV migration was ever run).
  for r in select tablename, policyname from pg_policies
           where schemaname = 'public' and tablename = any (config_tables || manager_tables || employee_tables || array['shift_swap_requests']) loop
    execute format('drop policy if exists %I on public.%I', r.policyname, r.tablename);
  end loop;

  foreach t in array config_tables || manager_tables || employee_tables || array['shift_swap_requests'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('revoke truncate on public.%I from authenticated', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
  end loop;

  -- Company configuration: every member reads, managers write.
  foreach t in array config_tables loop
    execute format($p$create policy %I on public.%I for select to authenticated
      using ((select public.vyron_is_platform_operator()) or company_id in (select public.vyron_user_company_ids()))$p$,
      t || '_select_v102', t);
    execute format($p$create policy %I on public.%I for all to authenticated
      using ((select public.vyron_is_platform_operator()) or company_id in (select public.vyron_manager_company_ids()))
      with check ((select public.vyron_is_platform_operator()) or company_id in (select public.vyron_manager_company_ids()))$p$,
      t || '_write_v102', t);
  end loop;

  -- Management data: managers only.
  foreach t in array manager_tables loop
    execute format($p$create policy %I on public.%I for all to authenticated
      using ((select public.vyron_is_platform_operator()) or company_id in (select public.vyron_manager_company_ids()))
      with check ((select public.vyron_is_platform_operator()) or company_id in (select public.vyron_manager_company_ids()))$p$,
      t || '_manager_v102', t);
  end loop;

  -- Per-employee data: managers manage; the employee reads their own rows.
  foreach t in array employee_tables loop
    execute format($p$create policy %I on public.%I for select to authenticated
      using ((select public.vyron_is_platform_operator())
             or company_id in (select public.vyron_manager_company_ids())
             or employee_id::text in (select m::text from public.vyron_my_employee_ids() m))$p$,
      t || '_select_v102', t);
    execute format($p$create policy %I on public.%I for all to authenticated
      using ((select public.vyron_is_platform_operator()) or company_id in (select public.vyron_manager_company_ids()))
      with check ((select public.vyron_is_platform_operator()) or company_id in (select public.vyron_manager_company_ids()))$p$,
      t || '_manager_v102', t);
  end loop;
end $$;

-- Shift swaps: managers manage; both employees in a swap can see it; an employee may only
-- request a swap as themselves.
drop policy if exists shift_swap_requests_select_v102 on public.shift_swap_requests;
drop policy if exists shift_swap_requests_manager_v102 on public.shift_swap_requests;
drop policy if exists shift_swap_requests_self_insert_v102 on public.shift_swap_requests;
create policy shift_swap_requests_select_v102 on public.shift_swap_requests for select to authenticated
  using ((select public.vyron_is_platform_operator())
         or company_id in (select public.vyron_manager_company_ids())
         or requester_employee_id in (select m from public.vyron_my_employee_ids() m)
         or target_employee_id in (select m from public.vyron_my_employee_ids() m));
create policy shift_swap_requests_manager_v102 on public.shift_swap_requests for all to authenticated
  using ((select public.vyron_is_platform_operator()) or company_id in (select public.vyron_manager_company_ids()))
  with check ((select public.vyron_is_platform_operator()) or company_id in (select public.vyron_manager_company_ids()));
create policy shift_swap_requests_self_insert_v102 on public.shift_swap_requests for insert to authenticated
  with check (company_id in (select public.vyron_user_company_ids())
              and requester_employee_id in (select m from public.vyron_my_employee_ids() m)
              and status = 'requested');
drop policy if exists employee_availability_self_v102 on public.employee_availability_preferences;
create policy employee_availability_self_v102 on public.employee_availability_preferences for all to authenticated
  using (company_id in (select public.vyron_user_company_ids())
         and employee_id::text in (select m::text from public.vyron_my_employee_ids() m))
  with check (company_id in (select public.vyron_user_company_ids())
              and employee_id::text in (select m::text from public.vyron_my_employee_ids() m));

-- -------------------------------------------------------------------------------------
-- 3. Leave: status values the screens use; triggers that work for every caller (D08)
-- -------------------------------------------------------------------------------------
alter table public.leave_requests drop constraint if exists leave_requests_status_check;
alter table public.leave_requests add constraint leave_requests_status_check
  check (status = any (array['pending','approved','declined','amended','cancelled']));

-- These triggers only derive rows from the leave request itself (who may write that request
-- is decided by its RLS policies). Running them as system functions lets an employee file
-- leave (balance sync) and a manager decide it (notification + decision audit).
alter function public.sync_leave_request_to_balance() security definer;
alter function public.sync_leave_request_to_balance() set search_path = public;
alter function public.create_leave_status_notification() security definer;
alter function public.create_leave_status_notification() set search_path = public;
alter function public.record_leave_decision_audit() security definer;
alter function public.record_leave_decision_audit() set search_path = public;
revoke all on function public.sync_leave_request_to_balance() from public, anon, authenticated;
revoke all on function public.create_leave_status_notification() from public, anon, authenticated;
revoke all on function public.record_leave_decision_audit() from public, anon, authenticated;

-- An employee may not turn their own request into an approved/declined one through
-- columns the policy does not see (decision fields are manager-only).
create or replace function public.vyron_guard_leave_request()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'authenticated' or (select public.vyron_is_platform_operator())
     or public.vyron_is_company_manager(new.company_id) then
    return new;
  end if;
  if tg_op = 'INSERT' then
    if coalesce(new.status, 'pending') <> 'pending'
       or new.manager_approved_at is not null or new.hr_approved_at is not null
       or new.reviewed_by_manager is not null or new.reviewed_by_hr is not null
       or coalesce(new.workflow_stage, 'submitted') not in ('draft', 'submitted') then
      raise exception 'A leave request can only be filed as pending.' using errcode = '42501';
    end if;
  else
    if new.status is distinct from old.status and new.status <> 'cancelled'
       or new.manager_approved_at is distinct from old.manager_approved_at
       or new.hr_approved_at is distinct from old.hr_approved_at
       or new.reviewed_by_manager is distinct from old.reviewed_by_manager
       or new.reviewed_by_hr is distinct from old.reviewed_by_hr
       or new.manager_feedback is distinct from old.manager_feedback
       or new.employee_id is distinct from old.employee_id
       or new.company_id is distinct from old.company_id then
      raise exception 'Only a manager can decide a leave request.' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;
revoke all on function public.vyron_guard_leave_request() from public, anon, authenticated;
drop trigger if exists trg_vyron_guard_leave_request on public.leave_requests;
create trigger trg_vyron_guard_leave_request before insert or update on public.leave_requests
  for each row execute function public.vyron_guard_leave_request();

-- The 100 policy lets an employee update only a PENDING request of their own; allow the
-- resulting row to be 'cancelled' (withdrawal) but nothing else.
drop policy if exists leave_requests_update_v100 on public.leave_requests;
create policy leave_requests_update_v100 on public.leave_requests for update to authenticated
  using ((select public.vyron_is_platform_operator())
         or company_id in (select public.vyron_manager_company_ids())
         or (employee_id in (select m::text from public.vyron_my_employee_ids() m) and status = 'pending'))
  with check ((select public.vyron_is_platform_operator())
         or company_id in (select public.vyron_manager_company_ids())
         or (employee_id in (select m::text from public.vyron_my_employee_ids() m) and status in ('pending', 'cancelled')));

-- -------------------------------------------------------------------------------------
-- 4. Rosters: the status the publish action writes (D11)
-- -------------------------------------------------------------------------------------
alter table public.roster_shifts drop constraint if exists roster_shifts_status_check;
alter table public.roster_shifts add constraint roster_shifts_status_check
  check (status = any (array['scheduled','published','changed','completed','cancelled','no_show']));

-- -------------------------------------------------------------------------------------
-- 5. Employee history is never deleted with the employee (D24)
-- -------------------------------------------------------------------------------------
-- Attendance, roster, exception and payroll rows used to cascade-delete with the employee.
-- They now block a hard delete; employees are archived instead (record_status / active).
do $$
declare
  r record;
begin
  for r in
    select c.conname, c.conrelid::regclass as tbl, a.attname as col
    from pg_constraint c
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any (c.conkey)
    where c.contype = 'f' and c.confrelid = 'public.employees'::regclass and c.confdeltype = 'c'
      and c.conrelid::regclass::text in ('clock_events','roster_shifts','time_exceptions','payroll_hours',
                                         'approved_time_records','payroll_clock_checks','clock_event_audit',
                                         'attendance_corrections')
  loop
    execute format('alter table %s drop constraint %I', r.tbl, r.conname);
    execute format('alter table %s add constraint %I foreign key (%I) references public.employees(id) on delete restrict',
                   r.tbl, r.conname, r.col);
  end loop;
end $$;

notify pgrst, 'reload schema';

commit;

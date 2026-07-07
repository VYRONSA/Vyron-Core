-- Sprint 4: Rostering & Shift Planning Excellence

create extension if not exists pgcrypto;

do $$
begin
  if to_regclass('public.companies') is null then
    raise exception 'Prerequisite missing: public.companies. Run migration 001-create-companies-tables.sql (or 000-run-all-companies.sql) before 046-roster-shift-planning-excellence.sql.';
  end if;

  if to_regclass('public.roster_shifts') is null then
    raise exception 'Prerequisite missing: public.roster_shifts. Run the baseline roster schema migration that creates roster_shifts before 046-roster-shift-planning-excellence.sql.';
  end if;
end $$;

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

alter table public.shift_templates enable row level security;
alter table public.roster_rules enable row level security;
alter table public.roster_coverage_requirements enable row level security;
alter table public.roster_versions enable row level security;
alter table public.roster_notifications enable row level security;
alter table public.shift_swap_requests enable row level security;
alter table public.employee_availability_preferences enable row level security;

drop policy if exists "DEV allow all shift templates" on public.shift_templates;
create policy "DEV allow all shift templates"
on public.shift_templates
for all
to public
using (true)
with check (true);

drop policy if exists "DEV allow all roster rules" on public.roster_rules;
create policy "DEV allow all roster rules"
on public.roster_rules
for all
to public
using (true)
with check (true);

drop policy if exists "DEV allow all roster coverage requirements" on public.roster_coverage_requirements;
create policy "DEV allow all roster coverage requirements"
on public.roster_coverage_requirements
for all
to public
using (true)
with check (true);

drop policy if exists "DEV allow all roster versions" on public.roster_versions;
create policy "DEV allow all roster versions"
on public.roster_versions
for all
to public
using (true)
with check (true);

drop policy if exists "DEV allow all roster notifications" on public.roster_notifications;
create policy "DEV allow all roster notifications"
on public.roster_notifications
for all
to public
using (true)
with check (true);

drop policy if exists "DEV allow all shift swap requests" on public.shift_swap_requests;
create policy "DEV allow all shift swap requests"
on public.shift_swap_requests
for all
to public
using (true)
with check (true);

drop policy if exists "DEV allow all employee availability preferences" on public.employee_availability_preferences;
create policy "DEV allow all employee availability preferences"
on public.employee_availability_preferences
for all
to public
using (true)
with check (true);

grant all on public.shift_templates to anon, authenticated;
grant all on public.roster_rules to anon, authenticated;
grant all on public.roster_coverage_requirements to anon, authenticated;
grant all on public.roster_versions to anon, authenticated;
grant all on public.roster_notifications to anon, authenticated;
grant all on public.shift_swap_requests to anon, authenticated;
grant all on public.employee_availability_preferences to anon, authenticated;

insert into public.shift_templates (
  company_id,
  template_name,
  shift_type,
  start_time,
  end_time,
  break_minutes,
  recurring_pattern,
  rotation_group,
  status
)
select c.id,
       seed.template_name,
       seed.shift_type,
       seed.start_time,
       seed.end_time,
       seed.break_minutes,
       seed.recurring_pattern,
       seed.rotation_group,
       'active'
from public.companies c
cross join (
  values
    ('Morning', 'morning', '06:00'::time, '14:00'::time, 30, 'weekly', 'A'),
    ('Afternoon', 'afternoon', '14:00'::time, '22:00'::time, 30, 'weekly', 'B'),
    ('Night', 'night', '22:00'::time, '06:00'::time, 45, 'weekly', 'C'),
    ('Split Shift', 'split', '08:00'::time, '12:00'::time, 0, 'custom', null),
    ('Custom', 'custom', '09:00'::time, '17:00'::time, 30, 'custom', null),
    ('Rotating', 'rotating', '07:00'::time, '15:00'::time, 30, 'fortnightly', 'ROT')
) as seed(template_name, shift_type, start_time, end_time, break_minutes, recurring_pattern, rotation_group)
where not exists (
  select 1
  from public.shift_templates existing
  where existing.company_id = c.id
    and existing.template_name = seed.template_name
);

insert into public.roster_rules (
  company_id,
  rule_name,
  minimum_rest_hours,
  maximum_shift_hours,
  maximum_consecutive_days,
  maximum_weekly_hours,
  validate_automatically,
  status
)
select c.id,
       'Default Workforce Rule',
       11,
       12,
       6,
       45,
       true,
       'active'
from public.companies c
where not exists (
  select 1
  from public.roster_rules existing
  where existing.company_id = c.id
    and existing.rule_name = 'Default Workforce Rule'
);

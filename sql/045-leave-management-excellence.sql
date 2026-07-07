-- Sprint 3: Leave Management Excellence

create extension if not exists pgcrypto;

do $$
begin
  if to_regclass('public.companies') is null then
    raise exception 'Prerequisite missing: public.companies. Run migration 001-create-companies-tables.sql (or 000-run-all-companies.sql) before 045-leave-management-excellence.sql.';
  end if;

  if to_regclass('public.leave_requests') is null then
    raise exception 'Prerequisite missing: public.leave_requests. Run the baseline HR/leave schema migration that creates leave_requests before 045-leave-management-excellence.sql.';
  end if;

  if to_regclass('public.hr_documents') is null then
    raise exception 'Prerequisite missing: public.hr_documents. Run the baseline HR documents schema migration before 045-leave-management-excellence.sql.';
  end if;
end $$;

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

alter table public.leave_types_config enable row level security;
alter table public.leave_rules enable row level security;
alter table public.leave_blackout_periods enable row level security;
alter table public.leave_peak_periods enable row level security;
alter table public.leave_public_holidays enable row level security;
alter table public.leave_accrual_runs enable row level security;
alter table public.leave_forecast_snapshots enable row level security;
alter table public.leave_planner_conflicts enable row level security;

drop policy if exists "DEV allow all leave types config" on public.leave_types_config;
create policy "DEV allow all leave types config"
on public.leave_types_config
for all
to public
using (true)
with check (true);

drop policy if exists "DEV allow all leave rules" on public.leave_rules;
create policy "DEV allow all leave rules"
on public.leave_rules
for all
to public
using (true)
with check (true);

drop policy if exists "DEV allow all leave blackout periods" on public.leave_blackout_periods;
create policy "DEV allow all leave blackout periods"
on public.leave_blackout_periods
for all
to public
using (true)
with check (true);

drop policy if exists "DEV allow all leave peak periods" on public.leave_peak_periods;
create policy "DEV allow all leave peak periods"
on public.leave_peak_periods
for all
to public
using (true)
with check (true);

drop policy if exists "DEV allow all leave public holidays" on public.leave_public_holidays;
create policy "DEV allow all leave public holidays"
on public.leave_public_holidays
for all
to public
using (true)
with check (true);

drop policy if exists "DEV allow all leave accrual runs" on public.leave_accrual_runs;
create policy "DEV allow all leave accrual runs"
on public.leave_accrual_runs
for all
to public
using (true)
with check (true);

drop policy if exists "DEV allow all leave forecast snapshots" on public.leave_forecast_snapshots;
create policy "DEV allow all leave forecast snapshots"
on public.leave_forecast_snapshots
for all
to public
using (true)
with check (true);

drop policy if exists "DEV allow all leave planner conflicts" on public.leave_planner_conflicts;
create policy "DEV allow all leave planner conflicts"
on public.leave_planner_conflicts
for all
to public
using (true)
with check (true);

grant all on public.leave_types_config to anon, authenticated;
grant all on public.leave_rules to anon, authenticated;
grant all on public.leave_blackout_periods to anon, authenticated;
grant all on public.leave_peak_periods to anon, authenticated;
grant all on public.leave_public_holidays to anon, authenticated;
grant all on public.leave_accrual_runs to anon, authenticated;
grant all on public.leave_forecast_snapshots to anon, authenticated;
grant all on public.leave_planner_conflicts to anon, authenticated;

insert into public.leave_types_config (
  company_id,
  leave_type_code,
  leave_type_name,
  annual_entitlement_days,
  monthly_accrual_days,
  carry_forward_limit_days,
  carry_forward_expiry_months,
  maximum_balance_days,
  requires_attachment,
  requires_medical_certificate,
  is_custom,
  status
)
select c.id,
       seed.leave_type_code,
       seed.leave_type_name,
       seed.annual_entitlement_days,
       seed.monthly_accrual_days,
       seed.carry_forward_limit_days,
       seed.carry_forward_expiry_months,
       seed.maximum_balance_days,
       seed.requires_attachment,
       seed.requires_medical_certificate,
       seed.is_custom,
       'active'
from public.companies c
cross join (
  values
    ('annual_leave', 'Annual Leave', 15::numeric, 1.25::numeric, 5::numeric, 3::integer, 30::numeric, false, false, false),
    ('sick_leave', 'Sick Leave', 30::numeric, 2.5::numeric, 0::numeric, 0::integer, 30::numeric, true, true, false),
    ('family_responsibility_leave', 'Family Responsibility Leave', 3::numeric, 0.25::numeric, 0::numeric, 0::integer, 5::numeric, true, false, false),
    ('study_leave', 'Study Leave', 10::numeric, 0.83::numeric, 2::numeric, 6::integer, 12::numeric, true, false, false),
    ('maternity_leave', 'Maternity Leave', 120::numeric, 10::numeric, 0::numeric, 0::integer, 120::numeric, true, false, false),
    ('paternity_leave', 'Paternity Leave', 10::numeric, 0.83::numeric, 0::numeric, 0::integer, 10::numeric, true, false, false),
    ('compassionate_leave', 'Compassionate Leave', 5::numeric, 0.42::numeric, 0::numeric, 0::integer, 5::numeric, true, false, false)
) as seed(
  leave_type_code,
  leave_type_name,
  annual_entitlement_days,
  monthly_accrual_days,
  carry_forward_limit_days,
  carry_forward_expiry_months,
  maximum_balance_days,
  requires_attachment,
  requires_medical_certificate,
  is_custom
)
where not exists (
  select 1
  from public.leave_types_config existing
  where existing.company_id = c.id
    and existing.leave_type_code = seed.leave_type_code
);

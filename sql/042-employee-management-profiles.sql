-- Sprint 1: Employee Management profile persistence + audit table

create extension if not exists pgcrypto;

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

alter table public.employee_profiles enable row level security;
alter table public.employee_audit_history enable row level security;

drop policy if exists "DEV allow all employee profiles" on public.employee_profiles;
create policy "DEV allow all employee profiles"
on public.employee_profiles
for all
to public
using (true)
with check (true);

drop policy if exists "DEV allow all employee audit history" on public.employee_audit_history;
create policy "DEV allow all employee audit history"
on public.employee_audit_history
for all
to public
using (true)
with check (true);

grant all on public.employee_profiles to anon, authenticated;
grant all on public.employee_audit_history to anon, authenticated;

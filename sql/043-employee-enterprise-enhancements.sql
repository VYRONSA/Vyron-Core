-- Sprint 1: Employee enterprise enhancements (reuse existing employee_skills + employee_documents)

create extension if not exists pgcrypto;

create table if not exists public.employee_asset_assignments (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  employee_id uuid not null,
  asset_id uuid,
  assignment_type text not null default 'equipment',
  issued_date date not null default current_date,
  due_return_date date,
  returned_date date,
  status text not null default 'issued',
  serial_number text,
  notes text,
  created_at timestamptz not null default now()
);

create index if not exists employee_asset_assignments_company_id_idx on public.employee_asset_assignments (company_id);
create index if not exists employee_asset_assignments_employee_id_idx on public.employee_asset_assignments (employee_id);

create table if not exists public.employee_probation_records (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  employee_id uuid not null,
  probation_start_date date not null,
  probation_end_date date not null,
  review_frequency text not null default 'monthly',
  status text not null default 'active',
  review_notes text,
  confirmed_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists employee_probation_records_company_id_idx on public.employee_probation_records (company_id);
create index if not exists employee_probation_records_employee_id_idx on public.employee_probation_records (employee_id);

create table if not exists public.employee_employment_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  employee_id uuid not null,
  event_type text not null,
  effective_date date not null,
  from_value text,
  to_value text,
  reason text,
  notes text,
  created_at timestamptz not null default now()
);

create index if not exists employee_employment_events_company_id_idx on public.employee_employment_events (company_id);
create index if not exists employee_employment_events_employee_id_idx on public.employee_employment_events (employee_id);

create table if not exists public.employee_tags (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  tag_name text not null,
  color text,
  created_at timestamptz not null default now(),
  unique (company_id, tag_name)
);

create index if not exists employee_tags_company_id_idx on public.employee_tags (company_id);

create table if not exists public.employee_tag_links (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  employee_id uuid not null,
  tag_id uuid not null,
  created_at timestamptz not null default now(),
  unique (company_id, employee_id, tag_id)
);

create index if not exists employee_tag_links_company_id_idx on public.employee_tag_links (company_id);
create index if not exists employee_tag_links_employee_id_idx on public.employee_tag_links (employee_id);

create table if not exists public.employee_custom_fields (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  field_key text not null,
  field_label text not null,
  field_type text not null default 'text',
  required boolean not null default false,
  options jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  unique (company_id, field_key)
);

create index if not exists employee_custom_fields_company_id_idx on public.employee_custom_fields (company_id);

create table if not exists public.employee_custom_field_values (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  employee_id uuid not null,
  field_id uuid not null,
  value_text text,
  value_json jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  unique (company_id, employee_id, field_id)
);

create index if not exists employee_custom_field_values_company_id_idx on public.employee_custom_field_values (company_id);
create index if not exists employee_custom_field_values_employee_id_idx on public.employee_custom_field_values (employee_id);

create table if not exists public.employee_notes (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  employee_id uuid not null,
  note_body text not null,
  visibility text not null default 'internal',
  created_by text,
  created_at timestamptz not null default now()
);

create index if not exists employee_notes_company_id_idx on public.employee_notes (company_id);
create index if not exists employee_notes_employee_id_idx on public.employee_notes (employee_id);

alter table public.employee_asset_assignments enable row level security;
alter table public.employee_probation_records enable row level security;
alter table public.employee_employment_events enable row level security;
alter table public.employee_tags enable row level security;
alter table public.employee_tag_links enable row level security;
alter table public.employee_custom_fields enable row level security;
alter table public.employee_custom_field_values enable row level security;
alter table public.employee_notes enable row level security;

drop policy if exists "DEV allow all employee asset assignments" on public.employee_asset_assignments;
create policy "DEV allow all employee asset assignments"
on public.employee_asset_assignments
for all
to public
using (true)
with check (true);

drop policy if exists "DEV allow all employee probation records" on public.employee_probation_records;
create policy "DEV allow all employee probation records"
on public.employee_probation_records
for all
to public
using (true)
with check (true);

drop policy if exists "DEV allow all employee employment events" on public.employee_employment_events;
create policy "DEV allow all employee employment events"
on public.employee_employment_events
for all
to public
using (true)
with check (true);

drop policy if exists "DEV allow all employee tags" on public.employee_tags;
create policy "DEV allow all employee tags"
on public.employee_tags
for all
to public
using (true)
with check (true);

drop policy if exists "DEV allow all employee tag links" on public.employee_tag_links;
create policy "DEV allow all employee tag links"
on public.employee_tag_links
for all
to public
using (true)
with check (true);

drop policy if exists "DEV allow all employee custom fields" on public.employee_custom_fields;
create policy "DEV allow all employee custom fields"
on public.employee_custom_fields
for all
to public
using (true)
with check (true);

drop policy if exists "DEV allow all employee custom field values" on public.employee_custom_field_values;
create policy "DEV allow all employee custom field values"
on public.employee_custom_field_values
for all
to public
using (true)
with check (true);

drop policy if exists "DEV allow all employee notes" on public.employee_notes;
create policy "DEV allow all employee notes"
on public.employee_notes
for all
to public
using (true)
with check (true);

grant all on public.employee_asset_assignments to anon, authenticated;
grant all on public.employee_probation_records to anon, authenticated;
grant all on public.employee_employment_events to anon, authenticated;
grant all on public.employee_tags to anon, authenticated;
grant all on public.employee_tag_links to anon, authenticated;
grant all on public.employee_custom_fields to anon, authenticated;
grant all on public.employee_custom_field_values to anon, authenticated;
grant all on public.employee_notes to anon, authenticated;

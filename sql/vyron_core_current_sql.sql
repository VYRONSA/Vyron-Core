-- VYRON CORE FINAL CURRENT DEVELOPMENT SQL
-- Run only the parts you have not already run.

create extension if not exists pgcrypto;

-- VERIFIED CLOCKING
alter table public.stores
add column if not exists latitude numeric,
add column if not exists longitude numeric,
add column if not exists gps_radius_meters integer default 150;

alter table public.clock_events
add column if not exists photo_bucket text,
add column if not exists photo_path text,
add column if not exists photo_url text,
add column if not exists gps_accuracy_meters numeric,
add column if not exists gps_distance_from_store_meters numeric,
add column if not exists gps_verification_status text default 'not_checked',
add column if not exists photo_verification_status text default 'not_checked',
add column if not exists verification_status text default 'pending',
add column if not exists device_user_agent text,
add column if not exists device_platform text,
add column if not exists verification_notes text,
add column if not exists retain_photo_until date;

-- WORKFORCE MOVEMENT
create table if not exists public.employee_movements (
  id uuid primary key default gen_random_uuid(),
  company_id uuid,
  employee_id uuid not null,
  movement_type text not null,
  from_store_id uuid,
  to_store_id uuid,
  effective_date date not null,
  end_date date,
  instruction_text text,
  status text not null default 'scheduled',
  applied_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.employee_status_history (
  id uuid primary key default gen_random_uuid(),
  company_id uuid,
  employee_id uuid not null,
  previous_status text,
  new_status text not null,
  effective_date date not null,
  reason text,
  instruction_text text,
  created_at timestamptz not null default now()
);

-- ROSTER INTELLIGENCE
create table if not exists public.roster_generation_runs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid,
  store_id uuid,
  week_start date not null,
  week_end date not null,
  generation_mode text not null default 'pattern_based',
  status text not null default 'draft',
  notes text,
  created_at timestamptz not null default now()
);

-- CONTRACT CENTRE
create table if not exists public.contract_templates (
  id uuid primary key default gen_random_uuid(),
  company_id uuid,
  template_name text not null,
  document_type text not null default 'employment_contract',
  file_bucket text,
  file_path text,
  placeholder_schema jsonb not null default '{}'::jsonb,
  status text not null default 'active',
  created_at timestamptz not null default now()
);

alter table public.contract_templates
add column if not exists template_body text;

create table if not exists public.employee_generated_documents (
  id uuid primary key default gen_random_uuid(),
  company_id uuid,
  employee_id uuid not null,
  template_id uuid,
  document_type text not null,
  document_title text not null,
  filled_values jsonb not null default '{}'::jsonb,
  file_bucket text,
  file_path text,
  signature_status text not null default 'unsigned',
  signed_at timestamptz,
  signed_by_name text,
  signature_bucket text,
  signature_path text,
  audit_ip text,
  audit_user_agent text,
  created_at timestamptz not null default now()
);

alter table public.employee_generated_documents
add column if not exists generated_word_html text;

create table if not exists public.digital_signatures (
  id uuid primary key default gen_random_uuid(),
  company_id uuid,
  employee_id uuid not null,
  document_id uuid,
  signature_bucket text,
  signature_path text,
  signer_name text,
  signer_role text default 'employee',
  signed_at timestamptz not null default now(),
  ip_address text,
  user_agent text,
  consent_text text
);

create table if not exists public.document_signing_links (
  id uuid primary key default gen_random_uuid(),
  company_id uuid,
  employee_id uuid not null,
  document_id uuid not null,
  signing_token text not null unique,
  delivery_channel text not null default 'whatsapp',
  recipient_phone text,
  status text not null default 'active',
  expires_at timestamptz,
  opened_at timestamptz,
  signed_at timestamptz,
  created_at timestamptz not null default now()
);

-- STORAGE BUCKETS
insert into storage.buckets (id, name, public)
values
  ('clocking-photos', 'clocking-photos', false),
  ('hr-contract-templates', 'hr-contract-templates', false),
  ('hr-signed-documents', 'hr-signed-documents', false),
  ('hr-signatures', 'hr-signatures', false)
on conflict (id) do nothing;

-- DEVELOPMENT RLS UNLOCKS
-- Use for local development only. Before launch, replace with proper company/user policies.

drop policy if exists "DEV allow all employee movements" on public.employee_movements;
create policy "DEV allow all employee movements"
on public.employee_movements
for all
to public
using (true)
with check (true);
grant all on public.employee_movements to anon, authenticated;

drop policy if exists "DEV allow all employee status history" on public.employee_status_history;
create policy "DEV allow all employee status history"
on public.employee_status_history
for all
to public
using (true)
with check (true);
grant all on public.employee_status_history to anon, authenticated;

drop policy if exists "DEV allow all roster generation runs" on public.roster_generation_runs;
create policy "DEV allow all roster generation runs"
on public.roster_generation_runs
for all
to public
using (true)
with check (true);
grant all on public.roster_generation_runs to anon, authenticated;

drop policy if exists "DEV allow all roster shifts" on public.roster_shifts;
create policy "DEV allow all roster shifts"
on public.roster_shifts
for all
to public
using (true)
with check (true);
grant all on public.roster_shifts to anon, authenticated;

drop policy if exists "DEV allow all contract templates" on public.contract_templates;
create policy "DEV allow all contract templates"
on public.contract_templates
for all
to public
using (true)
with check (true);
grant all on public.contract_templates to anon, authenticated;

drop policy if exists "DEV allow all employee generated documents" on public.employee_generated_documents;
create policy "DEV allow all employee generated documents"
on public.employee_generated_documents
for all
to public
using (true)
with check (true);
grant all on public.employee_generated_documents to anon, authenticated;

drop policy if exists "DEV allow all digital signatures" on public.digital_signatures;
create policy "DEV allow all digital signatures"
on public.digital_signatures
for all
to public
using (true)
with check (true);
grant all on public.digital_signatures to anon, authenticated;

drop policy if exists "DEV allow all document signing links" on public.document_signing_links;
create policy "DEV allow all document signing links"
on public.document_signing_links
for all
to public
using (true)
with check (true);
grant all on public.document_signing_links to anon, authenticated;

-- STORAGE POLICIES
drop policy if exists "DEV allow all storage objects" on storage.objects;
create policy "DEV allow all storage objects"
on storage.objects
for all
to public
using (true)
with check (true);
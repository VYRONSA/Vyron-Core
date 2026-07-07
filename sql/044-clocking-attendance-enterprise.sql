-- Sprint 2: Clocking & Attendance enterprise enhancements

create extension if not exists pgcrypto;

create table if not exists public.attendance_geofences (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  geofence_type text not null default 'store',
  store_id uuid,
  job_id uuid,
  geofence_name text not null,
  latitude numeric not null,
  longitude numeric not null,
  radius_meters integer not null default 150,
  status text not null default 'active',
  created_at timestamptz not null default now()
);

create index if not exists attendance_geofences_company_id_idx on public.attendance_geofences (company_id);
create index if not exists attendance_geofences_store_id_idx on public.attendance_geofences (store_id);

create table if not exists public.attendance_corrections (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  employee_id uuid not null,
  clock_event_id uuid,
  correction_type text not null,
  requested_event_time timestamptz,
  requested_store_id uuid,
  reason text not null,
  status text not null default 'pending',
  reviewed_by text,
  reviewed_at timestamptz,
  review_notes text,
  original_record jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

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
  company_id uuid not null,
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
  company_id uuid not null,
  provider text not null,
  external_event_id text,
  raw_payload jsonb not null default '{}'::jsonb,
  normalized_payload jsonb not null default '{}'::jsonb,
  ingestion_status text not null default 'received',
  ingested_at timestamptz not null default now()
);

create index if not exists attendance_device_events_company_id_idx on public.attendance_device_events (company_id);
create index if not exists attendance_device_events_provider_idx on public.attendance_device_events (provider);

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

alter table public.attendance_geofences enable row level security;
alter table public.attendance_corrections enable row level security;
alter table public.attendance_correction_audit enable row level security;
alter table public.attendance_review_notes enable row level security;
alter table public.attendance_device_events enable row level security;
alter table public.attendance_pin_failures enable row level security;

drop policy if exists "DEV allow all attendance geofences" on public.attendance_geofences;
create policy "DEV allow all attendance geofences"
on public.attendance_geofences
for all
to public
using (true)
with check (true);

drop policy if exists "DEV allow all attendance corrections" on public.attendance_corrections;
create policy "DEV allow all attendance corrections"
on public.attendance_corrections
for all
to public
using (true)
with check (true);

drop policy if exists "DEV allow all attendance correction audit" on public.attendance_correction_audit;
create policy "DEV allow all attendance correction audit"
on public.attendance_correction_audit
for all
to public
using (true)
with check (true);

drop policy if exists "DEV allow all attendance review notes" on public.attendance_review_notes;
create policy "DEV allow all attendance review notes"
on public.attendance_review_notes
for all
to public
using (true)
with check (true);

drop policy if exists "DEV allow all attendance device events" on public.attendance_device_events;
create policy "DEV allow all attendance device events"
on public.attendance_device_events
for all
to public
using (true)
with check (true);

drop policy if exists "DEV allow all attendance pin failures" on public.attendance_pin_failures;
create policy "DEV allow all attendance pin failures"
on public.attendance_pin_failures
for all
to public
using (true)
with check (true);

grant all on public.attendance_geofences to anon, authenticated;
grant all on public.attendance_corrections to anon, authenticated;
grant all on public.attendance_correction_audit to anon, authenticated;
grant all on public.attendance_review_notes to anon, authenticated;
grant all on public.attendance_device_events to anon, authenticated;
grant all on public.attendance_pin_failures to anon, authenticated;

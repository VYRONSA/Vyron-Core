-- Sprint 5: Payroll Readiness & Workforce Validation Excellence

create extension if not exists pgcrypto;

do $$
begin
  if to_regclass('public.companies') is null then
    raise exception 'Prerequisite missing: public.companies. Run migration 001-create-companies-tables.sql (or 000-run-all-companies.sql) before 047-payroll-readiness-workforce-validation-excellence.sql.';
  end if;
end $$;

create table if not exists public.payroll_readiness_timeline (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  pay_period_id uuid,
  event_type text not null,
  title text not null,
  detail text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.payroll_readiness_notifications (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  pay_period_id uuid,
  recipient_role text not null,
  status text not null default 'pending',
  title text not null,
  body text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  delivered_at timestamptz
);

create table if not exists public.payroll_export_preparations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  pay_period_id uuid,
  target_platform text not null,
  preparation_status text not null default 'prepared',
  rows_prepared integer not null default 0,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.payroll_readiness_timeline
  add column if not exists pay_period_id uuid,
  add column if not exists metadata jsonb not null default '{}'::jsonb;

alter table public.payroll_readiness_notifications
  add column if not exists pay_period_id uuid,
  add column if not exists metadata jsonb not null default '{}'::jsonb,
  add column if not exists delivered_at timestamptz;

alter table public.payroll_export_preparations
  add column if not exists pay_period_id uuid,
  add column if not exists payload jsonb not null default '{}'::jsonb;

alter table public.payroll_readiness_timeline
  drop constraint if exists payroll_readiness_timeline_event_type_check;
alter table public.payroll_readiness_timeline
  add constraint payroll_readiness_timeline_event_type_check
  check (event_type in ('validation', 'correction', 'approval', 'export', 'history'));

alter table public.payroll_readiness_notifications
  drop constraint if exists payroll_readiness_notifications_role_check;
alter table public.payroll_readiness_notifications
  add constraint payroll_readiness_notifications_role_check
  check (recipient_role in ('manager', 'supervisor', 'hr', 'owner'));

alter table public.payroll_readiness_notifications
  drop constraint if exists payroll_readiness_notifications_status_check;
alter table public.payroll_readiness_notifications
  add constraint payroll_readiness_notifications_status_check
  check (status in ('pending', 'delivered', 'read', 'failed'));

alter table public.payroll_export_preparations
  drop constraint if exists payroll_export_preparations_target_check;
alter table public.payroll_export_preparations
  add constraint payroll_export_preparations_target_check
  check (target_platform in ('vyron_pay', 'sage', 'payspace', 'vip', 'csv', 'excel'));

alter table public.payroll_export_preparations
  drop constraint if exists payroll_export_preparations_status_check;
alter table public.payroll_export_preparations
  add constraint payroll_export_preparations_status_check
  check (preparation_status in ('prepared', 'failed'));

do $$
begin
  if to_regclass('public.payroll_readiness_checks') is not null then
    alter table public.payroll_readiness_checks
      drop constraint if exists payroll_readiness_checks_type_check;

    alter table public.payroll_readiness_checks
      add constraint payroll_readiness_checks_type_check
      check (
        check_type in (
          'missing_clock_out',
          'missing_clock_in',
          'unapproved_leave',
          'roster_mismatch',
          'unresolved_exception',
          'open_field_job',
          'missing_end_day',
          'pending_attendance_correction',
          'negative_leave_balance',
          'duplicate_clock',
          'unapproved_overtime',
          'roster_conflict',
          'missing_supervisor_approval',
          'pending_shift_approval'
        )
      );
  else
    raise notice 'Skipping payroll_readiness_checks constraint update because table public.payroll_readiness_checks does not exist.';
  end if;
end $$;

create index if not exists payroll_readiness_timeline_company_idx
  on public.payroll_readiness_timeline (company_id, created_at desc);
create index if not exists payroll_readiness_notifications_company_idx
  on public.payroll_readiness_notifications (company_id, status, created_at desc);
create index if not exists payroll_export_preparations_company_idx
  on public.payroll_export_preparations (company_id, target_platform, created_at desc);

alter table public.payroll_readiness_timeline enable row level security;
alter table public.payroll_readiness_notifications enable row level security;
alter table public.payroll_export_preparations enable row level security;

drop policy if exists payroll_readiness_timeline_all on public.payroll_readiness_timeline;
create policy payroll_readiness_timeline_all
on public.payroll_readiness_timeline
for all
to authenticated
using (true)
with check (true);

drop policy if exists payroll_readiness_notifications_all on public.payroll_readiness_notifications;
create policy payroll_readiness_notifications_all
on public.payroll_readiness_notifications
for all
to authenticated
using (true)
with check (true);

drop policy if exists payroll_export_preparations_all on public.payroll_export_preparations;
create policy payroll_export_preparations_all
on public.payroll_export_preparations
for all
to authenticated
using (true)
with check (true);

grant all on public.payroll_readiness_timeline to anon, authenticated;
grant all on public.payroll_readiness_notifications to anon, authenticated;
grant all on public.payroll_export_preparations to anon, authenticated;

notify pgrst, 'reload schema';

-- =====================================================
-- DAY 25 CLIENT ONBOARDING
-- VYRON CORE FINAL COMPLETION PACK
-- =====================================================


create table if not exists public.client_onboarding_steps (
  id uuid primary key default gen_random_uuid(),
  step_order integer not null,
  step_title text not null,
  step_description text not null,
  status text not null default 'pending',
  owner text,
  completed_at timestamp with time zone,
  created_at timestamp with time zone not null default now(),
  constraint client_onboarding_status_check check (status in ('pending','in_progress','done','blocked'))
);

alter table public.client_onboarding_steps enable row level security;

drop policy if exists "dev onboarding all" on public.client_onboarding_steps;
create policy "dev onboarding all"
on public.client_onboarding_steps
for all
using (true)
with check (true);

insert into public.client_onboarding_steps(step_order, step_title, step_description)
values
(1, 'Company setup', 'Add company settings, payroll cycle and admin users.'),
(2, 'Stores setup', 'Load all stores/locations and opening rules.'),
(3, 'Employees import', 'Load employees with employee numbers and PINs.'),
(4, 'Roster setup', 'Create initial roster templates.'),
(5, 'Clocking test', 'Test employee clocking and GPS.'),
(6, 'Leave test', 'Test employee leave request and manager approval.'),
(7, 'Payroll test', 'Generate payroll checks and exceptions.'),
(8, 'Export test', 'Export payroll and HR reports.')
on conflict do nothing;

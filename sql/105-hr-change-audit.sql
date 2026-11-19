-- =====================================================================================
-- 105 — Audit trail for employee, roster and HR configuration changes (D34)
-- =====================================================================================
-- NOT APPLIED TO PRODUCTION. Requires separate written approval. Depends on 100, 101, 102, 103.
-- Idempotent. Rollback: sql/105-rollback.sql.
--
-- Clockings (101), payroll (103) and leave decisions (existing trigger) were already audited.
-- This adds the rest of the operational record: who changed an employee, a shift, a leave
-- balance, a store, a user's access or a company setting — when, and from what to what.
-- Only changed fields are stored. PINs are never written to the audit (shown as "***").
-- =====================================================================================

begin;

create table if not exists public.hr_change_audit (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid,
  table_name    text not null,
  record_id     text,
  action        text not null check (action in ('insert','update','delete')),
  actor_user_id uuid,
  actor_email   text,
  actor_role    text,
  changes       jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now()
);
create index if not exists hr_change_audit_company_idx on public.hr_change_audit (company_id, created_at desc);
create index if not exists hr_change_audit_record_idx on public.hr_change_audit (table_name, record_id);

alter table public.hr_change_audit enable row level security;
drop policy if exists hr_change_audit_select_v105 on public.hr_change_audit;
create policy hr_change_audit_select_v105 on public.hr_change_audit for select to authenticated
  using ((select public.vyron_is_platform_operator()) or company_id in (select public.vyron_manager_company_ids()));
revoke all on public.hr_change_audit from anon, authenticated;
grant select on public.hr_change_audit to authenticated;

create or replace function public.vyron_audit_hr_change()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_old jsonb := case when tg_op = 'INSERT' then '{}'::jsonb else to_jsonb(old) end;
  v_new jsonb := case when tg_op = 'DELETE' then '{}'::jsonb else to_jsonb(new) end;
  v_row jsonb := case when tg_op = 'DELETE' then v_old else v_new end;
  v_changes jsonb := '{}'::jsonb;
  v_company uuid;
  k text;
  ignored constant text[] := array['updated_at', 'last_seen_at', 'last_login_at', 'last_pin_login_at',
                                   'pin_login_attempts', 'pin_locked_until', 'pin_configured'];
begin
  for k in select jsonb_object_keys(v_old || v_new) loop
    continue when k = any (ignored);
    if (v_old -> k) is distinct from (v_new -> k) then
      v_changes := v_changes || jsonb_build_object(k, jsonb_build_object(
        'from', case when k = 'pin_code' and v_old ? k then to_jsonb('***'::text) else v_old -> k end,
        'to',   case when k = 'pin_code' and v_new ? k then to_jsonb('***'::text) else v_new -> k end));
    end if;
  end loop;
  if tg_op = 'UPDATE' and v_changes = '{}'::jsonb then
    return null;   -- nothing material changed (e.g. a heartbeat)
  end if;

  v_company := nullif(v_row ->> 'company_id', '')::uuid;
  if v_company is null and (v_row ->> 'employee_id') is not null then
    select e.company_id into v_company from public.employees e where e.id::text = v_row ->> 'employee_id';
  end if;

  insert into public.hr_change_audit (company_id, table_name, record_id, action, actor_user_id,
                                      actor_email, actor_role, changes)
  values (v_company, tg_table_name, coalesce(v_row ->> 'id', v_row ->> 'company_id'), lower(tg_op), auth.uid(),
          nullif(public.vyron_jwt_email(), ''), coalesce(auth.jwt() ->> 'role', current_user), v_changes);
  return null;
end $$;
revoke all on function public.vyron_audit_hr_change() from public, anon, authenticated;

do $$
declare t text;
begin
  foreach t in array array['employees', 'roster_shifts', 'leave_balances', 'stores', 'company_users',
                           'attendance_settings', 'payroll_settings', 'employee_profiles',
                           'attendance_geofences', 'shift_templates', 'leave_public_holidays'] loop
    if to_regclass('public.' || t) is null then continue; end if;
    execute format('drop trigger if exists trg_vyron_audit_hr_change on public.%I', t);
    execute format('create trigger trg_vyron_audit_hr_change after insert or update or delete on public.%I
                    for each row execute function public.vyron_audit_hr_change()', t);
  end loop;
end $$;

notify pgrst, 'reload schema';

commit;

-- =====================================================================================
-- 100 — Security and role hardening (UMORA remediation, Phase 1)
-- =====================================================================================
-- NOT APPLIED TO PRODUCTION. Requires separate written approval before it is run there.
-- Target: production baseline gpiqkwebizuqajgaoxhm (legacy schema + 090–092 hardening).
-- Idempotent: safe to re-run. Rollback: sql/100-rollback.sql.
--
-- Closes (see docs/remediation/UMORA-REMEDIATION-PLAN.md):
--   D05 employee self-promotion / admin deactivation / editing colleagues, rates, rosters
--   D06 cross-company account takeover (row login id must match its e-mail's auth user)
--   D03 PIN exposure (hashed PIN store, pin_code no longer readable by browser sessions)
--   D17 deactivated users keeping access (legacy permissive read policies removed)
--   D30 HR storage without role checks; clock photos planted in colleagues' folders
--   D35 platform audit log readable / editable by any signed-up user
--   D29 (database part) users un-revoking their own sessions
-- Clock-event writes stay manager-only here; 101 replaces them with server-side functions.
-- =====================================================================================

begin;

-- -------------------------------------------------------------------------------------
-- 1. Role helpers
-- -------------------------------------------------------------------------------------
create or replace function public.vyron_jwt_email()
returns text language sql stable security definer set search_path = public as $$
  select lower(coalesce(auth.jwt() ->> 'email', ''));
$$;

-- Highest active role the signed-in user holds in a company (null when not a member).
create or replace function public.vyron_company_role(p_company_id uuid)
returns text language sql stable security definer set search_path = public as $$
  select cu.role
  from public.company_users cu
  where cu.company_id = p_company_id
    and cu.status = 'active'
    and cu.deleted_at is null
    and lower(cu.user_email) = public.vyron_jwt_email()
    and public.vyron_jwt_email() <> ''
  order by case cu.role
             when 'owner' then 1 when 'platform_admin' then 2 when 'admin' then 3
             when 'hr_manager' then 4 when 'operations_manager' then 5 when 'payroll' then 6
             when 'manager' then 7 when 'supervisor' then 8 else 9 end
  limit 1;
$$;

create or replace function public.vyron_admin_roles()
returns text[] language sql immutable as $$ select array['owner','platform_admin','admin']; $$;

create or replace function public.vyron_manager_roles()
returns text[] language sql immutable as $$
  select array['owner','platform_admin','admin','hr_manager','operations_manager','manager','supervisor','payroll'];
$$;

-- Companies where the user may manage people, attendance, leave and payroll.
create or replace function public.vyron_manager_company_ids()
returns setof uuid language sql stable security definer set search_path = public as $$
  select distinct cu.company_id
  from public.company_users cu
  where cu.status = 'active' and cu.deleted_at is null and cu.company_id is not null
    and lower(cu.user_email) = public.vyron_jwt_email() and public.vyron_jwt_email() <> ''
    and cu.role = any (public.vyron_manager_roles());
$$;

-- Companies where the user is owner/admin (user and access administration).
create or replace function public.vyron_admin_company_ids()
returns setof uuid language sql stable security definer set search_path = public as $$
  select distinct cu.company_id
  from public.company_users cu
  where cu.status = 'active' and cu.deleted_at is null and cu.company_id is not null
    and lower(cu.user_email) = public.vyron_jwt_email() and public.vyron_jwt_email() <> ''
    and cu.role = any (public.vyron_admin_roles());
$$;

-- Employee records that belong to the signed-in person (by auth id or verified e-mail).
create or replace function public.vyron_my_employee_ids()
returns setof uuid language sql stable security definer set search_path = public as $$
  select e.id
  from public.employees e
  where e.company_id in (select public.vyron_user_company_ids())
    and (e.auth_user_id = auth.uid()
         or (e.email is not null and lower(e.email) = public.vyron_jwt_email() and public.vyron_jwt_email() <> ''));
$$;

create or replace function public.vyron_is_company_manager(p_company_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select (select public.vyron_is_platform_operator())
      or coalesce(public.vyron_company_role(p_company_id) = any (public.vyron_manager_roles()), false);
$$;

create or replace function public.vyron_is_company_admin(p_company_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select (select public.vyron_is_platform_operator())
      or coalesce(public.vyron_company_role(p_company_id) = any (public.vyron_admin_roles()), false);
$$;

-- Kiosk role: a shared clocking device's login. It may list the company's staff for clocking
-- and record clockings with each employee's PIN — and nothing else. It is deliberately NOT in
-- vyron_manager_roles(), so every manager policy (HR, payroll, attendance edits) denies it.
alter table public.company_users drop constraint if exists company_users_role_check;
alter table public.company_users add constraint company_users_role_check check (role = any (array[
  'platform_admin','admin','owner','hr_manager','operations_manager','supervisor','payroll',
  'employee','manager','staff','kiosk']));

create or replace function public.vyron_kiosk_company_ids()
returns setof uuid language sql stable security definer set search_path = public as $$
  select distinct cu.company_id
  from public.company_users cu
  where cu.status = 'active' and cu.deleted_at is null and cu.company_id is not null
    and lower(cu.user_email) = public.vyron_jwt_email() and public.vyron_jwt_email() <> ''
    and cu.role = 'kiosk';
$$;

-- May operate clocking for a company's staff (PIN required): managers and kiosk devices.
create or replace function public.vyron_is_clock_operator(p_company_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.vyron_is_company_manager(p_company_id)
      or p_company_id in (select public.vyron_kiosk_company_ids());
$$;

do $$
declare f text;
begin
  foreach f in array array[
    'vyron_jwt_email()', 'vyron_company_role(uuid)', 'vyron_manager_company_ids()',
    'vyron_admin_company_ids()', 'vyron_my_employee_ids()', 'vyron_is_company_manager(uuid)',
    'vyron_is_company_admin(uuid)', 'vyron_kiosk_company_ids()', 'vyron_is_clock_operator(uuid)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated, service_role', f);
  end loop;
end $$;

-- -------------------------------------------------------------------------------------
-- 2. company_users guard (D05, D06)
-- -------------------------------------------------------------------------------------
create or replace function public.vyron_guard_company_users()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_jwt_role   text    := coalesce(auth.jwt() ->> 'role', '');
  v_email      text    := public.vyron_jwt_email();
  v_actor_role text;
  v_auth_id    uuid;
  v_remaining  integer;
  v_target     public.company_users;
begin
  -- (a) Identity consistency — every caller, including the service role.
  --     A membership may only point at the auth account that owns its e-mail address.
  if tg_op in ('INSERT', 'UPDATE') then
    if tg_op = 'INSERT'
       or new.user_id is distinct from old.user_id
       or new.auth_user_id is distinct from old.auth_user_id
       or lower(coalesce(new.user_email, '')) is distinct from lower(coalesce(old.user_email, '')) then
      if new.user_id is not null or new.auth_user_id is not null then
        select u.id into v_auth_id from auth.users u
        where lower(u.email) = lower(coalesce(new.user_email, '')) limit 1;
        if v_auth_id is null
           or (new.user_id is not null and new.user_id <> v_auth_id)
           or (new.auth_user_id is not null and new.auth_user_id <> v_auth_id) then
          raise exception 'Membership sign-in account does not match its e-mail address.'
            using errcode = '42501';
        end if;
      end if;
    end if;
  end if;

  -- (b) Role rules apply to browser sessions only; service role and SQL run as admin.
  if v_jwt_role <> 'authenticated' or (select public.vyron_is_platform_operator()) then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  v_target := case when tg_op = 'DELETE' then old else new end;
  v_actor_role := public.vyron_company_role(v_target.company_id);

  if tg_op = 'UPDATE' then
    if new.company_id is distinct from old.company_id then
      raise exception 'A membership cannot be moved to another company.' using errcode = '42501';
    end if;

    -- Own row: personal bookkeeping only, never access fields.
    if lower(coalesce(old.user_email, '')) = v_email then
      if new.role is distinct from old.role
         or new.status is distinct from old.status
         or lower(coalesce(new.user_email, '')) is distinct from lower(coalesce(old.user_email, ''))
         or new.user_id is distinct from old.user_id
         or new.auth_user_id is distinct from old.auth_user_id
         or new.deleted_at is distinct from old.deleted_at
         or new.deactivated_at is distinct from old.deactivated_at
         or new.module_access is distinct from old.module_access
         or new.module_permissions is distinct from old.module_permissions
         or (new.must_change_password is distinct from old.must_change_password
             and coalesce(new.must_change_password, false) = true) then
        raise exception 'You cannot change your own access, role or status.' using errcode = '42501';
      end if;
      return new;
    end if;
  end if;

  if not coalesce(v_actor_role = any (public.vyron_admin_roles()), false) then
    raise exception 'Only a company owner or administrator can manage user access.' using errcode = '42501';
  end if;

  if tg_op in ('UPDATE', 'DELETE') and old.role = 'owner' and v_actor_role <> 'owner' then
    raise exception 'Only an owner can change an owner''s access.' using errcode = '42501';
  end if;
  if tg_op in ('INSERT', 'UPDATE') and new.role in ('owner', 'platform_admin')
     and (tg_op = 'INSERT' or old.role is distinct from new.role) and v_actor_role <> 'owner' then
    raise exception 'Only an owner can grant the owner role.' using errcode = '42501';
  end if;

  -- Never leave a company without an active owner/administrator.
  if tg_op in ('UPDATE', 'DELETE')
     and old.role = any (public.vyron_admin_roles()) and old.status = 'active' and old.deleted_at is null
     and (tg_op = 'DELETE'
          or not (new.role = any (public.vyron_admin_roles()))
          or new.status <> 'active'
          or new.deleted_at is not null) then
    select count(*) into v_remaining
    from public.company_users cu
    where cu.company_id = old.company_id and cu.id <> old.id
      and cu.role = any (public.vyron_admin_roles()) and cu.status = 'active' and cu.deleted_at is null;
    if v_remaining = 0 then
      raise exception 'This is the last active administrator of the company.' using errcode = '42501';
    end if;
  end if;

  return case when tg_op = 'DELETE' then old else new end;
end $$;

revoke all on function public.vyron_guard_company_users() from public, anon, authenticated;

-- Runs after set_company_user_user_id (alphabetical order of BEFORE triggers: "trg_set…" < "zz_…").
drop trigger if exists zz_vyron_guard_company_users on public.company_users;
create trigger zz_vyron_guard_company_users
  before insert or update or delete on public.company_users
  for each row execute function public.vyron_guard_company_users();

-- company_users policies: own row, managers see their company directory, admins write.
drop policy if exists company_users_tenant_isolation on public.company_users;
drop policy if exists company_users_select_v100 on public.company_users;
drop policy if exists company_users_insert_v100 on public.company_users;
drop policy if exists company_users_update_v100 on public.company_users;
create policy company_users_select_v100 on public.company_users for select to authenticated
  using ((select public.vyron_is_platform_operator())
         or lower(user_email) = public.vyron_jwt_email()
         or company_id in (select public.vyron_manager_company_ids()));
create policy company_users_insert_v100 on public.company_users for insert to authenticated
  with check ((select public.vyron_is_platform_operator()) or company_id in (select public.vyron_admin_company_ids()));
create policy company_users_update_v100 on public.company_users for update to authenticated
  using ((select public.vyron_is_platform_operator())
         or lower(user_email) = public.vyron_jwt_email()
         or company_id in (select public.vyron_admin_company_ids()))
  with check ((select public.vyron_is_platform_operator())
         or lower(user_email) = public.vyron_jwt_email()
         or company_id in (select public.vyron_admin_company_ids()));

-- -------------------------------------------------------------------------------------
-- 3. Legacy permissive read policies (no status / deletion check) — D17
-- -------------------------------------------------------------------------------------
drop policy if exists "Company users can view employees"       on public.employees;
drop policy if exists "Company users can view clock events"    on public.clock_events;
drop policy if exists "Company users can view HR cases"        on public.hr_cases;
drop policy if exists "Company users can view payroll batches" on public.payroll_batches;
drop policy if exists "Company users can view rosters"         on public.roster_shifts;
drop policy if exists "Company users can view stores"          on public.stores;
drop policy if exists "Company users can view exceptions"      on public.time_exceptions;
drop policy if exists "Users can view their companies"         on public.companies;
drop policy if exists "Users can view their own company user rows" on public.company_users;

drop policy if exists companies_member_select_v100 on public.companies;
create policy companies_member_select_v100 on public.companies for select to authenticated
  using ((select public.vyron_is_platform_operator()) or id in (select public.vyron_user_company_ids()));

-- -------------------------------------------------------------------------------------
-- 4. Role-aware policies: managers manage; employees read only their own rows
-- -------------------------------------------------------------------------------------
-- 4a. Tables with company_id + employee_id: generic manager-write / self-read policies.
do $$
declare
  t text;
  self_match text;
begin
  foreach t in array array['roster_shifts','time_exceptions','approved_time_records',
                           'payroll_hours','payroll_clock_checks','hr_warnings','clock_events'] loop
    if to_regclass('public.' || t) is null then continue; end if;
    -- Compare in the column's own type so the employee index can be used (a text cast forces
    -- a per-row comparison over the whole company).
    select case when data_type = 'uuid'
                then 'employee_id in (select m from public.vyron_my_employee_ids() m)'
                else 'employee_id::text in (select m::text from public.vyron_my_employee_ids() m)' end
      into self_match
      from information_schema.columns
     where table_schema = 'public' and table_name = t and column_name = 'employee_id';
    execute format('drop policy if exists %I on public.%I', t || '_tenant_isolation', t);
    execute format('drop policy if exists %I on public.%I', t || '_tenant_select', t);
    execute format('drop policy if exists %I on public.%I', t || '_tenant_update', t);
    execute format('drop policy if exists %I on public.%I', t || '_select_v100', t);
    execute format('drop policy if exists %I on public.%I', t || '_insert_v100', t);
    execute format('drop policy if exists %I on public.%I', t || '_update_v100', t);
    execute format('drop policy if exists %I on public.%I', t || '_delete_v100', t);
    execute format($p$create policy %I on public.%I for select to authenticated using (
        (select public.vyron_is_platform_operator())
        or company_id in (select public.vyron_manager_company_ids())
        or (company_id in (select public.vyron_user_company_ids())
            and %s))$p$,
      t || '_select_v100', t, self_match);
    execute format($p$create policy %I on public.%I for insert to authenticated with check (
        (select public.vyron_is_platform_operator()) or company_id in (select public.vyron_manager_company_ids()))$p$,
      t || '_insert_v100', t);
    execute format($p$create policy %I on public.%I for update to authenticated
        using ((select public.vyron_is_platform_operator()) or company_id in (select public.vyron_manager_company_ids()))
        with check ((select public.vyron_is_platform_operator()) or company_id in (select public.vyron_manager_company_ids()))$p$,
      t || '_update_v100', t);
    execute format($p$create policy %I on public.%I for delete to authenticated using (
        (select public.vyron_is_platform_operator()) or company_id in (select public.vyron_manager_company_ids()))$p$,
      t || '_delete_v100', t);
  end loop;
end $$;

-- 4b. Manager-only tables (no employee self access).
do $$
declare
  t text;
begin
  foreach t in array array['hr_cases','payroll_batches','payroll_export_logs'] loop
    if to_regclass('public.' || t) is null then continue; end if;
    execute format('drop policy if exists %I on public.%I', t || '_tenant_isolation', t);
    execute format('drop policy if exists %I on public.%I', t || '_tenant_select', t);
    execute format('drop policy if exists %I on public.%I', t || '_tenant_insert', t);
    execute format('drop policy if exists %I on public.%I', t || '_manager_v100', t);
    execute format($p$create policy %I on public.%I for all to authenticated
        using ((select public.vyron_is_platform_operator()) or company_id in (select public.vyron_manager_company_ids()))
        with check ((select public.vyron_is_platform_operator()) or company_id in (select public.vyron_manager_company_ids()))$p$,
      t || '_manager_v100', t);
  end loop;
end $$;

-- 4c. employees: managers manage; an employee reads only their own record; admins delete.
drop policy if exists employees_tenant_isolation on public.employees;
drop policy if exists employees_select_v100 on public.employees;
drop policy if exists employees_insert_v100 on public.employees;
drop policy if exists employees_update_v100 on public.employees;
drop policy if exists employees_delete_v100 on public.employees;
create policy employees_select_v100 on public.employees for select to authenticated
  using ((select public.vyron_is_platform_operator())
         or company_id in (select public.vyron_manager_company_ids())
         or id in (select public.vyron_my_employee_ids()));
create policy employees_insert_v100 on public.employees for insert to authenticated
  with check ((select public.vyron_is_platform_operator()) or company_id in (select public.vyron_manager_company_ids()));
create policy employees_update_v100 on public.employees for update to authenticated
  using ((select public.vyron_is_platform_operator()) or company_id in (select public.vyron_manager_company_ids()))
  with check ((select public.vyron_is_platform_operator()) or company_id in (select public.vyron_manager_company_ids()));
create policy employees_delete_v100 on public.employees for delete to authenticated
  using ((select public.vyron_is_platform_operator()) or company_id in (select public.vyron_admin_company_ids()));

-- 4d. stores: every member reads; managers write.
drop policy if exists stores_tenant_isolation on public.stores;
drop policy if exists stores_select_v100 on public.stores;
drop policy if exists stores_write_v100 on public.stores;
create policy stores_select_v100 on public.stores for select to authenticated
  using ((select public.vyron_is_platform_operator()) or company_id in (select public.vyron_user_company_ids()));
create policy stores_write_v100 on public.stores for all to authenticated
  using ((select public.vyron_is_platform_operator()) or company_id in (select public.vyron_manager_company_ids()))
  with check ((select public.vyron_is_platform_operator()) or company_id in (select public.vyron_manager_company_ids()));

-- 4e. leave_requests: an employee files and edits only their own PENDING request; managers decide.
drop policy if exists leave_requests_tenant_isolation on public.leave_requests;
drop policy if exists leave_requests_select_v100 on public.leave_requests;
drop policy if exists leave_requests_insert_v100 on public.leave_requests;
drop policy if exists leave_requests_update_v100 on public.leave_requests;
create policy leave_requests_select_v100 on public.leave_requests for select to authenticated
  using ((select public.vyron_is_platform_operator())
         or company_id in (select public.vyron_manager_company_ids())
         or employee_id in (select m::text from public.vyron_my_employee_ids() m));
create policy leave_requests_insert_v100 on public.leave_requests for insert to authenticated
  with check ((select public.vyron_is_platform_operator())
         or company_id in (select public.vyron_manager_company_ids())
         or (company_id in (select public.vyron_user_company_ids())
             and employee_id in (select m::text from public.vyron_my_employee_ids() m)
             and coalesce(status, 'pending') = 'pending'));
create policy leave_requests_update_v100 on public.leave_requests for update to authenticated
  using ((select public.vyron_is_platform_operator())
         or company_id in (select public.vyron_manager_company_ids())
         or (employee_id in (select m::text from public.vyron_my_employee_ids() m) and status = 'pending'))
  with check ((select public.vyron_is_platform_operator())
         or company_id in (select public.vyron_manager_company_ids())
         or (employee_id in (select m::text from public.vyron_my_employee_ids() m) and status in ('pending', 'cancelled')));  -- withdrawal; decisions are manager-only (102 guard)

-- 4f. leave_balances (no company_id column): managers of the employee's company, or self read.
drop policy if exists leave_balances_tenant_select on public.leave_balances;
drop policy if exists leave_balances_tenant_insert on public.leave_balances;
drop policy if exists leave_balances_tenant_update on public.leave_balances;
drop policy if exists leave_balances_select_v100 on public.leave_balances;
drop policy if exists leave_balances_write_v100 on public.leave_balances;
create policy leave_balances_select_v100 on public.leave_balances for select to authenticated
  using ((select public.vyron_is_platform_operator())
         or employee_id in (select e.id::text from public.employees e
                            where e.company_id in (select public.vyron_manager_company_ids()))
         or employee_id in (select m::text from public.vyron_my_employee_ids() m));
create policy leave_balances_write_v100 on public.leave_balances for all to authenticated
  using ((select public.vyron_is_platform_operator())
         or employee_id in (select e.id::text from public.employees e
                            where e.company_id in (select public.vyron_manager_company_ids())))
  with check ((select public.vyron_is_platform_operator())
         or employee_id in (select e.id::text from public.employees e
                            where e.company_id in (select public.vyron_manager_company_ids())));

-- 4g. leave_decision_audit: managers, or the employee's own decisions.
drop policy if exists leave_decision_audit_tenant_select on public.leave_decision_audit;
drop policy if exists leave_decision_audit_select_v100 on public.leave_decision_audit;
create policy leave_decision_audit_select_v100 on public.leave_decision_audit for select to authenticated
  using ((select public.vyron_is_platform_operator())
         or employee_id in (select e.id::text from public.employees e
                            where e.company_id in (select public.vyron_manager_company_ids()))
         or employee_id in (select m::text from public.vyron_my_employee_ids() m));

-- 4h. employee_notifications: managers create; the employee reads and marks their own.
drop policy if exists employee_notifications_tenant_select on public.employee_notifications;
drop policy if exists employee_notifications_select_v100 on public.employee_notifications;
drop policy if exists employee_notifications_insert_v100 on public.employee_notifications;
drop policy if exists employee_notifications_update_v100 on public.employee_notifications;
create policy employee_notifications_select_v100 on public.employee_notifications for select to authenticated
  using ((select public.vyron_is_platform_operator())
         or employee_id in (select e.id::text from public.employees e
                            where e.company_id in (select public.vyron_manager_company_ids()))
         or employee_id in (select m::text from public.vyron_my_employee_ids() m));
create policy employee_notifications_insert_v100 on public.employee_notifications for insert to authenticated
  with check ((select public.vyron_is_platform_operator())
         or employee_id in (select e.id::text from public.employees e
                            where e.company_id in (select public.vyron_manager_company_ids())));
create policy employee_notifications_update_v100 on public.employee_notifications for update to authenticated
  using ((select public.vyron_is_platform_operator())
         or employee_id in (select e.id::text from public.employees e
                            where e.company_id in (select public.vyron_manager_company_ids()))
         or employee_id in (select m::text from public.vyron_my_employee_ids() m))
  with check ((select public.vyron_is_platform_operator())
         or employee_id in (select e.id::text from public.employees e
                            where e.company_id in (select public.vyron_manager_company_ids()))
         or employee_id in (select m::text from public.vyron_my_employee_ids() m));

-- -------------------------------------------------------------------------------------
-- 5. PIN protection (D03, D25 groundwork)
-- -------------------------------------------------------------------------------------
-- Hashed PIN store. No policies: browser sessions can neither read nor write it.
create table if not exists public.employee_pin_credentials (
  employee_id uuid primary key references public.employees(id) on delete cascade,
  company_id  uuid not null references public.companies(id) on delete cascade,
  pin_hash    text not null,
  updated_at  timestamptz not null default now()
);
alter table public.employee_pin_credentials enable row level security;
revoke all on public.employee_pin_credentials from public, anon, authenticated;
grant all on public.employee_pin_credentials to service_role;

-- Keep the hash in step with whatever writes employees.pin_code (existing employee forms).
-- AFTER trigger: the hash row references the employee, which must exist first (a BEFORE
-- INSERT version made every new employee with a PIN fail on the foreign key).
create or replace function public.vyron_sync_employee_pin()
returns trigger language plpgsql security definer set search_path = public, extensions as $$
begin
  if tg_op = 'INSERT' or new.pin_code is distinct from old.pin_code then
    if nullif(btrim(coalesce(new.pin_code, '')), '') is null then
      delete from public.employee_pin_credentials where employee_id = new.id;
    else
      insert into public.employee_pin_credentials (employee_id, company_id, pin_hash, updated_at)
      values (new.id, new.company_id, extensions.crypt(btrim(new.pin_code), extensions.gen_salt('bf', 8)), now())
      on conflict (employee_id) do update
        set pin_hash = excluded.pin_hash, company_id = excluded.company_id, updated_at = now();
    end if;
  end if;
  return null;
end $$;
revoke all on function public.vyron_sync_employee_pin() from public, anon, authenticated;

-- A new PIN clears any lockout (BEFORE UPDATE: changes the row being written).
create or replace function public.vyron_reset_pin_lockout()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.pin_code is distinct from old.pin_code and nullif(btrim(coalesce(new.pin_code, '')), '') is not null then
    new.pin_login_attempts := 0;
    new.pin_locked_until := null;
  end if;
  return new;
end $$;
revoke all on function public.vyron_reset_pin_lockout() from public, anon, authenticated;

drop trigger if exists trg_vyron_sync_employee_pin on public.employees;
create trigger trg_vyron_sync_employee_pin
  after insert or update of pin_code on public.employees
  for each row execute function public.vyron_sync_employee_pin();
drop trigger if exists trg_vyron_reset_pin_lockout on public.employees;
create trigger trg_vyron_reset_pin_lockout
  before update of pin_code on public.employees
  for each row execute function public.vyron_reset_pin_lockout();

-- Backfill hashes for existing PINs (the plaintext column is retained, but unreadable).
insert into public.employee_pin_credentials (employee_id, company_id, pin_hash)
select e.id, e.company_id, extensions.crypt(btrim(e.pin_code), extensions.gen_salt('bf', 8))
from public.employees e
where nullif(btrim(coalesce(e.pin_code, '')), '') is not null
on conflict (employee_id) do nothing;

-- Readable "PIN is set" flag for the UI.
alter table public.employees
  add column if not exists pin_configured boolean
  generated always as (nullif(btrim(coalesce(pin_code, '')), '') is not null) stored;

-- Browser sessions may write pin_code (to set a PIN) but never read it back.
do $$
declare cols text;
begin
  select string_agg(quote_ident(column_name), ', ' order by ordinal_position) into cols
  from information_schema.columns
  where table_schema = 'public' and table_name = 'employees' and column_name <> 'pin_code';
  execute 'revoke select on public.employees from authenticated, anon';
  execute format('grant select (%s) on public.employees to authenticated', cols);
end $$;

-- Server-side PIN check with lockout (5 failures -> locked 15 minutes). Callable by a clock
-- operator of the employee's company (manager or kiosk device) or by the employee themselves.
create or replace function public.vyron_verify_employee_pin(p_employee_id uuid, p_pin text)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare
  v_emp   public.employees;
  v_hash  text;
  v_ok    boolean;
  v_max_attempts constant integer := 5;
  v_lock_minutes constant integer := 15;
begin
  select * into v_emp from public.employees where id = p_employee_id;
  if v_emp.id is null then
    return jsonb_build_object('ok', false, 'reason', 'employee_not_found');
  end if;
  if not (public.vyron_is_clock_operator(v_emp.company_id)
          or p_employee_id in (select public.vyron_my_employee_ids())) then
    raise exception 'Not permitted for this employee.' using errcode = '42501';
  end if;
  if v_emp.active is false or coalesce(v_emp.record_status, 'active') <> 'active' then
    return jsonb_build_object('ok', false, 'reason', 'employee_inactive');
  end if;
  if v_emp.kiosk_access_enabled is false then
    return jsonb_build_object('ok', false, 'reason', 'kiosk_access_disabled');
  end if;
  if v_emp.pin_locked_until is not null and v_emp.pin_locked_until > now() then
    return jsonb_build_object('ok', false, 'reason', 'locked', 'locked_until', v_emp.pin_locked_until);
  end if;

  select pin_hash into v_hash from public.employee_pin_credentials where employee_id = p_employee_id;
  if v_hash is null then
    return jsonb_build_object('ok', false, 'reason', 'no_pin');
  end if;

  v_ok := extensions.crypt(btrim(coalesce(p_pin, '')), v_hash) = v_hash;
  if v_ok then
    update public.employees
       set pin_login_attempts = 0, pin_locked_until = null, last_pin_login_at = now()
     where id = p_employee_id;
    return jsonb_build_object('ok', true);
  end if;

  update public.employees
     set pin_login_attempts = coalesce(pin_login_attempts, 0) + 1,
         pin_locked_until = case when coalesce(pin_login_attempts, 0) + 1 >= v_max_attempts
                                 then now() + make_interval(mins => v_lock_minutes) else pin_locked_until end
   where id = p_employee_id
   returning * into v_emp;
  if to_regclass('public.attendance_pin_failures') is not null then
    execute 'insert into public.attendance_pin_failures (company_id, employee_id, failure_reason, source)
             values ($1, $2, $3, $4)'
      using v_emp.company_id, v_emp.id,
            case when v_emp.pin_locked_until > now() then 'locked_out' else 'incorrect_pin' end, 'kiosk';
  end if;
  if v_emp.pin_locked_until is not null and v_emp.pin_locked_until > now() then
    return jsonb_build_object('ok', false, 'reason', 'locked', 'locked_until', v_emp.pin_locked_until);
  end if;
  return jsonb_build_object('ok', false, 'reason', 'incorrect_pin',
                            'attempts_remaining', greatest(v_max_attempts - v_emp.pin_login_attempts, 0));
end $$;
revoke all on function public.vyron_verify_employee_pin(uuid, text) from public, anon;
grant execute on function public.vyron_verify_employee_pin(uuid, text) to authenticated, service_role;

-- -------------------------------------------------------------------------------------
-- 6. Platform audit log and sessions (D35, D29)
-- -------------------------------------------------------------------------------------
drop policy if exists vyron_audit_log_tenant on public.vyron_audit_log;
drop policy if exists vyron_audit_log_select_v100 on public.vyron_audit_log;
drop policy if exists vyron_audit_log_insert_v100 on public.vyron_audit_log;
create policy vyron_audit_log_select_v100 on public.vyron_audit_log for select to authenticated
  using ((select public.vyron_is_platform_operator()) or company_id in (select public.vyron_manager_company_ids()));
create policy vyron_audit_log_insert_v100 on public.vyron_audit_log for insert to authenticated
  with check ((select public.vyron_is_platform_operator())
              or (company_id in (select public.vyron_user_company_ids())
                  and lower(coalesce(user_email, '')) = public.vyron_jwt_email()));
revoke update, delete, truncate on public.vyron_audit_log from authenticated, anon;

drop policy if exists vyron_user_sessions_tenant on public.vyron_user_sessions;
drop policy if exists vyron_user_sessions_select_v100 on public.vyron_user_sessions;
drop policy if exists vyron_user_sessions_insert_v100 on public.vyron_user_sessions;
drop policy if exists vyron_user_sessions_update_v100 on public.vyron_user_sessions;
create policy vyron_user_sessions_select_v100 on public.vyron_user_sessions for select to authenticated
  using ((select public.vyron_is_platform_operator())
         or lower(coalesce(user_email, '')) = public.vyron_jwt_email()
         or company_id in (select public.vyron_admin_company_ids()));
create policy vyron_user_sessions_insert_v100 on public.vyron_user_sessions for insert to authenticated
  with check (lower(coalesce(user_email, '')) = public.vyron_jwt_email());
create policy vyron_user_sessions_update_v100 on public.vyron_user_sessions for update to authenticated
  using ((select public.vyron_is_platform_operator())
         or lower(coalesce(user_email, '')) = public.vyron_jwt_email()
         or company_id in (select public.vyron_admin_company_ids()))
  with check ((select public.vyron_is_platform_operator())
         or lower(coalesce(user_email, '')) = public.vyron_jwt_email()
         or company_id in (select public.vyron_admin_company_ids()));

create or replace function public.vyron_guard_user_sessions()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if coalesce(auth.jwt() ->> 'role', '') = 'authenticated' and not (select public.vyron_is_platform_operator()) then
    if old.revoked_at is not null and new.revoked_at is distinct from old.revoked_at then
      raise exception 'A revoked session cannot be restored.' using errcode = '42501';
    end if;
    -- Expiry may be extended by the activity heartbeat: the absolute timeout is measured from
    -- created_at, which cannot change. Identity cannot change, and a workspace switch must be
    -- to a company the user actually belongs to.
    if new.user_email is distinct from old.user_email or new.session_token is distinct from old.session_token
       or new.created_at is distinct from old.created_at then
      raise exception 'Session identity cannot be changed.' using errcode = '42501';
    end if;
    if new.company_id is distinct from old.company_id
       and new.company_id is not null
       and new.company_id not in (select public.vyron_user_company_ids()) then
      raise exception 'Session cannot be moved to a company you do not belong to.' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;
revoke all on function public.vyron_guard_user_sessions() from public, anon, authenticated;
drop trigger if exists trg_vyron_guard_user_sessions on public.vyron_user_sessions;
create trigger trg_vyron_guard_user_sessions before update on public.vyron_user_sessions
  for each row execute function public.vyron_guard_user_sessions();

-- Force Logout, server side (D29): deletes the user's auth sessions and refresh tokens so no
-- new access token can be issued. Already-issued access tokens expire at their JWT expiry.
-- Callable only by the service role (the Force Logout API route checks who may do it).
create or replace function public.vyron_revoke_auth_sessions(p_user_id uuid)
returns integer language plpgsql security definer set search_path = public, auth as $$
declare v_sessions integer;
begin
  delete from auth.sessions where user_id = p_user_id;
  get diagnostics v_sessions = row_count;
  delete from auth.refresh_tokens where user_id = p_user_id::text;
  return v_sessions;
end $$;
revoke all on function public.vyron_revoke_auth_sessions(uuid) from public, anon, authenticated;
grant execute on function public.vyron_revoke_auth_sessions(uuid) to service_role;

-- -------------------------------------------------------------------------------------
-- 7. Storage (D30): HR files manager-only, signed documents immutable, clock photos scoped
-- -------------------------------------------------------------------------------------
drop policy if exists storage_company_objects_select on storage.objects;
drop policy if exists storage_company_objects_insert on storage.objects;
drop policy if exists storage_company_objects_update on storage.objects;
drop policy if exists storage_clock_objects_select on storage.objects;
drop policy if exists storage_clock_objects_insert on storage.objects;
drop policy if exists storage_hr_objects_select_v100 on storage.objects;
drop policy if exists storage_hr_objects_insert_v100 on storage.objects;
drop policy if exists storage_hr_signature_insert_v100 on storage.objects;
drop policy if exists storage_hr_objects_update_v100 on storage.objects;
drop policy if exists storage_clock_objects_select_v100 on storage.objects;
drop policy if exists storage_clock_objects_insert_v100 on storage.objects;

create policy storage_hr_objects_select_v100 on storage.objects for select to authenticated
  using (bucket_id = any (array['hr-contract-templates','hr-signatures','hr-signed-documents','hr-documents'])
         and ((select public.vyron_is_platform_operator())
              or (storage.foldername(name))[1] in (select c::text from public.vyron_manager_company_ids() c)));
create policy storage_hr_objects_insert_v100 on storage.objects for insert to authenticated
  with check (bucket_id = any (array['hr-contract-templates','hr-signed-documents','hr-documents'])
         and ((select public.vyron_is_platform_operator())
              or (storage.foldername(name))[1] in (select c::text from public.vyron_manager_company_ids() c)));
-- Any member may deposit a signature into their company folder (they cannot read others back).
create policy storage_hr_signature_insert_v100 on storage.objects for insert to authenticated
  with check (bucket_id = 'hr-signatures'
         and ((select public.vyron_is_platform_operator())
              or (storage.foldername(name))[1] in (select c::text from public.vyron_user_company_ids() c)));
-- Signed documents and signatures are never overwritten.
create policy storage_hr_objects_update_v100 on storage.objects for update to authenticated
  using (bucket_id = any (array['hr-contract-templates','hr-documents'])
         and ((select public.vyron_is_platform_operator())
              or (storage.foldername(name))[1] in (select c::text from public.vyron_manager_company_ids() c)))
  with check (bucket_id = any (array['hr-contract-templates','hr-documents'])
         and ((select public.vyron_is_platform_operator())
              or (storage.foldername(name))[1] in (select c::text from public.vyron_manager_company_ids() c)));

create policy storage_clock_objects_select_v100 on storage.objects for select to authenticated
  using (bucket_id = any (array['clock-event-photos','clock-photos','clocking-photos'])
         and ((select public.vyron_is_platform_operator())
              or (storage.foldername(name))[1] in (
                   select e.id::text from public.employees e
                   where e.company_id in (select public.vyron_manager_company_ids()))
              or (storage.foldername(name))[1] in (select m::text from public.vyron_my_employee_ids() m)));
-- Employees whose clock photos the caller may upload: staff of companies where the caller is a
-- clock operator (manager or kiosk). SECURITY DEFINER because a kiosk login cannot read the
-- employees table itself (a policy subquery would run under its own rights and see nothing).
create or replace function public.vyron_clock_operator_employee_ids()
returns setof text language sql stable security definer set search_path = public as $$
  select e.id::text from public.employees e
  where e.company_id in (select public.vyron_manager_company_ids())
     or e.company_id in (select public.vyron_kiosk_company_ids());
$$;
revoke all on function public.vyron_clock_operator_employee_ids() from public, anon;
grant execute on function public.vyron_clock_operator_employee_ids() to authenticated, service_role;

create policy storage_clock_objects_insert_v100 on storage.objects for insert to authenticated
  with check (bucket_id = any (array['clock-event-photos','clock-photos','clocking-photos'])
         and ((select public.vyron_is_platform_operator())
              or (storage.foldername(name))[1] in (select public.vyron_clock_operator_employee_ids())
              or (storage.foldername(name))[1] in (select m::text from public.vyron_my_employee_ids() m)));

-- -------------------------------------------------------------------------------------
-- 8. Clocking without a company never lands in another tenant (D41)
-- -------------------------------------------------------------------------------------
create or replace function public.set_company_id_on_clock_event()
returns trigger language plpgsql as $$
begin
  if new.company_id is null then
    select e.company_id into new.company_id from public.employees e where e.id = new.employee_id;
  end if;
  if new.company_id is null then
    raise exception 'Clock event has no company.' using errcode = '23502';
  end if;
  return new;
end $$;

notify pgrst, 'reload schema';

commit;

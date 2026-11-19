-- =====================================================================================
-- 100 rollback — restores the exact pre-100 security state (captured from the production
-- schema copy on 2026-11-19). WARNING: rolling back reopens defects D03, D05, D06, D17,
-- D29, D30, D35. Run only with written approval.
-- =====================================================================================
begin;

drop trigger if exists zz_vyron_guard_company_users on public.company_users;
drop trigger if exists trg_vyron_sync_employee_pin on public.employees;
drop trigger if exists trg_vyron_reset_pin_lockout on public.employees;
drop trigger if exists trg_vyron_guard_user_sessions on public.vyron_user_sessions;

-- New v100 policies
do $$
declare r record;
begin
  for r in select schemaname, tablename, policyname from pg_policies
           where policyname like '%\_v100' escape '\' loop
    execute format('drop policy if exists %I on %I.%I', r.policyname, r.schemaname, r.tablename);
  end loop;
end $$;

-- Column privileges on employees back to table-level SELECT
grant select on public.employees to authenticated;
grant update, delete, truncate on public.vyron_audit_log to authenticated;
alter table public.employees drop column if exists pin_configured;

-- Original policies
drop policy if exists "Company users can view clock events" on public.clock_events;
create policy "Company users can view clock events" on public.clock_events as PERMISSIVE for SELECT to public using ((company_id IN ( SELECT company_users.company_id
   FROM company_users
  WHERE (company_users.user_id = auth.uid()))));
drop policy if exists clock_events_tenant_isolation on public.clock_events;
create policy clock_events_tenant_isolation on public.clock_events as PERMISSIVE for ALL to authenticated using ((vyron_is_platform_operator() OR (company_id IN ( SELECT vyron_user_company_ids() AS vyron_user_company_ids)))) with check ((vyron_is_platform_operator() OR (company_id IN ( SELECT vyron_user_company_ids() AS vyron_user_company_ids))));
drop policy if exists "Users can view their companies" on public.companies;
create policy "Users can view their companies" on public.companies as PERMISSIVE for SELECT to public using ((id IN ( SELECT company_users.company_id
   FROM company_users
  WHERE (company_users.user_id = auth.uid()))));
drop policy if exists "Users can view their own company user rows" on public.company_users;
create policy "Users can view their own company user rows" on public.company_users as PERMISSIVE for SELECT to public using ((user_id = auth.uid()));
drop policy if exists "company users can read own access" on public.company_users;
create policy "company users can read own access" on public.company_users as PERMISSIVE for SELECT to authenticated using ((lower(user_email) = lower((auth.jwt() ->> 'email'::text))));
drop policy if exists company_users_tenant_isolation on public.company_users;
create policy company_users_tenant_isolation on public.company_users as PERMISSIVE for ALL to authenticated using ((vyron_is_platform_operator() OR (company_id IN ( SELECT vyron_user_company_ids() AS vyron_user_company_ids)))) with check ((vyron_is_platform_operator() OR (company_id IN ( SELECT vyron_user_company_ids() AS vyron_user_company_ids))));
drop policy if exists employee_notifications_tenant_select on public.employee_notifications;
create policy employee_notifications_tenant_select on public.employee_notifications as PERMISSIVE for SELECT to authenticated using ((vyron_is_platform_operator() OR (employee_id IN ( SELECT (e.id)::text AS id
   FROM employees e
  WHERE (e.company_id IN ( SELECT vyron_user_company_ids() AS vyron_user_company_ids))))));
drop policy if exists "Company users can view employees" on public.employees;
create policy "Company users can view employees" on public.employees as PERMISSIVE for SELECT to public using ((company_id IN ( SELECT company_users.company_id
   FROM company_users
  WHERE (company_users.user_id = auth.uid()))));
drop policy if exists employees_tenant_isolation on public.employees;
create policy employees_tenant_isolation on public.employees as PERMISSIVE for ALL to authenticated using ((vyron_is_platform_operator() OR (company_id IN ( SELECT vyron_user_company_ids() AS vyron_user_company_ids)))) with check ((vyron_is_platform_operator() OR (company_id IN ( SELECT vyron_user_company_ids() AS vyron_user_company_ids))));
drop policy if exists "Company users can view HR cases" on public.hr_cases;
create policy "Company users can view HR cases" on public.hr_cases as PERMISSIVE for SELECT to public using ((company_id IN ( SELECT company_users.company_id
   FROM company_users
  WHERE (company_users.user_id = auth.uid()))));
drop policy if exists hr_cases_tenant_isolation on public.hr_cases;
create policy hr_cases_tenant_isolation on public.hr_cases as PERMISSIVE for ALL to authenticated using ((vyron_is_platform_operator() OR (company_id IN ( SELECT vyron_user_company_ids() AS vyron_user_company_ids)))) with check ((vyron_is_platform_operator() OR (company_id IN ( SELECT vyron_user_company_ids() AS vyron_user_company_ids))));
drop policy if exists hr_warnings_tenant_isolation on public.hr_warnings;
create policy hr_warnings_tenant_isolation on public.hr_warnings as PERMISSIVE for ALL to authenticated using ((vyron_is_platform_operator() OR (company_id IN ( SELECT vyron_user_company_ids() AS vyron_user_company_ids)))) with check ((vyron_is_platform_operator() OR (company_id IN ( SELECT vyron_user_company_ids() AS vyron_user_company_ids))));
drop policy if exists leave_balances_tenant_insert on public.leave_balances;
create policy leave_balances_tenant_insert on public.leave_balances as PERMISSIVE for INSERT to authenticated with check ((vyron_is_platform_operator() OR (employee_id IN ( SELECT (e.id)::text AS id
   FROM employees e
  WHERE (e.company_id IN ( SELECT vyron_user_company_ids() AS vyron_user_company_ids))))));
drop policy if exists leave_balances_tenant_select on public.leave_balances;
create policy leave_balances_tenant_select on public.leave_balances as PERMISSIVE for SELECT to authenticated using ((vyron_is_platform_operator() OR (employee_id IN ( SELECT (e.id)::text AS id
   FROM employees e
  WHERE (e.company_id IN ( SELECT vyron_user_company_ids() AS vyron_user_company_ids))))));
drop policy if exists leave_balances_tenant_update on public.leave_balances;
create policy leave_balances_tenant_update on public.leave_balances as PERMISSIVE for UPDATE to authenticated using ((vyron_is_platform_operator() OR (employee_id IN ( SELECT (e.id)::text AS id
   FROM employees e
  WHERE (e.company_id IN ( SELECT vyron_user_company_ids() AS vyron_user_company_ids)))))) with check ((vyron_is_platform_operator() OR (employee_id IN ( SELECT (e.id)::text AS id
   FROM employees e
  WHERE (e.company_id IN ( SELECT vyron_user_company_ids() AS vyron_user_company_ids))))));
drop policy if exists leave_decision_audit_tenant_select on public.leave_decision_audit;
create policy leave_decision_audit_tenant_select on public.leave_decision_audit as PERMISSIVE for SELECT to authenticated using ((vyron_is_platform_operator() OR (employee_id IN ( SELECT (e.id)::text AS id
   FROM employees e
  WHERE (e.company_id IN ( SELECT vyron_user_company_ids() AS vyron_user_company_ids))))));
drop policy if exists leave_requests_tenant_isolation on public.leave_requests;
create policy leave_requests_tenant_isolation on public.leave_requests as PERMISSIVE for ALL to authenticated using ((vyron_is_platform_operator() OR (company_id IN ( SELECT vyron_user_company_ids() AS vyron_user_company_ids)))) with check ((vyron_is_platform_operator() OR (company_id IN ( SELECT vyron_user_company_ids() AS vyron_user_company_ids))));
drop policy if exists "Company users can view payroll batches" on public.payroll_batches;
create policy "Company users can view payroll batches" on public.payroll_batches as PERMISSIVE for SELECT to public using ((company_id IN ( SELECT company_users.company_id
   FROM company_users
  WHERE (company_users.user_id = auth.uid()))));
drop policy if exists payroll_batches_tenant_isolation on public.payroll_batches;
create policy payroll_batches_tenant_isolation on public.payroll_batches as PERMISSIVE for ALL to authenticated using ((vyron_is_platform_operator() OR (company_id IN ( SELECT vyron_user_company_ids() AS vyron_user_company_ids)))) with check ((vyron_is_platform_operator() OR (company_id IN ( SELECT vyron_user_company_ids() AS vyron_user_company_ids))));
drop policy if exists payroll_clock_checks_tenant_select on public.payroll_clock_checks;
create policy payroll_clock_checks_tenant_select on public.payroll_clock_checks as PERMISSIVE for SELECT to authenticated using ((vyron_is_platform_operator() OR (company_id IN ( SELECT vyron_user_company_ids() AS vyron_user_company_ids))));
drop policy if exists payroll_clock_checks_tenant_update on public.payroll_clock_checks;
create policy payroll_clock_checks_tenant_update on public.payroll_clock_checks as PERMISSIVE for UPDATE to authenticated using ((vyron_is_platform_operator() OR (company_id IN ( SELECT vyron_user_company_ids() AS vyron_user_company_ids)))) with check ((vyron_is_platform_operator() OR (company_id IN ( SELECT vyron_user_company_ids() AS vyron_user_company_ids))));
drop policy if exists payroll_export_logs_tenant_insert on public.payroll_export_logs;
create policy payroll_export_logs_tenant_insert on public.payroll_export_logs as PERMISSIVE for INSERT to authenticated with check ((vyron_is_platform_operator() OR (company_id IN ( SELECT vyron_user_company_ids() AS vyron_user_company_ids))));
drop policy if exists payroll_export_logs_tenant_select on public.payroll_export_logs;
create policy payroll_export_logs_tenant_select on public.payroll_export_logs as PERMISSIVE for SELECT to authenticated using ((vyron_is_platform_operator() OR (company_id IN ( SELECT vyron_user_company_ids() AS vyron_user_company_ids))));
drop policy if exists payroll_hours_tenant_isolation on public.payroll_hours;
create policy payroll_hours_tenant_isolation on public.payroll_hours as PERMISSIVE for ALL to authenticated using ((vyron_is_platform_operator() OR (company_id IN ( SELECT vyron_user_company_ids() AS vyron_user_company_ids)))) with check ((vyron_is_platform_operator() OR (company_id IN ( SELECT vyron_user_company_ids() AS vyron_user_company_ids))));
drop policy if exists "Company users can view rosters" on public.roster_shifts;
create policy "Company users can view rosters" on public.roster_shifts as PERMISSIVE for SELECT to public using ((company_id IN ( SELECT company_users.company_id
   FROM company_users
  WHERE (company_users.user_id = auth.uid()))));
drop policy if exists roster_shifts_tenant_isolation on public.roster_shifts;
create policy roster_shifts_tenant_isolation on public.roster_shifts as PERMISSIVE for ALL to authenticated using ((vyron_is_platform_operator() OR (company_id IN ( SELECT vyron_user_company_ids() AS vyron_user_company_ids)))) with check ((vyron_is_platform_operator() OR (company_id IN ( SELECT vyron_user_company_ids() AS vyron_user_company_ids))));
drop policy if exists "Company users can view stores" on public.stores;
create policy "Company users can view stores" on public.stores as PERMISSIVE for SELECT to public using ((company_id IN ( SELECT company_users.company_id
   FROM company_users
  WHERE (company_users.user_id = auth.uid()))));
drop policy if exists stores_tenant_isolation on public.stores;
create policy stores_tenant_isolation on public.stores as PERMISSIVE for ALL to authenticated using ((vyron_is_platform_operator() OR (company_id IN ( SELECT vyron_user_company_ids() AS vyron_user_company_ids)))) with check ((vyron_is_platform_operator() OR (company_id IN ( SELECT vyron_user_company_ids() AS vyron_user_company_ids))));
drop policy if exists "Company users can view exceptions" on public.time_exceptions;
create policy "Company users can view exceptions" on public.time_exceptions as PERMISSIVE for SELECT to public using ((company_id IN ( SELECT company_users.company_id
   FROM company_users
  WHERE (company_users.user_id = auth.uid()))));
drop policy if exists time_exceptions_tenant_isolation on public.time_exceptions;
create policy time_exceptions_tenant_isolation on public.time_exceptions as PERMISSIVE for ALL to authenticated using ((vyron_is_platform_operator() OR (company_id IN ( SELECT vyron_user_company_ids() AS vyron_user_company_ids)))) with check ((vyron_is_platform_operator() OR (company_id IN ( SELECT vyron_user_company_ids() AS vyron_user_company_ids))));
drop policy if exists vyron_audit_log_tenant on public.vyron_audit_log;
create policy vyron_audit_log_tenant on public.vyron_audit_log as PERMISSIVE for ALL to authenticated using ((vyron_is_platform_operator() OR (company_id IS NULL) OR (company_id IN ( SELECT vyron_user_company_ids() AS vyron_user_company_ids)))) with check ((vyron_is_platform_operator() OR (company_id IS NULL) OR (company_id IN ( SELECT vyron_user_company_ids() AS vyron_user_company_ids))));
drop policy if exists vyron_user_sessions_tenant on public.vyron_user_sessions;
create policy vyron_user_sessions_tenant on public.vyron_user_sessions as PERMISSIVE for ALL to authenticated using ((vyron_is_platform_operator() OR (lower(user_email) = lower(COALESCE((auth.jwt() ->> 'email'::text), ''::text))) OR (company_id IN ( SELECT vyron_user_company_ids() AS vyron_user_company_ids)))) with check ((vyron_is_platform_operator() OR (lower(user_email) = lower(COALESCE((auth.jwt() ->> 'email'::text), ''::text))) OR (company_id IN ( SELECT vyron_user_company_ids() AS vyron_user_company_ids))));
drop policy if exists storage_clock_objects_insert on storage.objects;
create policy storage_clock_objects_insert on storage.objects as PERMISSIVE for INSERT to authenticated with check (((bucket_id = ANY (ARRAY['clock-event-photos'::text, 'clock-photos'::text, 'clocking-photos'::text])) AND (vyron_is_platform_operator() OR ((storage.foldername(name))[1] IN ( SELECT (e.id)::text AS id
   FROM employees e
  WHERE (e.company_id IN ( SELECT vyron_user_company_ids() AS vyron_user_company_ids)))))));
drop policy if exists storage_clock_objects_select on storage.objects;
create policy storage_clock_objects_select on storage.objects as PERMISSIVE for SELECT to authenticated using (((bucket_id = ANY (ARRAY['clock-event-photos'::text, 'clock-photos'::text, 'clocking-photos'::text])) AND (vyron_is_platform_operator() OR ((storage.foldername(name))[1] IN ( SELECT (e.id)::text AS id
   FROM employees e
  WHERE (e.company_id IN ( SELECT vyron_user_company_ids() AS vyron_user_company_ids)))))));
drop policy if exists storage_company_objects_insert on storage.objects;
create policy storage_company_objects_insert on storage.objects as PERMISSIVE for INSERT to authenticated with check (((bucket_id = ANY (ARRAY['hr-contract-templates'::text, 'hr-signatures'::text, 'hr-signed-documents'::text, 'hr-documents'::text])) AND (vyron_is_platform_operator() OR ((storage.foldername(name))[1] IN ( SELECT (c.c)::text AS c
   FROM vyron_user_company_ids() c(c))))));
drop policy if exists storage_company_objects_select on storage.objects;
create policy storage_company_objects_select on storage.objects as PERMISSIVE for SELECT to authenticated using (((bucket_id = ANY (ARRAY['hr-contract-templates'::text, 'hr-signatures'::text, 'hr-signed-documents'::text, 'hr-documents'::text])) AND (vyron_is_platform_operator() OR ((storage.foldername(name))[1] IN ( SELECT (c.c)::text AS c
   FROM vyron_user_company_ids() c(c))))));
drop policy if exists storage_company_objects_update on storage.objects;
create policy storage_company_objects_update on storage.objects as PERMISSIVE for UPDATE to authenticated using (((bucket_id = ANY (ARRAY['hr-contract-templates'::text, 'hr-signatures'::text, 'hr-signed-documents'::text, 'hr-documents'::text])) AND (vyron_is_platform_operator() OR ((storage.foldername(name))[1] IN ( SELECT (c.c)::text AS c
   FROM vyron_user_company_ids() c(c)))))) with check (((bucket_id = ANY (ARRAY['hr-contract-templates'::text, 'hr-signatures'::text, 'hr-signed-documents'::text, 'hr-documents'::text])) AND (vyron_is_platform_operator() OR ((storage.foldername(name))[1] IN ( SELECT (c.c)::text AS c
   FROM vyron_user_company_ids() c(c))))));

-- Original clock-event company default
CREATE OR REPLACE FUNCTION public.set_company_id_on_clock_event()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  if new.company_id is null then
    new.company_id := public.get_default_company_id();
  end if;

  return new;
end;
$function$

;

-- Hash store and helpers (the plaintext pin_code column was never modified).
drop table if exists public.employee_pin_credentials;
drop function if exists public.vyron_verify_employee_pin(uuid, text);
drop function if exists public.vyron_revoke_auth_sessions(uuid);
drop function if exists public.vyron_clock_operator_employee_ids();
drop function if exists public.vyron_is_clock_operator(uuid);
drop function if exists public.vyron_kiosk_company_ids();
-- Restore the original role list (kiosk memberships, if any, must be removed first).
alter table public.company_users drop constraint if exists company_users_role_check;
alter table public.company_users add constraint company_users_role_check check (role = any (array['platform_admin','admin','owner','hr_manager','operations_manager','supervisor','payroll','employee','manager','staff']));
drop function if exists public.vyron_sync_employee_pin();
drop function if exists public.vyron_reset_pin_lockout();
drop function if exists public.vyron_guard_company_users();
drop function if exists public.vyron_guard_user_sessions();
drop function if exists public.vyron_is_company_admin(uuid);
drop function if exists public.vyron_is_company_manager(uuid);
drop function if exists public.vyron_my_employee_ids();
drop function if exists public.vyron_admin_company_ids();
drop function if exists public.vyron_manager_company_ids();
drop function if exists public.vyron_company_role(uuid);
drop function if exists public.vyron_manager_roles();
drop function if exists public.vyron_admin_roles();
drop function if exists public.vyron_jwt_email();

notify pgrst, 'reload schema';
commit;

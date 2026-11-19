-- =====================================================================================
-- Preflight for 100 → 106 (UMORA go-live). READ-ONLY. Run against production immediately
-- before the maintenance window. Every 'critical' row must be ok = true; 'warning' rows are
-- reported for a decision and do not block.
-- =====================================================================================
begin transaction read only;

with checks(severity, check_name, ok, detail) as (
  select 'critical', 'postgres 17', current_setting('server_version_num')::int >= 170000, current_setting('server_version')
  union all
  select 'critical', 'pgcrypto available (PIN hashing)', exists (select 1 from pg_extension where extname = 'pgcrypto'),
         coalesce((select extnamespace::regnamespace::text from pg_extension where extname = 'pgcrypto'), 'missing')
  union all
  select 'critical', 'tenant helpers from 090–092 present',
         to_regprocedure('public.vyron_user_company_ids()') is not null and to_regprocedure('public.vyron_is_platform_operator()') is not null,
         'vyron_user_company_ids / vyron_is_platform_operator'
  union all
  select 'critical', 'core tables present',
         (select count(*) from unnest(array['employees','clock_events','company_users','roster_shifts','leave_requests',
                 'leave_balances','time_exceptions','payroll_hours','payroll_batches','payroll_export_logs','stores',
                 'hr_warnings','hr_cases','employee_notifications','vyron_audit_log','vyron_user_sessions','companies']) t
          where to_regclass('public.' || t) is null) = 0,
         'all 17 required'
  union all
  select 'critical', 'auth sessions deletable by postgres (Force Logout, 100)',
         has_table_privilege('postgres', 'auth.sessions', 'DELETE') and has_table_privilege('postgres', 'auth.refresh_tokens', 'DELETE'),
         'vyron_revoke_auth_sessions'
  -- 100: identity rule and role list must fit existing memberships.
  union all
  select 'critical', 'every membership login id matches its e-mail (100 guard)',
         not exists (select 1 from public.company_users cu
                     where (cu.user_id is not null or cu.auth_user_id is not null)
                       and coalesce(cu.user_id, cu.auth_user_id) is distinct from
                           (select u.id from auth.users u where lower(u.email) = lower(cu.user_email) limit 1)),
         (select count(*)::text || ' memberships' from public.company_users)
  union all
  select 'critical', 'every membership role fits the new role list (adds kiosk)',
         not exists (select 1 from public.company_users where role not in
           ('platform_admin','admin','owner','hr_manager','operations_manager','supervisor','payroll','employee','manager','staff','kiosk')),
         coalesce((select string_agg(distinct role, ',') from public.company_users), 'none')
  union all
  select 'warning', 'companies with members but no active owner/admin (platform operator can still manage them)',
         not exists (select 1 from public.companies c
                     where exists (select 1 from public.company_users cu where cu.company_id = c.id)
                       and not exists (select 1 from public.company_users cu where cu.company_id = c.id
                                         and cu.role in ('owner','admin','platform_admin') and cu.status = 'active')),
         coalesce((select string_agg(c.name, ', ') from public.companies c
                   where exists (select 1 from public.company_users cu where cu.company_id = c.id)
                     and not exists (select 1 from public.company_users cu where cu.company_id = c.id
                                       and cu.role in ('owner','admin','platform_admin') and cu.status = 'active')), 'none')
  -- 101
  union all
  select 'critical', 'clock events with a NULL company (would now be refused)',
         not exists (select 1 from public.clock_events where company_id is null),
         (select count(*)::text from public.clock_events where company_id is null)
  -- 102: status constraints are widened, never narrowed; existing values must fit.
  union all
  select 'critical', 'leave statuses fit the new constraint',
         not exists (select 1 from public.leave_requests where status not in ('pending','approved','declined','amended','cancelled')),
         coalesce((select string_agg(distinct status, ',') from public.leave_requests), 'none')
  union all
  select 'critical', 'roster statuses fit the new constraint',
         not exists (select 1 from public.roster_shifts where status not in ('scheduled','published','changed','completed','cancelled','no_show')),
         coalesce((select string_agg(distinct status, ',') from public.roster_shifts), 'none')
  -- 103
  union all
  select 'critical', 'no duplicate payroll_hours rows per employee/period',
         not exists (select 1 from public.payroll_hours group by company_id, employee_id, period_start, period_end having count(*) > 1),
         (select count(*)::text || ' rows' from public.payroll_hours)
  -- 104: narrow 062 subset; the full 062 must not have been applied in the meantime.
  union all
  select 'critical', 'companies.user_limit / customer_status absent or compatible (104)',
         not exists (select 1 from information_schema.columns where table_schema='public' and table_name='companies'
                       and column_name = 'customer_status' and data_type <> 'text'),
         coalesce((select string_agg(column_name, ',') from information_schema.columns where table_schema='public'
                     and table_name='companies' and column_name in ('user_limit','customer_status')), 'not present (104 adds them)')
  union all
  select 'critical', 'company statuses are active (104 backfills customer_status = active)',
         not exists (select 1 from public.companies where lower(coalesce(status,'')) <> 'active' and lower(coalesce(subscription_status,'')) <> 'active'),
         (select count(*)::text || ' companies' from public.companies)
  -- 106
  union all
  select 'critical', 'leave requests have dates (working-day recount)',
         not exists (select 1 from public.leave_requests where start_date is null or end_date is null),
         (select count(*)::text || ' requests' from public.leave_requests)
)
select severity, check_name, ok, detail from checks order by severity, ok, check_name;

rollback;

-- =====================================================================================
-- 104 — companies.user_limit and companies.customer_status (narrow subset of 062)
-- =====================================================================================
-- NOT APPLIED TO PRODUCTION. Requires separate written approval. Depends on 100.
-- Idempotent. Rollback: sql/104-rollback.sql.
--
-- Why: the user-management API (invite, reset password, change status) reads these two
-- columns and fails without them (audit D16). Migration 062 adds them together with ~25
-- other columns, two tables and policies; only these two are needed, so only these two are
-- added — with 062's own definitions so 062 can still be applied later without conflict.
--
-- Safety: in 062 these columns were what made the cross-company account takeover reachable.
-- Migration 100 closes that path independently (company_users identity guard + role guard,
-- and the API resolves accounts from Auth); regression ATO-01..04 and the unit tests in
-- tests/tenant-isolation.test.ts run with these columns present. Apply 100 BEFORE 104.
-- =====================================================================================

begin;

do $$
begin
  if to_regprocedure('public.vyron_guard_company_users()') is null then
    raise exception '104 requires migration 100 (account-takeover protections) to be applied first.';
  end if;
end $$;

-- Licence seat limit: NULL = unlimited (the API treats NULL as no limit).
alter table public.companies add column if not exists user_limit integer;
alter table public.companies drop constraint if exists companies_user_limit_check;
alter table public.companies add constraint companies_user_limit_check
  check (user_limit is null or user_limit >= 0);

-- Commercial status, exactly as 062 defines it. 'suspended', 'cancelled' and 'expired' block
-- sign-in (lib/server/authorization.ts); 'trial' and 'active' do not.
alter table public.companies add column if not exists customer_status text not null default 'trial';
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'companies_customer_status_check') then
    alter table public.companies add constraint companies_customer_status_check
      check (customer_status in ('trial', 'active', 'suspended', 'cancelled', 'expired'));
  end if;
end $$;
create index if not exists idx_companies_customer_status on public.companies (customer_status);

-- Existing live companies must not be downgraded to 'trial' (same backfill as 062).
update public.companies
   set customer_status = 'active'
 where customer_status = 'trial'
   and (lower(coalesce(status, '')) = 'active' or lower(coalesce(subscription_status, '')) = 'active');

notify pgrst, 'reload schema';

commit;

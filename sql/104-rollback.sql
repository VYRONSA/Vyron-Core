-- 104 rollback: removes companies.user_limit and companies.customer_status.
-- WARNING: user invites, password resets and status changes fail again (D16). Any licence
-- limits or commercial statuses recorded since 104 are lost — export them first.
-- Do NOT run if migration 062 was applied after 104 (062 owns these columns from then on).
begin;
drop index if exists public.idx_companies_customer_status;
alter table public.companies drop constraint if exists companies_customer_status_check;
alter table public.companies drop constraint if exists companies_user_limit_check;
alter table public.companies drop column if exists customer_status;
alter table public.companies drop column if exists user_limit;
notify pgrst, 'reload schema';
commit;

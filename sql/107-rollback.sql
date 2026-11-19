-- 107 rollback: removes the Company Master × kiosk guard triggers.
-- WARNING: a kiosk device login can again be granted Company Master administration.
-- Run BEFORE 100-rollback.sql if rolling back further (100's rollback removes the kiosk role).
begin;
drop trigger if exists trg_vyron_company_master_grantee_guard on public.vyron_company_master_admins;
drop trigger if exists trg_vyron_kiosk_not_company_master on public.company_users;
drop function if exists public.vyron_guard_company_master_grantee();
drop function if exists public.vyron_guard_kiosk_not_company_master();
commit;

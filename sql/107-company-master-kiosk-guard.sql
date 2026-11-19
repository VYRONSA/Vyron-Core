-- =====================================================================================
-- 107 — Company Master × kiosk role: a kiosk device login never holds Company Master authority
-- =====================================================================================
-- NOT APPLIED TO PRODUCTION. Requires separate written approval. Depends on 098 (Company
-- Master grant table, already in production) and 100 (kiosk role). Idempotent.
-- Rollback: sql/107-rollback.sql.
--
-- Why: migration 100 introduces the `kiosk` role — a shared clocking-device login that reads
-- nothing except the kiosk RPCs. Company Master (098/099) lets an owner/admin grant Company
-- Master administration to ANY auth user, by id or e-mail. Without this guard a kiosk login
-- could be granted that authority (by mistake or deliberately) and the shared device could
-- then edit the company's legal identity and branding and grant the role on to others.
--
-- How: two triggers, no change to any 098/099 function (their fingerprints and preflight
-- gates stay exactly as reviewed):
--   * vyron_company_master_admins: an ACTIVE grant is refused when the grantee holds any
--     kiosk membership;
--   * company_users: a membership cannot become `kiosk` while that user holds an ACTIVE
--     Company Master grant.
-- Existing data: none affected (production has no kiosk memberships before 100).
-- =====================================================================================
begin;

do $$
begin
  if to_regclass('public.vyron_company_master_admins') is null then
    raise exception '107 requires migration 098 (public.vyron_company_master_admins)';
  end if;
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.company_users'::regclass
       and conname = 'company_users_role_check'
       and pg_get_constraintdef(oid) like '%kiosk%'
  ) then
    raise exception '107 requires migration 100 (kiosk role on company_users)';
  end if;
end $$;

create or replace function public.vyron_guard_company_master_grantee()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if new.status = 'active' and exists (
    select 1 from public.company_users cu
     where coalesce(cu.user_id, cu.auth_user_id) = new.auth_user_id
       and cu.deleted_at is null
       and lower(coalesce(cu.role, '')) = 'kiosk'
  ) then
    raise exception 'A kiosk device login cannot be a Company Master administrator.'
      using errcode = '42501';
  end if;
  return new;
end $$;

create or replace function public.vyron_guard_kiosk_not_company_master()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if lower(coalesce(new.role, '')) = 'kiosk' and new.deleted_at is null and exists (
    select 1 from public.vyron_company_master_admins cma
     where cma.auth_user_id = coalesce(new.user_id, new.auth_user_id)
       and cma.status = 'active'
  ) then
    raise exception 'This user is a Company Master administrator and cannot be a kiosk device login.'
      using errcode = '42501';
  end if;
  return new;
end $$;

revoke all on function public.vyron_guard_company_master_grantee() from public, anon, authenticated;
revoke all on function public.vyron_guard_kiosk_not_company_master() from public, anon, authenticated;

drop trigger if exists trg_vyron_company_master_grantee_guard on public.vyron_company_master_admins;
create trigger trg_vyron_company_master_grantee_guard
  before insert or update of auth_user_id, status on public.vyron_company_master_admins
  for each row execute function public.vyron_guard_company_master_grantee();

drop trigger if exists trg_vyron_kiosk_not_company_master on public.company_users;
create trigger trg_vyron_kiosk_not_company_master
  before insert or update of role, user_id, auth_user_id, deleted_at on public.company_users
  for each row execute function public.vyron_guard_kiosk_not_company_master();

commit;

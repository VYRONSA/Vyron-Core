-- 007-client-profile-columns.sql
-- Optional client/contact profile columns on companies (run after 001 / 006 as needed).
-- Idempotent.

BEGIN;

ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS contact_person text;

ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS phone text;

ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS physical_address text;

COMMIT;

NOTIFY pgrst, 'reload schema';

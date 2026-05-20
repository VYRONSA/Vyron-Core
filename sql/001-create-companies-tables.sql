-- 001-create-companies-tables.sql
-- VYRON CORE — multi-tenant company tables (run before 002-fix-company-access-rpc.sql)
-- Idempotent: safe to re-run after partial failures.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS public.companies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  subscription_status text DEFAULT 'active',
  status text,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.company_users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies (id) ON DELETE CASCADE,
  user_email text,
  user_id uuid,
  role text DEFAULT 'user',
  status text DEFAULT 'active',
  created_at timestamptz DEFAULT now()
);

-- Backfill columns when tables already existed from an older/partial script
ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS subscription_status text DEFAULT 'active';

ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS status text;

ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now();

-- Client / billing profile (same as 007-client-profile-columns.sql; folded in for new installs)
ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS contact_person text;

ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS phone text;

ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS physical_address text;

ALTER TABLE public.company_users
  ADD COLUMN IF NOT EXISTS user_email text;

ALTER TABLE public.company_users
  ADD COLUMN IF NOT EXISTS user_id uuid;

ALTER TABLE public.company_users
  ADD COLUMN IF NOT EXISTS role text DEFAULT 'user';

ALTER TABLE public.company_users
  ADD COLUMN IF NOT EXISTS status text DEFAULT 'active';

ALTER TABLE public.company_users
  ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now();

-- Legacy scripts used `email`; app and RPC expect `user_email`
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'company_users'
      AND column_name = 'email'
  ) AND NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'company_users'
      AND column_name = 'user_email'
  ) THEN
    ALTER TABLE public.company_users RENAME COLUMN email TO user_email;
  ELSIF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'company_users'
      AND column_name = 'email'
  ) AND EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'company_users'
      AND column_name = 'user_email'
  ) THEN
    UPDATE public.company_users
    SET user_email = COALESCE(user_email, email)
    WHERE user_email IS NULL AND email IS NOT NULL;

    ALTER TABLE public.company_users DROP COLUMN email;
  END IF;
END $$;

-- Remove indexes from older scripts that targeted `email`
DROP INDEX IF EXISTS public.company_users_email_idx;

CREATE INDEX IF NOT EXISTS company_users_company_id_idx ON public.company_users (company_id);

CREATE INDEX IF NOT EXISTS company_users_user_email_idx ON public.company_users (lower(user_email));

ALTER TABLE public.companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.company_users ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "DEV allow all companies" ON public.companies;
CREATE POLICY "DEV allow all companies"
ON public.companies
FOR ALL
TO public
USING (true)
WITH CHECK (true);

DROP POLICY IF EXISTS "DEV allow all company_users" ON public.company_users;
CREATE POLICY "DEV allow all company_users"
ON public.company_users
FOR ALL
TO public
USING (true)
WITH CHECK (true);

GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON public.companies TO anon, authenticated;
GRANT ALL ON public.company_users TO anon, authenticated;

COMMIT;

NOTIFY pgrst, 'reload schema';

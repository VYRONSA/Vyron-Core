-- RUN THIS FILE IN SUPABASE SQL EDITOR (not RUN_COMPANY_TABLES.md)
-- 000-run-all-companies.sql
-- VYRON CORE — one-paste setup: runs 001 (tables) then 002 (RPC + seed).
-- Idempotent: safe to re-run. Do NOT paste RUN_COMPANY_TABLES.md or INSTRUCTIONS.txt.

-- ========== 001-create-companies-tables.sql ==========

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

ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS subscription_status text DEFAULT 'active';

ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS status text;

ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now();

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

-- ========== 002-fix-company-access-rpc.sql ==========

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS subscription_status text DEFAULT 'active';

ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now();

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

INSERT INTO public.companies (
  id,
  name,
  subscription_status,
  created_at
)
VALUES (
  '11111111-1111-1111-1111-111111111111',
  'Cutting Edge Cuisine Demo',
  'active',
  now()
)
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  subscription_status = 'active';

INSERT INTO public.company_users (
  company_id,
  user_email,
  role,
  status,
  created_at
)
SELECT
  '11111111-1111-1111-1111-111111111111',
  'info@vyronsoft.co.za',
  'owner',
  'active',
  now()
WHERE NOT EXISTS (
  SELECT 1
  FROM public.company_users cu
  WHERE cu.company_id = '11111111-1111-1111-1111-111111111111'
    AND lower(cu.user_email) = 'info@vyronsoft.co.za'
);

DROP FUNCTION IF EXISTS public.vyron_get_company_access();
DROP FUNCTION IF EXISTS public.vyron_get_company_access(json);
DROP FUNCTION IF EXISTS public.vyron_get_company_access(jsonb);
DROP FUNCTION IF EXISTS public.vyron_get_company_access(text);
DROP FUNCTION IF EXISTS public.vyron_get_company_access(uuid);

CREATE OR REPLACE FUNCTION public.vyron_get_company_access()
RETURNS TABLE (
  company_id uuid,
  company_name text,
  user_role text,
  user_status text,
  subscription_status text,
  subscription_locked boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  current_email text;
BEGIN
  current_email := lower(coalesce(auth.email(), ''));

  RETURN QUERY
  SELECT
    c.id::uuid AS company_id,
    c.name::text AS company_name,
    cu.role::text AS user_role,
    cu.status::text AS user_status,
    coalesce(c.subscription_status::text, 'active') AS subscription_status,
    CASE
      WHEN coalesce(c.subscription_status::text, 'active') = 'active' THEN false
      ELSE true
    END AS subscription_locked
  FROM public.company_users cu
  JOIN public.companies c
    ON c.id = cu.company_id
  WHERE lower(cu.user_email::text) = current_email
    AND lower(cu.status::text) = 'active'
  ORDER BY cu.created_at ASC
  LIMIT 1;
END;
$$;

ALTER FUNCTION public.vyron_get_company_access() OWNER TO postgres;

REVOKE ALL ON FUNCTION public.vyron_get_company_access() FROM PUBLIC;

GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.vyron_get_company_access() TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.vyron_get_company_access() IS
  'SECURITY DEFINER: resolve active company for auth.email() when REST company_users is unavailable.';

DROP FUNCTION IF EXISTS public.vyron_provision_company(text, text);

CREATE OR REPLACE FUNCTION public.vyron_provision_company(
  p_name text,
  p_subscription_status text DEFAULT 'active'
)
RETURNS TABLE (
  id uuid,
  name text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF coalesce(trim(p_name), '') = '' THEN
    RAISE EXCEPTION 'Company name is required';
  END IF;

  RETURN QUERY
  INSERT INTO public.companies (name, subscription_status)
  VALUES (trim(p_name), coalesce(nullif(trim(p_subscription_status), ''), 'active'))
  RETURNING companies.id, companies.name;
END;
$$;

ALTER FUNCTION public.vyron_provision_company(text, text) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.vyron_provision_company(text, text) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.vyron_provision_company(text, text) TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.vyron_provision_company(text, text) IS
  'SECURITY DEFINER: insert into public.companies for Client Setup when PostgREST cannot see the table (PGRST205).';

COMMIT;

NOTIFY pgrst, 'reload schema';

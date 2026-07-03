-- 015-company-users-companies-fk.sql
-- Repair company_users.company_id → companies.id FK for PostgREST embedded joins
-- Idempotent: safe to re-run. Run in Supabase SQL Editor after 001 / 000.

BEGIN;

-- Ensure company_id column exists
ALTER TABLE public.company_users
  ADD COLUMN IF NOT EXISTS company_id uuid;

-- Remove orphan rows that would block FK creation
DELETE FROM public.company_users cu
WHERE cu.company_id IS NULL
   OR NOT EXISTS (
     SELECT 1 FROM public.companies c WHERE c.id = cu.company_id
   );

-- Add FK with stable name expected by PostgREST (company_users_company_id_fkey)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'company_users_company_id_fkey'
      AND conrelid = 'public.company_users'::regclass
  ) THEN
    ALTER TABLE public.company_users
      ADD CONSTRAINT company_users_company_id_fkey
      FOREIGN KEY (company_id)
      REFERENCES public.companies (id)
      ON DELETE CASCADE;
  END IF;
END $$;

-- Enforce NOT NULL after orphans removed
ALTER TABLE public.company_users
  ALTER COLUMN company_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS company_users_company_id_idx ON public.company_users (company_id);

COMMIT;

NOTIFY pgrst, 'reload schema';

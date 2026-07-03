-- 029-v2-production-readiness.sql
-- VYRON CORE V2 production readiness: FK repair, CORE pricing alignment, schema cache refresh.
-- Idempotent. Run after sql/028-workforce-operating-system.sql.

BEGIN;

-- Repair company_users → companies FK (PostgREST PGRST200 embed)
ALTER TABLE public.company_users
  ADD COLUMN IF NOT EXISTS company_id uuid;

DELETE FROM public.company_users cu
WHERE cu.company_id IS NULL
   OR NOT EXISTS (
     SELECT 1 FROM public.companies c WHERE c.id = cu.company_id
   );

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

ALTER TABLE public.company_users
  ALTER COLUMN company_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS company_users_company_id_idx ON public.company_users (company_id);

-- CORE V2 pricing (Starter R1,499 · Professional R4,999 · Business R7,500 · Enterprise contact)
ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS subscription_tier text DEFAULT 'Starter';

ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS monthly_fee numeric DEFAULT 1499;

INSERT INTO public.vyron_product_packages (
  id, product_code, package_name, user_limit, company_limit, storage_limit_gb, monthly_value, status
)
VALUES
  ('pkg-core-starter', 'CORE', 'CORE Starter', 25, 1, 10, 1499, 'active'),
  ('pkg-core-professional', 'CORE', 'CORE Professional', 100, 1, 50, 4999, 'active'),
  ('pkg-core-business', 'CORE', 'CORE Business', 250, 1, 100, 7500, 'active'),
  ('pkg-core-enterprise', 'CORE', 'CORE Enterprise', NULL, 5, NULL, 0, 'active')
ON CONFLICT (id) DO UPDATE SET
  product_code = EXCLUDED.product_code,
  package_name = EXCLUDED.package_name,
  user_limit = EXCLUDED.user_limit,
  company_limit = EXCLUDED.company_limit,
  storage_limit_gb = EXCLUDED.storage_limit_gb,
  monthly_value = EXCLUDED.monthly_value,
  status = EXCLUDED.status,
  updated_at = now();

UPDATE public.companies
SET
  monthly_fee = CASE subscription_tier
    WHEN 'Starter' THEN 1499
    WHEN 'Professional' THEN 4999
    WHEN 'Business' THEN 7500
    WHEN 'Enterprise' THEN 0
    ELSE monthly_fee
  END
WHERE subscription_tier IN ('Starter', 'Professional', 'Business', 'Enterprise')
  AND (monthly_fee IS NULL OR monthly_fee IN (499, 14999, 49999, 24999));

-- Ensure platform developer workspace row exists (real UUID — not master-workspace placeholder)
INSERT INTO public.vyron_developer_workspaces (workspace_key, workspace_name)
VALUES ('vyron-platform', 'VYRON Platform Workspace')
ON CONFLICT (workspace_key) DO NOTHING;

COMMIT;

NOTIFY pgrst, 'reload schema';

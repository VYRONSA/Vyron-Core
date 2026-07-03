-- 020-core-v2-pricing.sql
-- VYRON CORE V2 package pricing + employee limits (production alignment)
-- Run after sql/011-vyron-dev-phase3.sql. Idempotent.
-- Also ensures companies.subscription_tier / monthly_fee exist (sql/006) before tier fee alignment.

BEGIN;

-- Prerequisite columns on companies (from sql/006 — safe if already applied)
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

-- Align tenant subscription defaults where legacy CORE pricing was seeded
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

COMMIT;

NOTIFY pgrst, 'reload schema';

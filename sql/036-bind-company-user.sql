-- 036-bind-company-user.sql
-- Repair: "No active company mapping bound to account user …"
-- Run in Supabase SQL Editor on project ldnrmgafsquzfitcuvxq (see ACTIVE_SUPABASE.md).
-- Idempotent. Safe to re-run.
--
-- Cause: auth.users exists but public.company_users has no active row for that email.
-- Fix: create (or reuse) a company + insert company_users with status = 'active'.

BEGIN;

-- ---------------------------------------------------------------------------
-- DIAGNOSE (optional — run alone before the fix block)
-- ---------------------------------------------------------------------------
-- SELECT id, email FROM auth.users WHERE lower(email) = 'precisionaccounting@gmail.com';
-- SELECT id, name, status FROM public.companies ORDER BY created_at DESC LIMIT 20;
-- SELECT cu.*, c.name FROM public.company_users cu
--   LEFT JOIN public.companies c ON c.id = cu.company_id
--   WHERE lower(cu.user_email) = 'precisionaccounting@gmail.com';

-- ---------------------------------------------------------------------------
-- Ensure company exists
-- ---------------------------------------------------------------------------
INSERT INTO public.companies (name, subscription_status, status)
SELECT 'Precision Accounting', 'active', 'active'
WHERE NOT EXISTS (
  SELECT 1 FROM public.companies
  WHERE lower(trim(name)) = lower('Precision Accounting')
);

-- Optional: set V2 pricing columns when migration 029 has been applied
DO $pricing$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'companies' AND column_name = 'subscription_tier'
  ) THEN
    UPDATE public.companies
    SET
      subscription_tier = coalesce(subscription_tier, 'Professional'),
      monthly_fee = coalesce(monthly_fee, 4999)
    WHERE lower(trim(name)) = lower('Precision Accounting');
  END IF;
END
$pricing$;

-- ---------------------------------------------------------------------------
-- Bind user → company (owner)
-- ---------------------------------------------------------------------------
INSERT INTO public.company_users (
  company_id,
  user_email,
  role,
  status,
  created_at
)
SELECT
  c.id,
  lower('precisionaccounting@gmail.com'),
  'owner',
  'active',
  now()
FROM public.companies c
WHERE lower(trim(c.name)) = lower('Precision Accounting')
  AND NOT EXISTS (
    SELECT 1
    FROM public.company_users cu
    WHERE lower(cu.user_email) = lower('precisionaccounting@gmail.com')
      AND cu.company_id = c.id
  )
ORDER BY c.created_at ASC
LIMIT 1;

-- Reactivate if row exists but status is not active
UPDATE public.company_users cu
SET status = 'active', role = coalesce(nullif(trim(cu.role), ''), 'owner')
FROM public.companies c
WHERE cu.company_id = c.id
  AND lower(trim(c.name)) = lower('Precision Accounting')
  AND lower(cu.user_email) = lower('precisionaccounting@gmail.com')
  AND cu.status IS DISTINCT FROM 'active';

COMMIT;

NOTIFY pgrst, 'reload schema';

-- VERIFY — expect one row
SELECT
  cu.user_email,
  cu.role,
  cu.status,
  c.id AS company_id,
  c.name AS company_name
FROM public.company_users cu
JOIN public.companies c ON c.id = cu.company_id
WHERE lower(cu.user_email) = lower('precisionaccounting@gmail.com');

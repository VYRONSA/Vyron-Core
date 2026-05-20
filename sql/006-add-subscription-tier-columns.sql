-- 006-add-subscription-tier-columns.sql
-- Adds workspace subscription tier + monthly fee to companies (run after 001).
-- Idempotent.

BEGIN;

ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS subscription_tier text DEFAULT 'Starter';

ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS monthly_fee numeric DEFAULT 499;

COMMIT;

NOTIFY pgrst, 'reload schema';

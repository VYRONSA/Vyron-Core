-- Align hr_warnings with application expectations (idempotent).
-- Apply in Supabase SQL Editor on project ldnrmgafsquzfitcuvxq.
-- Live DB already has: id, company_id, employee_id, warning_type, expiry_date, description, status, created_at

ALTER TABLE public.hr_warnings ADD COLUMN IF NOT EXISTS employee_name text;
ALTER TABLE public.hr_warnings ADD COLUMN IF NOT EXISTS incident_type text;
ALTER TABLE public.hr_warnings ADD COLUMN IF NOT EXISTS incident_date date;
ALTER TABLE public.hr_warnings ADD COLUMN IF NOT EXISTS issue_date date;
ALTER TABLE public.hr_warnings ADD COLUMN IF NOT EXISTS manager_notes text;
ALTER TABLE public.hr_warnings ADD COLUMN IF NOT EXISTS severity text;

CREATE INDEX IF NOT EXISTS hr_warnings_company_id_idx ON public.hr_warnings(company_id);

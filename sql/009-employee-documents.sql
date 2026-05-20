-- Optional: employee HR vault files per company (Contract Centre / HR Document Engine).
-- Run in Supabase SQL editor if REST returns:
--   "Could not find the table 'public.employee_documents' in the schema cache"
-- Idempotent: safe to re-run.

BEGIN;

CREATE TABLE IF NOT EXISTS public.employee_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
  created_at timestamptz NOT NULL DEFAULT now (),
  company_id uuid NOT NULL REFERENCES public.companies (id) ON DELETE CASCADE,
  employee_id uuid NOT NULL,
  employee_name text,
  category_id uuid,
  document_type text NOT NULL DEFAULT '',
  document_title text NOT NULL DEFAULT '',
  document_notes text,
  file_name text,
  file_url text,
  file_bucket text,
  file_path text,
  file_mime_type text,
  file_size_bytes bigint,
  issue_date date,
  expiry_date date,
  signed_status text,
  status text NOT NULL DEFAULT 'active',
  uploaded_by text,
  version_number integer DEFAULT 1,
  compliance_required boolean DEFAULT false,
  compliance_status text,
  review_required boolean DEFAULT false
);

CREATE INDEX IF NOT EXISTS employee_documents_company_id_idx ON public.employee_documents (company_id);
CREATE INDEX IF NOT EXISTS employee_documents_employee_id_idx ON public.employee_documents (employee_id);

ALTER TABLE public.employee_documents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "DEV allow all employee_documents" ON public.employee_documents;

CREATE POLICY "DEV allow all employee_documents" ON public.employee_documents FOR ALL USING (true)
WITH
  CHECK (true);

GRANT ALL ON TABLE public.employee_documents TO anon, authenticated, service_role;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- 055-contract-intelligence-smart-generator.sql
-- Batch 5: Contract Intelligence & Smart Contract Generator backend foundation.
-- Safe to re-run.

BEGIN;

DO $contract_foundation$
BEGIN
  IF to_regclass('public.contract_templates') IS NULL
     OR to_regclass('public.contract_template_versions') IS NULL
     OR to_regclass('public.contract_merge_jobs') IS NULL
     OR to_regclass('public.employee_generated_documents') IS NULL THEN
    RAISE NOTICE 'Contract prerequisites missing (contract_templates/contract_template_versions/contract_merge_jobs/employee_generated_documents). Skipping contract-dependent section in 055.';
  ELSE
    ALTER TABLE public.contract_templates
      ADD COLUMN IF NOT EXISTS description text,
      ADD COLUMN IF NOT EXISTS template_category text NOT NULL DEFAULT 'permanent_employment',
      ADD COLUMN IF NOT EXISTS effective_date date,
      ADD COLUMN IF NOT EXISTS archived_at timestamptz,
      ADD COLUMN IF NOT EXISTS archived_by text,
      ADD COLUMN IF NOT EXISTS template_key text,
      ADD COLUMN IF NOT EXISTS created_by text,
      ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

    ALTER TABLE public.contract_template_versions
      ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'draft',
      ADD COLUMN IF NOT EXISTS effective_date date,
      ADD COLUMN IF NOT EXISTS archived boolean NOT NULL DEFAULT false,
      ADD COLUMN IF NOT EXISTS archived_at timestamptz,
      ADD COLUMN IF NOT EXISTS archived_by text,
      ADD COLUMN IF NOT EXISTS validation_summary jsonb NOT NULL DEFAULT '{}'::jsonb;

    ALTER TABLE public.contract_merge_jobs
      ADD COLUMN IF NOT EXISTS merge_schema_version integer NOT NULL DEFAULT 1,
      ADD COLUMN IF NOT EXISTS validation_errors jsonb NOT NULL DEFAULT '[]'::jsonb;

    ALTER TABLE public.employee_generated_documents
      ADD COLUMN IF NOT EXISTS template_version_id uuid REFERENCES public.contract_template_versions (id) ON DELETE SET NULL,
      ADD COLUMN IF NOT EXISTS template_version_number integer,
      ADD COLUMN IF NOT EXISTS merge_snapshot_json jsonb NOT NULL DEFAULT '{}'::jsonb,
      ADD COLUMN IF NOT EXISTS merge_values_json jsonb NOT NULL DEFAULT '{}'::jsonb,
      ADD COLUMN IF NOT EXISTS generated_at timestamptz NOT NULL DEFAULT now(),
      ADD COLUMN IF NOT EXISTS generated_by text,
      ADD COLUMN IF NOT EXISTS amendment_root_document_id uuid,
      ADD COLUMN IF NOT EXISTS amendment_of_document_id uuid,
      ADD COLUMN IF NOT EXISTS immutable_lock boolean NOT NULL DEFAULT true,
      ADD COLUMN IF NOT EXISTS archived boolean NOT NULL DEFAULT false;

    CREATE UNIQUE INDEX IF NOT EXISTS contract_templates_company_template_key_uidx
      ON public.contract_templates (company_id, template_key)
      WHERE template_key IS NOT NULL;

    CREATE UNIQUE INDEX IF NOT EXISTS contract_templates_company_name_category_uidx
      ON public.contract_templates (company_id, lower(template_name), lower(template_category));

    CREATE UNIQUE INDEX IF NOT EXISTS contract_template_versions_active_uidx
      ON public.contract_template_versions (template_id)
      WHERE is_active = true;

    CREATE INDEX IF NOT EXISTS contract_templates_company_category_idx
      ON public.contract_templates (company_id, template_category, archived);

    CREATE INDEX IF NOT EXISTS contract_template_versions_template_created_idx
      ON public.contract_template_versions (template_id, created_at DESC);

    CREATE INDEX IF NOT EXISTS employee_generated_documents_company_employee_idx
      ON public.employee_generated_documents (company_id, employee_id, created_at DESC);

    CREATE INDEX IF NOT EXISTS employee_generated_documents_amendment_root_idx
      ON public.employee_generated_documents (amendment_root_document_id, template_id, template_version_number);

    UPDATE public.contract_templates
    SET template_key = lower(regexp_replace(coalesce(template_name, ''), '[^a-zA-Z0-9]+', '_', 'g')),
        updated_at = now()
    WHERE template_key IS NULL;
  END IF;
END
$contract_foundation$;

CREATE TABLE IF NOT EXISTS public.contract_placeholder_registry (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid REFERENCES public.companies (id) ON DELETE CASCADE,
  placeholder_key text NOT NULL,
  label text NOT NULL,
  source_type text NOT NULL DEFAULT 'employee',
  source_field text,
  required boolean NOT NULL DEFAULT false,
  questionnaire_field text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, placeholder_key)
);

CREATE INDEX IF NOT EXISTS contract_placeholder_registry_company_idx
  ON public.contract_placeholder_registry (company_id, active, placeholder_key);

INSERT INTO public.contract_placeholder_registry (
  company_id,
  placeholder_key,
  label,
  source_type,
  source_field,
  required,
  questionnaire_field,
  active
)
VALUES
  (NULL, 'EmployeeName', 'Employee Name', 'employee', 'name', true, NULL, true),
  (NULL, 'EmployeeSurname', 'Employee Surname', 'employee', 'surname', true, NULL, true),
  (NULL, 'EmployeeNumber', 'Employee Number', 'employee', 'employee_number', true, NULL, true),
  (NULL, 'Position', 'Position', 'employee', 'position', true, 'position', true),
  (NULL, 'Department', 'Department', 'employee', 'department', true, 'department', true),
  (NULL, 'Branch', 'Branch', 'employee', 'branch', false, 'branch', true),
  (NULL, 'Manager', 'Manager', 'employee', 'manager_name', false, 'manager', true),
  (NULL, 'StartDate', 'Start Date', 'employee', 'start_date', true, 'startDate', true),
  (NULL, 'Probation', 'Probation', 'employee', 'probation', false, 'probation', true),
  (NULL, 'Salary', 'Salary', 'employee', 'salary', false, 'salary', true),
  (NULL, 'HourlyRate', 'Hourly Rate', 'employee', 'hourly_rate', false, 'hourlyRate', true),
  (NULL, 'DailyRate', 'Daily Rate', 'employee', 'daily_rate', false, 'dailyRate', true),
  (NULL, 'WorkingHours', 'Working Hours', 'employee', 'working_hours', false, 'workingHours', true),
  (NULL, 'LeaveCycle', 'Leave Cycle', 'employee', 'leave_cycle', false, 'leaveCycle', true),
  (NULL, 'BankingDetails', 'Banking Details', 'employee', 'banking_details', false, 'bankingDetails', true),
  (NULL, 'EmergencyContact', 'Emergency Contact', 'employee', 'emergency_contact', false, 'emergencyContact', true),
  (NULL, 'Benefits', 'Benefits', 'employee', 'benefits', false, 'benefits', true),
  (NULL, 'Allowances', 'Allowances', 'employee', 'allowances', false, 'allowances', true),
  (NULL, 'CompanyName', 'Company Name', 'company', 'company_name', true, NULL, true),
  (NULL, 'CompanyRegistration', 'Company Registration', 'company', 'registration_number', false, NULL, true),
  (NULL, 'CompanyAddress', 'Company Address', 'company', 'address', false, NULL, true)
ON CONFLICT (company_id, placeholder_key) DO NOTHING;

ALTER TABLE public.contract_placeholder_registry ENABLE ROW LEVEL SECURITY;

DO $tenant$
BEGIN
  IF to_regprocedure('public.vyron_user_company_ids()') IS NULL OR to_regprocedure('public.vyron_is_platform_operator()') IS NULL THEN
    RAISE NOTICE 'Tenant helper functions missing. Skipping policy creation for 055.';
    RETURN;
  END IF;

  DROP POLICY IF EXISTS contract_placeholder_registry_tenant_isolation ON public.contract_placeholder_registry;
  CREATE POLICY contract_placeholder_registry_tenant_isolation
  ON public.contract_placeholder_registry
  FOR ALL TO authenticated
  USING (
    public.vyron_is_platform_operator()
    OR company_id IS NULL
    OR EXISTS (
      SELECT 1
      FROM public.vyron_user_company_ids() as c(company_id)
      WHERE c.company_id::text = public.contract_placeholder_registry.company_id::text
    )
  )
  WITH CHECK (
    public.vyron_is_platform_operator()
    OR company_id IS NULL
    OR EXISTS (
      SELECT 1
      FROM public.vyron_user_company_ids() as c(company_id)
      WHERE c.company_id::text = public.contract_placeholder_registry.company_id::text
    )
  );

  REVOKE ALL ON public.contract_placeholder_registry FROM anon;
  GRANT SELECT, INSERT, UPDATE, DELETE ON public.contract_placeholder_registry TO authenticated;
END
$tenant$;

COMMIT;

NOTIFY pgrst, 'reload schema';

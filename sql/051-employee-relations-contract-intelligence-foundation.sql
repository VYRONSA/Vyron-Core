-- 051-employee-relations-contract-intelligence-foundation.sql
-- VYRON CORE v1.0: Employee Relations + Contract Intelligence foundation schema.
-- Batch 1 scope: data foundation and migration reliability only.
-- Safe to re-run.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$
BEGIN
  IF to_regclass('public.companies') IS NULL THEN
    RAISE EXCEPTION 'Prerequisite missing: public.companies. Run baseline company migrations first.';
  END IF;

  IF to_regclass('public.employees') IS NULL THEN
    RAISE EXCEPTION 'Prerequisite missing: public.employees. Run baseline employee migrations first.';
  END IF;
END $$;

-- Canonical safety baseline for hr_cases and hr_warnings.
-- If tables already exist, these statements are no-op/column-safe.
CREATE TABLE IF NOT EXISTS public.hr_cases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies (id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES public.employees (id) ON DELETE CASCADE,
  linked_exception_id uuid,
  case_type text NOT NULL DEFAULT 'disciplinary',
  title text NOT NULL DEFAULT '',
  description text NOT NULL DEFAULT '',
  validity_status text NOT NULL DEFAULT 'review_required',
  status text NOT NULL DEFAULT 'open',
  employee_response_required boolean DEFAULT false,
  employee_response text,
  manager_feedback text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.hr_warnings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies (id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES public.employees (id) ON DELETE CASCADE,
  warning_type text NOT NULL DEFAULT 'verbal',
  description text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'active',
  expiry_date date,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.hr_cases ADD COLUMN IF NOT EXISTS root_cause text;
ALTER TABLE public.hr_cases ADD COLUMN IF NOT EXISTS root_cause_confidence numeric(5,2);
ALTER TABLE public.hr_cases ADD COLUMN IF NOT EXISTS business_impact_json jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE public.hr_cases ADD COLUMN IF NOT EXISTS recommended_decision text;
ALTER TABLE public.hr_cases ADD COLUMN IF NOT EXISTS alternative_decision text;
ALTER TABLE public.hr_cases ADD COLUMN IF NOT EXISTS expected_outcome text;
ALTER TABLE public.hr_cases ADD COLUMN IF NOT EXISTS consequence_if_ignored text;
ALTER TABLE public.hr_cases ADD COLUMN IF NOT EXISTS priority_score integer;
ALTER TABLE public.hr_cases ADD COLUMN IF NOT EXISTS owner_user_id uuid;
ALTER TABLE public.hr_cases ADD COLUMN IF NOT EXISTS due_at timestamptz;
ALTER TABLE public.hr_cases ADD COLUMN IF NOT EXISTS closure_reason text;

ALTER TABLE public.hr_warnings ADD COLUMN IF NOT EXISTS linked_hr_case_id uuid;
ALTER TABLE public.hr_warnings ADD COLUMN IF NOT EXISTS progression_stage text;
ALTER TABLE public.hr_warnings ADD COLUMN IF NOT EXISTS escalation_due_at timestamptz;
ALTER TABLE public.hr_warnings ADD COLUMN IF NOT EXISTS withdrawn_reason text;
ALTER TABLE public.hr_warnings ADD COLUMN IF NOT EXISTS withdrawn_by text;

CREATE INDEX IF NOT EXISTS hr_cases_company_id_idx ON public.hr_cases (company_id);
CREATE INDEX IF NOT EXISTS hr_cases_employee_id_idx ON public.hr_cases (employee_id);
CREATE INDEX IF NOT EXISTS hr_cases_status_idx ON public.hr_cases (status);
CREATE INDEX IF NOT EXISTS hr_cases_due_at_idx ON public.hr_cases (due_at);
CREATE INDEX IF NOT EXISTS hr_warnings_company_id_idx ON public.hr_warnings (company_id);
CREATE INDEX IF NOT EXISTS hr_warnings_employee_id_idx ON public.hr_warnings (employee_id);
CREATE INDEX IF NOT EXISTS hr_warnings_stage_idx ON public.hr_warnings (progression_stage);

-- Hearing engine.
CREATE TABLE IF NOT EXISTS public.hearing_cases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies (id) ON DELETE CASCADE,
  hr_case_id uuid REFERENCES public.hr_cases (id) ON DELETE SET NULL,
  employee_id uuid NOT NULL REFERENCES public.employees (id) ON DELETE CASCADE,
  hearing_type text NOT NULL DEFAULT 'disciplinary',
  hearing_status text NOT NULL DEFAULT 'scheduled',
  scheduled_at timestamptz,
  venue text,
  chairperson_user_id uuid,
  outcome_summary text,
  outcome_code text,
  confidence_score numeric(5,2),
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.hearing_participants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies (id) ON DELETE CASCADE,
  hearing_case_id uuid NOT NULL REFERENCES public.hearing_cases (id) ON DELETE CASCADE,
  participant_type text NOT NULL,
  employee_id uuid REFERENCES public.employees (id) ON DELETE SET NULL,
  external_name text,
  contact text,
  attendance_status text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.hearing_evidence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies (id) ON DELETE CASCADE,
  hearing_case_id uuid NOT NULL REFERENCES public.hearing_cases (id) ON DELETE CASCADE,
  evidence_type text NOT NULL,
  file_bucket text,
  file_path text,
  submitted_by text,
  submitted_at timestamptz NOT NULL DEFAULT now(),
  admissibility_status text NOT NULL DEFAULT 'pending'
);

CREATE INDEX IF NOT EXISTS hearing_cases_company_id_idx ON public.hearing_cases (company_id);
CREATE INDEX IF NOT EXISTS hearing_cases_employee_id_idx ON public.hearing_cases (employee_id);
CREATE INDEX IF NOT EXISTS hearing_cases_hr_case_id_idx ON public.hearing_cases (hr_case_id);
CREATE INDEX IF NOT EXISTS hearing_participants_company_id_idx ON public.hearing_participants (company_id);
CREATE INDEX IF NOT EXISTS hearing_participants_hearing_case_id_idx ON public.hearing_participants (hearing_case_id);
CREATE INDEX IF NOT EXISTS hearing_evidence_company_id_idx ON public.hearing_evidence (company_id);
CREATE INDEX IF NOT EXISTS hearing_evidence_hearing_case_id_idx ON public.hearing_evidence (hearing_case_id);

-- Progressive discipline state.
CREATE TABLE IF NOT EXISTS public.discipline_progressions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies (id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES public.employees (id) ON DELETE CASCADE,
  root_incident_id uuid,
  current_stage text NOT NULL DEFAULT 'first_warning',
  status text NOT NULL DEFAULT 'active',
  stage_reason text,
  expires_at timestamptz,
  escalation_due_at timestamptz,
  similar_offence_count integer NOT NULL DEFAULT 0,
  previous_hearing_count integer NOT NULL DEFAULT 0,
  previous_counselling_count integer NOT NULL DEFAULT 0,
  risk_score integer,
  financial_impact_estimate numeric(14,2),
  operational_impact_estimate numeric(14,2),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS discipline_progressions_company_id_idx ON public.discipline_progressions (company_id);
CREATE INDEX IF NOT EXISTS discipline_progressions_employee_id_idx ON public.discipline_progressions (employee_id);
CREATE INDEX IF NOT EXISTS discipline_progressions_stage_idx ON public.discipline_progressions (current_stage);

-- AI document and decision assistant records (structured + auditable + versioned).
CREATE TABLE IF NOT EXISTS public.ai_prompt_registry (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid,
  prompt_key text NOT NULL,
  prompt_version integer NOT NULL DEFAULT 1,
  prompt_template text NOT NULL,
  output_schema jsonb NOT NULL DEFAULT '{}'::jsonb,
  active boolean NOT NULL DEFAULT true,
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, prompt_key, prompt_version)
);

CREATE TABLE IF NOT EXISTS public.er_recommendations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies (id) ON DELETE CASCADE,
  case_id uuid REFERENCES public.hr_cases (id) ON DELETE SET NULL,
  hearing_case_id uuid REFERENCES public.hearing_cases (id) ON DELETE SET NULL,
  recommendation_type text NOT NULL,
  recommended_decision text,
  alternative_decision text,
  expected_outcome text,
  consequence_if_ignored text,
  confidence_score numeric(5,2),
  model_name text,
  model_version text,
  prompt_key text,
  prompt_version integer,
  supporting_evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  output_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.ai_document_generations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies (id) ON DELETE CASCADE,
  employee_id uuid REFERENCES public.employees (id) ON DELETE SET NULL,
  hr_case_id uuid REFERENCES public.hr_cases (id) ON DELETE SET NULL,
  hearing_case_id uuid REFERENCES public.hearing_cases (id) ON DELETE SET NULL,
  document_type text NOT NULL,
  document_version integer NOT NULL DEFAULT 1,
  prompt_key text,
  prompt_version integer,
  model_name text,
  model_version text,
  input_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  output_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  edited_payload jsonb,
  finalised boolean NOT NULL DEFAULT false,
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ai_prompt_registry_prompt_idx ON public.ai_prompt_registry (prompt_key, prompt_version);
CREATE INDEX IF NOT EXISTS er_recommendations_company_id_idx ON public.er_recommendations (company_id);
CREATE INDEX IF NOT EXISTS er_recommendations_case_id_idx ON public.er_recommendations (case_id);
CREATE INDEX IF NOT EXISTS ai_document_generations_company_id_idx ON public.ai_document_generations (company_id);
CREATE INDEX IF NOT EXISTS ai_document_generations_employee_id_idx ON public.ai_document_generations (employee_id);
CREATE INDEX IF NOT EXISTS ai_document_generations_document_type_idx ON public.ai_document_generations (document_type);

-- Complete permanent employee relations timeline (append-only by design contract).
CREATE TABLE IF NOT EXISTS public.employee_relations_timeline_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies (id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES public.employees (id) ON DELETE CASCADE,
  event_type text NOT NULL,
  event_date timestamptz NOT NULL DEFAULT now(),
  source_table text,
  source_id uuid,
  title text,
  summary text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS employee_relations_timeline_company_id_idx ON public.employee_relations_timeline_events (company_id);
CREATE INDEX IF NOT EXISTS employee_relations_timeline_employee_id_idx ON public.employee_relations_timeline_events (employee_id);
CREATE INDEX IF NOT EXISTS employee_relations_timeline_event_type_idx ON public.employee_relations_timeline_events (event_type);
CREATE INDEX IF NOT EXISTS employee_relations_timeline_event_date_idx ON public.employee_relations_timeline_events (event_date DESC);

-- Contract intelligence: template versioning and merge jobs.
DO $contract$
BEGIN
  IF to_regclass('public.contract_templates') IS NULL THEN
    RAISE NOTICE 'Prerequisite missing: public.contract_templates. Skipping contract intelligence tables in migration 051.';
  ELSE
    EXECUTE '
      CREATE TABLE IF NOT EXISTS public.contract_template_versions (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        company_id uuid NOT NULL REFERENCES public.companies (id) ON DELETE CASCADE,
        template_id uuid NOT NULL REFERENCES public.contract_templates (id) ON DELETE CASCADE,
        version_number integer NOT NULL,
        file_bucket text,
        file_path text,
        placeholder_schema jsonb NOT NULL DEFAULT ''{}''::jsonb,
        questionnaire_schema jsonb NOT NULL DEFAULT ''{}''::jsonb,
        change_notes text,
        is_active boolean NOT NULL DEFAULT false,
        created_by text,
        created_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE (template_id, version_number)
      )
    ';

    IF to_regclass('public.employee_generated_documents') IS NULL THEN
      EXECUTE '
        CREATE TABLE IF NOT EXISTS public.contract_merge_jobs (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          company_id uuid NOT NULL REFERENCES public.companies (id) ON DELETE CASCADE,
          employee_id uuid NOT NULL REFERENCES public.employees (id) ON DELETE CASCADE,
          template_id uuid REFERENCES public.contract_templates (id) ON DELETE SET NULL,
          template_version_id uuid REFERENCES public.contract_template_versions (id) ON DELETE SET NULL,
          generated_document_id uuid,
          merge_status text NOT NULL DEFAULT ''queued'',
          merge_input_snapshot jsonb NOT NULL DEFAULT ''{}''::jsonb,
          merge_output_snapshot jsonb,
          error_message text,
          started_at timestamptz,
          completed_at timestamptz,
          created_by text,
          created_at timestamptz NOT NULL DEFAULT now()
        )
      ';
      RAISE NOTICE 'Prerequisite missing: public.employee_generated_documents. Created contract_merge_jobs without FK to generated documents.';
    ELSE
      EXECUTE '
        CREATE TABLE IF NOT EXISTS public.contract_merge_jobs (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          company_id uuid NOT NULL REFERENCES public.companies (id) ON DELETE CASCADE,
          employee_id uuid NOT NULL REFERENCES public.employees (id) ON DELETE CASCADE,
          template_id uuid REFERENCES public.contract_templates (id) ON DELETE SET NULL,
          template_version_id uuid REFERENCES public.contract_template_versions (id) ON DELETE SET NULL,
          generated_document_id uuid REFERENCES public.employee_generated_documents (id) ON DELETE SET NULL,
          merge_status text NOT NULL DEFAULT ''queued'',
          merge_input_snapshot jsonb NOT NULL DEFAULT ''{}''::jsonb,
          merge_output_snapshot jsonb,
          error_message text,
          started_at timestamptz,
          completed_at timestamptz,
          created_by text,
          created_at timestamptz NOT NULL DEFAULT now()
        )
      ';

      EXECUTE 'ALTER TABLE public.employee_generated_documents ADD COLUMN IF NOT EXISTS merge_job_id uuid';
      EXECUTE 'ALTER TABLE public.employee_generated_documents ADD COLUMN IF NOT EXISTS generation_context_json jsonb NOT NULL DEFAULT ''{}''::jsonb';
      EXECUTE 'ALTER TABLE public.employee_generated_documents ADD COLUMN IF NOT EXISTS legal_clause_hash text';
      EXECUTE 'ALTER TABLE public.employee_generated_documents ADD COLUMN IF NOT EXISTS review_date date';
      EXECUTE 'ALTER TABLE public.employee_generated_documents ADD COLUMN IF NOT EXISTS expiry_date date';
    END IF;

    EXECUTE 'ALTER TABLE public.contract_templates ADD COLUMN IF NOT EXISTS contract_type text';
    EXECUTE 'ALTER TABLE public.contract_templates ADD COLUMN IF NOT EXISTS template_scope text NOT NULL DEFAULT ''company_private''';
    EXECUTE 'ALTER TABLE public.contract_templates ADD COLUMN IF NOT EXISTS active_version_number integer';
    EXECUTE 'ALTER TABLE public.contract_templates ADD COLUMN IF NOT EXISTS archived boolean NOT NULL DEFAULT false';

    EXECUTE 'CREATE INDEX IF NOT EXISTS contract_template_versions_company_id_idx ON public.contract_template_versions (company_id)';
    EXECUTE 'CREATE INDEX IF NOT EXISTS contract_template_versions_template_id_idx ON public.contract_template_versions (template_id)';
    EXECUTE 'CREATE INDEX IF NOT EXISTS contract_merge_jobs_company_id_idx ON public.contract_merge_jobs (company_id)';
    EXECUTE 'CREATE INDEX IF NOT EXISTS contract_merge_jobs_employee_id_idx ON public.contract_merge_jobs (employee_id)';
    EXECUTE 'CREATE INDEX IF NOT EXISTS contract_merge_jobs_status_idx ON public.contract_merge_jobs (merge_status)';
  END IF;
END
$contract$;

-- Digital signature provider extensibility + lifecycle trail.
DO $signing$
BEGIN
  IF to_regclass('public.document_signing_links') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.document_signing_links ADD COLUMN IF NOT EXISTS revoked_at timestamptz';
    EXECUTE 'ALTER TABLE public.document_signing_links ADD COLUMN IF NOT EXISTS revoked_by text';
    EXECUTE 'ALTER TABLE public.document_signing_links ADD COLUMN IF NOT EXISTS reminder_count integer NOT NULL DEFAULT 0';
    EXECUTE 'ALTER TABLE public.document_signing_links ADD COLUMN IF NOT EXISTS last_reminder_at timestamptz';
    EXECUTE 'ALTER TABLE public.document_signing_links ADD COLUMN IF NOT EXISTS access_ip_last text';
    EXECUTE 'ALTER TABLE public.document_signing_links ADD COLUMN IF NOT EXISTS provider text NOT NULL DEFAULT ''native''';
    EXECUTE 'ALTER TABLE public.document_signing_links ADD COLUMN IF NOT EXISTS provider_payload jsonb NOT NULL DEFAULT ''{}''::jsonb';
    EXECUTE 'CREATE INDEX IF NOT EXISTS document_signing_links_provider_idx ON public.document_signing_links (provider)';
  ELSE
    RAISE NOTICE 'Prerequisite missing: public.document_signing_links. Skipping signing link extensions in migration 051.';
  END IF;

  IF to_regclass('public.digital_signatures') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.digital_signatures ADD COLUMN IF NOT EXISTS signature_hash text';
    EXECUTE 'ALTER TABLE public.digital_signatures ADD COLUMN IF NOT EXISTS signing_method text NOT NULL DEFAULT ''native_pad''';
    EXECUTE 'ALTER TABLE public.digital_signatures ADD COLUMN IF NOT EXISTS evidence_bundle_id uuid';
    EXECUTE 'ALTER TABLE public.digital_signatures ADD COLUMN IF NOT EXISTS provider text NOT NULL DEFAULT ''native''';
    EXECUTE 'ALTER TABLE public.digital_signatures ADD COLUMN IF NOT EXISTS provider_reference text';
  ELSE
    RAISE NOTICE 'Prerequisite missing: public.digital_signatures. Skipping signature metadata extensions in migration 051.';
  END IF;

  IF to_regclass('public.employee_generated_documents') IS NOT NULL
     AND to_regclass('public.document_signing_links') IS NOT NULL THEN
    EXECUTE '
      CREATE TABLE IF NOT EXISTS public.contract_signing_events (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        company_id uuid NOT NULL REFERENCES public.companies (id) ON DELETE CASCADE,
        document_id uuid REFERENCES public.employee_generated_documents (id) ON DELETE SET NULL,
        signing_link_id uuid REFERENCES public.document_signing_links (id) ON DELETE SET NULL,
        event_type text NOT NULL,
        actor text,
        metadata jsonb NOT NULL DEFAULT ''{}''::jsonb,
        created_at timestamptz NOT NULL DEFAULT now()
      )
    ';

    EXECUTE 'CREATE INDEX IF NOT EXISTS contract_signing_events_company_id_idx ON public.contract_signing_events (company_id)';
    EXECUTE 'CREATE INDEX IF NOT EXISTS contract_signing_events_document_id_idx ON public.contract_signing_events (document_id)';
    EXECUTE 'CREATE INDEX IF NOT EXISTS contract_signing_events_link_id_idx ON public.contract_signing_events (signing_link_id)';
  ELSE
    RAISE NOTICE 'Prerequisite missing: employee_generated_documents or document_signing_links. Skipping contract_signing_events in migration 051.';
  END IF;
END
$signing$;

-- Printable packet exports.
CREATE TABLE IF NOT EXISTS public.hr_packet_exports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies (id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES public.employees (id) ON DELETE CASCADE,
  hr_case_id uuid REFERENCES public.hr_cases (id) ON DELETE SET NULL,
  hearing_case_id uuid REFERENCES public.hearing_cases (id) ON DELETE SET NULL,
  packet_type text NOT NULL,
  export_status text NOT NULL DEFAULT 'queued',
  file_bucket text,
  file_path text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS hr_packet_exports_company_id_idx ON public.hr_packet_exports (company_id);
CREATE INDEX IF NOT EXISTS hr_packet_exports_employee_id_idx ON public.hr_packet_exports (employee_id);
CREATE INDEX IF NOT EXISTS hr_packet_exports_case_id_idx ON public.hr_packet_exports (hr_case_id);

-- Employee notes with attachments, mention links, AI summaries.
DO $notes$
BEGIN
  IF to_regclass('public.employee_notes') IS NULL THEN
    RAISE NOTICE 'Prerequisite missing: public.employee_notes. Skipping employee notes extensions in migration 051.';
  ELSE
    EXECUTE 'ALTER TABLE public.employee_notes ADD COLUMN IF NOT EXISTS note_category text NOT NULL DEFAULT ''general''';
    EXECUTE 'ALTER TABLE public.employee_notes ADD COLUMN IF NOT EXISTS follow_up_date date';
    EXECUTE 'ALTER TABLE public.employee_notes ADD COLUMN IF NOT EXISTS ai_summary text';
    EXECUTE 'ALTER TABLE public.employee_notes ADD COLUMN IF NOT EXISTS mention_links jsonb NOT NULL DEFAULT ''[]''::jsonb';

    EXECUTE '
      CREATE TABLE IF NOT EXISTS public.employee_note_attachments (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        company_id uuid NOT NULL REFERENCES public.companies (id) ON DELETE CASCADE,
        employee_note_id uuid NOT NULL REFERENCES public.employee_notes (id) ON DELETE CASCADE,
        file_bucket text,
        file_path text,
        file_name text,
        created_at timestamptz NOT NULL DEFAULT now()
      )
    ';

    EXECUTE 'CREATE INDEX IF NOT EXISTS employee_notes_company_id_idx ON public.employee_notes (company_id)';
    EXECUTE 'CREATE INDEX IF NOT EXISTS employee_notes_employee_id_idx ON public.employee_notes (employee_id)';
    EXECUTE 'CREATE INDEX IF NOT EXISTS employee_note_attachments_company_id_idx ON public.employee_note_attachments (company_id)';
    EXECUTE 'CREATE INDEX IF NOT EXISTS employee_note_attachments_note_id_idx ON public.employee_note_attachments (employee_note_id)';
  END IF;
END
$notes$;

-- Unified document centre support.
CREATE TABLE IF NOT EXISTS public.employee_document_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies (id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES public.employees (id) ON DELETE CASCADE,
  source_table text NOT NULL,
  source_document_id uuid NOT NULL,
  version_number integer NOT NULL DEFAULT 1,
  file_bucket text,
  file_path text,
  file_name text,
  mime_type text,
  size_bytes bigint,
  change_reason text,
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source_table, source_document_id, version_number)
);

CREATE TABLE IF NOT EXISTS public.employee_document_audit_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies (id) ON DELETE CASCADE,
  employee_id uuid REFERENCES public.employees (id) ON DELETE SET NULL,
  source_table text NOT NULL,
  source_document_id uuid,
  event_type text NOT NULL,
  event_details jsonb NOT NULL DEFAULT '{}'::jsonb,
  actor text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.employee_document_classifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies (id) ON DELETE CASCADE,
  source_table text NOT NULL,
  source_document_id uuid NOT NULL,
  class_type text NOT NULL,
  compliance_required boolean NOT NULL DEFAULT false,
  retention_policy text,
  review_cycle_days integer,
  pii_level text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source_table, source_document_id)
);

CREATE INDEX IF NOT EXISTS employee_document_versions_company_id_idx ON public.employee_document_versions (company_id);
CREATE INDEX IF NOT EXISTS employee_document_versions_employee_id_idx ON public.employee_document_versions (employee_id);
CREATE INDEX IF NOT EXISTS employee_document_versions_source_idx ON public.employee_document_versions (source_table, source_document_id);
CREATE INDEX IF NOT EXISTS employee_document_audit_history_company_id_idx ON public.employee_document_audit_history (company_id);
CREATE INDEX IF NOT EXISTS employee_document_audit_history_source_idx ON public.employee_document_audit_history (source_table, source_document_id);
CREATE INDEX IF NOT EXISTS employee_document_classifications_company_id_idx ON public.employee_document_classifications (company_id);

-- Enable RLS for new tables.
DO $rls$
DECLARE
  tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'hearing_cases',
    'hearing_participants',
    'hearing_evidence',
    'discipline_progressions',
    'ai_prompt_registry',
    'er_recommendations',
    'ai_document_generations',
    'employee_relations_timeline_events',
    'contract_template_versions',
    'contract_merge_jobs',
    'contract_signing_events',
    'hr_packet_exports',
    'employee_note_attachments',
    'employee_document_versions',
    'employee_document_audit_history',
    'employee_document_classifications'
  ] LOOP
    IF to_regclass(format('public.%I', tbl)) IS NOT NULL THEN
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', tbl);
    END IF;
  END LOOP;
END
$rls$;

DO $tenant$
DECLARE
  tbl text;
BEGIN
  IF to_regprocedure('public.vyron_user_company_ids()') IS NULL OR to_regprocedure('public.vyron_is_platform_operator()') IS NULL THEN
    RAISE NOTICE 'Tenant helper functions missing. Skipping policy creation for migration 051; apply after 030 in secured environments.';
    RETURN;
  END IF;

  FOREACH tbl IN ARRAY ARRAY[
    'hearing_cases',
    'hearing_participants',
    'hearing_evidence',
    'discipline_progressions',
    'er_recommendations',
    'ai_document_generations',
    'employee_relations_timeline_events',
    'contract_template_versions',
    'contract_merge_jobs',
    'contract_signing_events',
    'hr_packet_exports',
    'employee_note_attachments',
    'employee_document_versions',
    'employee_document_audit_history',
    'employee_document_classifications'
  ] LOOP
    IF to_regclass(format('public.%I', tbl)) IS NULL THEN
      CONTINUE;
    END IF;

    EXECUTE format('DROP POLICY IF EXISTS %I_tenant_isolation ON public.%I', tbl, tbl);
    EXECUTE format(
      'CREATE POLICY %I_tenant_isolation ON public.%I FOR ALL TO authenticated USING (
         public.vyron_is_platform_operator()
         OR EXISTS (
           SELECT 1
           FROM public.vyron_user_company_ids() as c(company_id)
           WHERE c.company_id::text = public.%I.company_id::text
         )
       ) WITH CHECK (
         public.vyron_is_platform_operator()
         OR EXISTS (
           SELECT 1
           FROM public.vyron_user_company_ids() as c(company_id)
           WHERE c.company_id::text = public.%I.company_id::text
         )
       )',
      tbl,
      tbl,
      tbl,
      tbl
    );

    EXECUTE format('REVOKE ALL ON public.%I FROM anon', tbl);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO authenticated', tbl);
  END LOOP;

  EXECUTE 'DROP POLICY IF EXISTS ai_prompt_registry_tenant_isolation ON public.ai_prompt_registry';
  EXECUTE '
    CREATE POLICY ai_prompt_registry_tenant_isolation ON public.ai_prompt_registry
    FOR ALL TO authenticated
    USING (
      public.vyron_is_platform_operator()
      OR company_id IS NULL
      OR EXISTS (
        SELECT 1
        FROM public.vyron_user_company_ids() as c(company_id)
        WHERE c.company_id::text = public.ai_prompt_registry.company_id::text
      )
    )
    WITH CHECK (
      public.vyron_is_platform_operator()
      OR company_id IS NULL
      OR EXISTS (
        SELECT 1
        FROM public.vyron_user_company_ids() as c(company_id)
        WHERE c.company_id::text = public.ai_prompt_registry.company_id::text
      )
    )
  ';

  EXECUTE 'REVOKE ALL ON public.ai_prompt_registry FROM anon';
  EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON public.ai_prompt_registry TO authenticated';
END
$tenant$;

COMMIT;

NOTIFY pgrst, 'reload schema';

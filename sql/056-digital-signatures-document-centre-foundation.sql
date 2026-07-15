-- 056-digital-signatures-document-centre-foundation.sql
-- Batch 6: Digital Signatures + Employee Document Centre backend foundation.
-- Safe to re-run.

BEGIN;

DO $$
BEGIN
  IF to_regclass('public.employee_documents') IS NULL THEN
    RAISE NOTICE 'Prerequisite missing: public.employee_documents. Skipping employee document extension section in 056.';
  END IF;

  IF to_regclass('public.document_signing_links') IS NULL THEN
    RAISE NOTICE 'Prerequisite missing: public.document_signing_links. Skipping signing-links extension section in 056.';
  END IF;

  IF to_regclass('public.digital_signatures') IS NULL THEN
    RAISE NOTICE 'Prerequisite missing: public.digital_signatures. Skipping signatures extension section in 056.';
  END IF;

  IF to_regclass('public.employee_document_versions') IS NULL THEN
    RAISE NOTICE 'Prerequisite missing: public.employee_document_versions. signed_copy_document_version_id FK extension will be skipped in 056.';
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.signature_provider_configs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid REFERENCES public.companies (id) ON DELETE CASCADE,
  provider_key text NOT NULL,
  active boolean NOT NULL DEFAULT false,
  config_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, provider_key)
);

DO $signature_sessions_table$
BEGIN
  IF to_regclass('public.document_signing_links') IS NOT NULL THEN
    EXECUTE '
      CREATE TABLE IF NOT EXISTS public.signature_sessions (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        company_id uuid NOT NULL REFERENCES public.companies (id) ON DELETE CASCADE,
        employee_id uuid NOT NULL REFERENCES public.employees (id) ON DELETE CASCADE,
        document_id uuid NOT NULL,
        source_table text NOT NULL DEFAULT ''employee_generated_documents'',
        signing_link_id uuid REFERENCES public.document_signing_links (id) ON DELETE SET NULL,
        provider text NOT NULL DEFAULT ''native'',
        status text NOT NULL DEFAULT ''active'',
        session_token text NOT NULL UNIQUE,
        signer_roles jsonb NOT NULL DEFAULT ''["employee","employer"]''::jsonb,
        started_by text,
        started_at timestamptz NOT NULL DEFAULT now(),
        completed_at timestamptz,
        cancelled_at timestamptz,
        cancelled_by text,
        cancellation_reason text,
        metadata jsonb NOT NULL DEFAULT ''{}''::jsonb
      )
    ';
  ELSE
    EXECUTE '
      CREATE TABLE IF NOT EXISTS public.signature_sessions (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        company_id uuid NOT NULL REFERENCES public.companies (id) ON DELETE CASCADE,
        employee_id uuid NOT NULL REFERENCES public.employees (id) ON DELETE CASCADE,
        document_id uuid NOT NULL,
        source_table text NOT NULL DEFAULT ''employee_generated_documents'',
        signing_link_id uuid,
        provider text NOT NULL DEFAULT ''native'',
        status text NOT NULL DEFAULT ''active'',
        session_token text NOT NULL UNIQUE,
        signer_roles jsonb NOT NULL DEFAULT ''["employee","employer"]''::jsonb,
        started_by text,
        started_at timestamptz NOT NULL DEFAULT now(),
        completed_at timestamptz,
        cancelled_at timestamptz,
        cancelled_by text,
        cancellation_reason text,
        metadata jsonb NOT NULL DEFAULT ''{}''::jsonb
      )
    ';
  END IF;
END
$signature_sessions_table$;

DO $extensions$
BEGIN
  IF to_regclass('public.digital_signatures') IS NOT NULL THEN
    EXECUTE '
      ALTER TABLE public.digital_signatures
        ADD COLUMN IF NOT EXISTS signature_session_id uuid REFERENCES public.signature_sessions (id) ON DELETE SET NULL,
        ADD COLUMN IF NOT EXISTS signed_copy_bucket text,
        ADD COLUMN IF NOT EXISTS signed_copy_path text,
        ADD COLUMN IF NOT EXISTS signed_copy_mime_type text,
        ADD COLUMN IF NOT EXISTS signed_copy_size_bytes bigint,
        ADD COLUMN IF NOT EXISTS device_metadata jsonb NOT NULL DEFAULT ''{}''::jsonb,
        ADD COLUMN IF NOT EXISTS immutable boolean NOT NULL DEFAULT true
    ';
  END IF;

  IF to_regclass('public.document_signing_links') IS NOT NULL THEN
    IF to_regclass('public.employee_document_versions') IS NOT NULL THEN
      EXECUTE '
        ALTER TABLE public.document_signing_links
          ADD COLUMN IF NOT EXISTS signed_copy_document_version_id uuid REFERENCES public.employee_document_versions (id) ON DELETE SET NULL,
          ADD COLUMN IF NOT EXISTS last_event_at timestamptz,
          ADD COLUMN IF NOT EXISTS cancellation_reason text
      ';
    ELSE
      EXECUTE '
        ALTER TABLE public.document_signing_links
          ADD COLUMN IF NOT EXISTS signed_copy_document_version_id uuid,
          ADD COLUMN IF NOT EXISTS last_event_at timestamptz,
          ADD COLUMN IF NOT EXISTS cancellation_reason text
      ';
    END IF;
  END IF;

  IF to_regclass('public.employee_documents') IS NOT NULL THEN
    EXECUTE '
      ALTER TABLE public.employee_documents
        ADD COLUMN IF NOT EXISTS source_table text NOT NULL DEFAULT ''employee_documents'',
        ADD COLUMN IF NOT EXISTS source_document_id uuid,
        ADD COLUMN IF NOT EXISTS document_classification text,
        ADD COLUMN IF NOT EXISTS archived_at timestamptz,
        ADD COLUMN IF NOT EXISTS archived_by text,
        ADD COLUMN IF NOT EXISTS restored_at timestamptz,
        ADD COLUMN IF NOT EXISTS restored_by text,
        ADD COLUMN IF NOT EXISTS amendment_root_document_id uuid,
        ADD COLUMN IF NOT EXISTS amendment_of_document_id uuid,
        ADD COLUMN IF NOT EXISTS immutable_lock boolean NOT NULL DEFAULT false,
        ADD COLUMN IF NOT EXISTS metadata_json jsonb NOT NULL DEFAULT ''{}''::jsonb
    ';
  END IF;
END
$extensions$;

CREATE INDEX IF NOT EXISTS signature_provider_configs_company_idx
  ON public.signature_provider_configs (company_id, provider_key, active);

CREATE INDEX IF NOT EXISTS signature_sessions_company_idx
  ON public.signature_sessions (company_id, status, started_at DESC);

CREATE INDEX IF NOT EXISTS signature_sessions_document_idx
  ON public.signature_sessions (company_id, source_table, document_id);

DO $indexes$
BEGIN
  IF to_regclass('public.digital_signatures') IS NOT NULL THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS digital_signatures_session_idx ON public.digital_signatures (signature_session_id, signed_at DESC)';
  END IF;

  IF to_regclass('public.employee_documents') IS NOT NULL THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS employee_documents_classification_idx ON public.employee_documents (company_id, document_classification, status, created_at DESC)';
    EXECUTE 'CREATE INDEX IF NOT EXISTS employee_documents_source_idx ON public.employee_documents (company_id, source_table, source_document_id)';
  END IF;
END
$indexes$;

ALTER TABLE public.signature_provider_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.signature_sessions ENABLE ROW LEVEL SECURITY;

DO $tenant$
DECLARE
  tbl text;
BEGIN
  IF to_regprocedure('public.vyron_user_company_ids()') IS NULL OR to_regprocedure('public.vyron_is_platform_operator()') IS NULL THEN
    RAISE NOTICE 'Tenant helper functions missing. Skipping policy creation for 056.';
    RETURN;
  END IF;

  FOREACH tbl IN ARRAY ARRAY[
    'signature_provider_configs',
    'signature_sessions'
  ] LOOP
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
END
$tenant$;

COMMIT;

NOTIFY pgrst, 'reload schema';

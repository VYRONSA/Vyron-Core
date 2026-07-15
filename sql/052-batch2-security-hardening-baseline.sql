-- 052-batch2-security-hardening-baseline.sql
-- Batch 2: Security hardening baseline for Employee Relations, Contracts, Documents, Signatures, AI document generation.
-- Safe to re-run.

BEGIN;

DO $$
BEGIN
  IF to_regprocedure('public.vyron_user_company_ids()') IS NULL THEN
    RAISE EXCEPTION 'Prerequisite missing: public.vyron_user_company_ids(). Run 030-multi-tenant-security.sql before 052-batch2-security-hardening-baseline.sql.';
  END IF;

  IF to_regprocedure('public.vyron_is_platform_operator()') IS NULL THEN
    RAISE EXCEPTION 'Prerequisite missing: public.vyron_is_platform_operator(). Run 030-multi-tenant-security.sql before 052-batch2-security-hardening-baseline.sql.';
  END IF;
END $$;

DO $tables$
DECLARE
  tbl text;
  pol record;
  tracked_tables text[] := ARRAY[
    'hr_cases',
    'hr_warnings',
    'hearing_cases',
    'hearing_participants',
    'hearing_evidence',
    'discipline_progressions',
    'employee_relations_timeline_events',
    'employee_notes',
    'employee_note_attachments',
    'employee_documents',
    'hr_documents',
    'employee_document_versions',
    'employee_document_audit_history',
    'employee_document_classifications',
    'contract_templates',
    'contract_template_versions',
    'contract_merge_jobs',
    'employee_generated_documents',
    'digital_signatures',
    'document_signing_links',
    'contract_signing_events',
    'hr_packet_exports',
    'er_recommendations',
    'ai_document_generations'
  ];
BEGIN
  FOREACH tbl IN ARRAY tracked_tables LOOP
    IF to_regclass(format('public.%I', tbl)) IS NULL THEN
      CONTINUE;
    END IF;

    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', tbl);

    FOR pol IN
      SELECT p.policyname
      FROM pg_policies p
      WHERE p.schemaname = 'public'
        AND p.tablename = tbl
        AND (
          p.policyname ILIKE 'DEV allow all%%'
          OR right(lower(p.policyname), 4) = '_all'
          OR p.policyname ILIKE '%tenant_isolation%'
        )
    LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', pol.policyname, tbl);
    END LOOP;

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

    IF tbl IN ('employee_relations_timeline_events', 'employee_document_audit_history', 'contract_signing_events', 'er_recommendations', 'ai_document_generations') THEN
      EXECUTE format('GRANT SELECT, INSERT ON public.%I TO authenticated', tbl);
    ELSE
      EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO authenticated', tbl);
    END IF;
  END LOOP;
END
$tables$;

-- ai_prompt_registry has optional company_id for global prompt templates.
-- Restrict global (company_id IS NULL) rows to platform operators only.
DO $prompt_registry$
BEGIN
  IF to_regclass('public.ai_prompt_registry') IS NULL THEN
    RETURN;
  END IF;

  ALTER TABLE public.ai_prompt_registry ENABLE ROW LEVEL SECURITY;

  DROP POLICY IF EXISTS ai_prompt_registry_tenant_isolation ON public.ai_prompt_registry;
  DROP POLICY IF EXISTS ai_prompt_registry_secure_access ON public.ai_prompt_registry;

  CREATE POLICY ai_prompt_registry_secure_access ON public.ai_prompt_registry
  FOR ALL TO authenticated
  USING (
    public.vyron_is_platform_operator()
    OR (
      company_id IS NOT NULL
      AND EXISTS (
        SELECT 1
        FROM public.vyron_user_company_ids() AS c(company_id)
        WHERE c.company_id::text = public.ai_prompt_registry.company_id::text
      )
    )
  )
  WITH CHECK (
    public.vyron_is_platform_operator()
    OR (
      company_id IS NOT NULL
      AND EXISTS (
        SELECT 1
        FROM public.vyron_user_company_ids() AS c(company_id)
        WHERE c.company_id::text = public.ai_prompt_registry.company_id::text
      )
    )
  );

  REVOKE ALL ON public.ai_prompt_registry FROM anon;
  GRANT SELECT, INSERT, UPDATE, DELETE ON public.ai_prompt_registry TO authenticated;
END
$prompt_registry$;

-- Storage hardening for contract/doc/signature/evidence/AI-note buckets.
DO $storage_hardening$
DECLARE
  optional_access_clauses text := '';
  select_using text;
  update_using text;
  delete_using text;
BEGIN
  UPDATE storage.buckets
  SET public = false
  WHERE id IN (
    'employee-documents',
    'hr-contract-templates',
    'hr-signed-documents',
    'hr-signatures',
    'hearing-evidence',
    'ai-generated-documents',
    'employee-note-attachments'
  );

  DROP POLICY IF EXISTS "DEV allow all storage objects" ON storage.objects;
  DROP POLICY IF EXISTS storage_company_objects_select ON storage.objects;
  DROP POLICY IF EXISTS storage_company_objects_insert ON storage.objects;
  DROP POLICY IF EXISTS storage_company_objects_update ON storage.objects;
  DROP POLICY IF EXISTS storage_company_objects_delete ON storage.objects;

  IF to_regclass('public.contract_templates') IS NOT NULL THEN
    optional_access_clauses := optional_access_clauses || '
      OR (
        bucket_id = ''hr-contract-templates''
        AND EXISTS (
          SELECT 1
          FROM public.contract_templates t
          WHERE t.file_bucket = storage.objects.bucket_id
            AND t.file_path = storage.objects.name
            AND EXISTS (
              SELECT 1
              FROM public.vyron_user_company_ids() AS c(company_id)
              WHERE c.company_id::text = t.company_id::text
            )
        )
      )';
  END IF;

  IF to_regclass('public.employee_generated_documents') IS NOT NULL THEN
    optional_access_clauses := optional_access_clauses || '
      OR (
        bucket_id = ''hr-signed-documents''
        AND EXISTS (
          SELECT 1
          FROM public.employee_generated_documents d
          WHERE d.file_bucket = storage.objects.bucket_id
            AND d.file_path = storage.objects.name
            AND EXISTS (
              SELECT 1
              FROM public.vyron_user_company_ids() AS c(company_id)
              WHERE c.company_id::text = d.company_id::text
            )
        )
      )';
  END IF;

  IF to_regclass('public.digital_signatures') IS NOT NULL THEN
    optional_access_clauses := optional_access_clauses || '
      OR (
        bucket_id = ''hr-signatures''
        AND EXISTS (
          SELECT 1
          FROM public.digital_signatures s
          WHERE s.signature_bucket = storage.objects.bucket_id
            AND s.signature_path = storage.objects.name
            AND EXISTS (
              SELECT 1
              FROM public.vyron_user_company_ids() AS c(company_id)
              WHERE c.company_id::text = s.company_id::text
            )
        )
      )';
  END IF;

  IF to_regclass('public.employee_note_attachments') IS NOT NULL THEN
    optional_access_clauses := optional_access_clauses || '
      OR (
        bucket_id = ''employee-note-attachments''
        AND EXISTS (
          SELECT 1
          FROM public.employee_note_attachments n
          WHERE n.file_bucket = storage.objects.bucket_id
            AND n.file_path = storage.objects.name
            AND EXISTS (
              SELECT 1
              FROM public.vyron_user_company_ids() AS c(company_id)
              WHERE c.company_id::text = n.company_id::text
            )
        )
      )';
  END IF;

  IF to_regclass('public.hearing_evidence') IS NOT NULL THEN
    optional_access_clauses := optional_access_clauses || '
      OR (
        bucket_id = ''hearing-evidence''
        AND EXISTS (
          SELECT 1
          FROM public.hearing_evidence h
          WHERE h.file_bucket = storage.objects.bucket_id
            AND h.file_path = storage.objects.name
            AND EXISTS (
              SELECT 1
              FROM public.vyron_user_company_ids() AS c(company_id)
              WHERE c.company_id::text = h.company_id::text
            )
        )
      )';
  END IF;

  select_using := '
    bucket_id IN (
      ''employee-documents'',
      ''hr-contract-templates'',
      ''hr-signed-documents'',
      ''hr-signatures'',
      ''hearing-evidence'',
      ''ai-generated-documents'',
      ''employee-note-attachments''
    )
    AND (
      public.vyron_is_platform_operator()
      OR EXISTS (
        SELECT 1
        FROM public.vyron_user_company_ids() AS c(company_id)
        WHERE c.company_id::text = split_part(storage.objects.name, ''/'', 1)
      )' || optional_access_clauses || '
    )';

  update_using := select_using;
  delete_using := select_using;

  EXECUTE 'CREATE POLICY storage_company_objects_select ON storage.objects FOR SELECT TO authenticated USING (' || select_using || ')';

  CREATE POLICY storage_company_objects_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id IN (
      'employee-documents',
      'hr-contract-templates',
      'hr-signed-documents',
      'hr-signatures',
      'hearing-evidence',
      'ai-generated-documents',
      'employee-note-attachments'
    )
    AND (
      public.vyron_is_platform_operator()
      OR EXISTS (
        SELECT 1
        FROM public.vyron_user_company_ids() AS c(company_id)
        WHERE c.company_id::text = split_part(storage.objects.name, '/', 1)
      )
    )
  );

  EXECUTE format(
    $policy$
    CREATE POLICY storage_company_objects_update ON storage.objects
    FOR UPDATE TO authenticated
    USING (%s)
    WITH CHECK (
      bucket_id IN (
        'employee-documents',
        'hr-contract-templates',
        'hr-signed-documents',
        'hr-signatures',
        'hearing-evidence',
        'ai-generated-documents',
        'employee-note-attachments'
      )
      AND (
        public.vyron_is_platform_operator()
        OR EXISTS (
          SELECT 1
          FROM public.vyron_user_company_ids() AS c(company_id)
          WHERE c.company_id::text = split_part(storage.objects.name, '/', 1)
        )
      )
    )
    $policy$,
    update_using
  );

  EXECUTE 'CREATE POLICY storage_company_objects_delete ON storage.objects FOR DELETE TO authenticated USING (' || delete_using || ')';

  REVOKE ALL ON storage.objects FROM anon;
  GRANT SELECT, INSERT, UPDATE, DELETE ON storage.objects TO authenticated;
END
$storage_hardening$;

COMMIT;

NOTIFY pgrst, 'reload schema';

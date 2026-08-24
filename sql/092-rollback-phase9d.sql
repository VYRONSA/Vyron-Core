-- 092-rollback-phase9d.sql
-- Reverses sql/092-phase9d-storage-isolation-and-least-privilege.sql exactly.
--
-- ###########################################################################
-- # WARNING: this REOPENS the storage cross-tenant read proved in Phase 9C  #
-- # (any authenticated user sees every tenant's objects in 4 buckets), and  #
-- # returns TRUNCATE + DELETE on all 53 relations to authenticated.         #
-- # TRUNCATE is not subject to RLS. Use only to recover from a regression.  #
-- ###########################################################################
--
-- It does NOT touch sql/090 or sql/091.

BEGIN;

-- SECTION 3 (reverse)
GRANT EXECUTE ON FUNCTION public.vyron_provision_company(text, text) TO authenticated;

-- SECTION 2 (reverse)
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT TRUNCATE, DELETE ON TABLES TO authenticated;
GRANT TRUNCATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;

-- SECTION 1 (reverse) — restore the 8 original bucket-scoped policies verbatim
DROP POLICY IF EXISTS "storage_company_objects_select" ON storage.objects;
DROP POLICY IF EXISTS "storage_company_objects_insert" ON storage.objects;
DROP POLICY IF EXISTS "storage_company_objects_update" ON storage.objects;
DROP POLICY IF EXISTS "storage_clock_objects_select"   ON storage.objects;
DROP POLICY IF EXISTS "storage_clock_objects_insert"   ON storage.objects;

CREATE POLICY "Allow authenticated clocking photo reads" ON storage.objects
  FOR SELECT TO authenticated USING (bucket_id = 'clocking-photos'::text);
CREATE POLICY "Allow authenticated clocking photo uploads" ON storage.objects
  FOR INSERT TO authenticated WITH CHECK (bucket_id = 'clocking-photos'::text);
CREATE POLICY "Allow authenticated contract template reads" ON storage.objects
  FOR SELECT TO authenticated USING (bucket_id = 'hr-contract-templates'::text);
CREATE POLICY "Allow authenticated contract template uploads" ON storage.objects
  FOR INSERT TO authenticated WITH CHECK (bucket_id = 'hr-contract-templates'::text);
CREATE POLICY "Allow authenticated signature reads" ON storage.objects
  FOR SELECT TO authenticated USING (bucket_id = 'hr-signatures'::text);
CREATE POLICY "Allow authenticated signature uploads" ON storage.objects
  FOR INSERT TO authenticated WITH CHECK (bucket_id = 'hr-signatures'::text);
CREATE POLICY "Allow authenticated signed document reads" ON storage.objects
  FOR SELECT TO authenticated USING (bucket_id = 'hr-signed-documents'::text);
CREATE POLICY "Allow authenticated signed document uploads" ON storage.objects
  FOR INSERT TO authenticated WITH CHECK (bucket_id = 'hr-signed-documents'::text);

COMMIT;

NOTIFY pgrst, 'reload schema';

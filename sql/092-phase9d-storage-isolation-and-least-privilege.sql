-- 092-phase9d-storage-isolation-and-least-privilege.sql
-- VYRON CORE — PHASE 9D: storage tenant isolation + authenticated least privilege
--
-- Target project : gpiqkwebizuqajgaoxhm (vyron-core, eu-west-1)
-- Backup         : audit/backups/20260823T120716Z-pre-9d/
-- Follows        : sql/090 (anon lockdown), sql/091 (tenant linkage + access restoration)
--                  Neither may be rolled back.
--
-- SCOPE — this file does NOT:
--   * change anon (stays at 0 table and 0 function privileges)
--   * change service_role (stays at 371 table and 23 function privileges)
--   * change authenticated SELECT / INSERT / UPDATE anywhere
--   * change REFERENCES or TRIGGER (unjustified but out of the approved target — see §3)
--   * create, drop, rename or alter any table, column, constraint, index, trigger or view
--   * modify any business row, or delete/move/alter any storage object
--   * use USING (true) anywhere
--
-- ===========================================================================
-- OBJECT-PATH CONVENTION — TRACED, NOT ASSUMED
-- ===========================================================================
-- The application does NOT use one convention. Traced from the upload call sites:
--
--   app/api/contracts/templates/route.ts:62      `${companyId}/templates/...`     -> company
--   app/api/contracts/templates/[id]/versions:86 `${companyId}/templates/...`     -> company
--   app/api/render-contract/route.ts:151         `${companyId}/${employeeId}/...` -> company
--   app/sign-contract/token/page.tsx:343         `${companyScope}/${employeeId}/` -> company
--   lib/employee-document-centre.ts:71           `${companyId}/${employeeId}/...` -> company
--   lib/hr-pdf-service.ts:413                    `${companyId}/${employeeId}/...` -> company
--   app/api/road-recovery/.../evidence/route.ts:84 asserts
--                                    storagePath.startsWith(`${companyId}/`)      -> company
--
--   app/(app)/clock/page.tsx:522                 `${employeeId}/${date}/...`      -> EMPLOYEE
--   app/_app-shell.tsx:9029                      same clock-event-photos path     -> EMPLOYEE
--
-- So segment 1 is company_id for the HR/contract/signature/evidence buckets, and
-- employee_id for the clock-photo buckets. Both are handled below. Note that the R&R
-- evidence route already enforces the company-prefix rule in application code, so the
-- policy here matches the convention R&R will rely on.
--
-- CURRENT PRODUCTION OBJECTS (41): every object except the 13 in hr-contract-templates
-- is prefixed 6dcc4820-e97b-5e90-9ebe-b68145e00449, which matches NO company, employee,
-- auth user or company_user, and no row in employee_documents / hr_documents /
-- digital_signatures / clock_events references any of them (all those tables are empty).
-- They are orphans of a deleted tenant. After this migration they are reachable only by
-- the platform operator and service_role. No live application path loses access.
--
-- DELETE is granted on NO bucket. The only .remove() call sites
-- (components/ContractCentrePanel.tsx:222, components/HRDocumentsEnginePanel.tsx:81)
-- target the bucket "employee-documents", which does not exist in this project.
--
-- ROLLBACK: sql/092-rollback-phase9d.sql

BEGIN;

-- ===========================================================================
-- SECTION 1 — STORAGE TENANT ISOLATION
-- ===========================================================================
-- Replaces the 8 bucket-scoped policies. Those granted every authenticated user in every
-- tenant read access to every object in 4 buckets (proved in Phase 9C: Bravo saw 27
-- objects belonging to another tenant).

DROP POLICY IF EXISTS "Allow authenticated clocking photo reads"      ON storage.objects;
DROP POLICY IF EXISTS "Allow authenticated clocking photo uploads"    ON storage.objects;
DROP POLICY IF EXISTS "Allow authenticated contract template reads"   ON storage.objects;
DROP POLICY IF EXISTS "Allow authenticated contract template uploads" ON storage.objects;
DROP POLICY IF EXISTS "Allow authenticated signature reads"           ON storage.objects;
DROP POLICY IF EXISTS "Allow authenticated signature uploads"         ON storage.objects;
DROP POLICY IF EXISTS "Allow authenticated signed document reads"     ON storage.objects;
DROP POLICY IF EXISTS "Allow authenticated signed document uploads"   ON storage.objects;

-- --- Group A: company-prefixed buckets -------------------------------------
-- SELECT: read own company's objects.
CREATE POLICY "storage_company_objects_select" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = ANY (ARRAY['hr-contract-templates','hr-signatures','hr-signed-documents','hr-documents'])
    AND (
      public.vyron_is_platform_operator()
      OR (storage.foldername(name))[1] IN (
        SELECT c::text FROM public.vyron_user_company_ids() AS c
      )
    )
  );

-- INSERT: upload only into own company's path.
CREATE POLICY "storage_company_objects_insert" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = ANY (ARRAY['hr-contract-templates','hr-signatures','hr-signed-documents','hr-documents'])
    AND (
      public.vyron_is_platform_operator()
      OR (storage.foldername(name))[1] IN (
        SELECT c::text FROM public.vyron_user_company_ids() AS c
      )
    )
  );

-- UPDATE: required because two upload paths use upsert:true —
--   app/sign-contract/token/page.tsx:347 (hr-signatures)
--   app/api/render-contract/route.ts:154 (hr-signed-documents)
-- Both USING and WITH CHECK are scoped, so a row cannot be moved out of the tenant.
CREATE POLICY "storage_company_objects_update" ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = ANY (ARRAY['hr-contract-templates','hr-signatures','hr-signed-documents','hr-documents'])
    AND (
      public.vyron_is_platform_operator()
      OR (storage.foldername(name))[1] IN (
        SELECT c::text FROM public.vyron_user_company_ids() AS c
      )
    )
  )
  WITH CHECK (
    bucket_id = ANY (ARRAY['hr-contract-templates','hr-signatures','hr-signed-documents','hr-documents'])
    AND (
      public.vyron_is_platform_operator()
      OR (storage.foldername(name))[1] IN (
        SELECT c::text FROM public.vyron_user_company_ids() AS c
      )
    )
  );

-- --- Group B: employee-prefixed clock-photo buckets ------------------------
-- Segment 1 is an employee id; the employee is resolved to a company. The employees
-- table already carries employees_tenant_isolation, so that subquery is itself scoped.
CREATE POLICY "storage_clock_objects_select" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = ANY (ARRAY['clock-event-photos','clock-photos','clocking-photos'])
    AND (
      public.vyron_is_platform_operator()
      OR (storage.foldername(name))[1] IN (
        SELECT e.id::text FROM public.employees e
        WHERE e.company_id IN (SELECT public.vyron_user_company_ids())
      )
    )
  );

CREATE POLICY "storage_clock_objects_insert" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = ANY (ARRAY['clock-event-photos','clock-photos','clocking-photos'])
    AND (
      public.vyron_is_platform_operator()
      OR (storage.foldername(name))[1] IN (
        SELECT e.id::text FROM public.employees e
        WHERE e.company_id IN (SELECT public.vyron_user_company_ids())
      )
    )
  );

-- No DELETE policy on either group, and no UPDATE on Group B: the application performs
-- neither against any bucket that exists in this project.

-- ===========================================================================
-- SECTION 2 — AUTHENTICATED LEAST PRIVILEGE
-- ===========================================================================
-- Derived from 1,130 call-sites across 781 repository source files.
--   TRUNCATE : required by 0 relations. TRUNCATE is NOT subject to row level security,
--              so holding it defeats every tenant policy in this database. Revoked on all.
--   DELETE   : required by 3 relations only — employees, employee_documents, field_jobs
--              (components/*, lib/* issue .delete() against exactly these). Revoked on
--              the other 50 and re-granted on those 3.
-- SELECT, INSERT and UPDATE are deliberately left untouched.

REVOKE TRUNCATE ON ALL TABLES IN SCHEMA public FROM authenticated;
REVOKE DELETE   ON ALL TABLES IN SCHEMA public FROM authenticated;

GRANT DELETE ON public.employees          TO authenticated;
GRANT DELETE ON public.employee_documents TO authenticated;
GRANT DELETE ON public.field_jobs         TO authenticated;

-- Stop new tables from re-granting TRUNCATE/DELETE to authenticated by default.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE TRUNCATE, DELETE ON TABLES FROM authenticated;

-- ===========================================================================
-- SECTION 3 — vyron_provision_company()
-- ===========================================================================
-- SECURITY DEFINER, OWNER postgres, no authorization check in the body: any caller who
-- can execute it inserts into public.companies. anon lost EXECUTE in sql/090; this
-- removes it from authenticated too. The body is NOT modified and SECURITY DEFINER is
-- NOT removed. service_role retains EXECUTE, so the server-side provisioning path and
-- the Platform Console continue to work.

REVOKE EXECUTE ON FUNCTION public.vyron_provision_company(text, text) FROM authenticated;

-- ===========================================================================
-- SECTION 4 — supabase_admin DEFAULT PRIVILEGES: NOT EXECUTABLE HERE
-- ===========================================================================
-- Intended statements (deliberately NOT included — they would abort this transaction):
--
--   ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public
--     REVOKE ALL ON TABLES    FROM anon;
--   ... ON FUNCTIONS ... ; ... ON SEQUENCES ... ;
--
-- Verified against production: current_user is `postgres`, which is NOT a superuser and
-- NOT a member of supabase_admin. A rolled-back trial returned:
--
--   ERROR: 42501: permission denied to change default privileges
--
-- Only supabase_admin or a superuser can change them, and neither is reachable from any
-- connection this project exposes. This must be raised with Supabase support.
--
-- Residual risk is bounded: the exposure only materialises for objects CREATED BY
-- supabase_admin in schema public. Migrations run as postgres, whose defaults were
-- already cleaned in sql/090, so anything this project deploys is unaffected. Tables
-- created through the Dashboard UI may be owned by supabase_admin and would inherit
-- anon access — after any such creation, re-run the sql/090 Section 2 revoke.

COMMIT;

NOTIFY pgrst, 'reload schema';

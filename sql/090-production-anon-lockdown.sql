-- 090-production-anon-lockdown.sql
-- VYRON CORE - PRODUCTION ANONYMOUS ACCESS LOCKDOWN (Phase 9A)
--
-- Target project : gpiqkwebizuqajgaoxhm (vyron-core, eu-west-1)
-- Derived from   : audit/schema-snapshots/20260823T094739Z/
--                  01-schema-public.sql, 03-schema-auth-storage.sql,
--                  04-data-storage-migrations.sql
--
-- WHY THIS FILE EXISTS
--   sql/037-revoke-dev-allow-all-policies.sql does not work against this database.
--   It drops policies matching ILIKE 'DEV allow all%' or %_all on 17 core tables.
--   Evaluated against all 135 production policy names, it matches ZERO of the 104
--   permissive policies that actually exist. This file names every policy explicitly.
--
-- SCOPE
--   Removes anonymous (anon) access only. It does NOT:
--     * alter table structures, ownership, or any business row
--     * change authenticated grants or the 22 authenticated tenant policies
--     * change service_role grants
--     * touch the 9 retained conditional tenant policies (auth.uid()-keyed)
--     * create, drop, rename, or repair any table
--     * delete, move, or alter any storage object
--
-- RETAINED DELIBERATELY
--   GRANT USAGE ON SCHEMA public TO anon  -- Supabase baseline. Harmless once no
--                                         -- relation privilege remains; removing it
--                                         -- degrades PostgREST error handling.
--
-- ROLLBACK
--   Every statement below is reversible from the snapshot: replay the matching
--   CREATE POLICY / GRANT statements from 01-schema-public.sql and
--   03-schema-auth-storage.sql, and reset storage.buckets.public for hr-documents.

BEGIN;

-- ===========================================================================
-- SECTION 1 - REMOVE THE 104 ANON-REACHABLE UNCONDITIONAL POLICIES
-- ===========================================================================
-- Selection rule applied to the snapshot (auditable, not pattern-guessed):
--   role target is PUBLIC (no TO clause) or explicitly anon
--   AND the policy is PERMISSIVE
--   AND its USING or WITH CHECK expression is literally (true)
-- Every other policy is left untouched.

-- audit_logs (1)
DROP POLICY IF EXISTS "dev audit logs all" ON public.audit_logs;  -- ALL / PUBLIC

-- backup_snapshots (1)
DROP POLICY IF EXISTS "dev backup snapshots all" ON public.backup_snapshots;  -- ALL / PUBLIC

-- client_onboarding_steps (1)
DROP POLICY IF EXISTS "dev onboarding all" ON public.client_onboarding_steps;  -- ALL / PUBLIC

-- clock_events (5)
DROP POLICY IF EXISTS "Demo insert clock events" ON public.clock_events;  -- INSERT / PUBLIC
DROP POLICY IF EXISTS "dev clock events delete" ON public.clock_events;  -- DELETE / PUBLIC
DROP POLICY IF EXISTS "dev clock events insert" ON public.clock_events;  -- INSERT / PUBLIC
DROP POLICY IF EXISTS "dev clock events select" ON public.clock_events;  -- SELECT / PUBLIC
DROP POLICY IF EXISTS "dev clock events update" ON public.clock_events;  -- UPDATE / PUBLIC

-- clock_rules (1)
DROP POLICY IF EXISTS "dev clock rules all" ON public.clock_rules;  -- ALL / PUBLIC

-- companies (3)
DROP POLICY IF EXISTS "Allow all public access for testing companies" ON public.companies;  -- ALL / PUBLIC
DROP POLICY IF EXISTS "Demo insert companies" ON public.companies;  -- INSERT / PUBLIC
DROP POLICY IF EXISTS "Demo select companies" ON public.companies;  -- SELECT / PUBLIC

-- company_settings (1)
DROP POLICY IF EXISTS "dev company settings all" ON public.company_settings;  -- ALL / PUBLIC

-- company_users (4)
DROP POLICY IF EXISTS "Allow all public access for testing company_users" ON public.company_users;  -- ALL / PUBLIC
DROP POLICY IF EXISTS "Demo insert company users" ON public.company_users;  -- INSERT / PUBLIC
DROP POLICY IF EXISTS "Demo select company users" ON public.company_users;  -- SELECT / PUBLIC
DROP POLICY IF EXISTS "Demo update company users" ON public.company_users;  -- UPDATE / PUBLIC

-- employee_kiosk_logins (4)
DROP POLICY IF EXISTS "Allow public delete employee kiosk logins" ON public.employee_kiosk_logins;  -- DELETE / PUBLIC
DROP POLICY IF EXISTS "Allow public insert employee kiosk logins" ON public.employee_kiosk_logins;  -- INSERT / PUBLIC
DROP POLICY IF EXISTS "Allow public read employee kiosk logins" ON public.employee_kiosk_logins;  -- SELECT / PUBLIC
DROP POLICY IF EXISTS "Allow public update employee kiosk logins" ON public.employee_kiosk_logins;  -- UPDATE / PUBLIC

-- employee_movements (3)
DROP POLICY IF EXISTS "Allow anon employee movement inserts" ON public.employee_movements;  -- INSERT / anon
DROP POLICY IF EXISTS "Allow anon employee movement reads" ON public.employee_movements;  -- SELECT / anon
DROP POLICY IF EXISTS "Allow anon employee movement updates" ON public.employee_movements;  -- UPDATE / anon

-- employee_notifications (8)
DROP POLICY IF EXISTS "Allow public delete employee notifications" ON public.employee_notifications;  -- DELETE / PUBLIC
DROP POLICY IF EXISTS "Allow public insert employee notifications" ON public.employee_notifications;  -- INSERT / PUBLIC
DROP POLICY IF EXISTS "Allow public read employee notifications" ON public.employee_notifications;  -- SELECT / PUBLIC
DROP POLICY IF EXISTS "Allow public update employee notifications" ON public.employee_notifications;  -- UPDATE / PUBLIC
DROP POLICY IF EXISTS "dev employee notifications delete" ON public.employee_notifications;  -- DELETE / PUBLIC
DROP POLICY IF EXISTS "dev employee notifications insert" ON public.employee_notifications;  -- INSERT / PUBLIC
DROP POLICY IF EXISTS "dev employee notifications select" ON public.employee_notifications;  -- SELECT / PUBLIC
DROP POLICY IF EXISTS "dev employee notifications update" ON public.employee_notifications;  -- UPDATE / PUBLIC

-- employees (6)
DROP POLICY IF EXISTS "Demo insert employees" ON public.employees;  -- INSERT / PUBLIC
DROP POLICY IF EXISTS "Demo read employees" ON public.employees;  -- SELECT / PUBLIC
DROP POLICY IF EXISTS "dev employees delete" ON public.employees;  -- DELETE / PUBLIC
DROP POLICY IF EXISTS "dev employees insert" ON public.employees;  -- INSERT / PUBLIC
DROP POLICY IF EXISTS "dev employees select" ON public.employees;  -- SELECT / PUBLIC
DROP POLICY IF EXISTS "dev employees update" ON public.employees;  -- UPDATE / PUBLIC

-- exception_generation_runs (4)
DROP POLICY IF EXISTS "Allow public delete exception generation runs" ON public.exception_generation_runs;  -- DELETE / PUBLIC
DROP POLICY IF EXISTS "Allow public insert exception generation runs" ON public.exception_generation_runs;  -- INSERT / PUBLIC
DROP POLICY IF EXISTS "Allow public read exception generation runs" ON public.exception_generation_runs;  -- SELECT / PUBLIC
DROP POLICY IF EXISTS "Allow public update exception generation runs" ON public.exception_generation_runs;  -- UPDATE / PUBLIC

-- exceptions (4)
DROP POLICY IF EXISTS "Allow public delete exceptions" ON public.exceptions;  -- DELETE / PUBLIC
DROP POLICY IF EXISTS "Allow public insert exceptions" ON public.exceptions;  -- INSERT / PUBLIC
DROP POLICY IF EXISTS "Allow public read exceptions" ON public.exceptions;  -- SELECT / PUBLIC
DROP POLICY IF EXISTS "Allow public update exceptions" ON public.exceptions;  -- UPDATE / PUBLIC

-- hr_cases (4)
DROP POLICY IF EXISTS "Demo insert hr cases" ON public.hr_cases;  -- INSERT / PUBLIC
DROP POLICY IF EXISTS "Demo read HR cases" ON public.hr_cases;  -- SELECT / PUBLIC
DROP POLICY IF EXISTS "Demo select hr cases" ON public.hr_cases;  -- SELECT / PUBLIC
DROP POLICY IF EXISTS "Demo update hr cases" ON public.hr_cases;  -- UPDATE / PUBLIC

-- hr_documents (4)
DROP POLICY IF EXISTS "Allow public delete hr documents" ON public.hr_documents;  -- DELETE / PUBLIC
DROP POLICY IF EXISTS "Allow public insert hr documents" ON public.hr_documents;  -- INSERT / PUBLIC
DROP POLICY IF EXISTS "Allow public read hr documents" ON public.hr_documents;  -- SELECT / PUBLIC
DROP POLICY IF EXISTS "Allow public update hr documents" ON public.hr_documents;  -- UPDATE / PUBLIC

-- hr_notes (4)
DROP POLICY IF EXISTS "Allow public delete hr notes" ON public.hr_notes;  -- DELETE / PUBLIC
DROP POLICY IF EXISTS "Allow public insert hr notes" ON public.hr_notes;  -- INSERT / PUBLIC
DROP POLICY IF EXISTS "Allow public read hr notes" ON public.hr_notes;  -- SELECT / PUBLIC
DROP POLICY IF EXISTS "Allow public update hr notes" ON public.hr_notes;  -- UPDATE / PUBLIC

-- hr_warnings (4)
DROP POLICY IF EXISTS "Allow public delete hr warnings" ON public.hr_warnings;  -- DELETE / PUBLIC
DROP POLICY IF EXISTS "Allow public insert hr warnings" ON public.hr_warnings;  -- INSERT / PUBLIC
DROP POLICY IF EXISTS "Allow public read hr warnings" ON public.hr_warnings;  -- SELECT / PUBLIC
DROP POLICY IF EXISTS "Allow public update hr warnings" ON public.hr_warnings;  -- UPDATE / PUBLIC

-- integration_connections (1)
DROP POLICY IF EXISTS "dev integration connections all" ON public.integration_connections;  -- ALL / PUBLIC

-- leave_balances (4)
DROP POLICY IF EXISTS "dev leave balances delete" ON public.leave_balances;  -- DELETE / PUBLIC
DROP POLICY IF EXISTS "dev leave balances insert" ON public.leave_balances;  -- INSERT / PUBLIC
DROP POLICY IF EXISTS "dev leave balances select" ON public.leave_balances;  -- SELECT / PUBLIC
DROP POLICY IF EXISTS "dev leave balances update" ON public.leave_balances;  -- UPDATE / PUBLIC

-- leave_decision_audit (4)
DROP POLICY IF EXISTS "dev leave decision audit delete" ON public.leave_decision_audit;  -- DELETE / PUBLIC
DROP POLICY IF EXISTS "dev leave decision audit insert" ON public.leave_decision_audit;  -- INSERT / PUBLIC
DROP POLICY IF EXISTS "dev leave decision audit select" ON public.leave_decision_audit;  -- SELECT / PUBLIC
DROP POLICY IF EXISTS "dev leave decision audit update" ON public.leave_decision_audit;  -- UPDATE / PUBLIC

-- leave_requests (4)
DROP POLICY IF EXISTS "Allow public delete leave requests" ON public.leave_requests;  -- DELETE / PUBLIC
DROP POLICY IF EXISTS "Allow public insert leave requests" ON public.leave_requests;  -- INSERT / PUBLIC
DROP POLICY IF EXISTS "Allow public read leave requests" ON public.leave_requests;  -- SELECT / PUBLIC
DROP POLICY IF EXISTS "Allow public update leave requests" ON public.leave_requests;  -- UPDATE / PUBLIC

-- payroll_clock_checks (4)
DROP POLICY IF EXISTS "Allow public delete payroll clock checks" ON public.payroll_clock_checks;  -- DELETE / PUBLIC
DROP POLICY IF EXISTS "Allow public insert payroll clock checks" ON public.payroll_clock_checks;  -- INSERT / PUBLIC
DROP POLICY IF EXISTS "Allow public read payroll clock checks" ON public.payroll_clock_checks;  -- SELECT / PUBLIC
DROP POLICY IF EXISTS "Allow public update payroll clock checks" ON public.payroll_clock_checks;  -- UPDATE / PUBLIC

-- payroll_export_lines (1)
DROP POLICY IF EXISTS "dev payroll export lines all" ON public.payroll_export_lines;  -- ALL / PUBLIC

-- payroll_export_logs (2)
DROP POLICY IF EXISTS "Demo insert payroll export logs" ON public.payroll_export_logs;  -- INSERT / PUBLIC
DROP POLICY IF EXISTS "Demo select payroll export logs" ON public.payroll_export_logs;  -- SELECT / PUBLIC

-- payroll_exports (1)
DROP POLICY IF EXISTS "dev payroll exports all" ON public.payroll_exports;  -- ALL / PUBLIC

-- payroll_hours (3)
DROP POLICY IF EXISTS "Demo insert payroll hours" ON public.payroll_hours;  -- INSERT / PUBLIC
DROP POLICY IF EXISTS "Demo select payroll hours" ON public.payroll_hours;  -- SELECT / PUBLIC
DROP POLICY IF EXISTS "Demo update payroll hours" ON public.payroll_hours;  -- UPDATE / PUBLIC

-- role_permissions (4)
DROP POLICY IF EXISTS "dev delete role permissions" ON public.role_permissions;  -- DELETE / PUBLIC
DROP POLICY IF EXISTS "dev insert role permissions" ON public.role_permissions;  -- INSERT / PUBLIC
DROP POLICY IF EXISTS "dev read role permissions" ON public.role_permissions;  -- SELECT / PUBLIC
DROP POLICY IF EXISTS "dev update role permissions" ON public.role_permissions;  -- UPDATE / PUBLIC

-- roster_shifts (2)
DROP POLICY IF EXISTS "Demo insert roster shifts" ON public.roster_shifts;  -- INSERT / PUBLIC
DROP POLICY IF EXISTS "Demo read roster shifts" ON public.roster_shifts;  -- SELECT / PUBLIC

-- security_lockdown_log (1)
DROP POLICY IF EXISTS "dev security log all" ON public.security_lockdown_log;  -- ALL / PUBLIC

-- stores (2)
DROP POLICY IF EXISTS "Demo insert stores" ON public.stores;  -- INSERT / PUBLIC
DROP POLICY IF EXISTS "Demo read stores" ON public.stores;  -- SELECT / PUBLIC

-- time_exceptions (3)
DROP POLICY IF EXISTS "Demo insert time exceptions" ON public.time_exceptions;  -- INSERT / PUBLIC
DROP POLICY IF EXISTS "Demo read time exceptions" ON public.time_exceptions;  -- SELECT / PUBLIC
DROP POLICY IF EXISTS "Demo update time exceptions" ON public.time_exceptions;  -- UPDATE / PUBLIC

-- user_profiles (4)
DROP POLICY IF EXISTS "dev delete user profiles" ON public.user_profiles;  -- DELETE / PUBLIC
DROP POLICY IF EXISTS "dev insert user profiles" ON public.user_profiles;  -- INSERT / PUBLIC
DROP POLICY IF EXISTS "dev read user profiles" ON public.user_profiles;  -- SELECT / PUBLIC
DROP POLICY IF EXISTS "dev update user profiles" ON public.user_profiles;  -- UPDATE / PUBLIC

-- user_roles (2)
DROP POLICY IF EXISTS "Demo insert user roles" ON public.user_roles;  -- INSERT / PUBLIC
DROP POLICY IF EXISTS "Demo select user roles" ON public.user_roles;  -- SELECT / PUBLIC

-- ===========================================================================
-- SECTION 2 - REVOKE ALL TABLE/VIEW PRIVILEGES FROM anon (53 relations)
-- ===========================================================================
-- Snapshot state: GRANT ALL (SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES,
-- TRIGGER) to anon on every relation. Enumerated explicitly for audit, then swept to
-- catch anything created after the snapshot was taken.

REVOKE ALL ON TABLE "public"."approved_time_records" FROM anon;
REVOKE ALL ON TABLE "public"."audit_logs" FROM anon;
REVOKE ALL ON TABLE "public"."backup_snapshots" FROM anon;
REVOKE ALL ON TABLE "public"."client_onboarding_steps" FROM anon;
REVOKE ALL ON TABLE "public"."clock_events" FROM anon;
REVOKE ALL ON TABLE "public"."clock_rules" FROM anon;
REVOKE ALL ON TABLE "public"."companies" FROM anon;
REVOKE ALL ON TABLE "public"."company_settings" FROM anon;
REVOKE ALL ON TABLE "public"."company_users" FROM anon;
REVOKE ALL ON TABLE "public"."contract_templates" FROM anon;
REVOKE ALL ON TABLE "public"."digital_signatures" FROM anon;
REVOKE ALL ON TABLE "public"."document_signing_links" FROM anon;
REVOKE ALL ON TABLE "public"."employee_documents" FROM anon;
REVOKE ALL ON TABLE "public"."employee_generated_documents" FROM anon;
REVOKE ALL ON TABLE "public"."employee_kiosk_logins" FROM anon;
REVOKE ALL ON TABLE "public"."employee_movements" FROM anon;
REVOKE ALL ON TABLE "public"."employee_notifications" FROM anon;
REVOKE ALL ON TABLE "public"."employee_status_history" FROM anon;
REVOKE ALL ON TABLE "public"."employee_store_access" FROM anon;
REVOKE ALL ON TABLE "public"."employees" FROM anon;
REVOKE ALL ON TABLE "public"."exception_generation_runs" FROM anon;
REVOKE ALL ON TABLE "public"."exceptions" FROM anon;
REVOKE ALL ON TABLE "public"."field_assets" FROM anon;
REVOKE ALL ON TABLE "public"."field_daily_shifts" FROM anon;
REVOKE ALL ON TABLE "public"."field_job_assignments" FROM anon;
REVOKE ALL ON TABLE "public"."field_job_events" FROM anon;
REVOKE ALL ON TABLE "public"."field_jobs" FROM anon;
REVOKE ALL ON TABLE "public"."field_vehicles" FROM anon;
REVOKE ALL ON TABLE "public"."hr_cases" FROM anon;
REVOKE ALL ON TABLE "public"."hr_documents" FROM anon;
REVOKE ALL ON TABLE "public"."hr_notes" FROM anon;
REVOKE ALL ON TABLE "public"."hr_warnings" FROM anon;
REVOKE ALL ON TABLE "public"."integration_connections" FROM anon;
REVOKE ALL ON TABLE "public"."leave_balances" FROM anon;
REVOKE ALL ON TABLE "public"."leave_balances_live" FROM anon;
REVOKE ALL ON TABLE "public"."leave_decision_audit" FROM anon;
REVOKE ALL ON TABLE "public"."leave_requests" FROM anon;
REVOKE ALL ON TABLE "public"."payroll_batches" FROM anon;
REVOKE ALL ON TABLE "public"."payroll_clock_checks" FROM anon;
REVOKE ALL ON TABLE "public"."payroll_export_lines" FROM anon;
REVOKE ALL ON TABLE "public"."payroll_export_logs" FROM anon;
REVOKE ALL ON TABLE "public"."payroll_exports" FROM anon;
REVOKE ALL ON TABLE "public"."payroll_hours" FROM anon;
REVOKE ALL ON TABLE "public"."role_permissions" FROM anon;
REVOKE ALL ON TABLE "public"."roster_generation_runs" FROM anon;
REVOKE ALL ON TABLE "public"."roster_shifts" FROM anon;
REVOKE ALL ON TABLE "public"."security_lockdown_log" FROM anon;
REVOKE ALL ON TABLE "public"."stores" FROM anon;
REVOKE ALL ON TABLE "public"."time_exceptions" FROM anon;
REVOKE ALL ON TABLE "public"."user_profiles" FROM anon;
REVOKE ALL ON TABLE "public"."user_roles" FROM anon;
REVOKE ALL ON TABLE "public"."vyron_audit_log" FROM anon;
REVOKE ALL ON TABLE "public"."vyron_user_sessions" FROM anon;

REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon;  -- safety net

-- ===========================================================================
-- SECTION 3 - REVOKE FUNCTION EXECUTE FROM anon (23 functions)
-- ===========================================================================
-- Critical: vyron_provision_company is SECURITY DEFINER, OWNER postgres, and contains
-- no authorization check - anon could insert rows into public.companies through it.
-- Function bodies are NOT modified and SECURITY DEFINER is NOT changed here.

REVOKE ALL ON FUNCTION "public"."calculate_leave_days"("p_start_date" "date", "p_end_date" "date") FROM anon;
REVOKE ALL ON FUNCTION "public"."create_backup_snapshot"("p_snapshot_name" "text") FROM anon;
REVOKE ALL ON FUNCTION "public"."create_hr_warning_notification"() FROM anon;
REVOKE ALL ON FUNCTION "public"."create_leave_status_notification"() FROM anon;
REVOKE ALL ON FUNCTION "public"."current_user_email"() FROM anon;
REVOKE ALL ON FUNCTION "public"."current_user_role"() FROM anon;
REVOKE ALL ON FUNCTION "public"."generate_exceptions_from_payroll_clock_checks"("p_shift_date" "date") FROM anon;
REVOKE ALL ON FUNCTION "public"."get_default_company_id"() FROM anon;
REVOKE ALL ON FUNCTION "public"."has_role"("required_roles" "text"[]) FROM anon;
REVOKE ALL ON FUNCTION "public"."leave_completed_months"("p_cycle_start" "date", "p_cycle_end" "date", "p_as_of" "date") FROM anon;
REVOKE ALL ON FUNCTION "public"."normalise_leave_type"("p_leave_type" "text") FROM anon;
REVOKE ALL ON FUNCTION "public"."recalculate_leave_balance_for_employee"("p_employee_id" "text", "p_leave_type" "text", "p_cycle_start" "date", "p_cycle_end" "date") FROM anon;
REVOKE ALL ON FUNCTION "public"."record_leave_decision_audit"() FROM anon;
REVOKE ALL ON FUNCTION "public"."run_smart_detection_engine"("p_from_date" "date", "p_to_date" "date") FROM anon;
REVOKE ALL ON FUNCTION "public"."safe_employee_match"("a" "uuid", "b" "text") FROM anon;
REVOKE ALL ON FUNCTION "public"."set_company_id_on_clock_event"() FROM anon;
REVOKE ALL ON FUNCTION "public"."set_company_user_user_id"() FROM anon;
REVOKE ALL ON FUNCTION "public"."sync_leave_request_to_balance"() FROM anon;
REVOKE ALL ON FUNCTION "public"."upsert_detection_exception"("p_company_id" "uuid", "p_employee_id" "uuid", "p_store_id" "uuid", "p_exception_type" "text", "p_severity" "text", "p_description" "text", "p_exception_key" "text", "p_created_at" timestamp with time zone) FROM anon;
REVOKE ALL ON FUNCTION "public"."vyron_get_company_access"() FROM anon;
REVOKE ALL ON FUNCTION "public"."vyron_is_platform_operator"() FROM anon;
REVOKE ALL ON FUNCTION "public"."vyron_provision_company"("p_name" "text", "p_subscription_status" "text") FROM anon;
REVOKE ALL ON FUNCTION "public"."vyron_user_company_ids"() FROM anon;

REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM anon;  -- safety net

-- ===========================================================================
-- SECTION 4 - DEFAULT PRIVILEGES (anon only)
-- ===========================================================================
-- Snapshot shows ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
-- GRANT ALL ON {TABLES,FUNCTIONS,SEQUENCES} TO {anon,authenticated,postgres,service_role}.
-- Only the anon defaults are revoked; authenticated / postgres / service_role defaults
-- are deliberately left in place.

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON TABLES FROM anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon;

-- ===========================================================================
-- SECTION 5 - STORAGE: CLOSE PUBLIC HR-DOCUMENT EXPOSURE
-- ===========================================================================
-- Snapshot evidence:
--   storage.buckets : hr-documents has public = true
--   storage.objects : 4 public policies (read/upload/update/delete hr documents files)
--   hr-documents contains ZERO objects. All 41 stored objects live in
--   hr-contract-templates(13), clock-photos(10), hr-signatures(8),
--   hr-signed-documents(5), clock-event-photos(4), clocking-photos(1).
--   No application code calls getPublicUrl on hr-documents.
-- Flipping public = false therefore cannot break a functioning workflow.
-- The 8 authenticated storage policies are left untouched.
-- No storage object is deleted, moved, or altered.

DROP POLICY IF EXISTS "Allow public read hr documents files" ON storage.objects;
DROP POLICY IF EXISTS "Allow public upload hr documents files" ON storage.objects;
DROP POLICY IF EXISTS "Allow public update hr documents files" ON storage.objects;
DROP POLICY IF EXISTS "Allow public delete hr documents files" ON storage.objects;

-- Bucket visibility. This is the ONLY row this migration writes, and it is
-- configuration, not business data.
UPDATE storage.buckets SET public = false WHERE id = 'hr-documents' AND public IS DISTINCT FROM false;

COMMIT;

-- Reload the PostgREST schema cache so the new privilege state takes effect immediately.
NOTIFY pgrst, 'reload schema';

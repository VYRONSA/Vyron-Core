-- 090-rollback-production-anon-lockdown.sql
-- VYRON CORE - ROLLBACK for sql/090-production-anon-lockdown.sql
--
-- Restores the exact pre-lockdown security state recorded in
-- audit/schema-snapshots/20260823T094739Z/.
--
-- ###########################################################################
-- # WARNING: running this file REOPENS the anonymous exposure it undid.     #
-- # anon regains full CRUD on companies, company_users, employees and more. #
-- # Use only to recover from an unexpected regression, never routinely.     #
-- ###########################################################################
--
-- Restores: 104 public policies, 4 storage policies,
--           53 table grants, 23 function grants, 3 default-privilege grants,
--           and storage.buckets.public = true for hr-documents.

BEGIN;

-- SECTION 1 - restore the 104 policies removed by the lockdown
CREATE POLICY "Allow all public access for testing companies" ON "public"."companies" USING (true) WITH CHECK (true);
CREATE POLICY "Allow all public access for testing company_users" ON "public"."company_users" USING (true) WITH CHECK (true);
CREATE POLICY "Allow anon employee movement inserts" ON "public"."employee_movements" FOR INSERT TO "anon" WITH CHECK (true);
CREATE POLICY "Allow anon employee movement reads" ON "public"."employee_movements" FOR SELECT TO "anon" USING (true);
CREATE POLICY "Allow anon employee movement updates" ON "public"."employee_movements" FOR UPDATE TO "anon" USING (true) WITH CHECK (true);
CREATE POLICY "Allow public delete employee kiosk logins" ON "public"."employee_kiosk_logins" FOR DELETE USING (true);
CREATE POLICY "Allow public delete employee notifications" ON "public"."employee_notifications" FOR DELETE USING (true);
CREATE POLICY "Allow public delete exception generation runs" ON "public"."exception_generation_runs" FOR DELETE USING (true);
CREATE POLICY "Allow public delete exceptions" ON "public"."exceptions" FOR DELETE USING (true);
CREATE POLICY "Allow public delete hr documents" ON "public"."hr_documents" FOR DELETE USING (true);
CREATE POLICY "Allow public delete hr notes" ON "public"."hr_notes" FOR DELETE USING (true);
CREATE POLICY "Allow public delete hr warnings" ON "public"."hr_warnings" FOR DELETE USING (true);
CREATE POLICY "Allow public delete leave requests" ON "public"."leave_requests" FOR DELETE USING (true);
CREATE POLICY "Allow public delete payroll clock checks" ON "public"."payroll_clock_checks" FOR DELETE USING (true);
CREATE POLICY "Allow public insert employee kiosk logins" ON "public"."employee_kiosk_logins" FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow public insert employee notifications" ON "public"."employee_notifications" FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow public insert exception generation runs" ON "public"."exception_generation_runs" FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow public insert exceptions" ON "public"."exceptions" FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow public insert hr documents" ON "public"."hr_documents" FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow public insert hr notes" ON "public"."hr_notes" FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow public insert hr warnings" ON "public"."hr_warnings" FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow public insert leave requests" ON "public"."leave_requests" FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow public insert payroll clock checks" ON "public"."payroll_clock_checks" FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow public read employee kiosk logins" ON "public"."employee_kiosk_logins" FOR SELECT USING (true);
CREATE POLICY "Allow public read employee notifications" ON "public"."employee_notifications" FOR SELECT USING (true);
CREATE POLICY "Allow public read exception generation runs" ON "public"."exception_generation_runs" FOR SELECT USING (true);
CREATE POLICY "Allow public read exceptions" ON "public"."exceptions" FOR SELECT USING (true);
CREATE POLICY "Allow public read hr documents" ON "public"."hr_documents" FOR SELECT USING (true);
CREATE POLICY "Allow public read hr notes" ON "public"."hr_notes" FOR SELECT USING (true);
CREATE POLICY "Allow public read hr warnings" ON "public"."hr_warnings" FOR SELECT USING (true);
CREATE POLICY "Allow public read leave requests" ON "public"."leave_requests" FOR SELECT USING (true);
CREATE POLICY "Allow public read payroll clock checks" ON "public"."payroll_clock_checks" FOR SELECT USING (true);
CREATE POLICY "Allow public update employee kiosk logins" ON "public"."employee_kiosk_logins" FOR UPDATE USING (true) WITH CHECK (true);
CREATE POLICY "Allow public update employee notifications" ON "public"."employee_notifications" FOR UPDATE USING (true) WITH CHECK (true);
CREATE POLICY "Allow public update exception generation runs" ON "public"."exception_generation_runs" FOR UPDATE USING (true) WITH CHECK (true);
CREATE POLICY "Allow public update exceptions" ON "public"."exceptions" FOR UPDATE USING (true) WITH CHECK (true);
CREATE POLICY "Allow public update hr documents" ON "public"."hr_documents" FOR UPDATE USING (true) WITH CHECK (true);
CREATE POLICY "Allow public update hr notes" ON "public"."hr_notes" FOR UPDATE USING (true) WITH CHECK (true);
CREATE POLICY "Allow public update hr warnings" ON "public"."hr_warnings" FOR UPDATE USING (true) WITH CHECK (true);
CREATE POLICY "Allow public update leave requests" ON "public"."leave_requests" FOR UPDATE USING (true) WITH CHECK (true);
CREATE POLICY "Allow public update payroll clock checks" ON "public"."payroll_clock_checks" FOR UPDATE USING (true) WITH CHECK (true);
CREATE POLICY "Demo insert clock events" ON "public"."clock_events" FOR INSERT WITH CHECK (true);
CREATE POLICY "Demo insert companies" ON "public"."companies" FOR INSERT WITH CHECK (true);
CREATE POLICY "Demo insert company users" ON "public"."company_users" FOR INSERT WITH CHECK (true);
CREATE POLICY "Demo insert employees" ON "public"."employees" FOR INSERT WITH CHECK (true);
CREATE POLICY "Demo insert hr cases" ON "public"."hr_cases" FOR INSERT WITH CHECK (true);
CREATE POLICY "Demo insert payroll export logs" ON "public"."payroll_export_logs" FOR INSERT WITH CHECK (true);
CREATE POLICY "Demo insert payroll hours" ON "public"."payroll_hours" FOR INSERT WITH CHECK (true);
CREATE POLICY "Demo insert roster shifts" ON "public"."roster_shifts" FOR INSERT WITH CHECK (true);
CREATE POLICY "Demo insert stores" ON "public"."stores" FOR INSERT WITH CHECK (true);
CREATE POLICY "Demo insert time exceptions" ON "public"."time_exceptions" FOR INSERT WITH CHECK (true);
CREATE POLICY "Demo insert user roles" ON "public"."user_roles" FOR INSERT WITH CHECK (true);
CREATE POLICY "Demo read HR cases" ON "public"."hr_cases" FOR SELECT USING (true);
CREATE POLICY "Demo read employees" ON "public"."employees" FOR SELECT USING (true);
CREATE POLICY "Demo read roster shifts" ON "public"."roster_shifts" FOR SELECT USING (true);
CREATE POLICY "Demo read stores" ON "public"."stores" FOR SELECT USING (true);
CREATE POLICY "Demo read time exceptions" ON "public"."time_exceptions" FOR SELECT USING (true);
CREATE POLICY "Demo select companies" ON "public"."companies" FOR SELECT USING (true);
CREATE POLICY "Demo select company users" ON "public"."company_users" FOR SELECT USING (true);
CREATE POLICY "Demo select hr cases" ON "public"."hr_cases" FOR SELECT USING (true);
CREATE POLICY "Demo select payroll export logs" ON "public"."payroll_export_logs" FOR SELECT USING (true);
CREATE POLICY "Demo select payroll hours" ON "public"."payroll_hours" FOR SELECT USING (true);
CREATE POLICY "Demo select user roles" ON "public"."user_roles" FOR SELECT USING (true);
CREATE POLICY "Demo update company users" ON "public"."company_users" FOR UPDATE USING (true) WITH CHECK (true);
CREATE POLICY "Demo update hr cases" ON "public"."hr_cases" FOR UPDATE USING (true) WITH CHECK (true);
CREATE POLICY "Demo update payroll hours" ON "public"."payroll_hours" FOR UPDATE USING (true) WITH CHECK (true);
CREATE POLICY "Demo update time exceptions" ON "public"."time_exceptions" FOR UPDATE USING (true) WITH CHECK (true);
CREATE POLICY "dev audit logs all" ON "public"."audit_logs" USING (true) WITH CHECK (true);
CREATE POLICY "dev backup snapshots all" ON "public"."backup_snapshots" USING (true) WITH CHECK (true);
CREATE POLICY "dev clock events delete" ON "public"."clock_events" FOR DELETE USING (true);
CREATE POLICY "dev clock events insert" ON "public"."clock_events" FOR INSERT WITH CHECK (true);
CREATE POLICY "dev clock events select" ON "public"."clock_events" FOR SELECT USING (true);
CREATE POLICY "dev clock events update" ON "public"."clock_events" FOR UPDATE USING (true) WITH CHECK (true);
CREATE POLICY "dev clock rules all" ON "public"."clock_rules" USING (true) WITH CHECK (true);
CREATE POLICY "dev company settings all" ON "public"."company_settings" USING (true) WITH CHECK (true);
CREATE POLICY "dev delete role permissions" ON "public"."role_permissions" FOR DELETE USING (true);
CREATE POLICY "dev delete user profiles" ON "public"."user_profiles" FOR DELETE USING (true);
CREATE POLICY "dev employee notifications delete" ON "public"."employee_notifications" FOR DELETE USING (true);
CREATE POLICY "dev employee notifications insert" ON "public"."employee_notifications" FOR INSERT WITH CHECK (true);
CREATE POLICY "dev employee notifications select" ON "public"."employee_notifications" FOR SELECT USING (true);
CREATE POLICY "dev employee notifications update" ON "public"."employee_notifications" FOR UPDATE USING (true) WITH CHECK (true);
CREATE POLICY "dev employees delete" ON "public"."employees" FOR DELETE USING (true);
CREATE POLICY "dev employees insert" ON "public"."employees" FOR INSERT WITH CHECK (true);
CREATE POLICY "dev employees select" ON "public"."employees" FOR SELECT USING (true);
CREATE POLICY "dev employees update" ON "public"."employees" FOR UPDATE USING (true) WITH CHECK (true);
CREATE POLICY "dev insert role permissions" ON "public"."role_permissions" FOR INSERT WITH CHECK (true);
CREATE POLICY "dev insert user profiles" ON "public"."user_profiles" FOR INSERT WITH CHECK (true);
CREATE POLICY "dev integration connections all" ON "public"."integration_connections" USING (true) WITH CHECK (true);
CREATE POLICY "dev leave balances delete" ON "public"."leave_balances" FOR DELETE USING (true);
CREATE POLICY "dev leave balances insert" ON "public"."leave_balances" FOR INSERT WITH CHECK (true);
CREATE POLICY "dev leave balances select" ON "public"."leave_balances" FOR SELECT USING (true);
CREATE POLICY "dev leave balances update" ON "public"."leave_balances" FOR UPDATE USING (true) WITH CHECK (true);
CREATE POLICY "dev leave decision audit delete" ON "public"."leave_decision_audit" FOR DELETE USING (true);
CREATE POLICY "dev leave decision audit insert" ON "public"."leave_decision_audit" FOR INSERT WITH CHECK (true);
CREATE POLICY "dev leave decision audit select" ON "public"."leave_decision_audit" FOR SELECT USING (true);
CREATE POLICY "dev leave decision audit update" ON "public"."leave_decision_audit" FOR UPDATE USING (true) WITH CHECK (true);
CREATE POLICY "dev onboarding all" ON "public"."client_onboarding_steps" USING (true) WITH CHECK (true);
CREATE POLICY "dev payroll export lines all" ON "public"."payroll_export_lines" USING (true) WITH CHECK (true);
CREATE POLICY "dev payroll exports all" ON "public"."payroll_exports" USING (true) WITH CHECK (true);
CREATE POLICY "dev read role permissions" ON "public"."role_permissions" FOR SELECT USING (true);
CREATE POLICY "dev read user profiles" ON "public"."user_profiles" FOR SELECT USING (true);
CREATE POLICY "dev security log all" ON "public"."security_lockdown_log" USING (true) WITH CHECK (true);
CREATE POLICY "dev update role permissions" ON "public"."role_permissions" FOR UPDATE USING (true) WITH CHECK (true);
CREATE POLICY "dev update user profiles" ON "public"."user_profiles" FOR UPDATE USING (true) WITH CHECK (true);

-- SECTION 2 - restore anon table/view grants
GRANT ALL ON TABLE "public"."approved_time_records" TO anon;
GRANT ALL ON TABLE "public"."audit_logs" TO anon;
GRANT ALL ON TABLE "public"."backup_snapshots" TO anon;
GRANT ALL ON TABLE "public"."client_onboarding_steps" TO anon;
GRANT ALL ON TABLE "public"."clock_events" TO anon;
GRANT ALL ON TABLE "public"."clock_rules" TO anon;
GRANT ALL ON TABLE "public"."companies" TO anon;
GRANT ALL ON TABLE "public"."company_settings" TO anon;
GRANT ALL ON TABLE "public"."company_users" TO anon;
GRANT ALL ON TABLE "public"."contract_templates" TO anon;
GRANT ALL ON TABLE "public"."digital_signatures" TO anon;
GRANT ALL ON TABLE "public"."document_signing_links" TO anon;
GRANT ALL ON TABLE "public"."employee_documents" TO anon;
GRANT ALL ON TABLE "public"."employee_generated_documents" TO anon;
GRANT ALL ON TABLE "public"."employee_kiosk_logins" TO anon;
GRANT ALL ON TABLE "public"."employee_movements" TO anon;
GRANT ALL ON TABLE "public"."employee_notifications" TO anon;
GRANT ALL ON TABLE "public"."employee_status_history" TO anon;
GRANT ALL ON TABLE "public"."employee_store_access" TO anon;
GRANT ALL ON TABLE "public"."employees" TO anon;
GRANT ALL ON TABLE "public"."exception_generation_runs" TO anon;
GRANT ALL ON TABLE "public"."exceptions" TO anon;
GRANT ALL ON TABLE "public"."field_assets" TO anon;
GRANT ALL ON TABLE "public"."field_daily_shifts" TO anon;
GRANT ALL ON TABLE "public"."field_job_assignments" TO anon;
GRANT ALL ON TABLE "public"."field_job_events" TO anon;
GRANT ALL ON TABLE "public"."field_jobs" TO anon;
GRANT ALL ON TABLE "public"."field_vehicles" TO anon;
GRANT ALL ON TABLE "public"."hr_cases" TO anon;
GRANT ALL ON TABLE "public"."hr_documents" TO anon;
GRANT ALL ON TABLE "public"."hr_notes" TO anon;
GRANT ALL ON TABLE "public"."hr_warnings" TO anon;
GRANT ALL ON TABLE "public"."integration_connections" TO anon;
GRANT ALL ON TABLE "public"."leave_balances" TO anon;
GRANT ALL ON TABLE "public"."leave_balances_live" TO anon;
GRANT ALL ON TABLE "public"."leave_decision_audit" TO anon;
GRANT ALL ON TABLE "public"."leave_requests" TO anon;
GRANT ALL ON TABLE "public"."payroll_batches" TO anon;
GRANT ALL ON TABLE "public"."payroll_clock_checks" TO anon;
GRANT ALL ON TABLE "public"."payroll_export_lines" TO anon;
GRANT ALL ON TABLE "public"."payroll_export_logs" TO anon;
GRANT ALL ON TABLE "public"."payroll_exports" TO anon;
GRANT ALL ON TABLE "public"."payroll_hours" TO anon;
GRANT ALL ON TABLE "public"."role_permissions" TO anon;
GRANT ALL ON TABLE "public"."roster_generation_runs" TO anon;
GRANT ALL ON TABLE "public"."roster_shifts" TO anon;
GRANT ALL ON TABLE "public"."security_lockdown_log" TO anon;
GRANT ALL ON TABLE "public"."stores" TO anon;
GRANT ALL ON TABLE "public"."time_exceptions" TO anon;
GRANT ALL ON TABLE "public"."user_profiles" TO anon;
GRANT ALL ON TABLE "public"."user_roles" TO anon;
GRANT ALL ON TABLE "public"."vyron_audit_log" TO anon;
GRANT ALL ON TABLE "public"."vyron_user_sessions" TO anon;

-- SECTION 3 - restore anon function grants
GRANT ALL ON FUNCTION "public"."calculate_leave_days"("p_start_date" "date", "p_end_date" "date") TO anon;
GRANT ALL ON FUNCTION "public"."create_backup_snapshot"("p_snapshot_name" "text") TO anon;
GRANT ALL ON FUNCTION "public"."create_hr_warning_notification"() TO anon;
GRANT ALL ON FUNCTION "public"."create_leave_status_notification"() TO anon;
GRANT ALL ON FUNCTION "public"."current_user_email"() TO anon;
GRANT ALL ON FUNCTION "public"."current_user_role"() TO anon;
GRANT ALL ON FUNCTION "public"."generate_exceptions_from_payroll_clock_checks"("p_shift_date" "date") TO anon;
GRANT ALL ON FUNCTION "public"."get_default_company_id"() TO anon;
GRANT ALL ON FUNCTION "public"."has_role"("required_roles" "text"[]) TO anon;
GRANT ALL ON FUNCTION "public"."leave_completed_months"("p_cycle_start" "date", "p_cycle_end" "date", "p_as_of" "date") TO anon;
GRANT ALL ON FUNCTION "public"."normalise_leave_type"("p_leave_type" "text") TO anon;
GRANT ALL ON FUNCTION "public"."recalculate_leave_balance_for_employee"("p_employee_id" "text", "p_leave_type" "text", "p_cycle_start" "date", "p_cycle_end" "date") TO anon;
GRANT ALL ON FUNCTION "public"."record_leave_decision_audit"() TO anon;
GRANT ALL ON FUNCTION "public"."run_smart_detection_engine"("p_from_date" "date", "p_to_date" "date") TO anon;
GRANT ALL ON FUNCTION "public"."safe_employee_match"("a" "uuid", "b" "text") TO anon;
GRANT ALL ON FUNCTION "public"."set_company_id_on_clock_event"() TO anon;
GRANT ALL ON FUNCTION "public"."set_company_user_user_id"() TO anon;
GRANT ALL ON FUNCTION "public"."sync_leave_request_to_balance"() TO anon;
GRANT ALL ON FUNCTION "public"."upsert_detection_exception"("p_company_id" "uuid", "p_employee_id" "uuid", "p_store_id" "uuid", "p_exception_type" "text", "p_severity" "text", "p_description" "text", "p_exception_key" "text", "p_created_at" timestamp with time zone) TO anon;
GRANT ALL ON FUNCTION "public"."vyron_get_company_access"() TO anon;
GRANT ALL ON FUNCTION "public"."vyron_is_platform_operator"() TO anon;
GRANT ALL ON FUNCTION "public"."vyron_provision_company"("p_name" "text", "p_subscription_status" "text") TO anon;
GRANT ALL ON FUNCTION "public"."vyron_user_company_ids"() TO anon;

-- SECTION 4 - restore anon default privileges
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO anon;

-- SECTION 5 - restore storage exposure
CREATE POLICY "Allow public delete hr documents files" ON "storage"."objects" FOR DELETE USING (("bucket_id" = 'hr-documents'::"text"));
CREATE POLICY "Allow public read hr documents files" ON "storage"."objects" FOR SELECT USING (("bucket_id" = 'hr-documents'::"text"));
CREATE POLICY "Allow public update hr documents files" ON "storage"."objects" FOR UPDATE USING (("bucket_id" = 'hr-documents'::"text")) WITH CHECK (("bucket_id" = 'hr-documents'::"text"));
CREATE POLICY "Allow public upload hr documents files" ON "storage"."objects" FOR INSERT WITH CHECK (("bucket_id" = 'hr-documents'::"text"));
UPDATE storage.buckets SET public = true WHERE id = 'hr-documents';

COMMIT;

NOTIFY pgrst, 'reload schema';

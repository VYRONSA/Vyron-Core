# SQL Migration Manifest (Reliability Audit)

Generated for enterprise migration reliability hardening.
Scope: numbered migrations under `sql/` from `000` to `061`.

## Rules used in this audit

- Deployment order is numeric by filename prefix.
- Where duplicates of the same numeric prefix exist, both are listed and sequencing is explicit.
- "Safe to rerun" is based on idempotence patterns (`IF NOT EXISTS`, guarded `ALTER`, `DROP ... IF EXISTS`, conditional DO blocks).
- This audit does **not** change business logic; it focuses on execution safety, dependency clarity, and repeatability.

## Recommended deployment order (clean, empty Supabase)

1. `000-run-all-companies.sql` (or `PASTE_THIS_IN_SUPABASE.sql`) as bootstrap for core company tables + RPC.
2. Continue with numbered migrations in ascending order, **excluding** `001` and `002` if `000` was run in same environment to avoid unnecessary duplicate reapplication.
3. For duplicate number `007`, run in this order:
   1. `007-clear-demo-company-data.sql`
   2. `007-client-profile-columns.sql`
4. Then continue `008` onward.

If your process mandates strict numeric-only execution and cannot skip `001/002`, they are idempotent enough to re-run after `000`, but skipping avoids churn.

## Master manifest

| Migration | Purpose | Depends on | Creates | Alters | Safe to rerun |
|---|---|---|---|---|---|
| 000-run-all-companies.sql | Bootstrap companies + users + RPC + seed + cache reload | none | companies, company_users | companies, company_users | Yes |
| 001-create-companies-tables.sql | Core company tables, indexes, policies | none | companies, company_users | companies, company_users | Yes |
| 002-fix-company-access-rpc.sql | Company access/provision RPC + repair | 001 | (functions only) | companies, company_users | Yes |
| 003-confirm-and-repair-company-access-rpc.sql | RPC confirmation/repair helper | 001/002 | (functions only) | none | Yes |
| 004-provision-rpc-only.sql | Provision RPC only fallback | 001 | (functions only) | none | Yes |
| 005-verify-companies-api.sql | Verification queries | 001/002 | none | none | Yes |
| 006-add-subscription-tier-columns.sql | Company subscription columns | companies | none | companies | Yes |
| 007-clear-demo-company-data.sql | Clears demo rows | companies/company_users | none | none | Yes |
| 007-client-profile-columns.sql | Client profile fields on companies | companies | none | companies | Yes |
| 008-demo-tier-timestamp.sql | Demo timestamp field | companies | none | companies | Yes |
| 009-employee-documents.sql | Employee documents table | companies/employees baseline | employee_documents | employee_documents | Yes |
| 011-vyron-dev-phase3.sql | Dev phase 3 platform tables | companies baseline | vyron_clients + related phase3 tables | phase3 tables | Yes |
| 012-vyron-dev-developer-workspace.sql | Developer workspace layer | 011 | vyron_developer_workspaces | vyron_clients and related | Yes |
| 013-vyron-demo-requests.sql | Demo requests workflow | 012 | vyron_demo_requests | vyron_demo_requests | Yes |
| 014-field-operations.sql | Field ops core (assets/jobs/shifts/events) | 001 (companies) | field_assets, field_vehicles, field_jobs, field_job_assignments, field_daily_shifts, field_job_events | same | Yes |
| 015-company-users-companies-fk.sql | FK hardening for company_users | companies/company_users | none | company_users | Yes |
| 016-platform-workspace-key.sql | Workspace key updates | platform baseline | none | none | Yes |
| 017-field-travel-intelligence.sql | Travel intelligence | 014 | field_routes, field_route_segments | same | Yes |
| 018-field-cost-intelligence.sql | Cost intelligence | 014 + 017 | field_cost_rates, field_job_costs, field_employee_day_costs, field_leakage_events | field_jobs + new cost tables | Yes |
| 019-workforce-risk-intelligence.sql | Risk scoring/event engine | 014 + 017 + 018 | workforce_risk_rules, workforce_risk_scores, workforce_risk_events, workforce_risk_recommendations | same | Yes |
| 020-core-v2-pricing.sql | Core v2 pricing additions | 011 | none | companies | Yes |
| 021-workforce-risk-phase4d-extend.sql | Risk phase extension | 019 | workforce_risk_recommendations (extend) | workforce_risk_scores, workforce_risk_rules, workforce_risk_recommendations | Yes |
| 022-workforce-automation-engine.sql | Automation actions/approvals/audit | risk + field ops stack | workforce_automation_actions, workforce_automation_approvals, workforce_automation_audit_log | same | Yes |
| 023-whatsapp-workforce-command.sql | WhatsApp command center tables | 022 | whatsapp_command_sessions, whatsapp_command_messages, whatsapp_command_actions, whatsapp_command_audit_log | same | Yes |
| 024-workforce-digital-twin.sql | Digital twin snapshots/forecast/sim | field+cost+risk+automation | workforce_digital_twin_snapshots, workforce_health_scores, workforce_forecasts, workforce_simulations, workforce_twin_insights | same | Yes |
| 025-payroll-intelligence.sql | Payroll readiness scores/checks/forecasts | field/cost/risk baseline | payroll_pay_periods, payroll_readiness_scores, payroll_readiness_checks, payroll_leakage_events, payroll_forecasts | same | Yes |
| 026-workforce-lifecycle.sql | Lifecycle status/events/snapshots | employees baseline | employee_lifecycle_status, workforce_lifecycle_events, workforce_lifecycle_snapshots | same | Yes |
| 027-recruitment-intelligence.sql | Recruitment and succession intelligence | employees baseline | skills_registry, employee_skills, recruitment_vacancies, recruitment_applicants, recruitment_interviews, recruitment_scores, succession_candidates, workforce_gap_analysis | same | Yes |
| 028-workforce-operating-system.sql | Operating snapshots/health/insights/templates | workforce intelligence baseline | workforce_operating_snapshots, workforce_operating_health_scores, workforce_operating_insights, workforce_automation_templates, workforce_operating_audit_log | same | Yes |
| 029-v2-production-readiness.sql | Production readiness adjustments | companies/company_users | none | company_users, companies | Yes |
| 030-multi-tenant-security.sql | Security hardening, sessions, audit | companies + core entity tables | vyron_audit_log, vyron_user_sessions | company_users, employees, stores, field_jobs + new security tables | Yes |
| 031-mobile-workforce-platform.sql | Mobile workforce platform | 030 | mobile_workforce_evidence, mobile_gps_validations, mobile_workforce_tasks, mobile_workforce_notifications, mobile_workforce_incidents, mobile_workforce_sync_log | same | Yes |
| 032-vehicle-asset-intelligence.sql | Vehicle/asset intelligence | 031 + field ops tables | field_trailers, field_vehicle_assignments, field_vehicle_events, field_vehicle_costs, field_asset_utilisation, field_vehicle_risk_events | field_vehicles, field_assets, field_jobs + new tables | Yes |
| 033-client-profitability-intelligence.sql | Profitability intelligence | field jobs + companies baseline | client_billing_profiles, job_revenue, job_profitability, client_profitability, technician_profitability, site_profitability, profitability_alerts | field_jobs + new profitability tables | Yes |
| 034-client-portal-platform.sql | Client portal entities | 033 | client_portal_users, client_requests, client_ratings, client_assets, client_documents, client_portal_audit_log | same | Yes |
| 035-v2-demo-environment.sql | Demo data/environment shaping | core company tables | (seed/update logic) | varies | Yes |
| 036-bind-company-user.sql | Company-user binding helper | companies + company_users | none | none | Yes |
| 037-revoke-dev-allow-all-policies.sql | Remove dev-wide permissive RLS | prior dev policy state | none | policies only | Yes |
| 038-hr-warnings-operational-columns.sql | HR warnings operational columns | hr_warnings baseline | none | hr_warnings | Yes |
| 039-leave-balance-employee-seed.sql | Seed/fix leave balances by employee | employees + leave balances baseline | none | none | Yes |
| 041-employee-movements.sql | Employee movements/history | employees + companies | employee_movements, employee_status_history | none | Yes |
| 042-employee-management-profiles.sql | Employee profile and audit | employees + companies | employee_profiles, employee_audit_history | employee_profiles, employee_audit_history | Yes |
| 043-employee-enterprise-enhancements.sql | Employee enterprise extension entities | employees + companies | employee_asset_assignments, employee_probation_records, employee_employment_events, employee_tags, employee_tag_links, employee_custom_fields, employee_custom_field_values, employee_notes | same | Yes |
| 044-clocking-attendance-enterprise.sql | Attendance enterprise extension entities | employees + companies + attendance baseline | attendance_geofences, attendance_corrections, attendance_correction_audit, attendance_review_notes, attendance_device_events, attendance_pin_failures | same | Yes |
| 045-leave-management-excellence.sql | Leave enterprise extension | companies + leave_requests + hr_documents | leave_types_config, leave_rules, leave_blackout_periods, leave_peak_periods, leave_public_holidays, leave_accrual_runs, leave_forecast_snapshots, leave_planner_conflicts | leave_requests, hr_documents + new leave config tables | Yes (guarded) |
| 046-roster-shift-planning-excellence.sql | Roster enterprise extension | companies + roster_shifts | shift_templates, roster_rules, roster_coverage_requirements, roster_versions, roster_notifications, shift_swap_requests, employee_availability_preferences | roster_shifts + new roster tables | Yes (guarded) |
| 047-payroll-readiness-workforce-validation-excellence.sql | Payroll readiness enterprise extension | companies + payroll_readiness_checks (optional extension guarded) | payroll_readiness_timeline, payroll_readiness_notifications, payroll_export_preparations | payroll_readiness_timeline, payroll_readiness_notifications, payroll_export_preparations, payroll_readiness_checks | Yes (guarded) |
| 048-workflow-automation-v1-completion.sql | Workflow automation V1 completion fields + expanded lifecycle constraints | 022 workforce_automation_actions baseline | none | workforce_automation_actions | Yes (guarded/idempotent) |
| 049-release-candidate-security-hardening.sql | V1.0 RC tenant isolation hardening for company-scoped tables | 030 tenant helper functions + existing company_id tables | none | RLS policies/grants on company-scoped tables | Yes (guarded/idempotent) |
| 050-platform-operator-claims-hardening.sql | Platform operator claims hardening for role checks | 030 tenant helper functions | function replacement only | vyron_is_platform_operator function | Yes (guarded/idempotent) |
| 051-employee-relations-contract-intelligence-foundation.sql | Employee Relations + Contract Intelligence foundation schema and tenant-safe RLS scaffolding | companies + employees + contract tables baseline + 030 helpers for policy creation | hearing_cases, hearing_participants, hearing_evidence, discipline_progressions, ai_prompt_registry, er_recommendations, ai_document_generations, employee_relations_timeline_events, contract_template_versions, contract_merge_jobs, contract_signing_events, hr_packet_exports, employee_note_attachments, employee_document_versions, employee_document_audit_history, employee_document_classifications | hr_cases, hr_warnings, contract_templates, employee_generated_documents, document_signing_links, digital_signatures, employee_notes | Yes (guarded/idempotent) |
| 052-batch2-security-hardening-baseline.sql | Batch 2 security baseline for ER/contracts/documents/signatures/AI docs; removes permissive policies and hardens storage access | 030 tenant helper functions + target tables/buckets | none | RLS policies/grants on targeted tables and storage.objects policies for secured buckets | Yes (guarded/idempotent) |
| 053-employee-relations-api-foundation-columns.sql | Batch 3 supporting columns for ER APIs (cases/hearings/notes soft delete and metadata) | 051/043 core ER tables | none | hr_cases, hearing_cases, hearing_participants, employee_notes | Yes (guarded/idempotent) |
| 054-progressive-discipline-engine-foundation.sql | Batch 4 configurable policy + decision history foundation for deterministic progressive discipline engine | 051 discipline tables + 030 helper functions | discipline_policy_configs, discipline_progression_decisions | discipline_progressions | Yes (guarded/idempotent) |
| 055-contract-intelligence-smart-generator.sql | Batch 5 contract intelligence foundation for template library versioning, placeholder registry, immutable generation metadata, and merge validation support | 051 contract intelligence tables + 030 tenant helper functions | contract_placeholder_registry | contract_templates, contract_template_versions, contract_merge_jobs, employee_generated_documents | Yes (guarded/idempotent) |
| 056-digital-signatures-document-centre-foundation.sql | Batch 6 digital signature session/provider abstraction foundation and employee document centre lifecycle metadata | 051 document/signing tables + 030 tenant helper functions | signature_provider_configs, signature_sessions | digital_signatures, document_signing_links, employee_documents | Yes (guarded/idempotent) |
| 057-printable-hr-packets-pdf-foundation.sql | Batch 7 printable document/PDF packet export history extensions with explicit packet metadata and completion tracking | 051 hr_packet_exports + 030 helpers | none | hr_packet_exports | Yes (guarded/idempotent) |
| 058-ai-employee-relations-document-intelligence.sql | Batch 8 structured AI Employee Relations document lifecycle hardening with auditable review/save status fields | 051 ai_document_generations + 030 helpers | none | ai_document_generations | Yes (guarded/idempotent) |
| 059-progressive-discipline-warning-hearing-links.sql | Batch 9 links hr_warnings/hearing_cases to discipline_progressions and decisions | 051 hr_warnings/hearing_cases + 054 discipline_progression_decisions | none | hr_warnings, hearing_cases | Yes |
| 060-privilege-escalation-hardening.sql | Phase 1 certification fix: vyron_is_platform_operator() no longer trusts self-editable user_metadata claims; company_users gains a trigger blocking self-service role/status escalation | 030 tenant helper functions + company_users | function replacement, 1 trigger | vyron_is_platform_operator, company_users | Yes (guarded/idempotent) |
| 061-session-security-hardening.sql | Phase 1C session security: company-configurable idle/absolute session timeout columns (bounded by CHECK constraints), plus a trigger restricting Force Logout (session revocation) to the session owner, an active owner/admin of that company, or a platform operator | 030 vyron_user_sessions + companies + 060 vyron_is_platform_operator() | function, 1 trigger | companies, vyron_user_sessions | Yes (guarded/idempotent) |
| 062-platform-console-foundation.sql | Platform Console: configurable subscription_plans + solution_templates (10 industry presets), extended companies customer profile/licence/billing/customer_status columns, RLS restricting plan/template writes to platform operators | 001 companies + 060 vyron_is_platform_operator() | subscription_plans, solution_templates | companies | Yes (guarded/idempotent) |
| 063-platform-console-expansion.sql | Platform Console expansion: soft-delete + subscription-engine fields on companies, Marketplace template metadata, data-driven module registry (platform_modules), feature flags, platform settings/announcements/release notes, support notes, impersonation sessions, job-queue monitoring scaffold | 062 subscription_plans/solution_templates + 060 vyron_is_platform_operator() | platform_modules, platform_feature_flags, platform_settings, platform_announcements, platform_release_notes, platform_support_notes, platform_impersonation_sessions, platform_job_queue | companies, solution_templates | Yes (guarded/idempotent) |
| 064-platform-console-production-polish.sql | Phase 3 polish: maintenance-mode read/override RPCs (narrow SECURITY DEFINER, anon-safe), expanded platform_settings (dynamic defaults, support contact, notification thresholds/preferences), supporting indexes | 063 platform_settings | 2 functions | platform_settings, companies, company_users (indexes) | Yes (guarded/idempotent) |
| 065-maintenance-override-audit.sql | Phase 3 hardening: audits every maintenance-mode emergency override attempt (success and failure) via a narrow SECURITY DEFINER RPC, closing the last silent-privileged-action gap | 030 vyron_audit_log + 064 vyron_validate_maintenance_override | 1 function | none | Yes (guarded/idempotent) |
| 066-platform-operator-bootstrap.sql | First-run bootstrap for the very first Platform Operator: single-row latch table that permanently disables the path once used, operator-claim test over raw_app_meta_data, and a SQL bootstrap function (no anon/authenticated grant) that promotes one existing auth user and audits it | 030 vyron_audit_log + 060 vyron_is_platform_operator() | vyron_platform_bootstrap, 2 functions | auth.users (raw_app_meta_data, bootstrap only) | Yes (guarded/idempotent; refuses after first use) |
| 067-platform-elevation-sessions.sql | Registry of Platform Mode (privilege elevation) sessions, enabling Active Platform Sessions, single-session termination and emergency lockdown. Does not change how elevation is granted or verified — the signed cookie remains the credential; this only adds revocation. Deny-all RLS, service role only | none (standalone; used by lib/platform/elevation-registry.ts) | vyron_platform_elevation_sessions | none | Yes (guarded/idempotent) |

## Risks identified and hardening actions

1. Missing prerequisite signaling in late enterprise migrations (`045`, `046`, `047`) could fail with opaque relation errors.
2. Existing migrations largely use idempotent patterns, but sequence assumptions were implicit rather than explicit.

Hardening applied:

1. Added explicit `DO $$` prerequisite guards in `045`, `046`, and `047` to raise clear guidance when required base tables are missing.
2. Added `NOTIFY pgrst, 'reload schema'` at end of `047`, `048`, and `049` to reduce stale API schema behavior after table/function updates.
3. Added `048` idempotent extension for orchestration lifecycle fields, status expansion, and executive workflow indexes.
4. Added `049` release-candidate hardening to remove permissive DEV/_all RLS policies on company-scoped tables and enforce authenticated tenant isolation.
5. Retained business behavior and schema intent; changes are reliability/security hardening only.

## Empty-project verification path (no manual DB intervention during run)

Use this as a CI/CD-style checklist:

1. Run bootstrap migration (`000-run-all-companies.sql`).
2. Run remaining numbered migrations in order from `006` to `049`, including both `007` files in listed order.
3. Run verification SQL:
   1. confirm all expected key tables exist (`companies`, `company_users`, `payroll_readiness_timeline`, `shift_templates`, `leave_types_config`)
   2. confirm key RPCs exist (`vyron_get_company_access`, `vyron_provision_company`)
4. Run app build (`npm run build`) against that Supabase project env.
5. Smoke test key routes (company setup, leave management, roster management, payroll readiness).

Example verification SQL:

```sql
select table_name
from information_schema.tables
where table_schema='public'
  and table_name in (
    'companies','company_users','leave_types_config','shift_templates','payroll_readiness_timeline'
  )
order by table_name;

select p.proname, pg_get_function_identity_arguments(p.oid) as args
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname='public'
  and p.proname in ('vyron_get_company_access','vyron_provision_company')
order by p.proname;
```

## Notes

- Migration `040` is absent in the sequence; this is treated as intentional gap unless repository owners indicate otherwise.
- `PASTE_THIS_IN_SUPABASE.sql` mirrors bootstrap intent and should not be executed in addition to `000` in the same fresh setup run.

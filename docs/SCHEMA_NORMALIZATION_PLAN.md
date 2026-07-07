# VYRON CORE Schema Normalization Plan (V2)

## Purpose

This document records schema normalization work for V2 only.
V1.0 priority remains production stability.
No production table changes are included in this plan.

Target long-term standard:

- company_id UUID NOT NULL

## Audit Method

Audit inputs used:

- Repository SQL definitions under sql/
- Runtime migration evidence from 049 execution failure in production-like environment
- Application references to impacted tables

Observed runtime evidence:

- Policy creation on public.leave_balances_live failed with operator mismatch text = uuid.
- This confirms company_id is not UUID on that table in the audited environment.

## Non-UUID company_id Findings

| Table name | Current company_id type | Recommended type | Migration effort | Risk level | Dependencies |
|---|---|---|---|---|---|
| public.leave_balances_live | text (confirmed by 049 runtime error context) | uuid NOT NULL | Medium-High | High | Leave UI reads, approvals panels, manager action centre, payroll intelligence reads, mobile workforce reads, schema-probe and sprint verification scripts, tenant policies in 049 and helper function in 030 |

## Dependency Detail (leave_balances_live)

Primary codepaths and scripts that currently read from leave_balances_live:

- app/(app)/leave/page.tsx
- components/LeaveApprovalsPanel.tsx
- components/LeaveBalancePanel.tsx
- components/LeaveManagementExcellencePanel.tsx
- components/ManagerActionCentrePanel.tsx
- lib/mobile-workforce-platform.ts
- lib/payroll-intelligence.ts
- scripts/schema-probe.mjs
- scripts/sprint-3-verify.mjs
- scripts/sprint-4-verify.mjs

Security and policy dependencies:

- sql/030-multi-tenant-security.sql (vyron_user_company_ids helper)
- sql/049-release-candidate-security-hardening.sql (tenant isolation policy generation)

## V2 Execution Approach (Plan Only)

Phase 1: Discovery and data quality

- Inventory all rows where company_id is null, empty, malformed, or not present in companies.id.
- Determine whether leave_balances_live is a base table or a materialized/derived object per environment.
- Capture all downstream objects (indexes, views, policies, triggers, functions) referencing company_id.

Phase 2: Compatibility bridge

- Add a shadow UUID column (company_id_uuid) and backfill using validated mapping.
- Add dual-write compatibility in ETL/jobs only if needed.
- Add validation checks to block new non-UUID writes.

Phase 3: Cutover

- Switch policies, joins, and app queries to UUID column.
- Enforce NOT NULL and foreign key to public.companies(id).
- Rename columns to final standard only after validation window.

Phase 4: Cleanup

- Remove legacy text column and temporary compatibility logic.
- Rebuild or refresh dependent views/materialized views.

## Migration Effort and Risk Rationale

- Medium-High effort because type changes touch tenant RLS, joins, and historical records.
- High risk because leave, payroll, and manager operational surfaces consume this dataset directly.
- Any direct in-place cast without staged backfill can cause policy failures, data loss risk, or runtime query failures.

## Required Pre-Work for V2

- Production schema snapshot export before any normalization work.
- Dry-run migration in staging with production-like copy.
- Rollback script prepared and tested.
- Monitoring checklist for leave and payroll APIs during cutover window.

## Audit SQL for Future Runs (Read-Only)

Use this query in each environment to identify non-UUID company_id columns:

select
  n.nspname as schema_name,
  c.relname as table_name,
  a.attname as column_name,
  pg_catalog.format_type(a.atttypid, a.atttypmod) as company_id_type
from pg_catalog.pg_attribute a
join pg_catalog.pg_class c on c.oid = a.attrelid
join pg_catalog.pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relkind in ('r','p','m','v')
  and a.attname = 'company_id'
  and a.attnum > 0
  and not a.attisdropped
  and pg_catalog.format_type(a.atttypid, a.atttypmod) <> 'uuid'
order by n.nspname, c.relname;

Interpretation:

- Any returned row is out of standard and should be queued for V2 normalization.
- V1.0 should not change those tables unless needed for immediate stability hotfixes.

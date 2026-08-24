-- 093-workforce-automation-engine-tenant-scoped.sql
-- VYRON CORE — Workforce Automation Engine, tenant-scoped (Phase 10 prerequisite)
--
-- Target project : gpiqkwebizuqajgaoxhm (vyron-core, eu-west-1)
-- Follows        : sql/090 (anon lockdown), sql/091 (tenant linkage), sql/092
--                  (storage isolation + least privilege), sql/031 (mobile workforce).
--                  None of those may be rolled back.
--
-- ===========================================================================
-- WHY THIS FILE EXISTS INSTEAD OF sql/022 + sql/048
-- ===========================================================================
-- Road & Recovery needs public.workforce_automation_actions. It is the ACTION and
-- OUTCOME stage of the R&R boundary: requirements-service.ts escalates high/critical
-- R&R exceptions into this queue, and intelligence-service.ts measures the outcome of
-- an action afterwards. Without the table, /api/road-recovery/intelligence/actions
-- returns HTTP 500 and those two stages cannot run.
--
-- sql/022 creates the tables but ships this, at lines 111-116:
--
--     CREATE POLICY workforce_automation_actions_all ON public.workforce_automation_actions
--       FOR ALL TO authenticated USING (true) WITH CHECK (true);
--
-- ...and the same for the other two tables. That is precisely the cross-tenant pattern
-- removed in Phases 9C and 9D. Running sql/022 verbatim would put a leak on a table that
-- will hold R&R exception escalations complete with company_id, service_job_id and
-- payload. sql/022 must NOT be run against this project.
--
-- This file creates the same three tables with the same columns, constraints and
-- indexes, and the tenant-isolation pattern used everywhere else in this database.
--
-- ===========================================================================
-- WHAT IT REPRODUCES
-- ===========================================================================
-- Schema is the union of sql/022 (base tables) and sql/048 (13 lifecycle columns,
-- widened status/action_type checks, trigger_type / pipeline_stage / escalation_level
-- checks, 2 extra indexes). sql/048 is column-only: no policies, no data writes, no
-- destructive DDL. Both are reproduced faithfully so sql/081 can later widen the same
-- named constraints exactly as it expects.
--
-- ===========================================================================
-- PRIVILEGES — derived from actual repository usage, not assumed
-- ===========================================================================
--   workforce_automation_actions    SELECT(8) INSERT(3) UPDATE(9) DELETE(0)  -> S,I,U
--   workforce_automation_approvals  SELECT(0) INSERT(2) UPDATE(0) DELETE(0)  -> INSERT
--   workforce_automation_audit_log  SELECT(0) INSERT(1) UPDATE(0) DELETE(0)  -> INSERT
--
-- The approvals and audit tables are append-only in the entire codebase
-- (lib/workforce-automation-engine.ts:614, :735, :248 — inserts with no .select()),
-- which is also the correct shape for a decision record and an audit trail.
-- If a future approvals UI needs to read them, add a tenant-scoped SELECT policy and a
-- SELECT grant then — deliberately not granted now.
--
-- NOTE: this project's default privileges (sql/090, sql/092) grant
-- SELECT, INSERT, REFERENCES, TRIGGER, MAINTAIN, UPDATE to authenticated on new tables
-- and nothing to anon. Section 5 therefore REVOKEs everything and re-grants explicitly,
-- so the result is deterministic rather than inherited.
--
-- SCOPE — this file does NOT:
--   * touch any existing table, column, constraint, index, trigger, function or view
--   * modify any business row
--   * grant anything to anon
--   * grant DELETE or TRUNCATE to anyone
--   * use USING (true)
--   * introduce any VYRON FINANCE dependency
--
-- ROLLBACK: sql/093-rollback.sql

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ===========================================================================
-- SECTION 1 — workforce_automation_actions
-- ===========================================================================
CREATE TABLE IF NOT EXISTS public.workforce_automation_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies (id) ON DELETE CASCADE,
  action_type text NOT NULL,
  status text NOT NULL DEFAULT 'Draft',
  employee_id text,
  manager_id text,
  prepared_by text,
  source_module text NOT NULL DEFAULT 'Workforce AI Copilot',
  reason text NOT NULL DEFAULT '',
  payload_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  approved_at timestamptz,
  completed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  -- sql/048 lifecycle columns
  trigger_type text,
  pipeline_stage text,
  workflow_owner text,
  created_by text,
  duration_minutes integer,
  outcome_summary text,
  outcome_before_json jsonb DEFAULT '{}'::jsonb,
  outcome_after_json jsonb DEFAULT '{}'::jsonb,
  impact_estimate_json jsonb DEFAULT '{}'::jsonb,
  notification_channels text[] DEFAULT ARRAY[]::text[],
  task_list_json jsonb DEFAULT '[]'::jsonb,
  approval_roles text[] DEFAULT ARRAY[]::text[],
  escalation_level text,
  -- sql/048 widened status list
  CONSTRAINT workforce_automation_actions_status_check CHECK (
    status IN (
      'Draft','Pending Approval','Assigned','Awaiting Approval','Approved',
      'In Progress','Rejected','Completed','Verified','Closed','Cancelled','Failed'
    )
  ),
  -- sql/048 renames the type check to *_action_type_check; sql/081 later widens it
  CONSTRAINT workforce_automation_actions_action_type_check CHECK (
    action_type IN (
      'Create Warning','Create HR Case','Approve Leave','Reject Leave',
      'Assign Employee','Move Employee','Create Roster Change','Create Field Job',
      'Escalate Exception','Mark Payroll Item For Review'
    )
  ),
  CONSTRAINT workforce_automation_actions_trigger_type_check CHECK (
    trigger_type IS NULL OR trigger_type IN (
      'Late Arrival','Absence Alert','Overtime Spike','Leave Conflict',
      'Compliance Failure','Payroll Blocked','Roster Changed','Clocking Breach',
      'Task Overdue','Exception Escalated','Warning Issued','HR Case Created',
      'Leave Approved','Leave Rejected','Employee Updated','Employee Transferred',
      'Workforce Intelligence Alert'
    )
  ),
  CONSTRAINT workforce_automation_actions_pipeline_stage_check CHECK (
    pipeline_stage IS NULL OR pipeline_stage IN (
      'Detected','Prepared','Assigned','Awaiting Approval','Approved',
      'In Progress','Verified','Closed','Cancelled'
    )
  ),
  CONSTRAINT workforce_automation_actions_escalation_level_check CHECK (
    escalation_level IS NULL OR escalation_level IN ('Critical','High','Medium','Low')
  )
);

CREATE INDEX IF NOT EXISTS idx_workforce_automation_actions_company_status
  ON public.workforce_automation_actions (company_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_workforce_automation_actions_employee
  ON public.workforce_automation_actions (company_id, employee_id);
CREATE INDEX IF NOT EXISTS idx_wfa_trigger_type
  ON public.workforce_automation_actions (company_id, trigger_type);
CREATE INDEX IF NOT EXISTS idx_wfa_pipeline_stage
  ON public.workforce_automation_actions (company_id, pipeline_stage);

-- ===========================================================================
-- SECTION 2 — workforce_automation_approvals
-- ===========================================================================
CREATE TABLE IF NOT EXISTS public.workforce_automation_approvals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  action_id uuid NOT NULL REFERENCES public.workforce_automation_actions (id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES public.companies (id) ON DELETE CASCADE,
  approver_email text NOT NULL,
  decision text NOT NULL,
  notes text,
  decided_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT workforce_automation_approvals_decision_check CHECK (
    decision IN ('approved', 'rejected')
  )
);

CREATE INDEX IF NOT EXISTS idx_workforce_automation_approvals_action
  ON public.workforce_automation_approvals (action_id, decided_at DESC);

-- ===========================================================================
-- SECTION 3 — workforce_automation_audit_log
-- ===========================================================================
CREATE TABLE IF NOT EXISTS public.workforce_automation_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  action_id uuid REFERENCES public.workforce_automation_actions (id) ON DELETE SET NULL,
  company_id uuid NOT NULL REFERENCES public.companies (id) ON DELETE CASCADE,
  event_type text NOT NULL,
  actor_email text,
  message text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_workforce_automation_audit_company
  ON public.workforce_automation_audit_log (company_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_workforce_automation_audit_action
  ON public.workforce_automation_audit_log (action_id, created_at DESC);

-- ===========================================================================
-- SECTION 4 — RLS + TENANT POLICIES  (no USING (true) anywhere)
-- ===========================================================================
ALTER TABLE public.workforce_automation_actions   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workforce_automation_approvals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workforce_automation_audit_log ENABLE ROW LEVEL SECURITY;

-- Defensive: if sql/022 was ever run here, remove its permissive policies.
DROP POLICY IF EXISTS workforce_automation_actions_all   ON public.workforce_automation_actions;
DROP POLICY IF EXISTS workforce_automation_approvals_all ON public.workforce_automation_approvals;
DROP POLICY IF EXISTS workforce_automation_audit_log_all ON public.workforce_automation_audit_log;

-- Idempotency: drop this file's own policies so a re-run is clean.
DROP POLICY IF EXISTS workforce_automation_actions_tenant_select   ON public.workforce_automation_actions;
DROP POLICY IF EXISTS workforce_automation_actions_tenant_insert   ON public.workforce_automation_actions;
DROP POLICY IF EXISTS workforce_automation_actions_tenant_update   ON public.workforce_automation_actions;
DROP POLICY IF EXISTS workforce_automation_approvals_tenant_insert ON public.workforce_automation_approvals;
DROP POLICY IF EXISTS workforce_automation_audit_log_tenant_insert ON public.workforce_automation_audit_log;

-- actions: SELECT / INSERT / UPDATE, tenant-scoped both ways
CREATE POLICY workforce_automation_actions_tenant_select
  ON public.workforce_automation_actions FOR SELECT TO authenticated
  USING (
    public.vyron_is_platform_operator()
    OR company_id IN (SELECT public.vyron_user_company_ids())
  );

CREATE POLICY workforce_automation_actions_tenant_insert
  ON public.workforce_automation_actions FOR INSERT TO authenticated
  WITH CHECK (
    public.vyron_is_platform_operator()
    OR company_id IN (SELECT public.vyron_user_company_ids())
  );

CREATE POLICY workforce_automation_actions_tenant_update
  ON public.workforce_automation_actions FOR UPDATE TO authenticated
  USING (
    public.vyron_is_platform_operator()
    OR company_id IN (SELECT public.vyron_user_company_ids())
  )
  WITH CHECK (
    public.vyron_is_platform_operator()
    OR company_id IN (SELECT public.vyron_user_company_ids())
  );

-- approvals: append-only decision record
CREATE POLICY workforce_automation_approvals_tenant_insert
  ON public.workforce_automation_approvals FOR INSERT TO authenticated
  WITH CHECK (
    public.vyron_is_platform_operator()
    OR company_id IN (SELECT public.vyron_user_company_ids())
  );

-- audit log: append-only trail
CREATE POLICY workforce_automation_audit_log_tenant_insert
  ON public.workforce_automation_audit_log FOR INSERT TO authenticated
  WITH CHECK (
    public.vyron_is_platform_operator()
    OR company_id IN (SELECT public.vyron_user_company_ids())
  );

-- ===========================================================================
-- SECTION 5 — DETERMINISTIC PRIVILEGES
-- ===========================================================================
REVOKE ALL ON public.workforce_automation_actions   FROM anon, authenticated;
REVOKE ALL ON public.workforce_automation_approvals FROM anon, authenticated;
REVOKE ALL ON public.workforce_automation_audit_log FROM anon, authenticated;

GRANT SELECT, INSERT, UPDATE ON public.workforce_automation_actions   TO authenticated;
GRANT INSERT                 ON public.workforce_automation_approvals TO authenticated;
GRANT INSERT                 ON public.workforce_automation_audit_log TO authenticated;

-- service_role keeps full server-side access, consistent with every other table here.
GRANT ALL ON public.workforce_automation_actions   TO service_role;
GRANT ALL ON public.workforce_automation_approvals TO service_role;
GRANT ALL ON public.workforce_automation_audit_log TO service_role;

COMMIT;

NOTIFY pgrst, 'reload schema';

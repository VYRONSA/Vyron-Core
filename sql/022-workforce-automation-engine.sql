-- 022-workforce-automation-engine.sql
-- VYRON CORE Phase 5B — Workforce Automation Engine
-- Run after workforce AI Copilot / risk / field ops migrations

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------------------------------------------------------------------------
-- workforce_automation_actions — prepared workforce actions awaiting approval
-- ---------------------------------------------------------------------------
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
  CONSTRAINT workforce_automation_actions_type_check CHECK (
    action_type IN (
      'Create Warning',
      'Create HR Case',
      'Approve Leave',
      'Reject Leave',
      'Assign Employee',
      'Move Employee',
      'Create Roster Change',
      'Create Field Job',
      'Escalate Exception',
      'Mark Payroll Item For Review'
    )
  ),
  CONSTRAINT workforce_automation_actions_status_check CHECK (
    status IN (
      'Draft',
      'Pending Approval',
      'Approved',
      'Rejected',
      'Completed',
      'Failed'
    )
  )
);

CREATE INDEX IF NOT EXISTS idx_workforce_automation_actions_company_status
  ON public.workforce_automation_actions (company_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_workforce_automation_actions_employee
  ON public.workforce_automation_actions (company_id, employee_id);

-- ---------------------------------------------------------------------------
-- workforce_automation_approvals — manager decisions
-- ---------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------
-- workforce_automation_audit_log — full audit trail
-- ---------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
ALTER TABLE public.workforce_automation_actions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workforce_automation_approvals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workforce_automation_audit_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS workforce_automation_actions_all ON public.workforce_automation_actions;
DROP POLICY IF EXISTS workforce_automation_approvals_all ON public.workforce_automation_approvals;
DROP POLICY IF EXISTS workforce_automation_audit_log_all ON public.workforce_automation_audit_log;

CREATE POLICY workforce_automation_actions_all ON public.workforce_automation_actions
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY workforce_automation_approvals_all ON public.workforce_automation_approvals
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY workforce_automation_audit_log_all ON public.workforce_automation_audit_log
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

COMMIT;

NOTIFY pgrst, 'reload schema';

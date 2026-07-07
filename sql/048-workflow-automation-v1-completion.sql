-- 048-workflow-automation-v1-completion.sql
-- Extends workforce automation actions for V1.0 orchestration lifecycle and executive metrics.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'workforce_automation_actions'
  ) THEN
    RAISE NOTICE 'Skipping migration 048: workforce_automation_actions table not found.';
    RETURN;
  END IF;
END $$;

ALTER TABLE public.workforce_automation_actions
  ADD COLUMN IF NOT EXISTS trigger_type TEXT,
  ADD COLUMN IF NOT EXISTS pipeline_stage TEXT,
  ADD COLUMN IF NOT EXISTS workflow_owner TEXT,
  ADD COLUMN IF NOT EXISTS created_by TEXT,
  ADD COLUMN IF NOT EXISTS duration_minutes INTEGER,
  ADD COLUMN IF NOT EXISTS outcome_summary TEXT,
  ADD COLUMN IF NOT EXISTS outcome_before_json JSONB DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS outcome_after_json JSONB DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS impact_estimate_json JSONB DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS notification_channels TEXT[] DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN IF NOT EXISTS task_list_json JSONB DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS approval_roles TEXT[] DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN IF NOT EXISTS escalation_level TEXT;

UPDATE public.workforce_automation_actions
SET
  trigger_type = COALESCE(trigger_type, 'Workforce Intelligence Alert'),
  pipeline_stage = COALESCE(pipeline_stage, status),
  created_by = COALESCE(created_by, prepared_by),
  workflow_owner = COALESCE(workflow_owner, manager_id, prepared_by),
  outcome_before_json = COALESCE(outcome_before_json, '{}'::jsonb),
  outcome_after_json = COALESCE(outcome_after_json, '{}'::jsonb),
  impact_estimate_json = COALESCE(impact_estimate_json, '{}'::jsonb),
  notification_channels = COALESCE(notification_channels, ARRAY[]::TEXT[]),
  task_list_json = COALESCE(task_list_json, '[]'::jsonb),
  approval_roles = COALESCE(approval_roles, ARRAY[]::TEXT[]),
  escalation_level = COALESCE(escalation_level, 'Medium')
WHERE
  trigger_type IS NULL
  OR pipeline_stage IS NULL
  OR created_by IS NULL
  OR workflow_owner IS NULL
  OR outcome_before_json IS NULL
  OR outcome_after_json IS NULL
  OR impact_estimate_json IS NULL
  OR notification_channels IS NULL
  OR task_list_json IS NULL
  OR approval_roles IS NULL
  OR escalation_level IS NULL;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'workforce_automation_actions_status_check'
      AND conrelid = 'public.workforce_automation_actions'::regclass
  ) THEN
    ALTER TABLE public.workforce_automation_actions
      DROP CONSTRAINT workforce_automation_actions_status_check;
  END IF;
END $$;

ALTER TABLE public.workforce_automation_actions
  ADD CONSTRAINT workforce_automation_actions_status_check
  CHECK (
    status IN (
      'Draft',
      'Pending Approval',
      'Assigned',
      'Awaiting Approval',
      'Approved',
      'In Progress',
      'Rejected',
      'Completed',
      'Verified',
      'Closed',
      'Cancelled',
      'Failed'
    )
  );

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'workforce_automation_actions_action_type_check'
      AND conrelid = 'public.workforce_automation_actions'::regclass
  ) THEN
    ALTER TABLE public.workforce_automation_actions
      DROP CONSTRAINT workforce_automation_actions_action_type_check;
  END IF;
END $$;

ALTER TABLE public.workforce_automation_actions
  ADD CONSTRAINT workforce_automation_actions_action_type_check
  CHECK (
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
  );

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'workforce_automation_actions_trigger_type_check'
      AND conrelid = 'public.workforce_automation_actions'::regclass
  ) THEN
    ALTER TABLE public.workforce_automation_actions
      ADD CONSTRAINT workforce_automation_actions_trigger_type_check
      CHECK (
        trigger_type IS NULL OR trigger_type IN (
          'Late Arrival',
          'Absence Alert',
          'Overtime Spike',
          'Leave Conflict',
          'Compliance Failure',
          'Payroll Blocked',
          'Roster Changed',
          'Clocking Breach',
          'Task Overdue',
          'Exception Escalated',
          'Warning Issued',
          'HR Case Created',
          'Leave Approved',
          'Leave Rejected',
          'Employee Updated',
          'Employee Transferred',
          'Workforce Intelligence Alert'
        )
      )
      NOT VALID;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'workforce_automation_actions_pipeline_stage_check'
      AND conrelid = 'public.workforce_automation_actions'::regclass
  ) THEN
    ALTER TABLE public.workforce_automation_actions
      ADD CONSTRAINT workforce_automation_actions_pipeline_stage_check
      CHECK (
        pipeline_stage IS NULL OR pipeline_stage IN (
          'Detected',
          'Prepared',
          'Assigned',
          'Awaiting Approval',
          'Approved',
          'In Progress',
          'Verified',
          'Closed',
          'Cancelled'
        )
      )
      NOT VALID;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'workforce_automation_actions_escalation_level_check'
      AND conrelid = 'public.workforce_automation_actions'::regclass
  ) THEN
    ALTER TABLE public.workforce_automation_actions
      ADD CONSTRAINT workforce_automation_actions_escalation_level_check
      CHECK (
        escalation_level IS NULL OR escalation_level IN ('Critical', 'High', 'Medium', 'Low')
      )
      NOT VALID;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_wfa_trigger_type ON public.workforce_automation_actions (company_id, trigger_type);
CREATE INDEX IF NOT EXISTS idx_wfa_pipeline_stage ON public.workforce_automation_actions (company_id, pipeline_stage);
CREATE INDEX IF NOT EXISTS idx_wfa_escalation_level ON public.workforce_automation_actions (company_id, escalation_level);
CREATE INDEX IF NOT EXISTS idx_wfa_status_updated ON public.workforce_automation_actions (company_id, status, updated_at DESC);

NOTIFY pgrst, 'reload schema';

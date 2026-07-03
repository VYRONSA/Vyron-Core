-- 026-workforce-lifecycle.sql
-- VYRON CORE — Workforce Lifecycle funnel
-- Need Staff → Recruit → Hire → Onboard → Manage → Develop → Promote → Retain → Exit

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------------------------------------------------------------------------
-- employee_lifecycle_status
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.employee_lifecycle_status (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies (id) ON DELETE CASCADE,
  employee_id text NOT NULL,
  current_stage text NOT NULL,
  stage_entered_at timestamptz NOT NULL DEFAULT now(),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, employee_id),
  CONSTRAINT employee_lifecycle_status_stage_check CHECK (
    current_stage IN (
      'need_staff',
      'recruit',
      'hire',
      'onboard',
      'manage',
      'develop',
      'promote',
      'retain',
      'exit'
    )
  )
);

CREATE INDEX IF NOT EXISTS idx_employee_lifecycle_status_company_stage
  ON public.employee_lifecycle_status (company_id, current_stage);

-- ---------------------------------------------------------------------------
-- workforce_lifecycle_events
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.workforce_lifecycle_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies (id) ON DELETE CASCADE,
  employee_id text,
  lifecycle_stage text NOT NULL,
  event_type text NOT NULL DEFAULT 'signal',
  message text NOT NULL,
  severity text NOT NULL DEFAULT 'info',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT workforce_lifecycle_events_stage_check CHECK (
    lifecycle_stage IN (
      'need_staff',
      'recruit',
      'hire',
      'onboard',
      'manage',
      'develop',
      'promote',
      'retain',
      'exit'
    )
  ),
  CONSTRAINT workforce_lifecycle_events_severity_check CHECK (
    severity IN ('info', 'warning', 'critical')
  )
);

CREATE INDEX IF NOT EXISTS idx_workforce_lifecycle_events_company
  ON public.workforce_lifecycle_events (company_id, recorded_at DESC);

-- ---------------------------------------------------------------------------
-- workforce_lifecycle_snapshots
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.workforce_lifecycle_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies (id) ON DELETE CASCADE,
  snapshot_date date NOT NULL DEFAULT CURRENT_DATE,
  stage_counts jsonb NOT NULL DEFAULT '{}'::jsonb,
  funnel_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  recommendations jsonb NOT NULL DEFAULT '[]'::jsonb,
  computed_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, snapshot_date)
);

CREATE INDEX IF NOT EXISTS idx_workforce_lifecycle_snapshots_company
  ON public.workforce_lifecycle_snapshots (company_id, snapshot_date DESC);

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
ALTER TABLE public.employee_lifecycle_status ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workforce_lifecycle_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workforce_lifecycle_snapshots ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS employee_lifecycle_status_all ON public.employee_lifecycle_status;
DROP POLICY IF EXISTS workforce_lifecycle_events_all ON public.workforce_lifecycle_events;
DROP POLICY IF EXISTS workforce_lifecycle_snapshots_all ON public.workforce_lifecycle_snapshots;

CREATE POLICY employee_lifecycle_status_all ON public.employee_lifecycle_status
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY workforce_lifecycle_events_all ON public.workforce_lifecycle_events
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY workforce_lifecycle_snapshots_all ON public.workforce_lifecycle_snapshots
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

COMMIT;

NOTIFY pgrst, 'reload schema';

-- 013-vyron-demo-requests.sql
-- Master operator demo request inbox (persisted deletes + status updates)
-- Run after sql/012-vyron-dev-developer-workspace.sql

BEGIN;

CREATE TABLE IF NOT EXISTS public.vyron_demo_requests (
  id text PRIMARY KEY,
  developer_workspace_id uuid NOT NULL
    REFERENCES public.vyron_developer_workspaces (id) ON DELETE CASCADE,
  name text NOT NULL,
  email text NOT NULL,
  phone text NOT NULL DEFAULT '',
  company text NOT NULL,
  status text NOT NULL DEFAULT 'New',
  submitted_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT vyron_demo_requests_status_check CHECK (status IN ('New', 'Contacted'))
);

CREATE INDEX IF NOT EXISTS idx_vyron_demo_requests_workspace
  ON public.vyron_demo_requests (developer_workspace_id);

CREATE INDEX IF NOT EXISTS idx_vyron_demo_requests_submitted
  ON public.vyron_demo_requests (submitted_at DESC);

ALTER TABLE public.vyron_demo_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS vyron_demo_requests_select ON public.vyron_demo_requests;
DROP POLICY IF EXISTS vyron_demo_requests_insert ON public.vyron_demo_requests;
DROP POLICY IF EXISTS vyron_demo_requests_update ON public.vyron_demo_requests;
DROP POLICY IF EXISTS vyron_demo_requests_delete ON public.vyron_demo_requests;
CREATE POLICY vyron_demo_requests_select ON public.vyron_demo_requests
  FOR SELECT TO authenticated USING (true);
CREATE POLICY vyron_demo_requests_insert ON public.vyron_demo_requests
  FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY vyron_demo_requests_update ON public.vyron_demo_requests
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY vyron_demo_requests_delete ON public.vyron_demo_requests
  FOR DELETE TO authenticated USING (true);

COMMIT;

NOTIFY pgrst, 'reload schema';

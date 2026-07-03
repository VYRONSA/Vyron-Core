-- 012-vyron-dev-developer-workspace.sql
-- VYRON DEV Phase 3 bug fix — real developer workspace UUID (replaces master-workspace placeholder)
-- Run after sql/011-vyron-dev-phase3.sql

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------------------------------------------------------------------------
-- Developer workspace registry (singleton per operator environment)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.vyron_developer_workspaces (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_key text UNIQUE NOT NULL,
  workspace_name text NOT NULL DEFAULT 'VYRON DEV Master Workspace',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_vyron_developer_workspaces_key
  ON public.vyron_developer_workspaces (workspace_key);

INSERT INTO public.vyron_developer_workspaces (workspace_key, workspace_name)
VALUES ('vyron-dev-master', 'VYRON DEV Master Workspace')
ON CONFLICT (workspace_key) DO UPDATE SET
  workspace_name = EXCLUDED.workspace_name,
  updated_at = now();

-- ---------------------------------------------------------------------------
-- Scope VYRON DEV tenant tables to developer_workspace_id
-- ---------------------------------------------------------------------------
ALTER TABLE public.vyron_clients
  ADD COLUMN IF NOT EXISTS developer_workspace_id uuid
  REFERENCES public.vyron_developer_workspaces (id) ON DELETE CASCADE;

ALTER TABLE public.vyron_client_products
  ADD COLUMN IF NOT EXISTS developer_workspace_id uuid
  REFERENCES public.vyron_developer_workspaces (id) ON DELETE CASCADE;

ALTER TABLE public.vyron_product_workspaces
  ADD COLUMN IF NOT EXISTS developer_workspace_id uuid
  REFERENCES public.vyron_developer_workspaces (id) ON DELETE CASCADE;

ALTER TABLE public.vyron_support_sessions
  ADD COLUMN IF NOT EXISTS developer_workspace_id uuid
  REFERENCES public.vyron_developer_workspaces (id) ON DELETE CASCADE;

ALTER TABLE public.vyron_client_integrations
  ADD COLUMN IF NOT EXISTS developer_workspace_id uuid
  REFERENCES public.vyron_developer_workspaces (id) ON DELETE CASCADE;

UPDATE public.vyron_clients
SET developer_workspace_id = (
  SELECT id FROM public.vyron_developer_workspaces WHERE workspace_key = 'vyron-dev-master'
)
WHERE developer_workspace_id IS NULL;

UPDATE public.vyron_client_products cp
SET developer_workspace_id = c.developer_workspace_id
FROM public.vyron_clients c
WHERE cp.client_id = c.id AND cp.developer_workspace_id IS NULL;

UPDATE public.vyron_product_workspaces pw
SET developer_workspace_id = c.developer_workspace_id
FROM public.vyron_clients c
WHERE pw.client_id = c.id AND pw.developer_workspace_id IS NULL;

UPDATE public.vyron_support_sessions ss
SET developer_workspace_id = (
  SELECT id FROM public.vyron_developer_workspaces WHERE workspace_key = 'vyron-dev-master'
)
WHERE developer_workspace_id IS NULL;

UPDATE public.vyron_client_integrations ci
SET developer_workspace_id = c.developer_workspace_id
FROM public.vyron_clients c
WHERE ci.client_id = c.id AND ci.developer_workspace_id IS NULL;

-- ---------------------------------------------------------------------------
-- RLS — developer workspaces
-- ---------------------------------------------------------------------------
ALTER TABLE public.vyron_developer_workspaces ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS vyron_dev_developer_workspaces_select ON public.vyron_developer_workspaces;
DROP POLICY IF EXISTS vyron_dev_developer_workspaces_insert ON public.vyron_developer_workspaces;
DROP POLICY IF EXISTS vyron_dev_developer_workspaces_update ON public.vyron_developer_workspaces;
CREATE POLICY vyron_dev_developer_workspaces_select ON public.vyron_developer_workspaces
  FOR SELECT TO authenticated USING (true);
CREATE POLICY vyron_dev_developer_workspaces_insert ON public.vyron_developer_workspaces
  FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY vyron_dev_developer_workspaces_update ON public.vyron_developer_workspaces
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

COMMIT;

NOTIFY pgrst, 'reload schema';

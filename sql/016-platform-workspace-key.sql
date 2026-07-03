-- 016-platform-workspace-key.sql
-- Rename legacy vyron-dev-master platform workspace key to vyron-platform (idempotent).

BEGIN;

INSERT INTO public.vyron_developer_workspaces (workspace_key, workspace_name)
VALUES ('vyron-platform', 'VYRON Platform Workspace')
ON CONFLICT (workspace_key) DO UPDATE SET
  workspace_name = EXCLUDED.workspace_name,
  updated_at = now();

UPDATE public.vyron_developer_workspaces
SET
  workspace_key = 'vyron-platform',
  workspace_name = 'VYRON Platform Workspace',
  updated_at = now()
WHERE workspace_key = 'vyron-dev-master'
  AND NOT EXISTS (
    SELECT 1 FROM public.vyron_developer_workspaces WHERE workspace_key = 'vyron-platform'
  );

COMMIT;

NOTIFY pgrst, 'reload schema';

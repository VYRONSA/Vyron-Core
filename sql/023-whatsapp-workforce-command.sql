-- 023-whatsapp-workforce-command.sql
-- VYRON CORE Phase 5C — WhatsApp Workforce Command
-- Run after sql/022-workforce-automation-engine.sql

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------------------------------------------------------------------------
-- whatsapp_command_sessions — manager phone ↔ company workspace
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.whatsapp_command_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies (id) ON DELETE CASCADE,
  manager_phone text NOT NULL,
  manager_email text,
  manager_name text,
  status text NOT NULL DEFAULT 'active',
  last_message_at timestamptz,
  mock_mode boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, manager_phone)
);

CREATE INDEX IF NOT EXISTS idx_whatsapp_command_sessions_phone
  ON public.whatsapp_command_sessions (manager_phone, updated_at DESC);

-- ---------------------------------------------------------------------------
-- whatsapp_command_messages — inbound/outbound command transcript
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.whatsapp_command_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid REFERENCES public.whatsapp_command_sessions (id) ON DELETE SET NULL,
  company_id uuid NOT NULL REFERENCES public.companies (id) ON DELETE CASCADE,
  direction text NOT NULL DEFAULT 'inbound',
  manager_phone text,
  manager_email text,
  message_body text NOT NULL,
  command_intent text,
  response_body text,
  status text NOT NULL DEFAULT 'received',
  error_message text,
  meta_message_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT whatsapp_command_messages_direction_check CHECK (
    direction IN ('inbound', 'outbound')
  )
);

CREATE INDEX IF NOT EXISTS idx_whatsapp_command_messages_company
  ON public.whatsapp_command_messages (company_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- whatsapp_command_actions — WhatsApp-initiated prepares/approvals
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.whatsapp_command_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies (id) ON DELETE CASCADE,
  session_id uuid REFERENCES public.whatsapp_command_sessions (id) ON DELETE SET NULL,
  automation_action_id uuid REFERENCES public.workforce_automation_actions (id) ON DELETE SET NULL,
  action_ref text NOT NULL,
  command_type text NOT NULL,
  manager_phone text,
  manager_email text,
  status text NOT NULL DEFAULT 'pending',
  payload_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  UNIQUE (company_id, action_ref)
);

CREATE INDEX IF NOT EXISTS idx_whatsapp_command_actions_ref
  ON public.whatsapp_command_actions (company_id, action_ref);

-- ---------------------------------------------------------------------------
-- whatsapp_command_audit_log
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.whatsapp_command_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies (id) ON DELETE CASCADE,
  session_id uuid,
  message_id uuid,
  action_id uuid,
  event_type text NOT NULL,
  manager_phone text,
  manager_email text,
  message text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_whatsapp_command_audit_company
  ON public.whatsapp_command_audit_log (company_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
ALTER TABLE public.whatsapp_command_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.whatsapp_command_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.whatsapp_command_actions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.whatsapp_command_audit_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS whatsapp_command_sessions_all ON public.whatsapp_command_sessions;
DROP POLICY IF EXISTS whatsapp_command_messages_all ON public.whatsapp_command_messages;
DROP POLICY IF EXISTS whatsapp_command_actions_all ON public.whatsapp_command_actions;
DROP POLICY IF EXISTS whatsapp_command_audit_log_all ON public.whatsapp_command_audit_log;

CREATE POLICY whatsapp_command_sessions_all ON public.whatsapp_command_sessions
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY whatsapp_command_messages_all ON public.whatsapp_command_messages
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY whatsapp_command_actions_all ON public.whatsapp_command_actions
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY whatsapp_command_audit_log_all ON public.whatsapp_command_audit_log
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

COMMIT;

NOTIFY pgrst, 'reload schema';

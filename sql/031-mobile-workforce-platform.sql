-- 031-mobile-workforce-platform.sql
-- VYRON CORE Batch 12 — Mobile Workforce Platform
-- Run after sql/030-multi-tenant-security.sql. Idempotent.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Photo evidence (clock, arrive site, complete job, etc.)
CREATE TABLE IF NOT EXISTS public.mobile_workforce_evidence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies (id) ON DELETE CASCADE,
  employee_id uuid NOT NULL,
  job_id uuid REFERENCES public.field_jobs (id) ON DELETE SET NULL,
  evidence_type text NOT NULL,
  photo_url text,
  latitude numeric(10, 7),
  longitude numeric(10, 7),
  gps_accuracy numeric(10, 2),
  captured_at timestamptz NOT NULL DEFAULT now(),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT mobile_workforce_evidence_type_check CHECK (
    evidence_type IN ('clock_in', 'clock_out', 'arrive_site', 'complete_job', 'incident', 'other')
  )
);

CREATE INDEX IF NOT EXISTS idx_mobile_evidence_company ON public.mobile_workforce_evidence (company_id, captured_at DESC);
CREATE INDEX IF NOT EXISTS idx_mobile_evidence_employee ON public.mobile_workforce_evidence (company_id, employee_id, captured_at DESC);

-- GPS validation results
CREATE TABLE IF NOT EXISTS public.mobile_gps_validations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies (id) ON DELETE CASCADE,
  employee_id uuid NOT NULL,
  job_id uuid REFERENCES public.field_jobs (id) ON DELETE SET NULL,
  store_id uuid,
  reference_type text NOT NULL DEFAULT 'job',
  employee_latitude numeric(10, 7),
  employee_longitude numeric(10, 7),
  site_latitude numeric(10, 7),
  site_longitude numeric(10, 7),
  radius_meters integer NOT NULL DEFAULT 150,
  distance_meters numeric(12, 2),
  inside_radius boolean NOT NULL DEFAULT false,
  exception_created boolean NOT NULL DEFAULT false,
  validated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_mobile_gps_validations_company ON public.mobile_gps_validations (company_id, validated_at DESC);

-- Mobile tasks
CREATE TABLE IF NOT EXISTS public.mobile_workforce_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies (id) ON DELETE CASCADE,
  assigned_to_employee_id uuid NOT NULL,
  assigned_by_email text,
  title text NOT NULL,
  description text,
  priority text NOT NULL DEFAULT 'normal',
  status text NOT NULL DEFAULT 'pending',
  due_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT mobile_workforce_tasks_priority_check CHECK (
    priority IN ('low', 'normal', 'high', 'urgent')
  ),
  CONSTRAINT mobile_workforce_tasks_status_check CHECK (
    status IN ('pending', 'accepted', 'rejected', 'in_progress', 'completed', 'cancelled')
  )
);

CREATE INDEX IF NOT EXISTS idx_mobile_tasks_employee ON public.mobile_workforce_tasks (company_id, assigned_to_employee_id, status);

-- Push notification foundation (in-app store)
CREATE TABLE IF NOT EXISTS public.mobile_workforce_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies (id) ON DELETE CASCADE,
  employee_id uuid,
  notification_type text NOT NULL,
  title text NOT NULL,
  body text,
  read_at timestamptz,
  metadata jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT mobile_workforce_notifications_type_check CHECK (
    notification_type IN (
      'new_job', 'leave_decision', 'roster_change', 'hr_notice', 'urgent_task', 'incident_alert', 'general'
    )
  )
);

CREATE INDEX IF NOT EXISTS idx_mobile_notifications_employee ON public.mobile_workforce_notifications (company_id, employee_id, created_at DESC);

-- Safety & incidents
CREATE TABLE IF NOT EXISTS public.mobile_workforce_incidents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies (id) ON DELETE CASCADE,
  employee_id uuid NOT NULL,
  title text NOT NULL,
  description text NOT NULL,
  photo_url text,
  latitude numeric(10, 7),
  longitude numeric(10, 7),
  status text NOT NULL DEFAULT 'submitted',
  manager_notified boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT mobile_workforce_incidents_status_check CHECK (
    status IN ('submitted', 'reviewing', 'resolved', 'closed')
  )
);

CREATE INDEX IF NOT EXISTS idx_mobile_incidents_company ON public.mobile_workforce_incidents (company_id, created_at DESC);

-- Offline sync audit (server-side mirror of flushed queue items)
CREATE TABLE IF NOT EXISTS public.mobile_workforce_sync_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies (id) ON DELETE CASCADE,
  employee_id uuid,
  queue_item_id text NOT NULL,
  action_type text NOT NULL,
  status text NOT NULL DEFAULT 'synced',
  error_message text,
  synced_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_mobile_sync_log_company ON public.mobile_workforce_sync_log (company_id, synced_at DESC);

-- RLS
ALTER TABLE public.mobile_workforce_evidence ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mobile_gps_validations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mobile_workforce_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mobile_workforce_notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mobile_workforce_incidents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mobile_workforce_sync_log ENABLE ROW LEVEL SECURITY;

DO $policy$
DECLARE
  tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'mobile_workforce_evidence',
    'mobile_gps_validations',
    'mobile_workforce_tasks',
    'mobile_workforce_notifications',
    'mobile_workforce_incidents',
    'mobile_workforce_sync_log'
  ]
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I_tenant ON public.%I', tbl, tbl);
    EXECUTE format(
      'CREATE POLICY %I_tenant ON public.%I FOR ALL TO authenticated USING (
         public.vyron_is_platform_operator()
         OR company_id IN (SELECT public.vyron_user_company_ids())
       ) WITH CHECK (
         public.vyron_is_platform_operator()
         OR company_id IN (SELECT public.vyron_user_company_ids())
       )',
      tbl,
      tbl
    );
    EXECUTE format('GRANT SELECT, INSERT, UPDATE ON public.%I TO authenticated', tbl);
  END LOOP;
END
$policy$;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- 017-field-travel-intelligence.sql
-- VYRON CORE Phase 4B — Workforce Travel Intelligence (routes + segments)
-- Run after sql/014-field-operations.sql

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------------------------------------------------------------------------
-- field_routes — daily workforce journey summary per employee
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.field_routes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies (id) ON DELETE CASCADE,
  employee_id uuid NOT NULL,
  route_date date NOT NULL DEFAULT CURRENT_DATE,
  shift_id uuid REFERENCES public.field_daily_shifts (id) ON DELETE SET NULL,
  started_at timestamptz,
  ended_at timestamptz,
  distance_km numeric(12, 3) NOT NULL DEFAULT 0,
  travel_seconds integer NOT NULL DEFAULT 0,
  site_seconds integer NOT NULL DEFAULT 0,
  working_seconds integer NOT NULL DEFAULT 0,
  idle_seconds integer NOT NULL DEFAULT 0,
  jobs_completed integer NOT NULL DEFAULT 0,
  productivity_pct numeric(5, 2) NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, employee_id, route_date),
  CONSTRAINT field_routes_status_check CHECK (status IN ('active', 'completed'))
);

CREATE INDEX IF NOT EXISTS idx_field_routes_company_date
  ON public.field_routes (company_id, route_date DESC);

CREATE INDEX IF NOT EXISTS idx_field_routes_employee
  ON public.field_routes (company_id, employee_id, route_date DESC);

-- ---------------------------------------------------------------------------
-- field_route_segments — travel / site / working / idle legs
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.field_route_segments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies (id) ON DELETE CASCADE,
  route_id uuid NOT NULL REFERENCES public.field_routes (id) ON DELETE CASCADE,
  segment_order integer NOT NULL DEFAULT 0,
  segment_type text NOT NULL,
  job_id uuid REFERENCES public.field_jobs (id) ON DELETE SET NULL,
  from_event_id uuid REFERENCES public.field_job_events (id) ON DELETE SET NULL,
  to_event_id uuid REFERENCES public.field_job_events (id) ON DELETE SET NULL,
  started_at timestamptz NOT NULL,
  ended_at timestamptz,
  duration_seconds integer NOT NULL DEFAULT 0,
  distance_km numeric(12, 3) NOT NULL DEFAULT 0,
  start_latitude numeric(10, 7),
  start_longitude numeric(10, 7),
  end_latitude numeric(10, 7),
  end_longitude numeric(10, 7),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT field_route_segments_type_check CHECK (
    segment_type IN ('travel', 'site', 'working', 'idle')
  )
);

CREATE INDEX IF NOT EXISTS idx_field_route_segments_route
  ON public.field_route_segments (route_id, segment_order);

CREATE INDEX IF NOT EXISTS idx_field_route_segments_company
  ON public.field_route_segments (company_id, started_at DESC);

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
ALTER TABLE public.field_routes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.field_route_segments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS field_routes_all ON public.field_routes;
DROP POLICY IF EXISTS field_route_segments_all ON public.field_route_segments;

CREATE POLICY field_routes_all ON public.field_routes
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY field_route_segments_all ON public.field_route_segments
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

COMMIT;

NOTIFY pgrst, 'reload schema';

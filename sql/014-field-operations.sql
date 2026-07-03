-- 014-field-operations.sql
-- VYRON CORE Phase 4A — Field Operations foundation (jobs, visits, events, shifts, assets, vehicles)
-- Run after sql/001-create-companies-tables.sql (requires public.companies)

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------------------------------------------------------------------------
-- field_assets
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.field_assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies (id) ON DELETE CASCADE,
  asset_code text NOT NULL,
  name text NOT NULL,
  asset_type text NOT NULL DEFAULT 'equipment',
  serial_number text,
  status text NOT NULL DEFAULT 'available',
  current_latitude numeric(10, 7),
  current_longitude numeric(10, 7),
  assigned_employee_id uuid,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, asset_code),
  CONSTRAINT field_assets_status_check CHECK (
    status IN ('available', 'assigned', 'in_transit', 'maintenance', 'retired')
  )
);

CREATE INDEX IF NOT EXISTS idx_field_assets_company_id ON public.field_assets (company_id);

-- ---------------------------------------------------------------------------
-- field_vehicles
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.field_vehicles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies (id) ON DELETE CASCADE,
  registration text NOT NULL,
  make_model text NOT NULL,
  status text NOT NULL DEFAULT 'available',
  assigned_employee_id uuid,
  odometer_km numeric(12, 2),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, registration),
  CONSTRAINT field_vehicles_status_check CHECK (
    status IN ('available', 'assigned', 'in_use', 'maintenance', 'retired')
  )
);

CREATE INDEX IF NOT EXISTS idx_field_vehicles_company_id ON public.field_vehicles (company_id);

-- ---------------------------------------------------------------------------
-- field_jobs
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.field_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies (id) ON DELETE CASCADE,
  job_ref text NOT NULL,
  title text NOT NULL,
  description text,
  status text NOT NULL DEFAULT 'Pending',
  site_type text NOT NULL DEFAULT 'customer_address',
  store_id uuid,
  customer_name text,
  customer_address text,
  asset_id uuid REFERENCES public.field_assets (id) ON DELETE SET NULL,
  vehicle_id uuid REFERENCES public.field_vehicles (id) ON DELETE SET NULL,
  latitude numeric(10, 7),
  longitude numeric(10, 7),
  scheduled_start timestamptz,
  scheduled_end timestamptz,
  priority text NOT NULL DEFAULT 'normal',
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, job_ref),
  CONSTRAINT field_jobs_status_check CHECK (
    status IN ('Pending', 'Dispatched', 'Travelling', 'On Site', 'Completed', 'Cancelled')
  ),
  CONSTRAINT field_jobs_site_type_check CHECK (
    site_type IN ('fixed_site', 'customer_address', 'mobile_asset', 'gps_location')
  ),
  CONSTRAINT field_jobs_priority_check CHECK (
    priority IN ('low', 'normal', 'high', 'urgent')
  )
);

CREATE INDEX IF NOT EXISTS idx_field_jobs_company_id ON public.field_jobs (company_id);
CREATE INDEX IF NOT EXISTS idx_field_jobs_status ON public.field_jobs (company_id, status);
CREATE INDEX IF NOT EXISTS idx_field_jobs_scheduled ON public.field_jobs (company_id, scheduled_start);

-- ---------------------------------------------------------------------------
-- field_job_assignments
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.field_job_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies (id) ON DELETE CASCADE,
  job_id uuid NOT NULL REFERENCES public.field_jobs (id) ON DELETE CASCADE,
  employee_id uuid NOT NULL,
  role text NOT NULL DEFAULT 'primary',
  status text NOT NULL DEFAULT 'assigned',
  assigned_at timestamptz NOT NULL DEFAULT now(),
  released_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT field_job_assignments_role_check CHECK (role IN ('primary', 'support')),
  CONSTRAINT field_job_assignments_status_check CHECK (status IN ('assigned', 'released'))
);

CREATE INDEX IF NOT EXISTS idx_field_job_assignments_job ON public.field_job_assignments (job_id);
CREATE INDEX IF NOT EXISTS idx_field_job_assignments_employee ON public.field_job_assignments (company_id, employee_id);

-- ---------------------------------------------------------------------------
-- field_daily_shifts
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.field_daily_shifts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies (id) ON DELETE CASCADE,
  employee_id uuid NOT NULL,
  shift_date date NOT NULL DEFAULT CURRENT_DATE,
  status text NOT NULL DEFAULT 'not_started',
  started_at timestamptz,
  ended_at timestamptz,
  start_latitude numeric(10, 7),
  start_longitude numeric(10, 7),
  end_latitude numeric(10, 7),
  end_longitude numeric(10, 7),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, employee_id, shift_date),
  CONSTRAINT field_daily_shifts_status_check CHECK (
    status IN ('not_started', 'active', 'completed')
  )
);

CREATE INDEX IF NOT EXISTS idx_field_daily_shifts_company ON public.field_daily_shifts (company_id, shift_date);

-- ---------------------------------------------------------------------------
-- field_job_events
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.field_job_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies (id) ON DELETE CASCADE,
  job_id uuid REFERENCES public.field_jobs (id) ON DELETE SET NULL,
  assignment_id uuid REFERENCES public.field_job_assignments (id) ON DELETE SET NULL,
  employee_id uuid NOT NULL,
  event_type text NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  latitude numeric(10, 7),
  longitude numeric(10, 7),
  gps_accuracy numeric(10, 2),
  photo_url text,
  notes text,
  device_info text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT field_job_events_type_check CHECK (
    event_type IN (
      'Start Day',
      'Start Travel',
      'Arrive Site',
      'Start Job',
      'Pause Job',
      'Resume Job',
      'Complete Job',
      'Leave Site',
      'End Day'
    )
  )
);

CREATE INDEX IF NOT EXISTS idx_field_job_events_job ON public.field_job_events (job_id, recorded_at DESC);
CREATE INDEX IF NOT EXISTS idx_field_job_events_employee ON public.field_job_events (company_id, employee_id, recorded_at DESC);
CREATE INDEX IF NOT EXISTS idx_field_job_events_company ON public.field_job_events (company_id, recorded_at DESC);

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
ALTER TABLE public.field_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.field_vehicles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.field_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.field_job_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.field_daily_shifts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.field_job_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS field_assets_all ON public.field_assets;
DROP POLICY IF EXISTS field_vehicles_all ON public.field_vehicles;
DROP POLICY IF EXISTS field_jobs_all ON public.field_jobs;
DROP POLICY IF EXISTS field_job_assignments_all ON public.field_job_assignments;
DROP POLICY IF EXISTS field_daily_shifts_all ON public.field_daily_shifts;
DROP POLICY IF EXISTS field_job_events_all ON public.field_job_events;

CREATE POLICY field_assets_all ON public.field_assets FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY field_vehicles_all ON public.field_vehicles FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY field_jobs_all ON public.field_jobs FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY field_job_assignments_all ON public.field_job_assignments FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY field_daily_shifts_all ON public.field_daily_shifts FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY field_job_events_all ON public.field_job_events FOR ALL TO authenticated USING (true) WITH CHECK (true);

COMMIT;

NOTIFY pgrst, 'reload schema';

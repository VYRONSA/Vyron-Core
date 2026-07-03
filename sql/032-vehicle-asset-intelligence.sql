-- 032-vehicle-asset-intelligence.sql
-- VYRON CORE Batch 13 — Vehicle & Asset Intelligence
-- Note: user spec referenced 024 (taken). Extends field_vehicles/field_assets from sql/014.
-- Run after sql/031-mobile-workforce-platform.sql. Idempotent.

BEGIN;

-- ---------------------------------------------------------------------------
-- Extend field_vehicles → Vehicle Register
-- ---------------------------------------------------------------------------
ALTER TABLE public.field_vehicles
  ADD COLUMN IF NOT EXISTS vehicle_name text,
  ADD COLUMN IF NOT EXISTS vehicle_type text DEFAULT 'light_commercial',
  ADD COLUMN IF NOT EXISTS vin text,
  ADD COLUMN IF NOT EXISTS make text,
  ADD COLUMN IF NOT EXISTS model text,
  ADD COLUMN IF NOT EXISTS year integer,
  ADD COLUMN IF NOT EXISTS fuel_type text DEFAULT 'diesel',
  ADD COLUMN IF NOT EXISTS last_service_odometer numeric(12, 2),
  ADD COLUMN IF NOT EXISTS service_interval_km numeric(12, 2) DEFAULT 15000;

-- Expand vehicle status values (Active, Maintenance, Out Of Service, Sold + legacy)
ALTER TABLE public.field_vehicles DROP CONSTRAINT IF EXISTS field_vehicles_status_check;
ALTER TABLE public.field_vehicles
  ADD CONSTRAINT field_vehicles_status_check CHECK (
    status IN (
      'available', 'assigned', 'in_use', 'maintenance', 'retired',
      'active', 'out_of_service', 'sold'
    )
  );

-- ---------------------------------------------------------------------------
-- field_trailers — Trailer Register
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.field_trailers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies (id) ON DELETE CASCADE,
  trailer_number text NOT NULL,
  registration text,
  trailer_type text NOT NULL DEFAULT 'flatbed',
  assigned_vehicle_id uuid REFERENCES public.field_vehicles (id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'active',
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, trailer_number),
  CONSTRAINT field_trailers_status_check CHECK (
    status IN ('active', 'maintenance', 'out_of_service', 'sold', 'retired')
  )
);

CREATE INDEX IF NOT EXISTS idx_field_trailers_company ON public.field_trailers (company_id);

-- ---------------------------------------------------------------------------
-- Extend field_assets → Asset Register
-- ---------------------------------------------------------------------------
ALTER TABLE public.field_assets
  ADD COLUMN IF NOT EXISTS asset_number text,
  ADD COLUMN IF NOT EXISTS assigned_vehicle_id uuid REFERENCES public.field_vehicles (id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS current_site text;

UPDATE public.field_assets SET asset_number = asset_code WHERE asset_number IS NULL;

-- ---------------------------------------------------------------------------
-- Job linking — trailer on field_jobs
-- ---------------------------------------------------------------------------
ALTER TABLE public.field_jobs
  ADD COLUMN IF NOT EXISTS trailer_id uuid REFERENCES public.field_trailers (id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_field_jobs_trailer ON public.field_jobs (company_id, trailer_id);

-- ---------------------------------------------------------------------------
-- field_vehicle_assignments
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.field_vehicle_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies (id) ON DELETE CASCADE,
  vehicle_id uuid NOT NULL REFERENCES public.field_vehicles (id) ON DELETE CASCADE,
  employee_id uuid,
  job_id uuid REFERENCES public.field_jobs (id) ON DELETE SET NULL,
  trailer_id uuid REFERENCES public.field_trailers (id) ON DELETE SET NULL,
  asset_id uuid REFERENCES public.field_assets (id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'active',
  assigned_at timestamptz NOT NULL DEFAULT now(),
  released_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT field_vehicle_assignments_status_check CHECK (
    status IN ('active', 'released', 'completed')
  )
);

CREATE INDEX IF NOT EXISTS idx_field_vehicle_assignments_vehicle ON public.field_vehicle_assignments (company_id, vehicle_id);

-- ---------------------------------------------------------------------------
-- field_vehicle_events — timeline + odometer
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.field_vehicle_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies (id) ON DELETE CASCADE,
  vehicle_id uuid NOT NULL REFERENCES public.field_vehicles (id) ON DELETE CASCADE,
  employee_id uuid,
  job_id uuid REFERENCES public.field_jobs (id) ON DELETE SET NULL,
  event_type text NOT NULL,
  odometer_start_km numeric(12, 2),
  odometer_end_km numeric(12, 2),
  distance_km numeric(12, 2),
  travel_seconds integer,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT field_vehicle_events_type_check CHECK (
    event_type IN (
      'start_day', 'travel', 'arrive_site', 'leave_site', 'end_day',
      'odometer_start', 'odometer_end',
      'Start Day', 'Start Travel', 'Arrive Site', 'Leave Site', 'End Day'
    )
  )
);

CREATE INDEX IF NOT EXISTS idx_field_vehicle_events_vehicle ON public.field_vehicle_events (company_id, vehicle_id, recorded_at DESC);

-- ---------------------------------------------------------------------------
-- field_vehicle_costs
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.field_vehicle_costs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies (id) ON DELETE CASCADE,
  vehicle_id uuid NOT NULL REFERENCES public.field_vehicles (id) ON DELETE CASCADE,
  cost_date date NOT NULL DEFAULT CURRENT_DATE,
  distance_km numeric(12, 2) NOT NULL DEFAULT 0,
  travel_cost numeric(12, 2) NOT NULL DEFAULT 0,
  job_cost numeric(12, 2) NOT NULL DEFAULT 0,
  cost_per_km numeric(10, 4),
  utilisation_pct numeric(6, 2),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, vehicle_id, cost_date)
);

-- ---------------------------------------------------------------------------
-- field_asset_utilisation
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.field_asset_utilisation (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies (id) ON DELETE CASCADE,
  asset_id uuid NOT NULL REFERENCES public.field_assets (id) ON DELETE CASCADE,
  util_date date NOT NULL DEFAULT CURRENT_DATE,
  hours_used numeric(8, 2) NOT NULL DEFAULT 0,
  jobs_count integer NOT NULL DEFAULT 0,
  idle_days integer NOT NULL DEFAULT 0,
  revenue_zar numeric(12, 2) NOT NULL DEFAULT 0,
  cost_zar numeric(12, 2) NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, asset_id, util_date)
);

-- ---------------------------------------------------------------------------
-- field_vehicle_risk_events
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.field_vehicle_risk_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies (id) ON DELETE CASCADE,
  vehicle_id uuid REFERENCES public.field_vehicles (id) ON DELETE SET NULL,
  asset_id uuid REFERENCES public.field_assets (id) ON DELETE SET NULL,
  risk_type text NOT NULL,
  severity text NOT NULL DEFAULT 'warning',
  message text NOT NULL,
  detected_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  metadata jsonb,
  CONSTRAINT field_vehicle_risk_type_check CHECK (
    risk_type IN (
      'excessive_distance', 'idle_time', 'vehicle_not_used', 'maintenance_due',
      'unexpected_travel', 'high_travel_cost', 'low_utilisation'
    )
  ),
  CONSTRAINT field_vehicle_risk_severity_check CHECK (
    severity IN ('info', 'warning', 'critical')
  )
);

CREATE INDEX IF NOT EXISTS idx_field_vehicle_risk_company ON public.field_vehicle_risk_events (company_id, detected_at DESC);

-- Compatibility views (user-spec table names → field_* tables)
CREATE OR REPLACE VIEW public.vehicles AS
  SELECT
    id, company_id, registration, COALESCE(vehicle_name, make_model) AS vehicle_name,
    vehicle_type, vin, make, model, year, fuel_type, odometer_km AS current_odometer,
    assigned_employee_id AS assigned_driver, status, notes, created_at, updated_at
  FROM public.field_vehicles;

CREATE OR REPLACE VIEW public.trailers AS
  SELECT
    id, company_id, trailer_number, registration, trailer_type AS type,
    assigned_vehicle_id, status, notes, created_at, updated_at
  FROM public.field_trailers;

CREATE OR REPLACE VIEW public.assets AS
  SELECT
    id, company_id, COALESCE(asset_number, asset_code) AS asset_number,
    name AS asset_name, asset_type AS type, serial_number,
    assigned_employee_id, assigned_vehicle_id, current_site, status,
    notes, created_at, updated_at
  FROM public.field_assets;

-- RLS
ALTER TABLE public.field_trailers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.field_vehicle_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.field_vehicle_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.field_vehicle_costs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.field_asset_utilisation ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.field_vehicle_risk_events ENABLE ROW LEVEL SECURITY;

DO $policy$
DECLARE
  tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'field_trailers',
    'field_vehicle_assignments',
    'field_vehicle_events',
    'field_vehicle_costs',
    'field_asset_utilisation',
    'field_vehicle_risk_events'
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

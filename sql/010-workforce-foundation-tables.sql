-- 010-workforce-foundation-tables.sql
-- VYRON CORE — the workforce foundation tables, brought under migration control.
--
-- ---------------------------------------------------------------------------
-- WHY THIS EXISTS
-- ---------------------------------------------------------------------------
--
-- Six tables were referenced by the numbered migrations and by the application, and
-- created by NO migration. They were made directly in the Supabase project before
-- migrations were kept under version control, so every later migration reasonably assumed
-- they were already there:
--
--     public.employees        sql/030 (RLS), sql/035, sql/039, sql/051, sql/054,
--                             sql/056, sql/071 (driver certifications, dispatch)
--     public.stores           sql/030, sql/035
--     public.leave_requests   sql/045, which raises "run the baseline HR/leave schema
--                             migration that creates leave_requests" — a migration that
--                             was never written
--     public.roster_shifts    sql/046, with the same unmet prerequisite
--     public.hr_documents     sql/045
--     public.leave_balances   sql/039, whose AFTER INSERT trigger on public.employees
--                             writes to it, so creating an employee FAILS without it
--
-- The consequence was not theoretical. A clean database could not be built from this
-- repository at all: sql/030 failed on the missing public.employees and thirty-five
-- migrations cascaded behind it. That is why Phases 0-6 were each validated against a
-- hand-assembled database that could never be rebuilt, and why the regression net could
-- only ever be run once.
--
-- ---------------------------------------------------------------------------
-- THIS IS A CONTRACT, NOT A REDESIGN
-- ---------------------------------------------------------------------------
--
-- Every column below is one the application actually reads or writes, or one a migration
-- references. Nothing has been added because it seemed like a good idea, and nothing has
-- been renamed, retyped or removed.
--
-- The migration is written to be correct in BOTH directions:
--
--   CREATE TABLE IF NOT EXISTS   builds the table on a clean database
--   ADD COLUMN IF NOT EXISTS     brings an EXISTING production table up to the contract
--                                without touching anything already there
--
-- So it is a no-op against the live project except where the live project is genuinely
-- missing a column the code expects — which is exactly what a schema contract should do.
--
-- ---------------------------------------------------------------------------
-- WHAT IT DELIBERATELY DOES NOT DO
-- ---------------------------------------------------------------------------
--
--   * No RLS. sql/030 enables row level security and writes the tenant policies, and
--     letting it do so is the point — a foundation migration that pre-empted the security
--     model would be testing itself.
--   * No GRANTs. sql/049 owns the grant matrix.
--   * No seed data. Fixtures and provisioning are separate and explicit.
--   * No DROP, no column removal, no type change. Nothing here can lose data.
--
-- Idempotent and safe to re-run. Requires sql/001 (public.companies).

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $prereq$
BEGIN
  IF to_regclass('public.companies') IS NULL THEN
    RAISE EXCEPTION
      'Prerequisite missing: public.companies. Run sql/001-create-companies-tables.sql before sql/010.';
  END IF;
END
$prereq$;

-- ---------------------------------------------------------------------------
-- 1. public.stores
-- ---------------------------------------------------------------------------
--
-- Trading locations. Employees belong to one, rosters are planned per store, and the
-- kiosk uses the coordinates and radius to decide whether a clock-in happened on site.
--
-- Created BEFORE employees because employees.default_store_id refers to it.
CREATE TABLE IF NOT EXISTS public.stores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid,
  name text,
  status text,
  created_at timestamptz NOT NULL DEFAULT now(),
  record_status text NOT NULL DEFAULT 'active'
);

ALTER TABLE public.stores ADD COLUMN IF NOT EXISTS company_id uuid;
ALTER TABLE public.stores ADD COLUMN IF NOT EXISTS name text;
ALTER TABLE public.stores ADD COLUMN IF NOT EXISTS status text;
ALTER TABLE public.stores ADD COLUMN IF NOT EXISTS address text;
ALTER TABLE public.stores ADD COLUMN IF NOT EXISTS city text;
ALTER TABLE public.stores ADD COLUMN IF NOT EXISTS region text;
ALTER TABLE public.stores ADD COLUMN IF NOT EXISTS latitude numeric;
ALTER TABLE public.stores ADD COLUMN IF NOT EXISTS longitude numeric;
-- The kiosk compares a clock-in position against these. A store with no radius simply
-- performs no geofence check; it is not a failure.
ALTER TABLE public.stores ADD COLUMN IF NOT EXISTS gps_radius_meters integer;
ALTER TABLE public.stores ADD COLUMN IF NOT EXISTS opening_time time;
ALTER TABLE public.stores ADD COLUMN IF NOT EXISTS closing_time time;
ALTER TABLE public.stores ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE public.stores ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE public.stores ADD COLUMN IF NOT EXISTS record_status text NOT NULL DEFAULT 'active';

DO $stores_check$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'stores_record_status_check') THEN
    ALTER TABLE public.stores
      ADD CONSTRAINT stores_record_status_check
      CHECK (record_status IN ('active', 'archived', 'deleted'));
  END IF;
END
$stores_check$;

CREATE INDEX IF NOT EXISTS stores_company_id_idx ON public.stores (company_id);

-- ---------------------------------------------------------------------------
-- 2. public.employees
-- ---------------------------------------------------------------------------
--
-- The workforce spine, and the single most depended-upon table in VYRON CORE. Road &
-- Recovery uses it for driver identity: a dispatch candidate is an employee, a driver
-- certification belongs to an employee, and the driver-facing endpoints resolve the
-- signed-in user to an employee row rather than trusting the request body.
--
-- record_status carries the soft-delete model the rest of the platform uses. A person is
-- ARCHIVED, never destroyed, because their history underpins payroll, discipline and
-- compliance long after they leave.
CREATE TABLE IF NOT EXISTS public.employees (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid,
  employee_number text,
  first_name text,
  last_name text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  record_status text NOT NULL DEFAULT 'active'
);

ALTER TABLE public.employees ADD COLUMN IF NOT EXISTS company_id uuid;
ALTER TABLE public.employees ADD COLUMN IF NOT EXISTS employee_number text;
ALTER TABLE public.employees ADD COLUMN IF NOT EXISTS first_name text;
ALTER TABLE public.employees ADD COLUMN IF NOT EXISTS last_name text;
ALTER TABLE public.employees ADD COLUMN IF NOT EXISTS email text;
ALTER TABLE public.employees ADD COLUMN IF NOT EXISTS phone text;
ALTER TABLE public.employees ADD COLUMN IF NOT EXISTS job_title text;
ALTER TABLE public.employees ADD COLUMN IF NOT EXISTS employment_type text;
ALTER TABLE public.employees ADD COLUMN IF NOT EXISTS status text;
ALTER TABLE public.employees ADD COLUMN IF NOT EXISTS store_id uuid;
ALTER TABLE public.employees ADD COLUMN IF NOT EXISTS default_store_id uuid;
-- Kiosk clocking. A PIN identifies the person at a shared device; the geofence radius
-- overrides the store's when an employee legitimately works away from it.
ALTER TABLE public.employees ADD COLUMN IF NOT EXISTS kiosk_access_enabled boolean NOT NULL DEFAULT false;
ALTER TABLE public.employees ADD COLUMN IF NOT EXISTS pin_code text;
ALTER TABLE public.employees ADD COLUMN IF NOT EXISTS active boolean NOT NULL DEFAULT true;
ALTER TABLE public.employees ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE public.employees ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE public.employees ADD COLUMN IF NOT EXISTS record_status text NOT NULL DEFAULT 'active';

DO $employees_check$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'employees_record_status_check') THEN
    ALTER TABLE public.employees
      ADD CONSTRAINT employees_record_status_check
      CHECK (record_status IN ('active', 'archived', 'deleted'));
  END IF;

  -- (company_id, id) is required by sql/071, which uses COMPOSITE foreign keys so a
  -- cross-tenant reference is impossible even if a policy were somehow bypassed. sql/071
  -- adds it when absent; declaring it here means a clean install has it from the start.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'employees_company_id_id_key') THEN
    ALTER TABLE public.employees
      ADD CONSTRAINT employees_company_id_id_key UNIQUE (company_id, id);
  END IF;
END
$employees_check$;

CREATE INDEX IF NOT EXISTS employees_company_id_idx ON public.employees (company_id);
CREATE INDEX IF NOT EXISTS employees_store_id_idx ON public.employees (company_id, store_id);
CREATE INDEX IF NOT EXISTS employees_active_idx ON public.employees (company_id, active);

-- ---------------------------------------------------------------------------
-- 3. public.leave_balances
-- ---------------------------------------------------------------------------
--
-- Written by the AFTER INSERT trigger sql/039 installs on public.employees. Creating an
-- employee therefore FAILS outright without this table, which is how the gap first
-- surfaced when the Phase 7 harness seeded its fixtures.
--
-- Deliberately created BEFORE anything inserts an employee.
CREATE TABLE IF NOT EXISTS public.leave_balances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid,
  employee_id uuid,
  leave_type text,
  opening_balance numeric NOT NULL DEFAULT 0,
  accrued numeric NOT NULL DEFAULT 0,
  taken numeric NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.leave_balances ADD COLUMN IF NOT EXISTS company_id uuid;
ALTER TABLE public.leave_balances ADD COLUMN IF NOT EXISTS employee_id uuid;
ALTER TABLE public.leave_balances ADD COLUMN IF NOT EXISTS leave_type text;
ALTER TABLE public.leave_balances ADD COLUMN IF NOT EXISTS opening_balance numeric NOT NULL DEFAULT 0;
ALTER TABLE public.leave_balances ADD COLUMN IF NOT EXISTS accrued numeric NOT NULL DEFAULT 0;
ALTER TABLE public.leave_balances ADD COLUMN IF NOT EXISTS taken numeric NOT NULL DEFAULT 0;
ALTER TABLE public.leave_balances ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE public.leave_balances ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

CREATE INDEX IF NOT EXISTS leave_balances_company_employee_idx
  ON public.leave_balances (company_id, employee_id);

-- ---------------------------------------------------------------------------
-- 4. public.leave_requests
-- ---------------------------------------------------------------------------
--
-- The prerequisite sql/045 names in its own error message. Only the BASELINE shape is
-- declared here: sql/045 adds the workflow columns (workflow_stage, the approval
-- timestamps, the attachment requirements) and keeps ownership of them, so the two
-- migrations do not both claim the same ground.
CREATE TABLE IF NOT EXISTS public.leave_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid,
  employee_id uuid,
  employee_name text,
  leave_type text,
  start_date date,
  end_date date,
  status text NOT NULL DEFAULT 'submitted',
  reason text,
  manager_feedback text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.leave_requests ADD COLUMN IF NOT EXISTS company_id uuid;
ALTER TABLE public.leave_requests ADD COLUMN IF NOT EXISTS employee_id uuid;
ALTER TABLE public.leave_requests ADD COLUMN IF NOT EXISTS employee_name text;
ALTER TABLE public.leave_requests ADD COLUMN IF NOT EXISTS leave_type text;
ALTER TABLE public.leave_requests ADD COLUMN IF NOT EXISTS start_date date;
ALTER TABLE public.leave_requests ADD COLUMN IF NOT EXISTS end_date date;
ALTER TABLE public.leave_requests ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'submitted';
ALTER TABLE public.leave_requests ADD COLUMN IF NOT EXISTS reason text;
ALTER TABLE public.leave_requests ADD COLUMN IF NOT EXISTS manager_feedback text;
ALTER TABLE public.leave_requests ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();

CREATE INDEX IF NOT EXISTS leave_requests_company_id_idx ON public.leave_requests (company_id);
CREATE INDEX IF NOT EXISTS leave_requests_employee_idx
  ON public.leave_requests (company_id, employee_id);

-- ---------------------------------------------------------------------------
-- 5. public.roster_shifts
-- ---------------------------------------------------------------------------
--
-- The prerequisite sql/046 names. Baseline shape only: sql/046 adds the planning columns
-- (templates, versions, publication, approval, cost estimate) and keeps them.
CREATE TABLE IF NOT EXISTS public.roster_shifts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid,
  employee_id uuid,
  store_id uuid,
  role text,
  shift_date date,
  planned_start timestamptz,
  planned_end timestamptz,
  status text NOT NULL DEFAULT 'planned',
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.roster_shifts ADD COLUMN IF NOT EXISTS company_id uuid;
ALTER TABLE public.roster_shifts ADD COLUMN IF NOT EXISTS employee_id uuid;
ALTER TABLE public.roster_shifts ADD COLUMN IF NOT EXISTS store_id uuid;
ALTER TABLE public.roster_shifts ADD COLUMN IF NOT EXISTS role text;
ALTER TABLE public.roster_shifts ADD COLUMN IF NOT EXISTS shift_date date;
ALTER TABLE public.roster_shifts ADD COLUMN IF NOT EXISTS planned_start timestamptz;
ALTER TABLE public.roster_shifts ADD COLUMN IF NOT EXISTS planned_end timestamptz;
ALTER TABLE public.roster_shifts ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'planned';
ALTER TABLE public.roster_shifts ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();

CREATE INDEX IF NOT EXISTS roster_shifts_company_id_idx ON public.roster_shifts (company_id);
CREATE INDEX IF NOT EXISTS roster_shifts_date_idx ON public.roster_shifts (company_id, shift_date);

-- ---------------------------------------------------------------------------
-- 6. public.hr_documents
-- ---------------------------------------------------------------------------
--
-- The HR document register, required by sql/045. It records where a document LIVES —
-- bucket and path in Supabase Storage — never the bytes.
--
-- Road & Recovery does not use it: evidence is recorded against rr_evidence_links and
-- mobile_workforce_evidence. It is here because the migration chain needs it.
CREATE TABLE IF NOT EXISTS public.hr_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid,
  employee_id uuid,
  employee_name text,
  document_type text,
  document_title text,
  document_notes text,
  file_name text,
  file_url text,
  file_path text,
  file_bucket text,
  uploaded_by text,
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.hr_documents ADD COLUMN IF NOT EXISTS company_id uuid;
ALTER TABLE public.hr_documents ADD COLUMN IF NOT EXISTS employee_id uuid;
ALTER TABLE public.hr_documents ADD COLUMN IF NOT EXISTS employee_name text;
ALTER TABLE public.hr_documents ADD COLUMN IF NOT EXISTS document_type text;
ALTER TABLE public.hr_documents ADD COLUMN IF NOT EXISTS document_title text;
ALTER TABLE public.hr_documents ADD COLUMN IF NOT EXISTS document_notes text;
ALTER TABLE public.hr_documents ADD COLUMN IF NOT EXISTS title text;
ALTER TABLE public.hr_documents ADD COLUMN IF NOT EXISTS file_name text;
ALTER TABLE public.hr_documents ADD COLUMN IF NOT EXISTS file_url text;
ALTER TABLE public.hr_documents ADD COLUMN IF NOT EXISTS file_path text;
ALTER TABLE public.hr_documents ADD COLUMN IF NOT EXISTS file_bucket text;
ALTER TABLE public.hr_documents ADD COLUMN IF NOT EXISTS uploaded_by text;
ALTER TABLE public.hr_documents ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active';
ALTER TABLE public.hr_documents ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE public.hr_documents ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

CREATE INDEX IF NOT EXISTS hr_documents_company_id_idx ON public.hr_documents (company_id);
CREATE INDEX IF NOT EXISTS hr_documents_employee_idx
  ON public.hr_documents (company_id, employee_id);

COMMENT ON TABLE public.employees IS
  'Workforce spine. Brought under migration control by sql/010; the shape is the contract the application already depended on, not a redesign.';
COMMENT ON TABLE public.stores IS
  'Trading locations. Brought under migration control by sql/010.';

COMMIT;

NOTIFY pgrst, 'reload schema';

-- Align hr_warnings with application expectations (idempotent).
-- Live DB already has: id, company_id, employee_id, warning_type, expiry_date, description, status, created_at
--
-- ---------------------------------------------------------------------------
-- ORDERING
-- ---------------------------------------------------------------------------
--
-- public.hr_warnings is OWNED by sql/051, which creates it as part of the Employee
-- Relations foundation. This file is numbered 038 and therefore runs BEFORE it, so on a
-- clean database it used to fail outright on a table that did not exist yet — and every
-- migration after it cascaded.
--
-- Against the live project the ordering never mattered, because the table was already
-- there. It mattered the moment anyone tried to build the schema from zero, which is what
-- a new environment and the disposable regression harness both do.
--
-- The guard below creates the BASELINE table if it is absent, using the same definition
-- sql/051 uses. sql/051's own CREATE TABLE IF NOT EXISTS then finds it and no-ops, so
-- ownership is unchanged and the chain works in either order. A static test asserts the
-- two definitions still agree, so they cannot drift apart.
DO $hr_warnings_guard$
BEGIN
  IF to_regclass('public.hr_warnings') IS NULL THEN
    IF to_regclass('public.employees') IS NULL THEN
      RAISE EXCEPTION
        'Prerequisite missing: public.employees. Run sql/010-workforce-foundation-tables.sql before sql/038.';
    END IF;

    RAISE NOTICE
      'public.hr_warnings does not exist yet (sql/051 owns it). Creating the baseline table so this migration can apply on a clean database.';

    CREATE TABLE public.hr_warnings (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      company_id uuid NOT NULL REFERENCES public.companies (id) ON DELETE CASCADE,
      employee_id uuid NOT NULL REFERENCES public.employees (id) ON DELETE CASCADE,
      warning_type text NOT NULL DEFAULT 'verbal',
      description text NOT NULL DEFAULT '',
      status text NOT NULL DEFAULT 'active',
      expiry_date date,
      created_at timestamptz NOT NULL DEFAULT now()
    );
  END IF;
END
$hr_warnings_guard$;

ALTER TABLE public.hr_warnings ADD COLUMN IF NOT EXISTS employee_name text;
ALTER TABLE public.hr_warnings ADD COLUMN IF NOT EXISTS incident_type text;
ALTER TABLE public.hr_warnings ADD COLUMN IF NOT EXISTS incident_date date;
ALTER TABLE public.hr_warnings ADD COLUMN IF NOT EXISTS issue_date date;
ALTER TABLE public.hr_warnings ADD COLUMN IF NOT EXISTS manager_notes text;
ALTER TABLE public.hr_warnings ADD COLUMN IF NOT EXISTS severity text;

CREATE INDEX IF NOT EXISTS hr_warnings_company_id_idx ON public.hr_warnings(company_id);

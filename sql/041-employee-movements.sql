-- Workforce movement tables (missing on production — required for transfer/termination).
-- From vyron_core_current_sql.sql — apply in Supabase SQL Editor.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS public.employee_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid REFERENCES public.companies(id),
  employee_id uuid NOT NULL,
  movement_type text NOT NULL,
  from_store_id uuid,
  to_store_id uuid,
  effective_date date NOT NULL,
  end_date date,
  instruction_text text,
  status text NOT NULL DEFAULT 'scheduled',
  applied_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.employee_status_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid REFERENCES public.companies(id),
  employee_id uuid NOT NULL,
  previous_status text,
  new_status text NOT NULL,
  effective_date date NOT NULL,
  reason text,
  instruction_text text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS employee_movements_company_id_idx ON public.employee_movements(company_id);
CREATE INDEX IF NOT EXISTS employee_movements_employee_id_idx ON public.employee_movements(employee_id);

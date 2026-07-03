-- Seed leave_balances when a new employee is created.
-- Production table columns: company_id, employee_id, leave_type, opening_balance, accrued, taken
-- Apply in Supabase SQL Editor on project ldnrmgafsquzfitcuvxq.

CREATE OR REPLACE FUNCTION public.vyron_seed_employee_leave_balances()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.leave_balances (company_id, employee_id, leave_type, opening_balance, accrued, taken)
  SELECT NEW.company_id, NEW.id, seed.leave_type, 0, seed.accrued, 0
  FROM (
    VALUES
      ('annual'::text, 15::numeric),
      ('sick'::text, 30::numeric),
      ('family'::text, 3::numeric)
  ) AS seed(leave_type, accrued)
  WHERE NOT EXISTS (
    SELECT 1 FROM public.leave_balances lb
    WHERE lb.employee_id = NEW.id AND lb.leave_type = seed.leave_type
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS vyron_seed_leave_balances_on_employee ON public.employees;
CREATE TRIGGER vyron_seed_leave_balances_on_employee
  AFTER INSERT ON public.employees
  FOR EACH ROW
  EXECUTE FUNCTION public.vyron_seed_employee_leave_balances();

-- 007-clear-demo-company-data.sql
-- Clears demo business data but keeps:
-- companies
-- company_users
-- login access

DELETE FROM public.clock_events WHERE company_id = '11111111-1111-1111-1111-111111111111';
DELETE FROM public.roster_shifts WHERE company_id = '11111111-1111-1111-1111-111111111111';
DELETE FROM public.payroll_hours WHERE company_id = '11111111-1111-1111-1111-111111111111';
DELETE FROM public.payroll_batches WHERE company_id = '11111111-1111-1111-1111-111111111111';
DELETE FROM public.exceptions WHERE company_id = '11111111-1111-1111-1111-111111111111';
DELETE FROM public.hr_cases WHERE company_id = '11111111-1111-1111-1111-111111111111';
DELETE FROM public.hr_warnings WHERE company_id = '11111111-1111-1111-1111-111111111111';
DELETE FROM public.hr_documents WHERE company_id = '11111111-1111-1111-1111-111111111111';
DELETE FROM public.employee_documents WHERE company_id = '11111111-1111-1111-1111-111111111111';
DELETE FROM public.leave_requests WHERE company_id = '11111111-1111-1111-1111-111111111111';
DELETE FROM public.employees WHERE company_id = '11111111-1111-1111-1111-111111111111';
DELETE FROM public.stores WHERE company_id = '11111111-1111-1111-1111-111111111111';
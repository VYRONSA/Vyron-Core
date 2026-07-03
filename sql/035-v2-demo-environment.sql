-- 035-v2-demo-environment.sql
-- VYRON CORE V2 — Realistic demo environment seed (Cascade Facilities Group).
-- Run after core company tables exist. Idempotent. Safe to re-run.
-- Target: sales demo / pilot onboarding — NOT production tenant data.

BEGIN;

-- Demo company (create if missing)
INSERT INTO public.companies (id, name, subscription_tier, monthly_fee, subscription_status, status)
VALUES (
  'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
  'Cascade Facilities Group',
  'Professional',
  4999,
  'active',
  'active'
)
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  subscription_tier = EXCLUDED.subscription_tier,
  monthly_fee = EXCLUDED.monthly_fee;

-- Stores
INSERT INTO public.stores (id, company_id, name, city, region, status)
VALUES
  ('b1000001-0000-4000-8000-000000000001', 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', 'Sandton Service Hub', 'Sandton', 'Gauteng', 'active'),
  ('b1000001-0000-4000-8000-000000000002', 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', 'Centurion Operations', 'Centurion', 'Gauteng', 'active'),
  ('b1000001-0000-4000-8000-000000000003', 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', 'Durban Coastal Branch', 'Durban', 'KwaZulu-Natal', 'active'),
  ('b1000001-0000-4000-8000-000000000004', 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', 'Cape Town West', 'Cape Town', 'Western Cape', 'active'),
  ('b1000001-0000-4000-8000-000000000005', 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', 'Bloemfontein Regional', 'Bloemfontein', 'Free State', 'active')
ON CONFLICT (id) DO NOTHING;

-- 50 employees — realistic SA workforce (managers + technicians + admin)
INSERT INTO public.employees (id, company_id, employee_number, first_name, last_name, job_title, active, pin_code, kiosk_access_enabled)
SELECT
  gen_random_uuid(),
  'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
  'CFG-' || LPAD(n::text, 4, '0'),
  split_part(names.full_name, ' ', 1),
  split_part(names.full_name, ' ', 2),
  names.job_title,
  true,
  LPAD((1000 + n)::text, 4, '0'),
  true
FROM (
  VALUES
    (1, 'Thabo Mokoena', 'Operations Manager'),
    (2, 'Lerato Nkosi', 'HR Administrator'),
    (3, 'Sipho Dlamini', 'Field Supervisor'),
    (4, 'Nomsa Khumalo', 'Payroll Coordinator'),
    (5, 'Johan van der Merwe', 'Regional Manager'),
    (6, 'Ayanda Zulu', 'Senior Technician'),
    (7, 'Pieter Botha', 'HVAC Technician'),
    (8, 'Zanele Mthembu', 'Electrician'),
    (9, 'David Naidoo', 'Plumber'),
    (10, 'Fatima Patel', 'Service Coordinator'),
    (11, 'Michael Govender', 'Maintenance Lead'),
    (12, 'Busisiwe Ndlovu', 'Reception Administrator'),
    (13, 'Chris Pretorius', 'Fleet Coordinator'),
    (14, 'Amanda Steyn', 'Compliance Officer'),
    (15, 'Tshepo Moloi', 'Junior Technician'),
    (16, 'Karen Jacobs', 'Store Manager'),
    (17, 'Bongani Sithole', 'Security Technician'),
    (18, 'Elize du Plessis', 'Accounts Clerk'),
    (19, 'Mandla Cele', 'Field Technician'),
    (20, 'Riaan Fourie', 'Workshop Foreman'),
    (21, 'Precious Maseko', 'Customer Liaison'),
    (22, 'Henk Venter', 'Refrigeration Technician'),
    (23, 'Naledi Mabaso', 'Apprentice Technician'),
    (24, 'Grant Williams', 'Project Supervisor'),
    (25, 'Lungile Gumede', 'Driver Technician'),
    (26, 'Sarah Olivier', 'Quality Inspector'),
    (27, 'Kagiso Molefe', 'Generator Specialist'),
    (28, 'Willem Kruger', 'Boiler Technician'),
    (29, 'Ntombi Mhlongo', 'Admin Assistant'),
    (30, 'Ryan Pillay', 'Solar Technician'),
    (31, 'Chantal Adams', 'Roster Planner'),
    (32, 'Sello Mahlangu', 'Multi-skilled Technician'),
    (33, 'Marco Ferreira', 'Carpenter'),
    (34, 'Dineo Kgosana', 'Health & Safety Officer'),
    (35, 'Andre Coetzee', 'Senior Electrician'),
    (36, 'Yolanda Swartz', 'Leave Administrator'),
    (37, 'Musa Nkabinde', 'Painter'),
    (38, 'Ilse van Wyk', 'Document Controller'),
    (39, 'Themba Radebe', 'Lift Technician'),
    (40, 'Nicole Daniels', 'Training Coordinator'),
    (41, 'Francois Marais', 'BMS Technician'),
    (42, 'Portia Mokoena', 'Call Centre Agent'),
    (43, 'Stefan Erasmus', 'Fire Systems Technician'),
    (44, 'Gugu Xaba', 'Warehouse Assistant'),
    (45, 'Daniel Mokoena', 'Aircon Installer'),
    (46, 'Heleen Vos', 'Executive Assistant'),
    (47, 'Vusi Mthembu', 'Grounds Technician'),
    (48, 'Claudia Ferreira', 'Buyer'),
    (49, 'Peter Oosthuizen', 'Senior Plumber'),
    (50, 'Zinhle Buthelezi', 'Service Administrator')
) AS names(n, full_name, job_title)
WHERE NOT EXISTS (
  SELECT 1 FROM public.employees e
  WHERE e.company_id = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890'
    AND e.employee_number = 'CFG-' || LPAD(names.n::text, 4, '0')
);

-- Sample leave requests
INSERT INTO public.leave_requests (company_id, employee_id, employee_name, leave_type, start_date, end_date, reason, status)
SELECT
  'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
  e.employee_number,
  e.first_name || ' ' || e.last_name,
  'annual_leave',
  CURRENT_DATE + 14,
  CURRENT_DATE + 18,
  'Family commitment',
  'pending'
FROM public.employees e
WHERE e.company_id = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890'
  AND e.employee_number IN ('CFG-0006', 'CFG-0015', 'CFG-0023')
  AND NOT EXISTS (
    SELECT 1 FROM public.leave_requests lr
    WHERE lr.company_id = e.company_id AND lr.employee_id = e.employee_number AND lr.status = 'pending'
  );

-- Field jobs (when field_jobs exists)
DO $demo$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'field_jobs') THEN
    INSERT INTO public.field_jobs (company_id, job_ref, title, status, site_type, customer_name, customer_address, priority)
    VALUES
      ('a1b2c3d4-e5f6-7890-abcd-ef1234567890', 'FJ-2026-0001', 'HVAC service — Sandton office park', 'Dispatched', 'customer_address', 'Nexus Properties', '1 Alice Lane, Sandton', 'high'),
      ('a1b2c3d4-e5f6-7890-abcd-ef1234567890', 'FJ-2026-0002', 'Generator inspection — Durban warehouse', 'Pending', 'customer_address', 'Coastal Logistics', '45 Brickfield Rd, Durban', 'normal'),
      ('a1b2c3d4-e5f6-7890-abcd-ef1234567890', 'FJ-2026-0003', 'Electrical compliance — Centurion plant', 'Completed', 'customer_address', 'Vertex Manufacturing', '12 John Vorster Dr, Centurion', 'urgent')
    ON CONFLICT (company_id, job_ref) DO NOTHING;
  END IF;
END
$demo$;

COMMIT;

NOTIFY pgrst, 'reload schema';

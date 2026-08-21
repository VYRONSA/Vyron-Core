-- 900-fixtures.sql
-- VYRON CORE — TEST-ONLY deterministic fixtures for the Road & Recovery harness (Phase 7).
--
-- ###########################################################################
-- # THIS FILE MUST NEVER BE RUN AGAINST A REAL SUPABASE PROJECT.            #
-- ###########################################################################
--
-- ---------------------------------------------------------------------------
-- DETERMINISM
-- ---------------------------------------------------------------------------
--
-- Every identifier below is a FIXED UUID, not a generated one. The Phase 0-6 runtime
-- suites reference these ids as constants, and a fixture that changed between runs would
-- make a failing test unreproducible — the single worst property a regression net can
-- have. Re-running this file is idempotent: it upserts, so a harness can re-seed without
-- tearing the database down.
--
-- The id scheme is deliberate and readable at a glance:
--
--   aaaaaaaa-…  Tenant A (Alpha Recovery)      bbbbbbbb-…  Tenant B (Bravo Recovery)
--   d0000000-…  employees                     40000000-…  vehicles
--   c0000000-…  counterparties                11110000-…  yards
--
-- ---------------------------------------------------------------------------
-- WHAT IS DELIBERATELY NOT HERE
-- ---------------------------------------------------------------------------
--
-- No service jobs. Jobs are created by the tests THROUGH THE SERVICE LAYER, so that job
-- creation, the state machine and the guards are all exercised rather than bypassed. A
-- fixture that INSERTed a job row directly would let a broken createServiceJob() pass.
--
-- No Road & Recovery configuration. The service catalogue, workflows, BYSTAND reasons,
-- requirement policies and rate cards all come from rr_provision_company(), which is the
-- same function a real customer is provisioned with. Seeding them by hand would mean the
-- harness never tested provisioning.
--
-- No demo data. sql/035 is excluded from the harness order for exactly this reason: a
-- deterministic environment cannot contain rows nobody declared.

-- ---------------------------------------------------------------------------
-- 0. Seed identity
-- ---------------------------------------------------------------------------
--
-- Seeding runs as the PLATFORM OPERATOR, which is who provisions a customer in
-- production. This is not a way around a guard — it is the guard working:
-- sql/060 refuses to let an unidentified connection create or re-assign a company user,
-- precisely so that a stray script cannot move somebody between tenants. The harness
-- therefore identifies itself rather than disabling the trigger, and the fact that it has
-- to is itself evidence the privilege-escalation hardening is live.
--
-- set_config(..., false) makes this a SESSION setting, so it survives the COMMIT below and
-- still applies to the provisioning calls at the end of the file.
SELECT set_config(
  'request.jwt.claims',
  '{"email":"info@vyronsoft.co.za","role":"service_role"}',
  false
);

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Tenants
-- ---------------------------------------------------------------------------
--
-- TWO tenants, always. Almost every security assertion in the suite is of the form
-- "Alpha must not see Bravo's row", and that assertion is vacuous with one tenant.
--
-- Bravo is a full Road & Recovery operator too, not an empty shell: a cross-tenant test
-- against a tenant with no data can pass simply because there was nothing to leak.
INSERT INTO public.companies (id, name, subscription_status, status, enabled_modules)
VALUES
  ('aaaaaaaa-0000-4000-8000-000000000001', 'Alpha Recovery', 'active', 'active',
   '["workforce", "field_operations", "road_recovery"]'::jsonb),
  ('bbbbbbbb-0000-4000-8000-000000000002', 'Bravo Recovery', 'active', 'active',
   '["workforce", "field_operations", "road_recovery"]'::jsonb)
ON CONFLICT (id) DO UPDATE
  SET name = EXCLUDED.name,
      status = EXCLUDED.status,
      enabled_modules = EXCLUDED.enabled_modules;

-- ---------------------------------------------------------------------------
-- 2. Users
-- ---------------------------------------------------------------------------
--
-- The tenant boundary is resolved from the JWT email through
-- public.vyron_user_company_ids(), so these rows ARE the identity model under test. A
-- membership that is not 'active' resolves to no companies, which is why status matters.
INSERT INTO public.company_users (id, company_id, user_email, role, status, first_name, last_name)
VALUES
  ('e0000000-0000-4000-8000-0000000000a1', 'aaaaaaaa-0000-4000-8000-000000000001',
   'controller@alpha.test', 'admin', 'active', 'Alpha', 'Controller'),
  ('e0000000-0000-4000-8000-0000000000a2', 'aaaaaaaa-0000-4000-8000-000000000001',
   'driver@alpha.test', 'user', 'active', 'Thandi', 'Nkosi'),
  ('e0000000-0000-4000-8000-0000000000b1', 'bbbbbbbb-0000-4000-8000-000000000002',
   'controller@bravo.test', 'admin', 'active', 'Bravo', 'Controller')
ON CONFLICT (id) DO UPDATE
  SET company_id = EXCLUDED.company_id,
      user_email = EXCLUDED.user_email,
      role = EXCLUDED.role,
      status = EXCLUDED.status;

-- ---------------------------------------------------------------------------
-- 3. Employees
-- ---------------------------------------------------------------------------
--
-- Four people, chosen so that dispatch eligibility can actually be tested:
--
--   THANDI          fully certified tow driver — the happy path
--   SIPHO           NO certification at all — must be ineligible
--   LERATO          EXPIRED certification    — must be ineligible for a DIFFERENT reason
--   CONTROLLER      office staff, never dispatched
--
-- Sipho and Lerato exist because "ineligible" has two distinct causes, and a dispatch
-- engine that conflates them would tell a manager to renew a licence that was never
-- issued.
INSERT INTO public.employees (id, company_id, employee_number, first_name, last_name, active)
VALUES
  ('d0000000-0000-4000-8000-00000000000a', 'aaaaaaaa-0000-4000-8000-000000000001',
   'EMP-001', 'Thandi', 'Nkosi', true),
  ('d0000000-0000-4000-8000-00000000000b', 'aaaaaaaa-0000-4000-8000-000000000001',
   'EMP-002', 'Sipho', 'Dlamini', true),
  ('d0000000-0000-4000-8000-00000000000c', 'aaaaaaaa-0000-4000-8000-000000000001',
   'EMP-003', 'Lerato', 'Molefe', true),
  ('d0000000-0000-4000-8000-00000000000d', 'aaaaaaaa-0000-4000-8000-000000000001',
   'EMP-004', 'Alpha', 'Controller', true),
  ('d0000000-0000-4000-8000-0000000000b1', 'bbbbbbbb-0000-4000-8000-000000000002',
   'EMP-B01', 'Bravo', 'Driver', true)
ON CONFLICT (id) DO UPDATE
  SET company_id = EXCLUDED.company_id,
      first_name = EXCLUDED.first_name,
      last_name = EXCLUDED.last_name,
      active = EXCLUDED.active;

-- ---------------------------------------------------------------------------
-- 4. Vehicles
-- ---------------------------------------------------------------------------
--
-- assigned_employee_id is what PAIRS a driver with a truck. The dispatch engine treats an
-- unpaired driver as having no vehicle, so without this every candidate is ineligible,
-- no candidate carries a distance, and distance-variance intelligence silently measures
-- nothing. Thandi drives the flatbed; the other two trucks are deliberately uncrewed.
INSERT INTO public.field_vehicles
  (id, company_id, registration, make_model, status, vehicle_type, assigned_employee_id)
VALUES
  ('40000000-0000-4000-8000-00000000000a', 'aaaaaaaa-0000-4000-8000-000000000001',
   'CA 123-456', 'Isuzu FTR Flatbed', 'available', 'heavy_commercial',
   'd0000000-0000-4000-8000-00000000000a'),
  ('40000000-0000-4000-8000-00000000000b', 'aaaaaaaa-0000-4000-8000-000000000001',
   'CA 234-567', 'Hino 500 Wrecker', 'maintenance', 'heavy_commercial', NULL),
  ('40000000-0000-4000-8000-00000000000c', 'aaaaaaaa-0000-4000-8000-000000000001',
   'CA 345-678', 'Toyota Hilux Light Tow', 'available', 'light_commercial', NULL),
  ('40000000-0000-4000-8000-0000000000b1', 'bbbbbbbb-0000-4000-8000-000000000002',
   'GP 999-111', 'MAN TGS Rotator', 'available', 'heavy_commercial',
   'd0000000-0000-4000-8000-0000000000b1')
ON CONFLICT (id) DO UPDATE
  SET company_id = EXCLUDED.company_id,
      registration = EXCLUDED.registration,
      status = EXCLUDED.status,
      assigned_employee_id = EXCLUDED.assigned_employee_id;

-- ---------------------------------------------------------------------------
-- 5. Tow truck profiles
-- ---------------------------------------------------------------------------
--
-- The depot is at Epping, DELIBERATELY not on the coordinates the fixtures use for a job
-- origin. A truck parked on top of the incident computes a dispatch distance of zero, and
-- a zero estimate can never produce a distance variance — which would silently disable
-- every distance-quality assertion in Phases 5 and 6.
--
--   FLATBED   available, operational, winch     — can take the work
--   WRECKER   out of service                    — capacity exists but is unavailable
--   LIGHT     available but light duty only     — available, but not CAPABLE of a heavy job
--
-- The third one is the important case: "no truck" and "no SUITABLE truck" are different
-- operational problems, and capability matching is what tells them apart.
INSERT INTO public.rr_tow_truck_profiles
  (id, company_id, field_vehicle_id, tow_class, gvm_kg, payload_capacity_kg, carries_count,
   has_winch, winch_capacity_kg, has_boom, has_underlift, has_dollies,
   availability_status, operational_status, base_label, base_latitude, base_longitude,
   current_latitude, current_longitude, location_updated_at)
VALUES
  ('40000000-0000-4000-8000-0000000000f1', 'aaaaaaaa-0000-4000-8000-000000000001',
   '40000000-0000-4000-8000-00000000000a', 'flatbed', 16000, 8000, 1,
   true, 5000, false, false, true,
   'available', 'operational', 'Epping Depot', -33.9350, 18.5450,
   -33.9350, 18.5450, now()),
  ('40000000-0000-4000-8000-0000000000f2', 'aaaaaaaa-0000-4000-8000-000000000001',
   '40000000-0000-4000-8000-00000000000b', 'wrecker', 26000, 14000, 1,
   true, 12000, true, true, true,
   'out_of_service', 'grounded', 'Epping Depot', -33.9350, 18.5450,
   -33.9350, 18.5450, now()),
  ('40000000-0000-4000-8000-0000000000f3', 'aaaaaaaa-0000-4000-8000-000000000001',
   '40000000-0000-4000-8000-00000000000c', 'light_duty', 3500, 1200, 1,
   false, NULL, false, false, false,
   'available', 'operational', 'Epping Depot', -33.9350, 18.5450,
   -33.9350, 18.5450, now()),
  ('40000000-0000-4000-8000-0000000000b2', 'bbbbbbbb-0000-4000-8000-000000000002',
   '40000000-0000-4000-8000-0000000000b1', 'rotator', 40000, 25000, 1,
   true, 20000, true, true, true,
   'available', 'operational', 'Johannesburg Depot', -26.2041, 28.0473,
   -26.2041, 28.0473, now())
ON CONFLICT (id) DO UPDATE
  SET availability_status = EXCLUDED.availability_status,
      operational_status = EXCLUDED.operational_status,
      location_updated_at = EXCLUDED.location_updated_at;

-- ---------------------------------------------------------------------------
-- 6. Driver certifications
-- ---------------------------------------------------------------------------
--
-- Dates are RELATIVE to now() on purpose. An absolute expiry date would silently stop
-- being "expired" or "expiring soon" as the calendar moved past it, and the certification
-- tests would quietly stop testing anything.
--
-- Sipho appears NOWHERE in this table: his ineligibility is the ABSENCE of a record, which
-- is a different code path from Lerato's expired one.
INSERT INTO public.rr_driver_certifications
  (id, company_id, employee_id, certification_type, identifier, issuing_authority,
   issued_at, expires_at, blocks_dispatch, status)
VALUES
  -- Thandi: valid, well clear of expiry.
  ('c1000000-0000-4000-8000-00000000000a', 'aaaaaaaa-0000-4000-8000-000000000001',
   'd0000000-0000-4000-8000-00000000000a', 'drivers_licence', 'DL-EC14-001', 'DoT',
   now() - interval '2 years', now() + interval '3 years', true, 'active'),
  ('c1000000-0000-4000-8000-00000000000b', 'aaaaaaaa-0000-4000-8000-000000000001',
   'd0000000-0000-4000-8000-00000000000a', 'prdp', 'PRDP-001', 'DoT',
   now() - interval '1 year', now() + interval '2 years', true, 'active'),
  ('c1000000-0000-4000-8000-00000000000c', 'aaaaaaaa-0000-4000-8000-000000000001',
   'd0000000-0000-4000-8000-00000000000a', 'recovery_competency', 'RC-001', 'RMI',
   now() - interval '1 year', now() + interval '2 years', false, 'active'),
  -- Lerato: licence EXPIRED. Dispatch-blocking, so she must be excluded.
  ('c1000000-0000-4000-8000-00000000000d', 'aaaaaaaa-0000-4000-8000-000000000001',
   'd0000000-0000-4000-8000-00000000000c', 'drivers_licence', 'DL-EC14-003', 'DoT',
   now() - interval '5 years', now() - interval '30 days', true, 'active'),
  -- Lerato: a NON-blocking certificate that is also expired, so the tests can prove the
  -- engine distinguishes "expired" from "expired AND blocking".
  ('c1000000-0000-4000-8000-00000000000e', 'aaaaaaaa-0000-4000-8000-000000000001',
   'd0000000-0000-4000-8000-00000000000c', 'first_aid', 'FA-003', 'St John',
   now() - interval '3 years', now() - interval '60 days', false, 'active'),
  ('c1000000-0000-4000-8000-0000000000b1', 'bbbbbbbb-0000-4000-8000-000000000002',
   'd0000000-0000-4000-8000-0000000000b1', 'drivers_licence', 'DL-GP-001', 'DoT',
   now() - interval '1 year', now() + interval '4 years', true, 'active')
ON CONFLICT (id) DO UPDATE
  SET expires_at = EXCLUDED.expires_at,
      status = EXCLUDED.status,
      blocks_dispatch = EXCLUDED.blocks_dispatch;

-- ---------------------------------------------------------------------------
-- 7. Counterparties
-- ---------------------------------------------------------------------------
--
-- Three types, because they behave differently: an assistance provider authorises per
-- job, an insurer authorises against a claim, and a fleet client works on standing terms.
INSERT INTO public.rr_counterparties
  (id, company_id, counterparty_code, counterparty_type, legal_name, trading_name,
   requires_authorisation, payment_terms_days, status)
VALUES
  ('c0000000-0000-4000-8000-00000000000a', 'aaaaaaaa-0000-4000-8000-000000000001',
   'AP-001', 'assistance_provider', 'National Roadside Assist (Pty) Ltd', 'National Assist',
   true, 30, 'active'),
  ('c0000000-0000-4000-8000-00000000000b', 'aaaaaaaa-0000-4000-8000-000000000001',
   'INS-001', 'insurer', 'Cape Mutual Insurance Limited', 'Cape Mutual',
   true, 45, 'active'),
  ('c0000000-0000-4000-8000-00000000000c', 'aaaaaaaa-0000-4000-8000-000000000001',
   'FL-001', 'fleet_client', 'Western Cape Logistics (Pty) Ltd', 'WC Logistics',
   false, 30, 'active'),
  ('c0000000-0000-4000-8000-0000000000b1', 'bbbbbbbb-0000-4000-8000-000000000002',
   'AP-B01', 'assistance_provider', 'Highveld Assist (Pty) Ltd', 'Highveld Assist',
   true, 30, 'active')
ON CONFLICT (id) DO UPDATE
  SET legal_name = EXCLUDED.legal_name,
      counterparty_type = EXCLUDED.counterparty_type,
      status = EXCLUDED.status;

-- ---------------------------------------------------------------------------
-- 8. Custody yards
-- ---------------------------------------------------------------------------
INSERT INTO public.rr_custody_yards
  (id, company_id, yard_code, name, address, latitude, longitude,
   security_level, covered, capacity, active)
VALUES
  ('11110000-0000-4000-8000-00000000aaaa', 'aaaaaaaa-0000-4000-8000-000000000001',
   'YARD-01', 'Alpha Main Yard', '14 Recovery Road, Epping, Cape Town', -33.9350, 18.5450,
   'secure', false, 120, true),
  ('11110000-0000-4000-8000-00000000aabb', 'aaaaaaaa-0000-4000-8000-000000000001',
   'YARD-02', 'Alpha Covered Store', '14 Recovery Road, Epping, Cape Town', -33.9351, 18.5451,
   'high_security', true, 20, true),
  ('11110000-0000-4000-8000-00000000bbbb', 'bbbbbbbb-0000-4000-8000-000000000002',
   'YARD-B1', 'Bravo Yard', '9 Tow Street, Germiston', -26.2200, 28.1700,
   'secure', false, 80, true)
ON CONFLICT (id) DO UPDATE
  SET name = EXCLUDED.name,
      active = EXCLUDED.active;

-- ---------------------------------------------------------------------------
-- 9. Public holiday calendar
-- ---------------------------------------------------------------------------
--
-- One known South African public holiday per tenant, so the after-hours and public-holiday
-- rate modifiers have something real to resolve against.
INSERT INTO public.leave_public_holidays (id, company_id, holiday_name, holiday_date, region, active)
VALUES
  ('9a000000-0000-4000-8000-00000000000a', 'aaaaaaaa-0000-4000-8000-000000000001',
   'Freedom Day', DATE '2026-04-27', 'ZA', true),
  ('9a000000-0000-4000-8000-00000000000b', 'aaaaaaaa-0000-4000-8000-000000000001',
   'Heritage Day', DATE '2026-09-24', 'ZA', true),
  ('9a000000-0000-4000-8000-0000000000b1', 'bbbbbbbb-0000-4000-8000-000000000002',
   'Freedom Day', DATE '2026-04-27', 'ZA', true)
ON CONFLICT (id) DO NOTHING;

COMMIT;

-- ---------------------------------------------------------------------------
-- 10. Road & Recovery provisioning
-- ---------------------------------------------------------------------------
--
-- Run OUTSIDE the fixture transaction and through the PRODUCTION function, so the harness
-- exercises the same provisioning path a real customer gets: service catalogue, workflow
-- definitions, BYSTAND reasons, requirement policies and rate cards.
--
-- Seeding those by hand would be faster and would mean provisioning was never tested.
SELECT public.rr_provision_company('aaaaaaaa-0000-4000-8000-000000000001');
SELECT public.rr_provision_company('bbbbbbbb-0000-4000-8000-000000000002');

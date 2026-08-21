-- 084-platform-hardening-completion.sql
-- VYRON CORE — Phase 8: closing the gaps sql/049 structurally cannot reach.
--
-- ---------------------------------------------------------------------------
-- WHY sql/049 MISSED THESE
-- ---------------------------------------------------------------------------
--
-- sql/049 hardens every table that has a `company_id` column. That is the right rule for
-- tenant data, and it is exactly why two things slipped past it:
--
--   public.companies and public.company_users are not company-SCOPED, they are the
--   company REGISTRY. `companies.id` IS the tenant, so neither table carries a
--   `company_id` column, and the hardening loop never visits them.
--
--   Views are not BASE TABLEs, so the loop never visits them either.
--
-- Neither omission is a fault in sql/049; both are consequences of a rule that is correct
-- for what it covers. They are closed here.
--
-- Found by `npm run verify:deployment`, which inspects the whole database rather than the
-- set of tables any one migration happens to iterate over.
--
-- Idempotent, non-destructive and safe to re-run. Requires sql/001 and sql/032.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. anon must hold nothing on the company registry
-- ---------------------------------------------------------------------------
--
-- sql/001 line 127 issued:
--
--     GRANT ALL ON public.companies TO anon, authenticated;
--     GRANT ALL ON public.company_users TO anon, authenticated;
--
-- from the original bootstrap, and nothing ever took it back. Row level security is
-- enabled on both tables with NO policy, which denies anon every SELECT, INSERT, UPDATE
-- and DELETE — so at first glance the grant looks harmless.
--
-- It is not. TRUNCATE IS NOT SUBJECT TO ROW LEVEL SECURITY. A role holding TRUNCATE can
-- empty the table regardless of any policy, and `anon` held it on the table that defines
-- every tenant in the system.
--
-- PostgREST cannot issue TRUNCATE, so this was not reachable through the API — but "not
-- currently reachable" is not the same as "not granted", and the grant had no reason to
-- exist. Unauthenticated callers reach company data through
-- public.vyron_get_company_access(), a SECURITY DEFINER function granted to anon
-- separately in sql/002; revoking the table grant does not touch that path.
DO $anon_registry$
BEGIN
  IF to_regclass('public.companies') IS NOT NULL THEN
    REVOKE ALL ON public.companies FROM anon;
  END IF;
  IF to_regclass('public.company_users') IS NOT NULL THEN
    REVOKE ALL ON public.company_users FROM anon;
  END IF;
END
$anon_registry$;

-- ---------------------------------------------------------------------------
-- 2. authenticated must not hold TRUNCATE on the registry either
-- ---------------------------------------------------------------------------
--
-- Same reasoning, one step further in. A signed-in user is constrained by RLS for every
-- row operation, and by nothing at all for TRUNCATE.
--
-- The other privileges are deliberately LEFT ALONE. The application reads
-- public.companies directly and falls back to the RPC when row level security refuses it
-- (see getAvailableCompaniesViaRpc), so narrowing SELECT here would change working
-- behaviour for no security gain — RLS already governs which rows come back.
DO $authenticated_registry$
BEGIN
  IF to_regclass('public.companies') IS NOT NULL THEN
    REVOKE TRUNCATE ON public.companies FROM authenticated;
  END IF;
  IF to_regclass('public.company_users') IS NOT NULL THEN
    REVOKE TRUNCATE ON public.company_users FROM authenticated;
  END IF;
END
$authenticated_registry$;

-- ---------------------------------------------------------------------------
-- 3. The compatibility views must be security_invoker
-- ---------------------------------------------------------------------------
--
-- sql/032 created three views that rename field_* tables to the names the specification
-- used: public.vehicles, public.trailers and public.assets. All three select company_id
-- and all three were created WITHOUT security_invoker.
--
-- A PostgreSQL view runs with its OWNER's privileges by default, so row level security on
-- field_vehicles, field_trailers and field_assets is evaluated as the owner — and any
-- caller who could read the view would receive EVERY tenant's rows. This is precisely the
-- defect Phase 5 shipped on rr_job_margin and Phase 6 fixed.
--
-- It is NOT currently exploitable: no grant was ever issued on these views, so neither
-- anon nor authenticated can read them at all. That is luck rather than design. One
-- `GRANT SELECT` by anyone extending the vehicle module would have turned a latent hole
-- into a live cross-tenant leak, with nothing in the schema to stop it.
--
-- The view DEFINITIONS are reproduced verbatim from sql/032. Only the security_invoker
-- option is added; not one column, name or expression is changed.
DO $compat_views$
BEGIN
  IF to_regclass('public.field_vehicles') IS NOT NULL AND to_regclass('public.vehicles') IS NOT NULL THEN
    EXECUTE $view$
      CREATE OR REPLACE VIEW public.vehicles
      WITH (security_invoker = true) AS
        SELECT
          id, company_id, registration, COALESCE(vehicle_name, make_model) AS vehicle_name,
          vehicle_type, vin, make, model, year, fuel_type, odometer_km AS current_odometer,
          assigned_employee_id AS assigned_driver, status, notes, created_at, updated_at
        FROM public.field_vehicles
    $view$;
  END IF;

  IF to_regclass('public.field_trailers') IS NOT NULL AND to_regclass('public.trailers') IS NOT NULL THEN
    EXECUTE $view$
      CREATE OR REPLACE VIEW public.trailers
      WITH (security_invoker = true) AS
        SELECT
          id, company_id, trailer_number, registration, trailer_type AS type,
          assigned_vehicle_id, status, notes, created_at, updated_at
        FROM public.field_trailers
    $view$;
  END IF;

  IF to_regclass('public.field_assets') IS NOT NULL AND to_regclass('public.assets') IS NOT NULL THEN
    EXECUTE $view$
      CREATE OR REPLACE VIEW public.assets
      WITH (security_invoker = true) AS
        SELECT
          id, company_id, COALESCE(asset_number, asset_code) AS asset_number,
          name AS asset_name, asset_type AS type, serial_number,
          assigned_employee_id, assigned_vehicle_id, current_site, status,
          notes, created_at, updated_at
        FROM public.field_assets
    $view$;
  END IF;
END
$compat_views$;

COMMIT;

NOTIFY pgrst, 'reload schema';

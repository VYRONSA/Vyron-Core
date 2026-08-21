-- 085-service-role-table-grants.sql
-- VYRON CORE — the server's own identity can read the tables the server reads.
--
-- ---------------------------------------------------------------------------
-- THE DEFECT
-- ---------------------------------------------------------------------------
--
-- On a database built from this repository, `service_role` holds NO table DML at all.
-- Of 200 public tables, exactly three grant it SELECT — public.employee_documents
-- (sql/009), public.vyron_platform_bootstrap (sql/066) and
-- public.vyron_platform_elevation_sessions (sql/067) — because those three are the only
-- migrations that ever named it.
--
-- Every other table got its grants from sql/001's
--
--     GRANT ALL ON public.companies TO anon, authenticated;
--
-- and from the equivalent lines in the migrations that followed, none of which include
-- `service_role`. Nothing revoked it; it was simply never granted. sql/083 records the
-- same observation in passing — "`service_role` was refused for want of a grant".
--
-- That was invisible for as long as every project was created by hand in the Supabase
-- dashboard, where the platform's own default privileges hand `service_role` full access
-- before a migration ever runs. Applied to a clean project, the repository produces a
-- database where the SERVER cannot read its own tables:
--
--     GET /api/company/users        -> 500 "permission denied for table company_users"
--     GET /api/tenant/modules       -> 500 "permission denied for table companies"
--
-- Users & Access, Platform Console customer management and customer provisioning all go
-- through lib/server-api-auth.ts's service-role client, and all of them fail. This is the
-- same class of gap as the tables sql/010 brought under migration control: production
-- works because of something that was done by hand and never written down.
--
-- ---------------------------------------------------------------------------
-- WHAT THIS GRANTS, AND WHY IT IS NOT A WIDENING
-- ---------------------------------------------------------------------------
--
-- `service_role` is given EXACTLY the privileges `authenticated` already holds on each
-- table, read from the catalogue rather than from a list kept here. Every least-privilege
-- decision sql/049 and sql/084 made therefore applies to the server identity too:
--
--   * an append-only table (rr_service_state_events, rr_custody_events, ...) grants
--     SELECT and INSERT, and no UPDATE or DELETE
--   * a non-deletable table (rr_authorisations, rr_storage_bookings, ...) grants
--     SELECT, INSERT and UPDATE, and no DELETE
--   * rr_custody_holdings grants SELECT only
--
-- TRUNCATE is never granted, so sql/049's "no TRUNCATE anywhere on rr_*" gate still
-- holds, and neither are REFERENCES or TRIGGER.
--
-- This does not weaken the immutability guarantees. Those are enforced by triggers bound
-- to the TABLE (sql/074, 076, 081, 083), which constrain every role including this one —
-- that is the entire argument sql/083 makes for using triggers rather than grants. It
-- makes the Phase 7 hardening suite STRONGER: its append-only and non-deletable
-- assertions run as `service_role`, and until now some of them were satisfied by a
-- missing grant rather than by the trigger they exist to prove.
--
-- `service_role` has BYPASSRLS, exactly as on Supabase, so grants are the only gate that
-- applies to it and this migration is what makes that gate real rather than absent.
--
-- Idempotent and safe to re-run. Must run AFTER sql/049 and sql/084, which is what its
-- number guarantees.

BEGIN;

DO $service_role_grants$
DECLARE
  tbl text;
  privs text;
BEGIN
  FOR tbl, privs IN
    SELECT
      g.table_name,
      string_agg(DISTINCT g.privilege_type, ', ' ORDER BY g.privilege_type)
    FROM information_schema.role_table_grants g
    JOIN information_schema.tables t
      ON t.table_schema = g.table_schema
     AND t.table_name = g.table_name
     AND t.table_type = 'BASE TABLE'
    WHERE g.table_schema = 'public'
      AND g.grantee = 'authenticated'
      -- Data privileges only. TRUNCATE, REFERENCES and TRIGGER are deliberately excluded.
      AND g.privilege_type IN ('SELECT', 'INSERT', 'UPDATE', 'DELETE')
    GROUP BY g.table_name
  LOOP
    EXECUTE format('GRANT %s ON public.%I TO service_role', privs, tbl);
  END LOOP;
END
$service_role_grants$;

-- Views are security_invoker (asserted by the Phase 7 gate), so reading one still runs
-- under the caller's own rights on the underlying tables. The grant is what makes the
-- view addressable at all.
DO $service_role_view_grants$
DECLARE
  rel text;
BEGIN
  FOR rel IN
    SELECT c.relname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind = 'v'
  LOOP
    EXECUTE format('GRANT SELECT ON public.%I TO service_role', rel);
  END LOOP;
END
$service_role_view_grants$;

-- Sequences backing any serial/identity column the server inserts into.
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO service_role;

/**
 * Tables created by migrations AFTER this one.
 *
 * Without this, the next migration that creates a table reintroduces exactly the defect
 * this file closes, and it would again be invisible until a server route failed in
 * production. A migration that adds an append-only table should narrow service_role the
 * same way sql/049 narrows `authenticated` — the default is the safe, useful baseline,
 * not a statement that every future table is freely writable.
 */
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO service_role;

ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO service_role;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- 000-supabase-compat.sql
-- VYRON CORE — TEST-ONLY Supabase compatibility layer (Phase 7).
--
-- ###########################################################################
-- # THIS FILE MUST NEVER BE RUN AGAINST A REAL SUPABASE PROJECT.            #
-- ###########################################################################
--
-- Supabase provides a set of primitives that a bare PostgreSQL cluster does not: the
-- `auth` schema, the `anon` / `authenticated` / `service_role` roles, and the JWT claim
-- plumbing that `auth.uid()` and `auth.jwt()` read. Production migrations depend on those
-- primitives and are RIGHT to — they are part of the platform VYRON CORE runs on.
--
-- This file recreates ONLY those primitives, so the production migrations can be applied
-- verbatim to a disposable cluster. It is a compatibility layer, not a substitute:
--
--   * It creates NO application table. Every one of those comes from sql/0NN.
--   * It changes NO production DDL. Migrations are applied exactly as they ship.
--   * It weakens NO security. The roles it creates have the same shape Supabase gives
--     them, and `anon` in particular is created with no privileges at all, so a test
--     that proves anon cannot read a table is proving something real.
--
-- If a future migration needs another Supabase primitive, add it HERE with a comment
-- saying which migration needs it and why. Never edit the migration to avoid it: the
-- point of this harness is that the SQL we test is the SQL we deploy.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Extensions
-- ---------------------------------------------------------------------------
-- Supabase enables these by default. sql/001 onward assume gen_random_uuid().
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------------------------------------------------------------------------
-- 2. Roles
-- ---------------------------------------------------------------------------
--
-- Supabase ships three roles that every RLS policy and GRANT in this repository refers
-- to. They are created NOLOGIN because the harness reaches them with SET LOCAL ROLE, the
-- same way PostgREST does after authenticating a request.
--
-- anon deliberately receives NOTHING beyond USAGE on the schema. Several tests assert
-- that anon cannot read a Road & Recovery table; if anon were over-granted here those
-- tests would pass for the wrong reason and the assertion would be worthless.
DO $roles$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    CREATE ROLE anon NOLOGIN NOINHERIT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated NOLOGIN NOINHERIT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    -- BYPASSRLS matches Supabase: the service key is trusted and skips row level
    -- security entirely. This is precisely why Road & Recovery guards immutability with
    -- TRIGGERS bound to the table rather than with grants alone, and the immutability
    -- tests exercise service_role specifically to prove those triggers hold.
    CREATE ROLE service_role NOLOGIN NOINHERIT BYPASSRLS;
  END IF;
END
$roles$;

GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. The auth schema
-- ---------------------------------------------------------------------------
--
-- Needed by sql/030, which resolves the tenant boundary from the caller's JWT:
--
--     public.vyron_user_company_ids()  ->  auth.jwt() ->> 'email'
--     public.vyron_is_platform_operator() -> auth.jwt() ->> 'email'
--
-- The real Supabase implementations read the same GUC this one does, so a policy that
-- passes here behaves identically in production.
CREATE SCHEMA IF NOT EXISTS auth;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;

/**
 * The request's JWT claims.
 *
 * The harness sets request.jwt.claims with set_config(..., true), which scopes it to the
 * transaction — exactly what PostgREST does per request. An unset or unparseable value
 * yields an empty object rather than an error, so a query made with no identity resolves
 * to "no companies" instead of failing, which is the safe direction.
 */
CREATE OR REPLACE FUNCTION auth.jwt()
RETURNS jsonb
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE(
    NULLIF(current_setting('request.jwt.claims', true), '')::jsonb,
    '{}'::jsonb
  );
$$;

/** The authenticated user id, when the claims carry one. */
CREATE OR REPLACE FUNCTION auth.uid()
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
  SELECT NULLIF(auth.jwt() ->> 'sub', '')::uuid;
$$;

/** The role named in the claims, defaulting to the PostgreSQL role in effect. */
CREATE OR REPLACE FUNCTION auth.role()
RETURNS text
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE(NULLIF(auth.jwt() ->> 'role', ''), current_user::text);
$$;

/** The email in the claims. Some migrations read it directly. */
CREATE OR REPLACE FUNCTION auth.email()
RETURNS text
LANGUAGE sql
STABLE
AS $$
  SELECT NULLIF(auth.jwt() ->> 'email', '');
$$;

GRANT EXECUTE ON FUNCTION auth.jwt(), auth.uid(), auth.role(), auth.email()
  TO anon, authenticated, service_role;

/**
 * auth.users — the identity table Supabase Auth owns.
 *
 * Only the columns this repository actually reads are present. It exists so that a
 * migration declaring a foreign key to auth.users can be applied verbatim; nothing in
 * the Road & Recovery test suite authenticates through it.
 */
CREATE TABLE IF NOT EXISTS auth.users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text UNIQUE,
  raw_user_meta_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  banned_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- 4. The storage schema
-- ---------------------------------------------------------------------------
--
-- Evidence files live in Supabase Storage. Road & Recovery records only the OBJECT PATH
-- against a job, never the bytes, so the tests never touch storage — but a migration that
-- references storage.objects must still be applicable.
CREATE SCHEMA IF NOT EXISTS storage;
GRANT USAGE ON SCHEMA storage TO anon, authenticated, service_role;

CREATE TABLE IF NOT EXISTS storage.buckets (
  id text PRIMARY KEY,
  name text NOT NULL,
  public boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS storage.objects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bucket_id text REFERENCES storage.buckets (id) ON DELETE CASCADE,
  name text,
  owner uuid,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMIT;

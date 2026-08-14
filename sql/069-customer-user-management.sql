-- 069-customer-user-management.sql
-- VYRON CORE — customer (tenant) user management foundation.
--
-- WHAT THIS ADDS
--
-- 1. public.companies.demo_started_at
--    sql/008-demo-tier-timestamp.sql was documented as "optional" in
--    sql/RUN_COMPANY_TABLES.md and was therefore never applied to several projects.
--    It is NOT optional: app/_app-shell.tsx selects demo_started_at in the company
--    directory query (COMPANIES_DIRECTORY_BASE_*), reads it for the 30-day Demo
--    window, and writes it when the Demo tier is toggled. A project without the
--    column fails that query outright, which is the
--        "column companies.demo_started_at does not exist"
--    banner in the client directory. The column belongs to the current architecture,
--    so the correct fix is the migration, not removing the dependency.
--
-- 2. Profile, lifecycle and access columns on public.company_users.
--    Customer administrators manage users from Settings -> Users & Access. That needs
--    a name, a mobile number, a soft-delete marker and per-user module/permission
--    grants. Passwords are NOT stored here (nor anywhere in public) — they live only
--    in Supabase Auth and are set through auth.admin.createUser /
--    auth.admin.updateUserById on the server.
--
-- 3. A duplicate-membership guard so retried provisioning cannot create two seats for
--    the same person in the same company.
--
-- Backwards compatible: every statement is ADD COLUMN IF NOT EXISTS / CREATE ... IF
-- NOT EXISTS. Existing companies, company_users, roles, subscriptions and module
-- access are untouched. No data is deleted.
--
-- Idempotent. Run after sql/068.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Demo tier timestamp (folds in sql/008 for projects that skipped it)
-- ---------------------------------------------------------------------------
ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS demo_started_at timestamptz;

COMMENT ON COLUMN public.companies.demo_started_at IS
  'Start of the 30-day unlimited Demo window. Required by the client directory query in app/_app-shell.tsx (originally sql/008).';

-- ---------------------------------------------------------------------------
-- 2. company_users — profile fields
-- ---------------------------------------------------------------------------
ALTER TABLE public.company_users
  ADD COLUMN IF NOT EXISTS first_name text;

ALTER TABLE public.company_users
  ADD COLUMN IF NOT EXISTS last_name text;

ALTER TABLE public.company_users
  ADD COLUMN IF NOT EXISTS mobile text;

-- ---------------------------------------------------------------------------
-- 3. company_users — lifecycle
-- ---------------------------------------------------------------------------

-- Soft delete. Membership rows are never destroyed: audit history, created_by
-- references and business records written by the user must survive removal of access.
ALTER TABLE public.company_users
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

ALTER TABLE public.company_users
  ADD COLUMN IF NOT EXISTS deactivated_at timestamptz;

ALTER TABLE public.company_users
  ADD COLUMN IF NOT EXISTS updated_at timestamptz;

ALTER TABLE public.company_users
  ADD COLUMN IF NOT EXISTS created_by text;

ALTER TABLE public.company_users
  ADD COLUMN IF NOT EXISTS invited_at timestamptz;

-- Set when an administrator issues a temporary password. The application surfaces it
-- so the user is told to change the credential; it is a flag, never a password.
ALTER TABLE public.company_users
  ADD COLUMN IF NOT EXISTS must_change_password boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.company_users.must_change_password IS
  'True after an administrator sets a temporary password. Never stores the password itself.';

-- ---------------------------------------------------------------------------
-- 4. company_users — per-user module + permission grants
-- ---------------------------------------------------------------------------

-- NULL = inherit every module the company subscription enables (companies.enabled_modules).
-- A non-null array is always intersected with companies.enabled_modules at read time, so
-- downgrading a subscription can never leave a user holding a module the company lost.
ALTER TABLE public.company_users
  ADD COLUMN IF NOT EXISTS module_access text[];

COMMENT ON COLUMN public.company_users.module_access IS
  'Per-user module codes. NULL inherits companies.enabled_modules. Always intersected with the company subscription server-side.';

-- { "<module_code>": ["view","create","edit","approve","delete","export","admin"] }
ALTER TABLE public.company_users
  ADD COLUMN IF NOT EXISTS module_permissions jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.company_users.module_permissions IS
  'Per-module permission levels. Empty object means the role default applies.';

-- ---------------------------------------------------------------------------
-- 5. Indexes
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_company_users_company_status
  ON public.company_users (company_id, status);

CREATE INDEX IF NOT EXISTS idx_company_users_deleted_at
  ON public.company_users (deleted_at);

CREATE INDEX IF NOT EXISTS idx_company_users_user_id
  ON public.company_users (user_id);

-- ---------------------------------------------------------------------------
-- 6. Duplicate-membership guard
-- ---------------------------------------------------------------------------
--
-- Provisioning is retried in practice (a failed admin invite, a re-run wizard). Without
-- a uniqueness guarantee each retry can add a second seat for the same person, which
-- then makes "which role does this user have?" ambiguous.
--
-- Deliberately NON-destructive: if a project already contains duplicates, the index is
-- skipped with a notice rather than deleting rows to force it through. Operators can
-- reconcile duplicates from Platform Console -> Customer -> Users and re-run this file.
DO $dupe_guard$
DECLARE
  duplicate_count integer;
BEGIN
  SELECT count(*) INTO duplicate_count
  FROM (
    SELECT company_id, lower(trim(user_email)) AS email_key
    FROM public.company_users
    WHERE user_email IS NOT NULL
      AND deleted_at IS NULL
    GROUP BY 1, 2
    HAVING count(*) > 1
  ) AS dupes;

  IF duplicate_count > 0 THEN
    RAISE NOTICE
      'Skipping company_users unique membership index: % duplicate (company_id, email) group(s) exist. Reconcile them, then re-run sql/069.',
      duplicate_count;
  ELSE
    CREATE UNIQUE INDEX IF NOT EXISTS company_users_company_email_unique
      ON public.company_users (company_id, lower(trim(user_email)))
      WHERE user_email IS NOT NULL AND deleted_at IS NULL;
  END IF;
END
$dupe_guard$;

-- ---------------------------------------------------------------------------
-- 7. Backfill
-- ---------------------------------------------------------------------------
-- Existing rows get an updated_at so the UI has something to sort on. Nothing else is
-- rewritten: roles, statuses and emails are left exactly as they are.
UPDATE public.company_users
SET updated_at = COALESCE(updated_at, created_at, now())
WHERE updated_at IS NULL;

COMMIT;

NOTIFY pgrst, 'reload schema';

# Migrations

Platform Console adds five files to the existing flat `sql/NNN-*.sql` sequence
(last pre-existing was `061-session-security-hardening.sql`):

1. **`sql/062-platform-console-foundation.sql`** — `subscription_plans`,
   `solution_templates` (seeded), extended `companies` columns (profile, licence,
   billing, `customer_status`), RLS for the two new tables.
2. **`sql/063-platform-console-expansion.sql`** — soft-delete (`deleted_at`) +
   subscription-engine fields on `companies`, Marketplace template metadata
   (permissions/workflows/widgets/AI assistants), `platform_modules` (seeded),
   `platform_feature_flags`, `platform_settings` (seeded), `platform_announcements`,
   `platform_release_notes`, `platform_support_notes`,
   `platform_impersonation_sessions`, `platform_job_queue`.
3. **`sql/064-platform-console-production-polish.sql`** — maintenance-mode RPCs
   (`vyron_get_maintenance_mode`, `vyron_validate_maintenance_override`), expanded
   `platform_settings` (dynamic defaults, support contact, notification
   thresholds/preferences), supporting indexes.
4. **`sql/065-maintenance-override-audit.sql`** — `vyron_log_maintenance_override_attempt`,
   auditing every emergency maintenance-mode override attempt.
5. **`sql/066-platform-operator-bootstrap.sql`** — one-time first-operator
   bootstrap: the `vyron_platform_bootstrap` single-row latch,
   `vyron_app_meta_has_operator_claim`, and the SQL bootstrap path
   `vyron_bootstrap_platform_operator(text)`. See
   [first-operator-bootstrap.md](first-operator-bootstrap.md).

## Running them

Same process as every other migration in this repo (see
`sql/RUN_COMPANY_TABLES.md` / `sql/MIGRATION_MANIFEST.md`): paste each file into
the Supabase SQL editor for the **production** project
(`ldnrmgafsquzfitcuvxq` — see `ACTIVE_SUPABASE.md`), in order, after confirming
`sql/001`–`061` are already applied. Each file is idempotent (`IF NOT EXISTS`,
`DROP POLICY IF EXISTS … CREATE POLICY`, guarded `DO $$` blocks with prerequisite
checks) and ends with `NOTIFY pgrst, 'reload schema'`.

**Do not deploy the application code for a given migration ahead of running that
migration** — several routes (e.g. anything reading `companies.customer_status`)
will 400 against a schema that doesn't have the column yet. This matches the
existing convention throughout `sql/*.sql` — code and schema are deployed as a
pair, not code-first.

## Manifest entry

`sql/MIGRATION_MANIFEST.md` has one row per file above (dependencies, what each
creates/alters, idempotency) — keep it updated if you add a `sql/067+`.

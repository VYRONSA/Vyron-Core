# Deployment

Platform Console ships as part of the regular VYRON CORE Next.js app — no
separate deploy target. Standard flow:

1. Run any new `sql/0NN-*.sql` migrations against the production Supabase project
   **before** the corresponding app code goes live (see `migrations.md`).
2. `npm run build` locally (or let Vercel build) — must complete with zero
   TypeScript errors (`npx tsc --noEmit` is a useful faster pre-check).
3. Deploy via the existing Vercel project — no new environment variables are
   required; `SUPABASE_SERVICE_ROLE_KEY` (already documented in `.env.example`)
   is the only credential the Platform Console's admin-client operations need,
   and it was already required for the pre-existing "Platform Control → resend
   client invites" flow.
4. Post-deploy smoke test (see `operator-guide.md`'s stabilization checklist):
   confirm `/platform` redirects a non-operator to `/dashboard`, and an
   `app_metadata.role = platform_operator` account can reach it.

## Rollback

Since schema changes are additive (new columns/tables, no destructive `ALTER`/
`DROP`), rolling back the application code alone is safe — the extra columns/
tables are simply unused by older code. Rolling back the schema itself is not
scripted (no down-migrations in this repo's convention) — restore from a Supabase
point-in-time backup if a schema rollback is ever genuinely required.

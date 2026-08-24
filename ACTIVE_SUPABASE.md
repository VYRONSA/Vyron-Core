# VYRON CORE ACTIVE SUPABASE

**The authoritative VYRON CORE production project is `gpiqkwebizuqajgaoxhm`.**

**Do not use or revert to the deprecated projects `ujgnhcwertihoqjgaofn` or
`ldnrmgafsquzfitcuvxq`.** `ldnrmgafsquzfitcuvxq` **no longer exists** — it is absent from
the account's project list. Any configuration still pointing at it will fail outright.

> Corrected 2026-08-23 (Phase 9E). An earlier revision of this file named
> `ldnrmgafsquzfitcuvxq` as production and listed `gpiqkwebizuqajgaoxhm` as deprecated.
> That was exactly backwards and is the reason this file is the first thing to trust here.

## Production coordinates (current)

| Field | Value |
|-------|--------|
| **Project Name** | vyron-core |
| **Project Ref** | `gpiqkwebizuqajgaoxhm` |
| **Project URL** | `https://gpiqkwebizuqajgaoxhm.supabase.co` |
| **Host** | `gpiqkwebizuqajgaoxhm.supabase.co` |
| **Organisation** | BASE2GVS's Org (`rgbpukqwbiaxsbimripz`) |
| **Region** | `eu-west-1` |
| **Postgres** | 17.6.1.111 |

## Environment variables

| Variable | Value / notes |
|----------|----------------|
| `NEXT_PUBLIC_SUPABASE_URL` | `https://gpiqkwebizuqajgaoxhm.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Publishable key from the **same** project (`gpiqkwebizuqajgaoxhm`). Set in Vercel → Production and local `.env.local` only — never commit. |
| `SUPABASE_SERVICE_ROLE_KEY` | Secret key from the **same** project. Server-side only. |
| `SUPABASE_SECRET_KEY` | Secret key from the **same** project. Server-side only. |

### Important

- `NEXT_PUBLIC_SUPABASE_URL` must be exactly `https://gpiqkwebizuqajgaoxhm.supabase.co`
- Do **not** include `/rest/v1/` in the URL value
- Do **not** prefix with `URL=` inside the value
- Every key must come from the **same** project ref as the URL
- Vercel hides saved env values after save; if unsure, copy fresh values from
  Supabase → Project Settings → API and overwrite

## Where secrets live

- **Vercel:** Project → Settings → Environment Variables → Production
- **Local dev:** `.env.local` (gitignored)
- **Templates:** `.env.production.example`, `.env.example` (placeholders only)

## Security baseline (as of 2026-08-23, Phases 9A–9D)

The production database has been hardened. Do not undo any of it:

- `sql/090-production-anon-lockdown.sql` — `anon` holds **zero** table and **zero**
  function privileges. 104 permissive dev/demo policies removed.
- `sql/091-phase9c-tenant-linkage-and-access-restoration.sql` — tenant policies restored
  on six relations, three `USING (true)` bypasses closed, `leave_balances_live` set to
  `security_invoker`.
- `sql/092-phase9d-storage-isolation-and-least-privilege.sql` — storage tenant isolation,
  `TRUNCATE` revoked from `authenticated` everywhere, `DELETE` retained on only
  `employees`, `employee_documents`, `field_jobs`.

Each has a matching `*-rollback-*.sql`. Rolling any of them back reopens a proven
cross-tenant exposure — do not run them casually.

## Schema state

Production is a **legacy, manually-built schema**. It has **not** executed the numbered
migrations in `sql/`. See `audit/baselines/` for the formal baseline record and
`audit/schema-snapshots/` for point-in-time snapshots. Do not assume any migration number
has run.

## Verify after deploy

`GET /api/vyron/health` should report `supabaseHost: "gpiqkwebizuqajgaoxhm.supabase.co"`
and `supabaseConfigOk: true`.

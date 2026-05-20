================================================================================
  DO NOT PASTE THIS FILE INTO THE SUPABASE SQL EDITOR
================================================================================

This file is INSTRUCTIONS ONLY (Markdown). It is NOT SQL.

If you paste this file, Supabase shows:
  ERROR: 42601: syntax error at or near "#"

--------------------------------------------------------------------------------
  PASTE THIS FILE INSTEAD (open in repo, Ctrl+A, copy, paste in SQL editor):
--------------------------------------------------------------------------------

    sql/PASTE_THIS_IN_SUPABASE.sql

  (Same script as sql/000-run-all-companies.sql — use either .sql filename.)

Do NOT paste: RUN_COMPANY_TABLES.md, INSTRUCTIONS.txt, or any file that starts
with a # character or prose paragraphs.

================================================================================

Company tables setup — instructions only
==========================================

What to run (in order)
----------------------

| Step | File | Purpose |
|------|------|---------|
| **A (recommended)** | `sql/PASTE_THIS_IN_SUPABASE.sql` or `sql/000-run-all-companies.sql` | **One paste** — tables + RPC + seed + schema reload |
| 1 | `sql/001-create-companies-tables.sql` | Creates `companies` and `company_users`, RLS dev policies, indexes |
| 2 | `sql/002-fix-company-access-rpc.sql` | Demo seed row, `vyron_get_company_access()` + `vyron_provision_company()` RPCs, PostgREST reload |
| **4 (minimal RPC)** | `sql/004-provision-rpc-only.sql` | **Only** `vyron_provision_company` — use if 000/002 failed after tables, or PGRST202 on provision only |
| **5 (verify)** | `sql/005-verify-companies-api.sql` | Read-only checks in Postgres (tables, RPCs, counts) — does **not** fix API exposure |
| **7 (optional)** | `sql/007-client-profile-columns.sql` | Adds `contact_person`, `phone`, `physical_address` on `companies` for Client Setup / Company Setup |
| **8 (optional)** | `sql/008-demo-tier-timestamp.sql` | Adds `demo_started_at` on `companies` for the 30-day unlimited **Demo** tier (Client Setup / directory / expiry guard) |
| **9 (optional)** | `sql/009-employee-documents.sql` | Creates `public.employee_documents` for Contract Centre / HR file uploads (fixes PGRST205 schema-cache banner on dashboard load) |
| 3 | — | Hard-refresh the app (or sign out and back in) |

Use **either** step A **or** steps 1–2 (not both required). All scripts are **idempotent** (safe to re-run).

Optional: if login or Client Setup still fails with **PGRST202** (RPC not in schema cache), run `sql/003-confirm-and-repair-company-access-rpc.sql` or `sql/004-provision-rpc-only.sql` after setup (re-applies RPCs + reload).

Yes, Client Setup works when…
-------------------------------

| Check | You should see |
|-------|----------------|
| Same project | `NEXT_PUBLIC_SUPABASE_URL` host matches dashboard **Project URL** |
| Tables in Postgres | Table Editor → `public.companies`, `public.company_users` |
| API sees tables | Verification query below returns both tables **and** both RPCs |
| `public` exposed | **Settings → API → Exposed schemas** includes `public` |
| After SQL | Wait ~30s (or re-run script for `NOTIFY pgrst`), then hard-refresh the app |

**Client Setup provision** uses **REST insert** into `companies` whenever the API can read that table (success never mentions RPC). If REST cannot see the table, the app shows **expose `public` / run 000** first, then tries RPC only after REST **PGRST205**. **PGRST202** appears only as optional secondary detail when both REST and RPC fallback fail — fix exposure and cache before running **004**.

Verification query (run after any setup script)
-----------------------------------------------

Paste in the SQL editor. Expect **2 tables** and **2 functions** (or at least `vyron_provision_company` if you only ran 004):

```sql
-- Tables
SELECT 'table' AS kind, table_name AS name
FROM information_schema.tables
WHERE table_schema = 'public' AND table_name IN ('companies', 'company_users')
UNION ALL
-- RPCs
SELECT 'rpc' AS kind, p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' AS name
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN ('vyron_get_company_access', 'vyron_provision_company')
ORDER BY kind, name;
```

Expected rows include:

- `table` → `companies`, `company_users`
- `rpc` → `vyron_get_company_access()`, `vyron_provision_company(p_name text, p_subscription_status text)`

Verification checklist (if the app still shows PGRST205)
--------------------------------------------------------

1. **Same Supabase project**
   - Dashboard → **Project Settings → API** → copy **Project URL**.
   - Compare with `NEXT_PUBLIC_SUPABASE_URL` in `.env.local` (see `.env.example`). Host must match exactly.

2. **Tables exist in Postgres**
   - **Table Editor** → schema `public` → confirm **`companies`** and **`company_users`**.
   - Or run in SQL editor:
     ```sql
     SELECT table_name FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name IN ('companies', 'company_users');
     ```

3. **API exposes the `public` schema** (cannot be fixed from SQL or app code)
   - Open **[Project Settings → API](https://supabase.com/dashboard/project/_/settings/api)** (replace `_` with your project ref from the dashboard URL, e.g. `abcdefghijklmnop`).
   - Confirm **Data API** is enabled (if disabled, PostgREST uses a placeholder schema and REST calls fail).
   - Find **Exposed schemas** (sometimes labeled **Schema** under the Data API section).
   - The field is a **comma-separated** list (e.g. `public, storage, graphql_public`). Default new projects include **`public`**.
   - If the list is **empty** or **`public` is missing**, type `public` (or add `, public` to existing entries), click **Save**, wait ~30 seconds, then hard-refresh the app.
   - **PGRST205** alone usually means “table not in schema cache” (missing DDL or stale cache), **not** exposure — only show the “public schema not exposed” app message when the API error mentions exposure or **PGRST106**.

4. **PostgREST schema cache**
   - Scripts end with `NOTIFY pgrst, 'reload schema'`.
   - If the app still errors, run `sql/002-fix-company-access-rpc.sql` or `sql/000-run-all-companies.sql` again, wait ~30s, hard-refresh.

5. **Quick REST smoke test** (optional)
   - Replace `URL` and `ANON_KEY` from your project:
     ```bash
     curl "URL/rest/v1/companies?select=id&limit=1" -H "apikey: ANON_KEY" -H "Authorization: Bearer ANON_KEY"
     ```
   - **200** with `[]` or a row → API sees the table.
   - **PGRST205** → table not in API schema (exposure, wrong project, or cache).

Step-by-step (Supabase SQL editor)
----------------------------------

Option A — single file (fastest)
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

1. Open **`sql/PASTE_THIS_IN_SUPABASE.sql`** (or `sql/000-run-all-companies.sql`) in your repo.
2. Select **all** contents (`Ctrl+A` / `Cmd+A`) and copy.
3. In Supabase: **SQL** → **New query** → paste → **Run**.
4. Confirm success (no errors in the results panel).
5. Complete the verification checklist above.
6. Hard-refresh the web app.

Option B — two files (same as before)
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

For **each** script, do this separately (run step 1 completely before step 2):

1. Open **`sql/001-create-companies-tables.sql`** (not this instructions file).
2. Copy all contents → Supabase **SQL** → **New query** → **Run**.
3. Repeat for **`sql/002-fix-company-access-rpc.sql`**.
4. Complete the verification checklist.
5. Hard-refresh the web app.

You usually **do not** need to drop tables first. If a very old partial schema cannot migrate (e.g. broken FK), drop `company_users` then `companies`, then run setup again.

Troubleshooting
---------------

Combined provision error (PGRST202 + “expose public” / REST retried)
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

If Client Setup shows a message like **“Supabase API cannot see company tables (PGRST205)”** with a trailing note about **optional RPC fallback (PGRST202)** or **expose public**:

| Order | Action | Why |
|-------|--------|-----|
| **1** | **Settings → API → Exposed schemas** — ensure `public` is listed, **Save**, wait ~30s | Tables in Table Editor do not help until PostgREST exposes `public` |
| **2** | Confirm **same project** as `NEXT_PUBLIC_SUPABASE_URL` in `.env.local` | SQL on project A + app on project B looks like “tables exist but API cannot see” |
| **3** | Run **`sql/PASTE_THIS_IN_SUPABASE.sql`** or **`sql/000-run-all-companies.sql`**, wait ~30s, hard-refresh | Creates tables + reloads PostgREST cache |
| **4** | Run **`sql/005-verify-companies-api.sql`** in SQL editor | Confirms Postgres side (tables/RPCs); if rows missing, re-run step 3 |
| **5** | Only if steps 1–4 done and REST still fails: **`sql/004-provision-rpc-only.sql`** | Optional SECURITY DEFINER fallback; not the primary fix |

REST smoke test (should return **200** with `[]` or a row before caring about PGRST202):

```bash
curl "URL/rest/v1/companies?select=id&limit=1" -H "apikey: ANON_KEY" -H "Authorization: Bearer ANON_KEY"
```

Verify tables exist (Table Editor)
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

1. Supabase dashboard → **Table Editor**.
2. Confirm **`companies`** and **`company_users`** appear under `public`.
3. If they are missing, run `sql/PASTE_THIS_IN_SUPABASE.sql` (or 001 then 002) and check the SQL results panel for errors.

App still says company tables missing / PGRST205
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

| Symptom | Likely cause | Fix |
|---------|----------------|-----|
| Tables visible in Table Editor, app still PGRST205 | `public` not in **Exposed schemas**, or wrong `.env.local` project | Expose `public`; align URL with dashboard |
| SQL ran on project A, app uses project B | Mismatched `NEXT_PUBLIC_SUPABASE_URL` | Run SQL on the project the app uses |
| Just ran SQL, error clears after ~30s | PostgREST cache lag | Wait, re-run 002/000, hard-refresh |
| `[42501] permission denied` or JWT **401** | RLS/grants — **not** missing tables or exposure | Re-run `sql/001` or `000`; share full error |
| App says “public schema not exposed” but curl returns **200** `[]` | False alarm / wrong project in `.env.local` | Align `NEXT_PUBLIC_SUPABASE_URL`; ignore exposure message — tables are exposed |
| **PGRST202** on `vyron_provision_company` | RPC missing from cache | Run **000** / **002** / **004** — different from exposure |

The app retries PGRST205/PGRST202 briefly and can fall back to RPCs (`vyron_get_company_access`, `vyron_provision_company`) when tables exist in Postgres but REST table routes are stale.

PGRST202 — RPC not in schema cache (`vyron_provision_company`, etc.)
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

| Symptom | Likely cause | Fix |
|---------|----------------|-----|
| `Could not find the function public.vyron_provision_company(p_name, p_subscription_status)` | Only **001** ran (tables, no RPCs), or SQL never run on this project | Run **`sql/000-run-all-companies.sql`**, **`sql/002-fix-company-access-rpc.sql`**, or **`sql/004-provision-rpc-only.sql`**, wait ~30s, hard-refresh |
| Tables visible in Table Editor, app shows PGRST202 on provision | REST still PGRST205 (cache/exposure); RPC also missing or stale | **Expose `public` first**; run **000**; wait ~30s; **004** only if REST still blocked |
| App mentions PGRST202 **and** PGRST205 / expose public in one message | Both REST and RPC fallback failed | Follow combined-error table above (expose → 000 → 005 → 004) |
| Tables exist, REST insert works, provision still errors | Rare cache lag | Re-run 002/000 or `sql/003-confirm-and-repair-company-access-rpc.sql` |
| Ran **003** on an old copy before it included `vyron_provision_company` | Repair script was access-only | Re-run current **003**, **004**, or **000** |

Verify RPCs in SQL editor:

```sql
SELECT proname, pg_get_function_identity_arguments(oid)
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND proname IN ('vyron_get_company_access', 'vyron_provision_company');
```

Expect `vyron_provision_company(p_name text, p_subscription_status text)`.

Logged in as `info@vyronsoft.co.za`
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

| Area | Needs SQL / exposed `public`? |
|------|-------------------------------|
| **Login / Command Centre** | **No** — master operator bypasses company table lookups |
| **Client Setup → Provision** | **Yes** for direct REST insert when API sees `companies`; RPC only if REST returns PGRST205. PGRST202 → run **002/000/004**. If both paths fail, provision shows an error with setup hints (no fake success). |

Other users (not master email)
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

- They need a row in **`company_users`** with `status = 'active'` and matching `user_email`, linked to a **`companies`** row.
- Demo seed in **002** adds `info@vyronsoft.co.za` to the demo company; add other emails manually or via Company Setup.

Wrong file pasted
~~~~~~~~~~~~~~~~~

| Symptom | Cause |
|---------|--------|
| `syntax error at or near "#"` | Pasted this instructions file (or any Markdown) instead of `.sql` |
| `relation already exists` on re-run | Usually safe to ignore with `IF NOT EXISTS` scripts; read the full error |

Expose ``public`` to the Data API (dashboard only)
--------------------------------------------------

This step **cannot** be done from SQL, migrations, or application code. A project owner must change it in the Supabase Dashboard.

1. Sign in at [supabase.com/dashboard](https://supabase.com/dashboard) and open the **same project** as ``NEXT_PUBLIC_SUPABASE_URL`` in ``.env.local``.
2. Go to **Project Settings** (gear) → **API**  
   Direct link: ``https://supabase.com/dashboard/project/<your-project-ref>/settings/api``
3. Ensure **Data API** is **enabled**.
4. Under **Exposed schemas** (or **Schema**):
   - Comma-separated list (e.g. ``public, storage, graphql_public``). Default includes ``public``.
   - If empty or missing ``public``, add ``public``, click **Save**.
5. Wait **~30 seconds**, then hard-refresh the app.
6. Smoke test: ``GET /rest/v1/companies?select=id&limit=1`` with anon key → **200** ``[]`` means exposed.

Master operator (app behavior)
------------------------------

| Email | Login without SQL? | Client Setup provision without exposed REST tables? |
|-------|--------------------|-----------------------------------------------------|
| `info@vyronsoft.co.za` | Yes (in-app bypass) | RPC fallback may work if functions are in schema cache; tables must still exist in Postgres |
| Other emails | No — needs tables + `company_users` row | No |

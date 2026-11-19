# 098 — VYRON Company Master: findings, decisions and open items

Companion to `sql/098-vyron-company-master.sql`.
Live inspection **2026-09-07** against `gpiqkwebizuqajgaoxhm` (read-only).
Incorporates and supersedes the review package `vyron-company-master-098-revision`.

---

## 1. Why a second tenancy function instead of widening the first

`public.vyron_user_company_ids()` is not a company-directory helper. It is the
tenant-isolation spine of CORE/HR:

| Measure | Count | Source |
|---|---|---|
| `CREATE POLICY` statements | **82** | live, confirmed |
| Distinct tables gated | **75** | live, confirmed |
| Baseline `md5(pg_get_functiondef(...))` | `a4ca0efca3674ec4889de649f999c3c0` | live, confirmed |

> **Correction.** An earlier revision of this file said 38 policies across 33
> tables, derived from the 2026-08-24 schema dump. The live figure is more than
> double. The dump was stale; the live numbers above are authoritative, and the
> argument below is stronger for it, not weaker.

Gated tables include `employees`, `hr_cases`, `hr_documents`, `hr_notes`,
`hr_warnings`, `leave_requests`, `payroll_batches`, `payroll_hours`,
`payroll_export_logs`, `clock_events`, `user_roles`, `vyron_user_sessions` and
`vyron_audit_log`. Those policies carry **no additional role check**:

```sql
CREATE POLICY "hr_warnings_tenant_isolation" ON public.hr_warnings TO authenticated
  USING (vyron_is_platform_operator() OR company_id IN (SELECT vyron_user_company_ids()));
```

Adding `safety_user_access` there would grant **every Safety user, down to
`viewer`**, read access to HR disciplinary records and payroll across 75
tables. 098 adds `vyron_company_directory_ids()` instead and leaves the spine
byte-identical.

---

## 2. Three tiers of authority, deliberately separate

| Question | Answered by | Sources |
|---|---|---|
| Which companies' **HR/payroll data** may I read? | `vyron_user_company_ids()` **(untouched)** | `company_users` |
| Which companies' **identity** may I see? | `vyron_company_directory_ids()` **(new)** | `company_users` ∪ `safety_user_access` ∪ explicit grants |
| Which companies' identity may I **edit**? | `vyron_company_admin_ids()` **(new)** | `company_users` owner/admin/platform_admin ∪ explicit grants |
| Who may **grant or revoke** that authority? | `vyron_can_manage_company_master_admins()` **(new)** | platform operator ∪ CORE admin ∪ existing Company Master admin |

**No module role confers Company Master authority.** A Safety `owner` is not a
Company Master administrator; they become one only by explicit grant.

---

## 3. Explicit Company Master administration

`public.vyron_company_master_admins` — company-scoped, user-scoped, explicit,
revocable, auditable, independent of every module's role model.

**Why a dedicated table, after looking for somewhere to reuse:**

| Candidate | Why it does not fit |
|---|---|
| `user_roles` | Company- and user-scoped, but **both** its policies are gated on `vyron_user_company_ids()`, so a user without HR tenancy can neither read nor hold a row; and its CHECK permits only `admin\|manager\|staff`, so adding a value means altering a constraint HR depends on |
| `role_permissions` | A global role→module matrix. Neither company- nor user-scoped |
| `company_users.module_access` / `module_permissions` | Requires a `company_users` row — exactly the HR tenancy this must not confer |
| `employee_store_access` | HR-specific (employee ↔ store) |

Every candidate either couples Company Master to HR tenancy or requires
changing an HR constraint. Hence a table of its own.

**Closed to clients twice over.** RLS is enabled with **no policy** —
deny-by-default in PostgreSQL — *and* every table privilege is revoked from
`anon` and `authenticated`. `public.companies` is the cautionary case: its
table-level `GRANT` already permits `UPDATE`, so only the absence of a policy
holds the line there. Here both locks are turned, so a policy added carelessly
later still enables nothing.

Reads go through `vyron_list_company_master_admins()`; writes through
`vyron_grant_company_master_admin()` and `vyron_revoke_company_master_admin()`.

**Self-grant is impossible.** `vyron_can_manage_company_master_admins()` has
three branches — platform operator, CORE admin of *that* company, existing
active Company Master admin of *that* company. A caller matching none is
refused, so nobody can bootstrap themselves.

Revocation marks the row `revoked` rather than deleting it, keeping the grant
and its withdrawal both auditable, and takes effect immediately —
`vyron_company_admin_ids()` reads `status = 'active'`.

### Adopted from the review package

- The table name `vyron_company_master_admins`.
- `vyron_can_manage_company_master_admins()` as a single named authority, so
  grant, revoke and list cannot drift apart.
- `vyron_list_company_master_admins()` for the UI.
- The revocation-consistency CHECK: a revoked row must carry `revoked_at`, an
  active row must not.
- `REVOKE ALL ON TABLE ... FROM anon, authenticated` rather than a read policy.
- An **allowlist** Safety status filter (`= 'active'`) rather than a denylist —
  a status nobody anticipated should withhold access, not grant it.

### Corrected from the review package

| # | Issue | Correction |
|---|---|---|
| 1 | `auth_user_id` had **no foreign key**; existence was checked only inside the grant RPC, so a deleted auth user left an active grant behind forever | `REFERENCES auth.users(id) ON DELETE CASCADE` |
| 2 | The audit metadata stored `target_email` | Removed. The target is identified by uuid; an audit trail is not a place to accumulate personal data |
| 3 | Audit actions were `company_master_admin_granted` / `_revoked` | `company_master_admin.granted` / `.revoked`, as the instruction specifies |
| 4 | The rollback dropped `vyron_company_master_admins` while `vyron_company_admin_ids()` and `vyron_company_directory_ids()` still referenced it, and only *commented* that they should be restored first | 098 creates both functions, so the rollback drops them too, in dependency order. Nothing to restore |

---

## 4. The demonstration case, and the bootstrap path

Verified live:

| Company | CORE admins | UUID-linked | Safety grants |
|---|---|---|---|
| Cutting Edge Cuisine Demo | 2 | 1 | owner/active |
| Vyronsoft Demo Company | 1 | 1 | admin/active |
| VYRON CORE Live Company | 0 | 0 | none |
| **HSE Insight (Pty) Ltd** | **0** | **0** | **owner/active** |

`info@vyronsoft.co.za` holds **Safety owner on HSE Insight, no CORE membership**,
and is the platform operator. Of 3 Safety grants live, **1 has no matching CORE
membership** — this one.

**Bootstrap**, run as the platform operator:

```sql
SELECT public.vyron_grant_company_master_admin(
  '<company_id>'::uuid, '<auth_user_id>'::uuid);
```

The onboarding path for a real customer whose administrator is not an HR user,
and for a demonstration company with no HR users at all. The grantee gains
authority over company identity **only** — `vyron_user_company_ids()` is
untouched, so all 82 policies across 75 tables continue to exclude them, and
**no `company_users` row is created**.

> This particular user is also the platform operator, so they would reach
> Company Master editing by that route regardless. The explicit grant is what
> makes the same demonstration work for a non-operator, and what makes it work
> for real customers.

---

## 5. Live evidence for dropping the email fallback

The new functions match CORE membership on `user_id = auth.uid()` only — no
`user_email`, which is what `vyron_user_company_ids()` does and which would hand
a company to anyone whose JWT email happened to equal a stored address.

**Live `company_users`, 2026-09-07:** 4 rows, 4 active, **2** carrying
`user_id`, **0** carrying `auth_user_id`, 0 soft-deleted.

- Active rows with no UUID link at all: **2** (expected 0).
- Active rows with `auth_user_id` but no `user_id`: **0**.

The second figure is what the decision rests on: no `auth_user_id` fallback is
needed. The two rows in the first were characterised, not assumed:

| Role | Status | `last_login_at` | Assessment |
|---|---|---|---|
| `manager` | active | **never** | not an administrative role |
| `admin` | active | **never** | `@vyron.local` — a seeded placeholder |

Neither has ever authenticated, so `auth.uid()` could not match them under any
rule. Both real logged-in users carry `user_id`. **Not modified.** If either
becomes a real user, the existing `trg_set_company_user_user_id` trigger
backfills `user_id` on any update where `auth_user_id` is set.

---

## 6. Live schema confirmations

`public.companies` — 22 columns. Every column 098 adds was probed individually
and is **ABSENT**.

`public.vyron_audit_log` — the expected insert contract (`id, company_id,
user_email, action, entity_type, entity_id, metadata, created_at`) was probed
and **succeeded**. All three 098 audit writes match it. No new audit table was
created.

`public.safety_user_access` — `auth_user_id, company_id, created_at, id, role,
site_scope, status, updated_at`. Live: 2 × `owner/active`, 1 × `admin/active`.
Read-only; not modified.

---

## 7. Pre-application gates

```sql
-- 1. The baseline. Must equal a4ca0efca3674ec4889de649f999c3c0.
SELECT md5(pg_get_functiondef('public.vyron_user_company_ids()'::regprocedure)) AS baseline;

-- 2. Dependency footprint. Expected 82 policies / 75 tables.
SELECT count(*) AS policies, count(DISTINCT tablename) AS tables
  FROM pg_policies WHERE schemaname='public'
   AND (qual ILIKE '%vyron_user_company_ids%' OR with_check ILIKE '%vyron_user_company_ids%');

-- 3. companies RLS. Expected: one SELECT-only policy.
SELECT policyname, cmd, qual, with_check FROM pg_policies
 WHERE schemaname='public' AND tablename='companies' ORDER BY policyname;

-- 4. companies schema, to confirm which identity columns are still absent.
SELECT column_name, data_type FROM information_schema.columns
 WHERE table_schema='public' AND table_name='companies' ORDER BY ordinal_position;

-- 5. CORE authority shape.
SELECT role, status, count(*) FROM public.company_users
 WHERE deleted_at IS NULL GROUP BY role, status ORDER BY role;

-- 6. Any pre-existing Company Master function.
SELECT proname, pg_get_function_identity_arguments(oid) FROM pg_proc
 WHERE proname LIKE 'vyron_company%' OR proname='vyron_get_company';

-- 7. Audit contract.
SELECT column_name, data_type, is_nullable FROM information_schema.columns
 WHERE table_schema='public' AND table_name='vyron_audit_log' ORDER BY ordinal_position;

-- 8. Branding bucket and its policies (expected: absent before 098).
SELECT id, public FROM storage.buckets WHERE id='company-branding';
SELECT policyname, cmd FROM pg_policies
 WHERE schemaname='storage' AND policyname LIKE 'company_branding%';

-- 9. Authorization tables considered for reuse.
SELECT tablename FROM pg_tables WHERE schemaname='public'
   AND tablename IN ('user_roles','role_permissions','employee_store_access');

-- 10. Safety RLS fingerprint, to compare after applying.
SELECT tablename, policyname, md5(coalesce(qual,'')||coalesce(with_check,'')) AS fp
  FROM pg_policies WHERE schemaname='public' AND tablename LIKE 'safety_%'
 ORDER BY tablename, policyname;

-- 11. HSE Insight must have no CORE membership, before and after.
SELECT count(*) FROM public.company_users
 WHERE company_id='d827b021-c2fd-4824-b533-208bd3a24d26';   -- expect 0
```

These could not be run from the working session: CORE has no programmatic SQL
path (no `pg` driver, no connection string, no `exec_sql` RPC — migrations are
pasted into the Supabase SQL editor), and `pg_policies` / `pg_get_functiondef`
are not reachable through PostgREST. Gates 1–3 were supplied by the operator.

Validate the files first: `node scripts/validate-sql-098.mjs` — 145 checks,
including a dollar-quote state machine for the three-level nesting.

---

## 8. Field decisions

| Field | Decision |
|---|---|
| `physical_address` | **Retained.** Read by `_app-shell.tsx`, `contract-intelligence.ts`, `hr-pdf-service.ts`. Structured `address_*` sit alongside it |
| `billing_email` | **Not repurposed.** Billing-specific, platform-controlled. New `email` is the general address |
| `company_settings.company_name` | **Untouched.** Duplicate identity, but no reads found in `app/` or `lib/` |
| `logo_url` | **Not added.** `logo_path` + `logo_bucket` are authoritative; a stored public URL outlives its access check. `hr-pdf-service.ts` already probes both and starts working with no code change |
| `industry` | Added — 14 repository files reference it, and it is identity, not billing |

---

## 9. Open items, deliberately not addressed by 098

| # | Item | Why not here |
|---|---|---|
| 1 | `sql/062` never applied; Platform Console broken live | Separate workstream — `sql/098-PLATFORM-CONSOLE.md` |
| 2 | `vyron_get_company_access()` has `LIMIT 1` | Changing it alters existing CORE behaviour |
| 3 | `vyron_user_company_ids()` matches on email and ignores `deleted_at` | Instructed to leave completely unchanged |
| 4 | `vyron_is_platform_operator()` hard-codes one address | Flagged, not changed, per instruction |
| 5 | `company_settings.company_name` duplicate identity | Reported, untouched |
| 6 | CORE's client-side company writes in `_app-shell.tsx` are refused by RLS | Fixed by adopting `vyron_update_company()` — a CORE UI change |

Item 3 is a genuine pre-existing weakness: a **soft-deleted** CORE user retains
HR and payroll access across all 75 gated tables, because that function has no
`deleted_at` filter. Recorded so it is not lost; it belongs in its own
hardening change with its own regression pass.

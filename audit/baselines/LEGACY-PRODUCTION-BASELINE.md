# VYRON CORE — LEGACY PRODUCTION BASELINE

| Field | Value |
|---|---|
| **Baseline ID** | `LEGACY-PROD-BASELINE-20260823T123553Z` |
| **Baseline timestamp (UTC)** | 2026-08-23 12:35:53Z |
| **Project** | `gpiqkwebizuqajgaoxhm` (vyron-core) |
| **Organisation / Region** | BASE2GVS's Org (`rgbpukqwbiaxsbimripz`) / `eu-west-1` |
| **Postgres** | 17.6.1.111 |
| **Backup ID** | `audit/backups/20260823T123553Z-pre-9e-baseline/` |
| **Established in** | Phase 9E, before any Phase 9E DDL |

---

## WHAT THIS BASELINE IS — AND IS NOT

**This database is a LEGACY, MANUALLY-BUILT SCHEMA.**

It has **NOT** executed the numbered migrations in `sql/`. Do not claim, record, or assume
otherwise. Evidence gathered across Phases 8–9D:

- `supabase_migrations.schema_migrations` **does not exist** — there is no ledger at all,
  empty or otherwise.
- Of the 203 distinct tables the `sql/` chain declares, **21** exist here; **182** do not.
- **31** tables exist here that **no** `sql/` migration creates. **26** of those have no
  provenance anywhere in the repository or in all 77 commits of git history.
- The applied subset is **non-linear**: table evidence indicates `000`, `001`, `009`,
  `010` (partial), `014`, `030`, `038` (partial) and `041`, while `011`–`028` never ran.
  No replay of the numbered chain reproduces this state.

The three migrations that **have** been executed against this project are the security
migrations authored specifically for it, all recorded below.

**This baseline is a fingerprint of reality at a moment in time.** Its only purpose is to
let us prove exactly what changes after it.

---

## OBJECT COUNTS

| Object | Count |
|---|---|
| Tables (`public`) | 52 |
| Views (`public`) | 1 (`leave_balances_live`, `security_invoker=true`) |
| Materialized views / sequences | 0 / 0 |
| Functions (`public`) | 23 (6 `SECURITY DEFINER`) |
| **Triggers (`public`)** | **9** |
| Indexes (`public`) | 174 |
| Constraints (`public`) | 177 (52 PK, 49 FK, 65 CHECK, 11 UNIQUE) |
| Policies — `public` / `storage` | 42 / 5 |
| RLS-enabled tables | 52 / 52 |
| Storage buckets (all private) | 7 |
| Storage objects | 41 |
| Business rows (companies / company_users / employees) | 3 / 4 / 2 |
| `auth.users` | 2 |

## FINGERPRINTS

All computed from live catalogue state, so they are independent of dump formatting.

| Fingerprint | MD5 |
|---|---|
| **Schema** (every column: name, type, nullability, default) | `c2abdc8dcfdc247dacfa27b670c26a2c` |
| **Constraints** | `4f515f45b71ec59c05d6a233d9a8faaa` |
| **Indexes** | `afa3616d22712030364929d089d3f48f` |
| **Triggers** | `665810d1c1e0df55cdbd10cc5decfc41` |
| **Functions** | `8beb63fdf8a4c00f8fad6f4b9070129f` |
| **Policies** (`public` + `storage`) | `8b07e5766687078da2cfc9244627db6d` |
| **Grants — tables** (anon/authenticated/service_role) | `f8767f35c92e8fa07a9ad442112a84f4` |
| **Grants — functions** | `be45b0b5947ba874f4fef6625087cc5a` |
| **Business data** (companies + company_users + employees) | `b10601b791f4c0cf15a4eb5ce06b310a` |
| **Storage objects** | `2aa25c21398942f0adf0f21682e024e4` |
| **Storage buckets** | `e1c85e28c5e1f0356feac1f9262a6b72` |
| **auth.users** | `6eab62b85fada0802f72fcd3270d221b` |

Regenerate with the query in this directory's sibling tooling
(`fingerprint.sql`, reproduced at the end of this file).

## BACKUP CONTENTS

`audit/backups/20260823T123553Z-pre-9e-baseline/` — verified by test-restore into a
disposable database (companies 3, company_users 4, employees 2, policies 42, triggers 9).

| File | Bytes | MD5 |
|---|---|---|
| `01-roles.sql` | 358 | `0faa1c3232530623ca7758c06e289546` |
| `02-schema-public.sql` | 145,795 | `3bb02b1ba5af068daa8146f8cf535edb` |
| `03-schema-auth-storage.sql` | 98,728 | `479c4568ab6e1fd355c4b6bd6bf1835e` |
| `04-data-all.sql` | 44,946 | `5f118bf7da81393808717f235c0eac87` |
| `05-triggers-public.sql` | 1,371 | `e7f9c8f6c2fed45e26edbcb28206af22` |

**Note on triggers:** an earlier phase claimed `supabase db dump` omits triggers. That was
wrong — it emits them as `CREATE OR REPLACE TRIGGER`, and a schema-only restore was
verified to recreate all 9. `05-triggers-public.sql` is retained as an independent
cross-check, not because the dump is deficient.

---

## CHANGES EXECUTED AGAINST THIS PROJECT (the only ones)

These are **executed migrations**, distinct from the baseline above.

| # | File | Applied (UTC) | Effect |
|---|---|---|---|
| 1 | `sql/090-production-anon-lockdown.sql` | 2026-08-23 ~10:20Z | 104 permissive policies dropped; `anon` → 0 table and 0 function privileges; 4 public storage policies dropped; `hr-documents` bucket → private |
| 2 | `sql/091-phase9c-tenant-linkage-and-access-restoration.sql` | 2026-08-23 ~11:10Z | 2 `company_users.user_id` backfilled; 11 tenant policies restored on 6 relations; 3 `USING (true)` bypasses replaced; `leave_balances_live` → `security_invoker` |
| 3 | `sql/092-phase9d-storage-isolation-and-least-privilege.sql` | 2026-08-23 ~12:20Z | Storage tenant isolation (8 bucket-scoped → 5 tenant-scoped policies); `TRUNCATE` revoked from `authenticated` on all 53 relations; `DELETE` retained on only `employees`, `employee_documents`, `field_jobs`; `vyron_provision_company` EXECUTE revoked from `authenticated` |

Each has a matching `*-rollback-*.sql`. **Rolling any back reopens a proven exposure.**

---

## HOW TO PROVE WHAT CHANGED

1. Re-run the fingerprint query.
2. Diff each fingerprint against the table above.
3. Any fingerprint that moves identifies the category that changed; the corresponding
   snapshot in `audit/schema-snapshots/` gives the line-level detail.

`fp_business_data`, `fp_storage_objects` and `fp_auth_users` must **never** move except
through an explicitly authorised, documented change.

---

## POST-BASELINE EXECUTED MIGRATIONS (Phase 9E)

| # | File | Applied (UTC) | Effect |
|---|---|---|---|
| 4 | `sql/031-mobile-workforce-platform.sql` | 2026-08-23 12:45Z | **Additive only.** Created 6 tables (`mobile_workforce_evidence`, `mobile_gps_validations`, `mobile_workforce_tasks`, `mobile_workforce_notifications`, `mobile_workforce_incidents`, `mobile_workforce_sync_log`), 7 indexes, 19 constraints, RLS + 1 tenant policy on each, and granted `SELECT, INSERT, UPDATE` to `authenticated`. No `anon` grant. No `TRUNCATE`/`DELETE`. Zero business rows created or modified. |

### Fingerprints after `sql/031`

| Fingerprint | Baseline | After 031 |
|---|---|---|
| `fp_schema` | `c2abdc8dcfdc247dacfa27b670c26a2c` | `b6d488cd4225fb4374aafff14bff8387` |
| `fp_constraints` | `4f515f45b71ec59c05d6a233d9a8faaa` | `e5e608625d32e13e9761ced34518321c` |
| `fp_indexes` | `afa3616d22712030364929d089d3f48f` | `8b0fc4dc8cd7309439be484ba732f7e7` |
| `fp_policies` | `8b07e5766687078da2cfc9244627db6d` | `6f4836e5c0e55e358eb3ffe1da48f37a` |
| `fp_grants_table` | `f8767f35c92e8fa07a9ad442112a84f4` | `cbec6065ed2b5ff80ae7297014f4e0a3` |
| **`fp_triggers`** | `665810d1c1e0df55cdbd10cc5decfc41` | **unchanged** |
| **`fp_functions`** | `8beb63fdf8a4c00f8fad6f4b9070129f` | **unchanged** |
| **`fp_grants_function`** | `be45b0b5947ba874f4fef6625087cc5a` | **unchanged** |
| **`fp_business_data`** | `b10601b791f4c0cf15a4eb5ce06b310a` | **unchanged** |
| **`fp_storage_objects`** | `2aa25c21398942f0adf0f21682e024e4` | **unchanged** |
| **`fp_buckets`** | `e1c85e28c5e1f0356feac1f9262a6b72` | **unchanged** |
| **`fp_auth_users`** | `6eab62b85fada0802f72fcd3270d221b` | **unchanged** |

Counts: tables 52 → 58, constraints 177 → 196, indexes 174 → 187, policies (public) 42 → 48.
Triggers 9 → 9. Views 1 → 1. Functions 23 → 23. Storage objects 41 → 41. Business rows 3/4/2 → 3/4/2.

Snapshot: `audit/schema-snapshots/20260823T125030Z-post-9e-031/`

### Migration ledger decision

`supabase_migrations.schema_migrations` was **deliberately NOT created** — see the Phase 9E
report. The `supabase_migrations` schema does not exist, `supabase/migrations/` does not
exist locally, and the repository's 93 `sql/` files are not CLI migrations. Adopting the
CLI ledger is a workflow decision, not a technical necessity, and it is not required by
`sql/031` or by Road & Recovery. **This file is the baseline record of record.**

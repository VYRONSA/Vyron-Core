# UMORA remediation plan — Cutting Edge Cuisine readiness

Status: authorised 2026-11-19 (phases 1–5). Nothing in this plan is applied to production.
Production changes, migration application and deployment each need separate written approval.
**Migration 062 must not be applied.**

## Starting point (recorded before any change)

| Item | Value |
| --- | --- |
| Branch | `pilot/road-recovery` |
| HEAD | `6d351e8e364aad41a9fb544830e4ec1c405e9ebd` (unpushed; this is what production runs) |
| Working tree | 22 pre-existing uncommitted/untracked paths (Company Master 098/099 work) — left untouched |
| Audit evidence | `audit/backups/20261119T-umora-readiness-audit/` (gitignored): production schema dump, roles dump, pre-audit local QA backup, all test results and screenshots |
| Regression scripts | `scripts/qa-umora/` |
| Test environment | Local Supabase (`vyron-core-web` Docker stack) loaded with the live production schema |

## Why new migrations instead of the old ones

Production is a hand-built schema. The migrations that define the missing tables
(`042`, `044`, `045`, `046`) create `DEV allow all` policies (`USING (true)`) and
`GRANT ALL ... TO anon`. Applying them would reopen the exposures closed by `090`–`092`.
The fix is four new, production-compatible, idempotent migrations that contain only what is
needed, with role-aware security from the start. Each has a preflight and a rollback.

## Migrations and dependencies

```
100-security-role-hardening ──► 101-clocking-integrity ──► 103-payroll-readiness
            │                                                  ▲
            └──────────────► 102-operational-alignment ────────┘
```

| Migration | Phase | Depends on | Summary |
| --- | --- | --- | --- |
| `100-security-role-hardening.sql` | 1 | production baseline (090–092) | Role helpers; `company_users` guard trigger (no self-escalation, no admin lock-out, login id must match email); role-aware RLS on HR/attendance/payroll tables; drop 9 legacy permissive read policies; employee PIN/pay-rate column protection; hashed PIN store; audit-log and session-table hardening; HR storage role checks |
| `101-clocking-integrity.sql` | 2 | 100 | `vyron_kiosk_clock` / `vyron_self_clock` server-timed, idempotent, serialised clock functions; overnight-safe state; geofence evaluation; PIN lockout; attendance date + shift session; clock audit trigger; corrections with original preserved; missed clock-out detection; attendance settings; hardened attendance tables the UI expects |
| `102-operational-alignment.sql` | 3 | 100 | Roster columns/tables the UI uses (hardened); leave request columns the form writes; leave notification fix; employee profile tables; HR warning/case constraint alignment; soft-delete protection for employees with history |
| `103-payroll-readiness.sql` | 4 | 100, 101 | Server-side hours generation per pay period in Africa/Johannesburg time (pairs across midnight, break deduction, configurable daily/weekly overtime); period locks; exported rows immutable; export audit |

Rollback order is the reverse: 103 → 102 → 101 → 100.

## Phase 1 — security

- `company_users`: browser writes allowed only for owner/admin of that company (platform operator excepted);
  nobody changes their own role or status; admins cannot touch owners; the last active owner/admin cannot be
  demoted or deactivated; `user_id`/`auth_user_id` must equal the `auth.users.id` of `user_email` (enforced for
  every caller, including the service role).
- User-management API: target login resolved from Auth by email and required to match the row; password,
  email and ban operations refused for accounts that belong to any other workspace or to platform staff.
- Role-aware RLS: managers (owner, admin, hr_manager, operations_manager, manager, supervisor, payroll) read and
  write their company's HR/attendance/payroll rows; employees/staff read only their own rows; clock events
  are never written directly by any browser session.
- Employee PINs move to a hashed, non-readable store; `pin_code` and `hourly_rate` columns are no longer
  readable by browser sessions (managers read rates through a function).
- Proof required: rerun the account-takeover test with the 062 columns present → must be refused.

## Phase 2 — clocking

Kiosk and offline queue call the clock functions; time is server time; one `client_event_id` per tap makes
retries return the original record; a per-employee advisory lock removes races; state comes from the last open
clock-in (not "today"); clock-ins older than the configured maximum shift are closed as missed clock-outs
and raise exceptions; GPS is compared with the store radius (flag or block per company setting).

## Phase 3 — operations

Manager attendance panel, rosters, leave submission/approval, employee management and attendance export
load and save against the aligned schema; QA-only test buttons hidden unless explicitly enabled.

## Phase 4 — payroll

Hours generated server-side per period with paging-free SQL; breaks deducted; overtime per configurable
rules (default 9 h/day, 45 h/week); exported rows and closed periods locked; regeneration of exported data
refused; exports audited and include employee number. Statutory rules are researched in
`docs/payroll/SA-STATUTORY-REQUIREMENTS.md`; UMORA makes no compliance claim.

## Phase 5 — regression

`scripts/qa-umora/` expanded to cover every audit defect, run against the local replica with 100–103
applied, plus `npm run build`, typecheck, unit tests and lint on changed files.

## Status (2026-11-19, end of implementation)

Implemented and verified on the local replica; **not applied to production, not deployed, not committed**.

| Gate | Result |
| --- | --- |
| `scripts/qa-umora/regression.mjs` (security, clocking, operations, payroll, stress) | 132 / 132, three consecutive runs |
| `scripts/qa-umora/ui-e2e.mjs` (real screens, with and without camera) | 12 / 12 |
| `npm test` | 1,184 / 1,184 |
| `npm run build`, `tsc --noEmit` | pass |
| ESLint on changed files vs pre-change baseline | 0 new errors |
| `sql/100-103-PREFLIGHT.sql` against production (read-only) | 11 / 12 — "SAFENZA Demo (QA)" has no active administrator |

Release order: preflight → backup → 100 → 101 → 102 → 103 → deploy this build (same window; the new
app needs the new functions, and the old app's direct clock writes are refused after 101).

Open items and the new database-crash finding (anonymous calls to non-executable functions
segfaulted the local Postgres 17.6.1.111) are listed in the remediation report.

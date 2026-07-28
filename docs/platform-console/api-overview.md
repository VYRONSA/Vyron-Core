# API Overview

All routes below live under `app/api/platform/*`, run on `runtime = "nodejs"`, and
start with `requirePlatformOperator()` (403 if not a platform operator, 401 if not
authenticated at all). One exception: `POST /api/platform/maintenance-override`,
which is intentionally reachable without that role — it authenticates via a
separate emergency code instead (see `security-model.md`).

| Route | Methods | Purpose |
|---|---|---|
| `/dashboard` | GET | Customer counts, MRR/ARR, licence utilisation, recent sign-ups, system health |
| `/customers` | GET, POST | Paginated/filterable directory; create (provision) a customer |
| `/customers/[companyId]` | GET, PATCH, DELETE | Full detail (incl. timeline/health), profile/licence/billing edits, soft delete/restore |
| `/customers/[companyId]/modules` | PATCH | Toggle `enabled_modules` |
| `/customers/[companyId]/status` | POST | `customer_status` transitions (trial/active/grace_period/suspended/cancelled/expired) |
| `/plans` | GET, POST, PATCH | Subscription plan CRUD |
| `/templates` | GET, POST, PATCH | Solution template (Marketplace) CRUD |
| `/modules` | GET, PATCH | Module registry read/update |
| `/intelligence` | GET | Revenue/growth/churn/industry/module-popularity aggregates |
| `/search` | GET `?q=` | Cross-entity search: companies, users, employees |
| `/notifications` | GET | Computed operator alerts (trial/licence expiring, suspended, inactive, failed jobs) |
| `/support/notes` | GET `?companyId=`, POST | Support Centre notes |
| `/support/impersonate` | GET, POST, DELETE | Read active session (for the banner), start, end |
| `/support/reset-password` | POST | Admin-set a user's password |
| `/support/unlock-account` | POST | Reactivate a `company_users` seat |
| `/support/resend-invite` | POST | Wraps `resendClientActivationEmail()` |
| `/support/temp-admin` | POST | Generate a temporary administrator account |
| `/support/diagnostics` | GET `?companyId=` | Recent sessions/activity for a customer (no fake error data) |
| `/system/feature-flags` | GET, POST, PATCH | Feature flag CRUD |
| `/system/settings` | GET, PATCH | Generic key/value settings (maintenance mode, defaults, contact info, notification prefs) |
| `/system/announcements` | GET, POST, PATCH | Platform announcements |
| `/system/release-notes` | GET, POST | Release notes |
| `/system/queues` | GET | `platform_job_queue` counts by queue/status (monitoring only) |
| `/system/health` | GET | DB reachability/latency, active sessions, active impersonations |
| `/maintenance-override` | POST | Validates an emergency code, sets the bypass cookie (no operator role required) |

## Shared helpers

- `app/api/platform/_shared.ts` — `requirePlatformOperator()`, the single gate
  every route (except the override route) calls first.
- `lib/platform/metrics.ts` — pure calculation functions reused by `/dashboard`
  and `/intelligence` (see `architecture.md`'s "never calculate inline" decision).
- `lib/platform/health-score.ts`, `lib/platform/timeline.ts` — reused by
  `/customers` (list) and `/customers/[companyId]` (detail).

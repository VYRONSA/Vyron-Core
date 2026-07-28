# Subscription Engine

## Customer status lifecycle

`customer_status` on `companies`: `trial` → `active` → (`grace_period` |
`suspended`) → `cancelled` | `expired`. Enforced by a CHECK constraint (sql/062,
extended in sql/063 for `grace_period`).

Transitions go through `POST /api/platform/customers/[id]/status`, which:
- Validates the target status.
- Reads the *previous* status first so it only fires the reactivation email when
  coming out of `suspended` (not on every trial→active conversion).
- Writes a specific audit action: `suspend`, `reactivate`, `cancel`, or `update`
  for `trial`/`expired`/`grace_period`.
- Queues a branded suspended/reactivated email template (traceable in System →
  Queues, not actually delivered — see `architecture.md`).

**Suspended/cancelled/expired customers cannot sign in** — enforced in both
`lib/server/authorization.ts` (page navigation, via middleware) and
`lib/server-api-auth.ts` (API calls), both reading the same `customer_status`
column and blocking the same three values.

## Soft delete vs. Cancel

`DELETE /api/platform/customers/[id]` sets `deleted_at` (recoverable via
`?restore=1`) — a directory-visibility concept, deliberately separate from
`customer_status`. A cancelled customer still appears in the directory (their
account is a real, historical business record); a soft-deleted one doesn't,
regardless of their `customer_status`.

## Billing frequency / grace period / capacity

`billing_frequency` (`monthly`/`annual`) feeds every MRR calculation in
`lib/platform/metrics.ts` (annual price ÷ 12). `grace_period_ends_at` is a
separate date field an operator can set alongside the `grace_period` status.
`billing_contact`, `purchase_order`, and `automatic_billing_ready` are schema-ready
fields for a future real payment integration — none is wired to a live processor.

## Plans

`subscription_plans` rows are fully configurable (no hard-coded prices in app
code) — `code`, `modules`, `monthly_price`, `annual_price`, `trial_period_days`,
`employee_limit` (null = unlimited), `storage_limit_gb`, `ai_credit_limit`,
`api_request_limit`. Seeded with Starter/Professional/Enterprise per the original
spec; editable at `/platform/plans`. A **"Custom"** plan (wizard-only, no DB row)
lets an operator hand-pick modules/limits per customer, falling back to
`platform_settings`'s `default_*` keys (see `database.md`) instead of the null
limits a normal plan lookup would otherwise return.

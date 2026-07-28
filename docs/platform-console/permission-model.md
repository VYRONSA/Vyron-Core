# Permission Model

## Roles

`VyronTenantRole` (`lib/tenant-rbac.ts`) / `VyronRbacRole` (`lib/server/auth-routing.ts`):
`platform_operator`, `owner`, `admin` (tenant layer only), `manager`, `supervisor`,
`employee`. Only `platform_operator` can reach `/platform*` or any `app/api/platform/*`
route (every route calls `requirePlatformOperator()` — see `security-model.md`).

## Every privileged action → audit entry

| Action (spec) | Route | `action` | `entityType` |
|---|---|---|---|
| Customer Created | `POST /api/platform/customers` | `create` | `platform_customer` |
| Customer Updated | `PATCH /api/platform/customers/[id]` | `update` | `platform_customer` (profile fields) |
| Customer Suspended | `POST .../status` | `suspend` | `platform_customer` |
| Customer Reactivated | `POST .../status` | `reactivate` | `platform_customer` |
| Customer Cancelled | `POST .../status` | `cancel` | `platform_customer` |
| Customer Deleted / Restored | `DELETE .../[id]?restore=` | `delete` / `restore` | `platform_customer` |
| Module Changed | `PATCH .../modules` | `update` | `platform_customer_modules` |
| Plan Changed | `PATCH .../[id]` (plan_id) | `update` | `platform_customer_plan` |
| Licence Changed | `PATCH .../[id]` (limits/expiry) | `update` | `platform_customer_licence` |
| Subscription/Billing Changed | `PATCH .../[id]` (billing fields) | `update` | `platform_customer_billing` |
| Support Note Added | `POST /api/platform/support/notes` | `create` | `platform_support_note` |
| Password Reset | `POST /api/platform/support/reset-password` | `update` | `platform_support_password_reset` |
| Unlock Account | `POST /api/platform/support/unlock-account` | `update` | `platform_support_unlock_account` |
| Impersonation Start/End | `POST`/`DELETE /api/platform/support/impersonate` | `login_as_client` / `exit_client_mode` | `platform_impersonation` |
| Maintenance Enabled/Disabled | `PATCH /api/platform/system/settings` (key `maintenance_mode`) | `maintenance_enable` / `maintenance_disable` | `platform_maintenance_mode` |
| Feature Flag Changed | `PATCH /api/platform/system/feature-flags` | `update` | `platform_feature_flag` |
| Announcement Published | `POST /api/platform/system/announcements` | `create` | `platform_announcement` |
| Release Published | `POST /api/platform/system/release-notes` | `create` | `platform_release_note` |
| Platform Settings Changed | `PATCH /api/platform/system/settings` (other keys) | `update` | `platform_setting` |

A single `PATCH .../customers/[id]` call spanning multiple categories (e.g. licence
+ billing in one save from `LicenceBillingPanel`) writes **one audit entry per
touched category** (`classifyUpdateEntityTypes()` in the route) rather than one
generic entry — see `security-model.md`.

## Customer Health Score

`lib/platform/health-score.ts` — 0–100 score, banded green (≥70) / amber (≥40) /
red (<40). Built only from real signals: `customer_status` (suspended/cancelled/
expired → 0/red immediately), most-recent login recency, employee count vs.
`employee_limit`, and enabled-module count vs. plan's module count. Deliberately
excludes AI-usage/storage-usage/error signals — none exist yet (see
`architecture.md`).

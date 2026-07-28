# Platform Console — Database Reference

All Platform Console schema lives in `sql/062`, `sql/063`, `sql/064` (run in that
order, after `sql/001`–`sql/061`). See `migrations.md` for run instructions.

## Extended `public.companies` columns (sql/062, sql/063)

| Column | Type | Notes |
|---|---|---|
| `trading_name`, `registration_number`, `vat_number`, `industry`, `company_size`, `country`, `time_zone`, `currency` | text | Company profile |
| `address_line1/2/city/region/postal_code` | text | Structured address |
| `enabled_modules` | jsonb | Array of module codes (see `platform_modules`) |
| `plan_id` | uuid → `subscription_plans.id` | Nullable (custom plan = null) |
| `solution_template_id` | uuid → `solution_templates.id` | Nullable |
| `employee_limit`, `user_limit`, `storage_limit_gb`, `ai_credit_limit`, `api_request_limit` | int | Licence caps; null = unlimited |
| `trial_ends_at`, `licence_expires_at`, `grace_period_ends_at` | timestamptz | |
| `billing_frequency` | text | `monthly` \| `annual` |
| `renewal_date`, `invoice_reference`, `payment_status`, `billing_contact`, `purchase_order` | | Billing fields |
| `automatic_billing_ready` | boolean | Readiness flag only — no processor wired |
| `customer_status` | text | `trial` \| `active` \| `grace_period` \| `suspended` \| `cancelled` \| `expired` |
| `deleted_at` | timestamptz | Soft delete, independent of `customer_status` |

## New tables

| Table | Purpose | Key columns |
|---|---|---|
| `subscription_plans` | Configurable Starter/Professional/Enterprise (+ custom) | `code`, `modules` jsonb, `monthly_price`, `annual_price`, `trial_period_days`, `employee_limit`, `storage_limit_gb`, `ai_credit_limit`, `api_request_limit` |
| `solution_templates` | Marketplace industry presets | `code`, `default_plan_id`, `default_modules`, `default_permissions`, `default_workflows`, `dashboard_widgets`, `suggested_ai_assistants` (all jsonb) |
| `platform_modules` | Data-driven module registry | `module_code` (PK), `status` (enabled/hidden/preview/beta/deprecated), `requires_enterprise`, `requires_ai_credits`, `employee_limit`, `user_limit`, `version` |
| `platform_feature_flags` | Feature toggles | `code` (PK), `is_enabled`, `rollout_scope` |
| `platform_settings` | Key/value config | `key` (PK), `value` jsonb — see below for seeded keys |
| `platform_announcements` | Operator-published announcements | `title`, `body`, `is_active`, `starts_at`, `ends_at` |
| `platform_release_notes` | Release notes | `version`, `title`, `body`, `released_at` |
| `platform_support_notes` | Support Centre notes per customer | `company_id`, `operator_email`, `note` |
| `platform_impersonation_sessions` | "Login As Customer" sessions | `session_token` (unique), `operator_email`, `company_id`, `status` |
| `platform_job_queue` | Tracking/monitoring log (**not** a worker engine) | `queue_name` (email/notification/storage/ai), `status`, `payload` |

## `platform_settings` seeded keys (sql/063, sql/064)

`maintenance_mode` (`{enabled, message, expected_return_at, override_code}`),
`terms_content`, `privacy_content`, `default_trial_days`, `default_ai_credit_limit`,
`default_storage_limit_gb`, `default_employee_limit`, `default_session_timeout_minutes`,
`support_contact`, `platform_email`, `notification_thresholds`, `notification_preferences`.

## Postgres functions

- `vyron_get_maintenance_mode()` — SECURITY DEFINER, anon-safe, returns only
  `{enabled, message, expected_return_at}`.
- `vyron_validate_maintenance_override(p_code)` — SECURITY DEFINER, returns a bare
  boolean; never exposes the stored code.
- `vyron_is_platform_operator()` (sql/060, pre-existing) — the single RLS predicate
  every new table's write policy is built on.

## RLS pattern

All `platform_*` tables: `FOR ALL TO authenticated USING (vyron_is_platform_operator()) WITH CHECK (...)`.
`subscription_plans` / `solution_templates`: `SELECT` open to `authenticated` (tenants
read their own plan), writes restricted to platform operators. `companies` retains its
pre-existing tenant-isolation policy (sql/049) — platform operators bypass it via the
same `vyron_is_platform_operator()` predicate already used elsewhere.

## Indexes added

`companies(customer_status)`, `companies(plan_id)`, `companies(deleted_at)`,
`companies(industry)`, `company_users(last_login_at DESC)`,
`platform_support_notes(company_id, created_at DESC)`,
`platform_impersonation_sessions(status)`, `platform_job_queue(queue_name, status)`.

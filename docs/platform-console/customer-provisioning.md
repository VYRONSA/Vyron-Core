# Customer Provisioning

Entry points: `CreateCustomerWizard.tsx` → `POST /api/platform/customers` →
`lib/platform/provision-customer.ts` (`provisionPlatformCustomer`).

## Steps performed by `provisionPlatformCustomer`

1. Look up `subscription_plans` by code (or synthesize a "custom" plan row from
   `lib/platform/settings.ts`'s `getPlatformDefaults()` when `planCode === "custom"`).
2. Look up `solution_templates` by code, if a Marketplace template was chosen.
3. **Reuse** `provisionClientCompany()` (`lib/company-access.ts`, unchanged) — creates
   the base `companies` row.
4. One targeted `UPDATE companies` (service-role client) sets every platform column:
   profile fields, `enabled_modules` (union of plan modules + template default
   modules, or the operator's explicit wizard selection if provided),
   `employee_limit`/`storage_limit_gb`/`ai_credit_limit`/`api_request_limit`
   (operator override → plan value → platform default, in that order),
   `trial_ends_at` (plan/platform-default trial days from now),
   `customer_status = 'trial'`, and
   `session_idle_timeout_minutes`/`session_absolute_timeout_minutes` (from
   platform defaults).
5. Primary Administrator: **reuses** `createClientLoginUser()`
   (`lib/create-client-login-user.ts`), extended with an optional `password` —
   omit it to send a Supabase Auth invite (`admin.auth.admin.inviteUserByEmail`)
   instead of setting a temporary password. Profile fields (first/last name,
   mobile) are stored as Auth `user_metadata` (display only, never a privilege
   claim — see `security-model.md`).
6. `writeAuditLog()` records `action: "create"`, `entityType: "platform_customer"`.
7. If the admin was invited (not password-set), or created via a template welcome
   flow, `queueTemplatedNotification()` logs the rendered
   `lib/platform/email-templates.ts` template to `platform_job_queue` — see
   `architecture.md` for why this isn't a live send.

## Safety note

`sql/060`'s `vyron_guard_company_users_role_change` trigger explicitly no-ops for
`auth.role() = 'service_role'`, so the service-role writes to `company_users`
during provisioning are unaffected by that guard.

## Reused, not duplicated

- `provisionClientCompany()` — base company row + optional first `company_users` row.
- `createClientLoginUser()` — Auth user creation/invite + `company_users` upsert.
- `resendClientActivationEmail()` (`lib/client-invite-resend.ts`) — used by Support
  Centre's "Resend Invitation", not by first-time provisioning.
- `writeAuditLog()` / `vyron_audit_log` — the single audit sink for every
  privileged action across the console (see `security-model.md`).

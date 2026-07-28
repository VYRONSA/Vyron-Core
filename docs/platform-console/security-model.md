# Security Model

## The platform-operator claim

A single source of truth: `lib/server/platform-operator.ts` —
`PLATFORM_OPERATOR_ROLE_CLAIMS = {super_admin, platform_admin, platform_operator,
"supervisor tools"}`. Every consumer imports from here:

- `lib/server-api-auth.ts` (`authenticateApiRequest`) — API bearer-token auth.
- `lib/company-access.ts` (`isVyronMasterOperator`) — legacy VYRON DEV role check.
- `lib/server/auth-routing.ts` (`normalizeRbacRole`) — middleware role resolution.
- `public.vyron_is_platform_operator()` (sql/050/060, Postgres) — RLS predicate.
  **Cannot share code with the TS side** — its literal claim set must be kept in
  sync with `platform-operator.ts` manually (documented in both places).

Only `app_metadata.role`/`roles` is trusted for this claim — never `user_metadata`,
which is self-editable by the signed-in user via `supabase.auth.updateUser()`. This
mirrors the pre-existing rationale in `lib/server-api-auth.ts`'s `extractAuthRoles`.

## Route protection

`middleware.ts` → `resolveServerAuthorizationContext()`
(`lib/server/authorization.ts`) resolves a `VyronRbacRole` including
`"platform_operator"`. Two important non-obvious behaviors:

1. **A platform operator can have zero tenant `company_users` rows.** The
   original auth flow denied access entirely when no membership/RPC match was
   found; `platformOperator` now short-circuits that, returning a valid context
   with `companyId: null`.
2. **`canAccessRouteForRole`** gates `/platform*` to `role === "platform_operator"`
   only, and separately grants that role full access to every other protected
   route too (parity with how VYRON DEV historically worked — riding on whatever
   tenant route the operator was already authenticated into).

## Maintenance mode enforcement

Fully contained in `middleware.ts` (not the shared tenant layout) — see
`lib/platform/maintenance-mode.ts`. Platform operators bypass unconditionally.
Everyone else is redirected to `/maintenance`, which reads status via the narrow
`vyron_get_maintenance_mode()` RPC. An emergency override code (set in
`/platform/system`) is validated server-side via `vyron_validate_maintenance_override()`
— the code itself is never sent to the browser — and grants a 4-hour
`vyron_maintenance_bypass` httpOnly cookie via `POST /api/platform/maintenance-override`.

## Impersonation ("Login As Customer")

**Not identity assumption.** The operator's own `platform_operator` session
(already privileged to read/write every tenant) is simply scoped/labeled — no
token is minted for the customer's identity. Mechanics:

- `POST /api/platform/support/impersonate` inserts a `platform_impersonation_sessions`
  row and sets an httpOnly `vyron_impersonation_session` cookie (4-hour TTL).
- Every `app/api/platform/*` route automatically receives `context.impersonating`
  (populated in `_shared.ts`'s `requirePlatformOperator`, via
  `lib/platform/impersonation-context.ts`) — satisfies "every API request must
  know whether the user is impersonating."
- `ImpersonationBanner.tsx` (rendered in the shared `app/(app)/layout.tsx`, so it's
  visible everywhere, not just `/platform`) polls the same endpoint and offers an
  End button.
- Start and end are both written to `vyron_audit_log` (`login_as_client` /
  `exit_client_mode`), satisfying "every impersonation session must be logged."

## Audit logging

Single sink: `public.vyron_audit_log` (pre-existing, sql/030) via
`writeAuditLog()`/`fetchAuditLogForCompany()` (`lib/audit-log.ts`). Action
vocabulary (`AUDIT_ACTIONS`) extended this project with: `suspend`, `reactivate`,
`cancel`, `maintenance_enable`, `maintenance_disable` (the rest — `create`,
`update`, `delete`, `restore`, `login_as_client`, `exit_client_mode` — pre-existed).
Granularity is carried by `entityType` (e.g. `platform_customer_plan`,
`platform_customer_licence`, `platform_customer_billing`,
`platform_support_note`, `platform_maintenance_mode`, ...) rather than exploding
the action enum — see `permission-model.md`'s coverage table for the full mapping.

## Suspended customers cannot authenticate

Enforced independently in two places reading the same `customer_status` column:
`lib/server/authorization.ts` (page navigation via `middleware.ts`) and
`lib/server-api-auth.ts` (direct API calls) — both block `suspended`, `cancelled`,
and `expired`.

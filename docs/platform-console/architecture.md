# Platform Console — Architecture

## What it is

The Platform Console is the internal admin surface VYRON's own staff (Platform
Operators) use to provision and manage customer tenants of VYRON CORE. It is a
separate concern from "VYRON DEV" (`components/vyron-dev/*`), an older internal
tool for tracking VYRON's cross-product portfolio (CORE/COST/PAY/FARM/MAINT/REACH/
FINANCE/BUILD) — the two are intentionally not merged (see Decisions below).

## Layers

```
app/(app)/platform/*        Next.js App Router pages (client components)
app/api/platform/*          Route handlers — the only place RLS is intentionally bypassed
lib/platform/*              Pure logic: metrics, health score, timeline, provisioning,
                             maintenance mode, impersonation, email templates, settings
components/platform/*       UI components consumed by app/(app)/platform/* pages
sql/062, 063, 064           Schema migrations (see migrations.md)
```

## Request flow (typical read)

1. The browser reaches an API route one of two ways, and **both are equally valid**:
   - a client component using `lib/platform/platform-client.ts`'s `platformFetch()`,
     which attaches the Supabase session's bearer token; or
   - a server-rendered page calling plain `fetch()` (e.g. the Platform Mode
     verification screen), which sends only cookies — a browser never adds an
     `Authorization` header by itself.
2. The API route calls `requirePlatformOperator()` (`app/api/platform/_shared.ts`),
   which authenticates via `authenticateApiRequest(request)`
   (`lib/server-api-auth.ts`) and rejects non-platform-operators with 403.

   `authenticateApiRequest` takes the whole request and resolves the access token from
   the `Authorization` header **or** the `vyron_access_token` cookie, then verifies it
   the same way in both cases (`supabase.auth.getUser(token)`). Two transports, one
   verification authority — the Supabase-verified user is the single source of truth
   about who is signed in.

   `components/auth/AuthSessionSync.tsx`, mounted in `app/(app)/layout.tsx`, keeps that
   cookie a faithful mirror of the Supabase session on every protected route, including
   ones that do not render `_app-shell`.
3. On success, the route gets a **service-role Supabase client** (bypasses RLS by
   design — the route itself is the access gate) plus `impersonating` context (see
   `security-model.md`).
4. The route reads/writes tables directly or calls into `lib/platform/*` logic, and
   ends privileged writes with `writeAuditLog()`.

## Request flow (route protection)

`middleware.ts` resolves a `role` for every request to a path under
`PROTECTED_ROUTE_PREFIXES` (`lib/server/auth-routing.ts`), including `platform_operator`.
`canAccessRouteForRole()` restricts `/platform*` to that role only. See
`security-model.md` / `permission-model.md` for the full claim chain.

## Key architectural decisions

- **VYRON DEV is not reused as the data model.** `lib/vyron-dev-platform.ts`'s
  `vyron_clients` table never touches `public.companies` — it isn't a real,
  working CORE tenant. The Platform Console is built entirely on `companies` /
  `company_users`, the tables every feature module and RLS policy already depend on.
- **Impersonation is scoped viewing, not identity assumption.** "Login As Customer"
  never mints or swaps the customer's own session/token. It records an audited
  `platform_impersonation_sessions` row and surfaces a banner
  (`ImpersonationBanner.tsx`) — the operator's own already-privileged
  `platform_operator` role already has full read/write access to every tenant.
- **Soft delete ≠ Cancel.** `companies.deleted_at` (directory visibility) is a
  separate concept from `customer_status = 'cancelled'` (business/billing state) —
  see `subscription-engine.md`.
- **Honest scope boundaries** (deliberately not built, and why):
  - No live transactional email provider — invite/reset use Supabase Auth's own
    email system; the branded templates in `lib/platform/email-templates.ts` are
    logged to `platform_job_queue` (queue_name `notification`) for traceability,
    not actually delivered.
  - No real async job workers — `platform_job_queue` is a tracking/monitoring
    table, not a consumer/worker runtime (would need Vercel Queues or similar).
  - No AI-usage/storage-usage/error telemetry — none exists anywhere in this app
    yet, so Health Score, notifications, and diagnostics only use signals that
    are real (login recency, licence utilisation, module adoption, subscription
    status) and explicitly say "not instrumented" where a metric would otherwise
    have to be fabricated.
  - No live payment processor — `companies.automatic_billing_ready` is a
    readiness flag only.
  - Maintenance mode is enforced in `middleware.ts` (not the shared
    `app/(app)/layout.tsx`) to keep the blast radius of a mistake contained to the
    request-gating chokepoint that already existed, rather than the tenant render tree.

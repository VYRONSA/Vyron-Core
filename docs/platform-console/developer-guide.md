# Developer Guide

## Adding a new `/platform` API route

1. Create `app/api/platform/<name>/route.ts` with `export const runtime = "nodejs"`.
2. First line of every handler:
   ```ts
   const auth = await requirePlatformOperator(request);
   if (!auth.ok) return auth.response;
   const { supabase, email, impersonating } = auth.context;
   ```
3. Use `supabase` (service-role client) for all reads/writes — RLS is bypassed by
   design here; the `requirePlatformOperator()` call above is the access gate.
4. End every write with `writeAuditLog(supabase, { companyId, userEmail: email,
   action, entityType, entityId, metadata })` — see `permission-model.md` for the
   action/entityType vocabulary. Never allow a privileged write to skip this.
5. If the calculation is dashboard/intelligence-style aggregate math, put it in
   `lib/platform/metrics.ts` as a pure function and import it — don't inline it
   in the route.

## Adding a new module

1. Add a row to `platform_modules` (via `/platform/modules` UI or SQL) with a
   `module_code`.
2. Add the code + display label to `lib/platform/module-catalog.ts`'s
   `MODULE_CATALOG` (used as an initial-render fallback and for display lookups
   like `moduleLabel()` — the live source of truth for toggling is always the
   `platform_modules` API, not this file).
3. If the module should be part of a plan or template by default, add its code to
   that `subscription_plans.modules` or `solution_templates.default_modules` row.

## Adding a new industry template

Insert into `solution_templates` — no code change required (see `marketplace.md`).

## Extending the audit vocabulary

Add the literal to `AUDIT_ACTIONS` in `lib/audit-log.ts` only for genuinely
distinct, security-relevant events (mirroring `suspend`/`reactivate`/`cancel`/
`maintenance_enable`/`maintenance_disable`). For a "changed X" event, prefer a
new `entityType` string over a new action literal — see `permission-model.md`.

## Testing changes locally

- `npx tsc --noEmit -p tsconfig.json` — fast type check.
- `npm run build` — full Next.js build (catches route conflicts, RSC/client
  boundary issues `tsc` alone won't).
- `npm run dev`, then manually exercise the flow in a browser — there is no
  automated UI test harness in this repo; see `operator-guide.md` for the
  stabilization checklist to run before inviting pilot customers.
- Unauthenticated smoke test without any real login:
  `curl -i http://localhost:3000/platform` should 307 to `/login`;
  `curl -i http://localhost:3000/api/platform/dashboard` should 401.

## Conventions to preserve

- `PlatformPanel`/`PlatformStatTile` are the shared visual primitives — reuse
  them rather than hand-rolling new card markup (mirrors, but does not import
  from, `components/vyron-dev/VyronDevPanel.tsx` — the two systems are
  intentionally decoupled, see `architecture.md`).
- Client components fetch via `lib/platform/platform-client.ts`'s
  `platformFetch()`, which attaches the Supabase session bearer token — don't
  hand-roll `fetch()` calls against `/api/platform/*`.
- Never introduce a second copy of the platform-operator claim set — import from
  `lib/server/platform-operator.ts` (see `security-model.md`).

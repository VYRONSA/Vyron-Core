# First Platform Operator — one-time bootstrap

Every Platform Console gate reads the operator claim from
`auth.users.app_metadata` ([middleware.ts](../../middleware.ts),
[app/api/platform/_shared.ts](../../app/api/platform/_shared.ts),
`public.vyron_is_platform_operator()`), and only the service role can write that
field. On a fresh project this is a chicken-and-egg: nobody can reach `/platform`
to promote anyone.

This bootstrap closes that gap **once**, without hand-editing `auth.users`.

## Prerequisites

1. Run `sql/066-platform-operator-bootstrap.sql` in the Supabase SQL editor.
2. The account you want to promote must already exist in `auth.users` — sign up
   through the app first. Bootstrap promotes an existing user; it never creates one.

## Path A — secure admin endpoint (recommended)

1. Generate a high-entropy secret (32+ chars):

   ```bash
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ```

2. Set it as `PLATFORM_BOOTSTRAP_SECRET` on the server (Vercel → Settings →
   Environment Variables → Production, then redeploy). Without it the endpoint
   returns `503` — it is disabled by default.

3. Check availability (read-only):

   ```bash
   curl -s https://<host>/api/platform/bootstrap \
     -H "x-vyron-bootstrap-secret: $PLATFORM_BOOTSTRAP_SECRET"
   # {"ok":true,"available":true,"reason":"ready","existingOperatorCount":0}
   ```

4. Promote:

   ```bash
   curl -s -X POST https://<host>/api/platform/bootstrap \
     -H "x-vyron-bootstrap-secret: $PLATFORM_BOOTSTRAP_SECRET" \
     -H "content-type: application/json" \
     -d '{"email":"you@yourdomain.com"}'
   ```

5. **Sign out and sign in again**, then open `/platform`. The operator claim is
   carried in the JWT, so an already-issued session keeps the old claims until it
   is re-issued (a token refresh also picks it up, within the hour).

6. Delete `PLATFORM_BOOTSTRAP_SECRET` from the environment. The path is already
   latched shut, but there is no reason to leave the key lying around.

## Path B — SQL script

Supabase SQL editor (runs as `postgres`):

```sql
SELECT public.vyron_bootstrap_platform_operator('you@yourdomain.com');
```

The function is `SECURITY DEFINER` with **no** grant to `anon` or `authenticated`,
so it is unreachable over PostgREST — the SQL editor is the only caller. Same
sign-out/sign-in step applies afterwards.

## Path C — repo script (no migrations required)

Paths A and B both depend on `sql/066` being installed. When it is not (or when you
just want the promotion done from a dev machine), use the script — it performs the
same single `app_metadata` write through the Auth Admin API:

```bash
npm run bootstrap:operator -- you@yourdomain.com                  # uses .env.local
npm run bootstrap:operator -- you@yourdomain.com --check          # report only, no writes
npm run bootstrap:operator -- you@yourdomain.com --env .env.production
npm run bootstrap:operator -- you@yourdomain.com --demote         # remove the claim
```

It needs `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`. Real environment
variables win over the env file, so CI/production can export them instead of shipping a
file. Like the other paths it refuses to run when any account already holds an operator
claim (override deliberately with `--allow-additional`), and it merges into existing
`app_metadata` rather than replacing it, so `provider`/`providers` survive.

Unlike Paths A and B this one is not latched — it is guarded by possession of the
service-role key. Promote further operators from the Platform Console.

## When the new claim takes effect

Two different readers, two different timings:

- **Route access** (`middleware.ts` → `lib/server/authorization.ts`) calls
  `GET /auth/v1/user`, which reads `app_metadata` from the database. A promotion is
  therefore live on the **next request** — no re-login needed.
- **The Platform Console sidebar link** reads the browser's session. The shell calls
  `supabase.auth.getUser()` for exactly this reason, so it also refreshes without a
  re-login; a hard refresh is enough if the tab was already open.

Signing out and back in remains the surest way to resync everything at once.

## What makes it one-time

`public.vyron_platform_bootstrap` is a single-row latch: `id boolean PRIMARY KEY
DEFAULT true CHECK (id)`. At most one row can ever exist, and a second attempt
fails on the primary key rather than racing.

Both paths refuse to run when:

| Condition | Result |
| --- | --- |
| Latch row exists | `410 Gone` / SQL exception — permanently disabled |
| Any `auth.users` row already carries an operator claim | `409` / SQL exception |
| Secret missing, too short, or wrong | `503` / `401` (endpoint only) |
| Target email has no account | `404` / SQL exception |

The API path claims the latch **before** promoting, so two concurrent requests
cannot both succeed. If the promotion itself then fails, the latch is released —
a failed attempt must not lock the project out with no operator at all.

The latch table has RLS enabled with zero policies plus `REVOKE ALL` from `anon`
and `authenticated`: only the service role can see or touch it.

## Audit trail

Both paths write to `vyron_audit_log`:

| action | when | metadata |
| --- | --- | --- |
| `platform_bootstrap` | operator promoted | `method` (`api`/`sql`), `promoted_email`, `ip`/`performed_by` |
| `platform_bootstrap_blocked` | valid secret, but an operator already exists | `reason`, `existingOperatorCount`, `ip` |

Rejected secrets are **not** written to the audit log — the endpoint is
unauthenticated, so logging every guess would let anyone flood the audit trail.
They are `console.warn`-ed with the source IP instead.

## After bootstrap

Promote every further operator from the Platform Console as a signed-in
operator. If the latch row is ever deleted (service role only), bootstrap still
refuses while any operator exists — the claim scan is the second, independent
guard.

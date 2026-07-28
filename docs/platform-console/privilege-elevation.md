# Privilege Elevation — "Platform Mode"

Authentication and privilege are two different questions:

| Question | Answered by | Where |
| --- | --- | --- |
| Who is this? | The `platform_operator` claim in `auth.users.app_metadata` | [middleware.ts](../../middleware.ts), [lib/server/platform-operator.ts](../../lib/server/platform-operator.ts) |
| May they act **right now**? | A live Platform Mode session | [lib/platform/elevation.ts](../../lib/platform/elevation.ts) |

A Platform Operator signs in normally and sees the Platform Console link in the
sidebar. They are **not** elevated. Opening `/platform` presents a supervisor
verification screen; privileged actions stay blocked until they pass it.

## The Supervisor Password

A dedicated secret, **not** the operator's login password.

```bash
npm run platform:supervisor-secret                       # generate password + hash
npm run platform:supervisor-secret -- --password "..."   # hash a chosen password
npm run platform:supervisor-secret -- --emergency        # secondary break-glass secret
```

Put the printed hash in the server environment:

```
PLATFORM_SUPERVISOR_SECRET_HASH=scrypt:16384:8:1:<saltBase64>:<hashBase64>
PLATFORM_SUPERVISOR_SECRET_HASH_EMERGENCY=      # optional
PLATFORM_ELEVATION_TTL_MINUTES=30               # optional, default 30
PLATFORM_ELEVATION_IDLE_MINUTES=15              # optional, default 15
```

Security properties:

- The password is **never stored** — only a scrypt hash (N=16384, r=8, p=1, 64-byte
  key, random 16-byte salt), compared in constant time.
- The hash is server-only. It is never sent to the browser and never appears in an
  API response; the `configured` field is a boolean.
- **Fail-closed.** With nothing configured, `/platform` shows "Platform Mode is not
  configured" and every privileged API returns 403. It never falls open.
- Colon-delimited rather than the conventional `$` because Next.js runs dotenv-expand
  over `.env` files, which would read `$16384` as a variable and corrupt the value.

## The elevated session

A successful verification issues a signed cookie, `vyron_platform_elevation`:

- **httpOnly**, **SameSite=Strict**, `Secure` in production — unreadable from JS.
- **HMAC-SHA256 signed** with a key HKDF-derived from the stored hash. Rotating the
  supervisor password therefore invalidates every outstanding elevation instantly.
- **Bound to the operator's email**, so it cannot be replayed against another account.
- **Absolute 30-minute expiry**, carried in the signed payload — a client cannot
  extend it without breaking the signature.
- **No `Max-Age`**, making it a browser-session cookie: closing the browser ends
  Platform Mode.

### Auto-lock triggers

| Trigger | Mechanism |
| --- | --- |
| 30 minutes elapse | Absolute `exp` in the signed payload, enforced server-side |
| Browser closes | Session cookie (no `Max-Age`) |
| Logout | `handleLogout` calls `DELETE /api/platform/elevation` before `signOut` |
| Exit Platform Mode | Same endpoint, clears the cookie immediately |
| Idle (15 min default) | Client watches pointer/key/wheel/touch and exits on timeout |
| Auth session invalid | Elevation is checked only after authentication succeeds |

The absolute expiry is server-enforced. The idle timeout is client-driven — it drops
elevation early when an operator walks away, but the 30-minute ceiling is what
actually bounds exposure.

## What requires elevation

Enforcement is centralised in `requirePlatformOperator()`
([app/api/platform/_shared.ts](../../app/api/platform/_shared.ts)), so **every** route
under `/api/platform/*` is elevation-gated by default — including reads, since the
Platform Console's reads expose the entire customer base. A new privileged endpoint is
protected the moment it calls the gate; there is no per-route checklist to forget.

This covers every action in the brief: create/delete/suspend/reactivate/cancel
customer, change subscription, change licence, enable/disable modules, impersonate,
maintenance mode, feature flags, release management, platform settings, password
reset, unlock user, temporary administrator, and marketplace configuration.

Exactly three deliberate exceptions, each with a reason:

| Endpoint | Why unelevated |
| --- | --- |
| `POST/GET /api/platform/elevation` | It is the route that *creates* elevation |
| `GET /api/platform/support/impersonate` | The "Viewing as" banner must stay visible on tenant pages even after Platform Mode expires |
| `DELETE /api/platform/support/impersonate` | Ending impersonation is a de-escalation; gating it would strand an operator inside a customer workspace |

`POST /api/platform/bootstrap` does not use the gate at all — by definition no
operator exists when it runs. See [first-operator-bootstrap.md](./first-operator-bootstrap.md).

Rejections return `403` with `code: "elevation_required"` and a `reason`
(`absent` / `expired` / `wrong_operator` / `bad_signature` / `malformed`), so the UI
can reopen the verification screen instead of showing a generic permission error.

## UI

- **Verification screen** — [PlatformElevationScreen.tsx](../../components/platform/PlatformElevationScreen.tsx).
  Rendered *in place of* the console by the server layout. An unelevated operator is
  deliberately **not** redirected to `/dashboard`: they stay on the route they asked for.
- **Platform Mode indicator** — [PlatformModeBanner.tsx](../../components/platform/PlatformModeBanner.tsx).
  Shows `Platform Mode Active`, a live `MM:SS` countdown that turns amber under two
  minutes, and **Exit Platform Mode**.

The gate is a **server component** ([app/(app)/platform/layout.tsx](<../../app/(app)/platform/layout.tsx>)),
so the cookie is verified before any console markup is generated. The UI gate and the
API gate are independent — neither relies on the other.

## Brute-force resistance

Five failed attempts (keyed by operator + IP) lock elevation for 15 minutes; a correct
password is refused while locked. The counter is in-memory, so it is per server
instance and resets on redeploy — on serverless it throttles rather than guarantees.
It sits on top of the real defences: scrypt's cost, a high-entropy generated password,
and the audit trail. A durable counter would need a database table.

## Audit trail

Every elevation event is written to `vyron_audit_log`:

| Action | When | Metadata |
| --- | --- | --- |
| `platform_elevation_granted` | Successful elevation | `ip`, `userAgent`, `via` (primary/emergency), `grantedAt`, `expiresAt`, `durationMinutes` |
| `platform_elevation_denied` | Wrong password | `ip`, `userAgent`, `success: false`, `failures` |
| `platform_elevation_locked` | Lockout threshold reached | `ip`, `userAgent`, `lockedOut: true` |
| `platform_elevation_exited` | Exit / idle / expiry / logout | `ip`, `userAgent`, `exitReason`, `grantedAt`, `durationSeconds` |
| `platform_elevation_revoked` | A session terminated from Active Platform Sessions | `ip`, `userAgent`, `terminatedSession`, `alreadyInactive` |
| `platform_lockdown` | Emergency lockdown | `ip`, `userAgent`, `revokedCount`, `reason`, `scope` |

No secret material is ever written to the audit log.

## Operational visibility

### Platform Mode banner

Rendered by the console layout, so it appears on **every** Platform page. Shows the
shield mark, `Platform Mode Active`, a live `MM:SS` countdown, the signed-in operator,
and **Extend** / **Exit Platform Mode**.

### Expiry warning

At five minutes remaining a modal offers **Extend Platform Mode** or **Exit Platform
Mode**. Extending re-prompts for the Supervisor Password and issues a fresh session —
there is deliberately no silent renewal, since an unattended console must never be able
to extend its own privilege. "Continue working" dismisses the warning without extending.

### Recent Platform Activity

On the Platform dashboard, sourced from `vyron_audit_log` (no new storage): Last
Platform Login, Last Customer Created, Last Suspension, Last Impersonation, Last
Release, Last Maintenance Window. "No record yet" and "audit log unavailable" are shown
distinctly — an empty history and a broken query must not look the same.

### Active Platform Sessions · Emergency Lockdown · Security dashboard

On the Platform → System page:

- **Active Platform Sessions** — operator, browser, IP, started, remaining time, with
  **Terminate** per session. The caller's own session is labelled "This device".
- **Emergency Lockdown** — revokes every live elevated session, including the
  initiator's. Scoped to privilege only: ordinary application logins are untouched, so
  operators and tenant users stay signed in and simply drop to unelevated.
- **Security dashboard** — Failed Elevations, Lockouts, Active Platform Sessions,
  Impersonations Today, Audit Events Today.

These three depend on `sql/067-platform-elevation-sessions.sql`.

## Authentication vs elevation — one source of truth

Elevation sits *on top of* authentication and never substitutes for it. Both the page
gate and the API gate resolve identity the same way:

| Layer | Reads | Verifies with |
| --- | --- | --- |
| `middleware.ts` | `vyron_access_token` cookie | Supabase `/auth/v1/user` |
| `app/(app)/platform/layout.tsx` | same cookie | `resolveServerAuthorizationContext` |
| `app/api/platform/*` | `Authorization` header **or** the same cookie | `supabase.auth.getUser(token)` |

The API accepting only a bearer header was the cause of the "page shows my email but
the API says Sign in required" bug: server-rendered pages post with plain `fetch()`,
which sends cookies and no header. `authenticateApiRequest(request)` now resolves the
token from either transport and verifies it identically, so no layer can disagree with
another about the same session.

`AuthSessionSync` (mounted in `app/(app)/layout.tsx`) keeps the cookie in step with
Supabase's own auto-refreshing session on **every** protected route. Previously that
sync lived only inside `_app-shell`, which `/platform` does not render — so the cookie
went stale there when the access token rotated.

## Requires sql/067

The session registry adds **revocation** on top of the unchanged cookie model.
Verification becomes: valid signature **and** not expired **and** not revoked — the
first two are exactly as before.

When `sql/067` is not installed:

| Behaviour | Why |
| --- | --- |
| Elevation still works normally | The cookie is the credential; the registry only adds revocation |
| Revocation checks pass through | Matches pre-067 behaviour, so an uninstalled migration cannot lock operators out |
| Sessions list returns `503` naming the migration | Reporting "no active sessions" would wrongly read as "nobody is elevated" |
| Lockdown and Terminate refuse with `503` | A lockdown that silently did nothing while reporting success is the dangerous failure |

That combination is deliberate: the fail-open revocation check is only safe *because*
the management endpoints fail loudly, so revocation is never mistakenly believed to be
in force.

## Known trade-off

Elevation state lives in the signed cookie, not a database row, so "Exit Platform
Mode" revokes by clearing the cookie client-side. A cookie already exfiltrated from a
machine stays valid until its absolute expiry — the same model GitHub and AWS sudo
modes use, and the 30-minute ceiling is what bounds it. Server-side revocation of an
individual session would need an elevation-session table; `sql/067` is the natural
home if that becomes a requirement.

## Roadmap

The secret is read through `getSupervisorSecrets()`, a single seam that already
supports a primary plus an optional emergency secret. Moving to database-backed,
Platform-Console-managed secrets — or adding TOTP / WebAuthn hardware keys as an
additional factor — means changing that one function and the verification screen,
not the cookie, the gate, or any route.

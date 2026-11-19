# Supabase support case (draft) — backend segfault on permission-denied function call by `anon`

**Status:** prepared, not yet submitted. Submit from the Supabase dashboard (Support → New ticket),
project `gpiqkwebizuqajgaoxhm`. Do **not** attempt to reproduce on the production project.

## Summary

On the Supabase Postgres image **`public.ecr.aws/supabase/postgres:17.6.1.111`** (local CLI stack,
x86_64), calling a SQL function that the `anon` role is **not** allowed to execute terminates the
backend with **signal 11 (segmentation fault)**. The postmaster then restarts every connection and
runs crash recovery. Any unauthenticated request to `/rest/v1/rpc/<function>` with the public
publishable key can trigger it, so this is an availability (denial-of-service) concern.

Production runs the same image version on aarch64 (`PostgreSQL 17.6 on aarch64-unknown-linux-gnu`,
same `shared_preload_libraries`). We have **not** tested production and will not.

## Minimal reproduction (local CLI stack, `supabase start`)

```sql
create or replace function public.zz_crash_probe() returns int language sql as 'select 1';
revoke all on function public.zz_crash_probe() from public, anon, authenticated;

begin;
set local role anon;
select public.zz_crash_probe();   -- expected: ERROR permission denied for function
rollback;                          -- actual: "server closed the connection unexpectedly"
```

Postgres log:

```
LOG:  server process (PID …) was terminated by signal 11: Segmentation fault
DETAIL:  Failed process was running: … select public.zz_crash_probe() …
LOG:  terminating any other active server processes
LOG:  all server processes terminated; reinitializing
```

The same happened through PostgREST: `POST /rest/v1/rpc/vyron_company_directory_ids` with the
anon key (function revoked from `anon`) — 18 crashes in one afternoon of browser testing, e.g.
`2026-11-19 06:16:38 UTC` onwards. Calling the same function as `authenticated` (granted) does
not crash. Disabling JIT (`jit = off`, as in production) did not change the behaviour.

## Environment

- Image: `public.ecr.aws/supabase/postgres:17.6.1.111` (Supabase CLI 2.110.0, Docker Desktop, Windows 11, x86_64)
- `shared_preload_libraries`: `pg_stat_statements, pgaudit, plpgsql, plpgsql_check, pg_cron, pg_net, pgsodium, auto_explain, pg_tle, plan_filter, supabase_vault`
- The `anon` role holds no EXECUTE on public functions by design (least privilege).

## What we observed in production (read-only)

- Cumulative statistics (`pg_stat_statements_info`, `pg_stat_checkpointer`, `pg_stat_io`) were last
  reset at `2026-10-12 08:13:18 UTC`, just before the postmaster start (`08:13:42`). On the local
  stack, every crash reset these within seconds, so production shows **no crash recovery since
  2026-10-12**. However nobody signed in to production after 2026-10-11, so the code path that
  makes the anonymous call was not exercised. The evidence is therefore inconclusive.

## Questions for Supabase

1. Is this a known defect in 17.6.1.111 (e.g. in `plan_filter`, `pgaudit` or `supautils` error
   handling for permission-denied function calls)? Is it fixed in a later image?
2. Does it affect the aarch64 build used by hosted projects?
3. Please check project `gpiqkwebizuqajgaoxhm`'s Postgres logs for `terminated by signal 11`,
   in particular between 2026-09-26 and 2026-10-12 (when users last signed in).

## Mitigation in UMORA (independent of the answer)

- The application release no longer makes any RPC call before a user is signed in
  (`lib/company-master.ts` guard in the Company Master work; the release build excludes Company
  Master altogether).
- Option to discuss: grant EXECUTE to `anon` on harmless functions that only return data for
  `auth.uid()` (they return nothing for anonymous callers), so a stray anonymous call is denied
  logically instead of by privilege.

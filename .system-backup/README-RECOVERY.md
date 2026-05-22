# System backup & recovery

This folder is an **infrastructure snapshot** for disaster recovery. It is intentionally tracked in git so operators can restore production coordinates without hunting through dashboards—but that also means **anyone with repo access can read production secrets**.

## Security warning

- **`.system-backup/vercel-production-env.txt` contains production credentials.** Treat this repository like a secrets vault.
- Do not share the repo publicly, fork to untrusted accounts, or paste these values into chat or tickets.
- Rotate keys in Supabase and Vercel if this file or the repo may have been exposed.
- Prefer Vercel **encrypted** environment variables as the live source of truth; this file is a backup copy only.

---

## Git (source code)

| Item | Value |
|------|--------|
| Remote | `https://github.com/VYRONDEPLOY/vyron-app-core.git` |
| Default branch | `main` (tracks `origin/main`) |

Verify at any time:

```bash
git remote -v
git branch -vv
```

Clone or re-link:

```bash
git clone https://github.com/VYRONDEPLOY/vyron-app-core.git
cd vyron-app-core
git checkout main
git pull origin main
```

---

## Vercel (hosting)

| Item | Value |
|------|--------|
| Platform | Vercel (manual production project container) |
| Project | `vyron-app-core` (Gerhard VS team) |
| Production domain | **https://core.vyronsoft.co.za** |
| Env source of truth | Vercel Dashboard → Project → Settings → Environment Variables → **Production** |

### Restore environment variables

1. Open [Vercel](https://vercel.com) → team **gerhard-vs-s-projects** → project **vyron-app-core**.
2. Settings → Environment Variables → **Production**.
3. Copy each line from `.system-backup/vercel-production-env.txt` into matching keys (no quotes required in Vercel UI unless your workflow uses them).
4. **Redeploy** Production after saving (Deployments → … → Redeploy, or push to `main` if CI deploy is enabled).

Optional CI secret (GitHub Actions): `NEXT_PUBLIC_SUPABASE_ANON_KEY` in repo secrets must match Production if you use the deploy workflow.

---

## Supabase (database & auth)

| Status | Project ref | URL |
|--------|-------------|-----|
| **DEAD / deprecated** | `ujgnhcwertihoqjgaofn` | Do **not** use. Keys and JWTs issued for this ref will fail against the active project. |
| **Active (production)** | `gpiqkwebizuqajgaoxhm` | `https://gpiqkwebizuqajgaoxhm.supabase.co` |

Canonical in-repo documentation: **[`ACTIVE_SUPABASE.md`](../ACTIVE_SUPABASE.md)** at the repository root.

### Required production variables

| Variable | Purpose |
|----------|---------|
| `NEXT_PUBLIC_SUPABASE_URL` | Active project API URL (`gpiqkwebizuqajgaoxhm`) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Publishable (anon) key for the **same** project |
| `CACHE_BUST_TRIGGER` | Bump to force cache invalidation on deploy (e.g. `1`) |

### Anon key in this backup

- **`vercel-production-env.txt` may contain an incomplete anon key** (prefix only). The full publishable key must match project `gpiqkwebizuqajgaoxhm`.
- If `.env.local` on a machine still holds a **JWT** anon key whose payload references `ujgnhcwertihoqjgaofn`, that key is **stale**—replace it from Supabase Dashboard → Project **gpiqkwebizuqajgaoxhm** → Settings → API → **anon / publishable** key, or copy the complete value from Vercel Production env.
- Paste the **full** `sb_publishable_…` (or current anon key format) into both Vercel Production and this backup file after recovery.

### Optional: service role key

`SUPABASE_SERVICE_ROLE_KEY` is **not** included in `vercel-production-env.txt` because it was not present in local `.env.local` at backup time. Server-only routes that need elevated access require it in Vercel Production (never expose as `NEXT_PUBLIC_*`). Add a line to the backup file only if you deliberately store it here and accept the security tradeoff.

---

## Recovery checklist (ordered)

1. **Git** — Clone or pull `main` from `github.com/VYRONDEPLOY/vyron-app-core`.
2. **Supabase** — Confirm dashboard access to project **gpiqkwebizuqajgaoxhm**; rotate keys if compromised.
3. **Vercel** — Restore Production env vars from `vercel-production-env.txt` (complete the anon key if truncated).
4. **Redeploy** — Trigger a Production deployment on Vercel.
5. **Verify** — `GET https://core.vyronsoft.co.za/api/vyron/health` should report `supabaseHost: "gpiqkwebizuqajgaoxhm.supabase.co"` and `supabaseConfigOk: true` (see `ACTIVE_SUPABASE.md`).

---

## What this backup does *not* include

- Vercel project linking tokens, OIDC, or team membership (re-auth via Vercel UI).
- Supabase database dumps or storage buckets (use Supabase backups / PITR separately).
- DNS records for `core.vyronsoft.co.za` (restore at your DNS provider if needed).
- Application code (use git).

---

## Maintaining this backup

After any Production env change in Vercel:

1. Update `vercel-production-env.txt` with the exact Production values.
2. Commit: `chore: refresh system backup env snapshot`
3. Push to `main` (or your ops branch policy).

Never commit `.env.local`, `.env.production`, or other gitignored secret files—only this controlled `.system-backup/` path.

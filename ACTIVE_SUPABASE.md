# VYRON CORE ACTIVE SUPABASE

**Do not use or revert to deprecated projects (`ujgnhcwertihoqjgaofn`, `gpiqkwebizuqajgaoxhm`).**

## Production coordinates (current)

| Field | Value |
|-------|--------|
| **Project Name** | VYRON CORE PRODUCTION |
| **Project Ref** | `ldnrmgafsquzfitcuvxq` |
| **Project URL** | `https://ldnrmgafsquzfitcuvxq.supabase.co` |
| **Host** | `ldnrmgafsquzfitcuvxq.supabase.co` |

## Environment variables

| Variable | Value / notes |
|----------|----------------|
| `NEXT_PUBLIC_SUPABASE_URL` | `https://ldnrmgafsquzfitcuvxq.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Publishable anon key from the **same** project (`ldnrmgafsquzfitcuvxq`). Set in Vercel → Production and local `.env.local` only — never commit. |

### Important

- `NEXT_PUBLIC_SUPABASE_URL` must be exactly `https://ldnrmgafsquzfitcuvxq.supabase.co`
- Do **not** include `/rest/v1/` in the URL value
- Do **not** prefix with `URL=` inside the value
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` must match the same project ref
- Vercel hides saved env values after save; if unsure, copy fresh values from Supabase → Project Settings → API and overwrite

## Where secrets live

- **Vercel:** Project → Settings → Environment Variables → Production
- **Local dev:** `.env.local` (gitignored)
- **Templates:** `.env.production.example`, `.env.example` (placeholders only)

## VYRON DEV Phase 3 tables

After deploying app env vars, run `sql/011-vyron-dev-phase3.sql` in the Supabase SQL Editor to create:

- `vyron_clients`
- `vyron_client_products`
- `vyron_product_workspaces`
- `vyron_product_packages`
- `vyron_support_sessions`
- `vyron_client_integrations`
- `vyron_product_deployments`

VYRON DEV falls back to localStorage when these tables are missing or unreachable.

## Verify after deploy

`GET /api/vyron/health` should report `supabaseHost: "ldnrmgafsquzfitcuvxq.supabase.co"` and `supabaseConfigOk: true`.

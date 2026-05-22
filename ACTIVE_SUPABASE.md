# Active Supabase production project

**Do not use or revert to the deprecated project `ujgnhcwertihoqjgaofn`.**

## Production coordinates (current)

| Variable | Value |
|----------|--------|
| `NEXT_PUBLIC_SUPABASE_URL` | `https://gpiqkwebizuqajgaoxhm.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Set in **Vercel → Production** and local `.env.local` only (publishable key; never commit the full value) |

Host: `gpiqkwebizuqajgaoxhm.supabase.co`

## Where secrets live

- **Vercel:** Project → Settings → Environment Variables → Production
- **Local dev:** `.env.local` (gitignored)
- **Templates:** `.env.production.example`, `.env.example` (placeholders only)

## Verify after deploy

`GET /api/vyron/health` should report `supabaseHost: "gpiqkwebizuqajgaoxhm.supabase.co"` and `supabaseConfigOk: true`.

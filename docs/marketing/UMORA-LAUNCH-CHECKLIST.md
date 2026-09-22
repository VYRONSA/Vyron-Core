# UMORA public site — launch checklist

What the public marketing site needs in production, and what is still outstanding.
Photography sources and licences are recorded separately in
[UMORA-MEDIA-LICENSES.md](./UMORA-MEDIA-LICENSES.md).

## Environment variables

Secrets live in Vercel → Settings → Environment Variables. No secret belongs in a
file in this repository; `.env`, `.env.local` and `.env.production` are
git-ignored, and only `.env.example` / `.env.production.example` are committed.

### Required in production

| Variable | Used for | Notes |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Auth check in the marketing layout (signed-in visitors are sent to the dashboard) | Public by design. Build fails without it. |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | As above | Public by design (anon key, RLS-protected). Build fails without it. |
| `NEXT_PUBLIC_SITE_URL` | Canonical URLs, Open Graph URLs, `sitemap.xml`, `robots.txt` | **Set this.** Without it everything falls back to `https://www.vyroncore.com`. If UMORA launches on its own domain, canonical and share URLs are wrong until this is set. |

### Required for the contact form (choose ONE channel)

| Variable | Used for | Notes |
|---|---|---|
| `UMORA_ENQUIRY_WEBHOOK_URL` | Posts each enquiry to a CRM / automation endpoint | Must be `https`. Server-side only. |
| `UMORA_ENQUIRY_WEBHOOK_TOKEN` | Bearer token so the receiver can authenticate the caller | Optional but recommended. **Secret.** |
| `RESEND_API_KEY` | Sends each enquiry as email via Resend's HTTP API | **Secret.** Never prefix with `NEXT_PUBLIC_`. |
| `UMORA_ENQUIRY_FROM` | Verified sender address for those emails | Domain must be verified in Resend. |
| `UMORA_ENQUIRY_TO` | Recipient override | Optional; defaults to the sales address. |

With neither channel configured the endpoint returns **503** and the form tells
the visitor to email sales directly. It never claims an enquiry was received
when it was not.

### Not used by the public site

`SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_SECRET_KEY`, `OPENAI_API_KEY`,
`WHATSAPP_*`, `PLATFORM_*`, `RR_QA_*` belong to the authenticated application
and its tooling. `PLATFORM_BOOTSTRAP_*` and `RR_QA_*` are development/provisioning
only and must not be set in production.

## Verifying enquiry delivery

```bash
npm run verify:enquiry                       # audit configuration only
npm run verify:enquiry -- --staging --send   # deliver one test enquiry to a staging receiver
npm run verify:enquiry -- --send             # production check: delivers one real test enquiry
```

The script fails closed, never prints a secret, and refuses to send if the
configuration points at localhost, a private address or an obvious test endpoint
(unless `--staging` is passed, which is not valid for production sign-off).

## Outstanding before launch

1. **Configure one enquiry delivery channel** and run `npm run verify:enquiry`.
2. **Set `NEXT_PUBLIC_SITE_URL`** to the domain the site will actually serve.

Photography is complete: every slot has an approved image, and no placeholder
remains. See [UMORA-MEDIA-LICENSES.md](./UMORA-MEDIA-LICENSES.md).

## Deliberately unchanged

- The authenticated application keeps its VYRON CORE identifiers, Supabase
  tables, API routes and Android package. The public site is UMORA; VYRONSOFT
  remains the company.
- Unknown URLs still follow the application's existing auth routing rather than
  the public 404. Changing that would mean changing authorization.

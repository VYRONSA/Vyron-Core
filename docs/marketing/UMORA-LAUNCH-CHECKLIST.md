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

## Configuring enquiry delivery (Resend → info@vyronsoft.co.za)

The destination is already `info@vyronsoft.co.za`: it is the default in
`lib/marketing/umora.ts` (`SALES_EMAIL`), so `UMORA_ENQUIRY_TO` only needs
setting if the destination ever changes. Nothing in the form or the endpoint
needs editing.

**1. Verify the sending domain in Resend.** Resend will only send from a domain
you control. Add `vyronsoft.co.za` under Resend → Domains and publish the DNS
records it gives you (DKIM, plus SPF/DMARC as prompted). Until the domain shows
as *Verified*, sending from `@vyronsoft.co.za` is rejected.

*If you want to test before DNS propagates:* Resend's shared sender
`onboarding@resend.dev` works without domain verification, but it can only
deliver to the email address that owns the Resend account — not to
`info@vyronsoft.co.za`. Use it as a smoke test only.

**2. Create an API key** in Resend with *Sending access* only. Copy it once.

**3. Set the variables in Vercel** (Project → Settings → Environment
Variables), scoped to Production, marked as secret, never committed:

| Variable | Value |
|---|---|
| `RESEND_API_KEY` | the key from step 2 |
| `UMORA_ENQUIRY_FROM` | `UMORA Website <website@vyronsoft.co.za>` (any address at the verified domain) |
| `UMORA_ENQUIRY_TO` | *optional* — omit to use `info@vyronsoft.co.za` |

Or from a terminal, with the Vercel CLI signed in:

```bash
vercel env add RESEND_API_KEY production      # paste the key when prompted
vercel env add UMORA_ENQUIRY_FROM production  # UMORA Website <website@vyronsoft.co.za>
```

`vercel env add` prompts for the value and stores it encrypted; the secret never
appears in a command line, a file or this repository.

**4. Confirm delivery** using the commands below. The check must print
`PASS`, and an email must actually arrive at `info@vyronsoft.co.za`.

## Verifying enquiry delivery

```bash
npm run verify:enquiry                       # audit configuration only
npm run verify:enquiry -- --staging --send   # deliver one test enquiry to a staging receiver
npm run verify:enquiry -- --send             # production check: delivers one real test enquiry

# Reading the key from a local .env.local instead of the shell environment
# (.env.local is gitignored; the script never prints secret values):
npm run verify:enquiry:local -- --send
```

Run these where the machine can reach `api.resend.com`. The script reads the
same variables the deployed site uses, so a `PASS` here means the deployed
endpoint will deliver too, provided the same values are set in Vercel.

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

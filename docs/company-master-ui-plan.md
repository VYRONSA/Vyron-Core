# Company Settings UI — implementation plan

Prepared 2026-09-07. **Not implemented.** Depends on `sql/098` being applied.

---

## 1. Field model, and where each field comes from today

Phase 7 survey of the CORE repository. "Current users" are the files that read
the field today.

| Field | Current source | Current users | Proposed source | Safe to migrate? |
|---|---|---|---|---|
| Legal name | `companies.name` | `_app-shell.tsx`, `hr-pdf-service.ts`, platform routes, Safety switcher | unchanged | ✅ already authoritative |
| Trading name | `companies.trading_name` | platform routes | unchanged | ✅ |
| Registration no. | `companies.registration_number` | `contract-intelligence.ts`, `hr-pdf-service.ts` | unchanged | ✅ |
| VAT number | **absent** | 6 files expect it (062) | `companies.vat_number` (098) | ✅ additive |
| Industry | **absent** | 14 files expect it (062) | `companies.industry` (098) | ✅ additive |
| General email | **absent** | — | `companies.email` (098) | ✅ new |
| Billing email | `companies.billing_email` | platform/billing | **unchanged, platform-controlled** | ⛔ do not repurpose |
| Phone | `companies.phone` | `_app-shell.tsx`, `hr-pdf-service.ts` | unchanged | ✅ |
| Website | **absent** | — | `companies.website` (098) | ✅ new |
| Primary contact | `companies.contact_person` | `_app-shell.tsx` | unchanged | ✅ |
| Physical address | `companies.physical_address` | `_app-shell.tsx`, `contract-intelligence.ts`, `hr-pdf-service.ts` | **retained**, structured fields alongside | ⚠️ keep both in sync |
| Postal address | **absent** | — | `companies.postal_address` (098) | ✅ new |
| Structured address | **absent** | 2 files expect it (062) | `companies.address_*` (098) | ✅ additive |
| Logo | **absent** | `hr-pdf-service.ts:115` probes `logo_url`/`logo_bucket`/`logo_path` against columns that have never existed | `companies.logo_bucket` + `logo_path` (098) | ✅ starts working with no code change |
| Company name (dup) | `company_settings.company_name` | **no reads found** in `app/` or `lib/` | leave; `companies.name` is authoritative | ⚠️ separate deliberate migration |

**Rule to adopt:** a module may reference `company_id`; no module may store
company identity. `company_settings.company_name` is the one existing
violation.

---

## 2. Route and placement

`app/(app)/settings/company/page.tsx` — CORE already has `app/(app)/settings`.
Safety's `/company` becomes a consumer of the same RPCs, not a second
implementation.

## 3. Data layer

```ts
// lib/company-master.ts   (new, server + client safe - RPC only, no table access)
export async function getCompany(supabase, companyId): Promise<CompanyMaster | null>
export async function updateCompany(supabase, companyId, patch): Promise<UpdateResult>
export async function uploadCompanyLogo(supabase, companyId, file): Promise<string>
export async function companyLogoUrl(supabase, company): Promise<string | null>
```

All four go through `vyron_get_company` / `vyron_update_company` and the
`company-branding` bucket. **No `.from("companies")` anywhere in the new code.**

`UpdateResult` mirrors the RPC: `{ ok, fields, rejected }` or
`{ ok: false, reason }`. `rejected` is surfaced, not swallowed — if the client
sends a field the server refuses, the user is told rather than shown a success
that did not happen.

## 4. Form model

Four groups, matching the RPC whitelist:

- **Company information** — legal name*, trading name, registration number, VAT number, industry
- **Contact** — general email, phone, website, primary contact
- **Addresses** — physical (multiline), postal (multiline), then structured line1/line2/city/region/postal code/country
- **Branding** — logo upload, timezone

\* required; everything else optional.

## 5. Validation — client mirrors server, server decides

| Field | Rule |
|---|---|
| Legal name | required, ≤ 200 chars |
| Email | `x@y.z` shape |
| Website | must start `http://` or `https://` |
| VAT | **country-aware**: ZA → 10 digits starting `4`; otherwise ≤ 32 chars |
| Timezone | must exist in `pg_timezone_names` |
| Logo path | server-enforced: `<company_id>/…`, no traversal |

Client validation is a courtesy that avoids a round trip. The RPC re-validates
everything and is the authority.

## 6. Permissions and the read-only state

`vyron_get_company()` returns `can_edit`. **This is a UX hint, not security.**

- `can_edit === true` → editable form with Save / Cancel.
- `can_edit === false` → the same fields rendered as a definition list, with a
  single line: *"Company information is managed by a company administrator."*

Never an editable form that fails on save. And never rely on hiding the button:
the RPC refuses regardless of what the client renders.

**Known gap on day one:** HSE Insight has no `company_users` row, so nobody
there can edit. See `sql/098-NOTES.md` §3.

## 7. Unsaved-changes protection

Dirty tracking against the loaded snapshot; `beforeunload` guard plus an
in-app confirm on navigate-away. Cancel restores the snapshot rather than
re-fetching, so a slow network cannot lose typed input.

## 8. Save feedback — honesty rules

- Success only when `ok === true`. The RPC's `fields` list drives the message:
  *"Saved: trading name, email."*
- `rejected` non-empty → a warning naming what was refused.
- Any raise → the message shown verbatim; the form stays dirty and editable.
- **Never** report success on a failed or partial save.

## 9. Logo flow

1. Client validates type and size (≤ 5 MB; png/jpeg/webp/svg).
2. Upload to `company-branding` at `<company_id>/logo.<ext>` — storage RLS
   independently requires administration authority.
3. On success call `updateCompany` with `logo_bucket` + `logo_path`.
4. Display via `createSignedUrl` (1 hour). **Never** a public URL, and never
   persist a signed URL — it outlives its access check.
5. If step 2 succeeds and step 3 fails, the object is orphaned: remove it and
   report the failure. Do not leave a logo the record does not point at.

## 10. Test plan for the UI layer

Unit: patch builder emits only whitelisted keys; dirty tracking; each validation
rule; `can_edit === false` renders no form control.
Integration: save success, save refused, partial rejection, network failure,
logo upload success, logo upload refused for a non-administrator.

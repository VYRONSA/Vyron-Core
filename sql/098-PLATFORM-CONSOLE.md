# Platform Console vs. live schema — findings and remediation plan

Investigated 2026-09-07. **Nothing was changed.** This is a separate workstream
from `sql/098`; it is documented here because 098's investigation surfaced it.

---

## 1. `sql/062` was never applied

`sql/062-platform-console-foundation.sql` adds ~30 columns to `public.companies`.
Every one was probed live against `gpiqkwebizuqajgaoxhm` on 2026-09-07 and is
**absent**: `vat_number`, `industry`, `company_size`, `time_zone`, `currency`,
`address_line1/2`, `address_city`, `address_region`, `address_postal_code`,
`plan_id`, `solution_template_id`, `user_limit`, `storage_limit_gb`,
`ai_credit_limit`, `api_request_limit`, `licence_expires_at`,
`billing_frequency`, `renewal_date`, `invoice_reference`, `payment_status`,
`customer_status`.

Live `companies` has 22 columns; 062 assumes roughly 50.

---

## 2. The Platform Console is broken in production

`app/api/platform/customers/route.ts:39`:

```ts
.from("companies")
.select("id,name,trading_name,industry,customer_status,plan_id,employee_limit,"
      + "enabled_modules,billing_frequency,renewal_date,licence_expires_at,created_at",
        { count: "exact" })
```

Six of those columns do not exist. PostgREST answers `42703 column ... does not
exist`, so **the customer list cannot load**. `.eq("customer_status", status)`
on line 48 fails for the same reason.

`PATCH /api/platform/customers/[companyId]` whitelists 30 `EDITABLE_FIELDS`, of
which roughly 20 do not exist. A PATCH touching only surviving columns works;
one touching `vat_number` or `address_line1` fails.

**Repository dependency on absent columns** (files referencing each):

| Column | Files | | Column | Files |
|---|---|---|---|---|
| `customer_status` | 14 | | `storage_limit_gb` | 8 |
| `industry` | 14 | | `user_limit` | 7 |
| `currency` | 14 | | `ai_credit_limit` | 7 |
| `vat_number` | 6 | | `plan_id` | 6 |
| `billing_frequency` | 5 | | others | 1–3 each |

---

## 3. A second, unrelated breakage: CORE's own company editor

`app/_app-shell.tsx` is a **client component** (`"use client"`, 19,444 lines)
and writes company details straight from the browser:

```ts
// app/_app-shell.tsx:6752
let updateResult = await supabase.from("companies").update(withProfile).eq("id", entry.id);
```

writing `contact_person`, `phone`, `physical_address`, and elsewhere `status`,
`subscription_status`, `subscription_tier`, `monthly_fee`.

Live `public.companies` RLS has **exactly one policy, `SELECT`**. There is no
UPDATE policy for `authenticated`. Every one of those writes is therefore
refused by RLS and surfaces to the user as `alert("Save failed: …")`.

The file already carries a fallback for *missing columns*
(`isMissingCompaniesProfileColumnError`), which suggests the schema drift has
been felt before and worked around rather than resolved.

**This means CORE company editing is as broken as Safety company reading, for
the same underlying reason.** `sql/098`'s `vyron_update_company()` is the fix
for both — it is not a Safety-only convenience.

---

## 4. Why 062 should not simply be re-run

1. **It bundles two unrelated concerns.** Company *identity* (VAT, industry,
   address) and *commercial* state (plan, licence, limits, billing) arrive in
   one migration. 098 takes only the identity half, deliberately, because that
   half is what modules consume and what a company administrator may edit.
2. **It predates the Company Master decision.** It treats `companies` as the
   Platform Console's table. The approved architecture treats it as the shared
   VYRON master with a controlled interface.
3. **Column-name collisions with 098.** 062 adds `time_zone` while live already
   has `timezone`; it adds `currency`, which 098 does not. Running both without
   reconciling would leave two timezone columns and no rule about which wins.
4. **`customer_status NOT NULL DEFAULT 'trial'`** would stamp every existing
   company as `trial` — a commercial-state change to live data, disguised as a
   schema change.

---

## 5. Recommended remediation, in order

**Step 1 — apply 098.** It delivers `vat_number`, `industry`, and the
structured `address_*` columns. That alone un-breaks part of the Platform
Console's select list, and gives CORE a working company editor.

**Step 2 — audit what the Console actually needs.** Split the remaining 062
columns into:
- *commercial state* — `plan_id`, `licence_expires_at`, `billing_frequency`,
  `renewal_date`, `invoice_reference`, `payment_status`, `user_limit`,
  `storage_limit_gb`, `ai_credit_limit`, `api_request_limit`;
- *lifecycle* — `customer_status`, `solution_template_id`;
- *duplicates to drop from the plan* — `time_zone` (live has `timezone`),
  `company_size`, `currency` (decide, do not assume).

**Step 3 — write `099-platform-console-commercial.sql`** covering only the
commercial and lifecycle sets, with `customer_status` **nullable** or defaulted
from existing `subscription_status` rather than blanket `'trial'`.

**Step 4 — make the Console degrade honestly.** Today it 500s. A read-only
diagnostic fix is available with no database change: narrow the `.select()` to
columns that exist and render the absent ones as *"not configured"*. This is
safe, reversible and unblocks the screen before step 3 lands.

**Step 5 — move `_app-shell.tsx`'s company writes onto
`vyron_update_company()`**, deleting the client-side `.update()` calls. They
cannot work under current RLS and should not be made to work by adding an
UPDATE policy — a policy cannot express a field whitelist, and the table-level
`GRANT ... UPDATE ON companies TO authenticated` is already in place, so a
policy would open every column at once.

---

## 6. Not done, deliberately

- 062 was **not** applied, re-run, or edited.
- No Platform Console route was modified.
- No live schema change of any kind.
- Step 4's diagnostic fix was **not** implemented: it touches Platform Console
  routes, which are outside this session's scope, and it is better done with
  the Console's own tests in front of you.

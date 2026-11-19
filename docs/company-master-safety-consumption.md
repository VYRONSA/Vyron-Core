# VYRON SAFETY consumption of the Company Master

Prepared 2026-09-07. **Not implemented.** No Safety file was modified in this
session. Depends on `sql/098` being applied.

Safety production remains `dpl_CFjuYiZpidmtYzuvYQLEZ2dwL5Hj`, suite 1,097
assertions / 0 failures.

---

## 1. The problem this fixes

`public.companies` RLS is a single SELECT policy keyed on `company_users`.
A Safety user with a `safety_user_access` grant but no `company_users` row
matches nothing, so the row is invisible.

`vyron-safety/lib/access.ts:73` therefore fails:

```ts
const direct = await supabase.from('companies').select('id, name').in('id', missing());
```

Safety falls back to `companyLabel()`, which renders `Company d827b021`.
**Live confirmation:** HSE Insight has 1 Safety grant and 0 `company_users`
rows — it is exactly this case.

After 098, `vyron_company_directory_ids()` includes `safety_user_access`, and
`vyron_get_company()` returns the real name.

---

## 2. The minimal change

**One file, one function.** `vyron-safety/lib/access.ts`:

```ts
// Before - refused by RLS for a Safety-only user
const direct = await supabase.from('companies').select('id, name').in('id', missing());

// After - the Company Master read interface
const resolved = await Promise.all(
  missing().map(async (id) => {
    const { data } = await supabase.rpc('vyron_get_company', { p_company_id: id });
    return [id, data?.[0]?.name ?? null] as const;
  }),
);
apply(new Map(resolved));
```

Keep the existing tolerance: a company that still cannot be named falls back to
`companyLabel()`. The fallback stops being the normal path; it does not stop
existing.

## 3. What does NOT change

- `safety_user_access` — untouched. Safety authority stays Safety authority.
- Every Safety RLS policy, role and migration — untouched.
- `owningCompanyName()` — **unchanged, and its guard stays**. Report identity
  continues to resolve from the owning record, never the switcher. 098 changes
  where the *name* comes from, not which *company* a report belongs to.
- `mergeSafetyAccess()`, the switcher, `useAccess()` — unchanged shape.

## 4. Company Settings in Safety

`vyron-safety/app/(app)/company/page.tsx` gains real data and, for a CORE
administrator, editing — through the same RPCs as CORE. No Safety-side company
table, no duplicate profile.

For a Safety-only user `can_edit` is `false`, so the page stays read-only and
keeps its existing notice. Only its wording needs a small change: the current
*"managed centrally in VYRON CORE"* becomes accurate rather than a limitation —
it is now true of every module.

## 5. Tests to add on the Safety side

Domain (no database): the RPC response shape maps onto the access record;
a null name still falls back to `companyLabel()`; `can_edit === false` renders
read-only.

`check:security`: **no Safety source file may call `from('companies')`** — the
directory RPC is the only route in. This is the guard that stops the old
pattern creeping back.

`qa:live`: a real company name resolves for both companies on the account;
`can_edit` matches the caller's `company_users` role; a cross-company
`vyron_get_company()` call is refused.

## 6. Order of operations

1. Apply 098 to a non-production database; run `sql/test-harness/098-…`.
2. Apply 098 to live via CORE's paste process.
3. Confirm `vyron_get_company()` answers for a Safety user.
4. Then, and only then, change `lib/access.ts`.
5. Run the full Safety suite — it must stay at 1,097 or rise. Deploy.

Safety must not be changed before 098 is live: the RPC would not exist and
`access.ts` would throw where it currently degrades gracefully.

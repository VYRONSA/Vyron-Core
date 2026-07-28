# Operator Guide

## Getting platform-operator access

Access is granted by setting `app_metadata.role` (or `.roles[]`) to one of
`super_admin`, `platform_admin`, `platform_operator`, or `"supervisor tools"` on a
Supabase Auth user — via the Supabase dashboard or Admin API. This field is
**not** self-editable by the user (unlike `user_metadata`), by design.

## Provisioning a new customer

`/platform/customers/new` → pick an industry template (optional) → pick a plan
(Starter/Professional/Enterprise/Custom) → review/adjust the pre-selected
modules → set licence limits → enter the Primary Administrator's details → review
→ Provision. Leave "Send an email invitation" checked unless you have a specific
reason to set a temporary password directly.

## Day-to-day lifecycle actions

- **Suspend/Reactivate/Cancel**: Customer Overview → Licence & Billing → Customer
  Status dropdown. Suspending immediately blocks that customer's sign-in
  (enforced server-side, not just hidden in the UI).
- **Delete**: Customer Overview → Delete button. This is a **soft** delete
  (`deleted_at`) — the customer disappears from the default directory but all
  data is retained and can be restored (`DELETE .../[id]?restore=1`, or ask a
  developer to run it).
- **Module changes**: Customer Overview → Module Management — toggle, then Save.

## Support Centre

Search for a customer, then: add a support note, reset a user's password, unlock
an account, resend an invitation, generate a temporary administrator, or start a
**"Login As Customer"** session (fully audited — an amber banner appears
platform-wide until you end it).

## Maintenance Mode

`/platform/system` → Maintenance Mode. Enabling it immediately redirects every
non-platform-operator to a branded maintenance page platform-wide. Set an
**Emergency Override Code** in advance if you might need a specific person to
bypass it without operator access — they enter it on the maintenance page itself
(grants 4 hours of access).

## Before inviting pilot customers — stabilization checklist

Run through this as if you were your first customer, end to end:

1. Provision a new company (with a template + plan).
2. Confirm the administrator invite email arrives (or, if a temporary password
   was set, that it works) and they can log in.
3. Create employees, test clocking, leave, document generation, and AI features
   inside that tenant.
4. Suspend the company from the Platform Console and confirm the tenant is
   immediately locked out (both page navigation and API calls).
5. Reactivate and confirm normal access resumes.
6. Check the customer's Audit Trail and Timeline reflect every action taken
   above.

This kind of full walkthrough surfaces integration gaps that a passing build or
isolated feature test won't — do it before any real customer sees the platform.

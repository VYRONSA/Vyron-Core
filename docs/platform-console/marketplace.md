# Marketplace (Solution Templates)

`solution_templates` rows model an industry preset. Selecting one in the Create
Customer wizard (step 1) auto-applies:

- `default_modules` — unioned with the chosen plan's `modules` when computing
  `companies.enabled_modules`.
- `default_permissions`, `default_workflows`, `dashboard_widgets`,
  `suggested_ai_assistants` — all jsonb, surfaced read-only today in
  `MarketplacePanel.tsx` as configuration metadata attached to the template. They
  are **not yet consumed** by any runtime permission/workflow/dashboard-widget
  system elsewhere in the app (no such systems currently read them) — they exist
  so a template fully describes its intended configuration without requiring a
  schema change when those systems are built.

## Adding a new industry — no schema change required

Insert a row into `solution_templates` (via `/platform/marketplace`'s API,
`POST /api/platform/templates`, or directly in SQL) with a new `code`. The 10
seeded industries (`sql/062`) are data, not hard-coded logic — Manufacturing,
Construction, Hospitality, Retail, Agriculture, Transport & Logistics, Security,
Healthcare, Education, Towing & Recovery — and a new one slots in the same way.

## Why Marketplace ≠ VYRON DEV

VYRON DEV's `vyron_clients`/`vyron_client_products` model a different thing:
VYRON's own multi-product portfolio (CORE, COST, PAY, FARM, MAINT, REACH,
FINANCE, BUILD — separate VYRON apps). Marketplace templates are about
industry-specific configuration *within* CORE. See `architecture.md`.

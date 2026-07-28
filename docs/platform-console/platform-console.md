# Platform Console — Feature Tour

Route: `/platform` (and sub-routes below). Restricted to the `platform_operator`
role end-to-end (middleware + every API route).

| Section | Route | What it does |
|---|---|---|
| Dashboard | `/platform` | Customer counts by status, MRR/ARR, licence utilisation, recent sign-ups, system health |
| Customers | `/platform/customers` | Searchable/filterable/paginated directory with Health Score badges |
| Create Customer | `/platform/customers/new` | 7-step wizard: Industry → Plan → Modules → Licence Limits → Administrator → Review → Provision |
| Customer Overview | `/platform/customers/[id]` | Profile, usage gauges, modules, licence & billing, users, recent logins, timeline, audit trail, delete/restore |
| Marketplace | `/platform/marketplace` | Industry Solution Templates — modules, permissions, workflows, dashboard widgets, suggested AI assistants |
| Subscription Plans | `/platform/plans` | Starter/Professional/Enterprise pricing & limits editor |
| Module Management | `/platform/modules` | Data-driven module registry (status, requires-enterprise/AI-credits, per-module limits, version) |
| Platform Intelligence | `/platform/intelligence` | Revenue growth, new customers/month, industry distribution, churn, module popularity |
| Support Centre | `/platform/support` | Customer lookup, support notes, password reset, unlock account, resend invite, generate temp admin, diagnostics, impersonation |
| System | `/platform/system` | Platform defaults & contact, maintenance mode, feature flags, notification preferences, announcements, release notes, terms/privacy, queue monitoring, health |

Global elements on every `/platform/*` page: header search
(`PlatformGlobalSearch` — companies/users/employees), notifications bell
(`PlatformNotificationsBell` — computed alerts, not a delivery pipeline), and
(app-wide, not just `/platform`) the impersonation banner
(`ImpersonationBanner`) when a support session is active.

See `customer-provisioning.md`, `subscription-engine.md`, and `marketplace.md`
for the deeper mechanics behind the wizard, plans, and templates.

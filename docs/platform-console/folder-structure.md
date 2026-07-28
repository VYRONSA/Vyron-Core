# Folder Structure

```
app/
  (app)/
    layout.tsx                     Shared protected-app layout — renders ImpersonationBanner
    platform/
      layout.tsx                   Platform Console nav (5 sections), global search, notif bell
      page.tsx                     Dashboard
      customers/
        page.tsx                   Directory
        new/page.tsx               Create Customer wizard
        [companyId]/page.tsx       Customer Overview (server component, passes companyId down)
      marketplace/page.tsx
      plans/page.tsx
      modules/page.tsx
      intelligence/page.tsx
      support/page.tsx
      system/page.tsx
      templates/page.tsx           Redirects to /platform/marketplace (renamed section)
  maintenance/
    page.tsx                       Branded maintenance screen (public route)
  api/
    platform/
      _shared.ts                   requirePlatformOperator() — the shared gate
      dashboard/route.ts
      customers/route.ts
      customers/[companyId]/route.ts
      customers/[companyId]/modules/route.ts
      customers/[companyId]/status/route.ts
      plans/route.ts
      templates/route.ts
      modules/route.ts
      intelligence/route.ts
      search/route.ts
      notifications/route.ts
      maintenance-override/route.ts
      support/
        notes/route.ts
        impersonate/route.ts
        reset-password/route.ts
        unlock-account/route.ts
        resend-invite/route.ts
        temp-admin/route.ts
        diagnostics/route.ts
      system/
        feature-flags/route.ts
        settings/route.ts
        announcements/route.ts
        release-notes/route.ts
        queues/route.ts
        health/route.ts

components/platform/               UI — one file per screen/section (PlatformPanel and
                                    PlatformStatTile are the shared visual primitives)

lib/platform/                      Pure logic + server helpers:
  metrics.ts                       Revenue/growth/churn/health-score-input calculations
  health-score.ts                  Customer Health Score
  timeline.ts                      Customer Timeline builder
  provision-customer.ts            Customer creation orchestration
  settings.ts                      Platform defaults / notification thresholds readers
  maintenance-mode.ts               Maintenance status read + override validation (RPC calls)
  impersonation.ts                 Start/end impersonation session + audit log
  impersonation-context.ts         Cookie → active session lookup (used by _shared.ts)
  email-templates.ts               Branded HTML template content (not wired to a sender)
  notifications-dispatch.ts        Logs a rendered template to platform_job_queue
  job-queue.ts                     platform_job_queue insert helper
  module-catalog.ts                Static module code→label fallback (display only)
  platform-client.ts               Client-side platformFetch() bearer-auth wrapper

lib/server/
  platform-operator.ts             Single source of truth for the platform-operator claim set
  auth-routing.ts                  Route protection tables + role resolution (extended)
  authorization.ts                 Middleware auth context resolver (extended)

middleware.ts                      Route gating + maintenance-mode redirect (extended)

sql/062, 063, 064-*.sql            Platform Console schema (see migrations.md)

docs/platform-console/             This documentation set
```

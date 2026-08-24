"use client";

import React from "react";
import Link from "next/link";
import { canAccessRouteForRole } from "@/lib/server/auth-routing";
import { useRoadRecoveryCompany } from "@/lib/road-recovery/use-company";
import { RRError, RRLoading } from "@/components/road-recovery/ui";

/**
 * Chrome for the standalone Road & Recovery routes.
 *
 * Deliberately independent of app/_app-shell.tsx: this vertical adds no screens to that
 * 19,000-line client component, which loads every other domain on mount.
 *
 * Visually it is NOT independent. The header gradient, eyebrow, card radii and label
 * treatment are the same tokens the CORE shell uses, so moving between VYRON CORE and
 * Road & Recovery reads as one product rather than two.
 */
export type RoadRecoveryTab =
  | "dispatch"
  | "bystand"
  | "live"
  | "driver"
  | "compliance"
  | "exceptions"
  | "requirements"
  | "yards"
  | "billing"
  | "intelligence"
  | "targets"
  | "notifications";

/**
 * Short descriptions used as the page subtitle, so every board states its own purpose.
 *
 * Exported because the mobile shell builds its Road & Recovery drawer section from the
 * SAME list. One source of truth means a tab can never exist on desktop and be missing
 * on mobile, or carry two different descriptions.
 */
export const TAB_META: Record<RoadRecoveryTab, { label: string; href: string; blurb: string }> = {
  dispatch: {
    label: "Dispatch Board",
    href: "/road-recovery/dispatch",
    blurb: "Authorise, assign and track recovery jobs from callout to closure.",
  },
  bystand: {
    label: "BYSTAND",
    href: "/road-recovery/bystand",
    blurb: "Standing-time attendance: pause, resume, SAPS handover and stand-down.",
  },
  live: {
    label: "Live Operations",
    href: "/road-recovery/live",
    blurb: "Every active job and crew position on one wall.",
  },
  driver: {
    label: "My Jobs",
    href: "/road-recovery/driver",
    blurb: "The driver's view: accept, travel, arrive, capture evidence, complete.",
  },
  compliance: {
    label: "Compliance",
    href: "/road-recovery/compliance",
    blurb: "Whether a job can be billed, and precisely what is missing if it cannot.",
  },
  exceptions: {
    label: "Exceptions",
    href: "/road-recovery/exceptions",
    blurb: "Operational exceptions ordered by severity, with their resolution trail.",
  },
  requirements: {
    label: "Requirements",
    href: "/road-recovery/requirements",
    blurb: "The evidence and authority each service must carry before it closes.",
  },
  yards: {
    label: "Yards",
    href: "/road-recovery/yards",
    blurb: "Custody locations and storage capacity for recovered vehicles.",
  },
  billing: {
    label: "Billing",
    href: "/road-recovery/billing",
    blurb:
      "Billing information for review. VYRON CORE prices the work; it never issues an invoice.",
  },
  intelligence: {
    label: "Intelligence",
    href: "/road-recovery/intelligence",
    blurb: "What happened, why, what it costs, what to do next and who owns it.",
  },
  targets: {
    label: "Targets",
    href: "/road-recovery/targets",
    blurb: "SLA thresholds the Intelligence Centre measures every job against.",
  },
  notifications: {
    // NOT "Notifications": VYRON CORE already has an item by that name in the same mobile
    // drawer, and two identical labels one above the other is a guessing game. "Job Alerts"
    // says what this list is about.
    label: "Job Alerts",
    href: "/road-recovery/notifications",
    blurb: "Offers, driver responses, authorisations and escalations as they happen.",
  },
};

export const TAB_ORDER: RoadRecoveryTab[] = [
  "dispatch",
  "bystand",
  "live",
  "driver",
  "compliance",
  "exceptions",
  "requirements",
  "yards",
  "billing",
  "intelligence",
  "targets",
  "notifications",
];

export default function RoadRecoveryShell({
  active,
  children,
}: {
  active: RoadRecoveryTab;
  children: (companyId: string) => React.ReactNode;
}) {
  const { companyId, role, loading, error } = useRoadRecoveryCompany();

  const allTabs = TAB_ORDER.map((key) => ({ key, ...TAB_META[key] }));

  /**
   * Only the tabs this role can actually open.
   *
   * A driver is an employee, and middleware.ts lets an employee reach
   * /road-recovery/driver and nothing else in this vertical — so every other tab bounced
   * them to /dashboard. Showing a control that cannot work is worse than not showing it,
   * and the same function the middleware decides with is used here, so the nav and the
   * boundary can never disagree.
   */
  const tabs = role ? allTabs.filter((tab) => canAccessRouteForRole(role, tab.href)) : allTabs;
  const current = TAB_META[active];

  return (
    <main className="min-h-screen bg-[#f6f8fb] text-slate-950">
      <div className="mx-auto max-w-[1600px] space-y-5 p-4 md:p-8">
        {/* Hero — same gradient, eyebrow and type scale as the VYRON CORE Header. */}
        <header className="rounded-[34px] bg-gradient-to-r from-[#07101f] to-[#0b1a33] p-6 text-white shadow-2xl shadow-slate-300 md:p-7">
          <div className="flex flex-col gap-5">
            <div className="flex flex-wrap items-center gap-3">
              <Link
                href="/dashboard"
                className="vyron-focus-ring inline-flex items-center gap-2 rounded-xl bg-white/10 px-3 py-2 text-xs font-black uppercase tracking-[0.18em] text-white transition hover:bg-white/20"
              >
                <span aria-hidden="true">←</span> VYRON CORE
              </Link>
              <span className="text-xs font-bold uppercase tracking-[0.4em] text-cyan-300">
                Road &amp; Recovery
              </span>
            </div>

            <div className="min-w-0">
              <h1 className="text-3xl font-bold tracking-tight md:text-4xl">{current.label}</h1>
              <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-300">{current.blurb}</p>
            </div>
          </div>
        </header>

        {/*
          Tab bar. Horizontally scrollable rather than wrapping: eleven tabs wrap into three
          ragged rows on a laptop, which pushes the board below the fold. Scrolling keeps the
          header a fixed height at every width, and the row is keyboard reachable.
        */}
        <nav
          aria-label="Road & Recovery sections"
          className="-mx-1 overflow-x-auto overscroll-x-contain px-1 pb-1 [scrollbar-width:thin]"
        >
          <ul className="flex min-w-max items-center gap-2">
            {tabs.map((tab) => {
              const isActive = tab.key === active;
              return (
                <li key={tab.key}>
                  <Link
                    href={tab.href}
                    aria-current={isActive ? "page" : undefined}
                    className={`vyron-focus-ring inline-flex whitespace-nowrap rounded-2xl px-4 py-2.5 text-sm font-black transition ${
                      isActive
                        ? "bg-slate-900 text-cyan-300 shadow-[0_10px_24px_rgba(15,23,42,0.22)]"
                        : "border border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50"
                    }`}
                  >
                    {tab.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>

        {loading ? (
          <RRLoading label="Loading Road &amp; Recovery workspace" />
        ) : error ? (
          <RRError message={error} />
        ) : (
          children(companyId)
        )}
      </div>
    </main>
  );
}

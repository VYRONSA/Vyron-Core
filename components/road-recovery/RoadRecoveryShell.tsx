"use client";

import React from "react";
import Link from "next/link";
import { canAccessRouteForRole } from "@/lib/server/auth-routing";
import { useRoadRecoveryCompany } from "@/lib/road-recovery/use-company";

/**
 * Minimal chrome for the standalone Road & Recovery routes.
 *
 * Deliberately independent of app/_app-shell.tsx: this vertical adds no screens to that
 * 19,000-line client component, which loads every other domain on mount.
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
  | "targets";

export default function RoadRecoveryShell({
  active,
  children,
}: {
  active: RoadRecoveryTab;
  children: (companyId: string) => React.ReactNode;
}) {
  const { companyId, role, loading, error } = useRoadRecoveryCompany();

  const allTabs: { key: RoadRecoveryTab; label: string; href: string }[] = [
    { key: "dispatch", label: "Dispatch Board", href: "/road-recovery/dispatch" },
    // BYSTAND gets its OWN board: it moves nothing, bills standing time and pauses, so
    // it does not belong as extra lanes on the tow board.
    { key: "bystand", label: "BYSTAND", href: "/road-recovery/bystand" },
    { key: "live", label: "Live Operations", href: "/road-recovery/live" },
    { key: "driver", label: "My Jobs", href: "/road-recovery/driver" },
    // Phase 3. Compliance is its own screen rather than extra panels bolted onto the
    // operational boards: the boards answer "where is the truck", these answer "can this
    // job be billed".
    { key: "compliance", label: "Compliance", href: "/road-recovery/compliance" },
    { key: "exceptions", label: "Exceptions", href: "/road-recovery/exceptions" },
    { key: "requirements", label: "Requirements", href: "/road-recovery/requirements" },
    // Phase 4. Yards are reference data for custody and storage, so they sit alongside
    // requirements rather than on an operational board.
    { key: "yards", label: "Yards", href: "/road-recovery/yards" },
    // Phase 5. Deliberately "Billing" and never "Invoicing": VYRON CORE produces billing
    // information and VYRON FINANCE issues the invoice.
    { key: "billing", label: "Billing", href: "/road-recovery/billing" },
    // Phase 6. The Operations Director view: what happened, why, what it costs, what to
    // do and who owns it. It reads the other tabs rather than duplicating them.
    { key: "intelligence", label: "Intelligence", href: "/road-recovery/intelligence" },
    // Operator Completion. The thresholds engine has been configurable since Phase 6 and
    // had no screen, so every tenant's Intelligence Centre read NO SLA CONFIGURED forever.
    // It sits last because it is set up once and then rarely visited.
    { key: "targets", label: "Targets", href: "/road-recovery/targets" },
  ];

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

  return (
    <main className="min-h-screen bg-[#f6f8fb] p-4 text-slate-950 md:p-8">
      <div className="mx-auto max-w-[1600px] space-y-5">
        <nav className="flex flex-wrap items-center gap-2">
          <Link href="/dashboard" className="text-sm font-bold text-cyan-800 hover:text-cyan-950">
            ← VYRON CORE
          </Link>
          <span className="text-slate-300">|</span>
          {tabs.map((tab) => (
            <Link
              key={tab.key}
              href={tab.href}
              className={`rounded-xl px-3 py-1.5 text-sm font-bold ${
                tab.key === active
                  ? "bg-slate-900 text-cyan-300"
                  : "bg-white text-slate-700 hover:bg-slate-100"
              }`}
            >
              {tab.label}
            </Link>
          ))}
        </nav>

        {loading ? (
          <p className="text-sm font-semibold text-slate-500">Loading workspace…</p>
        ) : error ? (
          <p className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-800">
            {error}
          </p>
        ) : (
          children(companyId)
        )}
      </div>
    </main>
  );
}

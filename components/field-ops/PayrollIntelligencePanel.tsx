"use client";

import React, { useEffect, useState } from "react";
import {
  AlertTriangle,
  BarChart3,
  Brain,
  CalendarRange,
  CheckCircle2,
  ClipboardList,
  DollarSign,
  RefreshCcw,
  ShieldAlert,
  Sparkles,
  TrendingUp,
  Wallet,
} from "lucide-react";
import {
  leakageSeverityClass,
  loadPayrollIntelligence,
  readinessBandClass,
  type PayrollIntelligenceDashboard,
  type PayrollLeakageEvent,
  type PayrollReadinessCheck,
} from "@/lib/payroll-intelligence";
import { supabase } from "@/lib/supabase";

export type PayrollIntelligenceView =
  | "dashboard"
  | "readiness"
  | "leakage"
  | "forecast"
  | "exceptions";

type Props = {
  companyId: string;
  initialView?: PayrollIntelligenceView;
};

const VIEW_TABS: { id: PayrollIntelligenceView; label: string; icon: React.ElementType }[] = [
  { id: "dashboard", label: "Dashboard", icon: BarChart3 },
  { id: "readiness", label: "Readiness", icon: CheckCircle2 },
  { id: "leakage", label: "Leakage", icon: Wallet },
  { id: "forecast", label: "Forecast", icon: TrendingUp },
  { id: "exceptions", label: "Exceptions", icon: AlertTriangle },
];

function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function formatZar(value: number): string {
  return `R${Math.round(value).toLocaleString("en-ZA")}`;
}

function checkTypeLabel(type: PayrollReadinessCheck["checkType"]): string {
  const labels: Record<PayrollReadinessCheck["checkType"], string> = {
    missing_clock_out: "Missing clock-out",
    missing_clock_in: "Missing clock-in",
    unapproved_leave: "Unapproved leave",
    roster_mismatch: "Roster mismatch",
    unresolved_exception: "Unresolved exception",
    open_field_job: "Open field job",
    missing_end_day: "Missing end-day",
  };
  return labels[type];
}

function leakageTypeLabel(type: PayrollLeakageEvent["leakageType"]): string {
  const labels: Record<PayrollLeakageEvent["leakageType"], string> = {
    paid_not_worked: "Paid not worked",
    worked_not_approved: "Worked not approved",
    duplicate_hours: "Duplicate hours",
    overtime_without_approval: "OT without approval",
    travel_without_jobs: "Travel without jobs",
  };
  return labels[type];
}

export default function PayrollIntelligencePanel({
  companyId,
  initialView = "dashboard",
}: Props) {
  const [view, setView] = useState<PayrollIntelligenceView>(initialView);
  const [scoreDate, setScoreDate] = useState(todayIsoDate);
  const [loading, setLoading] = useState(true);
  const [syncNote, setSyncNote] = useState<string | null>(null);
  const [dashboard, setDashboard] = useState<PayrollIntelligenceDashboard | null>(null);

  useEffect(() => {
    setView(initialView);
  }, [initialView]);

  async function load() {
    if (!companyId) return;
    setLoading(true);
    setSyncNote(null);
    const result = await loadPayrollIntelligence(supabase, companyId, scoreDate);
    setDashboard(result.dashboard);
    if (result.error) setSyncNote(result.error);
    setLoading(false);
  }

  useEffect(() => {
    void load();
  }, [companyId, scoreDate]);

  const readinessChecks = dashboard?.readinessChecks || [];
  const exceptionChecks = readinessChecks.filter(
    (c) => c.checkType === "unresolved_exception"
  );

  return (
    <div className="space-y-6">
      <header className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-[10px] font-black uppercase tracking-[0.2em] text-cyan-700">
              VYRON CORE · Phase 7
            </p>
            <h1 className="mt-1 text-2xl font-black text-slate-950">Payroll Intelligence</h1>
            <p className="mt-2 max-w-2xl text-sm font-medium text-slate-600">
              Readiness scoring, leakage detection, and payroll forecast from clocking, leave,
              rosters, field ops, travel, cost &amp; risk signals.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="date"
              value={scoreDate}
              onChange={(e) => setScoreDate(e.target.value)}
              className="rounded-xl border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-800"
            />
            <button
              type="button"
              onClick={() => void load()}
              className="inline-flex items-center gap-2 rounded-xl bg-cyan-700 px-4 py-2 text-sm font-bold text-white hover:bg-cyan-800"
            >
              <RefreshCcw className="h-4 w-4" />
              Refresh
            </button>
          </div>
        </div>

        <nav className="mt-5 flex flex-wrap gap-2">
          {VIEW_TABS.map((tab) => {
            const Icon = tab.icon;
            const active = view === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setView(tab.id)}
                className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-bold transition ${
                  active
                    ? "border-cyan-700 bg-cyan-700 text-white"
                    : "border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100"
                }`}
              >
                <Icon className="h-3.5 w-3.5" />
                {tab.label}
              </button>
            );
          })}
        </nav>

        {syncNote ? (
          <p className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-900">
            Sync note: {syncNote} (dashboard still computed from live signals)
          </p>
        ) : null}
      </header>

      {loading ? (
        <p className="text-sm font-semibold text-slate-500">Computing payroll intelligence…</p>
      ) : !dashboard ? (
        <p className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-800">
          Unable to load payroll intelligence.
        </p>
      ) : (
        <>
          {(view === "dashboard" || view === "readiness") && (
            <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <p className="text-xs font-bold uppercase tracking-wider text-slate-500">
                  Readiness Score
                </p>
                <p className="mt-2 text-3xl font-black text-slate-950">
                  {dashboard.readinessScore}%
                </p>
                <span
                  className={`mt-2 inline-block rounded-full border px-2.5 py-1 text-[10px] font-black uppercase ${readinessBandClass(dashboard.readinessBand)}`}
                >
                  {dashboard.readinessBand}
                </span>
              </article>
              <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <p className="text-xs font-bold uppercase tracking-wider text-slate-500">Blockers</p>
                <p className="mt-2 text-3xl font-black text-rose-700">{dashboard.blockerCount}</p>
                <p className="mt-1 text-xs font-medium text-slate-500">
                  {dashboard.warningCount} warnings
                </p>
              </article>
              <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <p className="text-xs font-bold uppercase tracking-wider text-slate-500">
                  Leakage Exposure
                </p>
                <p className="mt-2 text-3xl font-black text-amber-700">
                  {formatZar(dashboard.totalLeakageZar)}
                </p>
                <p className="mt-1 text-xs font-medium text-slate-500">
                  {dashboard.leakageEvents.length} signal(s)
                </p>
              </article>
              <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <p className="text-xs font-bold uppercase tracking-wider text-slate-500">
                  Expected Payroll
                </p>
                <p className="mt-2 text-3xl font-black text-cyan-800">
                  {formatZar(dashboard.forecast.expectedPayroll)}
                </p>
                <p className="mt-1 text-xs font-medium text-slate-500">
                  {dashboard.forecast.variancePct !== null
                    ? `${dashboard.forecast.variancePct > 0 ? "+" : ""}${dashboard.forecast.variancePct}% vs model`
                    : "Variance n/a"}
                </p>
              </article>
            </section>
          )}

          {view === "dashboard" && (
            <>
              <section className="grid gap-4 lg:grid-cols-2">
                <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                  <div className="mb-4 flex items-center gap-2">
                    <CalendarRange className="h-5 w-5 text-cyan-700" />
                    <h2 className="text-sm font-black text-slate-900">Pay period</h2>
                  </div>
                  <p className="text-lg font-bold text-slate-800">{dashboard.payPeriod.label}</p>
                  <p className="text-sm text-slate-600">
                    {dashboard.payPeriod.periodStart} → {dashboard.payPeriod.periodEnd}
                  </p>
                  <p className="mt-2 text-xs font-semibold uppercase text-slate-500">
                    Status: {dashboard.payPeriod.status}
                  </p>
                </article>
                <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                  <div className="mb-4 flex items-center gap-2">
                    <ClipboardList className="h-5 w-5 text-cyan-700" />
                    <h2 className="text-sm font-black text-slate-900">Readiness checks</h2>
                  </div>
                  <p className="text-3xl font-black text-slate-900">{readinessChecks.length}</p>
                  <p className="mt-1 text-sm text-slate-600">
                    Across clocking, leave, roster, field ops &amp; exceptions
                  </p>
                </article>
              </section>

              <RecommendationsBlock recommendations={dashboard.recommendations} />
            </>
          )}

          {view === "readiness" && (
            <ChecksTable checks={readinessChecks} title="Payroll readiness checks" />
          )}

          {view === "leakage" && (
            <section className="space-y-4">
              <article className="rounded-2xl border border-amber-200 bg-amber-50 p-5">
                <p className="text-xs font-bold uppercase text-amber-800">Total leakage exposure</p>
                <p className="mt-1 text-3xl font-black text-amber-900">
                  {formatZar(dashboard.totalLeakageZar)}
                </p>
              </article>
              <LeakageTable events={dashboard.leakageEvents} />
            </section>
          )}

          {view === "forecast" && (
            <section className="space-y-4">
              <div className="grid gap-4 md:grid-cols-3">
                <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                  <p className="text-xs font-bold uppercase text-slate-500">Expected payroll</p>
                  <p className="mt-2 text-2xl font-black text-slate-900">
                    {formatZar(dashboard.forecast.expectedPayroll)}
                  </p>
                </article>
                <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                  <p className="text-xs font-bold uppercase text-slate-500">Variance</p>
                  <p className="mt-2 text-2xl font-black text-slate-900">
                    {dashboard.forecast.variancePct !== null
                      ? `${dashboard.forecast.variancePct}%`
                      : "—"}
                  </p>
                </article>
                <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                  <p className="text-xs font-bold uppercase text-slate-500">Leakage in forecast</p>
                  <p className="mt-2 text-2xl font-black text-amber-700">
                    {formatZar(dashboard.forecast.leakageExposure)}
                  </p>
                </article>
              </div>

              {dashboard.forecast.needsMoreData ? (
                <p className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-600">
                  Needs more data — connect payroll hours and field cost signals for a fuller forecast.
                </p>
              ) : null}

              <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <div className="mb-4 flex items-center gap-2">
                  <DollarSign className="h-5 w-5 text-cyan-700" />
                  <h2 className="text-sm font-black text-slate-900">Cost drivers</h2>
                </div>
                <div className="space-y-3">
                  {dashboard.forecast.costDrivers.map((d) => (
                    <div
                      key={d.label}
                      className="flex items-center justify-between gap-4 rounded-xl border border-slate-100 bg-slate-50 px-4 py-3"
                    >
                      <div>
                        <p className="text-sm font-bold text-slate-900">{d.label}</p>
                        <p className="text-xs text-slate-500">{d.detail}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-sm font-black text-slate-900">{formatZar(d.amountZar)}</p>
                        <p className="text-xs font-semibold text-cyan-700">{d.pct}%</p>
                      </div>
                    </div>
                  ))}
                </div>
              </article>

              <RecommendationsBlock recommendations={dashboard.recommendations} />
            </section>
          )}

          {view === "exceptions" && (
            <section className="space-y-4">
              <article className="rounded-2xl border border-rose-200 bg-rose-50 p-5">
                <div className="flex items-center gap-2">
                  <ShieldAlert className="h-5 w-5 text-rose-700" />
                  <p className="text-sm font-black text-rose-900">
                    {exceptionChecks.length} unresolved payroll exception(s)
                  </p>
                </div>
              </article>
              <ChecksTable
                checks={exceptionChecks.length ? exceptionChecks : readinessChecks.filter((c) => c.severity === "blocker")}
                title="Payroll exceptions & blockers"
                emptyMessage="No open payroll exceptions for this date."
              />
            </section>
          )}
        </>
      )}
    </div>
  );
}

function RecommendationsBlock({
  recommendations,
}: {
  recommendations: PayrollIntelligenceDashboard["recommendations"];
}) {
  return (
    <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="mb-4 flex items-center gap-2">
        <Brain className="h-5 w-5 text-violet-700" />
        <h2 className="text-sm font-black text-slate-900">AI recommendations</h2>
        <Sparkles className="h-4 w-4 text-violet-500" />
      </div>
      <div className="space-y-3">
        {recommendations.map((r) => (
          <div
            key={r.id}
            className={`rounded-xl border px-4 py-3 ${
              r.band === "red"
                ? "border-rose-200 bg-rose-50"
                : r.band === "amber"
                  ? "border-amber-200 bg-amber-50"
                  : "border-emerald-200 bg-emerald-50"
            }`}
          >
            <p className="text-sm font-black text-slate-900">{r.title}</p>
            <p className="mt-1 text-xs font-medium text-slate-700">{r.detail}</p>
          </div>
        ))}
      </div>
    </article>
  );
}

function ChecksTable({
  checks,
  title,
  emptyMessage = "No readiness checks for this date.",
}: {
  checks: PayrollReadinessCheck[];
  title: string;
  emptyMessage?: string;
}) {
  return (
    <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <h2 className="mb-4 text-sm font-black text-slate-900">{title}</h2>
      {checks.length === 0 ? (
        <p className="text-sm font-medium text-slate-500">{emptyMessage}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-xs font-bold uppercase text-slate-500">
                <th className="py-2 pr-4">Type</th>
                <th className="py-2 pr-4">Severity</th>
                <th className="py-2">Message</th>
              </tr>
            </thead>
            <tbody>
              {checks.map((c) => (
                <tr key={c.id} className="border-b border-slate-50">
                  <td className="py-3 pr-4 font-semibold text-slate-800">
                    {checkTypeLabel(c.checkType)}
                  </td>
                  <td className="py-3 pr-4">
                    <span
                      className={`rounded-full border px-2 py-0.5 text-[10px] font-black uppercase ${
                        c.severity === "blocker"
                          ? "border-rose-200 bg-rose-50 text-rose-800"
                          : "border-amber-200 bg-amber-50 text-amber-800"
                      }`}
                    >
                      {c.severity}
                    </span>
                  </td>
                  <td className="py-3 text-slate-700">{c.message}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </article>
  );
}

function LeakageTable({ events }: { events: PayrollLeakageEvent[] }) {
  return (
    <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <h2 className="mb-4 text-sm font-black text-slate-900">Payroll leakage engine</h2>
      {events.length === 0 ? (
        <p className="text-sm font-medium text-slate-500">No leakage signals detected.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-xs font-bold uppercase text-slate-500">
                <th className="py-2 pr-4">Type</th>
                <th className="py-2 pr-4">Amount</th>
                <th className="py-2 pr-4">Severity</th>
                <th className="py-2">Message</th>
              </tr>
            </thead>
            <tbody>
              {events.map((e) => (
                <tr key={e.id} className="border-b border-slate-50">
                  <td className="py-3 pr-4 font-semibold text-slate-800">
                    {leakageTypeLabel(e.leakageType)}
                  </td>
                  <td className="py-3 pr-4 font-bold text-slate-900">{formatZar(e.amountZar)}</td>
                  <td className="py-3 pr-4">
                    <span
                      className={`rounded-full border px-2 py-0.5 text-[10px] font-black uppercase ${leakageSeverityClass(e.severity)}`}
                    >
                      {e.severity}
                    </span>
                  </td>
                  <td className="py-3 text-slate-700">{e.message}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </article>
  );
}

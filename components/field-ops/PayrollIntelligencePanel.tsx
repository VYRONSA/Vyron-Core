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
  Download,
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
    pending_attendance_correction: "Pending attendance correction",
    negative_leave_balance: "Negative leave balance",
    duplicate_clock: "Duplicate clock",
    unapproved_overtime: "Unapproved overtime",
    roster_conflict: "Roster conflict",
    missing_supervisor_approval: "Missing supervisor approval",
    pending_shift_approval: "Pending shift approval",
  };
  return labels[type];
}

function readinessStatePill(state: "ready" | "warning" | "blocked") {
  if (state === "ready") return "border-emerald-200 bg-emerald-50 text-emerald-800";
  if (state === "warning") return "border-amber-200 bg-amber-50 text-amber-800";
  return "border-rose-200 bg-rose-50 text-rose-800";
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
  const [prepareBusy, setPrepareBusy] = useState<string | null>(null);
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

  const employeesReady = dashboard?.employeeReadiness.filter((row) => row.state === "ready").length || 0;
  const employeesWarning = dashboard?.employeeReadiness.filter((row) => row.state === "warning").length || 0;
  const employeesBlocked = dashboard?.employeeReadiness.filter((row) => row.state === "blocked").length || 0;
  const missingClockIns = readinessChecks.filter((row) => row.checkType === "missing_clock_in").length;
  const missingClockOuts = readinessChecks.filter((row) => row.checkType === "missing_clock_out").length;
  const pendingLeave = readinessChecks.filter((row) => row.checkType === "unapproved_leave").length;
  const pendingCorrections = readinessChecks.filter((row) => row.checkType === "pending_attendance_correction").length;
  const pendingShiftApprovals = readinessChecks.filter((row) => row.checkType === "pending_shift_approval").length;

  async function prepareExportPack(
    platform: "vyron_pay" | "sage" | "payspace" | "vip" | "csv" | "excel"
  ) {
    if (!dashboard) return;
    setPrepareBusy(platform);

    const rowsPrepared = dashboard.employeeReadiness.filter((row) => row.state !== "blocked").length;

    const { error } = await supabase.from("payroll_export_preparations").insert({
      company_id: companyId,
      pay_period_id: dashboard.payPeriod.id,
      target_platform: platform,
      preparation_status: "prepared",
      rows_prepared: rowsPrepared,
      payload: {
        scoreDate: dashboard.scoreDate,
        readinessScore: dashboard.readinessScore,
        readinessBand: dashboard.readinessBand,
      },
    });

    if (error) {
      setSyncNote(`Export prep note: ${error.message}`);
      setPrepareBusy(null);
      return;
    }

    await supabase.from("payroll_readiness_timeline").insert({
      company_id: companyId,
      pay_period_id: dashboard.payPeriod.id,
      event_type: "export",
      title: `Export prep generated (${platform.toUpperCase()})`,
      detail: `${rowsPrepared} validated employee row(s) prepared for ${platform.toUpperCase()} output.`,
      metadata: {
        platform,
        rowsPrepared,
        scoreDate: dashboard.scoreDate,
      },
    });

    setPrepareBusy(null);
    await load();
  }

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
                  {dashboard.warningCount} warnings · {employeesBlocked} blocked staff
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
                  Compliance Score
                </p>
                <p className="mt-2 text-3xl font-black text-cyan-800">
                  {dashboard.complianceScore}%
                </p>
                <p className="mt-1 text-xs font-medium text-slate-500">
                  {dashboard.laborCostVariance !== null
                    ? `${dashboard.laborCostVariance > 0 ? "+" : ""}${dashboard.laborCostVariance}% labour cost variance`
                    : "Labour variance n/a"}
                </p>
              </article>
            </section>
          )}

          {view === "dashboard" && (
            <>
              <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
                <MetricCard label="Employees ready" value={String(employeesReady)} tone="emerald" />
                <MetricCard label="Employees blocked" value={String(employeesBlocked)} tone="rose" />
                <MetricCard label="Exceptions" value={String(exceptionChecks.length)} tone="amber" />
                <MetricCard label="Missing clock-ins / outs" value={`${missingClockIns} / ${missingClockOuts}`} tone="slate" />
                <MetricCard label="Ready %" value={`${dashboard.readinessScore}%`} tone="cyan" />
              </section>

              <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                <MetricCard label="Pending leave" value={String(pendingLeave)} tone="amber" />
                <MetricCard label="Pending corrections" value={String(pendingCorrections)} tone="amber" />
                <MetricCard label="Pending shift approvals" value={String(pendingShiftApprovals)} tone="amber" />
              </section>

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

              <section className="grid gap-4 lg:grid-cols-2">
                <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                  <div className="mb-4 flex items-center gap-2">
                    <ClipboardList className="h-5 w-5 text-cyan-700" />
                    <h2 className="text-sm font-black text-slate-900">Validation engine</h2>
                  </div>
                  <div className="grid gap-3 md:grid-cols-2">
                    <InfoRow label="Scheduled hours" value={String(dashboard.validationSummary.scheduledHours)} />
                    <InfoRow label="Worked hours" value={String(dashboard.validationSummary.workedHours)} />
                    <InfoRow label="Overtime hours" value={String(dashboard.validationSummary.overtimeHours)} />
                    <InfoRow label="Night shift hours" value={String(dashboard.validationSummary.nightShiftHours)} />
                    <InfoRow label="Public holiday shifts" value={String(dashboard.validationSummary.publicHolidayShifts)} />
                    <InfoRow label="Leave days" value={String(dashboard.validationSummary.leaveDays)} />
                    <InfoRow label="Attendance events" value={String(dashboard.validationSummary.attendanceEvents)} />
                    <InfoRow label="Roster shifts" value={String(dashboard.validationSummary.rosterShifts)} />
                    <InfoRow label="Open exceptions" value={String(dashboard.validationSummary.openExceptions)} />
                  </div>
                </article>

                <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                  <div className="mb-4 flex items-center gap-2">
                    <ShieldAlert className="h-5 w-5 text-cyan-700" />
                    <h2 className="text-sm font-black text-slate-900">Manager payroll centre</h2>
                  </div>
                  <div className="space-y-2 text-sm font-semibold text-slate-700">
                    <p>Outstanding issues: {dashboard.blockerCount + dashboard.warningCount}</p>
                    <p>Approval queue: {readinessChecks.filter((row) => row.checkType === "missing_supervisor_approval").length}</p>
                    <p>Exception queue: {exceptionChecks.length}</p>
                    <p>Bulk resolution candidates: {employeesWarning}</p>
                  </div>
                </article>
              </section>

              <section className="grid gap-4 lg:grid-cols-2">
                <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                  <div className="mb-4 flex items-center gap-2">
                    <TrendingUp className="h-5 w-5 text-cyan-700" />
                    <h2 className="text-sm font-black text-slate-900">Payroll intelligence</h2>
                  </div>
                  <div className="space-y-2 text-sm text-slate-700">
                    <p>Daily readiness trend points: {dashboard.readinessTrend.length}</p>
                    <p>Stores at risk: {dashboard.storesAtRisk.length}</p>
                    <p>Departments at risk: {dashboard.departmentsAtRisk.length}</p>
                    <p>Recurring issue types: {dashboard.recurringIssues.length}</p>
                    <p>Recurring managers: {dashboard.recurringManagers.length}</p>
                    <p>Compliance score: {dashboard.complianceScore}%</p>
                  </div>
                </article>

                <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                  <div className="mb-4 flex items-center gap-2">
                    <Download className="h-5 w-5 text-cyan-700" />
                    <h2 className="text-sm font-black text-slate-900">Export readiness (prepare only)</h2>
                  </div>
                  <div className="grid gap-2 md:grid-cols-3">
                    {([
                      "vyron_pay",
                      "sage",
                      "payspace",
                      "vip",
                      "csv",
                      "excel",
                    ] as const).map((platform) => (
                      <button
                        key={platform}
                        type="button"
                        onClick={() => void prepareExportPack(platform)}
                        disabled={prepareBusy === platform}
                        className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-black text-slate-700 hover:bg-slate-100 disabled:opacity-60"
                      >
                        {prepareBusy === platform ? "Preparing..." : `Prepare ${platform.toUpperCase()}`}
                      </button>
                    ))}
                  </div>
                  <p className="mt-3 text-xs font-semibold text-slate-500">
                    Last prepared packs: {dashboard.exportReadinessPacks.length}
                  </p>
                </article>
              </section>

              <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <div className="mb-4 flex items-center gap-2">
                  <CalendarRange className="h-5 w-5 text-cyan-700" />
                  <h2 className="text-sm font-black text-slate-900">Payroll readiness timeline</h2>
                </div>
                {dashboard.timeline.length === 0 ? (
                  <p className="text-sm font-medium text-slate-500">No timeline events yet.</p>
                ) : (
                  <div className="space-y-2">
                    {dashboard.timeline.slice(0, 12).map((row) => (
                      <div key={row.id} className="rounded-xl border border-slate-100 bg-slate-50 px-3 py-2">
                        <div className="flex items-center justify-between gap-3">
                          <p className="text-sm font-bold text-slate-900">{row.title}</p>
                          <p className="text-[10px] font-semibold uppercase text-slate-500">{row.eventType}</p>
                        </div>
                        <p className="mt-1 text-xs text-slate-600">{row.detail}</p>
                      </div>
                    ))}
                  </div>
                )}
              </section>

              <RecommendationsBlock recommendations={dashboard.recommendations} />
            </>
          )}

          {view === "readiness" && (
            <section className="space-y-4">
              <ChecksTable checks={readinessChecks} title="Payroll readiness checks" />

              <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <h2 className="mb-4 text-sm font-black text-slate-900">Employee payroll readiness</h2>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[760px] text-left text-sm">
                    <thead>
                      <tr className="border-b border-slate-100 text-xs font-bold uppercase text-slate-500">
                        <th className="py-2 pr-3">Employee</th>
                        <th className="py-2 pr-3">State</th>
                        <th className="py-2 pr-3">Reason</th>
                        <th className="py-2 pr-3">Required Action</th>
                        <th className="py-2 pr-3">Manager</th>
                        <th className="py-2">Supervisor</th>
                      </tr>
                    </thead>
                    <tbody>
                      {dashboard.employeeReadiness.map((row) => (
                        <tr key={row.employeeId} className="border-b border-slate-50">
                          <td className="py-3 pr-3 font-semibold text-slate-800">{row.employeeName}</td>
                          <td className="py-3 pr-3">
                            <span className={`rounded-full border px-2 py-0.5 text-[10px] font-black uppercase ${readinessStatePill(row.state)}`}>
                              {row.state}
                            </span>
                          </td>
                          <td className="py-3 pr-3 text-slate-700">{row.reason}</td>
                          <td className="py-3 pr-3 text-slate-700">{row.requiredAction}</td>
                          <td className="py-3 pr-3 text-slate-600">{row.manager || "—"}</td>
                          <td className="py-3 text-slate-600">{row.supervisor || "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </article>
            </section>
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

function MetricCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: "emerald" | "rose" | "amber" | "slate" | "cyan";
}) {
  const toneClass: Record<typeof tone, string> = {
    emerald: "text-emerald-700",
    rose: "text-rose-700",
    amber: "text-amber-700",
    slate: "text-slate-800",
    cyan: "text-cyan-800",
  };

  return (
    <article className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <p className="text-[11px] font-black uppercase tracking-wider text-slate-500">{label}</p>
      <p className={`mt-2 text-2xl font-black ${toneClass[tone]}`}>{value}</p>
    </article>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between rounded-xl border border-slate-100 bg-slate-50 px-3 py-2">
      <span className="text-xs font-bold uppercase tracking-wide text-slate-500">{label}</span>
      <span className="text-sm font-black text-slate-900">{value}</span>
    </div>
  );
}

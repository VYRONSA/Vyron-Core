"use client";

import React, { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Banknote,
  Briefcase,
  Car,
  Clock3,
  Percent,
  RefreshCcw,
  Timer,
  TrendingDown,
  WalletCards,
} from "lucide-react";
import {
  costAlertSeverityClass,
  formatCurrency,
  loadWorkforceCostDashboard,
  type FieldCostAlert,
  type FieldJobCost,
  type WorkforceCostDashboard,
} from "@/lib/field-cost-intelligence";
import { formatFieldTimestamp } from "@/lib/field-operations";
import { formatDuration } from "@/lib/field-travel-intelligence";
import { supabase } from "@/lib/supabase";

type EmployeeRow = { id: string; first_name: string; last_name: string };

type Props = {
  companyId: string;
  employees: EmployeeRow[];
};

function employeeName(employees: EmployeeRow[], id: string | null) {
  if (!id) return "—";
  const row = employees.find((e) => e.id === id);
  if (!row) return "Unknown";
  return `${row.first_name} ${row.last_name}`.trim();
}

function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

export default function WorkforceCostIntelligencePanel({ companyId, employees }: Props) {
  const [costDate, setCostDate] = useState(todayIsoDate);
  const [loading, setLoading] = useState(true);
  const [syncNote, setSyncNote] = useState<string | null>(null);
  const [tablesAvailable, setTablesAvailable] = useState(true);
  const [dashboard, setDashboard] = useState<WorkforceCostDashboard | null>(null);

  async function load() {
    if (!companyId) return;
    setLoading(true);
    setSyncNote(null);
    const result = await loadWorkforceCostDashboard(supabase, companyId, costDate);
    setTablesAvailable(result.tablesAvailable);
    setDashboard(result.dashboard);
    if (result.error) setSyncNote(result.error);
    setLoading(false);
  }

  useEffect(() => {
    void load();
  }, [companyId, costDate]);

  const currency = dashboard?.currency || "ZAR";

  const cards = useMemo(
    () => [
      {
        label: "Labour Cost Today",
        value: dashboard ? formatCurrency(dashboard.labourCost, currency) : "—",
        icon: WalletCards,
      },
      {
        label: "Travel Cost Today",
        value: dashboard ? formatCurrency(dashboard.travelCost, currency) : "—",
        icon: Car,
      },
      {
        label: "Idle Cost Today",
        value: dashboard ? formatCurrency(dashboard.idleCost, currency) : "—",
        icon: Timer,
      },
      {
        label: "Overtime Cost Today",
        value: dashboard ? formatCurrency(dashboard.overtimeCost, currency) : "—",
        icon: Clock3,
      },
      {
        label: "Cost Per Job",
        value: dashboard ? formatCurrency(dashboard.costPerJob, currency) : "—",
        icon: Briefcase,
      },
      {
        label: "Estimated Leakage",
        value: dashboard ? formatCurrency(dashboard.estimatedLeakage, currency) : "—",
        icon: TrendingDown,
      },
      {
        label: "Billable Value",
        value: dashboard ? formatCurrency(dashboard.billableValue, currency) : "—",
        icon: Banknote,
      },
      {
        label: "Field Margin",
        value: dashboard
          ? `${formatCurrency(dashboard.fieldMargin, currency)} (${dashboard.fieldMarginPct}%)`
          : "—",
        icon: Percent,
      },
    ],
    [dashboard, currency]
  );

  return (
    <div className="space-y-6">
      <section className="rounded-[2rem] border border-white/80 bg-white/95 p-6 shadow-[0_18px_55px_rgba(15,23,42,0.12)]">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div>
            <div className="text-xs font-bold uppercase tracking-[0.35em] text-cyan-700">
              Workforce Cost Intelligence
            </div>
            <h2 className="mt-2 text-3xl font-black tracking-tight text-slate-950">
              Field Cost Dashboard
            </h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-500">
              Labour, travel, idle, and overtime costs derived from field events and workforce
              journey metrics. Margin and payroll leakage surfaced per job, employee, and site.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void load()}
            className="inline-flex items-center gap-2 rounded-2xl border border-cyan-100 bg-cyan-50 px-4 py-3 text-sm font-black text-cyan-900"
          >
            <RefreshCcw className="h-4 w-4" />
            Refresh
          </button>
        </div>

        <div className="mt-4">
          <label className="text-xs font-black uppercase tracking-wider text-slate-500">
            Date
            <input
              type="date"
              value={costDate}
              onChange={(e) => setCostDate(e.target.value)}
              className="mt-1 block rounded-xl border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-800"
            />
          </label>
        </div>

        {syncNote && (
          <p className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-950">
            {syncNote}
          </p>
        )}
        {!tablesAvailable && !loading && (
          <p className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-950">
            Run <code className="rounded bg-white px-1">sql/014-field-operations.sql</code>,{" "}
            <code className="rounded bg-white px-1">sql/017-field-travel-intelligence.sql</code>, and{" "}
            <code className="rounded bg-white px-1">sql/018-field-cost-intelligence.sql</code> in
            Supabase, then refresh.
          </p>
        )}
      </section>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {cards.map((card) => (
          <div
            key={card.label}
            className="rounded-[1.5rem] border border-white/80 bg-white/95 p-5 shadow-sm"
          >
            <card.icon className="h-5 w-5 text-cyan-700" />
            <div className="mt-4 text-2xl font-black text-slate-950">{loading ? "…" : card.value}</div>
            <div className="text-xs font-black uppercase tracking-wider text-slate-500">
              {card.label}
            </div>
          </div>
        ))}
      </section>

      <section className="rounded-[2rem] border border-white/80 bg-white/95 p-6 shadow-sm">
        <div className="flex items-center gap-2">
          <AlertTriangle className="h-5 w-5 text-amber-600" />
          <h3 className="text-lg font-black text-slate-950">Cost &amp; leakage alerts</h3>
        </div>
        <div className="mt-4 space-y-3">
          {loading ? (
            <p className="text-sm font-semibold text-slate-500">Loading alerts…</p>
          ) : !dashboard?.alerts.length ? (
            <p className="text-sm font-semibold text-slate-500">No cost alerts for this date.</p>
          ) : (
            dashboard.alerts.map((alert) => (
              <CostAlertRow key={alert.id} alert={alert} employees={employees} />
            ))
          )}
        </div>
      </section>

      <section className="grid gap-6 xl:grid-cols-2">
        <div className="rounded-[2rem] border border-white/80 bg-white/95 p-6 shadow-sm">
          <h3 className="text-lg font-black text-slate-950">Job costs</h3>
          <div className="mt-4 space-y-3">
            {loading ? (
              <p className="text-sm font-semibold text-slate-500">Loading…</p>
            ) : !dashboard?.jobCosts.length ? (
              <p className="text-sm font-semibold text-slate-500">No job costs for this date.</p>
            ) : (
              dashboard.jobCosts.map((job) => (
                <JobCostRow key={job.jobId} job={job} employees={employees} currency={currency} />
              ))
            )}
          </div>
        </div>

        <div className="rounded-[2rem] border border-white/80 bg-white/95 p-6 shadow-sm">
          <h3 className="text-lg font-black text-slate-950">Cost per site</h3>
          <div className="mt-4 space-y-3">
            {loading ? (
              <p className="text-sm font-semibold text-slate-500">Loading…</p>
            ) : !dashboard?.siteCosts.length ? (
              <p className="text-sm font-semibold text-slate-500">No site rollups yet.</p>
            ) : (
              dashboard.siteCosts.map((site) => (
                <div
                  key={site.siteKey}
                  className="rounded-2xl border border-slate-100 bg-slate-50/80 px-4 py-3"
                >
                  <div className="font-bold text-slate-950">{site.label}</div>
                  <div className="mt-1 text-xs font-semibold text-slate-600">
                    {site.jobCount} jobs · Labour {formatCurrency(site.labourCost, currency)} · Travel{" "}
                    {formatCurrency(site.travelCost, currency)} · Revenue{" "}
                    {formatCurrency(site.billableValue, currency)} · Margin{" "}
                    {formatCurrency(site.margin, currency)}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </section>

      <section className="rounded-[2rem] border border-white/80 bg-white/95 p-6 shadow-sm">
        <h3 className="text-lg font-black text-slate-950">Employee day costs</h3>
        <div className="mt-4 overflow-x-auto">
          <table className="min-w-full text-left text-xs">
            <thead>
              <tr className="text-[10px] font-black uppercase tracking-wider text-slate-500">
                <th className="px-2 py-2">Employee</th>
                <th className="px-2 py-2">Labour</th>
                <th className="px-2 py-2">Travel</th>
                <th className="px-2 py-2">Idle</th>
                <th className="px-2 py-2">OT</th>
                <th className="px-2 py-2">Total</th>
                <th className="px-2 py-2">Leakage</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={7} className="px-2 py-3 text-slate-500">
                    Loading…
                  </td>
                </tr>
              ) : !dashboard?.employeeDayCosts.length ? (
                <tr>
                  <td colSpan={7} className="px-2 py-3 text-slate-500">
                    No employee costs for this date.
                  </td>
                </tr>
              ) : (
                dashboard.employeeDayCosts.map((row) => (
                  <tr key={row.employeeId} className="border-t border-slate-200">
                    <td className="px-2 py-2 font-bold text-slate-900">
                      {employeeName(employees, row.employeeId)}
                    </td>
                    <td className="px-2 py-2">{formatCurrency(row.labourCost, currency)}</td>
                    <td className="px-2 py-2">{formatCurrency(row.travelCost, currency)}</td>
                    <td className="px-2 py-2">{formatCurrency(row.idleCost, currency)}</td>
                    <td className="px-2 py-2">{formatCurrency(row.overtimeCost, currency)}</td>
                    <td className="px-2 py-2 font-semibold">{formatCurrency(row.totalCost, currency)}</td>
                    <td className="px-2 py-2 text-rose-700">
                      {formatCurrency(row.leakageValue, currency)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function CostAlertRow({
  alert,
  employees,
}: {
  alert: FieldCostAlert;
  employees: EmployeeRow[];
}) {
  return (
    <div className={`rounded-2xl border px-4 py-3 ${costAlertSeverityClass(alert.severity)}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="font-black">{alert.type}</div>
        <div className="text-xs font-semibold opacity-80">
          {employeeName(employees, alert.employeeId)} · {formatFieldTimestamp(alert.recordedAt)}
        </div>
      </div>
      <p className="mt-1 text-sm font-semibold">{alert.message}</p>
    </div>
  );
}

function JobCostRow({
  job,
  employees,
  currency,
}: {
  job: FieldJobCost;
  employees: EmployeeRow[];
  currency: string;
}) {
  return (
    <div className="rounded-2xl border border-slate-100 bg-slate-50/80 px-4 py-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="font-bold text-slate-950">{job.jobTitle}</div>
          <div className="text-xs font-semibold text-slate-500">
            {job.jobRef} · {employeeName(employees, job.employeeId)}
          </div>
        </div>
        <div className="text-right text-xs font-bold text-slate-700">
          Profit {formatCurrency(job.estimatedMargin, currency)}
        </div>
      </div>
      <div className="mt-2 grid gap-2 text-xs font-semibold text-slate-600 sm:grid-cols-3">
        <span>Labour {formatCurrency(job.labourCost, currency)}</span>
        <span>Travel {formatCurrency(job.travelCost, currency)}</span>
        <span>Total {formatCurrency(job.totalCost, currency)}</span>
      </div>
      <div className="mt-1 text-xs text-slate-500">
        Revenue {formatCurrency(job.billableValue, currency)} · Working{" "}
        {formatDuration(job.labourSeconds)}
      </div>
    </div>
  );
}

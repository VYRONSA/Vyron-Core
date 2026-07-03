"use client";

import React, { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Banknote,
  Briefcase,
  Building2,
  Percent,
  Plus,
  RefreshCcw,
  TrendingDown,
  TrendingUp,
  Users,
  WalletCards,
} from "lucide-react";
import {
  createClientBillingProfile,
  formatClientStatus,
  formatCurrency,
  formatRevenueModel,
  loadProfitabilityDashboard,
  REVENUE_MODELS,
  type ProfitabilityDashboard,
} from "@/lib/client-profitability-intelligence";
import { supabase } from "@/lib/supabase";

type EmployeeRow = { id: string; first_name: string; last_name: string };

type Props = {
  companyId: string;
  employees: EmployeeRow[];
};

type TabId =
  | "dashboard"
  | "clients"
  | "jobs"
  | "technicians"
  | "sites"
  | "alerts"
  | "leaderboards"
  | "reports";

function employeeName(employees: EmployeeRow[], id: string | null) {
  if (!id) return "—";
  const row = employees.find((e) => e.id === id);
  if (!row) return id.slice(0, 8);
  return `${row.first_name} ${row.last_name}`.trim();
}

function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

export default function ClientProfitabilityIntelligencePanel({ companyId, employees }: Props) {
  const [focusDate, setFocusDate] = useState(todayIsoDate);
  const [tab, setTab] = useState<TabId>("dashboard");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<ProfitabilityDashboard | null>(null);

  const [clientName, setClientName] = useState("");
  const [industry, setIndustry] = useState("");
  const [billingModel, setBillingModel] = useState<(typeof REVENUE_MODELS)[number]>("hourly");
  const [hourlyRate, setHourlyRate] = useState("185");
  const [calloutRate, setCalloutRate] = useState("450");

  async function load() {
    if (!companyId) return;
    setLoading(true);
    const dashboard = await loadProfitabilityDashboard(supabase, companyId, focusDate);
    setData(dashboard);
    setLoading(false);
  }

  useEffect(() => {
    void load();
  }, [companyId, focusDate]);

  const currency = data?.currency || "ZAR";

  const tabs: { id: TabId; label: string }[] = [
    { id: "dashboard", label: "Dashboard" },
    { id: "clients", label: "Clients" },
    { id: "jobs", label: "Jobs" },
    { id: "technicians", label: "Technicians" },
    { id: "sites", label: "Sites" },
    { id: "alerts", label: "Alerts" },
    { id: "leaderboards", label: "Leaderboards" },
    { id: "reports", label: "Reports" },
  ];

  const dashboardCards = useMemo(
    () => [
      {
        label: "Revenue Today",
        value: data ? formatCurrency(data.revenueToday, currency) : "—",
        icon: Banknote,
      },
      {
        label: "Revenue This Month",
        value: data ? formatCurrency(data.revenueThisMonth, currency) : "—",
        icon: WalletCards,
      },
      {
        label: "Gross Margin",
        value: data
          ? `${formatCurrency(data.grossMargin, currency)} (${data.grossMarginPct}%)`
          : "—",
        icon: Percent,
      },
      {
        label: "Most Profitable Client",
        value: data?.mostProfitableClient?.name || "—",
        icon: TrendingUp,
      },
      {
        label: "Least Profitable Client",
        value: data?.leastProfitableClient?.name || "—",
        icon: TrendingDown,
      },
      {
        label: "Most Profitable Technician",
        value: data?.mostProfitableTechnician
          ? employeeName(employees, data.mostProfitableTechnician.name)
          : "—",
        icon: Users,
      },
      {
        label: "Jobs Losing Money",
        value: data?.jobsLosingMoney ?? 0,
        icon: AlertTriangle,
      },
      {
        label: "Estimated Leakage",
        value: data ? formatCurrency(data.estimatedLeakage, currency) : "—",
        icon: Briefcase,
      },
    ],
    [data, currency, employees]
  );

  async function handleCreateClient(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setMessage(null);
    if (!clientName.trim()) {
      setError("Client name is required.");
      return;
    }
    setSaving(true);
    const result = await createClientBillingProfile(supabase, {
      companyId,
      clientName,
      industry: industry.trim() || null,
      billingModel,
      hourlyRate: Number(hourlyRate) || 185,
      calloutRate: Number(calloutRate) || 450,
    });
    setSaving(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    setMessage(`Client ${result.client?.clientName} added.`);
    setClientName("");
    setIndustry("");
    await load();
  }

  return (
    <div className="space-y-6">
      <section className="rounded-[2rem] border border-white/80 bg-white/95 p-6 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="text-xs font-bold uppercase tracking-[0.35em] text-rose-700">
              Profitability Intelligence
            </div>
            <h2 className="mt-2 text-2xl font-black text-slate-950">
              Client Billing &amp; Job Profitability
            </h2>
            <p className="mt-2 text-sm text-slate-500">
              Revenue, margin, leakage, and profitability across jobs, clients, technicians, and
              sites.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <label className="text-xs font-black uppercase tracking-wider text-slate-500">
              Date
              <input
                type="date"
                value={focusDate}
                onChange={(e) => setFocusDate(e.target.value)}
                className="mt-1 block rounded-2xl border border-slate-200 px-3 py-2 text-sm font-semibold"
              />
            </label>
            <button
              type="button"
              onClick={() => void load()}
              className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 px-4 py-2 text-sm font-black"
            >
              <RefreshCcw className="h-4 w-4" />
              Refresh
            </button>
          </div>
        </div>

        {!data?.tablesAvailable && !loading && (
          <p className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-900">
            Run migration <code className="font-mono">sql/033-client-profitability-intelligence.sql</code>{" "}
            to enable profitability tables.
          </p>
        )}
      </section>

      <div className="flex flex-wrap gap-2">
        {tabs.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setTab(item.id)}
            className={`rounded-full px-4 py-2 text-xs font-black uppercase tracking-wider ${
              tab === item.id
                ? "bg-[#06101f] text-rose-300"
                : "border border-slate-200 bg-white text-slate-600"
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>

      {(error || message) && (
        <p
          className={`rounded-2xl border px-4 py-3 text-sm font-semibold ${
            error
              ? "border-rose-200 bg-rose-50 text-rose-800"
              : "border-emerald-200 bg-emerald-50 text-emerald-800"
          }`}
        >
          {error || message}
        </p>
      )}

      {tab === "dashboard" && (
        <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {dashboardCards.map((card) => (
            <div
              key={card.label}
              className="rounded-[1.5rem] border border-rose-100/80 bg-rose-50/40 p-5 shadow-sm"
            >
              <card.icon className="h-5 w-5 text-rose-800" />
              <div className="mt-4 text-2xl font-black text-slate-950">
                {loading ? "…" : card.value}
              </div>
              <div className="text-xs font-black uppercase tracking-wider text-slate-500">
                {card.label}
              </div>
            </div>
          ))}
        </section>
      )}

      {tab === "clients" && (
        <div className="grid gap-6 xl:grid-cols-2">
          <section className="rounded-[2rem] border border-rose-100 bg-rose-50/40 p-6">
            <h3 className="text-lg font-black text-slate-950">Add billing client</h3>
            <form onSubmit={handleCreateClient} className="mt-4 grid gap-3">
              <input
                value={clientName}
                onChange={(e) => setClientName(e.target.value)}
                placeholder="Client name"
                className="rounded-2xl border border-white bg-white px-4 py-3 text-sm font-semibold"
              />
              <input
                value={industry}
                onChange={(e) => setIndustry(e.target.value)}
                placeholder="Industry"
                className="rounded-2xl border border-white bg-white px-4 py-3 text-sm font-semibold"
              />
              <select
                value={billingModel}
                onChange={(e) =>
                  setBillingModel(e.target.value as (typeof REVENUE_MODELS)[number])
                }
                className="rounded-2xl border border-white bg-white px-4 py-3 text-sm font-semibold"
              >
                {REVENUE_MODELS.map((model) => (
                  <option key={model} value={model}>
                    {formatRevenueModel(model)}
                  </option>
                ))}
              </select>
              <div className="grid grid-cols-2 gap-3">
                <input
                  value={hourlyRate}
                  onChange={(e) => setHourlyRate(e.target.value)}
                  placeholder="Hourly rate"
                  className="rounded-2xl border border-white bg-white px-4 py-3 text-sm font-semibold"
                />
                <input
                  value={calloutRate}
                  onChange={(e) => setCalloutRate(e.target.value)}
                  placeholder="Callout rate"
                  className="rounded-2xl border border-white bg-white px-4 py-3 text-sm font-semibold"
                />
              </div>
              <button
                type="submit"
                disabled={saving}
                className="inline-flex items-center gap-2 rounded-2xl bg-[#06101f] px-4 py-3 text-sm font-black text-rose-300"
              >
                <Plus className="h-4 w-4" />
                Add client
              </button>
            </form>
          </section>

          <section className="rounded-[2rem] border border-white/80 bg-white/95 p-6 shadow-sm">
            <h3 className="text-lg font-black text-slate-950">Client register &amp; profitability</h3>
            <div className="mt-4 overflow-x-auto">
              <table className="w-full min-w-[900px] text-left text-sm">
                <thead>
                  <tr className="text-xs font-black uppercase tracking-wider text-slate-500">
                    <th className="px-2 py-2">Client</th>
                    <th className="px-2 py-2">Model</th>
                    <th className="px-2 py-2">Jobs</th>
                    <th className="px-2 py-2">Revenue</th>
                    <th className="px-2 py-2">Profit</th>
                    <th className="px-2 py-2">Margin</th>
                    <th className="px-2 py-2">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {(data?.clients || []).map((client) => {
                    const profit = (data?.clientProfitability || []).find(
                      (c) => c.clientId === client.id
                    );
                    return (
                      <tr key={client.id} className="border-t border-slate-100">
                        <td className="px-2 py-2 font-bold">{client.clientName}</td>
                        <td className="px-2 py-2">{formatRevenueModel(client.billingModel)}</td>
                        <td className="px-2 py-2">{profit?.jobsCompleted ?? 0}</td>
                        <td className="px-2 py-2">
                          {formatCurrency(profit?.revenue ?? 0, currency)}
                        </td>
                        <td className="px-2 py-2">
                          {formatCurrency(profit?.profit ?? 0, currency)}
                        </td>
                        <td className="px-2 py-2">{profit?.marginPct ?? 0}%</td>
                        <td className="px-2 py-2">{formatClientStatus(client.status)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      )}

      {tab === "jobs" && (
        <section className="rounded-[2rem] border border-white/80 bg-white/95 p-6 shadow-sm">
          <h3 className="text-lg font-black text-slate-950">Job profitability — {focusDate}</h3>
          <table className="mt-4 w-full min-w-[1100px] text-left text-sm">
            <thead>
              <tr className="text-xs font-black uppercase tracking-wider text-slate-500">
                <th className="px-2 py-2">Job</th>
                <th className="px-2 py-2">Client</th>
                <th className="px-2 py-2">Revenue</th>
                <th className="px-2 py-2">Labour</th>
                <th className="px-2 py-2">Travel</th>
                <th className="px-2 py-2">Vehicle</th>
                <th className="px-2 py-2">Asset</th>
                <th className="px-2 py-2">Profit</th>
                <th className="px-2 py-2">Margin</th>
              </tr>
            </thead>
            <tbody>
              {(data?.jobProfitability || []).map((row) => (
                <tr key={row.jobId} className="border-t border-slate-100">
                  <td className="px-2 py-2 font-mono text-xs">{row.jobRef}</td>
                  <td className="px-2 py-2">{row.clientName || "—"}</td>
                  <td className="px-2 py-2">{formatCurrency(row.revenue, currency)}</td>
                  <td className="px-2 py-2">{formatCurrency(row.labourCost, currency)}</td>
                  <td className="px-2 py-2">{formatCurrency(row.travelCost, currency)}</td>
                  <td className="px-2 py-2">{formatCurrency(row.vehicleCost, currency)}</td>
                  <td className="px-2 py-2">{formatCurrency(row.assetCost, currency)}</td>
                  <td className="px-2 py-2 font-bold">{formatCurrency(row.profit, currency)}</td>
                  <td className="px-2 py-2">{row.marginPct}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {tab === "technicians" && (
        <section className="rounded-[2rem] border border-white/80 bg-white/95 p-6 shadow-sm">
          <h3 className="text-lg font-black text-slate-950">Technician profitability</h3>
          <table className="mt-4 w-full text-left text-sm">
            <thead>
              <tr className="text-xs font-black uppercase tracking-wider text-slate-500">
                <th className="px-2 py-2">Technician</th>
                <th className="px-2 py-2">Revenue</th>
                <th className="px-2 py-2">Labour Cost</th>
                <th className="px-2 py-2">Travel Cost</th>
                <th className="px-2 py-2">Profit</th>
                <th className="px-2 py-2">Productivity</th>
                <th className="px-2 py-2">Jobs</th>
              </tr>
            </thead>
            <tbody>
              {(data?.technicianProfitability || []).map((row) => (
                <tr key={row.employeeId} className="border-t border-slate-100">
                  <td className="px-2 py-2 font-bold">
                    {employeeName(employees, row.employeeId)}
                  </td>
                  <td className="px-2 py-2">{formatCurrency(row.revenueGenerated, currency)}</td>
                  <td className="px-2 py-2">{formatCurrency(row.labourCost, currency)}</td>
                  <td className="px-2 py-2">{formatCurrency(row.travelCost, currency)}</td>
                  <td className="px-2 py-2">{formatCurrency(row.profitContribution, currency)}</td>
                  <td className="px-2 py-2">{row.productivityPct}%</td>
                  <td className="px-2 py-2">{row.jobsCompleted}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {tab === "sites" && (
        <section className="rounded-[2rem] border border-white/80 bg-white/95 p-6 shadow-sm">
          <h3 className="text-lg font-black text-slate-950">Site profitability</h3>
          <table className="mt-4 w-full text-left text-sm">
            <thead>
              <tr className="text-xs font-black uppercase tracking-wider text-slate-500">
                <th className="px-2 py-2">Site</th>
                <th className="px-2 py-2">Revenue</th>
                <th className="px-2 py-2">Cost</th>
                <th className="px-2 py-2">Margin</th>
                <th className="px-2 py-2">Jobs</th>
                <th className="px-2 py-2">Labour Hrs</th>
              </tr>
            </thead>
            <tbody>
              {(data?.siteProfitability || []).map((row) => (
                <tr key={row.siteKey} className="border-t border-slate-100">
                  <td className="px-2 py-2 font-bold">{row.siteLabel}</td>
                  <td className="px-2 py-2">{formatCurrency(row.revenue, currency)}</td>
                  <td className="px-2 py-2">{formatCurrency(row.totalCost, currency)}</td>
                  <td className="px-2 py-2">{row.marginPct}%</td>
                  <td className="px-2 py-2">{row.jobsCount}</td>
                  <td className="px-2 py-2">{(row.labourSeconds / 3600).toFixed(1)}h</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {tab === "alerts" && (
        <section className="rounded-[2rem] border border-white/80 bg-white/95 p-6 shadow-sm">
          <h3 className="text-lg font-black text-slate-950">Profitability alerts</h3>
          <div className="mt-4 space-y-3">
            {(data?.alerts || []).length === 0 ? (
              <p className="text-sm text-slate-500">No active profitability alerts.</p>
            ) : (
              (data?.alerts || []).map((alert) => (
                <div
                  key={alert.id}
                  className={`rounded-2xl border px-4 py-3 text-sm ${
                    alert.severity === "critical"
                      ? "border-rose-200 bg-rose-50 text-rose-900"
                      : alert.severity === "warning"
                        ? "border-amber-200 bg-amber-50 text-amber-900"
                        : "border-slate-200 bg-slate-50 text-slate-800"
                  }`}
                >
                  <div className="font-black uppercase tracking-wider text-[10px]">
                    {alert.alertType.replaceAll("_", " ")} · {alert.severity}
                  </div>
                  <div className="mt-1 font-semibold">{alert.message}</div>
                </div>
              ))
            )}
          </div>
        </section>
      )}

      {tab === "leaderboards" && data && (
        <section className="grid gap-6 xl:grid-cols-2">
          {[
            { title: "Top Clients", rows: data.leaderboards.topClients, valueKey: "profit" as const },
            {
              title: "Top Technicians",
              rows: data.leaderboards.topTechnicians.map((r) => ({
                ...r,
                label: employeeName(employees, r.id),
              })),
              valueKey: "profit" as const,
            },
            {
              title: "Top Sites",
              rows: data.leaderboards.topSites,
              valueKey: "marginPct" as const,
            },
          ].map((board) => (
            <div
              key={board.title}
              className="rounded-[1.5rem] border border-white/80 bg-white/95 p-5 shadow-sm"
            >
              <h3 className="text-sm font-black uppercase tracking-wider text-slate-500">
                {board.title}
              </h3>
              <table className="mt-4 w-full text-sm">
                <tbody>
                  {board.rows.map((row) => (
                    <tr key={row.id} className="border-t border-slate-100">
                      <td className="py-2 font-semibold">{row.label}</td>
                      <td className="py-2 text-right font-black">
                        {board.valueKey === "profit"
                          ? formatCurrency((row as { profit: number }).profit, currency)
                          : `${(row as { marginPct: number }).marginPct}%`}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
          <div className="rounded-[1.5rem] border border-white/80 bg-white/95 p-5 shadow-sm xl:col-span-2">
            <h3 className="text-sm font-black uppercase tracking-wider text-slate-500">
              Highest &amp; Lowest Margin Jobs
            </h3>
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <div>
                <div className="text-xs font-bold text-emerald-700">Highest margin</div>
                {(data.leaderboards.highestMarginJobs || []).map((j) => (
                  <div key={j.jobId} className="mt-2 text-sm">
                    {j.jobRef} · {j.marginPct}% · {formatCurrency(j.profit, currency)}
                  </div>
                ))}
              </div>
              <div>
                <div className="text-xs font-bold text-rose-700">Lowest margin</div>
                {(data.leaderboards.lowestMarginJobs || []).map((j) => (
                  <div key={j.jobId} className="mt-2 text-sm">
                    {j.jobRef} · {j.marginPct}% · {formatCurrency(j.profit, currency)}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>
      )}

      {tab === "reports" && data && (
        <section className="space-y-6">
          {[
            { title: "Job Profitability Report", rows: data.reports.jobProfitability.length },
            { title: "Client Profitability Report", rows: data.reports.clientProfitability.length },
            {
              title: "Technician Profitability Report",
              rows: data.reports.technicianProfitability.length,
            },
            { title: "Site Profitability Report", rows: data.reports.siteProfitability.length },
            { title: "Travel Cost Analysis", rows: data.reports.travelCostAnalysis.length },
            { title: "Labour Cost Analysis", rows: data.reports.labourCostAnalysis.length },
          ].map((report) => (
            <div
              key={report.title}
              className="rounded-[1.5rem] border border-slate-200 bg-slate-50/80 p-5"
            >
              <div className="flex items-center gap-2">
                <Building2 className="h-4 w-4 text-slate-600" />
                <h3 className="font-black text-slate-950">{report.title}</h3>
              </div>
              <p className="mt-2 text-sm text-slate-600">
                {report.rows} rows for period {data.monthStart} → {data.monthEnd}
              </p>
            </div>
          ))}
        </section>
      )}
    </div>
  );
}

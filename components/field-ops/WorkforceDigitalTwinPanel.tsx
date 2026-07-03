"use client";

import React, { useEffect, useState } from "react";
import {
  Activity,
  BarChart3,
  Brain,
  Building2,
  FlaskConical,
  Map,
  RefreshCcw,
  ShieldAlert,
  TrendingUp,
  Users,
  WalletCards,
} from "lucide-react";
import {
  formatTwinValue,
  loadWorkforceDigitalTwin,
  runWorkforceTwinSimulation,
  saveWorkforceTwinSimulation,
  twinHealthClass,
  type WorkforceDigitalTwinDashboard,
  type WorkforceTwinSimulationInput,
} from "@/lib/workforce-digital-twin";
import { riskBandClass } from "@/lib/workforce-risk-intelligence";
import { supabase } from "@/lib/supabase";

type Props = {
  companyId: string;
  userEmail?: string | null;
};

function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

export default function WorkforceDigitalTwinPanel({ companyId, userEmail }: Props) {
  const [snapshotDate, setSnapshotDate] = useState(todayIsoDate);
  const [loading, setLoading] = useState(true);
  const [syncNote, setSyncNote] = useState<string | null>(null);
  const [dashboard, setDashboard] = useState<WorkforceDigitalTwinDashboard | null>(null);

  const [simInput, setSimInput] = useState<WorkforceTwinSimulationInput>({
    reduceOvertimePct: 10,
    addEmployees: 0,
    removeEmployees: 0,
    moveEmployeesCount: 1,
    fromStoreId: "",
    toStoreId: "",
  });
  const [simResult, setSimResult] = useState<ReturnType<typeof runWorkforceTwinSimulation> | null>(
    null
  );
  const [simBusy, setSimBusy] = useState(false);

  async function load() {
    if (!companyId) return;
    setLoading(true);
    setSyncNote(null);
    const result = await loadWorkforceDigitalTwin(supabase, companyId, snapshotDate);
    setDashboard(result.dashboard);
    if (result.error) setSyncNote(result.error);
    setLoading(false);
  }

  useEffect(() => {
    void load();
  }, [companyId, snapshotDate]);

  useEffect(() => {
    if (dashboard?.heatMap.length && !simInput.fromStoreId) {
      setSimInput((s) => ({
        ...s,
        fromStoreId: dashboard.heatMap[0]?.storeId || "",
        toStoreId: dashboard.heatMap[1]?.storeId || dashboard.heatMap[0]?.storeId || "",
      }));
    }
  }, [dashboard]);

  async function runSimulation(scenario: keyof WorkforceTwinSimulationInput | "move") {
    if (!dashboard) return;
    setSimBusy(true);
    let input: WorkforceTwinSimulationInput = {};
    if (scenario === "reduceOvertimePct") {
      input = { reduceOvertimePct: simInput.reduceOvertimePct };
    } else if (scenario === "addEmployees") {
      input = { addEmployees: simInput.addEmployees || 1 };
    } else if (scenario === "removeEmployees") {
      input = { removeEmployees: simInput.removeEmployees || 1 };
    } else {
      input = {
        moveEmployeesCount: simInput.moveEmployeesCount || 1,
        fromStoreId: simInput.fromStoreId,
        toStoreId: simInput.toStoreId,
      };
    }
    const result = runWorkforceTwinSimulation(dashboard, input);
    setSimResult(result);
    await saveWorkforceTwinSimulation(supabase, companyId, input, result, userEmail || undefined);
    setSimBusy(false);
  }

  const exec = dashboard?.executive;

  const executiveCards = [
    {
      label: "Workforce Health %",
      value: exec ? formatTwinValue(exec.workforceHealthPct, "", "%") : "…",
      icon: Activity,
      band: exec?.workforceHealthPct != null ? twinHealthClass(exec.workforceHealthPct) : "",
    },
    {
      label: "Labour Cost Today",
      value: exec ? formatTwinValue(exec.labourCostToday, "R") : "…",
      icon: WalletCards,
    },
    {
      label: "Productivity %",
      value: exec ? formatTwinValue(exec.productivityPct, "", "%") : "…",
      icon: TrendingUp,
    },
    {
      label: "Risk Level",
      value: exec?.riskLevel?.toUpperCase() || "Needs more data",
      icon: ShieldAlert,
      band: exec?.riskLevel ? riskBandClass(exec.riskLevel) : "",
    },
    {
      label: "Predicted Leakage",
      value: exec ? formatTwinValue(exec.predictedLeakage, "R") : "…",
      icon: BarChart3,
    },
    {
      label: "Active Employees",
      value: exec ? String(exec.activeEmployees) : "…",
      icon: Users,
    },
    {
      label: "Active Field Jobs",
      value: exec ? String(exec.activeFieldJobs) : "…",
      icon: Map,
    },
    {
      label: "High Risk Employees",
      value: exec ? String(exec.highRiskEmployees) : "…",
      icon: ShieldAlert,
    },
  ];

  return (
    <div className="space-y-6">
      <section className="rounded-[2rem] border border-white/80 bg-white/95 p-6 shadow-[0_18px_55px_rgba(15,23,42,0.12)]">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div>
            <div className="text-xs font-bold uppercase tracking-[0.35em] text-cyan-700">
              Workforce Digital Twin
            </div>
            <h2 className="mt-2 text-3xl font-black tracking-tight text-slate-950">
              Live Operational Workforce Model
            </h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-500">
              Structured intelligence across employees, sites, field ops, labour cost, productivity,
              and risk — from existing CORE data. No synthetic AI; gaps show “Needs more data”.
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
            Snapshot date
            <input
              type="date"
              value={snapshotDate}
              onChange={(e) => setSnapshotDate(e.target.value)}
              className="mt-1 block rounded-xl border border-slate-200 px-3 py-2 text-sm font-semibold"
            />
          </label>
        </div>
        {syncNote && (
          <p className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-950">
            {syncNote}
          </p>
        )}
        {exec?.dataGaps.length ? (
          <ul className="mt-4 space-y-1 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-xs font-semibold text-slate-600">
            {exec.dataGaps.map((g) => (
              <li key={g}>• {g}</li>
            ))}
          </ul>
        ) : null}
        <p className="mt-3 text-xs text-slate-500">
          Run <code className="rounded bg-slate-100 px-1">sql/024-workforce-digital-twin.sql</code> to
          persist snapshots.
        </p>
      </section>

      <section>
        <h3 className="mb-3 text-lg font-black text-slate-950">Executive Workforce Health</h3>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {executiveCards.map((card) => (
            <div
              key={card.label}
              className="rounded-[1.5rem] border border-white/80 bg-white/95 p-5 shadow-sm"
            >
              <card.icon className="h-5 w-5 text-cyan-700" />
              <div
                className={`mt-4 text-2xl font-black text-slate-950 ${card.band ? `inline-block rounded-xl border px-2 py-1 text-lg ${card.band}` : ""}`}
              >
                {loading ? "…" : card.value}
              </div>
              <div className="text-xs font-black uppercase tracking-wider text-slate-500">
                {card.label}
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-[2rem] border border-white/80 bg-white/95 p-6 shadow-sm">
        <div className="flex items-center gap-2">
          <Building2 className="h-5 w-5 text-cyan-700" />
          <h3 className="text-lg font-black text-slate-950">Workforce Heat Map Foundation</h3>
        </div>
        <div className="mt-4 overflow-x-auto">
          <table className="min-w-full text-left text-xs">
            <thead>
              <tr className="text-[10px] font-black uppercase tracking-wider text-slate-500">
                <th className="px-2 py-2">Store/Site</th>
                <th className="px-2 py-2">Region</th>
                <th className="px-2 py-2">Employees</th>
                <th className="px-2 py-2">Labour Cost</th>
                <th className="px-2 py-2">Productivity</th>
                <th className="px-2 py-2">Attend Risk</th>
                <th className="px-2 py-2">OT Risk</th>
                <th className="px-2 py-2">Field Risk</th>
                <th className="px-2 py-2">Health</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={9} className="px-2 py-3 text-slate-500">
                    Loading…
                  </td>
                </tr>
              ) : !dashboard?.heatMap.length ? (
                <tr>
                  <td colSpan={9} className="px-2 py-3 text-slate-500">
                    Needs more data — add stores and employees.
                  </td>
                </tr>
              ) : (
                dashboard.heatMap.map((row) => (
                  <tr key={row.storeId} className="border-t border-slate-200">
                    <td className="px-2 py-2 font-bold">{row.storeName}</td>
                    <td className="px-2 py-2">{row.region}</td>
                    <td className="px-2 py-2">{row.employeeCount}</td>
                    <td className="px-2 py-2">{formatTwinValue(row.labourCost, "R")}</td>
                    <td className="px-2 py-2">{formatTwinValue(row.productivityPct, "", "%")}</td>
                    <td className="px-2 py-2">{formatTwinValue(row.attendanceRisk)}</td>
                    <td className="px-2 py-2">{formatTwinValue(row.overtimeRisk)}</td>
                    <td className="px-2 py-2">{formatTwinValue(row.fieldRisk)}</td>
                    <td className="px-2 py-2">{formatTwinValue(row.overallHealth, "", "%")}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-[2rem] border border-white/80 bg-white/95 p-6 shadow-sm">
        <div className="flex items-center gap-2">
          <TrendingUp className="h-5 w-5 text-cyan-700" />
          <h3 className="text-lg font-black text-slate-950">Forecast Foundation (7 days)</h3>
        </div>
        {loading ? (
          <p className="mt-4 text-sm text-slate-500">Loading forecast…</p>
        ) : dashboard?.forecast.needsMoreData ? (
          <p className="mt-4 text-sm font-semibold text-amber-800">Needs more data — roster shifts required.</p>
        ) : (
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <ForecastCard
              label="Staffing risk (7d)"
              value={formatTwinValue(dashboard?.forecast.staffingRisk7d ?? null, "", "%")}
            />
            <ForecastCard
              label="Payroll pressure"
              value={formatTwinValue(dashboard?.forecast.payrollPressure ?? null, "", "%")}
            />
            <ForecastCard
              label="Field ops pressure"
              value={formatTwinValue(dashboard?.forecast.fieldOpsPressure ?? null, "", "%")}
            />
            <div className="rounded-2xl border border-slate-100 bg-slate-50 p-4">
              <div className="text-xs font-black uppercase text-slate-500">Predicted shortages</div>
              <ul className="mt-2 space-y-1 text-sm text-slate-700">
                {(dashboard?.forecast.predictedShortages || []).slice(0, 4).map((s) => (
                  <li key={s}>• {s}</li>
                ))}
                {!dashboard?.forecast.predictedShortages.length && <li>None flagged</li>}
              </ul>
            </div>
            <div className="rounded-2xl border border-slate-100 bg-slate-50 p-4 md:col-span-2">
              <div className="text-xs font-black uppercase text-slate-500">Predicted overstaffing</div>
              <ul className="mt-2 space-y-1 text-sm text-slate-700">
                {(dashboard?.forecast.predictedOverstaffing || []).slice(0, 4).map((s) => (
                  <li key={s}>• {s}</li>
                ))}
                {!dashboard?.forecast.predictedOverstaffing.length && <li>None flagged</li>}
              </ul>
            </div>
          </div>
        )}
      </section>

      <section className="rounded-[2rem] border border-slate-900/10 bg-[#06101f] p-6 text-white shadow-xl">
        <div className="flex items-center gap-2">
          <FlaskConical className="h-5 w-5 text-cyan-300" />
          <h3 className="text-lg font-black">Simulation Foundation (model only)</h3>
        </div>
        <p className="mt-2 text-sm text-slate-400">
          What-if scenarios — no automatic employee moves or HR actions.
        </p>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <label className="text-xs font-bold text-slate-400">
            Reduce overtime %
            <input
              type="number"
              min={0}
              max={100}
              value={simInput.reduceOvertimePct || 0}
              onChange={(e) =>
                setSimInput((s) => ({ ...s, reduceOvertimePct: Number(e.target.value) }))
              }
              className="mt-1 w-full rounded-xl border border-white/10 bg-white/10 px-3 py-2 text-sm"
            />
          </label>
          <label className="text-xs font-bold text-slate-400">
            Add employees
            <input
              type="number"
              min={0}
              value={simInput.addEmployees || 0}
              onChange={(e) =>
                setSimInput((s) => ({ ...s, addEmployees: Number(e.target.value) }))
              }
              className="mt-1 w-full rounded-xl border border-white/10 bg-white/10 px-3 py-2 text-sm"
            />
          </label>
          <label className="text-xs font-bold text-slate-400">
            Remove employees
            <input
              type="number"
              min={0}
              value={simInput.removeEmployees || 0}
              onChange={(e) =>
                setSimInput((s) => ({ ...s, removeEmployees: Number(e.target.value) }))
              }
              className="mt-1 w-full rounded-xl border border-white/10 bg-white/10 px-3 py-2 text-sm"
            />
          </label>
          <label className="text-xs font-bold text-slate-400">
            Move count
            <input
              type="number"
              min={1}
              value={simInput.moveEmployeesCount || 1}
              onChange={(e) =>
                setSimInput((s) => ({ ...s, moveEmployeesCount: Number(e.target.value) }))
              }
              className="mt-1 w-full rounded-xl border border-white/10 bg-white/10 px-3 py-2 text-sm"
            />
          </label>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            disabled={simBusy || loading}
            onClick={() => void runSimulation("reduceOvertimePct")}
            className="rounded-xl bg-cyan-500 px-3 py-2 text-xs font-black text-slate-950"
          >
            Model OT reduction
          </button>
          <button
            type="button"
            disabled={simBusy || loading}
            onClick={() => void runSimulation("addEmployees")}
            className="rounded-xl bg-white/10 px-3 py-2 text-xs font-black"
          >
            Model add staff
          </button>
          <button
            type="button"
            disabled={simBusy || loading}
            onClick={() => void runSimulation("removeEmployees")}
            className="rounded-xl bg-white/10 px-3 py-2 text-xs font-black"
          >
            Model remove staff
          </button>
          <button
            type="button"
            disabled={simBusy || loading}
            onClick={() => void runSimulation("move")}
            className="rounded-xl bg-white/10 px-3 py-2 text-xs font-black"
          >
            Model site move
          </button>
        </div>
        {simResult && (
          <div className="mt-4 rounded-2xl bg-slate-900 p-4 text-sm">
            <div className="font-black text-cyan-300">Simulation result</div>
            <p className="mt-2 text-slate-300">{simResult.staffingImpact}</p>
            <p className="mt-1 text-slate-400">
              Saving: {formatTwinValue(simResult.estimatedSaving, "R")} · Risk change:{" "}
              {formatTwinValue(simResult.expectedRiskChange)} · Confidence: {simResult.confidenceLevel}
            </p>
          </div>
        )}
      </section>

      <section className="rounded-[2rem] border border-white/80 bg-white/95 p-6 shadow-sm">
        <div className="flex items-center gap-2">
          <Brain className="h-5 w-5 text-violet-600" />
          <h3 className="text-lg font-black text-slate-950">Digital Twin Insights</h3>
        </div>
        <div className="mt-4 space-y-3">
          {loading ? (
            <p className="text-sm text-slate-500">Generating insights…</p>
          ) : (
            dashboard?.insights.map((ins) => (
              <div
                key={ins.id}
                className={`rounded-2xl border px-4 py-3 ${
                  ins.severity === "critical"
                    ? "border-rose-200 bg-rose-50"
                    : ins.severity === "warning"
                      ? "border-amber-200 bg-amber-50"
                      : "border-slate-200 bg-slate-50"
                }`}
              >
                <div className="font-black text-slate-950">{ins.title}</div>
                <p className="mt-1 text-sm text-slate-700">{ins.detail}</p>
                <div className="mt-2 text-[10px] font-semibold uppercase text-slate-500">
                  {ins.sourceModules.join(" · ")}
                </div>
              </div>
            ))
          )}
        </div>
      </section>
    </div>
  );
}

function ForecastCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-slate-100 bg-slate-50 p-4">
      <div className="text-xs font-black uppercase text-slate-500">{label}</div>
      <div className="mt-2 text-2xl font-black text-slate-950">{value}</div>
    </div>
  );
}

"use client";

import React, { useEffect, useMemo, useState } from "react";
import { CalendarRange, RefreshCcw } from "lucide-react";
import { fetchFieldOperationsSnapshot } from "@/lib/field-operations";
import {
  buildRouteHistoryDashboard,
  datesForRouteHistoryFilter,
  formatDistanceKm,
  formatDuration,
  type RouteHistoryFilter,
} from "@/lib/field-travel-intelligence";
import { supabase } from "@/lib/supabase";

type EmployeeRow = { id: string; first_name: string; last_name: string };

type Props = {
  companyId: string;
  employees: EmployeeRow[];
};

function employeeName(employees: EmployeeRow[], id: string) {
  const row = employees.find((e) => e.id === id);
  if (!row) return "Unknown";
  return `${row.first_name} ${row.last_name}`.trim();
}

export default function RouteHistoryPanel({ companyId, employees }: Props) {
  const [period, setPeriod] = useState<RouteHistoryFilter>("today");
  const [employeeFilter, setEmployeeFilter] = useState("");
  const [loading, setLoading] = useState(true);
  const [snapshotError, setSnapshotError] = useState<string | null>(null);
  const [tablesAvailable, setTablesAvailable] = useState(true);
  const [history, setHistory] = useState<ReturnType<typeof buildRouteHistoryDashboard> | null>(null);

  const dates = useMemo(() => datesForRouteHistoryFilter(period), [period]);

  async function load() {
    if (!companyId) return;
    setLoading(true);
    const snapshot = await fetchFieldOperationsSnapshot(supabase, companyId);
    setTablesAvailable(snapshot.tablesAvailable);
    setSnapshotError(snapshot.error);
    setHistory(buildRouteHistoryDashboard(snapshot, dates, companyId, employeeFilter || undefined));
    setLoading(false);
  }

  useEffect(() => {
    void load();
  }, [companyId, period, employeeFilter]);

  const grouped = useMemo(() => {
    if (!history) return [];
    const byKey = new Map<string, (typeof history.journeys)[number]>();
    for (const journey of history.journeys) {
      byKey.set(`${journey.employeeId}:${journey.routeDate}`, journey);
    }
    return [...byKey.values()].sort((a, b) => {
      const dateCmp = b.routeDate.localeCompare(a.routeDate);
      if (dateCmp !== 0) return dateCmp;
      return employeeName(employees, a.employeeId).localeCompare(
        employeeName(employees, b.employeeId)
      );
    });
  }, [history, employees]);

  return (
    <div className="space-y-6">
      <section className="rounded-[2rem] border border-white/80 bg-white/95 p-6 shadow-[0_18px_55px_rgba(15,23,42,0.12)]">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div>
            <div className="text-xs font-bold uppercase tracking-[0.35em] text-cyan-700">
              Workforce Travel Intelligence
            </div>
            <h2 className="mt-2 text-3xl font-black tracking-tight text-slate-950">Route History</h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-500">
              Per employee and day: distance travelled, travel, site, working, and idle time with jobs
              completed.
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

        <div className="mt-4 flex flex-wrap gap-3">
          <div className="flex flex-wrap gap-2">
            {(
              [
                ["today", "Today"],
                ["week", "This Week"],
                ["month", "This Month"],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => setPeriod(value)}
                className={`rounded-xl px-4 py-2 text-xs font-black uppercase tracking-wider ${
                  period === value
                    ? "bg-cyan-700 text-white"
                    : "border border-slate-200 bg-white text-slate-700"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          <label className="text-xs font-black uppercase tracking-wider text-slate-500">
            Employee
            <select
              value={employeeFilter}
              onChange={(e) => setEmployeeFilter(e.target.value)}
              className="mt-1 block min-w-[200px] rounded-xl border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-800"
            >
              <option value="">All field staff</option>
              {employees.map((emp) => (
                <option key={emp.id} value={emp.id}>
                  {employeeName(employees, emp.id)}
                </option>
              ))}
            </select>
          </label>
        </div>

        {snapshotError && (
          <p className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-950">
            {snapshotError}
          </p>
        )}
        {!tablesAvailable && !loading && (
          <p className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-950">
            Run <code className="rounded bg-white px-1">sql/014-field-operations.sql</code> and{" "}
            <code className="rounded bg-white px-1">sql/017-field-travel-intelligence.sql</code> in
            Supabase, wait ~30s, then refresh.
          </p>
        )}
      </section>

      {history && (
        <section className="grid gap-4 md:grid-cols-3 xl:grid-cols-6">
          {[
            { label: "Distance", value: formatDistanceKm(history.distanceKm) },
            { label: "Travel Time", value: formatDuration(history.travelSeconds) },
            { label: "Site Time", value: formatDuration(history.siteSeconds) },
            { label: "Working Time", value: formatDuration(history.workingSeconds) },
            { label: "Idle Time", value: formatDuration(history.idleSeconds) },
            { label: "Jobs Completed", value: String(history.jobsCompleted) },
          ].map((card) => (
            <div
              key={card.label}
              className="rounded-[1.5rem] border border-white/80 bg-white/95 p-4 shadow-sm"
            >
              <div className="text-2xl font-black text-slate-950">{loading ? "…" : card.value}</div>
              <div className="text-[10px] font-black uppercase tracking-wider text-slate-500">
                {card.label}
              </div>
            </div>
          ))}
        </section>
      )}

      <section className="rounded-[2rem] border border-white/80 bg-white/95 p-6 shadow-sm">
        <div className="flex items-center gap-2">
          <CalendarRange className="h-5 w-5 text-cyan-700" />
          <h3 className="text-lg font-black text-slate-950">Employee / day routes</h3>
        </div>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[960px] text-left text-sm">
            <thead>
              <tr className="text-[10px] font-black uppercase tracking-wider text-slate-500">
                <th className="px-3 py-2">Date</th>
                <th className="px-3 py-2">Employee</th>
                <th className="px-3 py-2">Distance</th>
                <th className="px-3 py-2">Travel</th>
                <th className="px-3 py-2">Site</th>
                <th className="px-3 py-2">Working</th>
                <th className="px-3 py-2">Idle</th>
                <th className="px-3 py-2">Jobs</th>
                <th className="px-3 py-2">Productivity</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={9} className="px-3 py-6 text-slate-500">
                    Loading route history…
                  </td>
                </tr>
              ) : grouped.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-3 py-6 text-slate-500">
                    No routes recorded for this period.
                  </td>
                </tr>
              ) : (
                grouped.map((journey) => (
                  <tr key={`${journey.employeeId}-${journey.routeDate}`} className="border-t border-slate-100">
                    <td className="px-3 py-3 font-semibold text-slate-700">{journey.routeDate}</td>
                    <td className="px-3 py-3 font-bold text-slate-950">
                      {employeeName(employees, journey.employeeId)}
                    </td>
                    <td className="px-3 py-3">{formatDistanceKm(journey.route.distanceKm)}</td>
                    <td className="px-3 py-3">{formatDuration(journey.route.travelSeconds)}</td>
                    <td className="px-3 py-3">{formatDuration(journey.route.siteSeconds)}</td>
                    <td className="px-3 py-3">{formatDuration(journey.route.workingSeconds)}</td>
                    <td className="px-3 py-3">{formatDuration(journey.route.idleSeconds)}</td>
                    <td className="px-3 py-3">{journey.route.jobsCompleted}</td>
                    <td className="px-3 py-3 font-black">{journey.route.productivityPct}%</td>
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

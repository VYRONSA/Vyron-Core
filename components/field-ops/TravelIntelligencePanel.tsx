"use client";

import React, { useEffect, useMemo, useState } from "react";
import {
  Briefcase,
  MapPin,
  Navigation,
  Percent,
  RefreshCcw,
  Route,
  Timer,
  Wrench,
} from "lucide-react";
import { fetchFieldOperationsSnapshot } from "@/lib/field-operations";
import {
  buildTravelIntelligenceLeaderboards,
  buildWorkforceJourneyDashboard,
  formatDistanceKm,
  formatDuration,
  syncFieldRoutesFromSnapshot,
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

function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function LeaderboardTable({
  title,
  rows,
  employees,
  valueLabel,
  formatValue,
}: {
  title: string;
  rows: { employeeId: string; value: number }[];
  employees: EmployeeRow[];
  valueLabel: string;
  formatValue: (value: number) => string;
}) {
  return (
    <div className="rounded-[1.5rem] border border-white/80 bg-white/95 p-5 shadow-sm">
      <h3 className="text-sm font-black uppercase tracking-wider text-slate-500">{title}</h3>
      <table className="mt-4 w-full text-left text-sm">
        <thead>
          <tr className="text-[10px] font-black uppercase tracking-wider text-slate-400">
            <th className="pb-2">Employee</th>
            <th className="pb-2 text-right">{valueLabel}</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={2} className="py-4 text-slate-500">
                No data for this date.
              </td>
            </tr>
          ) : (
            rows.map((row) => (
              <tr key={`${title}-${row.employeeId}`} className="border-t border-slate-100">
                <td className="py-2 font-semibold text-slate-800">
                  {employeeName(employees, row.employeeId)}
                </td>
                <td className="py-2 text-right font-black text-slate-950">
                  {formatValue(row.value)}
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

export default function TravelIntelligencePanel({ companyId, employees }: Props) {
  const [routeDate, setRouteDate] = useState(todayIsoDate);
  const [loading, setLoading] = useState(true);
  const [syncNote, setSyncNote] = useState<string | null>(null);
  const [snapshotError, setSnapshotError] = useState<string | null>(null);
  const [tablesAvailable, setTablesAvailable] = useState(true);
  const [dashboard, setDashboard] = useState<ReturnType<typeof buildWorkforceJourneyDashboard> | null>(
    null
  );

  async function load() {
    if (!companyId) return;
    setLoading(true);
    setSyncNote(null);
    const snapshot = await fetchFieldOperationsSnapshot(supabase, companyId);
    setTablesAvailable(snapshot.tablesAvailable);
    setSnapshotError(snapshot.error);
    const computed = buildWorkforceJourneyDashboard(snapshot, routeDate, companyId);
    setDashboard(computed);
    const sync = await syncFieldRoutesFromSnapshot(supabase, snapshot, routeDate);
    if (sync.error) setSyncNote(sync.error);
    setLoading(false);
  }

  useEffect(() => {
    void load();
  }, [companyId, routeDate]);

  const leaderboards = useMemo(
    () => (dashboard ? buildTravelIntelligenceLeaderboards(dashboard.journeys) : null),
    [dashboard]
  );

  const cards = [
    { label: "Distance Today", value: dashboard ? formatDistanceKm(dashboard.distanceKm) : "—", icon: Navigation },
    { label: "Travel Time", value: dashboard ? formatDuration(dashboard.travelSeconds) : "—", icon: Route },
    { label: "Site Time", value: dashboard ? formatDuration(dashboard.siteSeconds) : "—", icon: MapPin },
    { label: "Working Time", value: dashboard ? formatDuration(dashboard.workingSeconds) : "—", icon: Wrench },
    { label: "Idle Time", value: dashboard ? formatDuration(dashboard.idleSeconds) : "—", icon: Timer },
    { label: "Jobs Completed", value: dashboard ? String(dashboard.jobsCompleted) : "—", icon: Briefcase },
    { label: "Productivity %", value: dashboard ? `${dashboard.productivityPct}%` : "—", icon: Percent },
  ];

  return (
    <div className="space-y-6">
      <section className="rounded-[2rem] border border-white/80 bg-white/95 p-6 shadow-[0_18px_55px_rgba(15,23,42,0.12)]">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div>
            <div className="text-xs font-bold uppercase tracking-[0.35em] text-cyan-700">
              Workforce Travel Intelligence
            </div>
            <h2 className="mt-2 text-3xl font-black tracking-tight text-slate-950">
              Travel Intelligence
            </h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-500">
              Fleet-wide travel, site, working, and idle metrics with employee leaderboards derived from
              field operations events.
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

        <label className="mt-4 block text-xs font-black uppercase tracking-wider text-slate-500">
          Date
          <input
            type="date"
            value={routeDate}
            onChange={(e) => setRouteDate(e.target.value)}
            className="mt-1 block rounded-xl border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-800"
          />
        </label>

        {snapshotError && (
          <p className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-950">
            {snapshotError}
          </p>
        )}
        {syncNote && (
          <p className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-950">
            Route sync: {syncNote}
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

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {cards.map((card) => (
          <div
            key={card.label}
            className="rounded-[1.5rem] border border-white/80 bg-white/95 p-5 shadow-sm"
          >
            <card.icon className="h-5 w-5 text-cyan-700" />
            <div className="mt-4 text-3xl font-black text-slate-950">{loading ? "…" : card.value}</div>
            <div className="text-xs font-black uppercase tracking-wider text-slate-500">{card.label}</div>
          </div>
        ))}
      </section>

      {leaderboards && (
        <section className="grid gap-4 xl:grid-cols-2">
          <LeaderboardTable
            title="Top Travel Time"
            rows={leaderboards.topTravelTime.map((r) => ({
              employeeId: r.employeeId,
              value: r.travelSeconds,
            }))}
            employees={employees}
            valueLabel="Travel"
            formatValue={(v) => formatDuration(v)}
          />
          <LeaderboardTable
            title="Most Productive Employees"
            rows={leaderboards.mostProductive.map((r) => ({
              employeeId: r.employeeId,
              value: r.productivityPct,
            }))}
            employees={employees}
            valueLabel="Productivity"
            formatValue={(v) => `${v}%`}
          />
          <LeaderboardTable
            title="Highest Idle Time"
            rows={leaderboards.highestIdle.map((r) => ({
              employeeId: r.employeeId,
              value: r.idleSeconds,
            }))}
            employees={employees}
            valueLabel="Idle"
            formatValue={(v) => formatDuration(v)}
          />
          <LeaderboardTable
            title="Most Jobs Completed"
            rows={leaderboards.mostJobsCompleted.map((r) => ({
              employeeId: r.employeeId,
              value: r.jobsCompleted,
            }))}
            employees={employees}
            valueLabel="Jobs"
            formatValue={(v) => String(v)}
          />
        </section>
      )}
    </div>
  );
}

"use client";

import React, { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Briefcase,
  Clock3,
  MapPin,
  Navigation,
  Percent,
  RefreshCcw,
  Route,
  Timer,
  Wrench,
} from "lucide-react";
import {
  fetchFieldOperationsSnapshot,
  formatFieldTimestamp,
} from "@/lib/field-operations";
import {
  alertSeverityClass,
  buildWorkforceJourneyDashboard,
  formatDistanceKm,
  formatDuration,
  formatEventClockTime,
  segmentTypeClass,
  syncFieldRoutesFromSnapshot,
  type EmployeeJourneySummary,
  type FieldJourneyAlert,
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

export default function WorkforceJourneyPanel({ companyId, employees }: Props) {
  const [routeDate, setRouteDate] = useState(todayIsoDate);
  const [employeeFilter, setEmployeeFilter] = useState("");
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

  const filteredJourneys = useMemo(() => {
    if (!dashboard) return [];
    if (!employeeFilter) return dashboard.journeys;
    return dashboard.journeys.filter((j) => j.employeeId === employeeFilter);
  }, [dashboard, employeeFilter]);

  const visibleAlerts = useMemo(() => {
    if (!dashboard) return [];
    const ids = new Set(filteredJourneys.map((j) => j.employeeId));
    if (!employeeFilter) return dashboard.alerts;
    return dashboard.alerts.filter((a) => ids.has(a.employeeId));
  }, [dashboard, filteredJourneys, employeeFilter]);

  const cards = [
    {
      label: "Distance Today",
      value: dashboard ? formatDistanceKm(dashboard.distanceKm) : "—",
      icon: Navigation,
    },
    {
      label: "Travel Time",
      value: dashboard ? formatDuration(dashboard.travelSeconds) : "—",
      icon: Route,
    },
    {
      label: "Site Time",
      value: dashboard ? formatDuration(dashboard.siteSeconds) : "—",
      icon: MapPin,
    },
    {
      label: "Working Time",
      value: dashboard ? formatDuration(dashboard.workingSeconds) : "—",
      icon: Wrench,
    },
    {
      label: "Idle Time",
      value: dashboard ? formatDuration(dashboard.idleSeconds) : "—",
      icon: Timer,
    },
    {
      label: "Jobs Completed",
      value: dashboard ? String(dashboard.jobsCompleted) : "—",
      icon: Briefcase,
    },
    {
      label: "Productivity %",
      value: dashboard ? `${dashboard.productivityPct}%` : "—",
      icon: Percent,
    },
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
              Workforce Journey
            </h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-500">
              Distance, travel, site, working, and idle time calculated automatically from field
              operations events. Productivity and operational alerts update in real time.
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
          <label className="text-xs font-black uppercase tracking-wider text-slate-500">
            Date
            <input
              type="date"
              value={routeDate}
              onChange={(e) => setRouteDate(e.target.value)}
              className="mt-1 block rounded-xl border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-800"
            />
          </label>
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

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {cards.map((card) => (
          <div
            key={card.label}
            className="rounded-[1.5rem] border border-white/80 bg-white/95 p-5 shadow-sm"
          >
            <card.icon className="h-5 w-5 text-cyan-700" />
            <div className="mt-4 text-3xl font-black text-slate-950">{loading ? "…" : card.value}</div>
            <div className="text-xs font-black uppercase tracking-wider text-slate-500">
              {card.label}
            </div>
          </div>
        ))}
      </section>

      <section className="rounded-[2rem] border border-white/80 bg-white/95 p-6 shadow-sm">
        <div className="flex items-center gap-2">
          <AlertTriangle className="h-5 w-5 text-amber-600" />
          <h3 className="text-lg font-black text-slate-950">Travel &amp; site alerts</h3>
        </div>
        <div className="mt-4 space-y-3">
          {loading ? (
            <p className="text-sm font-semibold text-slate-500">Loading alerts…</p>
          ) : visibleAlerts.length === 0 ? (
            <p className="text-sm font-semibold text-slate-500">No alerts for this date.</p>
          ) : (
            visibleAlerts.map((alert) => (
              <AlertRow key={alert.id} alert={alert} employees={employees} />
            ))
          )}
        </div>
      </section>

      <section className="rounded-[2rem] border border-white/80 bg-white/95 p-6 shadow-sm">
        <h3 className="text-lg font-black text-slate-950">Employee journeys</h3>
        <div className="mt-4 space-y-4">
          {loading ? (
            <p className="text-sm font-semibold text-slate-500">Loading journeys…</p>
          ) : filteredJourneys.length === 0 ? (
            <p className="text-sm font-semibold text-slate-500">
              No field events recorded for {routeDate}.
            </p>
          ) : (
            filteredJourneys.map((journey) => (
              <JourneyCard key={journey.employeeId} journey={journey} employees={employees} />
            ))
          )}
        </div>
      </section>
    </div>
  );
}

function AlertRow({
  alert,
  employees,
}: {
  alert: FieldJourneyAlert;
  employees: EmployeeRow[];
}) {
  return (
    <div
      className={`rounded-2xl border px-4 py-3 ${alertSeverityClass(alert.severity)}`}
    >
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

function JourneyCard({
  journey,
  employees,
}: {
  journey: EmployeeJourneySummary;
  employees: EmployeeRow[];
}) {
  const { route } = journey;
  return (
    <div className="rounded-2xl border border-slate-100 bg-slate-50/80 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="font-black text-slate-950">{employeeName(employees, journey.employeeId)}</div>
          <div className="mt-1 text-xs font-semibold text-slate-500">
            {formatDistanceKm(route.distanceKm)} travel · {formatDuration(route.travelSeconds)} ·{" "}
            {route.jobsCompleted} jobs · {route.productivityPct}% productive
          </div>
        </div>
        <span className="rounded-full bg-white px-3 py-1 text-[10px] font-black uppercase tracking-wider text-slate-600">
          {route.status}
        </span>
      </div>

      {journey.events.length > 0 && (
        <div className="mt-4 rounded-xl border border-slate-200 bg-white p-4">
          <div className="text-[10px] font-black uppercase tracking-wider text-slate-500">Timeline</div>
          <ol className="mt-3 space-y-2">
            {journey.events.map((event) => (
              <li
                key={event.id}
                className="flex items-center gap-3 text-sm font-semibold text-slate-800"
              >
                <span className="w-12 shrink-0 font-mono text-xs text-cyan-800">
                  {formatEventClockTime(event.recordedAt)}
                </span>
                <span className="h-2 w-2 shrink-0 rounded-full bg-cyan-500" />
                <span>{event.eventType}</span>
              </li>
            ))}
          </ol>
        </div>
      )}

      <div className="mt-3 grid gap-2 sm:grid-cols-4">
        {[
          { label: "Travel", value: formatDuration(route.travelSeconds) },
          { label: "Site", value: formatDuration(route.siteSeconds) },
          { label: "Working", value: formatDuration(route.workingSeconds) },
          { label: "Idle", value: formatDuration(route.idleSeconds) },
        ].map((item) => (
          <div key={item.label} className="rounded-xl bg-white px-3 py-2">
            <div className="text-[10px] font-black uppercase tracking-wider text-slate-500">
              {item.label}
            </div>
            <div className="text-sm font-bold text-slate-900">{item.value}</div>
          </div>
        ))}
      </div>

      {route.segments.length > 0 && (
        <div className="mt-4 overflow-x-auto">
          <table className="min-w-full text-left text-xs">
            <thead>
              <tr className="text-[10px] font-black uppercase tracking-wider text-slate-500">
                <th className="px-2 py-2">Segment</th>
                <th className="px-2 py-2">Duration</th>
                <th className="px-2 py-2">Distance</th>
                <th className="px-2 py-2">Started</th>
              </tr>
            </thead>
            <tbody>
              {route.segments.map((segment, index) => (
                <tr key={`${segment.fromEventId}-${index}`} className="border-t border-slate-200">
                  <td className="px-2 py-2">
                    <span
                      className={`rounded-full px-2 py-1 text-[10px] font-black uppercase ${segmentTypeClass(segment.segmentType)}`}
                    >
                      {segment.segmentType}
                    </span>
                  </td>
                  <td className="px-2 py-2 font-semibold text-slate-700">
                    {formatDuration(segment.durationSeconds)}
                  </td>
                  <td className="px-2 py-2 font-semibold text-slate-700">
                    {segment.distanceKm > 0 ? formatDistanceKm(segment.distanceKm) : "—"}
                  </td>
                  <td className="px-2 py-2 font-semibold text-slate-600">
                    <Clock3 className="mr-1 inline h-3 w-3" />
                    {formatFieldTimestamp(segment.startedAt)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

"use client";

import React, { useEffect, useMemo, useState } from "react";
import {
  Briefcase,
  ClipboardList,
  MapPin,
  Navigation,
  Percent,
  RefreshCcw,
  Route,
  ShieldAlert,
  Smartphone,
  Timer,
  Truck,
  Users,
} from "lucide-react";
import {
  computeFieldOperationsMetrics,
  fetchFieldOperationsSnapshot,
  formatFieldTimestamp,
  jobStatusClass,
  type FieldOperationsSnapshot,
} from "@/lib/field-operations";
import {
  buildWorkforceJourneyDashboard,
  formatDistanceKm,
  formatDuration,
} from "@/lib/field-travel-intelligence";
import { supabase } from "@/lib/supabase";

type EmployeeRow = { id: string; first_name: string; last_name: string };

type Props = {
  companyId: string;
  employees: EmployeeRow[];
  onNavigate: (target: string) => void;
};

function employeeName(employees: EmployeeRow[], id: string) {
  const row = employees.find((e) => e.id === id);
  if (!row) return "Unknown";
  return `${row.first_name} ${row.last_name}`.trim();
}

export default function FieldOperationsDashboard({ companyId, employees, onNavigate }: Props) {
  const [snapshot, setSnapshot] = useState<FieldOperationsSnapshot | null>(null);
  const [loading, setLoading] = useState(true);

  async function load() {
    if (!companyId) return;
    setLoading(true);
    const data = await fetchFieldOperationsSnapshot(supabase, companyId);
    setSnapshot(data);
    setLoading(false);
  }

  useEffect(() => {
    void load();
  }, [companyId]);

  const metrics = useMemo(
    () => (snapshot ? computeFieldOperationsMetrics(snapshot) : null),
    [snapshot]
  );

  const travelMetrics = useMemo(() => {
    if (!snapshot || !companyId) return null;
    const today = new Date().toISOString().slice(0, 10);
    return buildWorkforceJourneyDashboard(snapshot, today, companyId);
  }, [snapshot, companyId]);

  const recentJobs = snapshot?.jobs.slice(0, 6) ?? [];
  const recentEvents = snapshot?.events.slice(0, 8) ?? [];

  return (
    <div className="space-y-6">
      <section className="rounded-[2rem] border border-white/80 bg-white/95 p-6 shadow-[0_18px_55px_rgba(15,23,42,0.12)]">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div>
            <div className="text-xs font-bold uppercase tracking-[0.35em] text-cyan-700">
              Workforce Operations
            </div>
            <h2 className="mt-2 text-3xl font-black tracking-tight text-slate-950">
              Field Operations Dashboard
            </h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-500">
              Live operational view of dispatched jobs, site visits, field events, and mobile workforce
              activity. Fixed sites, customer addresses, mobile assets, and GPS locations supported.
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

        {snapshot?.error && (
          <p className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-950">
            {snapshot.error}
          </p>
        )}
        {!snapshot?.tablesAvailable && !loading && (
          <p className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-950">
            Run <code className="rounded bg-white px-1">sql/014-field-operations.sql</code> in Supabase,
            wait ~30s, then refresh.
          </p>
        )}
      </section>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {[
          { label: "Active jobs", value: metrics?.activeJobs ?? 0, icon: Briefcase },
          { label: "On site", value: metrics?.onSite ?? 0, icon: MapPin },
          { label: "Travelling", value: metrics?.travelling ?? 0, icon: Route },
          { label: "Active shifts", value: metrics?.activeShifts ?? 0, icon: Users },
        ].map((card) => (
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

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {[
          {
            label: "Distance Today",
            value: travelMetrics ? formatDistanceKm(travelMetrics.distanceKm) : "—",
            icon: Navigation,
          },
          {
            label: "Travel Time",
            value: travelMetrics ? formatDuration(travelMetrics.travelSeconds) : "—",
            icon: Route,
          },
          {
            label: "Site Time",
            value: travelMetrics ? formatDuration(travelMetrics.siteSeconds) : "—",
            icon: MapPin,
          },
          {
            label: "Idle Time",
            value: travelMetrics ? formatDuration(travelMetrics.idleSeconds) : "—",
            icon: Timer,
          },
          {
            label: "Jobs Completed",
            value: travelMetrics ? String(travelMetrics.jobsCompleted) : "—",
            icon: Briefcase,
          },
          {
            label: "Productivity %",
            value: travelMetrics ? `${travelMetrics.productivityPct}%` : "—",
            icon: Percent,
          },
        ].map((card) => (
          <div
            key={card.label}
            className="rounded-[1.5rem] border border-amber-100/80 bg-amber-50/50 p-5 shadow-sm"
          >
            <card.icon className="h-5 w-5 text-amber-800" />
            <div className="mt-4 text-3xl font-black text-slate-950">{loading ? "…" : card.value}</div>
            <div className="text-xs font-black uppercase tracking-wider text-slate-500">{card.label}</div>
          </div>
        ))}
      </section>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <button
          type="button"
          onClick={() => onNavigate("Job Visits")}
          className="rounded-[1.5rem] border border-cyan-100 bg-cyan-50/80 p-5 text-left transition hover:-translate-y-0.5"
        >
          <ClipboardList className="h-5 w-5 text-cyan-800" />
          <div className="mt-3 font-black text-slate-950">Job Visits</div>
          <div className="mt-1 text-xs font-semibold text-slate-600">Create and dispatch field jobs</div>
        </button>
        <button
          type="button"
          onClick={() => onNavigate("Job Timeline")}
          className="rounded-[1.5rem] border border-violet-100 bg-violet-50/80 p-5 text-left transition hover:-translate-y-0.5"
        >
          <Route className="h-5 w-5 text-violet-800" />
          <div className="mt-3 font-black text-slate-950">Job Timeline</div>
          <div className="mt-1 text-xs font-semibold text-slate-600">Audit trail of field events</div>
        </button>
        <button
          type="button"
          onClick={() => onNavigate("Field Mobile")}
          className="rounded-[1.5rem] border border-emerald-100 bg-emerald-50/80 p-5 text-left transition hover:-translate-y-0.5"
        >
          <Smartphone className="h-5 w-5 text-emerald-800" />
          <div className="mt-3 font-black text-slate-950">Employee Mobile</div>
          <div className="mt-1 text-xs font-semibold text-slate-600">Start day, travel, site workflow</div>
        </button>
        <button
          type="button"
          onClick={() => onNavigate("Workforce Journey")}
          className="rounded-[1.5rem] border border-amber-100 bg-amber-50/80 p-5 text-left transition hover:-translate-y-0.5"
        >
          <Route className="h-5 w-5 text-amber-800" />
          <div className="mt-3 font-black text-slate-950">Workforce Journey</div>
          <div className="mt-1 text-xs font-semibold text-slate-600">
            Travel distance, site time, productivity &amp; alerts
          </div>
        </button>
        <button
          type="button"
          onClick={() => onNavigate("Travel Intelligence")}
          className="rounded-[1.5rem] border border-blue-100 bg-blue-50/80 p-5 text-left transition hover:-translate-y-0.5"
        >
          <Navigation className="h-5 w-5 text-blue-800" />
          <div className="mt-3 font-black text-slate-950">Travel Intelligence</div>
          <div className="mt-1 text-xs font-semibold text-slate-600">
            Leaderboards and fleet travel metrics
          </div>
        </button>
        <button
          type="button"
          onClick={() => onNavigate("Route History")}
          className="rounded-[1.5rem] border border-slate-200 bg-slate-50/80 p-5 text-left transition hover:-translate-y-0.5"
        >
          <Route className="h-5 w-5 text-slate-700" />
          <div className="mt-3 font-black text-slate-950">Route History</div>
          <div className="mt-1 text-xs font-semibold text-slate-600">
            Per employee/day distance and time breakdown
          </div>
        </button>
        <button
          type="button"
          onClick={() => onNavigate("Vehicle Intelligence")}
          className="rounded-[1.5rem] border border-teal-100 bg-teal-50/80 p-5 text-left transition hover:-translate-y-0.5"
        >
          <Truck className="h-5 w-5 text-teal-800" />
          <div className="mt-3 font-black text-slate-950">Vehicle Intelligence</div>
          <div className="mt-1 text-xs font-semibold text-slate-600">
            Fleet, trailers, assets, costs &amp; risk
          </div>
        </button>
        <button
          type="button"
          onClick={() => onNavigate("Workforce Cost Intelligence")}
          className="rounded-[1.5rem] border border-rose-100 bg-rose-50/80 p-5 text-left transition hover:-translate-y-0.5"
        >
          <Briefcase className="h-5 w-5 text-rose-800" />
          <div className="mt-3 font-black text-slate-950">Workforce Cost Intelligence</div>
          <div className="mt-1 text-xs font-semibold text-slate-600">
            Labour, travel, idle, margin &amp; leakage
          </div>
        </button>
        <button
          type="button"
          onClick={() => onNavigate("Profitability Intelligence")}
          className="rounded-[1.5rem] border border-rose-100 bg-rose-50/70 p-5 text-left transition hover:-translate-y-0.5"
        >
          <Percent className="h-5 w-5 text-rose-800" />
          <div className="mt-3 font-black text-slate-950">Profitability Intelligence</div>
          <div className="mt-1 text-xs font-semibold text-slate-600">
            Client, job, technician &amp; site margin analysis
          </div>
        </button>
        <button
          type="button"
          onClick={() => onNavigate("Workforce Risk Intelligence")}
          className="rounded-[1.5rem] border border-violet-100 bg-violet-50/80 p-5 text-left transition hover:-translate-y-0.5"
        >
          <ShieldAlert className="h-5 w-5 text-violet-800" />
          <div className="mt-3 font-black text-slate-950">Workforce Risk Intelligence</div>
          <div className="mt-1 text-xs font-semibold text-slate-600">
            Green / amber / red scoring &amp; AI recommendations
          </div>
        </button>
      </section>

      <section className="grid gap-6 xl:grid-cols-2">
        <div className="rounded-[2rem] border border-white/80 bg-white/95 p-6 shadow-sm">
          <h3 className="text-lg font-black text-slate-950">Recent jobs</h3>
          <div className="mt-4 space-y-3">
            {recentJobs.length === 0 ? (
              <p className="text-sm font-semibold text-slate-500">No field jobs yet.</p>
            ) : (
              recentJobs.map((job) => (
                <div
                  key={job.id}
                  className="flex items-start justify-between gap-3 rounded-2xl border border-slate-100 bg-slate-50/80 px-4 py-3"
                >
                  <div>
                    <div className="font-bold text-slate-950">{job.title}</div>
                    <div className="text-xs font-semibold text-slate-500">{job.jobRef}</div>
                  </div>
                  <span
                    className={`rounded-full px-3 py-1 text-[10px] font-black uppercase tracking-wider ${jobStatusClass(job.status)}`}
                  >
                    {job.status}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="rounded-[2rem] border border-white/80 bg-white/95 p-6 shadow-sm">
          <h3 className="text-lg font-black text-slate-950">Recent field events</h3>
          <div className="mt-4 space-y-3">
            {recentEvents.length === 0 ? (
              <p className="text-sm font-semibold text-slate-500">No events recorded yet.</p>
            ) : (
              recentEvents.map((event) => (
                <div
                  key={event.id}
                  className="rounded-2xl border border-slate-100 bg-slate-50/80 px-4 py-3"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="font-bold text-slate-950">{event.eventType}</div>
                    <div className="text-xs font-semibold text-slate-500">
                      {formatFieldTimestamp(event.recordedAt)}
                    </div>
                  </div>
                  <div className="mt-1 text-xs font-semibold text-slate-600">
                    {employeeName(employees, event.employeeId)}
                    {event.latitude != null && event.longitude != null
                      ? ` · GPS ${event.latitude.toFixed(4)}, ${event.longitude.toFixed(4)}`
                      : ""}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-2">
        <div className="rounded-[1.5rem] border border-slate-200 bg-slate-50/80 p-5">
          <Truck className="h-5 w-5 text-slate-600" />
          <div className="mt-2 text-2xl font-black">{metrics?.vehicles ?? 0}</div>
          <div className="text-xs font-black uppercase tracking-wider text-slate-500">Fleet vehicles</div>
        </div>
        <div className="rounded-[1.5rem] border border-slate-200 bg-slate-50/80 p-5">
          <Briefcase className="h-5 w-5 text-slate-600" />
          <div className="mt-2 text-2xl font-black">{metrics?.assets ?? 0}</div>
          <div className="text-xs font-black uppercase tracking-wider text-slate-500">Mobile assets</div>
        </div>
      </section>
    </div>
  );
}

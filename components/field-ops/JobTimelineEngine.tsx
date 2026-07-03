"use client";

import React, { useEffect, useMemo, useState } from "react";
import { Camera, MapPin, RefreshCcw, Route } from "lucide-react";
import {
  eventTypeClass,
  fetchFieldOperationsSnapshot,
  FIELD_EVENT_TYPES,
  formatFieldTimestamp,
  type FieldJob,
  type FieldJobEvent,
} from "@/lib/field-operations";
import { supabase } from "@/lib/supabase";

type EmployeeRow = { id: string; first_name: string; last_name: string };

type Props = {
  companyId: string;
  employees: EmployeeRow[];
};

function employeeName(employees: EmployeeRow[], id: string) {
  const row = employees.find((e) => e.id === id);
  if (!row) return "Unknown employee";
  return `${row.first_name} ${row.last_name}`.trim();
}

function jobLabel(jobs: FieldJob[], jobId: string | null) {
  if (!jobId) return "Day workflow";
  const job = jobs.find((item) => item.id === jobId);
  return job ? `${job.jobRef} · ${job.title}` : "Unknown job";
}

export default function JobTimelineEngine({ companyId, employees }: Props) {
  const [events, setEvents] = useState<FieldJobEvent[]>([]);
  const [jobs, setJobs] = useState<FieldJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [jobFilter, setJobFilter] = useState("");
  const [employeeFilter, setEmployeeFilter] = useState("");
  const [eventFilter, setEventFilter] = useState("");

  async function load() {
    if (!companyId) return;
    setLoading(true);
    const snapshot = await fetchFieldOperationsSnapshot(supabase, companyId);
    setEvents(snapshot.events);
    setJobs(snapshot.jobs);
    setLoading(false);
  }

  useEffect(() => {
    void load();
  }, [companyId]);

  const filtered = useMemo(() => {
    return events.filter((event) => {
      if (jobFilter && event.jobId !== jobFilter) return false;
      if (employeeFilter && event.employeeId !== employeeFilter) return false;
      if (eventFilter && event.eventType !== eventFilter) return false;
      return true;
    });
  }, [events, jobFilter, employeeFilter, eventFilter]);

  return (
    <div className="space-y-6">
      <section className="rounded-[2rem] border border-white/80 bg-white/95 p-6 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="text-xs font-bold uppercase tracking-[0.35em] text-violet-700">
              Job Timeline Engine
            </div>
            <h2 className="mt-2 text-2xl font-black text-slate-950">Operational event trail</h2>
            <p className="mt-2 text-sm text-slate-500">
              Every field event stores employee, timestamp, GPS, photo URL, and notes.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void load()}
            className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 px-4 py-2 text-sm font-black"
          >
            <RefreshCcw className="h-4 w-4" />
            Refresh
          </button>
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-3">
        <label className="block text-sm font-bold text-slate-700">
          Filter job
          <select
            value={jobFilter}
            onChange={(e) => setJobFilter(e.target.value)}
            className="mt-2 w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm font-semibold"
          >
            <option value="">All jobs</option>
            {jobs.map((job) => (
              <option key={job.id} value={job.id}>
                {job.jobRef} · {job.title}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm font-bold text-slate-700">
          Filter employee
          <select
            value={employeeFilter}
            onChange={(e) => setEmployeeFilter(e.target.value)}
            className="mt-2 w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm font-semibold"
          >
            <option value="">All employees</option>
            {employees.map((employee) => (
              <option key={employee.id} value={employee.id}>
                {employeeName(employees, employee.id)}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm font-bold text-slate-700">
          Filter event type
          <select
            value={eventFilter}
            onChange={(e) => setEventFilter(e.target.value)}
            className="mt-2 w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm font-semibold"
          >
            <option value="">All events</option>
            {FIELD_EVENT_TYPES.map((type) => (
              <option key={type} value={type}>
                {type}
              </option>
            ))}
          </select>
        </label>
      </section>

      <section className="rounded-[2rem] border border-white/80 bg-white/95 p-6 shadow-sm">
        {loading ? (
          <p className="text-sm font-semibold text-slate-500">Loading timeline…</p>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-6 py-12 text-center">
            <Route className="h-8 w-8 text-slate-400" />
            <p className="mt-3 font-black text-slate-900">No timeline events</p>
            <p className="mt-1 text-sm text-slate-500">
              Field events from the mobile workflow will appear here in chronological order.
            </p>
          </div>
        ) : (
          <ol className="relative space-y-0 border-l-2 border-cyan-200 pl-6">
            {filtered.map((event) => (
              <li key={event.id} className="relative pb-8 last:pb-0">
                <span className="absolute -left-[1.6rem] top-1 flex h-5 w-5 items-center justify-center rounded-full bg-cyan-500 ring-4 ring-white" />
                <div className="rounded-2xl border border-slate-100 bg-slate-50/80 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <span
                      className={`rounded-full px-3 py-1 text-[10px] font-black uppercase tracking-wider ${eventTypeClass(event.eventType)}`}
                    >
                      {event.eventType}
                    </span>
                    <span className="text-xs font-semibold text-slate-500">
                      {formatFieldTimestamp(event.recordedAt)}
                    </span>
                  </div>
                  <div className="mt-2 font-bold text-slate-950">
                    {employeeName(employees, event.employeeId)}
                  </div>
                  <div className="mt-1 text-xs font-semibold text-slate-600">
                    {jobLabel(jobs, event.jobId)}
                  </div>
                  <div className="mt-3 flex flex-wrap gap-3 text-xs font-semibold text-slate-600">
                    {event.latitude != null && event.longitude != null && (
                      <span className="inline-flex items-center gap-1">
                        <MapPin className="h-3.5 w-3.5" />
                        {event.latitude.toFixed(5)}, {event.longitude.toFixed(5)}
                        {event.gpsAccuracy != null ? ` (±${Math.round(event.gpsAccuracy)}m)` : ""}
                      </span>
                    )}
                    {event.photoUrl && (
                      <span className="inline-flex items-center gap-1 text-cyan-800">
                        <Camera className="h-3.5 w-3.5" />
                        Photo captured
                      </span>
                    )}
                  </div>
                  {event.notes && (
                    <p className="mt-3 rounded-xl bg-white px-3 py-2 text-sm text-slate-700">
                      {event.notes}
                    </p>
                  )}
                </div>
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}

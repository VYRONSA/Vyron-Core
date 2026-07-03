"use client";

import React, { useEffect, useMemo, useState } from "react";
import {
  Camera,
  CheckCircle2,
  MapPin,
  RefreshCcw,
  Smartphone,
} from "lucide-react";
import {
  captureBrowserGps,
  fetchFieldOperationsSnapshot,
  FIELD_EVENT_TYPES,
  formatFieldTimestamp,
  recordFieldJobEvent,
  type FieldEventType,
  type FieldJob,
} from "@/lib/field-operations";
import { supabase } from "@/lib/supabase";

type EmployeeRow = {
  id: string;
  first_name: string;
  last_name: string;
  active: boolean;
};

type Props = {
  companyId: string;
  employees: EmployeeRow[];
};

const WORKFLOW_EVENT_TYPES: FieldEventType[] = [
  "Start Day",
  "Start Travel",
  "Arrive Site",
  "Start Job",
  "Pause Job",
  "Resume Job",
  "Complete Job",
  "Leave Site",
  "End Day",
];

function employeeName(employee: EmployeeRow) {
  return `${employee.first_name} ${employee.last_name}`.trim();
}

export default function EmployeeFieldWorkflow({ companyId, employees }: Props) {
  const [employeeId, setEmployeeId] = useState("");
  const [jobId, setJobId] = useState("");
  const [jobs, setJobs] = useState<FieldJob[]>([]);
  const [notes, setNotes] = useState("");
  const [photoUrl, setPhotoUrl] = useState("");
  const [busyType, setBusyType] = useState<FieldEventType | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastGps, setLastGps] = useState<string | null>(null);
  const [recentEvents, setRecentEvents] = useState<
    { eventType: FieldEventType; recordedAt: string }[]
  >([]);

  const activeEmployees = useMemo(
    () => employees.filter((employee) => employee.active),
    [employees]
  );

  const assignedJobs = useMemo(() => {
    if (!employeeId) return jobs.filter((job) => job.status !== "Completed" && job.status !== "Cancelled");
    return jobs.filter(
      (job) =>
        job.status !== "Completed" &&
        job.status !== "Cancelled" &&
        (job.status !== "Pending" || jobId === job.id)
    );
  }, [jobs, employeeId, jobId]);

  async function load() {
    if (!companyId) return;
    const snapshot = await fetchFieldOperationsSnapshot(supabase, companyId);
    setJobs(snapshot.jobs);
    if (employeeId) {
      const mine = snapshot.events
        .filter((event) => event.employeeId === employeeId)
        .slice(0, 6)
        .map((event) => ({ eventType: event.eventType, recordedAt: event.recordedAt }));
      setRecentEvents(mine);
    }
  }

  useEffect(() => {
    void load();
  }, [companyId, employeeId]);

  useEffect(() => {
    if (!employeeId && activeEmployees.length === 1) {
      setEmployeeId(activeEmployees[0].id);
    }
  }, [activeEmployees, employeeId]);

  async function handleRecord(eventType: FieldEventType) {
    setError(null);
    setMessage(null);

    if (!companyId) {
      setError("No active company workspace.");
      return;
    }
    if (!employeeId) {
      setError("Select an employee.");
      return;
    }

    const requiresJob =
      eventType !== "Start Day" && eventType !== "End Day";
    if (requiresJob && !jobId) {
      setError("Select a job for this event.");
      return;
    }

    setBusyType(eventType);
    const gps = await captureBrowserGps();
    if (gps.latitude != null && gps.longitude != null) {
      setLastGps(`${gps.latitude.toFixed(5)}, ${gps.longitude.toFixed(5)}`);
    }

    const result = await recordFieldJobEvent(supabase, {
      companyId,
      employeeId,
      eventType,
      jobId: requiresJob ? jobId : null,
      gps,
      photoUrl: photoUrl.trim() || null,
      notes: notes.trim() || null,
      deviceInfo:
        typeof navigator !== "undefined"
          ? `${navigator.userAgent.slice(0, 120)}`
          : null,
    });
    setBusyType(null);

    if (result.error) {
      setError(result.error);
      return;
    }

    setMessage(`${eventType} recorded at ${formatFieldTimestamp(result.event?.recordedAt || "")}.`);
    setNotes("");
    await load();
  }

  return (
    <div className="space-y-6">
      <section className="rounded-[2rem] border border-[#06101f] bg-[#06101f] p-6 text-white shadow-xl">
        <div className="flex items-center gap-3">
          <div className="rounded-2xl bg-cyan-400/15 p-3 text-cyan-300">
            <Smartphone className="h-6 w-6" />
          </div>
          <div>
            <div className="text-xs font-bold uppercase tracking-[0.35em] text-cyan-300">
              Employee Mobile Workflow
            </div>
            <h2 className="mt-1 text-2xl font-black">Field operations capture</h2>
          </div>
        </div>
        <p className="mt-4 text-sm leading-6 text-slate-300">
          Production-ready day workflow: start day, travel, arrive, job actions, leave site, end day.
          Each event captures GPS, optional photo URL, and notes.
        </p>
      </section>

      <section className="rounded-[2rem] border border-white/80 bg-white/95 p-6 shadow-sm">
        <div className="grid gap-4 md:grid-cols-2">
          <label className="block text-sm font-bold text-slate-700">
            Employee
            <select
              value={employeeId}
              onChange={(e) => setEmployeeId(e.target.value)}
              className="mt-2 w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm font-semibold"
            >
              <option value="">Select employee…</option>
              {activeEmployees.map((employee) => (
                <option key={employee.id} value={employee.id}>
                  {employeeName(employee)}
                </option>
              ))}
            </select>
          </label>

          <label className="block text-sm font-bold text-slate-700">
            Active job
            <select
              value={jobId}
              onChange={(e) => setJobId(e.target.value)}
              className="mt-2 w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm font-semibold"
            >
              <option value="">Select job (for site events)…</option>
              {assignedJobs.map((job) => (
                <option key={job.id} value={job.id}>
                  {job.jobRef} · {job.title} ({job.status})
                </option>
              ))}
            </select>
          </label>

          <label className="block text-sm font-bold text-slate-700 md:col-span-2">
            Photo URL (optional)
            <input
              value={photoUrl}
              onChange={(e) => setPhotoUrl(e.target.value)}
              placeholder="https://… or storage path after upload"
              className="mt-2 w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm font-semibold"
            />
          </label>

          <label className="block text-sm font-bold text-slate-700 md:col-span-2">
            Notes (optional)
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              className="mt-2 w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm font-semibold"
            />
          </label>
        </div>

        {lastGps && (
          <p className="mt-4 inline-flex items-center gap-2 rounded-2xl bg-cyan-50 px-4 py-2 text-xs font-semibold text-cyan-900">
            <MapPin className="h-4 w-4" />
            Last GPS: {lastGps}
          </p>
        )}

        {error && (
          <p className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-800">
            {error}
          </p>
        )}
        {message && (
          <p className="mt-4 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-800">
            <CheckCircle2 className="mr-1 inline h-4 w-4" />
            {message}
          </p>
        )}

        <div className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {WORKFLOW_EVENT_TYPES.map((eventType) => (
            <button
              key={eventType}
              type="button"
              disabled={busyType !== null}
              onClick={() => void handleRecord(eventType)}
              className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 text-left text-sm font-black text-slate-900 transition hover:border-cyan-300 hover:bg-cyan-50 disabled:opacity-50"
            >
              {busyType === eventType ? "Recording…" : eventType}
            </button>
          ))}
        </div>

        <button
          type="button"
          onClick={() => void load()}
          className="mt-4 inline-flex items-center gap-2 text-xs font-black text-slate-500"
        >
          <RefreshCcw className="h-3.5 w-3.5" />
          Refresh activity
        </button>
      </section>

      <section className="rounded-[2rem] border border-white/80 bg-white/95 p-6 shadow-sm">
        <h3 className="text-lg font-black text-slate-950">Recent events</h3>
        {recentEvents.length === 0 ? (
          <p className="mt-3 text-sm font-semibold text-slate-500">No events for this employee yet.</p>
        ) : (
          <ul className="mt-4 space-y-2">
            {recentEvents.map((event, index) => (
              <li
                key={`${event.eventType}-${event.recordedAt}-${index}`}
                className="flex items-center justify-between rounded-xl bg-slate-50 px-4 py-3 text-sm"
              >
                <span className="font-bold text-slate-900">{event.eventType}</span>
                <span className="text-xs font-semibold text-slate-500">
                  {formatFieldTimestamp(event.recordedAt)}
                </span>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-4 text-xs font-semibold text-slate-500">
          Supported event types: {FIELD_EVENT_TYPES.join(" · ")}
        </p>
        <p className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-slate-500">
          <Camera className="h-3.5 w-3.5" />
          Photo URL stored on each event when provided.
        </p>
      </section>
    </div>
  );
}

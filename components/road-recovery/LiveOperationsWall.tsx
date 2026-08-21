"use client";

/**
 * Road & Recovery Live Operations Wall — MINIMUM Phase 1 view.
 *
 * Deliberately narrow: active jobs, where each one is in the workflow, who is on it, and
 * how long it has been in its current state. It is NOT the executive command centre, and
 * it does not compute SLA compliance, financial impact or intelligence — those belong to
 * later phases and would be fabricated from data the Phase 0/1 model does not hold.
 */

import React, { useMemo } from "react";
import { RR_POLL_INTERVALS, rrFetchJson, useRrPoll } from "@/lib/road-recovery/use-rr-poll";

type JobRow = {
  id: string;
  service_state: string;
  state_entered_at: string | null;
  origin_label: string | null;
  origin_address: string | null;
  destination_label: string | null;
  vehicle_registration: string | null;
};

type BoardPayload = {
  fetchedAt: string;
  jobs: JobRow[];
  assignments: { id: string; service_job_id: string; employee_id: string; assignment_status: string }[];
  employees: { id: string; first_name: string; last_name: string }[];
};

/** States that represent work actually in progress right now. */
const ACTIVE_STATES = new Set([
  "assigned",
  "accepted",
  "en_route",
  "on_scene",
  "assessing",
  "loading",
  "secured",
  "departing_scene",
  "in_transit",
  "arrived_destination",
  "offloading",
  "handover_pending",
]);

const AWAITING_STATES = new Set(["logged", "authorisation_pending", "authorised", "dispatch_pending"]);

function minutesSince(iso: string | null): number | null {
  if (!iso) return null;
  const ms = Date.now() - new Date(iso).getTime();
  return Number.isFinite(ms) ? Math.max(0, Math.round(ms / 60000)) : null;
}

function StatTile({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div className={`rounded-2xl border p-4 ${tone}`}>
      <div className="text-3xl font-black">{value}</div>
      <div className="mt-1 text-xs font-bold uppercase tracking-wide opacity-80">{label}</div>
    </div>
  );
}

export default function LiveOperationsWall({ companyId }: { companyId: string }) {
  const board = useRrPoll<BoardPayload>(
    () => rrFetchJson<BoardPayload>(`/api/road-recovery/board?companyId=${encodeURIComponent(companyId)}`),
    RR_POLL_INTERVALS.liveOperations,
    { enabled: Boolean(companyId) }
  );

  // Memoised so the derived lists below do not see a new array identity every render.
  const jobs = useMemo(() => board.data?.jobs || [], [board.data]);
  const active = useMemo(() => jobs.filter((job) => ACTIVE_STATES.has(job.service_state)), [jobs]);
  const awaiting = useMemo(() => jobs.filter((job) => AWAITING_STATES.has(job.service_state)), [jobs]);
  const onScene = useMemo(() => jobs.filter((job) => job.service_state === "on_scene"), [jobs]);
  const enRoute = useMemo(() => jobs.filter((job) => job.service_state === "en_route"), [jobs]);

  const driverByJob = useMemo(() => {
    const employees = new Map((board.data?.employees || []).map((row) => [row.id, row]));
    const map = new Map<string, string>();
    for (const assignment of board.data?.assignments || []) {
      const employee = employees.get(assignment.employee_id);
      map.set(
        assignment.service_job_id,
        employee ? `${employee.first_name} ${employee.last_name}`.trim() : "Unknown driver"
      );
    }
    return map;
  }, [board.data]);

  return (
    <div className="space-y-5">
      <header className="flex flex-col gap-3 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl font-black text-slate-900">Live Operations</h1>
          <p className="mt-1 text-sm text-slate-500">
            Refreshes every {RR_POLL_INTERVALS.liveOperations / 1000}s
            {board.paused ? " — paused while this tab is hidden" : ""}.
          </p>
        </div>
        <button
          onClick={board.refresh}
          disabled={board.loading}
          className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-bold text-cyan-300 disabled:opacity-50"
        >
          {board.loading ? "Refreshing…" : "Refresh"}
        </button>
      </header>

      {board.error ? (
        <p className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-800">
          {board.error}
        </p>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Active jobs" value={active.length} tone="border-cyan-200 bg-cyan-50 text-cyan-900" />
        <StatTile label="En route" value={enRoute.length} tone="border-blue-200 bg-blue-50 text-blue-900" />
        <StatTile label="On scene" value={onScene.length} tone="border-emerald-200 bg-emerald-50 text-emerald-900" />
        <StatTile label="Awaiting dispatch" value={awaiting.length} tone="border-amber-200 bg-amber-50 text-amber-900" />
      </div>

      <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-sm font-black uppercase tracking-wide text-slate-700">Active operations</h2>
        {board.initialLoading ? (
          <p className="mt-3 text-sm font-semibold text-slate-500">Loading…</p>
        ) : active.length === 0 ? (
          <p className="mt-3 text-sm font-semibold text-slate-400">No active recovery operations.</p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
                  <th className="py-2">Vehicle</th>
                  <th className="py-2">State</th>
                  <th className="py-2">Driver</th>
                  <th className="py-2">Scene</th>
                  <th className="py-2">Destination</th>
                  <th className="py-2">In state</th>
                </tr>
              </thead>
              <tbody>
                {active.map((job) => {
                  const minutes = minutesSince(job.state_entered_at);
                  return (
                    <tr key={job.id} className="border-b border-slate-100">
                      <td className="py-2 font-bold text-slate-900">
                        {job.vehicle_registration || "—"}
                      </td>
                      <td className="py-2">
                        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-bold text-slate-700">
                          {job.service_state.replace(/_/g, " ")}
                        </span>
                      </td>
                      <td className="py-2 text-slate-700">{driverByJob.get(job.id) || "—"}</td>
                      <td className="py-2 text-slate-600">
                        {job.origin_label || job.origin_address || "—"}
                      </td>
                      <td className="py-2 text-slate-600">{job.destination_label || "—"}</td>
                      <td className="py-2">
                        <span
                          className={`text-xs font-bold ${
                            minutes != null && minutes >= 60
                              ? "text-rose-700"
                              : minutes != null && minutes >= 30
                                ? "text-amber-700"
                                : "text-slate-500"
                          }`}
                        >
                          {minutes == null ? "—" : `${minutes}m`}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

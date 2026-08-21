"use client";

/**
 * BYSTAND Board (Phase 2).
 *
 * A DEDICATED board, deliberately not lanes bolted onto the Tow Dispatch Board. BYSTAND
 * is a different operation — it moves nothing, bills standing time, and pauses — so it
 * gets its own operational view. That separation is the point, not a styling choice.
 *
 * Standalone route under app/(app)/road-recovery/bystand. app/_app-shell.tsx untouched.
 */

import React, { useMemo, useState } from "react";
import StandbyTimer from "@/components/road-recovery/StandbyTimer";
import { formatStandbyDuration } from "@/lib/road-recovery/standby-timer";
import { RR_POLL_INTERVALS, rrFetchJson, useRrPoll } from "@/lib/road-recovery/use-rr-poll";
import BystandIntakePanel from "@/components/road-recovery/BystandIntakePanel";
import AuthorisationPanel from "@/components/road-recovery/AuthorisationPanel";

type StandbyBlock = {
  totalBillableSeconds: number;
  totalPausedSeconds: number;
  standingNow: boolean;
  intervalCount: number;
};

type Timings = {
  timeToSceneSeconds: number | null;
  standDownResponseSeconds: number | null;
  arrivedAt: string | null;
};

type BystandJob = {
  id: string;
  service_state: string;
  state_entered_at: string | null;
  origin_label: string | null;
  origin_address: string | null;
  vehicle_registration: string | null;
  vehicle_make: string | null;
  vehicle_model: string | null;
  scene_description: string | null;
  spawned_from_service_job_id: string | null;
  standby: StandbyBlock;
  timings: Timings;
  sealed: { total_billable_seconds: number; total_paused_seconds: number; sealed_at: string } | null;
  pausedStates: string[];
};

type BoardPayload = {
  fetchedAt: string;
  jobs: BystandJob[];
  details: {
    service_job_id: string;
    reason_code_id: string | null;
    reason_detail: string | null;
    authority_on_scene: string | null;
    converted_service_job_id: string | null;
  }[];
  assignments: { service_job_id: string; employee_id: string; field_vehicle_id: string | null; assignment_status: string }[];
  reasons: { id: string; reason_code: string; label: string }[];
  counterparties: { id: string; legal_name: string }[];
  employees: { id: string; first_name: string; last_name: string }[];
  vehicles: { id: string; registration: string }[];
};

/** Board lanes, in BYSTAND operational order. These are NOT tow lanes. */
const LANES: { key: string; label: string; states: string[] }[] = [
  { key: "new", label: "New", states: ["draft", "logged", "bystand_requested"] },
  { key: "authorisation", label: "Authorisation", states: ["authorisation_pending"] },
  { key: "dispatch", label: "Dispatch", states: ["authorised", "assigned", "accepted"] },
  { key: "en_route", label: "En route", states: ["en_route"] },
  { key: "arrived", label: "Arrived", states: ["arrived_on_scene"] },
  { key: "standing", label: "Standing by", states: ["standing_by"] },
  { key: "paused", label: "Paused", states: ["scene_handover_to_authority", "weather_hold"] },
  {
    key: "stand_down",
    label: "Stand-down requested",
    states: ["stand_down_requested", "converted_to_recovery"],
  },
  { key: "departed", label: "Departed", states: ["stood_down", "departed_scene", "report_submitted"] },
  {
    key: "closed",
    label: "Closed",
    states: ["evidence_complete", "invoice_ready", "invoiced", "closed", "cancelled"],
  },
];

function minutesSince(iso: string | null): number | null {
  if (!iso) return null;
  const ms = Date.now() - new Date(iso).getTime();
  return Number.isFinite(ms) ? Math.max(0, Math.round(ms / 60000)) : null;
}

/** Shape returned by the EXISTING dispatch candidate engine. Not re-scored here. */
type BystandCandidate = {
  employeeId: string;
  driverName: string;
  registration: string | null;
  eligible: boolean;
  eligibilityFailures: { code: string; detail: string }[];
  distanceKm: number | null;
  finalScore: number;
  recommended: boolean;
  recommendationReason: string | null;
};

export default function BystandBoard({ companyId }: { companyId: string }) {
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [intakeOpen, setIntakeOpen] = useState(false);
  const [authFor, setAuthFor] = useState<string | null>(null);
  const [convertFor, setConvertFor] = useState<string | null>(null);
  const [convertReason, setConvertReason] = useState("");
  const [dispatchFor, setDispatchFor] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<BystandCandidate[] | null>(null);

  const board = useRrPoll<BoardPayload>(
    () =>
      rrFetchJson<BoardPayload>(
        `/api/road-recovery/bystand/board?companyId=${encodeURIComponent(companyId)}`
      ),
    RR_POLL_INTERVALS.dispatchBoard,
    { enabled: Boolean(companyId) }
  );

  const jobsByLane = useMemo(() => {
    const map = new Map<string, BystandJob[]>();
    for (const lane of LANES) map.set(lane.key, []);
    for (const job of board.data?.jobs || []) {
      const lane = LANES.find((entry) => entry.states.includes(job.service_state));
      if (lane) map.get(lane.key)?.push(job);
    }
    return map;
  }, [board.data]);

  const detailByJob = useMemo(() => {
    const map = new Map<string, BoardPayload["details"][number]>();
    for (const row of board.data?.details || []) map.set(row.service_job_id, row);
    return map;
  }, [board.data]);

  const driverByJob = useMemo(() => {
    const employees = new Map((board.data?.employees || []).map((row) => [row.id, row]));
    const vehicles = new Map((board.data?.vehicles || []).map((row) => [row.id, row]));
    const map = new Map<string, { driver: string; vehicle: string | null }>();
    for (const assignment of board.data?.assignments || []) {
      const employee = employees.get(assignment.employee_id);
      map.set(assignment.service_job_id, {
        driver: employee ? `${employee.first_name} ${employee.last_name}`.trim() : "Unknown driver",
        vehicle: assignment.field_vehicle_id
          ? (vehicles.get(assignment.field_vehicle_id)?.registration ?? null)
          : null,
      });
    }
    return map;
  }, [board.data]);

  const reasonLabel = (id: string | null) =>
    id ? ((board.data?.reasons || []).find((entry) => entry.id === id)?.label ?? null) : null;

  async function act(url: string, body: Record<string, unknown>, message: string) {
    setBusy(true);
    setActionError(null);
    setNotice(null);
    try {
      await rrFetchJson(url, { method: "POST", body: JSON.stringify({ companyId, ...body }) });
      setNotice(message);
      board.refresh();
    } catch (error: unknown) {
      setActionError(error instanceof Error ? error.message : "Action failed.");
    } finally {
      setBusy(false);
    }
  }

  /**
   * BYSTAND dispatch uses the SAME engine as the tow board. It is exposed here because a
   * BYSTAND attendance goes `authorised -> assigned` and never enters `dispatch_pending`,
   * so the tow board's "Find drivers" control — which keys on dispatch_pending — could
   * never appear for one, and an attendance could not be given a driver at all.
   */
  async function findDrivers(serviceJobId: string) {
    setBusy(true);
    setActionError(null);
    setNotice(null);
    setDispatchFor(serviceJobId);
    setCandidates(null);
    try {
      const result = await rrFetchJson<{ candidates: BystandCandidate[] }>(
        "/api/road-recovery/dispatch/candidates",
        { method: "POST", body: JSON.stringify({ companyId, serviceJobId }) }
      );
      setCandidates(result.candidates || []);
    } catch (error: unknown) {
      setActionError(error instanceof Error ? error.message : "Could not evaluate drivers.");
    } finally {
      setBusy(false);
    }
  }

  const totals = useMemo(() => {
    const jobs = board.data?.jobs || [];
    return {
      standing: jobs.filter((job) => job.standby.standingNow).length,
      paused: jobs.filter((job) => job.pausedStates.includes(job.service_state)).length,
      billableNow: jobs
        .filter((job) => job.standby.standingNow)
        .reduce((sum, job) => sum + job.standby.totalBillableSeconds, 0),
    };
  }, [board.data]);

  return (
    <div className="space-y-5">
      <header className="flex flex-col gap-3 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl font-black text-slate-900">BYSTAND Board</h1>
          <p className="mt-1 text-sm text-slate-500">
            Attendance and standing time. Separate from tow dispatch. Refreshes every{" "}
            {RR_POLL_INTERVALS.dispatchBoard / 1000}s
            {board.paused ? " — paused while this tab is hidden" : ""}.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="text-right">
            <div className="text-xs font-bold uppercase tracking-wide text-slate-500">
              Standing now
            </div>
            <div className="font-mono text-xl font-black text-emerald-700">{totals.standing}</div>
          </div>
          <div className="text-right">
            <div className="text-xs font-bold uppercase tracking-wide text-slate-500">Paused</div>
            <div className="font-mono text-xl font-black text-amber-700">{totals.paused}</div>
          </div>
          <button
            onClick={() => {
              setIntakeOpen((open) => !open);
              setNotice(null);
            }}
            className="rounded-xl bg-cyan-700 px-4 py-2 text-sm font-bold text-white"
          >
            {intakeOpen ? "Close intake" : "Log attendance"}
          </button>
          <button
            onClick={board.refresh}
            disabled={board.loading}
            className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-bold text-cyan-300 disabled:opacity-50"
          >
            {board.loading ? "Refreshing…" : "Refresh"}
          </button>
        </div>
      </header>

      {intakeOpen ? (
        <BystandIntakePanel
          companyId={companyId}
          reasons={board.data?.reasons || []}
          onCreated={(result) => {
            setIntakeOpen(false);
            setNotice(`Attendance ${result.jobRef} logged.`);
            board.refresh();
          }}
          onClose={() => setIntakeOpen(false)}
        />
      ) : null}

      {board.error ? (
        <p className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-800">
          {board.error}
        </p>
      ) : null}
      {actionError ? (
        <p className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-800">
          {actionError}
        </p>
      ) : null}
      {notice ? (
        <p className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-800">
          {notice}
        </p>
      ) : null}

      {board.initialLoading ? (
        <p className="text-sm font-semibold text-slate-500">Loading BYSTAND board…</p>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {LANES.map((lane) => {
            const jobs = jobsByLane.get(lane.key) || [];
            return (
              <section
                key={lane.key}
                className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm"
              >
                <div className="flex items-center justify-between">
                  <h2 className="text-sm font-black uppercase tracking-wide text-slate-700">
                    {lane.label}
                  </h2>
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-bold text-slate-600">
                    {jobs.length}
                  </span>
                </div>

                <div className="mt-3 space-y-3">
                  {jobs.length === 0 ? (
                    <p className="text-xs font-semibold text-slate-400">Nothing here.</p>
                  ) : null}

                  {jobs.map((job) => {
                    const detail = detailByJob.get(job.id);
                    const crew = driverByJob.get(job.id);
                    const isPaused = job.pausedStates.includes(job.service_state);
                    // A converted attendance still has to be stood down and closed on its
                    // own terms — the workflow declares request_stand_down_after_conversion
                    // for exactly that. Without this the job strands in
                    // converted_to_recovery with no control, and its standing time can
                    // never reach invoice-ready.
                    const awaitingStandDown =
                      job.standby.standingNow || isPaused || job.service_state === "converted_to_recovery";
                    const sinceArrival = minutesSince(job.timings.arrivedAt);

                    return (
                      <article
                        key={job.id}
                        className={`rounded-2xl border p-3 ${
                          job.standby.standingNow
                            ? "border-emerald-200 bg-emerald-50/40"
                            : isPaused
                              ? "border-amber-200 bg-amber-50/40"
                              : "border-slate-200 bg-slate-50"
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="font-bold text-slate-900">
                            {job.vehicle_registration || "Attendance"}
                          </div>
                          <span className="rounded-full bg-white px-2 py-0.5 text-[10px] font-bold uppercase text-slate-600">
                            {job.service_state.replace(/_/g, " ")}
                          </span>
                        </div>

                        {reasonLabel(detail?.reason_code_id ?? null) ? (
                          <p className="mt-1 text-[11px] font-bold text-cyan-800">
                            {reasonLabel(detail?.reason_code_id ?? null)}
                          </p>
                        ) : null}

                        <p className="mt-1 text-xs text-slate-500">
                          {job.origin_label || job.origin_address || "Scene not specified"}
                        </p>

                        {crew ? (
                          <p className="mt-1 text-[11px] font-bold text-slate-700">
                            {crew.driver}
                            {crew.vehicle ? ` · ${crew.vehicle}` : ""}
                          </p>
                        ) : null}

                        <div className="mt-2">
                          <StandbyTimer
                            snapshot={job.standby}
                            fetchedAt={board.data?.fetchedAt ?? null}
                            compact
                          />
                        </div>

                        <div className="mt-1.5 flex flex-wrap gap-x-3 text-[10px] font-semibold text-slate-500">
                          {sinceArrival != null ? <span>On scene {sinceArrival}m</span> : null}
                          {job.timings.timeToSceneSeconds != null ? (
                            <span>To scene {formatStandbyDuration(job.timings.timeToSceneSeconds)}</span>
                          ) : null}
                          {job.timings.standDownResponseSeconds != null ? (
                            <span>
                              Stand-down {formatStandbyDuration(job.timings.standDownResponseSeconds)}
                            </span>
                          ) : null}
                        </div>

                        {detail?.converted_service_job_id ? (
                          <p className="mt-2 rounded-lg bg-cyan-50 px-2 py-1 text-[10px] font-bold text-cyan-900">
                            Converted → a separate recovery job was raised. This attendance
                            still bills its own standing time.
                          </p>
                        ) : null}

                        <div className="mt-3 flex flex-wrap gap-2">
                          {job.service_state === "logged" ? (
                            <button
                              onClick={() =>
                                act(
                                  `/api/road-recovery/jobs/${job.id}/transition`,
                                  { toState: "bystand_requested" },
                                  "Attendance requested."
                                )
                              }
                              disabled={busy}
                              className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-bold text-cyan-300 disabled:opacity-50"
                            >
                              Request attendance
                            </button>
                          ) : null}

                          {job.service_state === "bystand_requested" ? (
                            <button
                              onClick={() =>
                                act(
                                  `/api/road-recovery/jobs/${job.id}/transition`,
                                  { toState: "authorisation_pending" },
                                  "Authorisation requested."
                                )
                              }
                              disabled={busy}
                              className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-bold text-cyan-300 disabled:opacity-50"
                            >
                              Request authorisation
                            </button>
                          ) : null}

                          {job.service_state === "authorisation_pending" ? (
                            <button
                              onClick={() =>
                                act(
                                  `/api/road-recovery/jobs/${job.id}/transition`,
                                  { toState: "authorised" },
                                  "Authorised."
                                )
                              }
                              disabled={busy}
                              className="rounded-lg bg-emerald-700 px-3 py-1.5 text-xs font-bold text-white disabled:opacity-50"
                            >
                              Mark authorised
                            </button>
                          ) : null}

                          {awaitingStandDown ? (
                            <button
                              onClick={() =>
                                act(
                                  `/api/road-recovery/bystand/${job.id}/stand-down`,
                                  { action: "request", requestedBy: "Controller", channel: "system" },
                                  "Stand-down requested."
                                )
                              }
                              disabled={busy}
                              className="rounded-lg bg-amber-700 px-3 py-1.5 text-xs font-bold text-white disabled:opacity-50"
                            >
                              Request stand-down
                            </button>
                          ) : null}

                          {job.service_state === "stand_down_requested" ? (
                            <button
                              onClick={() =>
                                act(
                                  `/api/road-recovery/bystand/${job.id}/stand-down`,
                                  { action: "confirm" },
                                  "Stood down. Standing time sealed."
                                )
                              }
                              disabled={busy}
                              className="rounded-lg bg-emerald-700 px-3 py-1.5 text-xs font-bold text-white disabled:opacity-50"
                            >
                              Confirm stand-down
                            </button>
                          ) : null}

                          {/* An attendance goes authorised -> assigned. It never enters
                              dispatch_pending, so the tow board's "Find drivers" control
                              — which keys on dispatch_pending — could never appear for
                              one, and an attendance had no way to reach a driver. Same
                              engine, exposed where BYSTAND actually needs it. */}
                          {job.service_state === "authorised" ? (
                            <button
                              onClick={() => findDrivers(job.id)}
                              disabled={busy}
                              className="rounded-lg bg-cyan-700 px-3 py-1.5 text-xs font-bold text-white disabled:opacity-50"
                            >
                              Find drivers
                            </button>
                          ) : null}

                          {/* Conversion raises a SEPARATE recovery job. The attendance
                              keeps its own standing time and closes on its own terms. */}
                          {job.service_state === "standing_by" ? (
                            <button
                              onClick={() => {
                                setConvertReason("");
                                setConvertFor(convertFor === job.id ? null : job.id);
                              }}
                              disabled={busy}
                              className="rounded-lg bg-indigo-700 px-3 py-1.5 text-xs font-bold text-white disabled:opacity-50"
                            >
                              Convert to recovery
                            </button>
                          ) : null}

                          <button
                            onClick={() => setAuthFor(authFor === job.id ? null : job.id)}
                            className="rounded-lg bg-slate-100 px-3 py-1.5 text-xs font-bold text-slate-700"
                          >
                            {authFor === job.id ? "Hide authorisation" : "Authorisation"}
                          </button>

                          <button
                            onClick={() => setSelected(selected === job.id ? null : job.id)}
                            className="rounded-lg bg-slate-200 px-3 py-1.5 text-xs font-bold text-slate-700"
                          >
                            {selected === job.id ? "Hide" : "Detail"}
                          </button>
                        </div>

                        {convertFor === job.id ? (
                          <div className="mt-2 space-y-2 rounded-xl border border-indigo-300 bg-indigo-50 p-3">
                            <label className="text-[11px] font-black text-indigo-900">
                              Why does this scene now need a recovery?
                            </label>
                            <input
                              aria-label="Conversion reason"
                              value={convertReason}
                              onChange={(event) => setConvertReason(event.target.value)}
                              placeholder="Vehicle cannot be driven; recovery required."
                              className="w-full rounded-lg border border-indigo-300 px-3 py-2 text-xs"
                            />
                            <div className="flex gap-2">
                              <button
                                disabled={busy || !convertReason.trim()}
                                onClick={async () => {
                                  const reason = convertReason.trim();
                                  setConvertFor(null);
                                  setConvertReason("");
                                  await act(
                                    `/api/road-recovery/bystand/${job.id}/convert`,
                                    { reason },
                                    "Converted. A separate recovery job has been raised; this attendance still bills its own standing time."
                                  );
                                }}
                                className="rounded-lg bg-indigo-700 px-3 py-1.5 text-xs font-bold text-white disabled:opacity-40"
                              >
                                Convert
                              </button>
                              <button
                                onClick={() => setConvertFor(null)}
                                className="rounded-lg bg-white px-3 py-1.5 text-xs font-bold text-slate-700"
                              >
                                Cancel
                              </button>
                            </div>
                          </div>
                        ) : null}

                        {dispatchFor === job.id ? (
                          <div className="mt-2 rounded-xl border border-cyan-300 bg-cyan-50 p-3">
                            <div className="flex items-center justify-between">
                              <span className="text-[11px] font-black uppercase tracking-wide text-cyan-900">
                                Dispatch candidates
                              </span>
                              <button
                                onClick={() => {
                                  setDispatchFor(null);
                                  setCandidates(null);
                                }}
                                className="text-[11px] font-bold text-slate-500"
                              >
                                Close
                              </button>
                            </div>
                            {candidates === null ? (
                              <p className="mt-2 text-xs font-semibold text-slate-500">Evaluating…</p>
                            ) : candidates.length === 0 ? (
                              <p className="mt-2 text-xs font-semibold text-slate-500">
                                No drivers were returned for this attendance.
                              </p>
                            ) : (
                              <ul className="mt-2 space-y-2">
                                {candidates.map((candidate) => (
                                  <li key={candidate.employeeId} className="rounded-lg bg-white p-2">
                                    <div className="flex flex-wrap items-center justify-between gap-2">
                                      <div>
                                        <p className="text-xs font-black text-slate-900">
                                          {candidate.driverName}
                                          {candidate.registration ? ` · ${candidate.registration}` : ""}
                                        </p>
                                        <p className="text-[11px] font-semibold text-slate-600">
                                          {candidate.eligible
                                            ? candidate.recommendationReason ||
                                              `score ${candidate.finalScore.toFixed(1)}`
                                            : candidate.eligibilityFailures
                                                .map((failure) => failure.detail)
                                                .join(" ")}
                                        </p>
                                      </div>
                                      {candidate.eligible ? (
                                        <button
                                          disabled={busy}
                                          onClick={async () => {
                                            setDispatchFor(null);
                                            setCandidates(null);
                                            await act(
                                              "/api/road-recovery/dispatch/assign",
                                              { serviceJobId: job.id, employeeId: candidate.employeeId },
                                              "Dispatched. Awaiting driver acceptance."
                                            );
                                          }}
                                          className="rounded-lg bg-slate-900 px-3 py-1.5 text-[11px] font-bold text-cyan-300 disabled:opacity-40"
                                        >
                                          Dispatch
                                        </button>
                                      ) : (
                                        <span className="rounded-full bg-slate-200 px-2 py-0.5 text-[10px] font-black uppercase text-slate-600">
                                          Ineligible
                                        </span>
                                      )}
                                    </div>
                                  </li>
                                ))}
                              </ul>
                            )}
                          </div>
                        ) : null}

                        {authFor === job.id ? (
                          <AuthorisationPanel
                            companyId={companyId}
                            serviceJobId={job.id}
                            serviceCode="bystand"
                            counterpartyId={null}
                            counterparties={board.data?.counterparties || []}
                            onChanged={board.refresh}
                            onClose={() => setAuthFor(null)}
                          />
                        ) : null}

                        {selected === job.id ? (
                          <div className="mt-3 space-y-2 rounded-xl border border-slate-200 bg-white p-3">
                            <StandbyTimer
                              snapshot={job.standby}
                              fetchedAt={board.data?.fetchedAt ?? null}
                              sealed={job.sealed}
                            />
                            {job.scene_description ? (
                              <p className="text-xs text-slate-600">{job.scene_description}</p>
                            ) : null}
                            {detail?.reason_detail ? (
                              <p className="text-xs text-slate-600">
                                <strong>Reason detail:</strong> {detail.reason_detail}
                              </p>
                            ) : null}
                            {detail?.authority_on_scene ? (
                              <p className="text-xs text-slate-600">
                                <strong>Authority on scene:</strong> {detail.authority_on_scene}
                              </p>
                            ) : null}
                          </div>
                        ) : null}
                      </article>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}

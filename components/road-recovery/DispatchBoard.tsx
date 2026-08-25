"use client";

/**
 * Road & Recovery Dispatch Board (Phase 1).
 *
 * A standalone screen under app/(app)/road-recovery/dispatch. It is deliberately NOT
 * registered in app/_app-shell.tsx: that file is a 19,000-line client component that
 * loads every domain on mount, and this vertical has no reason to grow it.
 *
 * Lanes follow the Phase 0 workflow states, so the board is a view of the state machine
 * rather than a second source of truth about job progress.
 */

import React, { useMemo, useState } from "react";
import {
  RR_POLL_INTERVALS,
  rrFetchJson,
  useRrPoll,
} from "@/lib/road-recovery/use-rr-poll";
import { availableTransitions, stateForRole } from "@/lib/road-recovery/state-machine";
import { RRLaneEmpty, RRLoading } from "@/components/road-recovery/ui";
import JobIntakePanel from "@/components/road-recovery/JobIntakePanel";
import AuthorisationPanel from "@/components/road-recovery/AuthorisationPanel";

type JobRow = {
  id: string;
  workflow_key: string;
  /** Needed to resolve the RIGHT graph: BYSTAND ships v1 and v2 side by side. */
  workflow_version: number | null;
  service_state: string;
  state_entered_at: string | null;
  service_type_id: string | null;
  counterparty_id: string | null;
  origin_label: string | null;
  origin_address: string | null;
  destination_label: string | null;
  vehicle_registration: string | null;
  vehicle_make: string | null;
  vehicle_model: string | null;
  /** The three facts that change which truck and which crew get sent. */
  vehicle_is_drivable: boolean | null;
  casualty_flag: boolean | null;
  hazmat_flag: boolean | null;
  created_at: string;
};

type AssignmentRow = {
  id: string;
  service_job_id: string;
  employee_id: string;
  assignment_status: string;
  offered_at: string | null;
};

type AuthorisationRow = {
  id: string;
  service_job_id: string;
  authorisation_number: string;
  claim_reference: string | null;
  expires_at: string | null;
};

type BoardPayload = {
  fetchedAt: string;
  jobs: JobRow[];
  assignments: AssignmentRow[];
  authorisations: AuthorisationRow[];
  serviceTypes: { id: string; service_code: string; name: string }[];
  counterparties: { id: string; legal_name: string }[];
  employees: { id: string; first_name: string; last_name: string }[];
};

type CandidateResponse = {
  recommended: EvaluatedCandidate | null;
  eligible: EvaluatedCandidate[];
  candidates: EvaluatedCandidate[];
  noCandidateReason: string | null;
  engineVersion: string;
};

type EvaluatedCandidate = {
  employeeId: string;
  driverName: string;
  registration: string | null;
  eligible: boolean;
  eligibilityFailures: { code: string; detail: string }[];
  distanceKm: number | null;
  finalScore: number;
  rank: number | null;
  recommended: boolean;
  recommendationReason: string | null;
  scoreComponents: Record<string, number>;
  certificationResult: { passed: boolean };
  capabilityResult: { passed: boolean };
};

/** Board lanes, in controller workflow order. */
/**
 * `empty` is the operational sentence shown when a lane has no jobs. It names what WOULD
 * sit here and what moves a job in, so a quiet board reads as quiet rather than unbuilt.
 */
const LANES: { key: string; label: string; states: string[]; empty: string }[] = [
  { key: "new", label: "New", states: ["draft", "logged"], empty: "No callouts logged. New jobs land here the moment they are captured." },
  { key: "authorisation", label: "Awaiting authorisation", states: ["authorisation_pending"], empty: "Nothing awaiting authority. Jobs needing an authorising party queue here." },
  { key: "ready", label: "Ready for dispatch", states: ["authorised", "dispatch_pending"], empty: "No authorised jobs waiting. Once authority is captured, jobs land here to assign." },
  { key: "assigned", label: "Assigned", states: ["assigned"], empty: "No crews assigned. Assigned jobs sit here until the driver accepts." },
  { key: "accepted", label: "Accepted", states: ["accepted"], empty: "Nothing accepted yet. Driver acceptance moves a job into this lane." },
  { key: "en_route", label: "En route", states: ["en_route"], empty: "No crews travelling. Jobs appear here when a driver departs for the scene." },
  { key: "on_scene", label: "Arrived", states: ["on_scene"], empty: "Nobody on scene. Arrival at the incident moves a job here." },
  {
    key: "active",
    label: "Recovery / tow",
    empty: "No recovery in progress. Loading, transit and handover states show here.",
    states: [
      "assessing",
      "loading",
      "secured",
      "departing_scene",
      "in_transit",
      "arrived_destination",
      "offloading",
      "handover_pending",
      "handed_over",
      "paperwork_complete",
    ],
  },
  {
    key: "completed",
    label: "Completed",
    empty: "Nothing completed in this window. Closed jobs and their billing packs land here.",
    states: ["evidence_complete", "invoice_ready", "invoiced", "closed"],
  },
];

function minutesSince(iso: string | null): number | null {
  if (!iso) return null;
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms)) return null;
  return Math.max(0, Math.round(ms / 60000));
}

/**
 * Time-in-state, which is the only SLA signal the Phase 0 data model actually supports.
 * Real SLA policies and clocks are a later phase, so nothing here claims to be one.
 */
function DwellBadge({ enteredAt }: { enteredAt: string | null }) {
  const minutes = minutesSince(enteredAt);
  if (minutes == null) return null;
  const tone =
    minutes >= 60
      ? "bg-rose-100 text-rose-800"
      : minutes >= 30
        ? "bg-amber-100 text-amber-800"
        : "bg-slate-100 text-slate-600";
  return (
    <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${tone}`}>
      {minutes < 60 ? `${minutes}m in state` : `${Math.floor(minutes / 60)}h ${minutes % 60}m in state`}
    </span>
  );
}

/** Intake steps that already have their own labelled button on the card. */
const DEDICATED_TRANSITION_TARGETS = ["authorisation_pending", "authorised", "dispatch_pending"] as const;

/**
 * The transitions a CONTROLLER may drive from this state.
 *
 * Derived from the workflow definition, never from a list kept here, so a transition
 * added to any workflow appears without touching this file and an illegal one can never
 * be offered. Two kinds are filtered out:
 *
 *   - states that fill a DRIVER role (offer / accept / travel / arrival). Those move
 *     through the dispatch and driver endpoints, which also write the crew record, the
 *     truck's availability and the GPS validation. Driving them as a bare transition
 *     would skip all three.
 *   - the intake steps that already have a dedicated, labelled button on the card.
 */
function controllerTransitions(job: JobRow, dedicated: readonly string[]) {
  const version = job.workflow_version;
  const driverStates = new Set(
    (["offer", "accept", "travel", "arrival"] as const)
      .map((role) => stateForRole(job.workflow_key, role, version))
      .filter((value): value is string => Boolean(value))
  );
  return availableTransitions(job.workflow_key, job.service_state, version).filter(
    (transition) => !driverStates.has(transition.to) && !dedicated.includes(transition.to)
  );
}

/** "release_to_dispatch" -> "Release to dispatch". */
function humanise(code: string): string {
  const words = code.replace(/_/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export default function DispatchBoard({ companyId }: { companyId: string }) {
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<CandidateResponse | null>(null);
  const [candidateError, setCandidateError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [intakeOpen, setIntakeOpen] = useState(false);
  const [authFor, setAuthFor] = useState<string | null>(null);
  const [reasonFor, setReasonFor] = useState<{ jobId: string; toState: string; code: string } | null>(null);
  const [reasonText, setReasonText] = useState("");

  const board = useRrPoll<BoardPayload>(
    () => rrFetchJson<BoardPayload>(`/api/road-recovery/board?companyId=${encodeURIComponent(companyId)}`),
    RR_POLL_INTERVALS.dispatchBoard,
    { enabled: Boolean(companyId) }
  );

  const jobsByLane = useMemo(() => {
    const map = new Map<string, JobRow[]>();
    for (const lane of LANES) map.set(lane.key, []);
    for (const job of board.data?.jobs || []) {
      // BYSTAND has its own board precisely because it is not a tow: it moves nothing,
      // bills standing time and pauses. /api/road-recovery/board returns every job, so
      // without this filter a bystand attendance landed in these lanes carrying tow
      // controls — and "Request authorisation" on a bystand card is not a transition its
      // workflow has, so the button could only ever fail.
      if (job.workflow_key === "bystand") continue;
      const lane = LANES.find((entry) => entry.states.includes(job.service_state));
      if (!lane) continue;
      map.get(lane.key)?.push(job);
    }
    return map;
  }, [board.data]);

  const authorisationByJob = useMemo(() => {
    const map = new Map<string, AuthorisationRow>();
    for (const row of board.data?.authorisations || []) map.set(row.service_job_id, row);
    return map;
  }, [board.data]);

  const assignmentByJob = useMemo(() => {
    const map = new Map<string, AssignmentRow>();
    for (const row of board.data?.assignments || []) map.set(row.service_job_id, row);
    return map;
  }, [board.data]);

  /** The job's service code, for the authorisation record. */
  const serviceCodeFor = (job: JobRow) =>
    (board.data?.serviceTypes || []).find((entry) => entry.id === job.service_type_id)?.service_code || "";

  const employeeName = (id: string) => {
    const row = (board.data?.employees || []).find((entry) => entry.id === id);
    return row ? `${row.first_name} ${row.last_name}`.trim() : "Unknown driver";
  };

  async function evaluateCandidates(jobId: string) {
    setSelectedJobId(jobId);
    setCandidates(null);
    setCandidateError(null);
    setNotice(null);
    setBusy(true);
    try {
      const result = await rrFetchJson<CandidateResponse>("/api/road-recovery/dispatch/candidates", {
        method: "POST",
        body: JSON.stringify({ companyId, serviceJobId: jobId }),
      });
      setCandidates(result);
    } catch (error: unknown) {
      setCandidateError(error instanceof Error ? error.message : "Evaluation failed.");
    } finally {
      setBusy(false);
    }
  }

  async function dispatchTo(jobId: string, employeeId: string) {
    setBusy(true);
    setNotice(null);
    try {
      await rrFetchJson("/api/road-recovery/dispatch/assign", {
        method: "POST",
        body: JSON.stringify({ companyId, serviceJobId: jobId, employeeId }),
      });
      setNotice("Dispatched. Awaiting driver acceptance.");
      setCandidates(null);
      setSelectedJobId(null);
      board.refresh();
    } catch (error: unknown) {
      setCandidateError(error instanceof Error ? error.message : "Dispatch failed.");
    } finally {
      setBusy(false);
    }
  }

  async function transition(jobId: string, toState: string, reason?: string) {
    setBusy(true);
    setNotice(null);
    try {
      await rrFetchJson(`/api/road-recovery/jobs/${jobId}/transition`, {
        method: "POST",
        body: JSON.stringify({ companyId, toState, reason }),
      });
      board.refresh();
    } catch (error: unknown) {
      setCandidateError(error instanceof Error ? error.message : "Transition failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      {/*
        Toolbar, not a second page title. RoadRecoveryShell already renders the hero with
        this board's name and purpose; repeating "Dispatch Board" here pushed the lanes
        below the fold and made the vertical look like a separate application.
      */}
      <div className="flex flex-col gap-3 rounded-[28px] border border-slate-200 bg-white px-5 py-4 shadow-[0_14px_40px_rgba(15,23,42,0.08)] md:flex-row md:items-center md:justify-between">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="inline-flex items-center gap-2 text-xs font-black uppercase tracking-[0.18em] text-slate-600">
            <span
              className={`h-2 w-2 rounded-full ${board.paused ? "bg-slate-400" : "bg-emerald-500"}`}
              aria-hidden="true"
            />
            {board.paused ? "Paused" : "Live"}
          </span>
          <span className="text-xs text-slate-500">
            {board.paused
              ? "Polling resumes when this tab is visible"
              : `Refreshing every ${RR_POLL_INTERVALS.dispatchBoard / 1000}s`}
          </span>
          {board.lastUpdatedAt ? (
            <span className="text-xs tabular-nums text-slate-400">
              · updated {new Date(board.lastUpdatedAt).toLocaleTimeString()}
            </span>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => {
              setIntakeOpen((open) => !open);
              setNotice(null);
            }}
            className="vyron-focus-ring rounded-xl bg-gradient-to-r from-blue-600 to-cyan-500 px-4 py-2 text-sm font-black text-white shadow-lg shadow-cyan-500/20 transition hover:brightness-110"
          >
            {intakeOpen ? "Close intake" : "Log a job"}
          </button>
          <button
            onClick={board.refresh}
            disabled={board.loading}
            className="vyron-focus-ring rounded-xl bg-slate-900 px-4 py-2 text-sm font-black text-cyan-300 transition hover:bg-slate-800 disabled:opacity-50"
          >
            {board.loading ? "Refreshing…" : "Refresh"}
          </button>
        </div>
      </div>

      {intakeOpen ? (
        <JobIntakePanel
          companyId={companyId}
          serviceTypes={board.data?.serviceTypes || []}
          counterparties={board.data?.counterparties || []}
          onCreated={(result) => {
            setIntakeOpen(false);
            setNotice(
              `Job ${result.jobRef} created. ${result.requirementCount} requirement(s) snapshotted against it.`
            );
            board.refresh();
          }}
          onClose={() => setIntakeOpen(false)}
        />
      ) : null}

      {board.error ? (
        <p role="alert" className="rounded-[22px] border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-900">
          {board.error}
        </p>
      ) : null}
      {notice ? (
        <p role="status" className="rounded-[22px] border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-900">
          {notice}
        </p>
      ) : null}

      {board.initialLoading ? (
        <RRLoading label="Loading dispatch board" />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
          {LANES.map((lane) => {
            const jobs = jobsByLane.get(lane.key) || [];
            return (
              <section
                key={lane.key}
                className="flex min-w-0 flex-col rounded-[28px] border border-slate-200 bg-white p-4 shadow-[0_14px_40px_rgba(15,23,42,0.08)]"
              >
                <div className="flex items-center justify-between">
                  <h2 className="truncate text-xs font-black uppercase tracking-[0.2em] text-slate-600">
                    {lane.label}
                  </h2>
                  <span
                    className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-black tabular-nums ${
                      jobs.length ? "bg-slate-900 text-cyan-300" : "bg-slate-100 text-slate-500"
                    }`}
                  >
                    {jobs.length}
                  </span>
                </div>

                <div className="mt-3 space-y-3">
                  {jobs.length === 0 ? (
                    <RRLaneEmpty>{lane.empty}</RRLaneEmpty>
                  ) : null}

                  {jobs.map((job) => {
                    const authorisation = authorisationByJob.get(job.id);
                    const assignment = assignmentByJob.get(job.id);
                    return (
                      <article
                        key={job.id}
                        className="rounded-2xl border border-slate-200 bg-slate-50 p-3"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="font-bold text-slate-900">
                            {job.vehicle_registration || "Unknown vehicle"}
                          </div>
                          <DwellBadge enteredAt={job.state_entered_at} />
                        </div>

                        {/*
                          Safety, above everything except the vehicle itself.

                          A controller chooses the truck and the crew from this card.
                          Casualty, hazmat and an undrivable vehicle each change that
                          choice, so they cannot sit further down where a busy board
                          scrolls them out of view.
                        */}
                        {(job.casualty_flag || job.hazmat_flag || job.vehicle_is_drivable === false) && (
                          <div className="mt-2 flex flex-wrap gap-1" data-testid="rr-board-safety">
                            {job.casualty_flag && (
                              <span className="rounded-full bg-rose-600 px-2 py-0.5 text-[10px] font-black uppercase tracking-wide text-white">
                                Casualty
                              </span>
                            )}
                            {job.hazmat_flag && (
                              <span className="rounded-full bg-amber-500 px-2 py-0.5 text-[10px] font-black uppercase tracking-wide text-white">
                                Hazmat
                              </span>
                            )}
                            {job.vehicle_is_drivable === false && (
                              <span className="rounded-full bg-slate-800 px-2 py-0.5 text-[10px] font-black uppercase tracking-wide text-white">
                                Not drivable
                              </span>
                            )}
                          </div>
                        )}
                        <p className="mt-1 text-xs text-slate-600">
                          {[job.vehicle_make, job.vehicle_model].filter(Boolean).join(" ") || "—"}
                        </p>
                        <p className="mt-1 text-xs text-slate-500">
                          {job.origin_label || job.origin_address || "Scene not specified"}
                          {job.destination_label ? ` → ${job.destination_label}` : ""}
                        </p>

                        {authorisation ? (
                          <p className="mt-2 text-[11px] font-bold text-emerald-700">
                            Auth {authorisation.authorisation_number}
                            {authorisation.claim_reference ? ` · Claim ${authorisation.claim_reference}` : ""}
                          </p>
                        ) : null}

                        {assignment ? (
                          <p className="mt-2 text-[11px] font-bold text-cyan-800">
                            {employeeName(assignment.employee_id)} · {assignment.assignment_status}
                          </p>
                        ) : null}

                        <div className="mt-3 flex flex-wrap gap-2">
                          {job.service_state === "logged" ? (
                            <button
                              onClick={() => transition(job.id, "authorisation_pending")}
                              disabled={busy}
                              className="vyron-focus-ring rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-black text-cyan-300 transition hover:bg-slate-800 disabled:opacity-50"
                            >
                              Request authorisation
                            </button>
                          ) : null}

                          {job.service_state === "authorisation_pending" ? (
                            <button
                              onClick={() => transition(job.id, "authorised")}
                              disabled={busy}
                              className="rounded-lg bg-emerald-700 px-3 py-1.5 text-xs font-bold text-white disabled:opacity-50"
                            >
                              Mark authorised
                            </button>
                          ) : null}

                          {job.service_state === "authorised" ? (
                            <button
                              onClick={() => transition(job.id, "dispatch_pending")}
                              disabled={busy}
                              className="vyron-focus-ring rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-black text-cyan-300 transition hover:bg-slate-800 disabled:opacity-50"
                            >
                              Release to dispatch
                            </button>
                          ) : null}

                          {job.service_state === "dispatch_pending" ? (
                            <button
                              onClick={() => evaluateCandidates(job.id)}
                              disabled={busy}
                              className="vyron-focus-ring rounded-lg bg-cyan-700 px-3 py-1.5 text-xs font-black text-white transition hover:bg-cyan-600 disabled:opacity-50"
                            >
                              Find drivers
                            </button>
                          ) : null}

                          {/* Every remaining transition this workflow allows from this
                              state. Reason-carrying ones (unassign / reassign, decline,
                              cancel) prompt before they are sent, because the server
                              rejects them without one. */}
                          {controllerTransitions(job, DEDICATED_TRANSITION_TARGETS).map((step) => (
                            <button
                              key={step.code}
                              onClick={() => {
                                setCandidateError(null);
                                if (step.requiresReason) {
                                  setReasonText("");
                                  setReasonFor({ jobId: job.id, toState: step.to, code: step.code });
                                } else {
                                  void transition(job.id, step.to);
                                }
                              }}
                              disabled={busy}
                              className="rounded-lg bg-white px-3 py-1.5 text-xs font-bold text-slate-800 ring-1 ring-slate-300 disabled:opacity-50"
                            >
                              {humanise(step.code)}
                            </button>
                          ))}

                          <button
                            onClick={() => {
                              setCandidateError(null);
                              setAuthFor(authFor === job.id ? null : job.id);
                            }}
                            className="rounded-lg bg-slate-100 px-3 py-1.5 text-xs font-bold text-slate-700"
                          >
                            {authFor === job.id ? "Hide authorisation" : "Authorisation"}
                          </button>
                        </div>

                        {reasonFor?.jobId === job.id ? (
                          <div className="mt-2 space-y-2 rounded-xl border border-amber-300 bg-amber-50 p-3">
                            <label className="text-[11px] font-black text-amber-900">
                              {humanise(reasonFor.code)} — why?
                            </label>
                            <input
                              aria-label="Reason"
                              value={reasonText}
                              onChange={(event) => setReasonText(event.target.value)}
                              placeholder="Recorded against the job permanently."
                              className="w-full rounded-lg border border-amber-300 px-3 py-2 text-xs"
                            />
                            <div className="flex gap-2">
                              <button
                                disabled={busy || !reasonText.trim()}
                                onClick={async () => {
                                  const pending = reasonFor;
                                  setReasonFor(null);
                                  await transition(pending.jobId, pending.toState, reasonText.trim());
                                  setReasonText("");
                                }}
                                className="rounded-lg bg-amber-700 px-3 py-1.5 text-xs font-bold text-white disabled:opacity-40"
                              >
                                Confirm
                              </button>
                              <button
                                onClick={() => setReasonFor(null)}
                                className="rounded-lg bg-white px-3 py-1.5 text-xs font-bold text-slate-700"
                              >
                                Cancel
                              </button>
                            </div>
                          </div>
                        ) : null}

                        {authFor === job.id ? (
                          <AuthorisationPanel
                            companyId={companyId}
                            serviceJobId={job.id}
                            serviceCode={serviceCodeFor(job)}
                            counterpartyId={job.counterparty_id}
                            counterparties={board.data?.counterparties || []}
                            onChanged={board.refresh}
                            onClose={() => setAuthFor(null)}
                          />
                        ) : null}

                        {selectedJobId === job.id ? (
                          <CandidatePanel
                            candidates={candidates}
                            error={candidateError}
                            busy={busy}
                            onDispatch={(employeeId) => dispatchTo(job.id, employeeId)}
                            onClose={() => {
                              setSelectedJobId(null);
                              setCandidates(null);
                              setCandidateError(null);
                            }}
                          />
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

/**
 * The explainability surface.
 *
 * Every candidate is shown — eligible or not — with its reasons, because a controller
 * overriding the recommendation needs to see WHY the engine ranked things as it did, and
 * an excluded driver needs a visible cause rather than silent absence.
 */
function CandidatePanel({
  candidates,
  error,
  busy,
  onDispatch,
  onClose,
}: {
  candidates: CandidateResponse | null;
  error: string | null;
  busy: boolean;
  onDispatch: (employeeId: string) => void;
  onClose: () => void;
}) {
  return (
    <div className="mt-3 rounded-2xl border border-cyan-200 bg-white p-3">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-black uppercase tracking-wide text-cyan-900">
          Dispatch candidates
        </h3>
        <button onClick={onClose} className="text-xs font-bold text-slate-500">
          Close
        </button>
      </div>

      {error ? <p className="mt-2 text-xs font-semibold text-rose-700">{error}</p> : null}
      {!candidates && !error ? (
        <p className="mt-2 text-xs font-semibold text-slate-500">Evaluating…</p>
      ) : null}

      {candidates?.recommended ? (
        <div className="mt-2 rounded-xl bg-emerald-50 p-2">
          <p className="text-xs font-black text-emerald-900">
            Recommended: {candidates.recommended.driverName}
          </p>
          <p className="mt-0.5 text-[11px] text-emerald-800">
            Why: {candidates.recommended.recommendationReason}
          </p>
        </div>
      ) : null}

      {candidates?.noCandidateReason ? (
        <p className="mt-2 rounded-xl bg-amber-50 p-2 text-[11px] font-semibold text-amber-900">
          {candidates.noCandidateReason}
        </p>
      ) : null}

      <ul className="mt-2 space-y-2">
        {(candidates?.candidates || []).map((candidate) => (
          <li
            key={candidate.employeeId}
            className={`rounded-xl border p-2 ${
              candidate.eligible ? "border-slate-200 bg-white" : "border-slate-200 bg-slate-50"
            }`}
          >
            <div className="flex items-center justify-between gap-2">
              <div>
                <p className="text-xs font-bold text-slate-900">
                  {candidate.rank ? `#${candidate.rank} ` : ""}
                  {candidate.driverName}
                  {candidate.registration ? ` · ${candidate.registration}` : ""}
                </p>
                <p className="text-[11px] text-slate-500">
                  {candidate.distanceKm != null
                    ? `${candidate.distanceKm.toFixed(1)} km`
                    : "distance unknown"}
                  {candidate.eligible ? ` · score ${candidate.finalScore.toFixed(1)}` : ""}
                </p>
              </div>
              {candidate.eligible ? (
                <button
                  onClick={() => onDispatch(candidate.employeeId)}
                  disabled={busy}
                  className="vyron-focus-ring rounded-lg bg-cyan-700 px-3 py-1.5 text-xs font-black text-white transition hover:bg-cyan-600 disabled:opacity-50"
                >
                  Dispatch
                </button>
              ) : (
                <span className="rounded-full bg-rose-100 px-2 py-0.5 text-[10px] font-bold text-rose-800">
                  Ineligible
                </span>
              )}
            </div>

            {!candidate.eligible && candidate.eligibilityFailures.length > 0 ? (
              <ul className="mt-1 list-disc pl-4 text-[11px] text-rose-700">
                {candidate.eligibilityFailures.map((failure, index) => (
                  <li key={`${failure.code}-${index}`}>{failure.detail}</li>
                ))}
              </ul>
            ) : null}
          </li>
        ))}
      </ul>

      {candidates ? (
        <p className="mt-2 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
          Deterministic engine {candidates.engineVersion} · eligibility is not AI-decided
        </p>
      ) : null}
    </div>
  );
}

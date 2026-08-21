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
const LANES: { key: string; label: string; states: string[] }[] = [
  { key: "new", label: "New", states: ["draft", "logged"] },
  { key: "authorisation", label: "Awaiting authorisation", states: ["authorisation_pending"] },
  { key: "ready", label: "Ready for dispatch", states: ["authorised", "dispatch_pending"] },
  { key: "assigned", label: "Assigned", states: ["assigned"] },
  { key: "accepted", label: "Accepted", states: ["accepted"] },
  { key: "en_route", label: "En route", states: ["en_route"] },
  { key: "on_scene", label: "Arrived", states: ["on_scene"] },
  {
    key: "active",
    label: "Recovery / tow",
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
      <header className="flex flex-col gap-3 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl font-black text-slate-900">Dispatch Board</h1>
          <p className="mt-1 text-sm text-slate-500">
            Road &amp; Recovery live dispatch. Refreshes every {RR_POLL_INTERVALS.dispatchBoard / 1000}s
            {board.paused ? " — paused while this tab is hidden" : ""}.
          </p>
        </div>
        <div className="flex items-center gap-3">
          {board.lastUpdatedAt ? (
            <span className="text-xs font-semibold text-slate-400">
              Updated {new Date(board.lastUpdatedAt).toLocaleTimeString()}
            </span>
          ) : null}
          <button
            onClick={() => {
              setIntakeOpen((open) => !open);
              setNotice(null);
            }}
            className="rounded-xl bg-cyan-700 px-4 py-2 text-sm font-bold text-white"
          >
            {intakeOpen ? "Close intake" : "Log a job"}
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
        <p className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-800">
          {board.error}
        </p>
      ) : null}
      {notice ? (
        <p className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-800">
          {notice}
        </p>
      ) : null}

      {board.initialLoading ? (
        <p className="text-sm font-semibold text-slate-500">Loading dispatch board…</p>
      ) : (
        <div className="grid gap-4 overflow-x-auto md:grid-cols-2 xl:grid-cols-3">
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
                              className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-bold text-cyan-300 disabled:opacity-50"
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
                              className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-bold text-cyan-300 disabled:opacity-50"
                            >
                              Release to dispatch
                            </button>
                          ) : null}

                          {job.service_state === "dispatch_pending" ? (
                            <button
                              onClick={() => evaluateCandidates(job.id)}
                              disabled={busy}
                              className="rounded-lg bg-cyan-700 px-3 py-1.5 text-xs font-bold text-white disabled:opacity-50"
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
                  className="rounded-lg bg-cyan-700 px-3 py-1.5 text-xs font-bold text-white disabled:opacity-50"
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

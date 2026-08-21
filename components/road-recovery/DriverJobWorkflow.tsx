"use client";

/**
 * Road & Recovery driver workflow (Phase 1).
 *
 * Reuses the existing mobile/field-workforce conventions rather than introducing a second
 * mobile system: GPS is captured with captureBrowserGps() from lib/field-operations.ts,
 * and every step the driver takes is recorded server-side as an existing field job event
 * ('Start Travel', 'Arrive Site').
 *
 * ARRIVAL IS EVIDENCE, NOT A BUTTON PRESS. The driver cannot report arrival without a
 * GPS fix: coordinates are mandatory, sent to the server, and validated against the
 * scene there. An arrival outside the radius is refused unless the driver supplies an
 * explicit reason, which is then recorded on the event.
 */

import React, { useState } from "react";
import { captureBrowserGps } from "@/lib/field-operations";
import RequirementsChecklist from "@/components/road-recovery/RequirementsChecklist";
import StandbyTimer from "@/components/road-recovery/StandbyTimer";
import { RR_POLL_INTERVALS, rrFetchJson, useRrPoll } from "@/lib/road-recovery/use-rr-poll";

type AssignmentRow = {
  id: string;
  service_job_id: string;
  assignment_status: string;
  offered_at: string | null;
};

type JobRow = {
  id: string;
  workflow_key?: string | null;
  service_state: string;
  standby?: {
    totalBillableSeconds: number;
    totalPausedSeconds: number;
    standingNow: boolean;
    intervalCount: number;
  } | null;
  pausedStates?: string[] | null;
  origin_label: string | null;
  origin_address: string | null;
  origin_latitude: number | null;
  origin_longitude: number | null;
  destination_label: string | null;
  vehicle_registration: string | null;
  vehicle_make: string | null;
  vehicle_model: string | null;
  scene_description: string | null;
};

type DriverPayload = {
  employeeId: string;
  /** Server timestamp the standby snapshots were computed at. */
  fetchedAt?: string | null;
  assignments: AssignmentRow[];
  jobs: JobRow[];
};

export default function DriverJobWorkflow({ companyId }: { companyId: string }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [declineFor, setDeclineFor] = useState<string | null>(null);
  const [declineReason, setDeclineReason] = useState("");
  const [overrideFor, setOverrideFor] = useState<string | null>(null);
  const [overrideReason, setOverrideReason] = useState("");
  const [pauseFor, setPauseFor] = useState<string | null>(null);
  const [pauseReason, setPauseReason] = useState("");
  const [pauseState, setPauseState] = useState("scene_handover_to_authority");
  const [reportFor, setReportFor] = useState<string | null>(null);
  const [reportSummary, setReportSummary] = useState("");

  const driver = useRrPoll<DriverPayload>(
    () =>
      rrFetchJson<DriverPayload>(
        `/api/road-recovery/driver/assignments?companyId=${encodeURIComponent(companyId)}`
      ),
    // A driver holding a live job polls faster than one waiting for work.
    RR_POLL_INTERVALS.driverActive,
    { enabled: Boolean(companyId) }
  );

  const assignments = driver.data?.assignments || [];
  const jobById = new Map((driver.data?.jobs || []).map((job) => [job.id, job]));

  async function withGps(): Promise<{ latitude: number | null; longitude: number | null; accuracy: number | null }> {
    try {
      const gps = await captureBrowserGps();
      return { latitude: gps.latitude, longitude: gps.longitude, accuracy: gps.accuracy };
    } catch {
      return { latitude: null, longitude: null, accuracy: null };
    }
  }

  async function act(action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await action();
      driver.refresh();
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : "Action failed.");
    } finally {
      setBusy(false);
    }
  }

  const accept = (assignmentId: string) =>
    act(async () => {
      await rrFetchJson(`/api/road-recovery/assignments/${assignmentId}/accept`, {
        method: "POST",
        body: JSON.stringify({ companyId }),
      });
      setMessage("Job accepted.");
    });

  const decline = (assignmentId: string) =>
    act(async () => {
      await rrFetchJson(`/api/road-recovery/assignments/${assignmentId}/decline`, {
        method: "POST",
        body: JSON.stringify({ companyId, reason: declineReason }),
      });
      setDeclineFor(null);
      setDeclineReason("");
      setMessage("Job declined.");
    });

  const startTravel = (serviceJobId: string) =>
    act(async () => {
      const gps = await withGps();
      await rrFetchJson("/api/road-recovery/driver/start-travel", {
        method: "POST",
        body: JSON.stringify({ companyId, serviceJobId, ...gps }),
      });
      setMessage("En route.");
    });

  const beginStanding = (serviceJobId: string) =>
    act(async () => {
      const gps = await withGps();
      await rrFetchJson(`/api/road-recovery/bystand/${serviceJobId}/standing`, {
        method: "POST",
        body: JSON.stringify({
          companyId,
          action: "begin",
          ...gps,
          // Telemetry only. The SERVER stamps the billable moment.
          clientReportedAt: new Date().toISOString(),
        }),
      });
      setMessage("Standing by. Billable time is now running.");
    });

  const pauseStanding = (serviceJobId: string, pauseState: string, reason: string) =>
    act(async () => {
      await rrFetchJson(`/api/road-recovery/bystand/${serviceJobId}/standing`, {
        method: "POST",
        body: JSON.stringify({ companyId, action: "pause", pauseState, reason }),
      });
      setPauseFor(null);
      setPauseReason("");
      setMessage("Standing clock paused. Paused time is not billable.");
    });

  const resumeStanding = (serviceJobId: string) =>
    act(async () => {
      await rrFetchJson(`/api/road-recovery/bystand/${serviceJobId}/standing`, {
        method: "POST",
        body: JSON.stringify({ companyId, action: "resume" }),
      });
      setMessage("Standing by again.");
    });

  const requestStandDown = (serviceJobId: string) =>
    act(async () => {
      await rrFetchJson(`/api/road-recovery/bystand/${serviceJobId}/stand-down`, {
        method: "POST",
        body: JSON.stringify({ companyId, action: "request", requestedBy: "Driver", channel: "system" }),
      });
      setMessage("Stand-down requested.");
    });

  const submitReport = (serviceJobId: string) =>
    act(async () => {
      await rrFetchJson(`/api/road-recovery/bystand/${serviceJobId}/report`, {
        method: "POST",
        body: JSON.stringify({ companyId, summary: reportSummary }),
      });
      setReportFor(null);
      setReportSummary("");
      setMessage("Observation report submitted.");
    });

  const captureEvidence = (serviceJobId: string, evidenceType: string) =>
    act(async () => {
      const gps = await withGps();
      await rrFetchJson(`/api/road-recovery/bystand/${serviceJobId}/evidence`, {
        method: "POST",
        body: JSON.stringify({ companyId, evidenceType, ...gps }),
      });
      setMessage(
        evidenceType === "bystand_periodic"
          ? "Presence recorded."
          : "Scene evidence recorded."
      );
    });

  const arrive = (serviceJobId: string, reason?: string) =>
    act(async () => {
      const gps = await withGps();
      if (gps.latitude == null || gps.longitude == null) {
        throw new Error(
          "Location is required to record arrival. Enable location services and try again."
        );
      }
      const result = await rrFetchJson<{ gpsVerified: boolean; distanceMeters: number | null }>(
        "/api/road-recovery/driver/arrive",
        {
          method: "POST",
          body: JSON.stringify({ companyId, serviceJobId, ...gps, overrideReason: reason || null }),
        }
      );
      setOverrideFor(null);
      setOverrideReason("");
      setMessage(
        result.gpsVerified
          ? `Arrival recorded and GPS verified (${Math.round(result.distanceMeters ?? 0)}m from scene).`
          : "Arrival recorded as UNVERIFIED with your reason."
      );
    });

  return (
    <div className="space-y-4">
      <header className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
        <h1 className="text-2xl font-black text-slate-900">My Jobs</h1>
        <p className="mt-1 text-sm text-slate-500">
          Refreshes every {RR_POLL_INTERVALS.driverActive / 1000}s
          {driver.paused ? " — paused while the screen is hidden" : ""}.
        </p>
      </header>

      {error ? (
        <p className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-800">
          {error}
        </p>
      ) : null}
      {message ? (
        <p className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-800">
          {message}
        </p>
      ) : null}

      {driver.initialLoading ? (
        <p className="text-sm font-semibold text-slate-500">Loading your jobs…</p>
      ) : assignments.length === 0 ? (
        <p className="rounded-2xl border border-slate-200 bg-white px-4 py-6 text-center text-sm font-semibold text-slate-400">
          No jobs assigned to you right now.
        </p>
      ) : null}

      {assignments.map((assignment) => {
        const job = jobById.get(assignment.service_job_id);
        if (!job) return null;
        const offered = assignment.assignment_status === "offered";

        return (
          <article
            key={assignment.id}
            className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-black text-slate-900">
                  {job.vehicle_registration || "Unknown vehicle"}
                </h2>
                <p className="text-sm text-slate-600">
                  {[job.vehicle_make, job.vehicle_model].filter(Boolean).join(" ") || "—"}
                </p>
              </div>
              <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-bold text-slate-700">
                {job.service_state.replace(/_/g, " ")}
              </span>
            </div>

            <dl className="mt-3 space-y-1 text-sm">
              <div>
                <dt className="inline font-bold text-slate-700">Scene: </dt>
                <dd className="inline text-slate-600">
                  {job.origin_label || job.origin_address || "Not specified"}
                </dd>
              </div>
              {job.destination_label ? (
                <div>
                  <dt className="inline font-bold text-slate-700">Destination: </dt>
                  <dd className="inline text-slate-600">{job.destination_label}</dd>
                </div>
              ) : null}
              {job.scene_description ? (
                <div>
                  <dt className="inline font-bold text-slate-700">Notes: </dt>
                  <dd className="inline text-slate-600">{job.scene_description}</dd>
                </div>
              ) : null}
            </dl>

            {job.origin_latitude != null && job.origin_longitude != null ? (
              <a
                href={`https://www.google.com/maps/dir/?api=1&destination=${job.origin_latitude},${job.origin_longitude}`}
                target="_blank"
                rel="noreferrer"
                className="mt-3 inline-block rounded-xl bg-slate-100 px-4 py-2 text-sm font-bold text-slate-800"
              >
                Navigate to scene
              </a>
            ) : null}

            <div className="mt-4 flex flex-wrap gap-2">
              {offered ? (
                <>
                  <button
                    onClick={() => accept(assignment.id)}
                    disabled={busy}
                    className="rounded-xl bg-emerald-700 px-4 py-2 text-sm font-bold text-white disabled:opacity-50"
                  >
                    Accept
                  </button>
                  <button
                    onClick={() => setDeclineFor(assignment.id)}
                    disabled={busy}
                    className="rounded-xl bg-slate-200 px-4 py-2 text-sm font-bold text-slate-800 disabled:opacity-50"
                  >
                    Decline
                  </button>
                </>
              ) : null}

              {job.service_state === "accepted" ? (
                <button
                  onClick={() => startTravel(job.id)}
                  disabled={busy}
                  className="rounded-xl bg-cyan-700 px-4 py-2 text-sm font-bold text-white disabled:opacity-50"
                >
                  Start en route
                </button>
              ) : null}

              {job.service_state === "en_route" ? (
                <button
                  onClick={() => arrive(job.id)}
                  disabled={busy}
                  className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-bold text-cyan-300 disabled:opacity-50"
                >
                  Record arrival (GPS)
                </button>
              ) : null}

              {/* BYSTAND-specific steps. Standing time starts ONLY here, never at dispatch. */}
              {job.workflow_key === "bystand" && job.service_state === "arrived_on_scene" ? (
                <button
                  onClick={() => beginStanding(job.id)}
                  disabled={busy}
                  className="rounded-xl bg-emerald-700 px-4 py-2 text-sm font-bold text-white disabled:opacity-50"
                >
                  Begin standing by
                </button>
              ) : null}

              {job.workflow_key === "bystand" && job.standby?.standingNow ? (
                <>
                  <button
                    onClick={() => setPauseFor(job.id)}
                    disabled={busy}
                    className="rounded-xl bg-amber-700 px-4 py-2 text-sm font-bold text-white disabled:opacity-50"
                  >
                    Pause
                  </button>
                  <button
                    onClick={() => requestStandDown(job.id)}
                    disabled={busy}
                    className="rounded-xl bg-slate-200 px-4 py-2 text-sm font-bold text-slate-800 disabled:opacity-50"
                  >
                    Request stand-down
                  </button>
                  <button
                    onClick={() => captureEvidence(job.id, "bystand_periodic")}
                    disabled={busy}
                    className="rounded-xl bg-slate-100 px-4 py-2 text-sm font-bold text-slate-700 disabled:opacity-50"
                  >
                    Record presence
                  </button>
                  <button
                    onClick={() => captureEvidence(job.id, "bystand_scene")}
                    disabled={busy}
                    className="rounded-xl bg-slate-100 px-4 py-2 text-sm font-bold text-slate-700 disabled:opacity-50"
                  >
                    Scene evidence
                  </button>
                </>
              ) : null}

              {job.workflow_key === "bystand" &&
              (job.pausedStates || []).includes(job.service_state) ? (
                <button
                  onClick={() => resumeStanding(job.id)}
                  disabled={busy}
                  className="rounded-xl bg-emerald-700 px-4 py-2 text-sm font-bold text-white disabled:opacity-50"
                >
                  Resume standing by
                </button>
              ) : null}

              {job.workflow_key === "bystand" && job.service_state === "stood_down" ? (
                <button
                  onClick={() =>
                    act(async () => {
                      await rrFetchJson(`/api/road-recovery/jobs/${job.id}/transition`, {
                        method: "POST",
                        body: JSON.stringify({ companyId, toState: "departed_scene" }),
                      });
                      setMessage("Departed the scene.");
                    })
                  }
                  disabled={busy}
                  className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-bold text-cyan-300 disabled:opacity-50"
                >
                  Depart scene
                </button>
              ) : null}

              {job.workflow_key === "bystand" && job.service_state === "departed_scene" ? (
                <button
                  onClick={() => setReportFor(job.id)}
                  disabled={busy}
                  className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-bold text-cyan-300 disabled:opacity-50"
                >
                  Submit report
                </button>
              ) : null}
            </div>

            {job.workflow_key === "bystand" && job.standby ? (
              <div className="mt-3">
                <StandbyTimer snapshot={job.standby} fetchedAt={driver.data?.fetchedAt ?? null} />
              </div>
            ) : null}

            {/*
              What this job still needs, on the driver's phone, while they are on scene —
              the only moment at which missing evidence can still be captured cheaply.
              Compact mode: no waiver controls, because excusing a requirement is a
              controller's decision and must name the person who took it.
            */}
            {!offered ? (
              <details className="mt-3 rounded-2xl border border-slate-200 bg-slate-50 p-3">
                <summary className="cursor-pointer text-sm font-bold text-slate-800">
                  Evidence required for this job
                </summary>
                <div className="mt-3">
                  <RequirementsChecklist
                    companyId={companyId}
                    serviceJobId={job.id}
                    compact
                    capturedByRole="driver"
                  />
                </div>
              </details>
            ) : null}

            {pauseFor === job.id ? (
              <div className="mt-3 rounded-2xl border border-amber-200 bg-amber-50 p-3">
                <label className="text-xs font-bold text-amber-900">Why are you pausing?</label>
                <select
                  value={pauseState}
                  onChange={(event) => setPauseState(event.target.value)}
                  className="mt-1 w-full rounded-xl border border-amber-300 px-3 py-2 text-sm"
                >
                  {(job.pausedStates || ["scene_handover_to_authority", "weather_hold"]).map(
                    (option) => (
                      <option key={option} value={option}>
                        {option.replace(/_/g, " ")}
                      </option>
                    )
                  )}
                </select>
                <input
                  value={pauseReason}
                  onChange={(event) => setPauseReason(event.target.value)}
                  className="mt-2 w-full rounded-xl border border-amber-300 px-3 py-2 text-sm"
                  placeholder="e.g. Scene handed to SAPS at 14:20"
                />
                <div className="mt-2 flex gap-2">
                  <button
                    onClick={() => pauseStanding(job.id, pauseState, pauseReason)}
                    disabled={busy || !pauseReason.trim()}
                    className="rounded-lg bg-amber-700 px-3 py-1.5 text-xs font-bold text-white disabled:opacity-50"
                  >
                    Pause standing clock
                  </button>
                  <button
                    onClick={() => setPauseFor(null)}
                    className="rounded-lg bg-slate-200 px-3 py-1.5 text-xs font-bold text-slate-700"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : null}

            {reportFor === job.id ? (
              <div className="mt-3 rounded-2xl border border-slate-200 bg-slate-50 p-3">
                <label className="text-xs font-bold text-slate-700">Observation report</label>
                <textarea
                  value={reportSummary}
                  onChange={(event) => setReportSummary(event.target.value)}
                  rows={4}
                  className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
                  placeholder="What happened on scene, who attended, and how the attendance ended."
                />
                <div className="mt-2 flex gap-2">
                  <button
                    onClick={() => submitReport(job.id)}
                    disabled={busy || !reportSummary.trim()}
                    className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-bold text-cyan-300 disabled:opacity-50"
                  >
                    Submit report
                  </button>
                  <button
                    onClick={() => setReportFor(null)}
                    className="rounded-lg bg-slate-200 px-3 py-1.5 text-xs font-bold text-slate-700"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : null}

            {declineFor === assignment.id ? (
              <div className="mt-3 rounded-2xl border border-slate-200 bg-slate-50 p-3">
                <label className="text-xs font-bold text-slate-700">Why are you declining?</label>
                <input
                  value={declineReason}
                  onChange={(event) => setDeclineReason(event.target.value)}
                  className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
                  placeholder="e.g. Vehicle unsuitable for this recovery"
                />
                <div className="mt-2 flex gap-2">
                  <button
                    onClick={() => decline(assignment.id)}
                    disabled={busy || !declineReason.trim()}
                    className="rounded-lg bg-rose-700 px-3 py-1.5 text-xs font-bold text-white disabled:opacity-50"
                  >
                    Confirm decline
                  </button>
                  <button
                    onClick={() => setDeclineFor(null)}
                    className="rounded-lg bg-slate-200 px-3 py-1.5 text-xs font-bold text-slate-700"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : null}

            {job.service_state === "en_route" ? (
              <div className="mt-3">
                {overrideFor === job.id ? (
                  <div className="rounded-2xl border border-amber-200 bg-amber-50 p-3">
                    <label className="text-xs font-bold text-amber-900">
                      You are outside the scene radius. Explain why you are recording arrival.
                    </label>
                    <input
                      value={overrideReason}
                      onChange={(event) => setOverrideReason(event.target.value)}
                      className="mt-1 w-full rounded-xl border border-amber-300 px-3 py-2 text-sm"
                      placeholder="e.g. Road closed, staged at nearest safe point"
                    />
                    <div className="mt-2 flex gap-2">
                      <button
                        onClick={() => arrive(job.id, overrideReason)}
                        disabled={busy || !overrideReason.trim()}
                        className="rounded-lg bg-amber-700 px-3 py-1.5 text-xs font-bold text-white disabled:opacity-50"
                      >
                        Record unverified arrival
                      </button>
                      <button
                        onClick={() => setOverrideFor(null)}
                        className="rounded-lg bg-slate-200 px-3 py-1.5 text-xs font-bold text-slate-700"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    onClick={() => setOverrideFor(job.id)}
                    className="text-xs font-bold text-slate-500 underline"
                  >
                    Cannot reach the scene exactly?
                  </button>
                )}
              </div>
            ) : null}
          </article>
        );
      })}
    </div>
  );
}

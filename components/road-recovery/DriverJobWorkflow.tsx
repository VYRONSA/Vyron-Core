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

import { RREmptyState, RRLaneEmpty, RRLoading } from "@/components/road-recovery/ui";
import React, { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { captureBrowserGps } from "@/lib/field-operations";
import RequirementsChecklist from "@/components/road-recovery/RequirementsChecklist";
import StandbyTimer from "@/components/road-recovery/StandbyTimer";
import { RR_POLL_INTERVALS, rrFetchJson, useRrPoll } from "@/lib/road-recovery/use-rr-poll";
import OutboxStatus from "@/components/road-recovery/OutboxProvider";
import { allItems, enqueue } from "@/lib/road-recovery/outbox";
import {
  allEvidence,
  captureEvidence as saveCaptureToDevice,
  drainEvidence,
  evidenceStatusText,
  markLinked,
  uploadEvidence,
  type RrEvidenceRecord,
} from "@/lib/road-recovery/evidence-queue";
import { getSupabaseBrowserClient } from "@/lib/supabase";
import DriverMobileJob from "@/components/road-recovery/DriverMobileJob";

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
  /** Mandatory-evidence summary, computed server-side (see driver/assignments). */
  requirements?: { required: number; satisfied: number; missingLabels: string[] } | null;
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
  const [pauseFor, setPauseFor] = useState<string | null>(null);
  const [pauseReason, setPauseReason] = useState("");
  const [pauseState, setPauseState] = useState("scene_handover_to_authority");
  const [reportFor, setReportFor] = useState<string | null>(null);
  const [reportSummary, setReportSummary] = useState("");
  const [gpsExceptionFor, setGpsExceptionFor] = useState<string | null>(null);
  const [gpsExceptionReason, setGpsExceptionReason] = useState("");
  const [captures, setCaptures] = useState<RrEvidenceRecord[]>([]);

  /**
   * Connectivity is browser state, not component state, so it is subscribed to
   * rather than mirrored into a useState — which keeps the value correct on the
   * very first render instead of one effect behind.
   */
  const online = useSyncExternalStore(
    (notify) => {
      window.addEventListener("online", notify);
      window.addEventListener("offline", notify);
      return () => {
        window.removeEventListener("online", notify);
        window.removeEventListener("offline", notify);
      };
    },
    () => navigator.onLine,
    () => true
  );

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


  /**
   * Every driver mutation goes through the outbox.
   *
   * Two things follow from that, and both matter:
   *
   *   1. The operation is durable BEFORE the network is touched, and carries an
   *      operationId, so a lost response can never cause a duplicate mutation —
   *      the server replays its receipt instead.
   *   2. `offlineSafe` decides whether it may execute LATER. It defaults to
   *      false: every operational timestamp here is stamped with server time at
   *      processing, so a deferred arrival or BYSTAND clock action would record
   *      a time that never happened. Those fail immediately with "Connection
   *      required" rather than quietly waiting to falsify the record.
   */
  const send = (input: {
    operationType: string;
    route: string;
    payload: Record<string, unknown>;
    serviceJobId?: string | null;
    label: string;
    offlineSafe?: boolean;
  }) => enqueue({ ...input, payload: { ...input.payload, companyId } });

  async function withGps(): Promise<{ latitude: number | null; longitude: number | null; accuracy: number | null }> {
    try {
      const gps = await captureBrowserGps();
      return { latitude: gps.latitude, longitude: gps.longitude, accuracy: gps.accuracy };
    } catch {
      return { latitude: null, longitude: null, accuracy: null };
    }
  }

  /**
   * Sends the bytes straight to the private `rr-evidence` bucket.
   *
   * They never pass through the application server: the sql/072 storage policy
   * allows a write only beneath the caller's own company folder, so the upload
   * is authorised by the driver's own session at the point the bytes land.
   *
   * `upsert: false` is deliberate. A retry of an upload that already succeeded
   * comes back "already exists", and the queue treats that as done — the path
   * carries an unguessable uuid under this company's prefix, so an object there
   * can only be this device's earlier attempt at this same capture.
   */
  const uploadBlob = useCallback(
    async (path: string, blob: Blob, contentType: string) => {
      const { error } = await getSupabaseBrowserClient()
        .storage.from("rr-evidence")
        .upload(path, blob, { contentType, upsert: false });
      if (!error) return { ok: true } as const;
      const already = /exist/i.test(error.message || "") || (error as { statusCode?: string }).statusCode === "409";
      return { ok: false as const, error: error.message || "Upload failed.", alreadyExists: already };
    },
    []
  );

  /**
   * Reconciles what the device holds against what the server has confirmed.
   *
   * A capture is only called verified once the outbox reports its row accepted —
   * and because both halves now share one operationId, that is a direct lookup
   * rather than a guess. The bytes are released at that point; the record stays.
   */
  const refreshCaptures = useCallback(async () => {
    const [records, queued] = await Promise.all([allEvidence(), allItems()]);
    const accepted = new Set(
      queued.filter((item) => item.state === "SUCCEEDED").map((item) => item.operationId)
    );
    const settled = records.filter((record) => record.state === "uploaded" && accepted.has(record.operationId));
    if (settled.length > 0) {
      await Promise.all(settled.map((record) => markLinked(record.operationId)));
      setCaptures(await allEvidence());
      return;
    }
    setCaptures(records);
  }, []);

  /**
   * Drives evidence uploads: on mount, when signal returns, and on a slow timer
   * for anything that failed while the tab stayed open.
   */
  useEffect(() => {
    let live = true;
    const pump = async () => {
      await drainEvidence(uploadBlob);
      if (live) await refreshCaptures();
    };
    void pump();
    window.addEventListener("online", pump);
    const timer = setInterval(pump, 20_000);
    return () => {
      live = false;
      window.removeEventListener("online", pump);
      clearInterval(timer);
    };
  }, [uploadBlob, refreshCaptures]);

  /**
   * The camera.
   *
   * The photograph is on disk before anything is attempted, so it survives a
   * dead connection, a refresh or a closed browser. Only after the server has
   * accepted the row is it described as verified — "saved" never means "sent".
   */
  const capturePhoto = (serviceJobId: string, evidenceType: string) => async (file: File) => {
    setError(null);
    try {
      const gps = await withGps();
      const record = await saveCaptureToDevice({
        blob: file,
        companyId,
        serviceJobId,
        evidenceType,
        latitude: gps.latitude,
        longitude: gps.longitude,
        accuracy: gps.accuracy,
        metadata: { fileName: file.name },
      });
      await refreshCaptures();
      setMessage(
        navigator.onLine
          ? "Photo saved on device. Uploading now."
          : "Photo saved on device. It will upload automatically when you have signal."
      );
      if (navigator.onLine) {
        await uploadEvidence(record.operationId, uploadBlob);
        await refreshCaptures();
      }
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : "Could not save the photo.");
    }
  };

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
      await send({ operationType: "accept_assignment", label: "Accept job",
        route: `/api/road-recovery/assignments/${assignmentId}/accept`, payload: {} });
      setMessage("Job accepted.");
    });

  const decline = (assignmentId: string) =>
    act(async () => {
      await send({ operationType: "decline_assignment", label: "Decline job",
        route: `/api/road-recovery/assignments/${assignmentId}/decline`,
        payload: { reason: declineReason } });
      setDeclineFor(null);
      setDeclineReason("");
      setMessage("Job declined.");
    });

  const startTravel = (serviceJobId: string) =>
    act(async () => {
      const gps = await withGps();
      await send({ operationType: "start_travel", label: "Start travel", serviceJobId,
        route: "/api/road-recovery/driver/start-travel", payload: { serviceJobId, ...gps } });
      setMessage("En route.");
    });

  const beginStanding = (serviceJobId: string) =>
    act(async () => {
      const gps = await withGps();
      await send({ operationType: "transition", label: "BYSTAND", serviceJobId,
        route: `/api/road-recovery/bystand/${serviceJobId}/standing`, payload: {
          companyId,
          action: "begin",
          ...gps,
          // Telemetry only. The SERVER stamps the billable moment.
          clientReportedAt: new Date().toISOString(),
        } });
      setMessage("Standing by. Billable time is now running.");
    });

  const pauseStanding = (serviceJobId: string, pauseState: string, reason: string) =>
    act(async () => {
      await send({ operationType: "transition", label: "BYSTAND", serviceJobId,
        route: `/api/road-recovery/bystand/${serviceJobId}/standing`, payload: { companyId, action: "pause", pauseState, reason } });
      setPauseFor(null);
      setPauseReason("");
      setMessage("Standing clock paused. Paused time is not billable.");
    });

  const resumeStanding = (serviceJobId: string) =>
    act(async () => {
      await send({ operationType: "transition", label: "BYSTAND", serviceJobId,
        route: `/api/road-recovery/bystand/${serviceJobId}/standing`, payload: { companyId, action: "resume" } });
      setMessage("Standing by again.");
    });

  const requestStandDown = (serviceJobId: string) =>
    act(async () => {
      await send({ operationType: "transition", label: "BYSTAND", serviceJobId,
        route: `/api/road-recovery/bystand/${serviceJobId}/stand-down`, payload: { companyId, action: "request", requestedBy: "Driver", channel: "system" } });
      setMessage("Stand-down requested.");
    });

  const submitReport = (serviceJobId: string) =>
    act(async () => {
      await send({ operationType: "add_note", label: "Report", serviceJobId,
        offlineSafe: true,
        route: `/api/road-recovery/bystand/${serviceJobId}/report`, payload: { companyId, summary: reportSummary } });
      setReportFor(null);
      setReportSummary("");
      setMessage("Observation report submitted.");
    });

  const captureEvidence = (serviceJobId: string, evidenceType: string) =>
    act(async () => {
      const gps = await withGps();
      await send({ operationType: "capture_evidence", label: "Evidence", serviceJobId,
        offlineSafe: true,
        route: `/api/road-recovery/bystand/${serviceJobId}/evidence`, payload: { companyId, evidenceType, ...gps } });
      setMessage(
        evidenceType === "bystand_periodic"
          ? "Presence recorded."
          : "Scene evidence recorded."
      );
    });

  /**
   * Arrival is ONLINE-ONLY and stays a direct call.
   *
   * It is the one action whose response the driver needs to see immediately —
   * whether GPS verified them, and how far from the scene — so it is not routed
   * through the outbox, which returns a queue item rather than a server answer.
   *
   * It still carries an operationId so a lost response cannot double-record an
   * arrival. The id is held per job and REUSED on a retry, which is what makes
   * the receipt match; a fresh id per tap would defeat it entirely.
   */
  const arriveOperationIds = useRef<Record<string, string>>({});

  /**
   * The exception path. Sends NO coordinates — it does not fabricate a position —
   * and carries the driver's stated reason, which the server records as the
   * override. Same stable operationId, so a lost response still cannot
   * double-record.
   */
  const arriveWithoutGps = (serviceJobId: string, reason: string) =>
    act(async () => {
      arriveOperationIds.current[serviceJobId] =
        arriveOperationIds.current[serviceJobId] || crypto.randomUUID();
      await rrFetchJson("/api/road-recovery/driver/arrive", {
        method: "POST",
        body: JSON.stringify({
          companyId, serviceJobId,
          latitude: null, longitude: null, accuracy: null,
          overrideReason: reason,
          operationId: arriveOperationIds.current[serviceJobId],
        }),
      });
      delete arriveOperationIds.current[serviceJobId];
      setMessage("Arrival recorded without location, with your reason.");
    });

  const arrive = (serviceJobId: string, reason?: string) =>
    act(async () => {
      const gps = await withGps();
      if (gps.latitude == null || gps.longitude == null) {
        // No silent fallback. The driver is offered the explicit exception path
        // below instead, which requires them to say why.
        setGpsExceptionFor(serviceJobId);
        throw new Error(
          "We could not confirm your location. Choose a reason below to record your arrival."
        );
      }
      arriveOperationIds.current[serviceJobId] =
        arriveOperationIds.current[serviceJobId] || crypto.randomUUID();
      const result = await rrFetchJson<{ gpsVerified: boolean; distanceMeters: number | null }>(
        "/api/road-recovery/driver/arrive",
        {
          method: "POST",
          body: JSON.stringify({
            companyId, serviceJobId, ...gps,
            overrideReason: reason || null,
            operationId: arriveOperationIds.current[serviceJobId],
          }),
        }
      );
      // Succeeded: the next arrival on this job is a different intent.
      delete arriveOperationIds.current[serviceJobId];
      setMessage(
        result.gpsVerified
          ? `Arrival recorded and GPS verified (${Math.round(result.distanceMeters ?? 0)}m from scene).`
          : "Arrival recorded as UNVERIFIED with your reason."
      );
    });

  return (
    <div className="space-y-4">
      {/* One line, and only when there is something to say. Renders nothing while
          the queue is empty, so it costs the driver no attention until it matters. */}
      <OutboxStatus />

      <header className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-[0_14px_40px_rgba(15,23,42,0.08)]">
                <p className="mt-1 text-sm text-slate-500">
          Refreshes every {RR_POLL_INTERVALS.driverActive / 1000}s
          {driver.paused ? " — paused while the screen is hidden" : ""}.
        </p>
      </header>

      {error ? (
        <p role="alert" className="rounded-[22px] border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-900">
          {error}
        </p>
      ) : null}
      {message ? (
        <p role="status" className="rounded-[22px] border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-900">
          {message}
        </p>
      ) : null}

      {driver.initialLoading ? (
        <RRLoading label="Loading your jobs" />
      ) : assignments.length === 0 ? (
        <p className="rounded-2xl border border-slate-200 bg-white px-4 py-6 text-center text-sm font-semibold text-slate-400">
          No jobs assigned to you right now.
        </p>
      ) : null}

      {/*
        The driver's job card.

        Presentation lives in DriverMobileJob so the single-primary-action rule is
        expressed in one place and driven by resolveDriverNextAction() — the same
        resolver the unit tests cover. This component keeps the handlers; it no
        longer decides what to show.
      */}
      {assignments.map((assignment) => {
        const job = jobById.get(assignment.service_job_id);
        const jobCaptures = captures.filter((record) => record.serviceJobId === assignment.service_job_id);
        if (!job) return null;

        // Maps the resolver's action vocabulary onto the existing handlers. An
        // action the resolver never offers for this state simply cannot be
        // dispatched, so the screen cannot request a rejected transition.
        const dispatch = (kind: string) => {
          switch (kind) {
            case "accept": return accept(assignment.id);
            case "decline": return setDeclineFor(assignment.id);
            case "start_travel": return startTravel(job.id);
            case "arrive": return arrive(job.id);
            case "begin_standing": return beginStanding(job.id);
            case "pause_standing": return setPauseFor(job.id);
            case "resume_standing": return resumeStanding(job.id);
            case "stand_down": return requestStandDown(job.id);
            case "submit_report": return setReportFor(job.id);
            case "capture_evidence":
              return captureEvidence(job.id, job.workflow_key === "bystand" ? "bystand_scene" : "rr_requirement");
            default:
              return undefined;
          }
        };

        return (
          <DriverMobileJob
            key={assignment.id}
            job={job as never}
            assignment={assignment as never}
            requirements={(job as unknown as { requirements?: never }).requirements ?? null}
            busy={busy}
            onAction={dispatch}
            onCapturePhoto={capturePhoto(
              job.id,
              job.workflow_key === "bystand" ? "bystand_scene" : "rr_requirement"
            )}
            captures={jobCaptures.map((record) => {
              const status = evidenceStatusText(record, online);
              return { operationId: record.operationId, title: status.title, detail: status.detail };
            })}
          />
        );
      })}

      {/*
        Reason prompts.

        Lifted out of the job card deliberately: a card that renders one primary
        action must not also sprout inline forms. These are the only three actions
        the workflow REQUIRES words for, and each is a single field with one
        confirm — no modal chains.
      */}
      {declineFor && (
        <div className="rounded-[28px] border border-rose-200 bg-rose-50 p-5">
          <h3 className="text-base font-black text-rose-900">Why are you declining?</h3>
          <p className="mt-1 text-sm text-rose-800">
            The control room needs a reason so they can reassign the job quickly.
          </p>
          <textarea
            value={declineReason}
            onChange={(event) => setDeclineReason(event.target.value)}
            rows={3}
            placeholder="For example: already on another recovery"
            className="vyron-focus-ring mt-3 w-full rounded-2xl border border-rose-200 p-3 text-base"
          />
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              disabled={busy || declineReason.trim().length === 0}
              onClick={() => decline(declineFor)}
              className="vyron-focus-ring min-h-12 flex-1 rounded-2xl bg-rose-700 px-4 text-sm font-black text-white disabled:opacity-50"
            >
              Decline job
            </button>
            <button
              type="button"
              onClick={() => { setDeclineFor(null); setDeclineReason(""); }}
              className="vyron-focus-ring min-h-12 rounded-2xl border border-rose-200 bg-white px-4 text-sm font-black text-rose-700"
            >
              Keep job
            </button>
          </div>
        </div>
      )}

      {pauseFor && (
        <div className="rounded-[28px] border border-violet-200 bg-violet-50 p-5">
          <h3 className="text-base font-black text-violet-900">Why are you pausing?</h3>
          <select
            value={pauseState}
            onChange={(event) => setPauseState(event.target.value)}
            className="vyron-focus-ring mt-3 w-full rounded-2xl border border-violet-200 p-3 text-base"
          >
            <option value="scene_handover_to_authority">Handed over to SAPS / authority</option>
            <option value="scene_stood_down">Stood down on scene</option>
          </select>
          <textarea
            value={pauseReason}
            onChange={(event) => setPauseReason(event.target.value)}
            rows={2}
            placeholder="Anything the control room should know"
            className="vyron-focus-ring mt-3 w-full rounded-2xl border border-violet-200 p-3 text-base"
          />
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => pauseStanding(pauseFor, pauseState, pauseReason)}
              className="vyron-focus-ring min-h-12 flex-1 rounded-2xl bg-violet-800 px-4 text-sm font-black text-white disabled:opacity-50"
            >
              Pause standing
            </button>
            <button
              type="button"
              onClick={() => { setPauseFor(null); setPauseReason(""); }}
              className="vyron-focus-ring min-h-12 rounded-2xl border border-violet-200 bg-white px-4 text-sm font-black text-violet-800"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/*
        GPS EXCEPTION.

        Offered only when location genuinely could not be obtained — never as a
        standing "skip GPS" button, and never a silent fallback. The driver must
        say why, and that reason is recorded through the existing
        driver/arrive overrideReason field and stored on the state event, so the
        exception is auditable rather than invisible.
      */}
      {gpsExceptionFor && (
        <div className="rounded-[28px] border border-amber-300 bg-amber-50 p-5">
          <h3 className="text-base font-black text-amber-900">Can&apos;t confirm your exact location?</h3>
          <p className="mt-1 text-sm leading-6 text-amber-900">
            Your arrival is normally confirmed by your phone&apos;s location, which is what proves you
            reached the scene. We could not read it. You can still record your arrival, but you must
            say why — the control room will see this.
          </p>
          <select
            value={gpsExceptionReason}
            onChange={(event) => setGpsExceptionReason(event.target.value)}
            className="vyron-focus-ring mt-3 min-h-12 w-full rounded-2xl border border-amber-300 bg-white p-3 text-base"
          >
            <option value="">Choose a reason…</option>
            <option value="no_gps_signal">No GPS signal at this location</option>
            <option value="location_permission_denied">Location is switched off on my phone</option>
            <option value="device_fault">My phone&apos;s location is not working</option>
            <option value="staged_away_from_scene">I am staged away from the scene for safety</option>
          </select>
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              disabled={busy || gpsExceptionReason === ""}
              onClick={() => {
                const job = gpsExceptionFor;
                setGpsExceptionFor(null);
                void arriveWithoutGps(job, gpsExceptionReason);
                setGpsExceptionReason("");
              }}
              className="vyron-focus-ring min-h-12 flex-1 rounded-2xl bg-amber-900 px-4 text-sm font-black text-white disabled:opacity-50"
            >
              Record arrival without location
            </button>
            <button
              type="button"
              onClick={() => { setGpsExceptionFor(null); setGpsExceptionReason(""); }}
              className="vyron-focus-ring min-h-12 rounded-2xl border border-amber-300 bg-white px-4 text-sm font-black text-amber-900"
            >
              Try again
            </button>
          </div>
        </div>
      )}

      {reportFor && (
        <div className="rounded-[28px] border border-slate-200 bg-white p-5">
          <h3 className="text-base font-black text-slate-900">Observation report</h3>
          <textarea
            value={reportSummary}
            onChange={(event) => setReportSummary(event.target.value)}
            rows={4}
            placeholder="What did you observe on scene?"
            className="vyron-focus-ring mt-3 w-full rounded-2xl border border-slate-200 p-3 text-base"
          />
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              disabled={busy || reportSummary.trim().length === 0}
              onClick={() => submitReport(reportFor)}
              className="vyron-focus-ring min-h-12 flex-1 rounded-2xl bg-slate-950 px-4 text-sm font-black text-cyan-300 disabled:opacity-50"
            >
              Submit report
            </button>
            <button
              type="button"
              onClick={() => { setReportFor(null); setReportSummary(""); }}
              className="vyron-focus-ring min-h-12 rounded-2xl border border-slate-200 px-4 text-sm font-black text-slate-700"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

"use client";

/**
 * One job, as the driver sees it.
 *
 * The screen answers four questions in the order a person standing at a roadside
 * needs them: is this dangerous, what is the job, where do I go, what do I do
 * now. Everything else is behind a disclosure.
 *
 * Two rules shape the layout:
 *
 *   SAFETY IS NEVER COLLAPSED. Casualty, hazmat and an undriveable vehicle are
 *   rendered above the job identity and cannot be hidden behind "More details".
 *   A warning a driver has to tap to discover is a warning that arrives too late.
 *
 *   EXACTLY ONE PRIMARY ACTION, and only one the workflow will accept. The
 *   button comes from resolveDriverNextAction(), the same resolver the tests
 *   cover, so the screen cannot offer a transition the state machine will
 *   reject. Everything else is visually subordinate.
 *
 * The primary action is pinned to the bottom of the card, in thumb reach, and is
 * sized for a gloved hand.
 */

import React, { useMemo, useState } from "react";
import {
  AlertTriangle,
  Camera,
  ChevronDown,
  Flame,
  MapPin,
  Navigation,
  Phone,
  ShieldAlert,
} from "lucide-react";
import {
  RR_DRIVER_STATUS_TONE_CLASS,
  resolveDriverNextAction,
  type RrDriverAction,
} from "@/lib/road-recovery/driver-next-action";

export type DriverJobView = {
  id: string;
  job_ref?: string | null;
  service_type_name?: string | null;
  priority?: string | null;
  customer_name?: string | null;
  service_state: string;
  workflow_key?: string | null;
  origin_label?: string | null;
  origin_address?: string | null;
  origin_latitude?: number | null;
  origin_longitude?: number | null;
  destination_label?: string | null;
  destination_address?: string | null;
  vehicle_registration?: string | null;
  vehicle_make?: string | null;
  vehicle_model?: string | null;
  vehicle_is_drivable?: boolean | null;
  casualty_flag?: boolean | null;
  hazmat_flag?: boolean | null;
  scene_description?: string | null;
  standby?: { standingNow: boolean } | null;
  pausedStates?: string[] | null;
};

export type DriverAssignmentView = {
  id: string;
  assignment_status: string;
  notes?: string | null;
  vehicle_label?: string | null;
};

export type RequirementSummary = {
  required: number;
  satisfied: number;
  missingLabels: string[];
};

/** Opens the phone's own map app — the driver already trusts it. */
function navigateHref(job: DriverJobView): string {
  if (job.origin_latitude != null && job.origin_longitude != null) {
    return `https://www.google.com/maps/dir/?api=1&destination=${job.origin_latitude},${job.origin_longitude}`;
  }
  const query = encodeURIComponent(job.origin_address || job.origin_label || "");
  return `https://www.google.com/maps/dir/?api=1&destination=${query}`;
}

function priorityTone(priority?: string | null): string {
  const value = String(priority || "").toLowerCase();
  if (value === "critical" || value === "urgent") return "bg-rose-600 text-white";
  if (value === "high") return "bg-amber-500 text-amber-950";
  return "bg-slate-200 text-slate-700";
}

export default function DriverMobileJob({
  job,
  assignment,
  requirements,
  onAction,
  onCapturePhoto,
  captures = [],
  busy,
  controlRoomNumber,
}: {
  job: DriverJobView;
  assignment: DriverAssignmentView | null;
  requirements?: RequirementSummary | null;
  onAction: (kind: RrDriverAction["kind"]) => void;
  onCapturePhoto?: (file: File) => void;
  /** What each photograph on this device has actually achieved so far. */
  captures?: { operationId: string; title: string; detail: string }[];
  busy?: boolean;
  controlRoomNumber?: string | null;
}) {
  const [showDetail, setShowDetail] = useState(false);

  const next = useMemo(
    () =>
      resolveDriverNextAction({
        assignmentStatus: assignment?.assignment_status ?? "",
        serviceState: job.service_state,
        workflowKey: job.workflow_key,
        standingNow: job.standby?.standingNow,
        pausedStates: job.pausedStates,
      }),
    [assignment?.assignment_status, job.service_state, job.workflow_key, job.standby, job.pausedStates]
  );

  // Anything that changes how a driver approaches the scene.
  const hazards: { icon: React.ReactNode; text: string }[] = [];
  if (job.casualty_flag) hazards.push({ icon: <ShieldAlert className="h-5 w-5" />, text: "Casualty on scene" });
  if (job.hazmat_flag) hazards.push({ icon: <Flame className="h-5 w-5" />, text: "Hazardous materials" });
  if (job.vehicle_is_drivable === false) {
    hazards.push({ icon: <AlertTriangle className="h-5 w-5" />, text: "Vehicle is not driveable" });
  }

  return (
    <article className="rounded-[28px] border border-slate-200 bg-white shadow-[0_18px_45px_rgba(15,23,42,0.10)]">
      {/* 1. SAFETY — first, and never behind a disclosure. */}
      {hazards.length > 0 && (
        <div className="rounded-t-[28px] bg-rose-600 px-5 py-3 text-white">
          <ul className="space-y-1">
            {hazards.map((hazard) => (
              <li key={hazard.text} className="flex items-center gap-2 text-sm font-black">
                <span aria-hidden="true">{hazard.icon}</span>
                {hazard.text}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="space-y-5 p-5">
        {/* 2. WHAT IS THIS JOB */}
        <header className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={`inline-flex rounded-full px-2.5 py-1 text-[11px] font-black uppercase tracking-[0.16em] ring-1 ${
                RR_DRIVER_STATUS_TONE_CLASS[next.statusTone]
              }`}
            >
              {next.statusLabel}
            </span>
            {job.priority && (
              <span
                className={`inline-flex rounded-full px-2.5 py-1 text-[11px] font-black uppercase tracking-[0.16em] ${priorityTone(
                  job.priority
                )}`}
              >
                {job.priority}
              </span>
            )}
          </div>

          <h2 className="text-2xl font-black leading-tight tracking-tight text-slate-950">
            {job.service_type_name || "Road & Recovery job"}
          </h2>
          <p className="text-sm font-bold text-slate-500">
            {[job.job_ref, job.customer_name].filter(Boolean).join(" · ") || "Job details below"}
          </p>
        </header>

        {/* 3. WHERE */}
        <div className="rounded-[22px] bg-slate-50 p-4">
          <div className="flex items-start gap-3">
            <MapPin className="mt-0.5 h-5 w-5 shrink-0 text-slate-500" aria-hidden="true" />
            <div className="min-w-0">
              <div className="text-base font-black text-slate-900">
                {job.origin_label || job.origin_address || "Location on the job card"}
              </div>
              {job.origin_address && job.origin_label && (
                <div className="text-sm text-slate-600">{job.origin_address}</div>
              )}
              {job.destination_label && (
                <div className="mt-2 text-sm text-slate-600">
                  <span className="font-black text-slate-500">To: </span>
                  {job.destination_label}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* 4. THE VEHICLE AND THE TRUCK */}
        <dl className="grid grid-cols-2 gap-3 text-sm">
          <div>
            <dt className="text-[11px] font-black uppercase tracking-[0.16em] text-slate-400">Vehicle</dt>
            <dd className="mt-0.5 font-black text-slate-900">{job.vehicle_registration || "—"}</dd>
            <dd className="text-slate-600">
              {[job.vehicle_make, job.vehicle_model].filter(Boolean).join(" ") || ""}
            </dd>
          </div>
          <div>
            <dt className="text-[11px] font-black uppercase tracking-[0.16em] text-slate-400">Your truck</dt>
            <dd className="mt-0.5 font-black text-slate-900">{assignment?.vehicle_label || "—"}</dd>
          </div>
        </dl>

        {/* 5. WHAT EVIDENCE IS NEEDED — stated, never guessed at. */}
        {requirements && requirements.required > 0 && (
          <div className="rounded-[22px] border border-slate-200 p-4">
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-[11px] font-black uppercase tracking-[0.16em] text-slate-400">Evidence</span>
              <span className="text-sm font-black text-slate-900">
                {requirements.satisfied} of {requirements.required} captured
              </span>
            </div>
            {requirements.missingLabels.length > 0 ? (
              <ul className="mt-2 space-y-1">
                {requirements.missingLabels.slice(0, 4).map((label) => (
                  <li key={label} className="text-sm text-slate-600">
                    Still needed: <span className="font-bold text-slate-800">{label}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-sm font-bold text-emerald-700">Everything required has been captured.</p>
            )}
          </div>
        )}

        {/* Controller's instructions, when there are any. */}
        {assignment?.notes && (
          <div className="rounded-[22px] border border-sky-200 bg-sky-50 p-4">
            <div className="text-[11px] font-black uppercase tracking-[0.16em] text-sky-700">From the control room</div>
            <p className="mt-1 text-sm leading-6 text-sky-900">{assignment.notes}</p>
          </div>
        )}

        {/* 6. WHAT DO I DO NOW — one sentence, then one button. */}
        <p className="text-sm leading-6 text-slate-600">{next.guidance}</p>

        {/*
          The action sticks to the bottom of the viewport while the card is on
          screen. Measured QA put "Accept job" 1298px down a 844px screen on a
          hazardous job — reachable only by scrolling, which is exactly what a
          driver holding a phone one-handed at a roadside should not have to do.
          Sticky keeps the information order intact and the action in the thumb.
        */}
        {next.primary ? (
          <div className="sticky bottom-0 -mx-5 border-t border-slate-100 bg-white/95 px-5 py-3 backdrop-blur">
          <button
            type="button"
            disabled={busy}
            onClick={() => onAction(next.primary!.kind)}
            className="vyron-focus-ring flex min-h-[60px] w-full items-center justify-center rounded-[22px] bg-slate-950 px-6 text-lg font-black text-cyan-300 shadow-[0_16px_38px_rgba(2,6,23,0.28)] transition active:scale-[0.99] disabled:opacity-60"
          >
            {busy ? "Working…" : next.primary.label}
          </button>
          </div>
        ) : (
          <p className="rounded-[22px] bg-slate-100 px-4 py-4 text-center text-sm font-black text-slate-600">
            Nothing to do on this job right now.
          </p>
        )}

        {/* Camera, when the driver's next job is evidence. Large, obvious, and it
            never blocks: capture succeeds offline and uploads later. */}
        {onCapturePhoto && (
          <label className="vyron-focus-ring flex min-h-[52px] w-full cursor-pointer items-center justify-center gap-2 rounded-[22px] border-2 border-dashed border-slate-300 px-6 text-base font-black text-slate-700">
            <Camera className="h-5 w-5" aria-hidden="true" />
            Take photo
            <input
              type="file"
              accept="image/*"
              // Opens the camera directly on a phone rather than the file picker.
              capture="environment"
              className="sr-only"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) onCapturePhoto(file);
                event.target.value = "";
              }}
            />
          </label>
        )}

        {/*
          What every photograph has actually achieved.

          Deliberately explicit: "Saved on device" and "Uploaded and verified"
          are different claims, and the driver is told which one is true. A photo
          is never described as sent because it was saved.
        */}
        {captures.length > 0 && (
          <ul className="flex flex-col gap-2" aria-label="Photos on this device">
            {captures.map((capture) => (
              <li
                key={capture.operationId}
                data-testid="rr-capture-status"
                className="rounded-[18px] bg-slate-100 px-4 py-3 text-sm"
              >
                <span className="font-black text-slate-800">{capture.title}</span>
                <span className="ml-2 font-bold text-slate-600">{capture.detail}</span>
              </li>
            ))}
          </ul>
        )}

        {/* 7. EVERYTHING ELSE — subordinate by construction. */}
        <div className="flex flex-wrap gap-2">
          <a
            href={navigateHref(job)}
            target="_blank"
            rel="noreferrer"
            className="vyron-focus-ring inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-2xl border border-slate-200 px-4 text-sm font-black text-slate-700"
          >
            <Navigation className="h-4 w-4" aria-hidden="true" />
            Navigate
          </a>
          {controlRoomNumber && (
            <a
              href={`tel:${controlRoomNumber}`}
              className="vyron-focus-ring inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-2xl border border-slate-200 px-4 text-sm font-black text-slate-700"
            >
              <Phone className="h-4 w-4" aria-hidden="true" />
              Call control
            </a>
          )}
        </div>

        {next.secondary.length > 0 && (
          <div>
            <button
              type="button"
              onClick={() => setShowDetail((open) => !open)}
              aria-expanded={showDetail}
              className="vyron-focus-ring flex min-h-11 w-full items-center justify-center gap-1 rounded-2xl text-sm font-black text-slate-500"
            >
              {showDetail ? "Fewer options" : "More options"}
              <ChevronDown className={`h-4 w-4 transition ${showDetail ? "rotate-180" : ""}`} aria-hidden="true" />
            </button>

            {showDetail && (
              <div className="mt-2 space-y-2">
                {next.secondary
                  .filter((action) => action.kind !== "navigate" && action.kind !== "call_control_room")
                  .map((action) => (
                    <button
                      key={action.kind}
                      type="button"
                      disabled={busy}
                      onClick={() => onAction(action.kind)}
                      className={`vyron-focus-ring min-h-12 w-full rounded-2xl border px-4 text-sm font-black disabled:opacity-60 ${
                        action.tone === "danger"
                          ? "border-rose-200 bg-rose-50 text-rose-700"
                          : "border-slate-200 bg-white text-slate-700"
                      }`}
                    >
                      {action.label}
                    </button>
                  ))}
                {job.scene_description && (
                  <p className="rounded-2xl bg-slate-50 p-3 text-sm leading-6 text-slate-600">
                    {job.scene_description}
                  </p>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </article>
  );
}

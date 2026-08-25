"use client";

/**
 * Reporting an incident, in as few taps as the facts allow.
 *
 * THE CONSTRAINT THAT SHAPES EVERYTHING
 *
 *   This is used at the moment something has gone wrong. The employee may be
 *   shaken, wearing gloves, in the rain, or standing next to somebody who is
 *   hurt. So: taps not typing, one question per screen, the two questions that
 *   summon help asked FIRST, and the draft on disk from the first answer so
 *   nothing is ever lost.
 *
 * WHY DANGER AND EMERGENCY COME BEFORE THE DESCRIPTION
 *
 *   A control room can act on "somebody is still in danger at this location"
 *   without knowing anything else. Making that the last field, after a
 *   paragraph of prose, would delay the only part that is time-critical.
 *
 * WHAT IS NEVER CLAIMED
 *
 *   "Submitted" appears only when the server has confirmed. Until then the
 *   employee is told the truth: it is saved on this device and will send itself.
 */

import React, { useCallback, useEffect, useState } from "react";
import { Camera, Check, ChevronLeft, MapPin, X } from "lucide-react";
import {
  canSubmit,
  discardDraft,
  missingFromDraft,
  newDraft,
  saveDraft,
  submitDraft,
  type RrIncidentDraft,
} from "@/lib/mobile/incident-drafts";
import {
  RR_INCIDENT_CATEGORIES,
  RR_INCIDENT_CATEGORY_LABELS,
  RR_INCIDENT_SEVERITIES,
  RR_INCIDENT_SEVERITY_LABELS,
  type RrIncidentCategory,
  type RrIncidentSeverity,
} from "@/lib/mobile/incidents";
import { capturePhoto, currentPosition } from "@/lib/mobile/bridge";
import { captureEvidence, uploadEvidence } from "@/lib/road-recovery/evidence-queue";
import { getSupabaseBrowserClient } from "@/lib/supabase";

type Step = "urgent" | "category" | "severity" | "what" | "review" | "done";

export default function IncidentReporter({
  companyId,
  online,
  onClose,
}: {
  companyId: string;
  online: boolean;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<RrIncidentDraft>(() => newDraft(companyId));
  const [step, setStep] = useState<Step>("urgent");
  const [photos, setPhotos] = useState<{ operationId: string; bytes: number }[]>([]);
  const [busy, setBusy] = useState(false);
  const [locating, setLocating] = useState(true);

  /** Every change is persisted immediately; a killed app must lose nothing. */
  const update = useCallback(async (changes: Partial<RrIncidentDraft>) => {
    setDraft((current) => {
      const next = { ...current, ...changes };
      void saveDraft(next);
      return next;
    });
  }, []);

  /**
   * Position is taken once, in the background, as soon as the form opens.
   *
   * Never fabricated: if the device cannot produce a fix the incident is filed
   * without one and says so, rather than recording a guess that would later be
   * read as evidence.
   */
  useEffect(() => {
    let cancelled = false;
    // Kicked off in an async callback rather than the effect body: setting state
    // synchronously there cascades renders, and the answer is not available
    // synchronously anyway.
    const locate = async () => {
      const position = await currentPosition();
      if (cancelled) return;
      setLocating(false);
      if (!position) return;
      void update({
        latitude: position.latitude,
        longitude: position.longitude,
        gpsAccuracy: position.accuracy,
        occurredAt: new Date(position.capturedAt).toISOString(),
      });
    };
    void locate();
    return () => { cancelled = true; };
  }, [update]);

  const uploader = useCallback(
    async (path: string, blob: Blob, contentType: string) => {
      const { error } = await getSupabaseBrowserClient()
        .storage.from("rr-evidence")
        .upload(path, blob, { contentType, upsert: false });
      if (!error) return { ok: true } as const;
      const already = /exist/i.test(error.message || "");
      return { ok: false as const, error: error.message || "Upload failed.", alreadyExists: already };
    },
    []
  );

  /**
   * A photograph goes onto the device first, exactly like Road & Recovery
   * evidence — the same queue, the same lifecycle, the same guarantee that
   * "uploaded" is never claimed before the server has it.
   */
  const addPhoto = useCallback(
    async (file?: File | null) => {
      const captured = await capturePhoto(file);
      if (!captured) return;
      const record = await captureEvidence({
        blob: captured.blob,
        companyId,
        // Incident photographs hang off the incident, not a service job — so the
        // queue is told where to file the row and where to put the bytes. Same
        // queue, same lifecycle, different destination.
        serviceJobId: draft.incidentId,
        evidenceType: "incident",
        uploadRoute: `/api/mobile/incidents/${draft.incidentId}/evidence`,
        storagePrefix: `${companyId}/incidents/${draft.incidentId}`,
        latitude: draft.latitude,
        longitude: draft.longitude,
        accuracy: draft.gpsAccuracy,
        metadata: { incidentId: draft.incidentId, source: captured.source },
      });
      setPhotos((current) => [...current, { operationId: record.operationId, bytes: record.byteSize }]);
      void update({ photoOperationIds: [...draft.photoOperationIds, record.operationId] });
      if (online) void uploadEvidence(record.operationId, uploader);
    },
    [companyId, draft.incidentId, draft.photoOperationIds, draft.latitude, draft.longitude, draft.gpsAccuracy, online, update, uploader]
  );

  const removePhoto = (operationId: string) => {
    setPhotos((current) => current.filter((p) => p.operationId !== operationId));
    void update({ photoOperationIds: draft.photoOperationIds.filter((id) => id !== operationId) });
  };

  async function submit() {
    setBusy(true);
    try {
      await submitDraft(draft);
      setStep("done");
    } finally {
      setBusy(false);
    }
  }

  /* ── The steps ──────────────────────────────────────────────────────────── */

  if (step === "done") {
    return (
      <div className="flex flex-col items-center gap-4 rounded-[28px] bg-white px-6 py-10 text-center">
        <span className="flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100">
          <Check className="h-8 w-8 text-emerald-700" aria-hidden="true" />
        </span>
        <p className="text-lg font-black text-slate-900">Report saved</p>
        <p className="text-sm font-bold text-slate-600" data-testid="incident-outcome">
          {online
            ? "It is saved on this device and is being sent to the control room now."
            : "It is saved on this device and will be sent automatically when you have signal."}
        </p>
        <button
          type="button"
          onClick={onClose}
          className="vyron-focus-ring mt-2 min-h-14 w-full rounded-[22px] bg-slate-900 text-base font-black text-white"
        >
          Done
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={onClose}
          className="vyron-focus-ring flex min-h-11 items-center gap-1 text-sm font-black text-slate-600"
        >
          <ChevronLeft className="h-5 w-5" aria-hidden="true" /> Cancel
        </button>
        <span className="text-[11px] font-black uppercase tracking-wide text-slate-400">
          Saved on this device
        </span>
      </div>

      {step === "urgent" && (
        <Step title="Is anyone in danger right now?">
          <BigChoice
            label="No — nobody is in danger"
            tone="calm"
            onClick={() => { void update({ immediateDanger: false }); setStep("category"); }}
          />
          <BigChoice
            label="Yes — somebody is still in danger"
            tone="danger"
            testId="incident-danger-yes"
            onClick={() => { void update({ immediateDanger: true }); setStep("category"); }}
          />
          <BigChoice
            label="Yes — send emergency services"
            tone="danger"
            testId="incident-emergency-yes"
            onClick={() => {
              void update({ immediateDanger: true, emergencyRequired: true });
              setStep("category");
            }}
          />
        </Step>
      )}

      {step === "category" && (
        <Step title="What kind of incident?">
          {RR_INCIDENT_CATEGORIES.map((category) => (
            <BigChoice
              key={category}
              label={RR_INCIDENT_CATEGORY_LABELS[category as RrIncidentCategory]}
              tone="calm"
              testId={`incident-category-${category}`}
              onClick={() => { void update({ category }); setStep("severity"); }}
            />
          ))}
        </Step>
      )}

      {step === "severity" && (
        <Step title="How serious is it?">
          {RR_INCIDENT_SEVERITIES.map((severity) => (
            <BigChoice
              key={severity}
              label={RR_INCIDENT_SEVERITY_LABELS[severity as RrIncidentSeverity]}
              tone={severity === "critical" || severity === "high" ? "danger" : "calm"}
              testId={`incident-severity-${severity}`}
              onClick={() => { void update({ severity }); setStep("what"); }}
            />
          ))}
        </Step>
      )}

      {step === "what" && (
        <Step title="What happened?">
          <textarea
            value={draft.description}
            onChange={(event) => void update({ description: event.target.value })}
            placeholder="A few words is enough."
            rows={4}
            data-testid="incident-description"
            className="vyron-focus-ring w-full rounded-[22px] border-2 border-slate-200 p-4 text-base font-semibold"
          />
          <input
            value={draft.peopleInvolved}
            onChange={(event) => void update({ peopleInvolved: event.target.value })}
            placeholder="Anyone else involved? (optional)"
            className="vyron-focus-ring min-h-14 w-full rounded-[22px] border-2 border-slate-200 px-4 text-base font-semibold"
          />

          <label className="vyron-focus-ring flex min-h-14 w-full cursor-pointer items-center justify-center gap-2 rounded-[22px] border-2 border-dashed border-slate-300 text-base font-black text-slate-700">
            <Camera className="h-5 w-5" aria-hidden="true" />
            Add a photo
            <input
              type="file"
              accept="image/*"
              capture="environment"
              className="sr-only"
              data-testid="incident-camera"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void addPhoto(file);
                event.target.value = "";
              }}
            />
          </label>

          {photos.length > 0 && (
            <ul className="flex flex-col gap-2" aria-label="Photos on this device">
              {photos.map((photo, index) => (
                <li
                  key={photo.operationId}
                  data-testid="incident-photo"
                  className="flex items-center justify-between rounded-[18px] bg-slate-100 px-4 py-3"
                >
                  <span className="text-sm font-black text-slate-800">
                    Photo {index + 1} · saved on device
                  </span>
                  <button
                    type="button"
                    onClick={() => removePhoto(photo.operationId)}
                    aria-label={`Remove photo ${index + 1}`}
                    className="vyron-focus-ring rounded-full p-2 text-slate-500"
                  >
                    <X className="h-4 w-4" aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ul>
          )}

          <button
            type="button"
            onClick={() => setStep("review")}
            disabled={!draft.description.trim()}
            className="vyron-focus-ring min-h-14 w-full rounded-[22px] bg-slate-900 text-base font-black text-white disabled:opacity-40"
          >
            Continue
          </button>
        </Step>
      )}

      {step === "review" && (
        <Step title="Send this report?">
          <dl className="rounded-[22px] bg-white px-4 py-3 text-sm">
            <Row label="Danger" value={draft.emergencyRequired ? "Emergency services requested" : draft.immediateDanger ? "Somebody still in danger" : "Nobody in danger"} />
            <Row label="Kind" value={draft.category ? RR_INCIDENT_CATEGORY_LABELS[draft.category as RrIncidentCategory] : "—"} />
            <Row label="Serious" value={draft.severity ? RR_INCIDENT_SEVERITY_LABELS[draft.severity as RrIncidentSeverity] : "—"} />
            <Row label="What happened" value={draft.description} />
            <Row label="Photos" value={photos.length === 0 ? "None" : `${photos.length} on this device`} />
            <Row
              label="Location"
              value={
                draft.latitude !== null
                  ? `Recorded${draft.gpsAccuracy ? ` (±${Math.round(draft.gpsAccuracy)}m)` : ""}`
                  : locating
                    ? "Still looking…"
                    : "Not available on this device"
              }
            />
          </dl>

          {draft.latitude === null && !locating && (
            <p className="flex items-start gap-2 rounded-[22px] bg-amber-50 px-4 py-3 text-xs font-bold text-amber-900">
              <MapPin className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              Your location could not be read. The report will be sent without it rather than guessing
              where you are.
            </p>
          )}

          {!canSubmit(draft) && (
            <p className="rounded-[22px] bg-slate-100 px-4 py-3 text-xs font-bold text-slate-700">
              Still needed: {missingFromDraft(draft).join(", ")}.
            </p>
          )}

          <button
            type="button"
            onClick={() => void submit()}
            disabled={busy || !canSubmit(draft)}
            data-testid="incident-submit"
            className="vyron-focus-ring min-h-16 w-full rounded-[24px] bg-rose-600 text-lg font-black text-white disabled:opacity-40"
          >
            {busy ? "Saving…" : "Send report"}
          </button>
          <button
            type="button"
            onClick={() => { void discardDraft(draft.incidentId); onClose(); }}
            className="vyron-focus-ring min-h-12 w-full rounded-[22px] text-sm font-black text-slate-500"
          >
            Discard this report
          </button>
        </Step>
      )}
    </div>
  );
}

function Step({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-xl font-black leading-tight text-slate-900">{title}</h2>
      {children}
    </section>
  );
}

function BigChoice({
  label,
  tone,
  onClick,
  testId,
}: {
  label: string;
  tone: "calm" | "danger";
  onClick: () => void;
  testId?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-testid={testId}
      className={`vyron-focus-ring min-h-16 w-full rounded-[24px] px-5 text-left text-base font-black ${
        tone === "danger" ? "bg-rose-600 text-white" : "bg-white text-slate-900"
      }`}
    >
      {label}
    </button>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4 border-b border-slate-100 py-2 last:border-0">
      <dt className="shrink-0 font-bold text-slate-500">{label}</dt>
      <dd className="text-right font-black text-slate-900">{value}</dd>
    </div>
  );
}

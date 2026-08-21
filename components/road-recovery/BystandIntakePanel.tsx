"use client";

/**
 * BYSTAND attendance intake (Operator Completion).
 *
 * Separate from the tow intake on purpose, and posting to a separate endpoint. A BYSTAND
 * attendance takes no vehicle anywhere, so it has no destination — the endpoint refuses
 * destination fields and `rr_service_jobs_bystand_no_destination` refuses them again at
 * the database. What it does have, and a tow does not, is a REASON: why someone is being
 * asked to stand at a scene. That reason is what the attendance bills against, so it is
 * captured here rather than left to be filled in afterwards.
 */

import React, { useEffect, useState } from "react";
import { rrFetchJson } from "@/lib/road-recovery/use-rr-poll";

const inputClass =
  "mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-900";

function Field({ label, children, wide = false }: { label: string; children: React.ReactNode; wide?: boolean }) {
  return (
    <label className={`text-xs font-bold text-slate-600 ${wide ? "sm:col-span-2" : ""}`}>
      {label}
      {children}
    </label>
  );
}

export default function BystandIntakePanel({
  companyId,
  reasons,
  onCreated,
  onClose,
}: {
  companyId: string;
  reasons: { id: string; reason_code: string; label: string }[];
  onCreated: (result: { serviceJobId: string; jobRef: string }) => void;
  onClose: () => void;
}) {
  const [counterparties, setCounterparties] = useState<{ id: string; legal_name: string }[]>([]);
  const [title, setTitle] = useState("");
  const [counterpartyId, setCounterpartyId] = useState("");
  // Empty means "not chosen yet"; the first reason stands in until the controller picks
  // one. Derived during render rather than seeded by an effect, so the list arriving
  // late cannot leave the select showing a value the state does not hold.
  const [chosenReasonId, setChosenReasonId] = useState("");
  const reasonCodeId = chosenReasonId || reasons[0]?.id || "";
  const [reasonDetail, setReasonDetail] = useState("");
  const [requestedByName, setRequestedByName] = useState("");
  const [requestedByContact, setRequestedByContact] = useState("");
  const [requestingAuthority, setRequestingAuthority] = useState("");
  const [authorityOnScene, setAuthorityOnScene] = useState("");
  const [registration, setRegistration] = useState("");
  const [make, setMake] = useState("");
  const [model, setModel] = useState("");
  const [originLabel, setOriginLabel] = useState("");
  const [originAddress, setOriginAddress] = useState("");
  const [originLat, setOriginLat] = useState("");
  const [originLng, setOriginLng] = useState("");
  const [incidentAt, setIncidentAt] = useState("");
  const [sceneDescription, setSceneDescription] = useState("");
  const [priority, setPriority] = useState("high");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const result = await rrFetchJson<{ counterparties: { id: string; legal_name: string }[] }>(
          `/api/road-recovery/counterparties?companyId=${encodeURIComponent(companyId)}`
        );
        if (!cancelled) setCounterparties(result.counterparties || []);
      } catch {
        // A missing counterparty list must not block logging an attendance — the field
        // is optional, and the scene is still happening.
        if (!cancelled) setCounterparties([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [companyId]);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const result = await rrFetchJson<{ serviceJobId: string; jobRef: string }>(
        "/api/road-recovery/bystand/jobs",
        {
          method: "POST",
          body: JSON.stringify({
            companyId,
            title: title.trim(),
            counterpartyId: counterpartyId || null,
            incidentAt: incidentAt ? new Date(incidentAt).toISOString() : null,
            sceneDescription: sceneDescription.trim() || null,
            originLabel: originLabel.trim() || null,
            originAddress: originAddress.trim() || null,
            originLatitude: originLat.trim() === "" ? null : Number(originLat),
            originLongitude: originLng.trim() === "" ? null : Number(originLng),
            vehicleRegistration: registration.trim().toUpperCase() || null,
            vehicleMake: make.trim() || null,
            vehicleModel: model.trim() || null,
            priority,
            reasonCodeId: reasonCodeId || null,
            reasonDetail: reasonDetail.trim() || null,
            requestedByName: requestedByName.trim() || null,
            requestedByContact: requestedByContact.trim() || null,
            requestingAuthority: requestingAuthority.trim() || null,
            authorityOnScene: authorityOnScene.trim() || null,
          }),
        }
      );
      onCreated(result);
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : "Could not log the attendance.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-3xl border border-slate-300 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-black text-slate-900">Log a BYSTAND attendance</h2>
          <p className="mt-1 text-xs font-semibold text-slate-500">
            No destination: an attendance moves nothing. Standing time starts when the
            driver begins standing by on scene, not when this is logged.
          </p>
        </div>
        <button onClick={onClose} className="text-xs font-bold text-slate-500 hover:text-slate-800">
          Cancel
        </button>
      </div>

      {error ? (
        <p className="mt-3 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-800">
          {error}
        </p>
      ) : null}

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <Field label="Attendance title" wide>
          <input
            aria-label="Attendance title"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="BYSTAND — accident scene, M3 southbound"
            className={inputClass}
          />
        </Field>

        <Field label="Reason">
          <select
            aria-label="Reason"
            value={reasonCodeId}
            onChange={(event) => setChosenReasonId(event.target.value)}
            className={inputClass}
          >
            {reasons.map((reason) => (
              <option key={reason.id} value={reason.id}>
                {reason.label}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Priority">
          <select
            aria-label="Priority"
            value={priority}
            onChange={(event) => setPriority(event.target.value)}
            className={inputClass}
          >
            {["low", "normal", "high", "urgent"].map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Reason detail" wide>
          <input
            aria-label="Reason detail"
            value={reasonDetail}
            onChange={(event) => setReasonDetail(event.target.value)}
            placeholder="SAPS en route to take a statement."
            className={inputClass}
          />
        </Field>

        <Field label="Bill to">
          <select
            aria-label="Bill to"
            value={counterpartyId}
            onChange={(event) => setCounterpartyId(event.target.value)}
            className={inputClass}
          >
            <option value="">Not recorded</option>
            {counterparties.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.legal_name}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Requesting authority">
          <input
            aria-label="Requesting authority"
            value={requestingAuthority}
            onChange={(event) => setRequestingAuthority(event.target.value)}
            placeholder="SAPS Wynberg"
            className={inputClass}
          />
        </Field>

        <Field label="Requested by">
          <input
            aria-label="Requested by"
            value={requestedByName}
            onChange={(event) => setRequestedByName(event.target.value)}
            className={inputClass}
          />
        </Field>

        <Field label="Their contact">
          <input
            aria-label="Their contact"
            value={requestedByContact}
            onChange={(event) => setRequestedByContact(event.target.value)}
            className={inputClass}
          />
        </Field>

        <Field label="Authority on scene" wide>
          <input
            aria-label="Authority on scene"
            value={authorityOnScene}
            onChange={(event) => setAuthorityOnScene(event.target.value)}
            placeholder="Who is in charge of the scene when the driver arrives."
            className={inputClass}
          />
        </Field>

        <Field label="Vehicle registration">
          <input
            aria-label="Vehicle registration"
            value={registration}
            onChange={(event) => setRegistration(event.target.value)}
            className={inputClass}
          />
        </Field>

        <Field label="Make">
          <input aria-label="Make" value={make} onChange={(event) => setMake(event.target.value)} className={inputClass} />
        </Field>

        <Field label="Model">
          <input aria-label="Model" value={model} onChange={(event) => setModel(event.target.value)} className={inputClass} />
        </Field>

        <Field label="Incident time">
          <input
            aria-label="Incident time"
            type="datetime-local"
            value={incidentAt}
            onChange={(event) => setIncidentAt(event.target.value)}
            className={inputClass}
          />
        </Field>

        <Field label="Scene" wide>
          <input
            aria-label="Scene"
            value={originLabel}
            onChange={(event) => setOriginLabel(event.target.value)}
            placeholder="M3 Southbound, Cape Town"
            className={inputClass}
          />
        </Field>

        <Field label="Scene address" wide>
          <input
            aria-label="Scene address"
            value={originAddress}
            onChange={(event) => setOriginAddress(event.target.value)}
            className={inputClass}
          />
        </Field>

        <Field label="Scene latitude">
          <input
            aria-label="Scene latitude"
            value={originLat}
            onChange={(event) => setOriginLat(event.target.value)}
            inputMode="decimal"
            placeholder="-33.9249"
            className={inputClass}
          />
        </Field>

        <Field label="Scene longitude">
          <input
            aria-label="Scene longitude"
            value={originLng}
            onChange={(event) => setOriginLng(event.target.value)}
            inputMode="decimal"
            placeholder="18.4241"
            className={inputClass}
          />
        </Field>

        <Field label="Notes" wide>
          <textarea
            aria-label="Notes"
            value={sceneDescription}
            onChange={(event) => setSceneDescription(event.target.value)}
            rows={3}
            className={inputClass}
          />
        </Field>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={submit}
          disabled={busy || !title.trim()}
          className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-bold text-cyan-300 disabled:opacity-40"
        >
          {busy ? "Logging…" : "Log attendance"}
        </button>
        <button
          type="button"
          onClick={onClose}
          className="rounded-xl bg-slate-200 px-4 py-2 text-sm font-bold text-slate-700"
        >
          Cancel
        </button>
      </div>
    </section>
  );
}

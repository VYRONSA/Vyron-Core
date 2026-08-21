"use client";

/**
 * Controller job intake (Operator Completion).
 *
 * The Dispatch Board could advance work but nothing could put work into it: POST
 * /api/road-recovery/jobs existed and was tested, and no screen called it. This is that
 * screen, and nothing more — it creates NO job model of its own. It posts the documented
 * fields to the existing endpoint, which resolves the workflow, resolves the creation
 * state, snapshots the requirement policy and writes field_jobs + rr_service_jobs.
 *
 * Which fields are shown is driven by RR_SERVICE_CATALOGUE, not by a list kept here: a
 * service that declares `requiresDestination: false` (roadside assistance) does not ask
 * for one, and a service that declares `requiresAuthorisation` tells the controller what
 * has to happen next. BYSTAND is deliberately absent — it has its own board and its own
 * intake, because it moves nothing and bills standing time.
 */

import React, { useMemo, useState } from "react";
import { rrFetchJson } from "@/lib/road-recovery/use-rr-poll";
import {
  RR_DESTINATION_TYPES,
  findServiceType,
} from "@/lib/road-recovery/service-types";

export type IntakeServiceType = { id: string; service_code: string; name: string };
export type IntakeCounterparty = { id: string; legal_name: string };

const PRIORITIES = ["low", "normal", "high", "urgent"] as const;

function Field({
  label,
  hint,
  children,
  wide = false,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
  wide?: boolean;
}) {
  return (
    <label className={`text-xs font-bold text-slate-600 ${wide ? "sm:col-span-2" : ""}`}>
      {label}
      {children}
      {hint ? <span className="mt-1 block text-[11px] font-semibold text-slate-400">{hint}</span> : null}
    </label>
  );
}

const inputClass =
  "mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-900";

export default function JobIntakePanel({
  companyId,
  serviceTypes,
  counterparties,
  onCreated,
  onClose,
}: {
  companyId: string;
  serviceTypes: IntakeServiceType[];
  counterparties: IntakeCounterparty[];
  onCreated: (result: { serviceJobId: string; jobRef: string; requirementCount: number }) => void;
  onClose: () => void;
}) {
  // BYSTAND keeps its own board and its own intake. Filtering on the catalogue's own
  // workflowKey rather than on the service code means a future BYSTAND service type is
  // excluded automatically.
  const options = useMemo(
    () =>
      serviceTypes
        .filter((type) => findServiceType(type.service_code)?.workflowKey !== "bystand")
        .sort((a, b) => a.name.localeCompare(b.name)),
    [serviceTypes]
  );

  const [serviceCode, setServiceCode] = useState(options[0]?.service_code || "");
  const definition = findServiceType(serviceCode);

  const [title, setTitle] = useState("");
  const [counterpartyId, setCounterpartyId] = useState("");
  const [reportedBy, setReportedBy] = useState("");
  const [incidentAt, setIncidentAt] = useState("");
  const [sceneDescription, setSceneDescription] = useState("");

  const [registration, setRegistration] = useState("");
  const [make, setMake] = useState("");
  const [model, setModel] = useState("");
  const [drivable, setDrivable] = useState("unknown");

  const [originLabel, setOriginLabel] = useState("");
  const [originAddress, setOriginAddress] = useState("");
  const [originLat, setOriginLat] = useState("");
  const [originLng, setOriginLng] = useState("");

  const [destinationType, setDestinationType] = useState("");
  const [destinationLabel, setDestinationLabel] = useState("");
  const [destinationAddress, setDestinationAddress] = useState("");

  const [priority, setPriority] = useState<string>("high");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit = Boolean(serviceCode && title.trim() && !busy);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const payload: Record<string, unknown> = {
        companyId,
        serviceCode,
        title: title.trim(),
        counterpartyId: counterpartyId || null,
        reportedBy: reportedBy.trim() || null,
        incidentAt: incidentAt ? new Date(incidentAt).toISOString() : null,
        sceneDescription: sceneDescription.trim() || null,
        originLabel: originLabel.trim() || null,
        originAddress: originAddress.trim() || null,
        originLatitude: originLat.trim() === "" ? null : Number(originLat),
        originLongitude: originLng.trim() === "" ? null : Number(originLng),
        vehicleRegistration: registration.trim().toUpperCase() || null,
        vehicleMake: make.trim() || null,
        vehicleModel: model.trim() || null,
        // Tri-state on purpose: "not recorded" is a different fact from "not drivable",
        // and the column is nullable precisely so the difference survives.
        vehicleIsDrivable: drivable === "unknown" ? null : drivable === "yes",
        priority,
      };

      if (definition?.requiresDestination) {
        payload.destinationType = destinationType || null;
        payload.destinationLabel = destinationLabel.trim() || null;
        payload.destinationAddress = destinationAddress.trim() || null;
      }

      const result = await rrFetchJson<{
        serviceJobId: string;
        jobRef: string;
        requirementCount: number;
      }>("/api/road-recovery/jobs", { method: "POST", body: JSON.stringify(payload) });

      onCreated(result);
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : "Could not create the job.");
    } finally {
      setBusy(false);
    }
  }

  if (options.length === 0) {
    return (
      <section className="rounded-3xl border border-amber-300 bg-amber-50 p-5">
        <h2 className="text-sm font-black text-amber-900">No service catalogue</h2>
        <p className="mt-1 text-xs font-semibold text-amber-800">
          This company has no Road &amp; Recovery service types. Enable the module for the
          customer so provisioning can seed the catalogue, then reload.
        </p>
        <button onClick={onClose} className="mt-3 rounded-xl bg-white px-3 py-1.5 text-xs font-bold text-slate-700">
          Close
        </button>
      </section>
    );
  }

  return (
    <section className="rounded-3xl border border-slate-300 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-black text-slate-900">Log a job</h2>
          <p className="mt-1 text-xs font-semibold text-slate-500">
            Creates the field job and its Road &amp; Recovery extension, resolves the workflow
            and snapshots the requirements this job will have to produce.
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
        <Field label="Service">
          <select
            aria-label="Service"
            value={serviceCode}
            onChange={(event) => setServiceCode(event.target.value)}
            className={inputClass}
          >
            {options.map((type) => (
              <option key={type.id} value={type.service_code}>
                {type.name}
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
            {PRIORITIES.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Job title" wide hint="What a controller will recognise this job by on the board.">
          <input
            aria-label="Job title"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Tow-in — breakdown on the N1"
            className={inputClass}
          />
        </Field>

        <Field
          label="Bill to"
          hint={
            definition?.requiresAuthorisation
              ? "This service needs an authorisation from the counterparty before it can be dispatched."
              : "Optional."
          }
        >
          <select
            aria-label="Bill to"
            value={counterpartyId}
            onChange={(event) => setCounterpartyId(event.target.value)}
            className={inputClass}
          >
            <option value="">Not recorded</option>
            {counterparties.map((party) => (
              <option key={party.id} value={party.id}>
                {party.legal_name}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Reported by" hint="Who called it in, and on what number.">
          <input
            aria-label="Reported by"
            value={reportedBy}
            onChange={(event) => setReportedBy(event.target.value)}
            placeholder="Control room · 082 000 0000"
            className={inputClass}
          />
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

        <Field label="Vehicle registration">
          <input
            aria-label="Vehicle registration"
            value={registration}
            onChange={(event) => setRegistration(event.target.value)}
            placeholder="CA 123-456"
            className={inputClass}
          />
        </Field>

        <Field label="Make">
          <input aria-label="Make" value={make} onChange={(event) => setMake(event.target.value)} className={inputClass} />
        </Field>

        <Field label="Model">
          <input aria-label="Model" value={model} onChange={(event) => setModel(event.target.value)} className={inputClass} />
        </Field>

        <Field label="Drivable">
          <select
            aria-label="Drivable"
            value={drivable}
            onChange={(event) => setDrivable(event.target.value)}
            className={inputClass}
          >
            <option value="unknown">Not recorded</option>
            <option value="yes">Drivable</option>
            <option value="no">Not drivable</option>
          </select>
        </Field>

        <Field label="Scene" wide hint="Where the vehicle is now.">
          <input
            aria-label="Scene"
            value={originLabel}
            onChange={(event) => setOriginLabel(event.target.value)}
            placeholder="N1 North, Brackenfell"
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

        <Field
          label="Scene latitude"
          hint="Needed for GPS-verified arrival and for distance-based dispatch scoring."
        >
          <input
            aria-label="Scene latitude"
            value={originLat}
            onChange={(event) => setOriginLat(event.target.value)}
            inputMode="decimal"
            placeholder="-33.8720"
            className={inputClass}
          />
        </Field>

        <Field label="Scene longitude">
          <input
            aria-label="Scene longitude"
            value={originLng}
            onChange={(event) => setOriginLng(event.target.value)}
            inputMode="decimal"
            placeholder="18.6980"
            className={inputClass}
          />
        </Field>

        {definition?.requiresDestination ? (
          <>
            <Field label="Destination type">
              <select
                aria-label="Destination type"
                value={destinationType}
                onChange={(event) => setDestinationType(event.target.value)}
                className={inputClass}
              >
                <option value="">Not recorded</option>
                {RR_DESTINATION_TYPES.map((value) => (
                  <option key={value} value={value}>
                    {value.replace(/_/g, " ")}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="Destination">
              <input
                aria-label="Destination"
                value={destinationLabel}
                onChange={(event) => setDestinationLabel(event.target.value)}
                placeholder="Alpha Main Yard"
                className={inputClass}
              />
            </Field>

            <Field label="Destination address" wide>
              <input
                aria-label="Destination address"
                value={destinationAddress}
                onChange={(event) => setDestinationAddress(event.target.value)}
                className={inputClass}
              />
            </Field>
          </>
        ) : null}

        <Field label="Notes" wide hint="What the crew needs to know before they arrive.">
          <textarea
            aria-label="Notes"
            value={sceneDescription}
            onChange={(event) => setSceneDescription(event.target.value)}
            rows={3}
            placeholder="Vehicle in the yellow lane, hazards on, occupants behind the barrier."
            className={inputClass}
          />
        </Field>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={submit}
          disabled={!canSubmit}
          className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-bold text-cyan-300 disabled:opacity-40"
        >
          {busy ? "Creating…" : "Create job"}
        </button>
        <button
          type="button"
          onClick={onClose}
          className="rounded-xl bg-slate-200 px-4 py-2 text-sm font-bold text-slate-700"
        >
          Cancel
        </button>
        {definition ? (
          <span className="text-xs font-semibold text-slate-500">
            {definition.name} runs the <strong>{definition.workflowKey.replace(/_/g, " ")}</strong> workflow.
          </span>
        ) : null}
      </div>
    </section>
  );
}

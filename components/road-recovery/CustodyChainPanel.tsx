"use client";

/**
 * Chain of custody panel (Phase 4).
 *
 * Shows WHO has possessed the vehicle, when, where, and who received it — the record a
 * recovery operator needs when possession is disputed. Deliberately separate from the
 * job's destination, which answers a different question entirely.
 *
 * The event log is displayed in order and never as something editable: a correction is a
 * new event, so the UI offers "record an event", never "edit".
 */

import { RREmptyState, RRLaneEmpty, RRLoading } from "@/components/road-recovery/ui";
import React, { useCallback, useMemo, useState } from "react";
import { captureEvidence } from "@/lib/road-recovery/evidence-capture";
import { RR_POLL_INTERVALS, rrFetchJson, useRrPoll } from "@/lib/road-recovery/use-rr-poll";

type CustodyEvent = {
  id: string;
  event_type: string;
  occurred_at: string;
  actor_email: string;
  actor_role: string;
  holder_type: string;
  holder_name: string;
  yard_id: string | null;
  receiving_party_name: string | null;
  receiving_party_capacity: string | null;
  receiving_party_id_number: string | null;
  location_label: string | null;
  latitude: number | null;
  longitude: number | null;
  authority_id: string | null;
  reason: string | null;
  notes: string | null;
};

type Holding = {
  holder_type: string;
  holder_name: string;
  yard_id: string | null;
  released: boolean;
  since: string;
  event_count: number;
} | null;

type CustodyItem = {
  id: string;
  item_type: string;
  description: string;
  quantity: number;
  item_condition: string | null;
  received_at: string;
  handed_over_at: string | null;
  handed_over_to_name: string | null;
  handed_over_to_capacity: string | null;
};

type CustodyPayload = {
  events: CustodyEvent[];
  holding: Holding;
  items: CustodyItem[];
  eventTypes: string[];
  holderTypes: string[];
};

type Yard = { id: string; name: string; yard_code: string };

const EVENT_TONE: Record<string, string> = {
  taken: "bg-cyan-100 text-cyan-900",
  transferred: "bg-slate-200 text-slate-800",
  released: "bg-emerald-200 text-emerald-900",
  disputed: "bg-rose-200 text-rose-900",
};

export default function CustodyChainPanel({
  companyId,
  serviceJobId,
}: {
  companyId: string;
  serviceJobId: string;
}) {
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [eventType, setEventType] = useState("taken");
  const [holderType, setHolderType] = useState("operator");
  const [holderName, setHolderName] = useState("");
  const [yardId, setYardId] = useState("");
  const [receivingName, setReceivingName] = useState("");
  const [receivingCapacity, setReceivingCapacity] = useState("");
  const [receivingId, setReceivingId] = useState("");
  const [reason, setReason] = useState("");
  const [conditionFile, setConditionFile] = useState<File | null>(null);
  const [yards, setYards] = useState<Yard[]>([]);

  const fetcher = useCallback(async () => {
    const query = `companyId=${encodeURIComponent(companyId)}`;
    const [chain, yardList] = await Promise.all([
      rrFetchJson<CustodyPayload>(`/api/road-recovery/jobs/${serviceJobId}/custody?${query}`),
      rrFetchJson<{ yards: Yard[] }>(`/api/road-recovery/yards?${query}`),
    ]);
    setYards(yardList.yards || []);
    return chain;
  }, [companyId, serviceJobId]);

  const poll = useRrPoll<CustodyPayload>(fetcher, RR_POLL_INTERVALS.liveOperations, {
    enabled: Boolean(companyId && serviceJobId),
    key: serviceJobId,
  });

  const refresh = poll.refresh;
  const yardName = useMemo(() => {
    const byId = new Map(yards.map((yard) => [yard.id, yard.name]));
    return (id: string | null) => (id ? byId.get(id) || id : null);
  }, [yards]);

  const submit = useCallback(async () => {
    setBusy(true);
    setActionError(null);
    try {
      /**
       * The photograph is captured FIRST and the custody event points at it.
       *
       * rr_custody_events.evidence_id has existed since sql/076 and nothing ever wrote
       * one. Capturing first means a failed upload stops the whole thing before an
       * immutable custody row is appended claiming a condition photograph that does not
       * exist — and custody events cannot be edited afterwards to correct that.
       */
      let evidenceId: string | null = null;
      if (conditionFile) {
        const captured = await captureEvidence({
          companyId,
          serviceJobId,
          file: conditionFile,
          evidenceType: "rr_custody",
          capturedByRole: "controller",
          notes: `Condition at custody ${eventType}`,
          metadata: { custodyEventType: eventType, holderType },
        });
        evidenceId = captured.evidenceId;
      }

      await rrFetchJson(`/api/road-recovery/jobs/${serviceJobId}/custody`, {
        method: "POST",
        body: JSON.stringify({
          companyId,
          eventType,
          holderType,
          holderName,
          yardId: holderType === "yard" ? yardId : null,
          receivingPartyName: receivingName || null,
          receivingPartyCapacity: receivingCapacity || null,
          receivingPartyIdNumber: receivingId || null,
          reason: reason || null,
          evidenceId,
        }),
      });
      setShowForm(false);
      setHolderName("");
      setReceivingName("");
      setReceivingCapacity("");
      setReceivingId("");
      setReason("");
      setConditionFile(null);
      refresh();
    } catch (error: unknown) {
      setActionError(
        error instanceof Error ? error.message : "Could not record the custody event."
      );
    } finally {
      setBusy(false);
    }
  }, [
    companyId,
    conditionFile,
    eventType,
    holderName,
    holderType,
    reason,
    receivingCapacity,
    receivingId,
    receivingName,
    refresh,
    serviceJobId,
    yardId,
  ]);

  if (poll.initialLoading) {
    return <RRLoading label="Loading the custody chain" />;
  }
  if (poll.error) {
    return (
      <p role="alert" className="rounded-[22px] border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-900">
        {poll.error}
      </p>
    );
  }
  if (!poll.data) return null;

  const { events, holding, items } = poll.data;

  return (
    <div className="space-y-4">
      <section className="rounded-2xl border border-slate-200 bg-white p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-bold uppercase tracking-wide text-slate-500">
              Currently held by
            </p>
            {holding ? (
              <>
                <p className="text-lg font-black text-slate-900">
                  {holding.holder_name}
                  <span className="ml-2 text-sm font-bold text-slate-500">
                    {holding.holder_type.replace(/_/g, " ")}
                  </span>
                </p>
                <p className="text-xs font-semibold text-slate-500">
                  {holding.released ? "Released — the chain has ended" : "Since"}{" "}
                  {new Date(holding.since).toLocaleString("en-ZA")} · {holding.event_count} events
                  {holding.yard_id ? ` · ${yardName(holding.yard_id)}` : ""}
                </p>
              </>
            ) : (
              <p className="text-sm font-semibold text-slate-600">
                No custody has been recorded for this job.
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={() => {
              setShowForm((current) => !current);
              setActionError(null);
            }}
            className="rounded-xl bg-slate-900 px-3 py-2 text-xs font-bold text-cyan-300 hover:bg-slate-800"
          >
            Record custody event
          </button>
        </div>
        <p className="mt-3 text-xs font-medium text-slate-400">
          Custody answers who possesses the vehicle. Where it is supposed to go is the job&apos;s
          destination, and the two are deliberately separate.
        </p>
      </section>

      {actionError ? (
        <p role="alert" className="rounded-[22px] border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-900">
          {actionError}
        </p>
      ) : null}

      {showForm ? (
        <section className="rounded-2xl border border-slate-300 bg-white p-4">
          <h4 className="text-sm font-black text-slate-900">New custody event</h4>
          <p className="mt-1 text-xs font-semibold text-slate-500">
            Appended to the log and never edited. A correction is a new event.
          </p>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <label className="text-xs font-bold text-slate-600">
              Event
              <select
                value={eventType}
                onChange={(event) => setEventType(event.target.value)}
                className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm font-semibold"
              >
                {poll.data.eventTypes.map((type) => (
                  <option key={type} value={type}>
                    {type}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs font-bold text-slate-600">
              Now held by
              <select
                value={holderType}
                onChange={(event) => setHolderType(event.target.value)}
                className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm font-semibold"
              >
                {poll.data.holderTypes.map((type) => (
                  <option key={type} value={type}>
                    {type.replace(/_/g, " ")}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs font-bold text-slate-600 sm:col-span-2">
              Holder name
              <input
                aria-label="Holder name"
                value={holderName}
                onChange={(event) => setHolderName(event.target.value)}
                className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm font-semibold"
              />
            </label>
            <label className="text-xs font-bold text-slate-600 sm:col-span-2">
              Condition photograph
              <input
                type="file"
                aria-label="Condition photograph"
                accept="image/*,application/pdf"
                capture="environment"
                onChange={(event) => setConditionFile(event.target.files?.[0] ?? null)}
                className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-semibold"
              />
              <span className="mt-1 block text-[11px] font-semibold text-slate-400">
                Optional, and the only chance to record it — a custody event is appended and
                never edited.
              </span>
            </label>
            {holderType === "yard" ? (
              <label className="text-xs font-bold text-slate-600 sm:col-span-2">
                Yard
                <select
                  value={yardId}
                  onChange={(event) => setYardId(event.target.value)}
                  className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm font-semibold"
                >
                  <option value="">Select a yard…</option>
                  {yards.map((yard) => (
                    <option key={yard.id} value={yard.id}>
                      {yard.name}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            {eventType === "released" ? (
              <>
                <label className="text-xs font-bold text-slate-600">
                  Received by
                  <input
                    value={receivingName}
                    onChange={(event) => setReceivingName(event.target.value)}
                    className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm font-semibold"
                  />
                </label>
                <label className="text-xs font-bold text-slate-600">
                  In what capacity
                  <input
                    value={receivingCapacity}
                    onChange={(event) => setReceivingCapacity(event.target.value)}
                    placeholder="registered owner, insurer assessor…"
                    className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm font-semibold"
                  />
                </label>
                <label className="text-xs font-bold text-slate-600 sm:col-span-2">
                  Identity number
                  <input
                    value={receivingId}
                    onChange={(event) => setReceivingId(event.target.value)}
                    className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm font-semibold"
                  />
                </label>
              </>
            ) : null}
            {eventType === "disputed" ? (
              <label className="text-xs font-bold text-slate-600 sm:col-span-2">
                What is disputed
                <textarea
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                  rows={2}
                  className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
                />
              </label>
            ) : null}
          </div>
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              disabled={busy || !holderName.trim()}
              onClick={submit}
              className="rounded-xl bg-slate-900 px-3 py-2 text-xs font-bold text-cyan-300 disabled:opacity-40"
            >
              {busy ? "Recording…" : "Record event"}
            </button>
            <button
              type="button"
              onClick={() => setShowForm(false)}
              className="rounded-xl bg-slate-200 px-3 py-2 text-xs font-bold text-slate-700"
            >
              Cancel
            </button>
          </div>
        </section>
      ) : null}

      {events.length > 0 ? (
        <section>
          <h4 className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-500">
            Chain of custody ({events.length})
          </h4>
          <ol className="space-y-2">
            {events.map((entry, index) => (
              <li
                key={entry.id}
                className="relative rounded-2xl border border-slate-200 bg-white p-4 pl-11"
              >
                <span className="absolute left-4 top-4 flex h-5 w-5 items-center justify-center rounded-full bg-slate-900 text-[10px] font-black text-cyan-300">
                  {index + 1}
                </span>
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${
                      EVENT_TONE[entry.event_type] || EVENT_TONE.transferred
                    }`}
                  >
                    {entry.event_type}
                  </span>
                  <p className="text-sm font-black text-slate-900">{entry.holder_name}</p>
                  <span className="text-xs font-semibold text-slate-500">
                    {entry.holder_type.replace(/_/g, " ")}
                  </span>
                </div>
                <p className="mt-1 text-xs font-semibold text-slate-500">
                  {new Date(entry.occurred_at).toLocaleString("en-ZA")} · {entry.actor_email} (
                  {entry.actor_role.replace(/_/g, " ")})
                  {entry.location_label ? ` · ${entry.location_label}` : ""}
                  {entry.yard_id ? ` · ${yardName(entry.yard_id)}` : ""}
                </p>
                {entry.receiving_party_name ? (
                  <p className="mt-2 rounded-xl bg-emerald-50 px-2.5 py-1.5 text-xs font-semibold text-emerald-900">
                    Received by {entry.receiving_party_name}
                    {entry.receiving_party_capacity ? ` (${entry.receiving_party_capacity})` : ""}
                    {entry.receiving_party_id_number ? ` · ID ${entry.receiving_party_id_number}` : ""}
                    {entry.authority_id ? " · under a recorded authority" : ""}
                  </p>
                ) : null}
                {entry.reason ? (
                  <p className="mt-2 text-xs font-semibold text-rose-800">{entry.reason}</p>
                ) : null}
              </li>
            ))}
          </ol>
        </section>
      ) : null}

      {items.length > 0 ? (
        <section className="rounded-2xl border border-slate-200 bg-white p-4">
          <h4 className="text-xs font-bold uppercase tracking-wide text-slate-500">
            Keys, documents and belongings ({items.length})
          </h4>
          <div className="mt-2 overflow-x-auto">
            <table className="w-full min-w-[560px] text-left text-xs">
              <thead className="text-slate-500">
                <tr>
                  <th className="py-1 pr-3 font-bold">Item</th>
                  <th className="py-1 pr-3 font-bold">Qty</th>
                  <th className="py-1 pr-3 font-bold">Condition</th>
                  <th className="py-1 pr-3 font-bold">Handed over to</th>
                </tr>
              </thead>
              <tbody className="font-semibold text-slate-800">
                {items.map((item) => (
                  <tr key={item.id} className="border-t border-slate-100">
                    <td className="py-1.5 pr-3">
                      {item.description}
                      <span className="block text-[11px] font-medium text-slate-400">
                        {item.item_type.replace(/_/g, " ")}
                      </span>
                    </td>
                    <td className="py-1.5 pr-3">{item.quantity}</td>
                    <td className="py-1.5 pr-3">{item.item_condition || "—"}</td>
                    <td className="py-1.5 pr-3">
                      {item.handed_over_to_name ? (
                        <>
                          {item.handed_over_to_name}
                          <span className="block text-[11px] font-medium text-slate-400">
                            {item.handed_over_to_capacity} ·{" "}
                            {item.handed_over_at
                              ? new Date(item.handed_over_at).toLocaleDateString("en-ZA")
                              : ""}
                          </span>
                        </>
                      ) : (
                        <span className="text-slate-400">still held</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
    </div>
  );
}

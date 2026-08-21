"use client";

/**
 * Controller authorisation capture (Operator Completion).
 *
 * The authorisation engine, its guard and its void path all existed and were tested;
 * nothing in the UI called them, so "Release to dispatch" answered 409 forever and the
 * Dispatch Board dead-ended at `authorised`. This panel is that missing screen.
 *
 * It records what the counterparty agreed to and nothing else. It does NOT decide whether
 * the job may proceed: `authorisation_valid` is resolved server-side in
 * transitionServiceJob() from the stored record — checked for status AND expiry — and is
 * deliberately overwritten there, so nothing this component sends can assert it. The same
 * is true of release_authorised, disposal_authorised and evidence_complete.
 *
 * An authorisation is a legal record. It is never edited and never deleted: a mistake is
 * voided with a reason and a new one is captured.
 */

import React, { useState } from "react";
import { RR_POLL_INTERVALS, rrFetchJson, useRrPoll } from "@/lib/road-recovery/use-rr-poll";

type AuthorisationRow = {
  id: string;
  authorisation_number: string;
  claim_reference: string | null;
  po_number: string | null;
  authorised_service_code: string | null;
  authorised_amount: number | null;
  authorised_by_name: string | null;
  authorised_by_contact: string | null;
  channel: string | null;
  status: string;
  expires_at: string | null;
  authorised_at: string | null;
  void_reason: string | null;
};

const CHANNELS = ["phone", "email", "portal", "whatsapp", "in_person", "system"] as const;

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

function expiryState(row: AuthorisationRow): { live: boolean; label: string } {
  if (row.status !== "active") return { live: false, label: row.status };
  if (row.expires_at && new Date(row.expires_at).getTime() < Date.now()) {
    return { live: false, label: "expired" };
  }
  return { live: true, label: "in force" };
}

export default function AuthorisationPanel({
  companyId,
  serviceJobId,
  serviceCode,
  counterpartyId,
  counterparties,
  onChanged,
  onClose,
}: {
  companyId: string;
  serviceJobId: string;
  serviceCode: string;
  counterpartyId: string | null;
  counterparties: { id: string; legal_name: string }[];
  onChanged: () => void;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [voidFor, setVoidFor] = useState<string | null>(null);
  const [voidReason, setVoidReason] = useState("");

  const [party, setParty] = useState(counterpartyId || "");
  const [number, setNumber] = useState("");
  const [claim, setClaim] = useState("");
  const [po, setPo] = useState("");
  const [amount, setAmount] = useState("");
  const [byName, setByName] = useState("");
  const [byContact, setByContact] = useState("");
  const [channel, setChannel] = useState<string>("phone");
  const [expiresAt, setExpiresAt] = useState("");

  /**
   * Read through the SAME polling helper every other Road & Recovery panel uses, keyed on
   * the job so opening a different card refetches immediately. It also means an
   * authorisation captured on another controller's screen appears here on the next tick.
   */
  const poll = useRrPoll<{ authorisations: AuthorisationRow[] }>(
    () =>
      rrFetchJson<{ authorisations: AuthorisationRow[] }>(
        `/api/road-recovery/authorisations?${new URLSearchParams({ companyId, serviceJobId }).toString()}`
      ),
    RR_POLL_INTERVALS.dispatchBoard,
    { enabled: Boolean(companyId && serviceJobId), key: serviceJobId }
  );
  const rows = poll.data?.authorisations ?? null;
  const load = poll.refresh;

  async function act(run: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await run();
      load();
      onChanged();
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : "That did not work.");
    } finally {
      setBusy(false);
    }
  }

  const record = () =>
    act(async () => {
      await rrFetchJson("/api/road-recovery/authorisations", {
        method: "POST",
        body: JSON.stringify({
          companyId,
          serviceJobId,
          counterpartyId: party,
          authorisationNumber: number.trim(),
          authorisedServiceCode: serviceCode,
          claimReference: claim.trim() || null,
          poNumber: po.trim() || null,
          authorisedAmount: amount.trim() === "" ? null : Number(amount),
          authorisedByName: byName.trim() || null,
          authorisedByContact: byContact.trim() || null,
          channel,
          // Sent as an instant so the server compares like with like when it resolves
          // authorisation_valid; a bare date would silently mean midnight UTC.
          expiresAt: expiresAt ? new Date(expiresAt).toISOString() : null,
        }),
      });
      setShowForm(false);
      setNumber("");
      setClaim("");
      setPo("");
      setAmount("");
      setByName("");
      setByContact("");
      setExpiresAt("");
    });

  const voidIt = (authorisationId: string) =>
    act(async () => {
      await rrFetchJson("/api/road-recovery/authorisations", {
        method: "PATCH",
        body: JSON.stringify({ companyId, authorisationId, voidReason: voidReason.trim() }),
      });
      setVoidFor(null);
      setVoidReason("");
    });

  return (
    <div className="mt-3 rounded-2xl border border-slate-300 bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h4 className="text-sm font-black text-slate-900">Authorisation</h4>
          <p className="mt-0.5 text-[11px] font-semibold text-slate-500">
            What the counterparty agreed to. The server decides whether it is valid — a
            voided or expired authorisation will not release this job to dispatch.
          </p>
        </div>
        <button onClick={onClose} className="text-xs font-bold text-slate-500 hover:text-slate-800">
          Close
        </button>
      </div>

      {error || poll.error ? (
        <p className="mt-2 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-800">
          {error || poll.error}
        </p>
      ) : null}

      {rows === null ? (
        <p className="mt-3 text-xs font-semibold text-slate-500">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="mt-3 text-xs font-semibold text-slate-500">
          No authorisation has been recorded for this job.
        </p>
      ) : (
        <ul className="mt-3 space-y-2">
          {rows.map((row) => {
            const state = expiryState(row);
            return (
              <li
                key={row.id}
                className={`rounded-xl border p-3 ${
                  state.live ? "border-emerald-300 bg-emerald-50" : "border-slate-200 bg-slate-50"
                }`}
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="text-xs font-black text-slate-900">
                      {row.authorisation_number}
                      {row.claim_reference ? ` · Claim ${row.claim_reference}` : ""}
                      {row.po_number ? ` · PO ${row.po_number}` : ""}
                    </p>
                    <p className="mt-0.5 text-[11px] font-semibold text-slate-600">
                      {row.authorised_service_code || "—"}
                      {row.authorised_amount != null
                        ? ` · ceiling ZAR ${Number(row.authorised_amount).toFixed(2)}`
                        : " · no amount ceiling"}
                      {row.channel ? ` · by ${row.channel.replace(/_/g, " ")}` : ""}
                    </p>
                    {row.authorised_by_name ? (
                      <p className="mt-0.5 text-[11px] font-semibold text-slate-600">
                        Authorised by {row.authorised_by_name}
                        {row.authorised_by_contact ? ` · ${row.authorised_by_contact}` : ""}
                      </p>
                    ) : null}
                    <p className="mt-0.5 text-[11px] font-semibold text-slate-500">
                      {row.expires_at
                        ? `Expires ${new Date(row.expires_at).toLocaleString("en-ZA")}`
                        : "No expiry"}
                    </p>
                    {row.void_reason ? (
                      <p className="mt-1 text-[11px] font-bold text-rose-800">Voided: {row.void_reason}</p>
                    ) : null}
                  </div>
                  <span
                    className={`rounded-full px-2.5 py-1 text-[10px] font-black uppercase ${
                      state.live ? "bg-emerald-200 text-emerald-900" : "bg-slate-200 text-slate-700"
                    }`}
                  >
                    {state.label}
                  </span>
                </div>

                {row.status === "active" ? (
                  <div className="mt-2">
                    {voidFor === row.id ? (
                      <div className="space-y-2">
                        <input
                          aria-label="Why is this authorisation no longer valid?"
                          value={voidReason}
                          onChange={(event) => setVoidReason(event.target.value)}
                          placeholder="Why is this authorisation no longer valid?"
                          className="w-full rounded-xl border border-slate-300 px-3 py-2 text-xs"
                        />
                        <div className="flex gap-2">
                          <button
                            type="button"
                            disabled={busy || !voidReason.trim()}
                            onClick={() => voidIt(row.id)}
                            className="rounded-lg bg-rose-700 px-3 py-1.5 text-xs font-bold text-white disabled:opacity-40"
                          >
                            Void authorisation
                          </button>
                          <button
                            type="button"
                            onClick={() => setVoidFor(null)}
                            className="rounded-lg bg-slate-200 px-3 py-1.5 text-xs font-bold text-slate-700"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setVoidFor(row.id)}
                        className="rounded-lg bg-white px-3 py-1.5 text-xs font-bold text-rose-700 ring-1 ring-rose-200"
                      >
                        Void
                      </button>
                    )}
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      {showForm ? (
        <div className="mt-3 grid gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-3 sm:grid-cols-2">
          <Field label="Counterparty">
            <select
              aria-label="Counterparty"
              value={party}
              onChange={(event) => setParty(event.target.value)}
              className={inputClass}
            >
              <option value="">Select…</option>
              {counterparties.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.legal_name}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Authorisation number">
            <input
              aria-label="Authorisation number"
              value={number}
              onChange={(event) => setNumber(event.target.value)}
              className={inputClass}
            />
          </Field>

          <Field label="Claim reference">
            <input
              aria-label="Claim reference"
              value={claim}
              onChange={(event) => setClaim(event.target.value)}
              className={inputClass}
            />
          </Field>

          <Field label="PO number">
            <input aria-label="PO number" value={po} onChange={(event) => setPo(event.target.value)} className={inputClass} />
          </Field>

          <Field label="Authorised amount">
            <input
              aria-label="Authorised amount"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              inputMode="decimal"
              placeholder="Leave blank for no ceiling"
              className={inputClass}
            />
          </Field>

          <Field label="Valid until">
            <input
              aria-label="Valid until"
              type="datetime-local"
              value={expiresAt}
              onChange={(event) => setExpiresAt(event.target.value)}
              className={inputClass}
            />
          </Field>

          <Field label="Authorised by">
            <input
              aria-label="Authorised by"
              value={byName}
              onChange={(event) => setByName(event.target.value)}
              className={inputClass}
            />
          </Field>

          <Field label="Their contact">
            <input
              aria-label="Their contact"
              value={byContact}
              onChange={(event) => setByContact(event.target.value)}
              className={inputClass}
            />
          </Field>

          <Field label="Received by">
            <select
              aria-label="Received by"
              value={channel}
              onChange={(event) => setChannel(event.target.value)}
              className={inputClass}
            >
              {CHANNELS.map((value) => (
                <option key={value} value={value}>
                  {value.replace(/_/g, " ")}
                </option>
              ))}
            </select>
          </Field>

          <div className="flex items-end gap-2 sm:col-span-2">
            <button
              type="button"
              disabled={busy || !party || !number.trim()}
              onClick={record}
              className="rounded-xl bg-emerald-700 px-3 py-2 text-xs font-bold text-white disabled:opacity-40"
            >
              {busy ? "Recording…" : "Record authorisation"}
            </button>
            <button
              type="button"
              onClick={() => setShowForm(false)}
              className="rounded-xl bg-slate-200 px-3 py-2 text-xs font-bold text-slate-700"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setShowForm(true)}
          className="mt-3 rounded-xl bg-slate-900 px-3 py-2 text-xs font-bold text-cyan-300"
        >
          Record authorisation
        </button>
      )}
    </div>
  );
}

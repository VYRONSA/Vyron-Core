"use client";

/**
 * Release and disposal authority panel (Phase 4).
 *
 * Two authorities that are never interchangeable: permission to hand a vehicle back is not
 * permission to scrap it, so they are recorded, verified and displayed separately.
 *
 * An authority is created UNVERIFIED and opens nothing. Verification is a distinct,
 * deliberate act with the verifier's name on it — because "someone phoned and said it was
 * fine" is not an authority.
 */

import React, { useCallback, useMemo, useState } from "react";
import { RR_POLL_INTERVALS, rrFetchJson, useRrPoll } from "@/lib/road-recovery/use-rr-poll";

type Authority = {
  id: string;
  authority_type: "release" | "disposal";
  authority_party: string;
  authority_party_name: string;
  authority_reference: string;
  issued_at: string;
  valid_from: string | null;
  expires_at: string | null;
  status: string;
  verified_by: string | null;
  verified_at: string | null;
  verification_method: string | null;
  collector_name: string | null;
  collector_capacity: string | null;
  collector_id_number: string | null;
  disposal_notice_reference: string | null;
  disposal_notice_served_at: string | null;
  disposal_method: string | null;
  void_reason: string | null;
  voided_at: string | null;
};

type AuthorityPayload = {
  authorities: Authority[];
  authorityTypes: string[];
  authorityParties: string[];
};

function inForce(authority: Authority, now: number): boolean {
  if (authority.status !== "active") return false;
  if (!authority.verified_at || !authority.verified_by) return false;
  if (authority.valid_from && new Date(authority.valid_from).getTime() > now) return false;
  if (authority.expires_at && new Date(authority.expires_at).getTime() < now) return false;
  return true;
}

export default function ReleaseAuthorityPanel({
  companyId,
  serviceJobId,
}: {
  companyId: string;
  serviceJobId: string;
}) {
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [verifyFor, setVerifyFor] = useState<string | null>(null);
  const [verificationMethod, setVerificationMethod] = useState("");
  const [voidFor, setVoidFor] = useState<string | null>(null);
  const [voidReason, setVoidReason] = useState("");

  const [authorityType, setAuthorityType] = useState<"release" | "disposal">("release");
  const [authorityParty, setAuthorityParty] = useState("owner");
  const [partyName, setPartyName] = useState("");
  const [reference, setReference] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [collectorName, setCollectorName] = useState("");
  const [collectorCapacity, setCollectorCapacity] = useState("");
  const [collectorId, setCollectorId] = useState("");
  const [noticeReference, setNoticeReference] = useState("");
  const [noticeServedAt, setNoticeServedAt] = useState("");
  const [disposalMethod, setDisposalMethod] = useState("");

  const fetcher = useCallback(
    () =>
      rrFetchJson<AuthorityPayload>(
        `/api/road-recovery/jobs/${serviceJobId}/authorities?companyId=${encodeURIComponent(companyId)}`
      ),
    [companyId, serviceJobId]
  );

  const poll = useRrPoll<AuthorityPayload>(fetcher, RR_POLL_INTERVALS.liveOperations, {
    enabled: Boolean(companyId && serviceJobId),
    key: serviceJobId,
  });

  const refresh = poll.refresh;
  const authorities = useMemo(() => poll.data?.authorities ?? [], [poll.data]);

  const record = useCallback(async () => {
    setBusy(true);
    setActionError(null);
    try {
      await rrFetchJson(`/api/road-recovery/jobs/${serviceJobId}/authorities`, {
        method: "POST",
        body: JSON.stringify({
          companyId,
          authorityType,
          authorityParty,
          authorityPartyName: partyName,
          authorityReference: reference,
          expiresAt: expiresAt || null,
          collectorName: authorityType === "release" ? collectorName : null,
          collectorCapacity: authorityType === "release" ? collectorCapacity : null,
          collectorIdNumber: authorityType === "release" ? collectorId || null : null,
          disposalNoticeReference: authorityType === "disposal" ? noticeReference : null,
          disposalNoticeServedAt: authorityType === "disposal" ? noticeServedAt : null,
          disposalMethod: authorityType === "disposal" ? disposalMethod || null : null,
        }),
      });
      setShowForm(false);
      setPartyName("");
      setReference("");
      refresh();
    } catch (error: unknown) {
      setActionError(error instanceof Error ? error.message : "Could not record the authority.");
    } finally {
      setBusy(false);
    }
  }, [
    authorityParty,
    authorityType,
    collectorCapacity,
    collectorId,
    collectorName,
    companyId,
    disposalMethod,
    expiresAt,
    noticeReference,
    noticeServedAt,
    partyName,
    reference,
    refresh,
    serviceJobId,
  ]);

  const patch = useCallback(
    async (body: Record<string, unknown>) => {
      setBusy(true);
      setActionError(null);
      try {
        await rrFetchJson(`/api/road-recovery/jobs/${serviceJobId}/authorities`, {
          method: "PATCH",
          body: JSON.stringify({ companyId, ...body }),
        });
        setVerifyFor(null);
        setVoidFor(null);
        setVerificationMethod("");
        setVoidReason("");
        refresh();
      } catch (error: unknown) {
        setActionError(error instanceof Error ? error.message : "Could not update the authority.");
      } finally {
        setBusy(false);
      }
    },
    [companyId, refresh, serviceJobId]
  );

  if (poll.initialLoading) {
    return <p className="text-sm font-semibold text-slate-500">Loading authorities…</p>;
  }
  if (poll.error) {
    return (
      <p className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-800">
        {poll.error}
      </p>
    );
  }
  if (!poll.data) return null;

  // Taken from WHEN THE DATA WAS FETCHED, not from the clock at render time. Reading a
  // clock during render is impure, and this is also the more truthful answer: what is
  // shown is whether the authority was in force as of this snapshot.
  const now = poll.lastUpdatedAt ? new Date(poll.lastUpdatedAt).getTime() : 0;

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-4">
        <div>
          <h3 className="text-sm font-black text-slate-900">Release and disposal authority</h3>
          <p className="text-xs font-semibold text-slate-500">
            Recording an authority is not the same as verifying it. Only a verified authority
            in force unlocks anything.
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            setShowForm((current) => !current);
            setActionError(null);
          }}
          className="rounded-xl bg-slate-900 px-3 py-2 text-xs font-bold text-cyan-300 hover:bg-slate-800"
        >
          Record authority
        </button>
      </header>

      {actionError ? (
        <p className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-800">
          {actionError}
        </p>
      ) : null}

      {showForm ? (
        <section className="rounded-2xl border border-slate-300 bg-white p-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-xs font-bold text-slate-600">
              Authority for
              <select
                value={authorityType}
                onChange={(event) => setAuthorityType(event.target.value as "release" | "disposal")}
                className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm font-semibold"
              >
                <option value="release">Release — the vehicle may leave</option>
                <option value="disposal">Disposal — the vehicle may be disposed of</option>
              </select>
            </label>
            <label className="text-xs font-bold text-slate-600">
              Authorising party
              <select
                value={authorityParty}
                onChange={(event) => setAuthorityParty(event.target.value)}
                className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm font-semibold"
              >
                {poll.data.authorityParties.map((party) => (
                  <option key={party} value={party}>
                    {party.replace(/_/g, " ")}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs font-bold text-slate-600">
              Party name
              <input
                value={partyName}
                onChange={(event) => setPartyName(event.target.value)}
                className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm font-semibold"
              />
            </label>
            <label className="text-xs font-bold text-slate-600">
              Their reference
              <input
                value={reference}
                onChange={(event) => setReference(event.target.value)}
                className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm font-semibold"
              />
            </label>
            <label className="text-xs font-bold text-slate-600">
              Expires
              <input
                type="date"
                value={expiresAt}
                onChange={(event) => setExpiresAt(event.target.value)}
                className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm font-semibold"
              />
            </label>

            {authorityType === "release" ? (
              <>
                <label className="text-xs font-bold text-slate-600">
                  Collector name
                  <input
                    value={collectorName}
                    onChange={(event) => setCollectorName(event.target.value)}
                    className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm font-semibold"
                  />
                </label>
                <label className="text-xs font-bold text-slate-600">
                  Collector capacity
                  <input
                    value={collectorCapacity}
                    onChange={(event) => setCollectorCapacity(event.target.value)}
                    className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm font-semibold"
                  />
                </label>
                <label className="text-xs font-bold text-slate-600">
                  Collector identity number
                  <input
                    value={collectorId}
                    onChange={(event) => setCollectorId(event.target.value)}
                    className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm font-semibold"
                  />
                </label>
              </>
            ) : (
              <>
                <label className="text-xs font-bold text-slate-600">
                  Disposal notice reference
                  <input
                    value={noticeReference}
                    onChange={(event) => setNoticeReference(event.target.value)}
                    className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm font-semibold"
                  />
                </label>
                <label className="text-xs font-bold text-slate-600">
                  Notice served on
                  <input
                    type="date"
                    value={noticeServedAt}
                    onChange={(event) => setNoticeServedAt(event.target.value)}
                    className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm font-semibold"
                  />
                </label>
                <label className="text-xs font-bold text-slate-600">
                  Disposal method
                  <input
                    value={disposalMethod}
                    onChange={(event) => setDisposalMethod(event.target.value)}
                    placeholder="scrap, auction, salvage…"
                    className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm font-semibold"
                  />
                </label>
              </>
            )}
          </div>
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              disabled={busy || !partyName.trim() || !reference.trim()}
              onClick={record}
              className="rounded-xl bg-slate-900 px-3 py-2 text-xs font-bold text-cyan-300 disabled:opacity-40"
            >
              {busy ? "Recording…" : "Record (unverified)"}
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

      {authorities.length === 0 ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-6">
          <p className="text-sm font-semibold text-slate-600">
            No release or disposal authority has been recorded for this job.
          </p>
        </div>
      ) : (
        <ul className="space-y-3">
          {authorities.map((authority) => {
            const live = inForce(authority, now);
            return (
              <li
                key={authority.id}
                className={`rounded-2xl border p-4 ${
                  live ? "border-emerald-300 bg-emerald-50" : "border-slate-200 bg-white"
                }`}
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={`rounded-full px-2.5 py-0.5 text-xs font-black uppercase ${
                          authority.authority_type === "disposal"
                            ? "bg-rose-600 text-white"
                            : "bg-slate-900 text-cyan-300"
                        }`}
                      >
                        {authority.authority_type}
                      </span>
                      <p className="text-sm font-black text-slate-900">
                        {authority.authority_party_name}
                      </p>
                      <span className="text-xs font-semibold text-slate-500">
                        {authority.authority_party.replace(/_/g, " ")} ·{" "}
                        {authority.authority_reference}
                      </span>
                    </div>
                    <p className="mt-1 text-xs font-semibold text-slate-500">
                      Issued {new Date(authority.issued_at).toLocaleDateString("en-ZA")}
                      {authority.expires_at
                        ? ` · expires ${new Date(authority.expires_at).toLocaleDateString("en-ZA")}`
                        : " · no expiry"}
                    </p>
                    {authority.collector_name ? (
                      <p className="mt-1 text-xs font-semibold text-slate-600">
                        Collector: {authority.collector_name} ({authority.collector_capacity})
                        {authority.collector_id_number ? ` · ID ${authority.collector_id_number}` : ""}
                      </p>
                    ) : null}
                    {authority.disposal_notice_reference ? (
                      <p className="mt-1 text-xs font-semibold text-slate-600">
                        Notice {authority.disposal_notice_reference} served{" "}
                        {authority.disposal_notice_served_at
                          ? new Date(authority.disposal_notice_served_at).toLocaleDateString("en-ZA")
                          : ""}
                        {authority.disposal_method ? ` · ${authority.disposal_method}` : ""}
                      </p>
                    ) : null}
                  </div>
                  <div className="text-right">
                    <span
                      className={`rounded-full px-2.5 py-1 text-xs font-bold ${
                        live
                          ? "bg-emerald-200 text-emerald-900"
                          : authority.status === "void"
                            ? "bg-rose-200 text-rose-900"
                            : "bg-slate-200 text-slate-700"
                      }`}
                    >
                      {live ? "in force" : authority.status === "active" ? "not verified" : authority.status}
                    </span>
                  </div>
                </div>

                {authority.verified_at ? (
                  <p className="mt-2 rounded-xl bg-white/70 px-2.5 py-1.5 text-xs font-semibold text-emerald-900">
                    Verified by {authority.verified_by} on{" "}
                    {new Date(authority.verified_at).toLocaleString("en-ZA")}
                    {authority.verification_method ? ` — ${authority.verification_method}` : ""}
                  </p>
                ) : null}
                {authority.void_reason ? (
                  <p className="mt-2 text-xs font-semibold text-rose-800">
                    Voided: {authority.void_reason}
                  </p>
                ) : null}

                {authority.status === "active" ? (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {!authority.verified_at ? (
                      <button
                        type="button"
                        onClick={() => setVerifyFor(authority.id)}
                        className="rounded-xl bg-emerald-700 px-3 py-1.5 text-xs font-bold text-white"
                      >
                        Verify
                      </button>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => setVoidFor(authority.id)}
                      className="rounded-xl bg-white px-3 py-1.5 text-xs font-bold text-rose-700"
                    >
                      Void
                    </button>
                  </div>
                ) : null}

                {verifyFor === authority.id ? (
                  <div className="mt-2 space-y-2 rounded-xl border border-slate-300 bg-white p-3">
                    <p className="text-xs font-bold text-slate-700">
                      How did you verify this authority? Your name is recorded against the answer.
                    </p>
                    <input
                      value={verificationMethod}
                      onChange={(event) => setVerificationMethod(event.target.value)}
                      placeholder="called the insurer back on the number on file"
                      className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
                    />
                    <div className="flex gap-2">
                      <button
                        type="button"
                        disabled={busy || !verificationMethod.trim()}
                        onClick={() =>
                          patch({ authorityId: authority.id, action: "verify", verificationMethod })
                        }
                        className="rounded-xl bg-emerald-700 px-3 py-1.5 text-xs font-bold text-white disabled:opacity-40"
                      >
                        Confirm verification
                      </button>
                      <button
                        type="button"
                        onClick={() => setVerifyFor(null)}
                        className="rounded-xl bg-slate-200 px-3 py-1.5 text-xs font-bold text-slate-700"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : null}

                {voidFor === authority.id ? (
                  <div className="mt-2 space-y-2 rounded-xl border border-rose-300 bg-white p-3">
                    <input
                      value={voidReason}
                      onChange={(event) => setVoidReason(event.target.value)}
                      placeholder="Why is this authority no longer valid?"
                      className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
                    />
                    <div className="flex gap-2">
                      <button
                        type="button"
                        disabled={busy || !voidReason.trim()}
                        onClick={() => patch({ authorityId: authority.id, action: "void", voidReason })}
                        className="rounded-xl bg-rose-700 px-3 py-1.5 text-xs font-bold text-white disabled:opacity-40"
                      >
                        Void authority
                      </button>
                      <button
                        type="button"
                        onClick={() => setVoidFor(null)}
                        className="rounded-xl bg-slate-200 px-3 py-1.5 text-xs font-bold text-slate-700"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

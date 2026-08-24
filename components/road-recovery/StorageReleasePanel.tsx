"use client";

/**
 * Storage and release panel (Phase 4).
 *
 * Storage is a first-class operation: a yard, a bay, a period, a condition, a rate basis
 * and an accruing charge. Release is gated on three independent conditions, and this
 * panel states all three at once rather than making a controller discover them one at a
 * time.
 *
 * Nothing here decides eligibility — the server does, and this renders its answer.
 */

import React, { useCallback, useState } from "react";
import { RR_POLL_INTERVALS, rrFetchJson, useRrPoll } from "@/lib/road-recovery/use-rr-poll";
import { formatStorageDuration } from "@/lib/road-recovery/storage-accrual";

type Booking = {
  id: string;
  yard_id: string;
  bay_reference: string | null;
  status: string;
  checked_in_at: string;
  checked_out_at: string | null;
  rate_basis: string;
  rate_amount: number | null;
  currency: string;
  free_days: number;
  storage_condition: string;
  condition_on_arrival: string | null;
  condition_on_departure: string | null;
};

type Accrual = {
  id: string;
  sealed_reason: string;
  period_start: string;
  period_end: string;
  elapsed_days: number;
  free_days_applied: number;
  chargeable_days: number;
  billable_units: number;
  rate_basis: string;
  rate_amount: number | null;
  currency: string;
  amount: number | null;
  calculator_version: string;
  sealed_by: string | null;
  sealed_at: string;
};

type LiveAccrual = {
  elapsedDays: number;
  freeDaysApplied: number;
  chargeableDays: number;
  billableUnits: number;
  amount: number | null;
} | null;

type Eligibility = {
  eligible: boolean;
  authorityOk: boolean;
  evidenceOk: boolean;
  custodyOk: boolean;
  reasons: string[];
} | null;

type StoragePayload = {
  bookings: Booking[];
  accruals: Accrual[];
  liveAccrual: LiveAccrual;
  eligibility: Eligibility;
  rateBases: string[];
  conditions: string[];
};

type Yard = { id: string; name: string; yard_code: string };

function money(amount: number | null, currency: string): string {
  if (amount === null || amount === undefined) return "not priced";
  return `${currency} ${amount.toFixed(2)}`;
}

function Condition({ ok, label }: { ok: boolean; label: string }) {
  return (
    <li
      className={`flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-bold ${
        ok ? "bg-emerald-50 text-emerald-900" : "bg-rose-50 text-rose-900"
      }`}
    >
      <span className="text-xs">{ok ? "✓" : "✕"}</span>
      {label}
    </li>
  );
}

export default function StorageReleasePanel({
  companyId,
  serviceJobId,
}: {
  companyId: string;
  serviceJobId: string;
}) {
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [showCheckIn, setShowCheckIn] = useState(false);
  const [showRelease, setShowRelease] = useState(false);
  const [yards, setYards] = useState<Yard[]>([]);

  const [yardId, setYardId] = useState("");
  const [bay, setBay] = useState("");
  const [rateBasis, setRateBasis] = useState("per_day");
  const [rateAmount, setRateAmount] = useState("");
  const [freeDays, setFreeDays] = useState("0");
  const [condition, setCondition] = useState("outdoor");
  const [arrivalCondition, setArrivalCondition] = useState("");

  const [collectorName, setCollectorName] = useState("");
  const [collectorCapacity, setCollectorCapacity] = useState("");
  const [collectorId, setCollectorId] = useState("");
  const [departureCondition, setDepartureCondition] = useState("");

  const fetcher = useCallback(async () => {
    const query = `companyId=${encodeURIComponent(companyId)}`;
    const [storage, yardList] = await Promise.all([
      rrFetchJson<StoragePayload>(`/api/road-recovery/jobs/${serviceJobId}/storage?${query}`),
      rrFetchJson<{ yards: Yard[] }>(`/api/road-recovery/yards?${query}`),
    ]);
    setYards(yardList.yards || []);
    return storage;
  }, [companyId, serviceJobId]);

  const poll = useRrPoll<StoragePayload>(fetcher, RR_POLL_INTERVALS.liveOperations, {
    enabled: Boolean(companyId && serviceJobId),
    key: serviceJobId,
  });

  const refresh = poll.refresh;

  const checkIn = useCallback(async () => {
    setBusy(true);
    setActionError(null);
    setNotice(null);
    try {
      await rrFetchJson(`/api/road-recovery/jobs/${serviceJobId}/storage`, {
        method: "POST",
        body: JSON.stringify({
          companyId,
          yardId,
          bayReference: bay || null,
          rateBasis,
          rateAmount: rateAmount ? Number(rateAmount) : null,
          freeDays: Number(freeDays) || 0,
          storageCondition: condition,
          conditionOnArrival: arrivalCondition || null,
        }),
      });
      setShowCheckIn(false);
      setNotice("Checked in. Custody moved to the yard and the charge is now accruing.");
      refresh();
    } catch (error: unknown) {
      setActionError(error instanceof Error ? error.message : "Could not check the vehicle in.");
    } finally {
      setBusy(false);
    }
  }, [
    arrivalCondition,
    bay,
    companyId,
    condition,
    freeDays,
    rateAmount,
    rateBasis,
    refresh,
    serviceJobId,
    yardId,
  ]);

  const release = useCallback(async () => {
    setBusy(true);
    setActionError(null);
    setNotice(null);
    try {
      const result = await rrFetchJson<{ accrual: { amount: number | null } }>(
        `/api/road-recovery/jobs/${serviceJobId}/storage`,
        {
          method: "PATCH",
          body: JSON.stringify({
            companyId,
            collectorName,
            collectorCapacity,
            collectorIdNumber: collectorId || null,
            conditionOnDeparture: departureCondition || null,
          }),
        }
      );
      setShowRelease(false);
      setNotice(
        `Released to ${collectorName}. The storage charge has been sealed at ${
          result.accrual.amount === null ? "no priced amount" : result.accrual.amount
        }.`
      );
      refresh();
    } catch (error: unknown) {
      setActionError(error instanceof Error ? error.message : "Could not release the vehicle.");
    } finally {
      setBusy(false);
    }
  }, [collectorCapacity, collectorId, collectorName, companyId, departureCondition, refresh, serviceJobId]);

  if (poll.initialLoading) {
    return <p className="text-sm font-semibold text-slate-500">Loading the storage position…</p>;
  }
  if (poll.error) {
    return (
      <p role="alert" className="rounded-[22px] border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-900">
        {poll.error}
      </p>
    );
  }
  if (!poll.data) return null;

  const open = poll.data.bookings.find((booking) => !booking.checked_out_at) ?? null;
  const eligibility = poll.data.eligibility;
  const yardName = (id: string) => yards.find((yard) => yard.id === id)?.name || id;

  return (
    <div className="space-y-4">
      {notice ? (
        <p className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-bold text-emerald-800">
          {notice}
        </p>
      ) : null}
      {actionError ? (
        <p role="alert" className="rounded-[22px] border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-900">
          {actionError}
        </p>
      ) : null}

      {open ? (
        <section className="rounded-2xl border border-slate-200 bg-white p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-xs font-bold uppercase tracking-wide text-slate-500">In storage</p>
              <p className="text-lg font-black text-slate-900">
                {yardName(open.yard_id)}
                {open.bay_reference ? (
                  <span className="ml-2 text-sm font-bold text-slate-500">bay {open.bay_reference}</span>
                ) : null}
              </p>
              <p className="text-xs font-semibold text-slate-500">
                Since {new Date(open.checked_in_at).toLocaleString("en-ZA")} ·{" "}
                {open.storage_condition.replace(/_/g, " ")} · {open.rate_basis.replace(/_/g, " ")} at{" "}
                {money(open.rate_amount, open.currency)}
                {open.free_days > 0 ? ` · ${open.free_days} free days` : ""}
              </p>
              {open.condition_on_arrival ? (
                <p className="mt-2 text-xs font-semibold text-slate-600">
                  On arrival: {open.condition_on_arrival}
                </p>
              ) : null}
            </div>
            {poll.data.liveAccrual ? (
              <div className="rounded-2xl bg-slate-900 px-4 py-3 text-right">
                <p className="text-xs font-bold uppercase tracking-wide text-cyan-300">
                  Accrued so far
                </p>
                <p className="text-2xl font-black text-white">
                  {money(poll.data.liveAccrual.amount, open.currency)}
                </p>
                <p className="text-xs font-semibold text-slate-300">
                  {formatStorageDuration(poll.data.liveAccrual.elapsedDays)} ·{" "}
                  {poll.data.liveAccrual.chargeableDays} chargeable
                  {poll.data.liveAccrual.freeDaysApplied > 0
                    ? ` · ${poll.data.liveAccrual.freeDaysApplied} free`
                    : ""}
                </p>
              </div>
            ) : null}
          </div>
        </section>
      ) : (
        <section className="rounded-2xl border border-slate-200 bg-white p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm font-semibold text-slate-600">
              This vehicle is not currently in storage.
            </p>
            <button
              type="button"
              onClick={() => {
                setShowCheckIn(true);
                setActionError(null);
              }}
              className="rounded-xl bg-slate-900 px-3 py-2 text-xs font-bold text-cyan-300 hover:bg-slate-800"
            >
              Check in to a yard
            </button>
          </div>
        </section>
      )}

      {showCheckIn ? (
        <section className="rounded-2xl border border-slate-300 bg-white p-4">
          <h4 className="text-sm font-black text-slate-900">Check in</h4>
          <p className="mt-1 text-xs font-semibold text-slate-500">
            Records two facts: custody moves to the yard, and the bay is occupied and charging.
          </p>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <label className="text-xs font-bold text-slate-600">
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
            <label className="text-xs font-bold text-slate-600">
              Bay
              <input
                value={bay}
                onChange={(event) => setBay(event.target.value)}
                className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm font-semibold"
              />
            </label>
            <label className="text-xs font-bold text-slate-600">
              Rate basis
              <select
                value={rateBasis}
                onChange={(event) => setRateBasis(event.target.value)}
                className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm font-semibold"
              >
                {poll.data.rateBases.map((basis) => (
                  <option key={basis} value={basis}>
                    {basis.replace(/_/g, " ")}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs font-bold text-slate-600">
              Rate per unit
              <input
                type="number"
                min={0}
                value={rateAmount}
                onChange={(event) => setRateAmount(event.target.value)}
                className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm font-semibold"
              />
            </label>
            <label className="text-xs font-bold text-slate-600">
              Free days
              <input
                type="number"
                min={0}
                value={freeDays}
                onChange={(event) => setFreeDays(event.target.value)}
                className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm font-semibold"
              />
            </label>
            <label className="text-xs font-bold text-slate-600">
              Conditions
              <select
                value={condition}
                onChange={(event) => setCondition(event.target.value)}
                className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm font-semibold"
              >
                {poll.data.conditions.map((entry) => (
                  <option key={entry} value={entry}>
                    {entry.replace(/_/g, " ")}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs font-bold text-slate-600 sm:col-span-2">
              Condition on arrival
              <textarea
                value={arrivalCondition}
                onChange={(event) => setArrivalCondition(event.target.value)}
                rows={2}
                placeholder="Damage present when the vehicle arrived."
                className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
              />
            </label>
          </div>
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              disabled={busy || !yardId}
              onClick={checkIn}
              className="rounded-xl bg-slate-900 px-3 py-2 text-xs font-bold text-cyan-300 disabled:opacity-40"
            >
              {busy ? "Checking in…" : "Check in"}
            </button>
            <button
              type="button"
              onClick={() => setShowCheckIn(false)}
              className="rounded-xl bg-slate-200 px-3 py-2 text-xs font-bold text-slate-700"
            >
              Cancel
            </button>
          </div>
        </section>
      ) : null}

      {open && eligibility ? (
        <section
          className={`rounded-2xl border p-4 ${
            eligibility.eligible ? "border-emerald-200 bg-emerald-50" : "border-slate-200 bg-white"
          }`}
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h4 className="text-sm font-black text-slate-900">
              {eligibility.eligible ? "This vehicle may be released" : "Release is blocked"}
            </h4>
            {eligibility.eligible ? (
              <button
                type="button"
                onClick={() => {
                  setShowRelease(true);
                  setActionError(null);
                }}
                className="rounded-xl bg-emerald-700 px-3 py-2 text-xs font-bold text-white hover:bg-emerald-800"
              >
                Release the vehicle
              </button>
            ) : null}
          </div>
          <ul className="mt-3 grid gap-2 sm:grid-cols-3">
            <Condition ok={eligibility.authorityOk} label="Verified release authority" />
            <Condition ok={eligibility.evidenceOk} label="Release evidence complete" />
            <Condition ok={eligibility.custodyOk} label="Custody is ours to hand over" />
          </ul>
          {eligibility.reasons.length > 0 ? (
            <ul className="mt-3 space-y-1">
              {eligibility.reasons.map((reason) => (
                <li key={reason} className="text-xs font-semibold text-rose-800">
                  {reason}
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      ) : null}

      {showRelease ? (
        <section className="rounded-2xl border border-emerald-300 bg-white p-4">
          <h4 className="text-sm font-black text-slate-900">Release</h4>
          <p className="mt-1 text-xs font-semibold text-slate-500">
            The storage charge is sealed at the moment the vehicle leaves, and the person
            collecting it is recorded permanently on the custody chain.
          </p>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <label className="text-xs font-bold text-slate-600">
              Collector name
              <input
                value={collectorName}
                onChange={(event) => setCollectorName(event.target.value)}
                className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm font-semibold"
              />
            </label>
            <label className="text-xs font-bold text-slate-600">
              In what capacity
              <input
                value={collectorCapacity}
                onChange={(event) => setCollectorCapacity(event.target.value)}
                placeholder="registered owner, insurer assessor…"
                className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm font-semibold"
              />
            </label>
            <label className="text-xs font-bold text-slate-600">
              Identity number
              <input
                value={collectorId}
                onChange={(event) => setCollectorId(event.target.value)}
                className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm font-semibold"
              />
            </label>
            <label className="text-xs font-bold text-slate-600">
              Condition on departure
              <input
                value={departureCondition}
                onChange={(event) => setDepartureCondition(event.target.value)}
                className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm font-semibold"
              />
            </label>
          </div>
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              disabled={busy || !collectorName.trim() || !collectorCapacity.trim()}
              onClick={release}
              className="rounded-xl bg-emerald-700 px-3 py-2 text-xs font-bold text-white disabled:opacity-40"
            >
              {busy ? "Releasing…" : "Confirm release"}
            </button>
            <button
              type="button"
              onClick={() => setShowRelease(false)}
              className="rounded-xl bg-slate-200 px-3 py-2 text-xs font-bold text-slate-700"
            >
              Cancel
            </button>
          </div>
        </section>
      ) : null}

      {poll.data.accruals.length > 0 ? (
        <section className="rounded-2xl border border-slate-200 bg-white p-4">
          <h4 className="text-xs font-bold uppercase tracking-wide text-slate-500">
            Sealed storage charges
          </h4>
          <div className="mt-2 overflow-x-auto">
            <table className="w-full min-w-[720px] text-left text-xs">
              <thead className="text-slate-500">
                <tr>
                  <th className="py-1 pr-3 font-bold">Sealed</th>
                  <th className="py-1 pr-3 font-bold">Reason</th>
                  <th className="py-1 pr-3 font-bold">Elapsed</th>
                  <th className="py-1 pr-3 font-bold">Free</th>
                  <th className="py-1 pr-3 font-bold">Charged</th>
                  <th className="py-1 pr-3 font-bold">Amount</th>
                  <th className="py-1 pr-3 font-bold">Calculator</th>
                </tr>
              </thead>
              <tbody className="font-semibold text-slate-800">
                {poll.data.accruals.map((entry) => (
                  <tr key={entry.id} className="border-t border-slate-100">
                    <td className="py-1.5 pr-3">
                      {new Date(entry.sealed_at).toLocaleString("en-ZA")}
                    </td>
                    <td className="py-1.5 pr-3">{entry.sealed_reason.replace(/_/g, " ")}</td>
                    <td className="py-1.5 pr-3">{entry.elapsed_days}</td>
                    <td className="py-1.5 pr-3">{entry.free_days_applied}</td>
                    <td className="py-1.5 pr-3">{entry.chargeable_days}</td>
                    <td className="py-1.5 pr-3">{money(entry.amount, entry.currency)}</td>
                    <td className="py-1.5 pr-3 font-mono text-[11px]">{entry.calculator_version}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-xs font-medium text-slate-400">
            Sealed charges are immutable. A correction seals a new row under a new calculator
            version rather than re-pricing an invoice that has already been issued.
          </p>
        </section>
      ) : null}
    </div>
  );
}

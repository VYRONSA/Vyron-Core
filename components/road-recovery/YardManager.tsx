"use client";

/**
 * Storage yards (Phase 4).
 *
 * A yard is a place possession can rest — deliberately not a job destination. A vehicle
 * may pass through a yard that was never its destination, and be delivered to a
 * destination that is not a yard.
 */

import React, { useCallback, useState } from "react";
import { RR_POLL_INTERVALS, rrFetchJson, useRrPoll } from "@/lib/road-recovery/use-rr-poll";

type Yard = {
  id: string;
  yard_code: string;
  name: string;
  address: string | null;
  security_level: string;
  covered: boolean;
  capacity: number | null;
  operating_hours: string | null;
  contact_name: string | null;
  contact_number: string | null;
  active: boolean;
};

const SECURITY_LEVELS = ["open", "fenced", "secure", "high_security"];

export default function YardManager({ companyId }: { companyId: string }) {
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [yardCode, setYardCode] = useState("");
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [securityLevel, setSecurityLevel] = useState("secure");
  const [covered, setCovered] = useState(false);
  const [capacity, setCapacity] = useState("");
  const [operatingHours, setOperatingHours] = useState("");
  const [contactName, setContactName] = useState("");
  const [contactNumber, setContactNumber] = useState("");

  const fetcher = useCallback(
    () =>
      rrFetchJson<{ yards: Yard[] }>(
        `/api/road-recovery/yards?companyId=${encodeURIComponent(companyId)}&includeInactive=true`
      ),
    [companyId]
  );

  const poll = useRrPoll<{ yards: Yard[] }>(fetcher, RR_POLL_INTERVALS.driverIdle, {
    enabled: Boolean(companyId),
  });

  const refresh = poll.refresh;

  const create = useCallback(async () => {
    setBusy(true);
    setActionError(null);
    try {
      await rrFetchJson("/api/road-recovery/yards", {
        method: "POST",
        body: JSON.stringify({
          companyId,
          yardCode,
          name,
          address: address || null,
          securityLevel,
          covered,
          capacity: capacity ? Number(capacity) : null,
          operatingHours: operatingHours || null,
          contactName: contactName || null,
          contactNumber: contactNumber || null,
        }),
      });
      setShowForm(false);
      setYardCode("");
      setName("");
      setAddress("");
      refresh();
    } catch (error: unknown) {
      setActionError(error instanceof Error ? error.message : "Could not create the yard.");
    } finally {
      setBusy(false);
    }
  }, [
    address,
    capacity,
    companyId,
    contactName,
    contactNumber,
    covered,
    name,
    operatingHours,
    refresh,
    securityLevel,
    yardCode,
  ]);

  const yards = poll.data?.yards ?? [];

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-4">
        <div>
          <h2 className="text-lg font-black text-slate-900">Storage yards</h2>
          <p className="text-sm font-semibold text-slate-500">
            {yards.filter((yard) => yard.active).length} active · {yards.length} total. A yard is
            where possession rests, not where a job is headed.
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
          Add yard
        </button>
      </header>

      {actionError ? (
        <p role="alert" className="rounded-[22px] border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-900">
          {actionError}
        </p>
      ) : null}

      {showForm ? (
        <section className="rounded-2xl border border-slate-300 bg-white p-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-xs font-bold text-slate-600">
              Yard code
              <input
                value={yardCode}
                onChange={(event) => setYardCode(event.target.value)}
                placeholder="YARD-A"
                className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm font-semibold"
              />
            </label>
            <label className="text-xs font-bold text-slate-600">
              Name
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm font-semibold"
              />
            </label>
            <label className="text-xs font-bold text-slate-600 sm:col-span-2">
              Address
              <input
                value={address}
                onChange={(event) => setAddress(event.target.value)}
                className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm font-semibold"
              />
            </label>
            <label className="text-xs font-bold text-slate-600">
              Security
              <select
                value={securityLevel}
                onChange={(event) => setSecurityLevel(event.target.value)}
                className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm font-semibold"
              >
                {SECURITY_LEVELS.map((level) => (
                  <option key={level} value={level}>
                    {level.replace(/_/g, " ")}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs font-bold text-slate-600">
              Capacity
              <input
                type="number"
                min={0}
                value={capacity}
                onChange={(event) => setCapacity(event.target.value)}
                className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm font-semibold"
              />
            </label>
            <label className="text-xs font-bold text-slate-600">
              Operating hours
              <input
                value={operatingHours}
                onChange={(event) => setOperatingHours(event.target.value)}
                placeholder="Mon–Fri 07:00–17:00"
                className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm font-semibold"
              />
            </label>
            <label className="flex items-center gap-2 pt-5 text-xs font-bold text-slate-700">
              <input
                type="checkbox"
                checked={covered}
                onChange={(event) => setCovered(event.target.checked)}
              />
              Covered
            </label>
            <label className="text-xs font-bold text-slate-600">
              Contact name
              <input
                value={contactName}
                onChange={(event) => setContactName(event.target.value)}
                className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm font-semibold"
              />
            </label>
            <label className="text-xs font-bold text-slate-600">
              Contact number
              <input
                value={contactNumber}
                onChange={(event) => setContactNumber(event.target.value)}
                className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm font-semibold"
              />
            </label>
          </div>
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              disabled={busy || !yardCode.trim() || !name.trim()}
              onClick={create}
              className="rounded-xl bg-slate-900 px-3 py-2 text-xs font-bold text-cyan-300 disabled:opacity-40"
            >
              {busy ? "Creating…" : "Create yard"}
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

      {poll.initialLoading ? (
        <p className="text-sm font-semibold text-slate-500">Loading yards…</p>
      ) : poll.error ? (
        <p role="alert" className="rounded-[22px] border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-900">
          {poll.error}
        </p>
      ) : yards.length === 0 ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-6">
          <p className="text-sm font-semibold text-slate-600">
            No yards yet. A vehicle cannot be checked into storage until one exists.
          </p>
        </div>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {yards.map((yard) => (
            <li
              key={yard.id}
              className={`rounded-2xl border p-4 ${
                yard.active ? "border-slate-200 bg-white" : "border-slate-200 bg-slate-50 opacity-70"
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-sm font-black text-slate-900">{yard.name}</p>
                  <p className="text-xs font-semibold text-slate-500">{yard.yard_code}</p>
                </div>
                <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-bold text-slate-700">
                  {yard.security_level.replace(/_/g, " ")}
                </span>
              </div>
              {yard.address ? (
                <p className="mt-2 text-xs font-semibold text-slate-600">{yard.address}</p>
              ) : null}
              <p className="mt-2 text-xs font-semibold text-slate-500">
                {yard.covered ? "Covered" : "Open air"}
                {yard.capacity !== null ? ` · capacity ${yard.capacity}` : ""}
                {yard.operating_hours ? ` · ${yard.operating_hours}` : ""}
              </p>
              {yard.contact_name ? (
                <p className="mt-1 text-xs font-semibold text-slate-500">
                  {yard.contact_name}
                  {yard.contact_number ? ` · ${yard.contact_number}` : ""}
                </p>
              ) : null}
              {!yard.active ? (
                <p className="mt-2 text-xs font-bold text-slate-500">Inactive</p>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

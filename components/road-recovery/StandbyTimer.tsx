"use client";

/**
 * BYSTAND standby timer display.
 *
 * The authoritative numbers come from the SERVER, derived from the append-only state
 * event stream. This component only ticks the display forward between polls, and it does
 * so from the server's own baseline — the browser clock never contributes a billable
 * second.
 */

import React, { useEffect, useState } from "react";
import { formatStandbyDuration } from "@/lib/road-recovery/standby-timer";

export type StandbySnapshot = {
  totalBillableSeconds: number;
  totalPausedSeconds: number;
  standingNow: boolean;
  intervalCount?: number;
};

export default function StandbyTimer({
  snapshot,
  fetchedAt,
  compact = false,
  sealed,
}: {
  snapshot: StandbySnapshot;
  /** Server timestamp the snapshot was computed at. */
  fetchedAt: string | null;
  compact?: boolean;
  sealed?: { total_billable_seconds: number; total_paused_seconds: number; sealed_at: string } | null;
}) {
  /**
   * Display-only ticking.
   *
   * The clock is read ONLY inside the interval callback, never during render, and the
   * value is measured from the SERVER's own baseline (`fetchedAt`). So the browser clock
   * advances the display between polls but never contributes to the billable figure —
   * which is computed server-side from the append-only event stream and refreshed on
   * every poll.
   */
  const [elapsedSinceFetch, setElapsedSinceFetch] = useState(0);

  useEffect(() => {
    if (!snapshot.standingNow || !fetchedAt) return;
    const baseMs = new Date(fetchedAt).getTime();
    if (!Number.isFinite(baseMs)) return;

    const timer = setInterval(() => {
      setElapsedSinceFetch(Math.max(0, Math.round((Date.now() - baseMs) / 1000)));
    }, 1000);
    return () => clearInterval(timer);
  }, [snapshot.standingNow, fetchedAt]);

  // A fresh poll supplies a new server figure; anything older than the current baseline
  // is ignored rather than added on top of it.
  const displayedBillable =
    snapshot.totalBillableSeconds + (snapshot.standingNow ? elapsedSinceFetch : 0);

  if (compact) {
    return (
      <span className="inline-flex items-center gap-2">
        <span
          className={`inline-block h-2 w-2 rounded-full ${
            snapshot.standingNow ? "animate-pulse bg-emerald-500" : "bg-slate-300"
          }`}
          aria-hidden
        />
        <span className="font-mono text-sm font-bold text-slate-900">
          {formatStandbyDuration(displayedBillable)}
        </span>
        {snapshot.totalPausedSeconds > 0 ? (
          <span className="font-mono text-xs text-amber-700">
            +{formatStandbyDuration(snapshot.totalPausedSeconds)} paused
          </span>
        ) : null}
      </span>
    );
  }

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-black uppercase tracking-wide text-slate-600">
          Billable standing time
        </h3>
        {snapshot.standingNow ? (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-bold text-emerald-800">
            <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-600" />
            Standing by
          </span>
        ) : (
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-bold text-slate-600">
            Clock stopped
          </span>
        )}
      </div>

      <div className="mt-2 font-mono text-4xl font-black tabular-nums text-slate-900">
        {formatStandbyDuration(displayedBillable)}
      </div>

      <dl className="mt-3 grid grid-cols-2 gap-3 text-sm">
        <div>
          <dt className="text-xs font-bold uppercase tracking-wide text-amber-700">Paused</dt>
          <dd className="font-mono font-bold text-amber-800">
            {formatStandbyDuration(snapshot.totalPausedSeconds)}
          </dd>
        </div>
        <div>
          <dt className="text-xs font-bold uppercase tracking-wide text-slate-500">Intervals</dt>
          <dd className="font-mono font-bold text-slate-700">{snapshot.intervalCount ?? "—"}</dd>
        </div>
      </dl>

      <p className="mt-3 text-[11px] leading-relaxed text-slate-500">
        Paused time is <strong>not billable</strong>. The clock runs only while standing by,
        never from dispatch or travel.
      </p>

      {sealed ? (
        <div className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50 p-2">
          <p className="text-[11px] font-black uppercase tracking-wide text-emerald-900">
            Sealed for billing
          </p>
          <p className="mt-0.5 font-mono text-sm font-bold text-emerald-900">
            {formatStandbyDuration(sealed.total_billable_seconds)} billable ·{" "}
            {formatStandbyDuration(sealed.total_paused_seconds)} paused
          </p>
          <p className="text-[10px] text-emerald-800">
            {new Date(sealed.sealed_at).toLocaleString()}
          </p>
        </div>
      ) : null}
    </div>
  );
}

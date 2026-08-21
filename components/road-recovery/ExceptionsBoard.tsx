"use client";

/**
 * Exceptions board (Phase 3).
 *
 * Every Road & Recovery exception, ordered by severity so the controller sees what
 * actually matters first. High and critical exceptions are ALSO routed into the existing
 * workforce_automation_actions approval queue when raised — this board is the operational
 * view of them, not a second approval system.
 */

import React, { useCallback, useMemo, useState } from "react";
import { RR_POLL_INTERVALS, rrFetchJson, useRrPoll } from "@/lib/road-recovery/use-rr-poll";

type ExceptionRow = {
  id: string;
  service_job_id: string;
  exception_code: string;
  severity: string;
  detail: string | null;
  detected_by: string;
  detected_by_actor: string | null;
  state_at_detection: string | null;
  requirement_code: string | null;
  resolution_status: string;
  resolution_action: string | null;
  resolution_notes: string | null;
  resolved_by: string | null;
  resolved_at: string | null;
  waiver_id: string | null;
  automation_action_id: string | null;
  created_at: string;
};

const SEVERITY_ORDER: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };

const SEVERITY_TONE: Record<string, string> = {
  critical: "border-rose-400 bg-rose-50",
  high: "border-orange-300 bg-orange-50",
  medium: "border-amber-200 bg-amber-50",
  low: "border-slate-200 bg-white",
};

const SEVERITY_CHIP: Record<string, string> = {
  critical: "bg-rose-600 text-white",
  high: "bg-orange-500 text-white",
  medium: "bg-amber-300 text-amber-950",
  low: "bg-slate-200 text-slate-700",
};

export default function ExceptionsBoard({ companyId }: { companyId: string }) {
  const [filter, setFilter] = useState<"open" | "all">("open");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [notesFor, setNotesFor] = useState<string | null>(null);
  const [notes, setNotes] = useState("");

  const fetcher = useCallback(
    () =>
      rrFetchJson<{ exceptions: ExceptionRow[] }>(
        `/api/road-recovery/exceptions?companyId=${encodeURIComponent(companyId)}${
          filter === "open" ? "&status=open" : ""
        }`
      ),
    [companyId, filter]
  );

  const poll = useRrPoll<{ exceptions: ExceptionRow[] }>(
    fetcher,
    RR_POLL_INTERVALS.liveOperations,
    { enabled: Boolean(companyId), key: filter }
  );

  const refresh = poll.refresh;

  const rows = useMemo(() => {
    const list = [...(poll.data?.exceptions ?? [])];
    list.sort((a, b) => {
      const severity = (SEVERITY_ORDER[a.severity] ?? 9) - (SEVERITY_ORDER[b.severity] ?? 9);
      if (severity !== 0) return severity;
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    });
    return list;
  }, [poll.data]);

  const counts = useMemo(() => {
    const open = rows.filter((row) => ["open", "acknowledged"].includes(row.resolution_status));
    return {
      total: rows.length,
      critical: open.filter((row) => row.severity === "critical").length,
      high: open.filter((row) => row.severity === "high").length,
    };
  }, [rows]);

  const update = useCallback(
    async (exceptionId: string, resolutionStatus: string, resolutionNotes?: string) => {
      setBusyId(exceptionId);
      setActionError(null);
      try {
        await rrFetchJson(`/api/road-recovery/exceptions/${exceptionId}`, {
          method: "PATCH",
          body: JSON.stringify({ companyId, resolutionStatus, resolutionNotes: resolutionNotes || null }),
        });
        setNotesFor(null);
        setNotes("");
        refresh();
      } catch (error: unknown) {
        setActionError(error instanceof Error ? error.message : "Could not update the exception.");
      } finally {
        setBusyId(null);
      }
    },
    [companyId, refresh]
  );

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-4">
        <div>
          <h2 className="text-lg font-black text-slate-900">Exceptions</h2>
          <p className="text-sm font-semibold text-slate-500">
            {counts.critical} critical · {counts.high} high · {counts.total} shown
          </p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setFilter("open")}
            className={`rounded-xl px-3 py-1.5 text-xs font-bold ${
              filter === "open" ? "bg-slate-900 text-cyan-300" : "bg-slate-100 text-slate-700"
            }`}
          >
            Open
          </button>
          <button
            type="button"
            onClick={() => setFilter("all")}
            className={`rounded-xl px-3 py-1.5 text-xs font-bold ${
              filter === "all" ? "bg-slate-900 text-cyan-300" : "bg-slate-100 text-slate-700"
            }`}
          >
            All
          </button>
          <button
            type="button"
            onClick={refresh}
            className="rounded-xl bg-slate-100 px-3 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-200"
          >
            Refresh
          </button>
        </div>
      </header>

      {actionError ? (
        <p className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-800">
          {actionError}
        </p>
      ) : null}

      {poll.initialLoading ? (
        <p className="text-sm font-semibold text-slate-500">Loading exceptions…</p>
      ) : poll.error ? (
        <p className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-800">
          {poll.error}
        </p>
      ) : rows.length === 0 ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-6 text-center">
          <p className="text-sm font-bold text-slate-700">No exceptions.</p>
        </div>
      ) : (
        <ul className="space-y-3">
          {rows.map((row) => {
            const open = ["open", "acknowledged"].includes(row.resolution_status);
            return (
              <li
                key={row.id}
                className={`rounded-2xl border p-4 ${SEVERITY_TONE[row.severity] || SEVERITY_TONE.low}`}
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={`rounded-full px-2.5 py-0.5 text-xs font-black uppercase ${
                          SEVERITY_CHIP[row.severity] || SEVERITY_CHIP.low
                        }`}
                      >
                        {row.severity}
                      </span>
                      <p className="text-sm font-black text-slate-900">
                        {row.exception_code.replace(/_/g, " ")}
                      </p>
                      {row.automation_action_id ? (
                        <span className="rounded-full bg-cyan-100 px-2.5 py-0.5 text-xs font-bold text-cyan-900">
                          escalated for approval
                        </span>
                      ) : null}
                    </div>
                    {row.detail ? (
                      <p className="mt-1.5 text-sm font-semibold text-slate-700">{row.detail}</p>
                    ) : null}
                    <p className="mt-1.5 text-xs font-semibold text-slate-500">
                      Detected by {row.detected_by}
                      {row.detected_by_actor ? ` (${row.detected_by_actor})` : ""}
                      {row.state_at_detection ? ` · at state ${row.state_at_detection}` : ""}
                      {row.requirement_code ? ` · requirement ${row.requirement_code}` : ""} ·{" "}
                      {new Date(row.created_at).toLocaleString("en-ZA")}
                    </p>
                  </div>
                  <span className="rounded-full bg-white px-2.5 py-1 text-xs font-bold text-slate-700">
                    {row.resolution_status}
                  </span>
                </div>

                {row.resolved_by ? (
                  <p className="mt-2 text-xs font-semibold text-slate-600">
                    Closed by {row.resolved_by}
                    {row.resolved_at ? ` on ${new Date(row.resolved_at).toLocaleString("en-ZA")}` : ""}
                    {row.resolution_notes ? ` — ${row.resolution_notes}` : ""}
                  </p>
                ) : null}

                {open ? (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {row.resolution_status === "open" ? (
                      <button
                        type="button"
                        disabled={busyId === row.id}
                        onClick={() => update(row.id, "acknowledged")}
                        className="rounded-xl bg-slate-200 px-3 py-1.5 text-xs font-bold text-slate-800 disabled:opacity-40"
                      >
                        Acknowledge
                      </button>
                    ) : null}
                    <button
                      type="button"
                      disabled={busyId === row.id}
                      onClick={() => {
                        setNotesFor(row.id);
                        setNotes("");
                      }}
                      className="rounded-xl bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white disabled:opacity-40"
                    >
                      Resolve
                    </button>
                    <button
                      type="button"
                      disabled={busyId === row.id}
                      onClick={() => update(row.id, "cancelled")}
                      className="rounded-xl bg-white px-3 py-1.5 text-xs font-bold text-slate-600 disabled:opacity-40"
                    >
                      Cancel
                    </button>
                  </div>
                ) : null}

                {notesFor === row.id ? (
                  <div className="mt-2 space-y-2 rounded-xl border border-slate-300 bg-white p-3">
                    <textarea
                      value={notes}
                      onChange={(event) => setNotes(event.target.value)}
                      rows={2}
                      placeholder="What was done?"
                      className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
                    />
                    <div className="flex gap-2">
                      <button
                        type="button"
                        disabled={busyId === row.id}
                        onClick={() => update(row.id, "resolved", notes)}
                        className="rounded-xl bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white disabled:opacity-40"
                      >
                        {busyId === row.id ? "Saving…" : "Confirm resolution"}
                      </button>
                      <button
                        type="button"
                        onClick={() => setNotesFor(null)}
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

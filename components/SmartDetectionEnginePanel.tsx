"use client";

import React, { useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  RefreshCcw,
  ShieldCheck,
  Zap,
} from "lucide-react";
import { supabase } from "../lib/supabase";

type DetectionResult = {
  detection_type: string;
  records_created: number;
};

type ExceptionRow = {
  id: string;
  exception_type: string;
  severity: string;
  description: string;
  status: string;
  employee_id: string;
  store_id: string | null;
  roster_shift_id?: string | null;
  source?: string | null;
  exception_key?: string | null;
};

function formatText(value: string | null | undefined) {
  if (!value) return "Not set";
  return value.replaceAll("_", " ");
}

function todayIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

function dateDaysAgo(days: number) {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date.toISOString().slice(0, 10);
}

function statusClass(value: string) {
  if (value === "closed" || value === "approved") return "bg-emerald-100 text-emerald-700";
  if (value === "open" || value === "needs_review") return "bg-rose-100 text-rose-700";
  return "bg-slate-200 text-slate-700";
}

function severityClass(value: string) {
  if (value === "critical" || value === "high") return "bg-rose-100 text-rose-700";
  if (value === "medium") return "bg-amber-100 text-amber-700";
  return "bg-blue-100 text-blue-700";
}

export default function SmartDetectionEnginePanel({
  exceptions,
  onUpdated,
  onNavigate,
}: {
  exceptions: ExceptionRow[];
  onUpdated?: () => void | Promise<void>;
  onNavigate?: (value: string) => void;
}) {
  const [fromDate, setFromDate] = useState(dateDaysAgo(365));
  const [toDate, setToDate] = useState(todayIsoDate());
  const [running, setRunning] = useState(false);
  const [results, setResults] = useState<DetectionResult[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const smartExceptions = useMemo(
    () =>
      exceptions.filter(
        (item) =>
          item.source === "smart_detection_engine" ||
          item.exception_type === "pattern_risk" ||
          item.exception_type === "payroll_blocker"
      ),
    [exceptions]
  );

  const openSmartExceptions = useMemo(
    () =>
      smartExceptions.filter(
        (item) => item.status !== "closed" && item.status !== "approved" && item.status !== "dismissed"
      ),
    [smartExceptions]
  );

  const criticalSmartExceptions = useMemo(
    () => smartExceptions.filter((item) => item.severity === "critical" || item.severity === "high"),
    [smartExceptions]
  );

  async function runDetection() {
    setRunning(true);
    setMessage(null);
    setError(null);
    setResults([]);

    const { data, error: runError } = await supabase.rpc("run_smart_detection_engine", {
      p_from_date: fromDate,
      p_to_date: toDate,
    });

    if (runError) {
      setError(runError.message);
      setRunning(false);
      return;
    }

    setResults((data || []) as DetectionResult[]);
    setMessage("Smart detection completed successfully.");

    if (onUpdated) {
      await onUpdated();
    }

    setRunning(false);
  }

  return (
    <section className="mt-8 space-y-8">
      <div className="rounded-[34px] bg-gradient-to-r from-[#07101f] to-[#0b1a33] p-6 text-white shadow-2xl shadow-slate-300">
        <div className="flex flex-col gap-5 md:flex-row md:items-start md:justify-between">
          <div>
            <div className="text-xs font-bold uppercase tracking-[0.4em] text-cyan-300">
              Smart Detection Engine
            </div>
            <h2 className="mt-3 text-4xl font-bold">Payroll & HR Risk Scanner</h2>
            <p className="mt-4 max-w-3xl text-sm leading-7 text-slate-300">
              Scan clocking history for late clock-ins, missing clock-outs and repeated risk patterns.
              The engine creates actionable exceptions for managers before payroll is processed.
            </p>
          </div>

          <div className="rounded-3xl bg-white/10 p-4 text-cyan-300">
            <Zap className="h-10 w-10" />
          </div>
        </div>
      </div>

      <div className="grid gap-5 md:grid-cols-3">
        <div className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-[0_10px_30px_rgba(0,0,0,0.08)]">
          <div className="text-xs font-black uppercase tracking-[0.2em] text-slate-400">Smart exceptions</div>
          <div className="mt-3 text-4xl font-black text-slate-950">{smartExceptions.length}</div>
          <p className="mt-2 text-sm font-semibold text-slate-500">Generated or pattern-based exceptions</p>
        </div>

        <div className="rounded-[28px] border border-rose-200 bg-rose-50 p-6 text-rose-800">
          <div className="text-xs font-black uppercase tracking-[0.2em] opacity-70">Open risk</div>
          <div className="mt-3 text-4xl font-black">{openSmartExceptions.length}</div>
          <p className="mt-2 text-sm font-semibold opacity-80">Still needs manager action</p>
        </div>

        <div className="rounded-[28px] border border-amber-200 bg-amber-50 p-6 text-amber-800">
          <div className="text-xs font-black uppercase tracking-[0.2em] opacity-70">High / Critical</div>
          <div className="mt-3 text-4xl font-black">{criticalSmartExceptions.length}</div>
          <p className="mt-2 text-sm font-semibold opacity-80">Priority risk items</p>
        </div>
      </div>

      <div className="grid gap-8 xl:grid-cols-[0.85fr_1.15fr]">
        <div className="rounded-[34px] border border-slate-200 bg-white p-6 shadow-[0_10px_30px_rgba(0,0,0,0.08)]">
          <div className="text-xs font-bold uppercase tracking-[0.35em] text-blue-600">
            Run Scanner
          </div>
          <h3 className="mt-2 text-3xl font-bold text-slate-950">Detection Range</h3>
          <p className="mt-2 text-sm leading-6 text-slate-500">
            Select a date range and run the detection engine. Use a full year for demo movement,
            or shorter ranges when testing payroll periods.
          </p>

          <div className="mt-6 grid gap-4 md:grid-cols-2">
            <label className="text-sm font-bold text-slate-800">
              From date
              <input
                type="date"
                value={fromDate}
                onChange={(event) => setFromDate(event.target.value)}
                className="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 outline-none focus:border-blue-500"
              />
            </label>

            <label className="text-sm font-bold text-slate-800">
              To date
              <input
                type="date"
                value={toDate}
                onChange={(event) => setToDate(event.target.value)}
                className="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 outline-none focus:border-blue-500"
              />
            </label>
          </div>

          {error && (
            <div className="mt-5 rounded-2xl bg-rose-50 p-4 text-sm font-semibold text-rose-700">
              <AlertTriangle className="mr-2 inline h-4 w-4" />
              {error}
            </div>
          )}

          {message && (
            <div className="mt-5 rounded-2xl bg-emerald-50 p-4 text-sm font-semibold text-emerald-700">
              <CheckCircle2 className="mr-2 inline h-4 w-4" />
              {message}
            </div>
          )}

          <button
            onClick={runDetection}
            disabled={running}
            className="mt-6 flex w-full items-center justify-center gap-2 rounded-2xl bg-slate-950 px-5 py-4 text-sm font-black text-white disabled:bg-slate-300 disabled:text-slate-500"
          >
            <RefreshCcw className="h-4 w-4" />
            {running ? "Running Detection..." : "Run Smart Detection"}
          </button>

          <button
            onClick={() => onNavigate?.("Exceptions")}
            className="mt-3 flex w-full items-center justify-center gap-2 rounded-2xl bg-blue-600 px-5 py-4 text-sm font-black text-white"
          >
            <ShieldCheck className="h-4 w-4" />
            Open Exceptions
          </button>

          {results.length > 0 && (
            <div className="mt-6 rounded-[24px] border border-slate-200 bg-slate-50 p-4">
              <div className="text-xs font-black uppercase tracking-[0.2em] text-slate-400">
                Last Run Results
              </div>
              <div className="mt-3 space-y-2">
                {results.map((result) => (
                  <div key={result.detection_type} className="flex items-center justify-between rounded-2xl bg-white p-3">
                    <span className="text-sm font-bold text-slate-950">{formatText(result.detection_type)}</span>
                    <span className="rounded-full bg-blue-50 px-3 py-1 text-xs font-black text-blue-700">
                      {result.records_created}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="rounded-[34px] border border-slate-200 bg-white p-6 shadow-[0_10px_30px_rgba(0,0,0,0.08)]">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="text-xs font-bold uppercase tracking-[0.35em] text-blue-600">
                Latest Smart Exceptions
              </div>
              <h3 className="mt-2 text-3xl font-bold text-slate-950">Action Queue</h3>
              <p className="mt-2 text-sm leading-6 text-slate-500">
                These are the items the system detected from clocking history.
              </p>
            </div>
          </div>

          <div className="mt-6 space-y-3">
            {smartExceptions.length === 0 ? (
              <div className="rounded-[26px] border border-dashed border-slate-200 bg-slate-50 p-8 text-center">
                <Zap className="mx-auto h-10 w-10 text-slate-300" />
                <div className="mt-3 text-lg font-bold text-slate-950">
                  No smart exceptions yet
                </div>
                <p className="mt-2 text-sm text-slate-500">
                  Run the detection engine to generate exceptions from clocking history.
                </p>
              </div>
            ) : (
              smartExceptions.slice(0, 12).map((item) => (
                <article key={item.id} className="rounded-[24px] border border-slate-200 bg-slate-50 p-5">
                  <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                    <div>
                      <div className="font-black text-slate-950">{formatText(item.exception_type)}</div>
                      <p className="mt-2 text-sm leading-6 text-slate-600">{item.description}</p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <span className={`rounded-full px-3 py-1 text-xs font-black uppercase ${severityClass(item.severity)}`}>
                        {item.severity}
                      </span>
                      <span className={`rounded-full px-3 py-1 text-xs font-black uppercase ${statusClass(item.status)}`}>
                        {formatText(item.status)}
                      </span>
                    </div>
                  </div>
                </article>
              ))
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

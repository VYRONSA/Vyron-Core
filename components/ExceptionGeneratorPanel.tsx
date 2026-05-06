"use client";

import React, { useState } from "react";
import { AlertTriangle, CheckCircle2, RefreshCcw, Zap } from "lucide-react";
import { supabase } from "../lib/supabase";

type ExceptionGeneratorResult = {
  generated_count: number;
  skipped_duplicate_count: number;
  clean_count: number;
  error_count: number;
};

function todayIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

export default function ExceptionGeneratorPanel({
  onGenerated,
}: {
  onGenerated?: () => void | Promise<void>;
}) {
  const [runDate, setRunDate] = useState(todayIsoDate());
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<ExceptionGeneratorResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function generateExceptions() {
    setRunning(true);
    setResult(null);
    setError(null);

    const { data, error: rpcError } = await supabase.rpc(
      "generate_exceptions_from_payroll_clock_checks",
      {
        p_shift_date: runDate,
      }
    );

    if (rpcError) {
      setError(rpcError.message);
      setRunning(false);
      return;
    }

    const firstResult = Array.isArray(data) ? data[0] : data;

    setResult({
      generated_count: Number(firstResult?.generated_count || 0),
      skipped_duplicate_count: Number(firstResult?.skipped_duplicate_count || 0),
      clean_count: Number(firstResult?.clean_count || 0),
      error_count: Number(firstResult?.error_count || 0),
    });

    if (onGenerated) {
      await onGenerated();
    }

    setRunning(false);
  }

  return (
    <section className="rounded-[34px] border border-slate-200/70 bg-white p-6 shadow-[0_10px_30px_rgba(0,0,0,0.08)]">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
        <div>
          <div className="text-xs font-bold uppercase tracking-[0.35em] text-blue-600">
            VYRON CORE
          </div>
          <h2 className="mt-2 text-3xl font-bold text-slate-950">
            Exception Auto-Generator
          </h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500">
            Generate manager-review exceptions from payroll clock checks. The engine avoids duplicate exceptions using a unique exception key.
          </p>
        </div>

        <div className="rounded-2xl bg-slate-950 p-3 text-cyan-300">
          <Zap className="h-6 w-6" />
        </div>
      </div>

      <div className="mt-6 grid gap-4 md:grid-cols-[1fr_auto] md:items-end">
        <label className="text-sm font-bold text-slate-800">
          Shift date to generate from
          <input
            type="date"
            value={runDate}
            onChange={(event) => setRunDate(event.target.value)}
            className="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 outline-none focus:border-blue-500"
          />
        </label>

        <button
          onClick={generateExceptions}
          disabled={running}
          className="flex items-center justify-center gap-2 rounded-2xl bg-slate-950 px-5 py-3 text-sm font-bold text-white disabled:opacity-60"
        >
          {running ? <RefreshCcw className="h-4 w-4 animate-spin" /> : <Zap className="h-4 w-4" />}
          {running ? "Generating..." : "Generate Exceptions"}
        </button>
      </div>

      {error && (
        <div className="mt-5 rounded-2xl bg-rose-50 p-4 text-sm font-semibold text-rose-700">
          <AlertTriangle className="mr-2 inline h-4 w-4" />
          {error}
        </div>
      )}

      {result && (
        <div className="mt-5 grid gap-4 md:grid-cols-4">
          <div className="rounded-2xl bg-emerald-50 p-4">
            <div className="flex items-center gap-2 text-xs font-black uppercase tracking-[0.2em] text-emerald-700">
              <CheckCircle2 className="h-4 w-4" />
              Generated
            </div>
            <div className="mt-2 text-3xl font-black text-emerald-800">
              {result.generated_count}
            </div>
          </div>

          <div className="rounded-2xl bg-blue-50 p-4">
            <div className="text-xs font-black uppercase tracking-[0.2em] text-blue-700">
              Duplicates skipped
            </div>
            <div className="mt-2 text-3xl font-black text-blue-800">
              {result.skipped_duplicate_count}
            </div>
          </div>

          <div className="rounded-2xl bg-slate-50 p-4">
            <div className="text-xs font-black uppercase tracking-[0.2em] text-slate-500">
              Clean checks
            </div>
            <div className="mt-2 text-3xl font-black text-slate-950">
              {result.clean_count}
            </div>
          </div>

          <div className="rounded-2xl bg-rose-50 p-4">
            <div className="text-xs font-black uppercase tracking-[0.2em] text-rose-700">
              Errors
            </div>
            <div className="mt-2 text-3xl font-black text-rose-800">
              {result.error_count}
            </div>
          </div>
        </div>
      )}

      <div className="mt-5 rounded-2xl bg-slate-50 p-4 text-sm leading-6 text-slate-600">
        This does not create duplicate exceptions. If the same employee, day and shift already has an auto-generated exception, it will be skipped.
      </div>
    </section>
  );
}

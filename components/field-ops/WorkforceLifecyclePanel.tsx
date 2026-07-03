"use client";

import React, { useEffect, useState } from "react";
import {
  ArrowDown,
  Brain,
  ChevronRight,
  RefreshCcw,
  Sparkles,
  UserRound,
  Users,
} from "lucide-react";
import {
  LIFECYCLE_STAGE_LABELS,
  lifecycleBandClass,
  loadWorkforceLifecycle,
  type LifecycleStage,
  type WorkforceLifecycleDashboard,
} from "@/lib/workforce-lifecycle";
import { supabase } from "@/lib/supabase";

type Props = {
  companyId: string;
};

function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

const STAGE_ORDER: LifecycleStage[] = [
  "need_staff",
  "recruit",
  "hire",
  "onboard",
  "manage",
  "develop",
  "promote",
  "retain",
  "exit",
];

export default function WorkforceLifecyclePanel({ companyId }: Props) {
  const [snapshotDate, setSnapshotDate] = useState(todayIsoDate);
  const [loading, setLoading] = useState(true);
  const [syncNote, setSyncNote] = useState<string | null>(null);
  const [selectedStage, setSelectedStage] = useState<LifecycleStage | null>(null);
  const [dashboard, setDashboard] = useState<WorkforceLifecycleDashboard | null>(null);

  async function load() {
    if (!companyId) return;
    setLoading(true);
    setSyncNote(null);
    const result = await loadWorkforceLifecycle(supabase, companyId, snapshotDate);
    setDashboard(result.dashboard);
    if (result.error) setSyncNote(result.error);
    setLoading(false);
  }

  useEffect(() => {
    void load();
  }, [companyId, snapshotDate]);

  const stageSignals = selectedStage
    ? dashboard?.signals.filter((s) => s.stage === selectedStage) || []
    : [];

  const stageEmployees = selectedStage
    ? dashboard?.employeeStatuses.filter((e) => e.currentStage === selectedStage) || []
    : [];

  return (
    <div className="space-y-6">
      <section className="rounded-[2rem] border border-white/80 bg-white/95 p-6 shadow-[0_18px_55px_rgba(15,23,42,0.12)]">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div>
            <div className="text-xs font-bold uppercase tracking-[0.35em] text-cyan-700">
              Workforce Lifecycle
            </div>
            <h2 className="mt-2 text-3xl font-black tracking-tight text-slate-950">
              Need Staff → Exit
            </h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-500">
              End-to-end people funnel mapped to VYRON CORE — rosters, employees, HR, risk, and
              payroll readiness. Each stage links to existing modules; no CORE redesign.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="date"
              value={snapshotDate}
              onChange={(e) => setSnapshotDate(e.target.value)}
              className="rounded-xl border border-slate-200 px-3 py-2 text-sm font-semibold"
            />
            <button
              type="button"
              onClick={() => void load()}
              className="inline-flex items-center gap-2 rounded-2xl border border-cyan-100 bg-cyan-50 px-4 py-3 text-sm font-black text-cyan-900"
            >
              <RefreshCcw className="h-4 w-4" />
              Refresh
            </button>
          </div>
        </div>

        {syncNote ? (
          <p className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-900">
            Sync note: {syncNote}
          </p>
        ) : null}

        {dashboard ? (
          <div className="mt-5 flex flex-wrap gap-4 text-sm font-bold text-slate-600">
            <span className="inline-flex items-center gap-2">
              <Users className="h-4 w-4 text-cyan-700" />
              {dashboard.totalActive} active
            </span>
            <span className="inline-flex items-center gap-2">
              <UserRound className="h-4 w-4 text-slate-500" />
              {dashboard.totalExited} exited
            </span>
          </div>
        ) : null}
      </section>

      {loading ? (
        <p className="text-sm font-semibold text-slate-500">Loading workforce lifecycle…</p>
      ) : !dashboard ? (
        <p className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-800">
          Unable to load lifecycle dashboard.
        </p>
      ) : (
        <>
          <section className="rounded-[2rem] border border-slate-200 bg-white p-6 shadow-sm">
            <h3 className="text-sm font-black uppercase tracking-wider text-slate-500">
              Lifecycle funnel
            </h3>
            <div className="mt-6 flex flex-col items-center gap-1">
              {STAGE_ORDER.map((stageKey, index) => {
                const metric = dashboard.funnel.find((f) => f.stage === stageKey);
                if (!metric) return null;
                const selected = selectedStage === stageKey;
                return (
                  <React.Fragment key={stageKey}>
                    <button
                      type="button"
                      onClick={() =>
                        setSelectedStage(selected ? null : stageKey)
                      }
                      className={`w-full max-w-2xl rounded-2xl border px-5 py-4 text-left transition ${
                        selected
                          ? "border-cyan-400 bg-cyan-50 shadow-md"
                          : "border-slate-200 bg-slate-50 hover:border-cyan-200 hover:bg-white"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-4">
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="text-lg font-black text-slate-900">
                              {metric.label}
                            </span>
                            <span
                              className={`rounded-full border px-2 py-0.5 text-[10px] font-black uppercase ${lifecycleBandClass(metric.band)}`}
                            >
                              {metric.band}
                            </span>
                          </div>
                          <p className="mt-1 text-xs font-medium text-slate-500">
                            {metric.coreModule}
                          </p>
                          <p className="mt-2 text-sm text-slate-700">{metric.summary}</p>
                        </div>
                        <div className="text-right">
                          <div className="text-3xl font-black text-cyan-800">{metric.count}</div>
                          {metric.signalCount > 0 ? (
                            <div className="text-[10px] font-bold uppercase text-amber-700">
                              {metric.signalCount} signal(s)
                            </div>
                          ) : null}
                          <ChevronRight
                            className={`ml-auto mt-2 h-5 w-5 text-slate-400 ${selected ? "rotate-90" : ""}`}
                          />
                        </div>
                      </div>
                    </button>
                    {index < STAGE_ORDER.length - 1 ? (
                      <ArrowDown className="h-5 w-5 text-slate-300" aria-hidden />
                    ) : null}
                  </React.Fragment>
                );
              })}
            </div>
          </section>

          {selectedStage ? (
            <section className="grid gap-4 lg:grid-cols-2">
              <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <h3 className="text-sm font-black text-slate-900">
                  {LIFECYCLE_STAGE_LABELS[selectedStage]} — signals
                </h3>
                {stageSignals.length === 0 ? (
                  <p className="mt-3 text-sm text-slate-500">No signals for this stage.</p>
                ) : (
                  <ul className="mt-3 space-y-2">
                    {stageSignals.slice(0, 12).map((s) => (
                      <li
                        key={s.id}
                        className="rounded-xl border border-slate-100 bg-slate-50 px-3 py-2 text-sm text-slate-700"
                      >
                        {s.message}
                      </li>
                    ))}
                  </ul>
                )}
              </article>
              <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <h3 className="text-sm font-black text-slate-900">
                  {LIFECYCLE_STAGE_LABELS[selectedStage]} — employees
                </h3>
                {stageEmployees.length === 0 ? (
                  <p className="mt-3 text-sm text-slate-500">
                    No employees currently tagged at this stage.
                  </p>
                ) : (
                  <ul className="mt-3 space-y-2">
                    {stageEmployees.slice(0, 12).map((e) => (
                      <li
                        key={e.employeeId}
                        className="rounded-xl border border-slate-100 bg-slate-50 px-3 py-2"
                      >
                        <p className="text-sm font-bold text-slate-900">{e.employeeLabel}</p>
                        <p className="text-xs text-slate-500">{e.reason}</p>
                      </li>
                    ))}
                  </ul>
                )}
              </article>
            </section>
          ) : null}

          <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="mb-4 flex items-center gap-2">
              <Brain className="h-5 w-5 text-violet-700" />
              <h3 className="text-sm font-black text-slate-900">AI recommendations</h3>
              <Sparkles className="h-4 w-4 text-violet-500" />
            </div>
            <div className="space-y-3">
              {dashboard.recommendations.map((r) => (
                <div
                  key={r.id}
                  className={`rounded-xl border px-4 py-3 ${
                    r.band === "red"
                      ? "border-rose-200 bg-rose-50"
                      : r.band === "amber"
                        ? "border-amber-200 bg-amber-50"
                        : "border-emerald-200 bg-emerald-50"
                  }`}
                >
                  <p className="text-xs font-black uppercase text-slate-500">
                    {LIFECYCLE_STAGE_LABELS[r.stage]}
                  </p>
                  <p className="mt-1 text-sm font-black text-slate-900">{r.title}</p>
                  <p className="mt-1 text-xs font-medium text-slate-700">{r.detail}</p>
                </div>
              ))}
            </div>
          </article>
        </>
      )}
    </div>
  );
}

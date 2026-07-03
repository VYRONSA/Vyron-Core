"use client";

import React, { useEffect, useState } from "react";
import {
  Activity,
  BarChart3,
  BookOpen,
  Brain,
  Building2,
  ClipboardList,
  HeartPulse,
  RefreshCcw,
  ShieldAlert,
  Sparkles,
  Users,
  Zap,
} from "lucide-react";
import {
  healthBandClass,
  loadWorkforceOperatingSystem,
  type WorkforceOperatingDashboard,
} from "@/lib/workforce-operating-system";
import { supabase } from "@/lib/supabase";

export type WorkforceOperatingView =
  | "executive"
  | "operational"
  | "dashboard"
  | "automation"
  | "health";

type Props = {
  companyId: string;
  initialView?: WorkforceOperatingView;
};

const VIEW_TABS: { id: WorkforceOperatingView; label: string; icon: React.ElementType }[] = [
  { id: "executive", label: "Executive", icon: Building2 },
  { id: "operational", label: "Operational", icon: Activity },
  { id: "dashboard", label: "Operating Dashboard", icon: BarChart3 },
  { id: "automation", label: "Automation Library", icon: BookOpen },
  { id: "health", label: "Health Score", icon: HeartPulse },
];

function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

export default function WorkforceOperatingSystemPanel({
  companyId,
  initialView = "executive",
}: Props) {
  const [view, setView] = useState<WorkforceOperatingView>(initialView);
  const [snapshotDate, setSnapshotDate] = useState(todayIsoDate);
  const [loading, setLoading] = useState(true);
  const [syncNote, setSyncNote] = useState<string | null>(null);
  const [dashboard, setDashboard] = useState<WorkforceOperatingDashboard | null>(null);

  useEffect(() => {
    setView(initialView);
  }, [initialView]);

  async function load() {
    if (!companyId) return;
    setLoading(true);
    setSyncNote(null);
    const result = await loadWorkforceOperatingSystem(supabase, companyId, snapshotDate);
    setDashboard(result.dashboard);
    if (result.error) setSyncNote(result.error);
    setLoading(false);
  }

  useEffect(() => {
    void load();
  }, [companyId, snapshotDate]);

  return (
    <div className="space-y-6">
      <header className="rounded-[2rem] border border-white/80 bg-gradient-to-br from-[#06101f] via-[#0b1a33] to-[#0f2847] p-6 text-white shadow-[0_18px_55px_rgba(15,23,42,0.2)]">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-[10px] font-black uppercase tracking-[0.35em] text-cyan-300">
              Workforce Operating System
            </p>
            <h1 className="mt-2 text-3xl font-black tracking-tight">Operational brain of the workforce</h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-300">
              Structured executive and operational command centres from existing CORE intelligence
              modules. No fake AI, no auto-execution — foundation only.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="date"
              value={snapshotDate}
              onChange={(e) => setSnapshotDate(e.target.value)}
              className="rounded-xl border border-white/20 bg-white/10 px-3 py-2 text-sm font-semibold text-white"
            />
            <button
              type="button"
              onClick={() => void load()}
              className="inline-flex items-center gap-2 rounded-xl bg-cyan-500 px-4 py-2 text-sm font-bold text-[#06101f]"
            >
              <RefreshCcw className="h-4 w-4" />
              Refresh
            </button>
          </div>
        </div>

        <nav className="mt-5 flex flex-wrap gap-2">
          {VIEW_TABS.map((tab) => {
            const Icon = tab.icon;
            const active = view === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setView(tab.id)}
                className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-bold ${
                  active
                    ? "border-cyan-400 bg-cyan-400 text-[#06101f]"
                    : "border-white/20 bg-white/5 text-slate-200 hover:bg-white/10"
                }`}
              >
                <Icon className="h-3.5 w-3.5" />
                {tab.label}
              </button>
            );
          })}
        </nav>

        {syncNote ? (
          <p className="mt-4 rounded-xl border border-amber-400/30 bg-amber-400/10 px-3 py-2 text-xs font-semibold text-amber-100">
            Sync note: {syncNote}
          </p>
        ) : null}
      </header>

      {loading ? (
        <p className="text-sm font-semibold text-slate-500">Loading workforce operating system…</p>
      ) : !dashboard ? (
        <p className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-800">
          Unable to load operating system dashboard.
        </p>
      ) : (
        <>
          {view === "executive" && <ExecutiveView dashboard={dashboard} />}
          {view === "operational" && <OperationalView dashboard={dashboard} />}
          {view === "dashboard" && <SummaryView dashboard={dashboard} />}
          {view === "automation" && <AutomationLibraryView dashboard={dashboard} />}
          {view === "health" && <HealthScoreView dashboard={dashboard} />}
        </>
      )}
    </div>
  );
}

function MetricCard({
  label,
  metric,
  icon: Icon,
}: {
  label: string;
  metric: { display: string; needsMoreData: boolean };
  icon: React.ElementType;
}) {
  return (
    <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-slate-500">
        <Icon className="h-4 w-4 text-cyan-700" />
        {label}
      </div>
      <p
        className={`mt-2 text-2xl font-black ${
          metric.needsMoreData ? "text-slate-400" : "text-slate-950"
        }`}
      >
        {metric.display}
      </p>
    </article>
  );
}

function ExecutiveView({ dashboard }: { dashboard: WorkforceOperatingDashboard }) {
  const e = dashboard.executive;
  return (
    <section className="space-y-4">
      <div className="rounded-2xl border border-cyan-100 bg-cyan-50/50 px-4 py-3">
        <p className="text-sm font-bold text-cyan-900">Executive Command Centre</p>
        <p className="text-xs text-cyan-800/80">
          Board-level workforce posture from clocking, leave, payroll, field, cost, risk &amp;
          recruitment signals.
        </p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="Workforce Health" metric={e.workforceHealth} icon={HeartPulse} />
        <MetricCard label="Labour Cost" metric={e.labourCost} icon={BarChart3} />
        <MetricCard label="Payroll Readiness" metric={e.payrollReadiness} icon={ClipboardList} />
        <MetricCard label="Productivity" metric={e.productivity} icon={Zap} />
        <MetricCard label="Workforce Risk" metric={e.workforceRisk} icon={ShieldAlert} />
        <MetricCard label="Open Vacancies" metric={e.openVacancies} icon={Users} />
        <MetricCard label="Active Field Jobs" metric={e.activeFieldJobs} icon={Activity} />
        <MetricCard label="Predicted Leakage" metric={e.predictedLeakage} icon={BarChart3} />
      </div>
      <InsightsBlock insights={dashboard.insights} />
    </section>
  );
}

function OperationalView({ dashboard }: { dashboard: WorkforceOperatingDashboard }) {
  const o = dashboard.operational;
  return (
    <section className="space-y-4">
      <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
        <p className="text-sm font-bold text-slate-900">Operational Command Centre</p>
        <p className="text-xs text-slate-500">Live operations manager view from existing CORE data.</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="Employees Working" metric={o.employeesWorking} icon={Users} />
        <MetricCard label="Employees Travelling" metric={o.employeesTravelling} icon={Activity} />
        <MetricCard label="Employees On Site" metric={o.employeesOnSite} icon={Building2} />
        <MetricCard label="Employees On Leave" metric={o.employeesOnLeave} icon={ClipboardList} />
        <MetricCard label="Active Jobs" metric={o.activeJobs} icon={Zap} />
        <MetricCard label="Delayed Jobs" metric={o.delayedJobs} icon={ShieldAlert} />
        <MetricCard label="Exceptions" metric={o.exceptions} icon={ShieldAlert} />
        <MetricCard label="High Risk Employees" metric={o.highRiskEmployees} icon={HeartPulse} />
      </div>
      <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="mb-4 text-sm font-black text-slate-900">Live activity feed</h2>
        {o.activityFeed.length === 0 ? (
          <p className="text-sm text-slate-500">No recent clock or field activity.</p>
        ) : (
          <ul className="max-h-80 space-y-2 overflow-y-auto">
            {o.activityFeed.map((item) => (
              <li
                key={item.id}
                className="flex items-start justify-between gap-4 rounded-xl border border-slate-100 bg-slate-50 px-4 py-3"
              >
                <div>
                  <p className="text-sm font-bold text-slate-900">{item.label}</p>
                  <p className="text-xs text-slate-600">{item.detail}</p>
                </div>
                <time className="shrink-0 text-[10px] font-semibold text-slate-400">
                  {new Date(item.time).toLocaleString()}
                </time>
              </li>
            ))}
          </ul>
        )}
      </article>
    </section>
  );
}

function SummaryView({ dashboard }: { dashboard: WorkforceOperatingDashboard }) {
  const s = dashboard.summary;
  return (
    <section className="space-y-4">
      <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
        <p className="text-sm font-bold text-slate-900">Workforce Operating Dashboard</p>
        <p className="text-xs text-slate-500">High-level summary across all intelligence modules.</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="Workforce Health" metric={s.workforceHealth} icon={HeartPulse} />
        <MetricCard label="Workforce Risk" metric={s.workforceRisk} icon={ShieldAlert} />
        <MetricCard label="Payroll Readiness" metric={s.payrollReadiness} icon={ClipboardList} />
        <MetricCard label="Labour Cost" metric={s.labourCost} icon={BarChart3} />
        <MetricCard label="Productivity" metric={s.productivity} icon={Zap} />
        <MetricCard label="Hiring Readiness" metric={s.hiringReadiness} icon={Users} />
        <MetricCard label="Field Operations Health" metric={s.fieldOperationsHealth} icon={Activity} />
      </div>
      <RecommendationsBlock recommendations={dashboard.recommendations} />
    </section>
  );
}

function AutomationLibraryView({ dashboard }: { dashboard: WorkforceOperatingDashboard }) {
  return (
    <section className="space-y-4">
      <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3">
        <p className="text-sm font-bold text-amber-900">Automation Library — templates only</p>
        <p className="text-xs text-amber-800">
          Safe workflow templates. Nothing executes automatically. Manager approval required for all
          actions when enabled in future phases.
        </p>
      </div>
      <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
        <table className="w-full min-w-[800px] text-left text-sm">
          <thead>
            <tr className="border-b bg-slate-50 text-xs font-bold uppercase text-slate-500">
              <th className="px-4 py-3">Template</th>
              <th className="px-4 py-3">Trigger</th>
              <th className="px-4 py-3">Approval</th>
              <th className="px-4 py-3">Action</th>
              <th className="px-4 py-3">Risk</th>
              <th className="px-4 py-3">Status</th>
            </tr>
          </thead>
          <tbody>
            {dashboard.automationTemplates.map((t) => (
              <tr key={t.templateKey} className="border-b border-slate-50">
                <td className="px-4 py-3 font-bold text-slate-900">{t.templateName}</td>
                <td className="px-4 py-3 text-slate-600">{t.triggerDescription}</td>
                <td className="px-4 py-3">{t.requiredApproval ? "Required" : "No"}</td>
                <td className="px-4 py-3">{t.actionType}</td>
                <td className="px-4 py-3 capitalize">{t.riskLevel}</td>
                <td className="px-4 py-3">
                  <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] font-black uppercase">
                    {t.status}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function HealthScoreView({ dashboard }: { dashboard: WorkforceOperatingDashboard }) {
  const hs = dashboard.healthScore;
  return (
    <section className="space-y-4">
      <article className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-xs font-bold uppercase tracking-wider text-slate-500">
              Workforce Health Score
            </p>
            <p
              className={`mt-2 text-5xl font-black ${
                hs.needsMoreData ? "text-slate-400" : "text-slate-950"
              }`}
            >
              {hs.needsMoreData || hs.overallScore == null
                ? "Needs more data"
                : `${hs.overallScore}%`}
            </p>
          </div>
          {hs.overallBand ? (
            <span
              className={`rounded-full border px-4 py-2 text-sm font-black uppercase ${healthBandClass(hs.overallBand)}`}
            >
              {hs.overallBand}
            </span>
          ) : null}
        </div>
        <p className="mt-3 text-xs text-slate-500">
          0–39 Red · 40–69 Amber · 70–100 Green. Requires at least 3 module signals.
        </p>
      </article>
      <div className="grid gap-3 md:grid-cols-2">
        {hs.categories.map((c) => (
          <article
            key={c.key}
            className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"
          >
            <div className="flex items-center justify-between">
              <p className="text-sm font-bold text-slate-900">{c.label}</p>
              {c.band ? (
                <span
                  className={`rounded-full border px-2 py-0.5 text-[10px] font-black uppercase ${healthBandClass(c.band)}`}
                >
                  {c.band}
                </span>
              ) : null}
            </div>
            <p
              className={`mt-2 text-2xl font-black ${
                c.needsMoreData ? "text-slate-400" : "text-slate-950"
              }`}
            >
              {c.needsMoreData ? "Needs more data" : `${c.score}%`}
            </p>
          </article>
        ))}
      </div>
    </section>
  );
}

function InsightsBlock({ insights }: { insights: WorkforceOperatingDashboard["insights"] }) {
  if (insights.length === 0) return null;
  return (
    <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="mb-4 flex items-center gap-2">
        <Brain className="h-5 w-5 text-cyan-700" />
        <h2 className="text-sm font-black text-slate-900">Operating insights</h2>
      </div>
      <div className="space-y-2">
        {insights.map((i) => (
          <div
            key={i.id}
            className={`rounded-xl border px-4 py-3 ${
              i.severity === "critical"
                ? "border-rose-200 bg-rose-50"
                : i.severity === "warning"
                  ? "border-amber-200 bg-amber-50"
                  : "border-slate-100 bg-slate-50"
            }`}
          >
            <p className="text-sm font-bold text-slate-900">{i.title}</p>
            <p className="text-xs text-slate-600">{i.detail}</p>
          </div>
        ))}
      </div>
    </article>
  );
}

function RecommendationsBlock({
  recommendations,
}: {
  recommendations: WorkforceOperatingDashboard["recommendations"];
}) {
  return (
    <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="mb-4 flex items-center gap-2">
        <Sparkles className="h-5 w-5 text-violet-600" />
        <h2 className="text-sm font-black text-slate-900">AI recommendations</h2>
      </div>
      <p className="mb-3 text-xs text-slate-500">
        Structured recommendations from real module signals — not generative fiction.
      </p>
      <div className="space-y-2">
        {recommendations.map((r) => (
          <div key={r.id} className="rounded-xl border border-slate-100 bg-slate-50 px-4 py-3">
            <p className="text-sm font-bold text-slate-900">{r.title}</p>
            <p className="text-xs text-slate-600">{r.detail}</p>
          </div>
        ))}
      </div>
    </article>
  );
}

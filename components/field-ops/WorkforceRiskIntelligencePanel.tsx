"use client";

import React, { useEffect, useState } from "react";
import {
  AlertTriangle,
  BarChart3,
  Brain,
  Building2,
  Clock,
  RefreshCcw,
  ShieldAlert,
  Sparkles,
  UserRound,
  Users,
  Zap,
} from "lucide-react";
import {
  loadWorkforceRiskDashboard,
  riskBandClass,
  scoreToRiskBand,
  type WorkforceRiskBand,
  type WorkforceRiskEvent,
  type WorkforceRiskRecommendation,
  type WorkforceRiskScoreRow,
} from "@/lib/workforce-risk-intelligence";
import { supabase } from "@/lib/supabase";

type Props = {
  companyId: string;
};

function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function BandPill({ band }: { band: WorkforceRiskBand }) {
  return (
    <span
      className={`rounded-full border px-2.5 py-1 text-[10px] font-black uppercase tracking-wider ${riskBandClass(band)}`}
    >
      {band}
    </span>
  );
}

export default function WorkforceRiskIntelligencePanel({ companyId }: Props) {
  const [scoreDate, setScoreDate] = useState(todayIsoDate);
  const [loading, setLoading] = useState(true);
  const [syncNote, setSyncNote] = useState<string | null>(null);
  const [dashboard, setDashboard] = useState<
    Awaited<ReturnType<typeof loadWorkforceRiskDashboard>>["dashboard"]
  >(null);

  async function load() {
    if (!companyId) return;
    setLoading(true);
    setSyncNote(null);
    const result = await loadWorkforceRiskDashboard(supabase, companyId, scoreDate);
    setDashboard(result.dashboard);
    if (result.error) setSyncNote(result.error);
    setLoading(false);
  }

  useEffect(() => {
    void load();
  }, [companyId, scoreDate]);

  const cs = dashboard?.categorySummary;
  const overallBand = dashboard ? scoreToRiskBand(dashboard.workforceRiskIndex) : "green";

  const summaryCards = [
    {
      label: "Overall Workforce Risk",
      value: dashboard ? `${dashboard.workforceRiskIndex}` : "—",
      sub: overallBand,
      icon: BarChart3,
    },
    {
      label: "High Risk Employees",
      value: dashboard ? String(dashboard.highRiskEmployeeCount) : "—",
      sub: "score ≥ 70",
      icon: Users,
    },
    {
      label: "High Risk Stores",
      value: dashboard ? String(dashboard.highRiskStoreCount) : "—",
      sub: "score ≥ 70",
      icon: Building2,
    },
    {
      label: "High Risk Managers",
      value: dashboard ? String(dashboard.highRiskManagerCount) : "—",
      sub: "score ≥ 70",
      icon: UserRound,
    },
    {
      label: "Payroll Leakage Risk",
      value: cs ? `${cs.payrollLeakageRisk}` : "—",
      sub: cs ? scoreToRiskBand(cs.payrollLeakageRisk) : "",
      icon: AlertTriangle,
    },
    {
      label: "Burnout Risk",
      value: cs ? `${cs.burnoutRisk}` : "—",
      sub: cs ? scoreToRiskBand(cs.burnoutRisk) : "",
      icon: Zap,
    },
    {
      label: "Overtime Abuse Risk",
      value: cs ? `${cs.overtimeRisk}` : "—",
      sub: cs ? scoreToRiskBand(cs.overtimeRisk) : "",
      icon: Clock,
    },
    {
      label: "Attendance Risk",
      value: cs ? `${cs.attendanceRisk}` : "—",
      sub: cs ? scoreToRiskBand(cs.attendanceRisk) : "",
      icon: ShieldAlert,
    },
  ];

  return (
    <div className="space-y-6">
      <section className="rounded-[2rem] border border-white/80 bg-white/95 p-6 shadow-[0_18px_55px_rgba(15,23,42,0.12)]">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div>
            <div className="text-xs font-bold uppercase tracking-[0.35em] text-cyan-700">
              Workforce Risk Intelligence
            </div>
            <h2 className="mt-2 text-3xl font-black tracking-tight text-slate-950">
              Workforce Intelligence Dashboard
            </h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-500">
              Unified risk scoring (0–100) across attendance, overtime, payroll leakage, burnout,
              resignation, manager, store, and field operations — from clocking, field ops, travel,
              cost, leave, roster, and payroll readiness. Green 0–39 · Amber 40–69 · Red 70–100.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void load()}
            className="inline-flex items-center gap-2 rounded-2xl border border-cyan-100 bg-cyan-50 px-4 py-3 text-sm font-black text-cyan-900"
          >
            <RefreshCcw className="h-4 w-4" />
            Refresh
          </button>
        </div>

        <div className="mt-4">
          <label className="text-xs font-black uppercase tracking-wider text-slate-500">
            Score date
            <input
              type="date"
              value={scoreDate}
              onChange={(e) => setScoreDate(e.target.value)}
              className="mt-1 block rounded-xl border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-800"
            />
          </label>
        </div>

        {syncNote && (
          <p className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-950">
            {syncNote}
          </p>
        )}
        {!loading && !dashboard?.tablesAvailable && (
          <p className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-950">
            Run{" "}
            <code className="rounded bg-white px-1">sql/019-workforce-risk-intelligence.sql</code>{" "}
            (and <code className="rounded bg-white px-1">sql/021-workforce-risk-phase4d-extend.sql</code>{" "}
            if already migrated) in Supabase, then refresh.
          </p>
        )}
      </section>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {summaryCards.map((card) => (
          <div
            key={card.label}
            className="rounded-[1.5rem] border border-white/80 bg-white/95 p-5 shadow-sm"
          >
            <card.icon className="h-5 w-5 text-cyan-700" />
            <div className="mt-4 flex flex-wrap items-end gap-2">
              <div className="text-3xl font-black text-slate-950">
                {loading ? "…" : card.value}
              </div>
              {!loading && card.sub && (
                <BandPill band={card.sub as WorkforceRiskBand} />
              )}
            </div>
            <div className="text-xs font-black uppercase tracking-wider text-slate-500">
              {card.label}
            </div>
          </div>
        ))}
      </section>

      <section className="rounded-[2rem] border border-white/80 bg-white/95 p-6 shadow-sm">
        <div className="flex items-center gap-2">
          <Sparkles className="h-5 w-5 text-violet-600" />
          <h3 className="text-lg font-black text-slate-950">AI Recommendations</h3>
        </div>
        <div className="mt-4 space-y-3">
          {loading ? (
            <p className="text-sm font-semibold text-slate-500">Generating recommendations…</p>
          ) : !dashboard?.recommendations.length ? (
            <p className="text-sm font-semibold text-slate-500">No recommendations.</p>
          ) : (
            dashboard.recommendations.map((rec) => (
              <RecommendationRow key={rec.id} rec={rec} />
            ))
          )}
        </div>
      </section>

      <section className="grid gap-6 xl:grid-cols-3">
        <RiskList
          title="Top Risk Employees"
          icon={Users}
          rows={dashboard?.topRiskEmployees || []}
          loading={loading}
          empty="No employee risk scores."
        />
        <RiskList
          title="Top Risk Stores"
          icon={Building2}
          rows={dashboard?.topRiskStores || []}
          loading={loading}
          empty="No store risk scores."
        />
        <RiskList
          title="Top Risk Managers"
          icon={UserRound}
          rows={dashboard?.topRiskManagers || []}
          loading={loading}
          empty="No manager risk scores."
        />
      </section>

      <section className="rounded-[2rem] border border-white/80 bg-white/95 p-6 shadow-sm">
        <div className="flex items-center gap-2">
          <AlertTriangle className="h-5 w-5 text-rose-600" />
          <h3 className="text-lg font-black text-slate-950">Recent Risk Events</h3>
        </div>
        <div className="mt-4 overflow-x-auto">
          <table className="min-w-full text-left text-xs">
            <thead>
              <tr className="text-[10px] font-black uppercase tracking-wider text-slate-500">
                <th className="px-2 py-2">Category</th>
                <th className="px-2 py-2">Message</th>
                <th className="px-2 py-2">Score</th>
                <th className="px-2 py-2">Severity</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={4} className="px-2 py-3 text-slate-500">
                    Loading…
                  </td>
                </tr>
              ) : !dashboard?.events.length ? (
                <tr>
                  <td colSpan={4} className="px-2 py-3 text-slate-500">
                    No risk events for this date.
                  </td>
                </tr>
              ) : (
                dashboard.events.slice(0, 20).map((ev, idx) => (
                  <RiskEventRow key={`${ev.entityId}-${ev.category}-${idx}`} ev={ev} />
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-[2rem] border border-white/80 bg-white/95 p-6 shadow-sm">
        <div className="flex items-center gap-2">
          <Brain className="h-5 w-5 text-cyan-700" />
          <h3 className="text-lg font-black text-slate-950">Risk category heatmap</h3>
        </div>
        <div className="mt-4 overflow-x-auto">
          <table className="min-w-full text-left text-xs">
            <thead>
              <tr className="text-[10px] font-black uppercase tracking-wider text-slate-500">
                <th className="px-2 py-2">Employee</th>
                <th className="px-2 py-2">Attend</th>
                <th className="px-2 py-2">OT</th>
                <th className="px-2 py-2">Leakage</th>
                <th className="px-2 py-2">Burnout</th>
                <th className="px-2 py-2">Resign</th>
                <th className="px-2 py-2">Field Ops</th>
                <th className="px-2 py-2">Overall</th>
                <th className="px-2 py-2">Band</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={9} className="px-2 py-3 text-slate-500">
                    Loading…
                  </td>
                </tr>
              ) : !dashboard?.employeeScores.length ? (
                <tr>
                  <td colSpan={9} className="px-2 py-3 text-slate-500">
                    No scores.
                  </td>
                </tr>
              ) : (
                dashboard.employeeScores.slice(0, 15).map((row) => (
                  <tr key={row.entityId} className="border-t border-slate-200">
                    <td className="px-2 py-2 font-bold text-slate-900">{row.entityLabel}</td>
                    <td className="px-2 py-2">{row.categories["Attendance Risk"]}</td>
                    <td className="px-2 py-2">{row.categories["Overtime Risk"]}</td>
                    <td className="px-2 py-2">{row.categories["Payroll Leakage Risk"]}</td>
                    <td className="px-2 py-2">{row.categories["Burnout Risk"]}</td>
                    <td className="px-2 py-2">{row.categories["Resignation Risk"]}</td>
                    <td className="px-2 py-2">{row.categories["Field Operations Risk"]}</td>
                    <td className="px-2 py-2 font-black">{row.overallScore}</td>
                    <td className="px-2 py-2">
                      <BandPill band={row.riskBand} />
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function RiskEventRow({ ev }: { ev: WorkforceRiskEvent }) {
  return (
    <tr className="border-t border-slate-200">
      <td className="px-2 py-2 font-bold text-slate-800">{ev.category}</td>
      <td className="px-2 py-2 text-slate-700">{ev.message}</td>
      <td className="px-2 py-2 font-black">{ev.score}</td>
      <td className="px-2 py-2">
        <BandPill band={ev.severity} />
      </td>
    </tr>
  );
}

function RecommendationRow({ rec }: { rec: WorkforceRiskRecommendation }) {
  return (
    <div className={`rounded-2xl border px-4 py-3 ${riskBandClass(rec.band)}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="font-black">{rec.title}</div>
        <BandPill band={rec.band} />
      </div>
      <p className="mt-1 text-sm font-semibold">{rec.detail}</p>
    </div>
  );
}

function RiskList({
  title,
  icon: Icon,
  rows,
  loading,
  empty,
}: {
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  rows: WorkforceRiskScoreRow[];
  loading: boolean;
  empty: string;
}) {
  return (
    <div className="rounded-[2rem] border border-white/80 bg-white/95 p-6 shadow-sm">
      <div className="flex items-center gap-2">
        <Icon className="h-5 w-5 text-cyan-700" />
        <h3 className="text-lg font-black text-slate-950">{title}</h3>
      </div>
      <div className="mt-4 space-y-3">
        {loading ? (
          <p className="text-sm font-semibold text-slate-500">Loading…</p>
        ) : rows.length === 0 ? (
          <p className="text-sm font-semibold text-slate-500">{empty}</p>
        ) : (
          rows.map((row) => (
            <div
              key={`${row.entityType}-${row.entityId}`}
              className="rounded-2xl border border-slate-100 bg-slate-50/80 px-4 py-3"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="font-bold text-slate-950">{row.entityLabel}</div>
                <BandPill band={row.riskBand} />
              </div>
              <div className="mt-1 text-xs font-semibold text-slate-600">
                Score {row.overallScore}/100
              </div>
              {row.factors.length > 0 && (
                <div className="mt-2 text-xs text-slate-500">{row.factors.slice(0, 2).join(" · ")}</div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

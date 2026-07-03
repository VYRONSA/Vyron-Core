"use client";

import React, { useEffect, useState } from "react";
import {
  BarChart3,
  Brain,
  Briefcase,
  Calendar,
  ClipboardList,
  GraduationCap,
  RefreshCcw,
  Sparkles,
  Target,
  TrendingUp,
  UserPlus,
  Users,
} from "lucide-react";
import {
  loadRecruitmentIntelligence,
  recruitmentScoreBandClass,
  successionBandClass,
  type RecruitmentIntelligenceDashboard,
} from "@/lib/recruitment-intelligence";
import { supabase } from "@/lib/supabase";

export type RecruitmentIntelligenceView =
  | "dashboard"
  | "vacancies"
  | "applicants"
  | "interviews"
  | "skills"
  | "succession";

type Props = {
  companyId: string;
  initialView?: RecruitmentIntelligenceView;
};

const VIEW_TABS: { id: RecruitmentIntelligenceView; label: string; icon: React.ElementType }[] = [
  { id: "dashboard", label: "Intelligence", icon: BarChart3 },
  { id: "vacancies", label: "Vacancies", icon: Briefcase },
  { id: "applicants", label: "Applicants", icon: UserPlus },
  { id: "interviews", label: "Interviews", icon: Calendar },
  { id: "skills", label: "Skills", icon: GraduationCap },
  { id: "succession", label: "Succession", icon: Target },
];

function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

export default function RecruitmentIntelligencePanel({
  companyId,
  initialView = "dashboard",
}: Props) {
  const [view, setView] = useState<RecruitmentIntelligenceView>(initialView);
  const [analysisDate, setAnalysisDate] = useState(todayIsoDate);
  const [loading, setLoading] = useState(true);
  const [syncNote, setSyncNote] = useState<string | null>(null);
  const [dashboard, setDashboard] = useState<RecruitmentIntelligenceDashboard | null>(null);

  useEffect(() => {
    setView(initialView);
  }, [initialView]);

  async function load() {
    if (!companyId) return;
    setLoading(true);
    setSyncNote(null);
    const result = await loadRecruitmentIntelligence(supabase, companyId, analysisDate);
    setDashboard(result.dashboard);
    if (result.error) setSyncNote(result.error);
    setLoading(false);
  }

  useEffect(() => {
    void load();
  }, [companyId, analysisDate]);

  const fc = dashboard?.hiringForecast;

  return (
    <div className="space-y-6">
      <header className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-[10px] font-black uppercase tracking-[0.2em] text-violet-700">
              VYRON CORE · Phase 8
            </p>
            <h1 className="mt-1 text-2xl font-black text-slate-950">Recruitment Intelligence</h1>
            <p className="mt-2 max-w-2xl text-sm font-medium text-slate-600">
              Hiring forecast, applicant scoring, skills intelligence, succession planning, and
              workforce gap analysis — integrated with rosters, employees, and risk signals.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="date"
              value={analysisDate}
              onChange={(e) => setAnalysisDate(e.target.value)}
              className="rounded-xl border border-slate-200 px-3 py-2 text-sm font-semibold"
            />
            <button
              type="button"
              onClick={() => void load()}
              className="inline-flex items-center gap-2 rounded-xl bg-violet-700 px-4 py-2 text-sm font-bold text-white hover:bg-violet-800"
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
                    ? "border-violet-700 bg-violet-700 text-white"
                    : "border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100"
                }`}
              >
                <Icon className="h-3.5 w-3.5" />
                {tab.label}
              </button>
            );
          })}
        </nav>

        {syncNote ? (
          <p className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-900">
            Sync note: {syncNote}
          </p>
        ) : null}
      </header>

      {loading ? (
        <p className="text-sm font-semibold text-slate-500">Computing recruitment intelligence…</p>
      ) : !dashboard ? (
        <p className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-800">
          Unable to load recruitment intelligence.
        </p>
      ) : (
        <>
          {(view === "dashboard" || view === "vacancies") && (
            <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <MetricCard
                label="Open vacancies"
                value={String(dashboard.openVacancyCount)}
                icon={Briefcase}
              />
              <MetricCard
                label="Pipeline applicants"
                value={String(dashboard.pipelineApplicantCount)}
                icon={Users}
              />
              <MetricCard
                label="Future hiring needs"
                value={fc ? String(fc.futureHiringNeeds) : "—"}
                icon={TrendingUp}
              />
              <MetricCard
                label="Skills shortages"
                value={fc ? String(fc.skillsShortages) : "—"}
                icon={GraduationCap}
              />
            </section>
          )}

          {view === "dashboard" && (
            <>
              <section className="grid gap-4 lg:grid-cols-2">
                <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                  <div className="mb-4 flex items-center gap-2">
                    <TrendingUp className="h-5 w-5 text-violet-700" />
                    <h2 className="text-sm font-black text-slate-900">Hiring forecast engine</h2>
                  </div>
                  {fc?.needsMoreData ? (
                    <p className="text-sm text-slate-500">
                      Needs more data — add vacancies, applicants, or roster shifts for a fuller
                      forecast.
                    </p>
                  ) : null}
                  <div className="grid gap-3 sm:grid-cols-2">
                    <ForecastTile label="Future hiring needs" value={fc?.futureHiringNeeds ?? 0} />
                    <ForecastTile label="Skills shortages" value={fc?.skillsShortages ?? 0} />
                    <ForecastTile label="High-risk positions" value={fc?.highRiskPositions ?? 0} />
                    <ForecastTile
                      label="Internal promotions"
                      value={fc?.internalPromotionOpportunities ?? 0}
                    />
                  </div>
                  {fc && fc.drivers.length > 0 ? (
                    <ul className="mt-4 space-y-2">
                      {fc.drivers.map((d) => (
                        <li
                          key={d.label}
                          className="rounded-xl border border-slate-100 bg-slate-50 px-3 py-2 text-sm"
                        >
                          <span className="font-bold text-slate-900">{d.label}:</span> {d.count} —{" "}
                          {d.detail}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </article>

                <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                  <div className="mb-4 flex items-center gap-2">
                    <ClipboardList className="h-5 w-5 text-violet-700" />
                    <h2 className="text-sm font-black text-slate-900">Workforce gap analysis</h2>
                  </div>
                  {dashboard.workforceGaps.length === 0 ? (
                    <p className="text-sm text-slate-500">No workforce gaps detected.</p>
                  ) : (
                    <ul className="max-h-64 space-y-2 overflow-y-auto">
                      {dashboard.workforceGaps.slice(0, 10).map((g) => (
                        <li
                          key={g.id}
                          className={`rounded-xl border px-3 py-2 text-sm ${
                            g.severity === "critical"
                              ? "border-rose-200 bg-rose-50"
                              : g.severity === "warning"
                                ? "border-amber-200 bg-amber-50"
                                : "border-slate-100 bg-slate-50"
                          }`}
                        >
                          {g.message}
                        </li>
                      ))}
                    </ul>
                  )}
                </article>
              </section>

              <RecommendationsBlock recommendations={dashboard.recommendations} />
            </>
          )}

          {view === "vacancies" && (
            <DataTable
              title="Vacancies"
              empty="No vacancies logged. Gaps are still modelled from roster coverage."
              headers={["Ref", "Title", "Store", "Status", "Priority", "Headcount"]}
              rows={dashboard.vacancies.map((v) => [
                v.vacancyRef,
                v.title,
                v.storeName || "—",
                v.status,
                v.priority,
                String(v.headcount),
              ])}
            />
          )}

          {view === "applicants" && (
            <section className="space-y-4">
              <DataTable
                title="Applicants"
                empty="No applicants in pipeline."
                headers={["Ref", "Name", "Vacancy", "Status", "Experience"]}
                rows={dashboard.applicants.map((a) => [
                  a.applicantRef,
                  a.fullName,
                  a.vacancyTitle || "—",
                  a.status,
                  `${a.yearsExperience}y`,
                ])}
              />
              <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <h2 className="mb-4 text-sm font-black text-slate-900">Applicant scoring engine</h2>
                {dashboard.applicantScores.length === 0 ? (
                  <p className="text-sm text-slate-500">No applicants to score.</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[720px] text-left text-sm">
                      <thead>
                        <tr className="border-b text-xs font-bold uppercase text-slate-500">
                          <th className="py-2 pr-4">Applicant</th>
                          <th className="py-2 pr-4">Overall</th>
                          <th className="py-2 pr-4">Experience</th>
                          <th className="py-2 pr-4">Skills</th>
                          <th className="py-2 pr-4">Location</th>
                          <th className="py-2 pr-4">Salary</th>
                          <th className="py-2">Band</th>
                        </tr>
                      </thead>
                      <tbody>
                        {dashboard.applicantScores.map((s) => (
                          <tr key={s.applicantId} className="border-b border-slate-50">
                            <td className="py-3 pr-4 font-semibold">{s.applicantName}</td>
                            <td className="py-3 pr-4 font-black">{s.overallScore}</td>
                            <td className="py-3 pr-4">{s.experienceScore}</td>
                            <td className="py-3 pr-4">{s.skillsMatchScore}</td>
                            <td className="py-3 pr-4">{s.locationMatchScore}</td>
                            <td className="py-3 pr-4">{s.salaryFitScore}</td>
                            <td className="py-3">
                              <span
                                className={`rounded-full border px-2 py-0.5 text-[10px] font-black uppercase ${recruitmentScoreBandClass(s.band)}`}
                              >
                                {s.band}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </article>
            </section>
          )}

          {view === "interviews" && (
            <DataTable
              title="Interviews"
              empty="No interviews scheduled."
              headers={["Applicant", "Vacancy", "Type", "Scheduled", "Status"]}
              rows={dashboard.interviews.map((i) => [
                i.applicantName,
                i.vacancyTitle || "—",
                i.interviewType,
                i.scheduledAt ? new Date(i.scheduledAt).toLocaleString() : "—",
                i.status,
              ])}
            />
          )}

          {view === "skills" && (
            <section className="space-y-4">
              <DataTable
                title="Skills registry"
                empty="Skills registry empty."
                headers={["Skill", "Category", "Employees with skill"]}
                rows={dashboard.skillsRegistry.map((s) => [
                  s.skillName,
                  s.category,
                  String(s.employeeCount),
                ])}
              />
              <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <h2 className="mb-4 text-sm font-black text-slate-900">Missing skills & shortages</h2>
                <ul className="space-y-2">
                  {dashboard.workforceGaps
                    .filter((g) => g.gapType === "missing_skill" || g.gapType === "high_risk_role")
                    .map((g) => (
                      <li
                        key={g.id}
                        className="rounded-xl border border-amber-100 bg-amber-50 px-3 py-2 text-sm text-amber-900"
                      >
                        {g.message}
                      </li>
                    ))}
                </ul>
              </article>
            </section>
          )}

          {view === "succession" && (
            <section className="space-y-4">
              <article className="rounded-2xl border border-violet-200 bg-violet-50 p-5">
                <h2 className="text-sm font-black text-violet-900">Succession planning</h2>
                <p className="mt-1 text-sm text-violet-800">
                  Supervisors, managers, and role successors identified from job titles, skills, and
                  workforce risk.
                </p>
              </article>
              {(["supervisor", "manager", "successor"] as const).map((type) => {
                const rows = dashboard.successionCandidates.filter((c) => c.successionType === type);
                return (
                  <article
                    key={type}
                    className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
                  >
                    <h3 className="mb-3 text-sm font-black capitalize text-slate-900">
                      Potential {type === "successor" ? "successors" : `${type}s`}
                    </h3>
                    {rows.length === 0 ? (
                      <p className="text-sm text-slate-500">No candidates identified.</p>
                    ) : (
                      <ul className="space-y-2">
                        {rows.slice(0, 8).map((c) => (
                          <li
                            key={`${c.employeeId}-${c.successionType}`}
                            className="flex items-center justify-between gap-4 rounded-xl border border-slate-100 bg-slate-50 px-4 py-3"
                          >
                            <div>
                              <p className="font-bold text-slate-900">{c.employeeLabel}</p>
                              <p className="text-xs text-slate-500">
                                {c.targetRole} · {c.jobTitle || "—"}
                              </p>
                            </div>
                            <div className="text-right">
                              <p className="text-lg font-black text-violet-800">{c.readinessScore}</p>
                              <span
                                className={`rounded-full border px-2 py-0.5 text-[10px] font-black uppercase ${successionBandClass(c.readinessBand)}`}
                              >
                                {c.readinessBand.replace("_", " ")}
                              </span>
                            </div>
                          </li>
                        ))}
                      </ul>
                    )}
                  </article>
                );
              })}
            </section>
          )}
        </>
      )}
    </div>
  );
}

function MetricCard({
  label,
  value,
  icon: Icon,
}: {
  label: string;
  value: string;
  icon: React.ElementType;
}) {
  return (
    <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-center gap-2 text-xs font-bold uppercase text-slate-500">
        <Icon className="h-4 w-4 text-violet-600" />
        {label}
      </div>
      <p className="mt-2 text-3xl font-black text-slate-950">{value}</p>
    </article>
  );
}

function ForecastTile({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-slate-100 bg-slate-50 p-3">
      <p className="text-xs font-bold uppercase text-slate-500">{label}</p>
      <p className="mt-1 text-2xl font-black text-violet-800">{value}</p>
    </div>
  );
}

function DataTable({
  title,
  empty,
  headers,
  rows,
}: {
  title: string;
  empty: string;
  headers: string[];
  rows: string[][];
}) {
  return (
    <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <h2 className="mb-4 text-sm font-black text-slate-900">{title}</h2>
      {rows.length === 0 ? (
        <p className="text-sm text-slate-500">{empty}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-left text-sm">
            <thead>
              <tr className="border-b text-xs font-bold uppercase text-slate-500">
                {headers.map((h) => (
                  <th key={h} className="py-2 pr-4">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr key={i} className="border-b border-slate-50">
                  {row.map((cell, j) => (
                    <td key={j} className="py-3 pr-4 text-slate-700">
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </article>
  );
}

function RecommendationsBlock({
  recommendations,
}: {
  recommendations: RecruitmentIntelligenceDashboard["recommendations"];
}) {
  return (
    <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="mb-4 flex items-center gap-2">
        <Brain className="h-5 w-5 text-violet-700" />
        <h2 className="text-sm font-black text-slate-900">AI recommendations</h2>
        <Sparkles className="h-4 w-4 text-violet-500" />
      </div>
      <div className="space-y-3">
        {recommendations.map((r) => (
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
            <p className="text-sm font-black text-slate-900">{r.title}</p>
            <p className="mt-1 text-xs font-medium text-slate-700">{r.detail}</p>
          </div>
        ))}
      </div>
    </article>
  );
}

/**
 * VYRON CORE Phase 8 — Recruitment Intelligence.
 * Hiring forecast, applicant scoring, succession planning & workforce gap analysis.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { isSupabaseMissingTableError } from "@/lib/company-access";
import { fetchCopilotContext } from "@/lib/workforce-ai-copilot";
import { loadWorkforceRiskDashboard } from "@/lib/workforce-risk-intelligence";

export const DEFAULT_SKILL_SEEDS = [
  { skill_key: "customer_service", skill_name: "Customer Service", category: "operations" },
  { skill_key: "cash_handling", skill_name: "Cash Handling", category: "operations" },
  { skill_key: "team_leadership", skill_name: "Team Leadership", category: "leadership" },
  { skill_key: "stock_control", skill_name: "Stock Control", category: "operations" },
  { skill_key: "health_safety", skill_name: "Health & Safety", category: "compliance" },
  { skill_key: "field_operations", skill_name: "Field Operations", category: "field" },
  { skill_key: "payroll_admin", skill_name: "Payroll Administration", category: "admin" },
  { skill_key: "roster_planning", skill_name: "Roster Planning", category: "admin" },
] as const;

export type RecruitmentScoreBand = "strong" | "good" | "review" | "weak";

export type SuccessionType = "supervisor" | "manager" | "successor";

export type SuccessionReadinessBand = "ready" | "near_ready" | "developing" | "not_ready";

export type GapType = "staffing_shortage" | "missing_skill" | "high_risk_role" | "future_hire";

export type RecruitmentVacancy = {
  id: string;
  vacancyRef: string;
  title: string;
  storeId: string | null;
  storeName: string | null;
  status: string;
  priority: string;
  requiredSkills: string[];
  headcount: number;
  salaryMin: number | null;
  salaryMax: number | null;
  locationLabel: string | null;
  targetHireDate: string | null;
};

export type RecruitmentApplicant = {
  id: string;
  applicantRef: string;
  fullName: string;
  email: string | null;
  vacancyId: string | null;
  vacancyTitle: string | null;
  yearsExperience: number;
  skills: string[];
  preferredStoreId: string | null;
  expectedSalary: number | null;
  status: string;
  source: string;
};

export type ApplicantScore = {
  applicantId: string;
  applicantName: string;
  vacancyId: string | null;
  vacancyTitle: string | null;
  experienceScore: number;
  skillsMatchScore: number;
  locationMatchScore: number;
  salaryFitScore: number;
  overallScore: number;
  band: RecruitmentScoreBand;
  factors: string[];
};

export type RecruitmentInterview = {
  id: string;
  applicantId: string;
  applicantName: string;
  vacancyTitle: string | null;
  interviewType: string;
  scheduledAt: string | null;
  status: string;
  interviewerEmail: string | null;
  outcome: string | null;
};

export type SkillRegistryRow = {
  id: string;
  skillKey: string;
  skillName: string;
  category: string;
  employeeCount: number;
};

export type SuccessionCandidate = {
  employeeId: string;
  employeeLabel: string;
  jobTitle: string | null;
  successionType: SuccessionType;
  targetRole: string;
  readinessScore: number;
  readinessBand: SuccessionReadinessBand;
  factors: string[];
};

export type WorkforceGapRow = {
  id: string;
  gapType: GapType;
  severity: "info" | "warning" | "critical";
  storeId: string | null;
  storeName: string | null;
  skillName: string | null;
  headcountGap: number;
  skillGapCount: number;
  message: string;
};

export type HiringForecast = {
  futureHiringNeeds: number;
  skillsShortages: number;
  highRiskPositions: number;
  internalPromotionOpportunities: number;
  horizonDays: number;
  drivers: { label: string; count: number; detail: string }[];
  needsMoreData: boolean;
};

export type RecruitmentRecommendation = {
  id: string;
  priority: number;
  band: "green" | "amber" | "red";
  title: string;
  detail: string;
};

export type RecruitmentIntelligenceDashboard = {
  companyId: string;
  analysisDate: string;
  vacancies: RecruitmentVacancy[];
  applicants: RecruitmentApplicant[];
  interviews: RecruitmentInterview[];
  applicantScores: ApplicantScore[];
  skillsRegistry: SkillRegistryRow[];
  successionCandidates: SuccessionCandidate[];
  workforceGaps: WorkforceGapRow[];
  hiringForecast: HiringForecast;
  recommendations: RecruitmentRecommendation[];
  openVacancyCount: number;
  pipelineApplicantCount: number;
  tablesAvailable: boolean;
};

const RECRUITMENT_TABLES = [
  "skills_registry",
  "employee_skills",
  "recruitment_vacancies",
  "recruitment_applicants",
  "recruitment_interviews",
  "recruitment_scores",
  "succession_candidates",
  "workforce_gap_analysis",
] as const;

function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function daysAheadIso(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function scoreToBand(score: number): RecruitmentScoreBand {
  if (score >= 80) return "strong";
  if (score >= 65) return "good";
  if (score >= 45) return "review";
  return "weak";
}

function successionBand(score: number): SuccessionReadinessBand {
  if (score >= 80) return "ready";
  if (score >= 65) return "near_ready";
  if (score >= 45) return "developing";
  return "not_ready";
}

function empLabel(e: { first_name: string; last_name: string }): string {
  return `${e.first_name} ${e.last_name}`.trim();
}

function parseSkillsJson(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((v) => String(v).toLowerCase());
}

function isLeadershipTitle(title: string | null | undefined): boolean {
  if (!title) return false;
  return /supervisor|manager|lead|senior|head|chief|foreman/i.test(title);
}

function isSupervisorTitle(title: string | null | undefined): boolean {
  if (!title) return false;
  return /supervisor|team lead|shift lead|foreman/i.test(title);
}

function isManagerTitle(title: string | null | undefined): boolean {
  if (!title) return false;
  return /manager|head|director|chief/i.test(title);
}

export function scoreApplicant(input: {
  applicant: RecruitmentApplicant;
  vacancy: RecruitmentVacancy | null;
  storeMatch: boolean;
}): ApplicantScore {
  const { applicant, vacancy } = input;
  const factors: string[] = [];

  const requiredYears = vacancy ? Math.max(1, Math.min(8, vacancy.requiredSkills.length)) : 2;
  const expRatio = Math.min(1, applicant.yearsExperience / requiredYears);
  const experienceScore = Math.round(expRatio * 100);
  if (experienceScore >= 70) factors.push("Experience meets role requirement");
  else factors.push("Experience below ideal for role");

  let skillsMatchScore = 50;
  if (vacancy && vacancy.requiredSkills.length > 0) {
    const req = vacancy.requiredSkills.map((s) => s.toLowerCase());
    const have = applicant.skills.map((s) => s.toLowerCase());
    const matched = req.filter((r) => have.some((h) => h.includes(r) || r.includes(h)));
    skillsMatchScore = Math.round((matched.length / req.length) * 100);
    factors.push(`${matched.length}/${req.length} required skills matched`);
  } else if (applicant.skills.length > 0) {
    skillsMatchScore = Math.min(85, 40 + applicant.skills.length * 8);
    factors.push("Skills listed but vacancy has no required skill profile");
  } else {
    factors.push("No skills data on applicant");
  }

  let locationMatchScore = 60;
  if (vacancy?.storeId && applicant.preferredStoreId) {
    locationMatchScore = vacancy.storeId === applicant.preferredStoreId ? 100 : 45;
    factors.push(locationMatchScore === 100 ? "Preferred location matches vacancy" : "Location mismatch");
  } else if (input.storeMatch) {
    locationMatchScore = 85;
    factors.push("Applicant aligned to store context");
  } else {
    factors.push("Location preference unknown");
  }

  let salaryFitScore = 70;
  if (
    vacancy &&
    applicant.expectedSalary != null &&
    vacancy.salaryMin != null &&
    vacancy.salaryMax != null
  ) {
    const mid = (vacancy.salaryMin + vacancy.salaryMax) / 2;
    const diff = Math.abs(applicant.expectedSalary - mid);
    const range = Math.max(1, vacancy.salaryMax - vacancy.salaryMin);
    salaryFitScore = Math.max(0, Math.min(100, Math.round(100 - (diff / range) * 50)));
    factors.push(
      salaryFitScore >= 70
        ? "Salary expectation within band"
        : "Salary expectation outside ideal band"
    );
  } else {
    factors.push("Salary fit estimated — missing band data");
  }

  const overallScore = Math.round(
    experienceScore * 0.25 +
      skillsMatchScore * 0.35 +
      locationMatchScore * 0.2 +
      salaryFitScore * 0.2
  );

  return {
    applicantId: applicant.id,
    applicantName: applicant.fullName,
    vacancyId: vacancy?.id ?? applicant.vacancyId,
    vacancyTitle: vacancy?.title ?? applicant.vacancyTitle,
    experienceScore,
    skillsMatchScore,
    locationMatchScore,
    salaryFitScore,
    overallScore,
    band: scoreToBand(overallScore),
    factors,
  };
}

type RecruitmentContext = {
  companyId: string;
  analysisDate: string;
  employees: {
    id: string;
    first_name: string;
    last_name: string;
    job_title: string | null;
    default_store_id: string | null;
    active: boolean;
  }[];
  stores: { id: string; name: string }[];
  rosterShifts: { store_id: string | null; shift_date: string; employee_id: string }[];
  riskByEmployee: Map<string, number>;
  vacancies: RecruitmentVacancy[];
  applicants: RecruitmentApplicant[];
  interviews: RecruitmentInterview[];
  skillsRegistry: SkillRegistryRow[];
  employeeSkills: { employeeId: string; skillId: string; skillKey: string; proficiency: number }[];
};

function computeStaffingGaps(ctx: RecruitmentContext): { storeId: string; storeName: string; gap: number }[] {
  const activeByStore = new Map<string, number>();
  for (const e of ctx.employees.filter((x) => x.active !== false)) {
    const sid = e.default_store_id || "unassigned";
    activeByStore.set(sid, (activeByStore.get(sid) || 0) + 1);
  }

  const shiftsByStore = new Map<string, number>();
  for (const s of ctx.rosterShifts) {
    const sid = s.store_id || "unassigned";
    shiftsByStore.set(sid, (shiftsByStore.get(sid) || 0) + 1);
  }

  const gaps: { storeId: string; storeName: string; gap: number }[] = [];
  for (const [storeId, shifts] of shiftsByStore) {
    const available = activeByStore.get(storeId) || 0;
    const needed = Math.ceil(shifts / 5);
    const gap = Math.max(0, needed - available);
    if (gap <= 0) continue;
    gaps.push({
      storeId,
      storeName: ctx.stores.find((s) => s.id === storeId)?.name || storeId,
      gap,
    });
  }
  return gaps;
}

export function buildWorkforceGapAnalysis(ctx: RecruitmentContext): WorkforceGapRow[] {
  const gaps: WorkforceGapRow[] = [];
  const staffingGaps = computeStaffingGaps(ctx);

  for (const sg of staffingGaps) {
    gaps.push({
      id: `gap-staff-${sg.storeId}`,
      gapType: "staffing_shortage",
      severity: sg.gap >= 3 ? "critical" : "warning",
      storeId: sg.storeId,
      storeName: sg.storeName,
      skillName: null,
      headcountGap: sg.gap,
      skillGapCount: 0,
      message: `${sg.storeName}: ${sg.gap} staffing shortage from roster coverage`,
    });
  }

  const skillCoverage = new Map<string, { skillName: string; count: number }>();
  for (const row of ctx.skillsRegistry) {
    skillCoverage.set(row.id, { skillName: row.skillName, count: row.employeeCount });
  }
  for (const es of ctx.employeeSkills) {
    const cur = skillCoverage.get(es.skillId);
    if (cur) cur.count += 1;
  }

  for (const [skillId, info] of skillCoverage) {
    const activeEmployees = ctx.employees.filter((e) => e.active !== false).length;
    const minNeeded = Math.max(2, Math.ceil(activeEmployees * 0.15));
    if (info.count >= minNeeded) continue;
    const skillGapCount = minNeeded - info.count;
    gaps.push({
      id: `gap-skill-${skillId}`,
      gapType: "missing_skill",
      severity: info.count === 0 ? "critical" : "warning",
      storeId: null,
      storeName: null,
      skillName: info.skillName,
      headcountGap: 0,
      skillGapCount,
      message: `Missing skill coverage: ${info.skillName} (${info.count}/${minNeeded} employees)`,
    });
  }

  for (const skillId of skillCoverage.keys()) {
    const holders = ctx.employeeSkills.filter((es) => es.skillId === skillId);
    if (holders.length !== 1) continue;
    const skillName = skillCoverage.get(skillId)?.skillName || "Skill";
    const holder = ctx.employees.find((e) => e.id === holders[0].employeeId);
    gaps.push({
      id: `gap-risk-${skillId}`,
      gapType: "high_risk_role",
      severity: "critical",
      storeId: holder?.default_store_id || null,
      storeName: ctx.stores.find((s) => s.id === holder?.default_store_id)?.name || null,
      skillName,
      headcountGap: 0,
      skillGapCount: 1,
      message: `Single point of failure: only ${holder ? empLabel(holder) : "one employee"} holds ${skillName}`,
    });
  }

  const openVacancies = ctx.vacancies.filter((v) => v.status === "open");
  for (const v of openVacancies) {
    gaps.push({
      id: `gap-future-${v.id}`,
      gapType: "future_hire",
      severity: v.priority === "critical" ? "critical" : "info",
      storeId: v.storeId,
      storeName: v.storeName,
      skillName: null,
      headcountGap: v.headcount,
      skillGapCount: v.requiredSkills.length,
      message: `Future hire: ${v.title} (${v.headcount} headcount)`,
    });
  }

  if (staffingGaps.length > 0 && openVacancies.length === 0) {
    const totalGap = staffingGaps.reduce((s, g) => s + g.gap, 0);
    gaps.push({
      id: "gap-future-model",
      gapType: "future_hire",
      severity: totalGap >= 5 ? "critical" : "warning",
      storeId: null,
      storeName: null,
      skillName: null,
      headcountGap: totalGap,
      skillGapCount: 0,
      message: `Modelled recruitment need: ${totalGap} role(s) from roster gaps (no vacancies logged yet)`,
    });
  }

  return gaps;
}

export function buildSuccessionCandidates(ctx: RecruitmentContext): SuccessionCandidate[] {
  const results: SuccessionCandidate[] = [];
  const active = ctx.employees.filter((e) => e.active !== false);

  for (const e of active) {
    const risk = ctx.riskByEmployee.get(e.id) ?? 30;
    const skillCount = ctx.employeeSkills.filter((es) => es.employeeId === e.id).length;
    const leadershipSkills = ctx.employeeSkills.filter(
      (es) => es.employeeId === e.id && /leadership|planning|safety/i.test(es.skillKey)
    ).length;

    if (!isManagerTitle(e.job_title)) {
      let supervisorScore = 40 + skillCount * 5 + leadershipSkills * 10 - Math.round(risk * 0.2);
      if (isSupervisorTitle(e.job_title)) supervisorScore += 15;
      supervisorScore = Math.max(0, Math.min(100, supervisorScore));
      if (supervisorScore >= 45) {
        results.push({
          employeeId: e.id,
          employeeLabel: empLabel(e),
          jobTitle: e.job_title,
          successionType: "supervisor",
          targetRole: "Shift Supervisor",
          readinessScore: supervisorScore,
          readinessBand: successionBand(supervisorScore),
          factors: [
            `${skillCount} mapped skills`,
            leadershipSkills > 0 ? "Leadership skills present" : "Develop leadership skills",
            risk < 50 ? "Acceptable risk profile" : "Elevated workforce risk",
          ],
        });
      }
    }

    if (!isManagerTitle(e.job_title) || isSupervisorTitle(e.job_title)) {
      let managerScore = 35 + skillCount * 4 + leadershipSkills * 12 - Math.round(risk * 0.25);
      if (isSupervisorTitle(e.job_title)) managerScore += 20;
      managerScore = Math.max(0, Math.min(100, managerScore));
      if (managerScore >= 50) {
        results.push({
          employeeId: e.id,
          employeeLabel: empLabel(e),
          jobTitle: e.job_title,
          successionType: "manager",
          targetRole: "Store Manager",
          readinessScore: managerScore,
          readinessBand: successionBand(managerScore),
          factors: [
            isSupervisorTitle(e.job_title) ? "Already in supervisory track" : "Manager pipeline candidate",
            `Risk score impact: ${risk}`,
          ],
        });
      }
    }

    const openLeadershipVacancy = ctx.vacancies.find(
      (v) => v.status === "open" && /manager|supervisor|lead/i.test(v.title)
    );
    if (openLeadershipVacancy && (isSupervisorTitle(e.job_title) || leadershipSkills >= 1)) {
      let successorScore = 50 + leadershipSkills * 15 + skillCount * 3 - Math.round(risk * 0.15);
      successorScore = Math.max(0, Math.min(100, successorScore));
      results.push({
        employeeId: e.id,
        employeeLabel: empLabel(e),
        jobTitle: e.job_title,
        successionType: "successor",
        targetRole: openLeadershipVacancy.title,
        readinessScore: successorScore,
        readinessBand: successionBand(successorScore),
        factors: [`Successor for open vacancy: ${openLeadershipVacancy.title}`],
      });
    }
  }

  return results.sort((a, b) => b.readinessScore - a.readinessScore);
}

export function buildHiringForecast(
  ctx: RecruitmentContext,
  gaps: WorkforceGapRow[],
  succession: SuccessionCandidate[]
): HiringForecast {
  const staffingShortages = gaps
    .filter((g) => g.gapType === "staffing_shortage")
    .reduce((s, g) => s + g.headcountGap, 0);
  const skillsShortages = gaps.filter((g) => g.gapType === "missing_skill").length;
  const highRiskPositions = gaps.filter((g) => g.gapType === "high_risk_role").length;
  const futureHires = gaps
    .filter((g) => g.gapType === "future_hire")
    .reduce((s, g) => s + g.headcountGap, 0);
  const openVacancies = ctx.vacancies.filter((v) => v.status === "open").length;
  const futureHiringNeeds = Math.max(openVacancies, staffingShortages + futureHires);

  const internalPromotionOpportunities = succession.filter(
    (s) => s.readinessBand === "ready" || s.readinessBand === "near_ready"
  ).length;

  const drivers = [
    {
      label: "Open vacancies",
      count: openVacancies,
      detail: "Logged recruitment vacancies",
    },
    {
      label: "Roster staffing gaps",
      count: staffingShortages,
      detail: "Shortages from roster vs active headcount",
    },
    {
      label: "Skills shortages",
      count: skillsShortages,
      detail: "Skills below minimum coverage threshold",
    },
    {
      label: "High-risk single-skill roles",
      count: highRiskPositions,
      detail: "Positions with only one skilled employee",
    },
    {
      label: "Internal promotion ready",
      count: internalPromotionOpportunities,
      detail: "Succession candidates near ready or ready",
    },
  ].filter((d) => d.count > 0);

  const needsMoreData =
    ctx.vacancies.length === 0 &&
    ctx.applicants.length === 0 &&
    ctx.skillsRegistry.length === 0 &&
    staffingShortages === 0;

  return {
    futureHiringNeeds,
    skillsShortages,
    highRiskPositions,
    internalPromotionOpportunities,
    horizonDays: 90,
    drivers,
    needsMoreData,
  };
}

function buildRecommendations(
  dash: Omit<RecruitmentIntelligenceDashboard, "recommendations" | "tablesAvailable">
): RecruitmentRecommendation[] {
  const recs: RecruitmentRecommendation[] = [];
  const fc = dash.hiringForecast;

  if (fc.futureHiringNeeds >= 3) {
    recs.push({
      id: "rec-hire",
      priority: 1,
      band: fc.futureHiringNeeds >= 6 ? "red" : "amber",
      title: "Accelerate hiring pipeline",
      detail: `${fc.futureHiringNeeds} future hiring need(s) detected across vacancies and roster gaps.`,
    });
  }

  if (fc.skillsShortages >= 2) {
    recs.push({
      id: "rec-skills",
      priority: 2,
      band: "amber",
      title: "Address skills shortages",
      detail: `${fc.skillsShortages} skill coverage gap(s). Expand skills registry and training.`,
    });
  }

  if (fc.highRiskPositions > 0) {
    recs.push({
      id: "rec-risk",
      priority: 3,
      band: "red",
      title: "Mitigate high-risk single-skill roles",
      detail: `${fc.highRiskPositions} role(s) depend on a single employee — plan cross-training or backup hire.`,
    });
  }

  if (fc.internalPromotionOpportunities > 0) {
    recs.push({
      id: "rec-internal",
      priority: 4,
      band: "green",
      title: "Prioritise internal promotion opportunities",
      detail: `${fc.internalPromotionOpportunities} succession candidate(s) ready or near-ready for promotion.`,
    });
  }

  const weakApplicants = dash.applicantScores.filter((s) => s.band === "weak").length;
  if (weakApplicants >= 3) {
    recs.push({
      id: "rec-applicants",
      priority: 5,
      band: "amber",
      title: "Review weak applicant pool",
      detail: `${weakApplicants} applicant(s) scored weak — refine sourcing or job requirements.`,
    });
  }

  if (recs.length === 0) {
    recs.push({
      id: "rec-ok",
      priority: 99,
      band: "green",
      title: "Recruitment intelligence looks stable",
      detail: "No critical hiring or skills gaps for this analysis date.",
    });
  }

  return recs.sort((a, b) => a.priority - b.priority);
}

export function buildRecruitmentIntelligenceDashboard(
  ctx: RecruitmentContext
): RecruitmentIntelligenceDashboard {
  const vacancyMap = new Map(ctx.vacancies.map((v) => [v.id, v]));

  const applicantScores = ctx.applicants
    .filter((a) => !["hired", "rejected", "withdrawn"].includes(a.status))
    .map((a) => {
      const vacancy = a.vacancyId ? vacancyMap.get(a.vacancyId) ?? null : null;
      const storeMatch =
        !!vacancy?.storeId &&
        !!a.preferredStoreId &&
        vacancy.storeId === a.preferredStoreId;
      return scoreApplicant({ applicant: a, vacancy, storeMatch });
    })
    .sort((a, b) => b.overallScore - a.overallScore);

  const workforceGaps = buildWorkforceGapAnalysis(ctx);
  const successionCandidates = buildSuccessionCandidates(ctx);
  const hiringForecast = buildHiringForecast(ctx, workforceGaps, successionCandidates);

  const partial = {
    companyId: ctx.companyId,
    analysisDate: ctx.analysisDate,
    vacancies: ctx.vacancies,
    applicants: ctx.applicants,
    interviews: ctx.interviews,
    applicantScores,
    skillsRegistry: ctx.skillsRegistry,
    successionCandidates,
    workforceGaps,
    hiringForecast,
    openVacancyCount: ctx.vacancies.filter((v) => v.status === "open").length,
    pipelineApplicantCount: ctx.applicants.filter((a) =>
      ["applied", "screening", "interview", "offer"].includes(a.status)
    ).length,
  };

  return {
    ...partial,
    recommendations: buildRecommendations(partial),
    tablesAvailable: true,
  };
}

function isRecruitmentMissingTable(error: { message?: string } | null): boolean {
  if (!error) return false;
  return (
    isSupabaseMissingTableError(error) ||
    RECRUITMENT_TABLES.some((t) => error.message?.includes(t))
  );
}

async function ensureDefaultSkills(supabase: SupabaseClient, companyId: string): Promise<void> {
  const { count } = await supabase
    .from("skills_registry")
    .select("id", { count: "exact", head: true })
    .eq("company_id", companyId);

  if ((count ?? 0) > 0) return;

  await supabase.from("skills_registry").insert(
    DEFAULT_SKILL_SEEDS.map((s) => ({
      company_id: companyId,
      skill_key: s.skill_key,
      skill_name: s.skill_name,
      category: s.category,
    }))
  );
}

async function fetchRecruitmentContext(
  supabase: SupabaseClient,
  companyId: string,
  analysisDate: string
): Promise<RecruitmentContext> {
  await ensureDefaultSkills(supabase, companyId);

  const weekEnd = daysAheadIso(7);

  const [
    ctx,
    employeesRes,
    rosterRes,
    vacanciesRes,
    applicantsRes,
    interviewsRes,
    skillsRes,
    employeeSkillsRes,
    riskLoad,
  ] = await Promise.all([
    fetchCopilotContext(supabase, companyId, analysisDate),
    supabase
      .from("employees")
      .select("id, first_name, last_name, job_title, default_store_id, active")
      .eq("company_id", companyId),
    supabase
      .from("roster_shifts")
      .select("store_id, shift_date, employee_id")
      .eq("company_id", companyId)
      .gte("shift_date", analysisDate)
      .lte("shift_date", weekEnd),
    supabase
      .from("recruitment_vacancies")
      .select("*")
      .eq("company_id", companyId)
      .order("created_at", { ascending: false })
      .limit(100),
    supabase
      .from("recruitment_applicants")
      .select("*")
      .eq("company_id", companyId)
      .order("created_at", { ascending: false })
      .limit(200),
    supabase
      .from("recruitment_interviews")
      .select("*")
      .eq("company_id", companyId)
      .order("scheduled_at", { ascending: false })
      .limit(100),
    supabase.from("skills_registry").select("*").eq("company_id", companyId),
    supabase.from("employee_skills").select("*").eq("company_id", companyId),
    loadWorkforceRiskDashboard(supabase, companyId, analysisDate),
  ]);

  const stores = ctx.stores;
  const vacancies: RecruitmentVacancy[] = ((vacanciesRes.data || []) as Record<string, unknown>[]).map(
    (row) => ({
      id: String(row.id),
      vacancyRef: String(row.vacancy_ref),
      title: String(row.title),
      storeId: row.store_id ? String(row.store_id) : null,
      storeName: row.store_id
        ? stores.find((s) => s.id === String(row.store_id))?.name || null
        : null,
      status: String(row.status),
      priority: String(row.priority),
      requiredSkills: parseSkillsJson(row.required_skills),
      headcount: Number(row.headcount || 1),
      salaryMin: row.salary_min != null ? Number(row.salary_min) : null,
      salaryMax: row.salary_max != null ? Number(row.salary_max) : null,
      locationLabel: row.location_label ? String(row.location_label) : null,
      targetHireDate: row.target_hire_date ? String(row.target_hire_date) : null,
    })
  );

  const vacancyTitleById = new Map(vacancies.map((v) => [v.id, v.title]));

  const applicants: RecruitmentApplicant[] = ((applicantsRes.data || []) as Record<string, unknown>[]).map(
    (row) => ({
      id: String(row.id),
      applicantRef: String(row.applicant_ref),
      fullName: String(row.full_name),
      email: row.email ? String(row.email) : null,
      vacancyId: row.vacancy_id ? String(row.vacancy_id) : null,
      vacancyTitle: row.vacancy_id ? vacancyTitleById.get(String(row.vacancy_id)) || null : null,
      yearsExperience: Number(row.years_experience || 0),
      skills: parseSkillsJson(row.skills),
      preferredStoreId: row.preferred_store_id ? String(row.preferred_store_id) : null,
      expectedSalary: row.expected_salary != null ? Number(row.expected_salary) : null,
      status: String(row.status),
      source: String(row.source || "direct"),
    })
  );

  const applicantNameById = new Map(applicants.map((a) => [a.id, a.fullName]));

  const interviews: RecruitmentInterview[] = ((interviewsRes.data || []) as Record<string, unknown>[]).map(
    (row) => ({
      id: String(row.id),
      applicantId: String(row.applicant_id),
      applicantName: applicantNameById.get(String(row.applicant_id)) || "Unknown",
      vacancyTitle: row.vacancy_id ? vacancyTitleById.get(String(row.vacancy_id)) || null : null,
      interviewType: String(row.interview_type),
      scheduledAt: row.scheduled_at ? String(row.scheduled_at) : null,
      status: String(row.status),
      interviewerEmail: row.interviewer_email ? String(row.interviewer_email) : null,
      outcome: row.outcome ? String(row.outcome) : null,
    })
  );

  const skillsRegistry: SkillRegistryRow[] = ((skillsRes.data || []) as Record<string, unknown>[]).map(
    (row) => ({
      id: String(row.id),
      skillKey: String(row.skill_key),
      skillName: String(row.skill_name),
      category: String(row.category),
      employeeCount: 0,
    })
  );

  const skillKeyById = new Map(skillsRegistry.map((s) => [s.id, s.skillKey]));

  const employeeSkills = ((employeeSkillsRes.data || []) as Record<string, unknown>[]).map((row) => ({
    employeeId: String(row.employee_id),
    skillId: String(row.skill_id),
    skillKey: skillKeyById.get(String(row.skill_id)) || "",
    proficiency: Number(row.proficiency || 50),
  }));

  for (const es of employeeSkills) {
    const skill = skillsRegistry.find((s) => s.id === es.skillId);
    if (skill) skill.employeeCount += 1;
  }

  const riskByEmployee = new Map<string, number>();
  for (const row of riskLoad.dashboard?.employeeScores || []) {
    if (row.entityType === "employee") riskByEmployee.set(row.entityId, row.overallScore);
  }

  return {
    companyId,
    analysisDate,
    employees: (employeesRes.data || []) as RecruitmentContext["employees"],
    stores,
    rosterShifts: (rosterRes.data || []) as RecruitmentContext["rosterShifts"],
    riskByEmployee,
    vacancies,
    applicants,
    interviews,
    skillsRegistry,
    employeeSkills,
  };
}

export async function syncRecruitmentIntelligence(
  supabase: SupabaseClient,
  dashboard: RecruitmentIntelligenceDashboard
): Promise<{ ok: boolean; error: string | null }> {
  const now = new Date().toISOString();

  await supabase
    .from("workforce_gap_analysis")
    .delete()
    .eq("company_id", dashboard.companyId)
    .eq("analysis_date", dashboard.analysisDate);

  if (dashboard.workforceGaps.length > 0) {
    const { error } = await supabase.from("workforce_gap_analysis").insert(
      dashboard.workforceGaps.map((g) => ({
        company_id: dashboard.companyId,
        analysis_date: dashboard.analysisDate,
        store_id: g.storeId,
        skill_id: dashboard.skillsRegistry.find((s) => s.skillName === g.skillName)?.id || null,
        gap_type: g.gapType,
        severity: g.severity,
        headcount_gap: g.headcountGap,
        skill_gap_count: g.skillGapCount,
        message: g.message,
        forecast_json: dashboard.hiringForecast,
      }))
    );
    if (error && !isRecruitmentMissingTable(error)) return { ok: false, error: error.message };
  }

  for (const score of dashboard.applicantScores) {
    const { error } = await supabase.from("recruitment_scores").upsert(
      {
        company_id: dashboard.companyId,
        applicant_id: score.applicantId,
        vacancy_id: score.vacancyId,
        score_date: dashboard.analysisDate,
        experience_score: score.experienceScore,
        skills_match_score: score.skillsMatchScore,
        location_match_score: score.locationMatchScore,
        salary_fit_score: score.salaryFitScore,
        overall_score: score.overallScore,
        score_band: score.band,
        factors: score.factors,
        computed_at: now,
      },
      { onConflict: "company_id,applicant_id,score_date" }
    );
    if (error && !isRecruitmentMissingTable(error)) return { ok: false, error: error.message };
  }

  for (const cand of dashboard.successionCandidates) {
    const { error } = await supabase.from("succession_candidates").upsert(
      {
        company_id: dashboard.companyId,
        employee_id: cand.employeeId,
        target_role: cand.targetRole,
        succession_type: cand.successionType,
        readiness_score: cand.readinessScore,
        readiness_band: cand.readinessBand,
        factors: cand.factors,
        analysis_date: dashboard.analysisDate,
      },
      { onConflict: "company_id,employee_id,succession_type,analysis_date" }
    );
    if (error && !isRecruitmentMissingTable(error)) return { ok: false, error: error.message };
  }

  return { ok: true, error: null };
}

export async function loadRecruitmentIntelligence(
  supabase: SupabaseClient,
  companyId: string,
  analysisDate = todayIsoDate()
): Promise<{ dashboard: RecruitmentIntelligenceDashboard | null; error: string | null }> {
  if (!companyId) return { dashboard: null, error: "No company selected." };

  const ctx = await fetchRecruitmentContext(supabase, companyId, analysisDate);
  const dashboard = buildRecruitmentIntelligenceDashboard(ctx);
  const sync = await syncRecruitmentIntelligence(supabase, dashboard);
  return { dashboard, error: sync.error };
}

export function recruitmentScoreBandClass(band: RecruitmentScoreBand): string {
  if (band === "strong") return "border-emerald-200 bg-emerald-50 text-emerald-800";
  if (band === "good") return "border-cyan-200 bg-cyan-50 text-cyan-800";
  if (band === "review") return "border-amber-200 bg-amber-50 text-amber-800";
  return "border-rose-200 bg-rose-50 text-rose-800";
}

export function successionBandClass(band: SuccessionReadinessBand): string {
  if (band === "ready") return "border-emerald-200 bg-emerald-50 text-emerald-800";
  if (band === "near_ready") return "border-cyan-200 bg-cyan-50 text-cyan-800";
  if (band === "developing") return "border-amber-200 bg-amber-50 text-amber-800";
  return "border-slate-200 bg-slate-50 text-slate-700";
}

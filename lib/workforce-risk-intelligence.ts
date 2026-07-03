/**
 * VYRON CORE Phase 4D — Workforce Risk Intelligence scoring engine.
 * Aggregates clocking, field ops, travel, cost, leave, roster & payroll readiness.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { isSupabaseMissingTableError } from "@/lib/company-access";
import { fetchFieldOperationsSnapshot } from "@/lib/field-operations";
import {
  buildWorkforceCostDashboard,
  type WorkforceCostDashboard,
} from "@/lib/field-cost-intelligence";
import {
  buildWorkforceJourneyDashboard,
  type WorkforceJourneyDashboard,
} from "@/lib/field-travel-intelligence";

export const WORKFORCE_RISK_CATEGORIES = [
  "Attendance Risk",
  "Overtime Risk",
  "Payroll Leakage Risk",
  "Burnout Risk",
  "Resignation Risk",
  "Manager Risk",
  "Store Risk",
  "Field Operations Risk",
] as const;

export type WorkforceRiskCategory = (typeof WORKFORCE_RISK_CATEGORIES)[number];

export type WorkforceRiskBand = "green" | "amber" | "red";

export type WorkforceRiskEntityType = "employee" | "store" | "manager" | "company";

export type WorkforceCategoryScores = Record<WorkforceRiskCategory, number>;

export type WorkforceRiskRecommendation = {
  id: string;
  band: WorkforceRiskBand;
  priority: number;
  title: string;
  detail: string;
  entityType?: WorkforceRiskEntityType;
  entityId?: string;
  entityLabel?: string;
};

export type WorkforceRiskScoreRow = {
  entityType: WorkforceRiskEntityType;
  entityId: string;
  entityLabel: string;
  categories: WorkforceCategoryScores;
  overallScore: number;
  riskBand: WorkforceRiskBand;
  factors: string[];
  recommendations: WorkforceRiskRecommendation[];
};

export type WorkforceRiskEvent = {
  entityType: WorkforceRiskEntityType;
  entityId: string;
  category: WorkforceRiskCategory;
  severity: WorkforceRiskBand;
  score: number;
  message: string;
};

export type WorkforceRiskCategorySummary = {
  attendanceRisk: number;
  overtimeRisk: number;
  payrollLeakageRisk: number;
  burnoutRisk: number;
  fieldOperationsRisk: number;
};

export type WorkforceRiskDashboard = {
  scoreDate: string;
  companyId: string;
  workforceRiskIndex: number;
  greenCount: number;
  amberCount: number;
  redCount: number;
  highRiskEmployeeCount: number;
  highRiskStoreCount: number;
  highRiskManagerCount: number;
  categorySummary: WorkforceRiskCategorySummary;
  topRiskEmployees: WorkforceRiskScoreRow[];
  topRiskStores: WorkforceRiskScoreRow[];
  topRiskManagers: WorkforceRiskScoreRow[];
  recommendations: WorkforceRiskRecommendation[];
  employeeScores: WorkforceRiskScoreRow[];
  storeScores: WorkforceRiskScoreRow[];
  managerScores: WorkforceRiskScoreRow[];
  events: WorkforceRiskEvent[];
  tablesAvailable: boolean;
};

const RISK_TABLES = [
  "workforce_risk_rules",
  "workforce_risk_scores",
  "workforce_risk_events",
  "workforce_risk_recommendations",
] as const;

export type EmployeeFieldOpsSignals = {
  idleSeconds: number;
  travelSeconds: number;
  productivityPct: number;
  alertCount: number;
  travelCost: number;
  jobsCompleted: number;
};

const RECOMMENDATION_TEMPLATES: Partial<
  Record<WorkforceRiskCategory, (label: string) => { title: string; detail: string }>
> = {
  "Attendance Risk": (label) => ({
    title: "Investigate repeated late arrivals",
    detail: `Review clocking and roster alignment for ${label}. Follow up on missing punches before payroll export.`,
  }),
  "Overtime Risk": (label) => ({
    title: "Review overtime approvals for this manager",
    detail: `${label} shows elevated overtime. Validate approvals and job linkage before payroll run.`,
  }),
  "Payroll Leakage Risk": (label) => ({
    title: "Review payroll exception before export",
    detail: `Payroll leakage signals detected for ${label}. Resolve idle/travel cost exceptions first.`,
  }),
  "Burnout Risk": (label) => ({
    title: "Review possible burnout risk",
    detail: `${label} has high hours or roster density. Consider rest days or workload redistribution.`,
  }),
  "Field Operations Risk": (label) => ({
    title: "Check job scheduling for excessive travel",
    detail: `Field journey patterns for ${label} suggest travel or GPS issues. Re-sequence jobs or verify site arrivals.`,
  }),
  "Store Risk": () => ({
    title: "Move staff from overstaffed site to understaffed site",
    detail:
      "Rebalance roster coverage between high-risk and low-risk stores to stabilise attendance and payroll readiness.",
  }),
};

const DEFAULT_CATEGORY_WEIGHTS: Record<WorkforceRiskCategory, number> = {
  "Attendance Risk": 1.2,
  "Overtime Risk": 1,
  "Payroll Leakage Risk": 1.15,
  "Burnout Risk": 1.1,
  "Resignation Risk": 1.25,
  "Manager Risk": 1,
  "Store Risk": 1,
  "Field Operations Risk": 1.1,
};

export type WorkforceRiskEmployee = {
  id: string;
  first_name: string;
  last_name: string;
  default_store_id: string | null;
  job_title?: string | null;
};

export type WorkforceRiskStore = {
  id: string;
  name: string;
};

export type WorkforceRiskClockEvent = {
  id: string;
  employee_id: string;
  store_id: string | null;
  event_type: string;
  event_time: string;
};

export type WorkforceRiskRosterShift = {
  id: string;
  employee_id: string;
  store_id: string | null;
  shift_date: string;
  planned_start: string;
  planned_end: string;
  status: string;
};

export type WorkforceRiskPayrollHours = {
  employee_id: string;
  overtime_hours: number;
  late_minutes: number;
  missing_clock_events: number;
  status: string;
};

export type WorkforceRiskPayrollClockCheck = {
  employee_id: string;
  store_id: string | null;
  shift_date: string;
  missing_clock_in: boolean;
  missing_clock_out: boolean;
  late_minutes: number;
  overtime_minutes: number;
  exception_required: boolean;
  payroll_status: string;
};

export type WorkforceRiskLeaveRequest = {
  employee_id: string;
  status: string;
  leave_type?: string | null;
  start_date?: string | null;
};

export type WorkforceRiskHrCase = {
  employee_id: string;
  status: string;
  case_type?: string | null;
};

export type WorkforceRiskHrWarning = {
  employee_id: string;
  status?: string | null;
};

export type WorkforceRiskException = {
  employee_id: string | null;
  store_id: string | null;
  status: string;
};

export type WorkforceRiskUserRole = {
  user_email: string;
  role: string;
};

export type WorkforceRiskContext = {
  companyId: string;
  scoreDate: string;
  employees: WorkforceRiskEmployee[];
  stores: WorkforceRiskStore[];
  clockEvents: WorkforceRiskClockEvent[];
  rosterShifts: WorkforceRiskRosterShift[];
  payrollHours: WorkforceRiskPayrollHours[];
  payrollClockChecks: WorkforceRiskPayrollClockCheck[];
  leaveRequests: WorkforceRiskLeaveRequest[];
  hrCases: WorkforceRiskHrCase[];
  hrWarnings: WorkforceRiskHrWarning[];
  exceptions: WorkforceRiskException[];
  userRoles: WorkforceRiskUserRole[];
};

function isRiskMissingTableError(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  return RISK_TABLES.some((table) => isSupabaseMissingTableError(error, table));
}

function clampScore(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

export function scoreToRiskBand(score: number): WorkforceRiskBand {
  if (score >= 70) return "red";
  if (score >= 40) return "amber";
  return "green";
}

export function riskBandClass(band: WorkforceRiskBand): string {
  if (band === "red") return "bg-rose-100 text-rose-900 border-rose-200";
  if (band === "amber") return "bg-amber-100 text-amber-950 border-amber-200";
  return "bg-emerald-100 text-emerald-900 border-emerald-200";
}

function emptyCategories(): WorkforceCategoryScores {
  return {
    "Attendance Risk": 0,
    "Overtime Risk": 0,
    "Payroll Leakage Risk": 0,
    "Burnout Risk": 0,
    "Resignation Risk": 0,
    "Manager Risk": 0,
    "Store Risk": 0,
    "Field Operations Risk": 0,
  };
}

function employeeLabel(emp: WorkforceRiskEmployee): string {
  return `${emp.first_name} ${emp.last_name}`.trim() || emp.id;
}

function weightedOverall(categories: WorkforceCategoryScores): number {
  let sum = 0;
  let weight = 0;
  for (const category of WORKFORCE_RISK_CATEGORIES) {
    if (
      category === "Manager Risk" ||
      category === "Store Risk" ||
      category === "Field Operations Risk"
    ) {
      continue;
    }
    const w = DEFAULT_CATEGORY_WEIGHTS[category];
    sum += categories[category] * w;
    weight += w;
  }
  return clampScore(weight > 0 ? sum / weight : 0);
}

function daysAgoIso(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

export function computeEmployeeRiskScores(input: {
  context: WorkforceRiskContext;
  employeeDayLeakage: Map<string, number>;
  employeeOvertimeSeconds: Map<string, number>;
  employeeWorkingSeconds: Map<string, number>;
  employeeFieldSignals: Map<string, EmployeeFieldOpsSignals>;
  rosterDaysByEmployee: Map<string, number>;
}): Map<string, WorkforceRiskScoreRow> {
  const { context } = input;
  const result = new Map<string, WorkforceRiskScoreRow>();
  const today = context.scoreDate;

  for (const emp of context.employees) {
    const categories = emptyCategories();
    const factors: string[] = [];

    const payroll = context.payrollHours.filter((p) => p.employee_id === emp.id);
    const latestPayroll = payroll[0];
    if (latestPayroll) {
      const missing = Number(latestPayroll.missing_clock_events || 0);
      const late = Number(latestPayroll.late_minutes || 0);
      categories["Attendance Risk"] = clampScore(missing * 22 + late / 4);
      if (missing > 0) factors.push(`${missing} missing clock event(s)`);
      if (late > 0) factors.push(`${late} late minutes`);
      const ot = Number(latestPayroll.overtime_hours || 0);
      categories["Overtime Risk"] = clampScore(ot * 18);
      if (ot > 0) factors.push(`${ot.toFixed(1)}h overtime on payroll`);
    }

    const clockChecks = context.payrollClockChecks.filter(
      (c) => c.employee_id === emp.id && c.shift_date === today
    );
    for (const check of clockChecks) {
      if (check.missing_clock_in || check.missing_clock_out) {
        categories["Attendance Risk"] = clampScore(categories["Attendance Risk"] + 25);
        factors.push("Payroll readiness missing clock");
      }
      if (check.exception_required) {
        categories["Attendance Risk"] = clampScore(categories["Attendance Risk"] + 15);
      }
      const otMin = Number(check.overtime_minutes || 0);
      if (otMin > 0) {
        categories["Overtime Risk"] = clampScore(
          Math.max(categories["Overtime Risk"], otMin / 3)
        );
      }
    }

    const journeyOt = input.employeeOvertimeSeconds.get(emp.id) || 0;
    if (journeyOt > 0) {
      categories["Overtime Risk"] = clampScore(
        Math.max(categories["Overtime Risk"], journeyOt / 120)
      );
      factors.push("Field journey overtime");
    }

    const leakage = input.employeeDayLeakage.get(emp.id) || 0;
    categories["Payroll Leakage Risk"] = clampScore(leakage / 40);
    if (leakage > 200) factors.push(`Leakage R${Math.round(leakage)}`);

    const rosterDays = input.rosterDaysByEmployee.get(emp.id) || 0;
    const workingSec = input.employeeWorkingSeconds.get(emp.id) || 0;
    categories["Burnout Risk"] = clampScore(
      rosterDays * 12 + workingSec / 600 + (journeyOt > 3600 ? 20 : 0)
    );
    if (rosterDays >= 6) factors.push(`${rosterDays} rostered days (7d)`);
    if (workingSec > 8 * 3600) factors.push("High field working hours");

    const openCases = context.hrCases.filter(
      (c) => c.employee_id === emp.id && (c.status || "").toLowerCase() !== "closed"
    );
    const warnings = context.hrWarnings.filter((w) => w.employee_id === emp.id);
    const pendingLeave = context.leaveRequests.filter(
      (l) =>
        l.employee_id === emp.id &&
        ["pending", "submitted"].includes((l.status || "").toLowerCase())
    );
    categories["Resignation Risk"] = clampScore(
      openCases.length * 28 + warnings.length * 18 + pendingLeave.length * 10
    );
    if (openCases.length) factors.push(`${openCases.length} open HR case(s)`);
    if (warnings.length) factors.push(`${warnings.length} HR warning(s)`);

    const fieldSignals = input.employeeFieldSignals.get(emp.id);
    if (fieldSignals) {
      const idleScore = clampScore(fieldSignals.idleSeconds / 120);
      const travelScore = clampScore(fieldSignals.travelSeconds / 180);
      const prodPenalty = fieldSignals.productivityPct < 50 ? 35 : fieldSignals.productivityPct < 70 ? 15 : 0;
      const alertScore = clampScore(fieldSignals.alertCount * 22);
      categories["Field Operations Risk"] = clampScore(
        idleScore * 0.3 + travelScore * 0.25 + prodPenalty + alertScore
      );
      if (fieldSignals.idleSeconds > 90 * 60) factors.push("High idle time on field route");
      if (fieldSignals.productivityPct < 50) factors.push(`Low productivity ${fieldSignals.productivityPct}%`);
      if (fieldSignals.alertCount > 0) factors.push(`${fieldSignals.alertCount} field alert(s)`);
      if (fieldSignals.jobsCompleted === 0 && journeyOt > 0) {
        categories["Overtime Risk"] = clampScore(categories["Overtime Risk"] + 20);
        factors.push("Overtime not linked to completed job");
      }
    }

    const overallScore = weightedOverall(categories);
    const riskBand = scoreToRiskBand(overallScore);

    result.set(emp.id, {
      entityType: "employee",
      entityId: emp.id,
      entityLabel: employeeLabel(emp),
      categories,
      overallScore,
      riskBand,
      factors,
      recommendations: [],
    });
  }

  return result;
}

export function computeStoreRiskScores(input: {
  context: WorkforceRiskContext;
  employeeScores: Map<string, WorkforceRiskScoreRow>;
}): WorkforceRiskScoreRow[] {
  const storeMap = new Map<string, WorkforceRiskScoreRow>();

  for (const store of input.context.stores) {
    const team = input.context.employees.filter((e) => e.default_store_id === store.id);
    const teamScores = team
      .map((e) => input.employeeScores.get(e.id))
      .filter((s): s is WorkforceRiskScoreRow => Boolean(s));

    const avg = teamScores.length
      ? teamScores.reduce((s, r) => s + r.overallScore, 0) / teamScores.length
      : 0;

    const storeExceptions = input.context.exceptions.filter(
      (ex) =>
        ex.store_id === store.id &&
        !["closed", "approved"].includes((ex.status || "").toLowerCase())
    );
    const storeClockIssues = input.context.payrollClockChecks.filter(
      (c) =>
        c.store_id === store.id &&
        c.shift_date === input.context.scoreDate &&
        (c.missing_clock_in || c.missing_clock_out || c.exception_required)
    );

    const categories = emptyCategories();
    categories["Store Risk"] = clampScore(avg * 0.65 + storeExceptions.length * 12 + storeClockIssues.length * 10);
    categories["Attendance Risk"] = clampScore(storeClockIssues.length * 20);
    categories["Payroll Leakage Risk"] = clampScore(
      teamScores.reduce((s, r) => s + r.categories["Payroll Leakage Risk"], 0) /
        Math.max(1, teamScores.length)
    );

    const overallScore = clampScore(
      categories["Store Risk"] * 0.5 +
        avg * 0.35 +
        categories["Attendance Risk"] * 0.15
    );

    storeMap.set(store.id, {
      entityType: "store",
      entityId: store.id,
      entityLabel: store.name,
      categories,
      overallScore,
      riskBand: scoreToRiskBand(overallScore),
      factors: [
        `${teamScores.filter((s) => s.riskBand !== "green").length} at-risk staff`,
        `${storeExceptions.length} open exceptions`,
      ],
      recommendations: [],
    });
  }

  return [...storeMap.values()].sort((a, b) => b.overallScore - a.overallScore);
}

export function computeManagerRiskScores(input: {
  context: WorkforceRiskContext;
  employeeScores: Map<string, WorkforceRiskScoreRow>;
  storeScores: WorkforceRiskScoreRow[];
}): WorkforceRiskScoreRow[] {
  const managers = input.context.userRoles.filter((r) =>
    /manager|supervisor/i.test(r.role || "")
  );
  if (!managers.length) {
    return input.context.stores.slice(0, 3).map((store) => {
      const storeScore = input.storeScores.find((s) => s.entityId === store.id);
      return {
        entityType: "manager" as const,
        entityId: `store-mgr:${store.id}`,
        entityLabel: `${store.name} duty manager`,
        categories: {
          ...emptyCategories(),
          "Manager Risk": storeScore?.overallScore || 0,
        },
        overallScore: storeScore?.overallScore || 0,
        riskBand: scoreToRiskBand(storeScore?.overallScore || 0),
        factors: ["Derived from store risk (no manager role mapped)"],
        recommendations: [],
      };
    });
  }

  return managers.map((mgr, index) => {
    const team = input.context.employees.filter((_, i) => i % managers.length === index);
    const teamScores = team
      .map((e) => input.employeeScores.get(e.id))
      .filter((s): s is WorkforceRiskScoreRow => Boolean(s));
    const avg = teamScores.length
      ? teamScores.reduce((s, r) => s + r.overallScore, 0) / teamScores.length
      : 0;
    const redCount = teamScores.filter((s) => s.riskBand === "red").length;

    const categories = emptyCategories();
    categories["Manager Risk"] = clampScore(avg * 0.7 + redCount * 15);
    const overallScore = categories["Manager Risk"];

    return {
      entityType: "manager",
      entityId: mgr.user_email.toLowerCase(),
      entityLabel: mgr.user_email,
      categories,
      overallScore,
      riskBand: scoreToRiskBand(overallScore),
      factors: [`${redCount} red-band direct reports (modelled)`, `Team avg risk ${Math.round(avg)}`],
      recommendations: [],
    };
  });
}

export function buildDetailedRiskEvents(input: {
  context: WorkforceRiskContext;
  employeeLabels: Map<string, string>;
  journeyDashboard?: WorkforceJourneyDashboard | null;
  costDashboard?: WorkforceCostDashboard | null;
}): WorkforceRiskEvent[] {
  const events: WorkforceRiskEvent[] = [];
  const weekStart = daysAgoIso(7);
  const label = (id: string) => input.employeeLabels.get(id) || id;

  for (const emp of input.context.employees) {
    const empLabel = label(emp.id);
    const checks = input.context.payrollClockChecks.filter(
      (c) => c.employee_id === emp.id && c.shift_date >= weekStart
    );
    const lateCount = checks.filter((c) => Number(c.late_minutes || 0) > 0).length;
    if (lateCount >= 2) {
      events.push({
        entityType: "employee",
        entityId: emp.id,
        category: "Attendance Risk",
        severity: scoreToRiskBand(clampScore(lateCount * 20)),
        score: clampScore(lateCount * 20),
        message: `${empLabel}: repeated late arrivals (${lateCount} shifts in 7d)`,
      });
    }
    const missedOut = checks.filter((c) => c.missing_clock_out).length;
    if (missedOut >= 2) {
      events.push({
        entityType: "employee",
        entityId: emp.id,
        category: "Attendance Risk",
        severity: scoreToRiskBand(clampScore(missedOut * 25)),
        score: clampScore(missedOut * 25),
        message: `${empLabel}: repeated missed clock-outs (${missedOut} in 7d)`,
      });
    }
    const absences = checks.filter((c) => c.missing_clock_in).length;
    if (absences >= 2) {
      events.push({
        entityType: "employee",
        entityId: emp.id,
        category: "Attendance Risk",
        severity: scoreToRiskBand(clampScore(absences * 22)),
        score: clampScore(absences * 22),
        message: `${empLabel}: repeated absences (${absences} missing clock-in in 7d)`,
      });
    }

    const payroll = input.context.payrollHours.find((p) => p.employee_id === emp.id);
    const otHours = Number(payroll?.overtime_hours || 0);
    if (otHours >= 2) {
      events.push({
        entityType: "employee",
        entityId: emp.id,
        category: "Overtime Risk",
        severity: scoreToRiskBand(clampScore(otHours * 18)),
        score: clampScore(otHours * 18),
        message: `${empLabel}: excessive overtime (${otHours.toFixed(1)}h on payroll)`,
      });
    }

    const leaveRows = input.context.leaveRequests.filter((l) => l.employee_id === emp.id);
    const pendingLeave = leaveRows.filter((l) =>
      ["pending", "submitted"].includes((l.status || "").toLowerCase())
    );
    if (pendingLeave.length >= 2) {
      events.push({
        entityType: "employee",
        entityId: emp.id,
        category: "Resignation Risk",
        severity: "amber",
        score: clampScore(pendingLeave.length * 18),
        message: `${empLabel}: unusual leave pattern (${pendingLeave.length} pending requests)`,
      });
    }
  }

  if (input.journeyDashboard) {
    for (const journey of input.journeyDashboard.journeys) {
      const empLabel = label(journey.employeeId);
      if (journey.route.idleSeconds > 90 * 60) {
        events.push({
          entityType: "employee",
          entityId: journey.employeeId,
          category: "Field Operations Risk",
          severity: scoreToRiskBand(clampScore(journey.route.idleSeconds / 120)),
          score: clampScore(journey.route.idleSeconds / 120),
          message: `${empLabel}: high idle time (${Math.round(journey.route.idleSeconds / 60)} min)`,
        });
      }
      if (journey.route.productivityPct < 50 && journey.route.workingSeconds > 0) {
        events.push({
          entityType: "employee",
          entityId: journey.employeeId,
          category: "Field Operations Risk",
          severity: "amber",
          score: clampScore(100 - journey.route.productivityPct),
          message: `${empLabel}: low productivity (${journey.route.productivityPct}%)`,
        });
      }
      const otSec = Math.max(
        0,
        journey.route.travelSeconds + journey.route.workingSeconds - 8 * 3600
      );
      if (otSec > 0 && journey.route.jobsCompleted === 0) {
        events.push({
          entityType: "employee",
          entityId: journey.employeeId,
          category: "Overtime Risk",
          severity: "red",
          score: 75,
          message: `${empLabel}: overtime not linked to job`,
        });
      }
      for (const alert of journey.alerts) {
        if (alert.type === "Employee Never Arrived") {
          events.push({
            entityType: "employee",
            entityId: journey.employeeId,
            category: "Field Operations Risk",
            severity: "red",
            score: 85,
            message: `${empLabel}: field worker never arrived`,
          });
        }
        if (alert.type === "GPS Mismatch") {
          events.push({
            entityType: "employee",
            entityId: journey.employeeId,
            category: "Field Operations Risk",
            severity: "amber",
            score: 65,
            message: `${empLabel}: GPS mismatch on site arrival`,
          });
        }
        if (alert.type === "Travel Time Excessive") {
          events.push({
            entityType: "employee",
            entityId: journey.employeeId,
            category: "Field Operations Risk",
            severity: "amber",
            score: 60,
            message: `${empLabel}: excessive travel time on shift`,
          });
        }
      }
    }
  }

  if (input.costDashboard) {
    for (const day of input.costDashboard.employeeDayCosts) {
      if (day.leakageValue < 200) continue;
      events.push({
        entityType: "employee",
        entityId: day.employeeId,
        category: "Payroll Leakage Risk",
        severity: scoreToRiskBand(clampScore(day.leakageValue / 40)),
        score: clampScore(day.leakageValue / 40),
        message: `${label(day.employeeId)}: high payroll leakage (R${Math.round(day.leakageValue)})`,
      });
      if (day.travelCost > 300) {
        events.push({
          entityType: "employee",
          entityId: day.employeeId,
          category: "Field Operations Risk",
          severity: "amber",
          score: clampScore(day.travelCost / 15),
          message: `${label(day.employeeId)}: high travel cost (R${Math.round(day.travelCost)})`,
        });
      }
    }
  }

  return events.sort((a, b) => b.score - a.score);
}

function avgCategory(
  rows: WorkforceRiskScoreRow[],
  category: WorkforceRiskCategory
): number {
  if (!rows.length) return 0;
  return clampScore(
    rows.reduce((s, r) => s + r.categories[category], 0) / rows.length
  );
}

export function generateAiRecommendations(
  dashboard: Omit<
    WorkforceRiskDashboard,
    | "recommendations"
    | "tablesAvailable"
    | "greenCount"
    | "amberCount"
    | "redCount"
    | "workforceRiskIndex"
    | "highRiskEmployeeCount"
    | "highRiskStoreCount"
    | "highRiskManagerCount"
    | "categorySummary"
  >
): WorkforceRiskRecommendation[] {
  const recs: WorkforceRiskRecommendation[] = [];

  for (const emp of dashboard.topRiskEmployees.slice(0, 5)) {
    const topCategory = (
      Object.entries(emp.categories) as [WorkforceRiskCategory, number][]
    )
      .filter(([cat]) => cat !== "Manager Risk" && cat !== "Store Risk")
      .sort((a, b) => b[1] - a[1])[0];
    if (!topCategory || topCategory[1] < 40) continue;
    const template = RECOMMENDATION_TEMPLATES[topCategory[0]];
    const copy = template
      ? template(emp.entityLabel)
      : {
          title: `Review ${emp.entityLabel}`,
          detail: `Primary signal: ${topCategory[0]} (${topCategory[1]}/100).`,
        };
    recs.push({
      id: `rec-emp-${emp.entityId}-${topCategory[0]}`,
      band: emp.riskBand,
      priority: emp.overallScore,
      title: copy.title,
      detail: `${copy.detail} ${emp.factors.slice(0, 2).join("; ")}`.trim(),
      entityType: "employee",
      entityId: emp.entityId,
      entityLabel: emp.entityLabel,
    });
  }

  for (const store of dashboard.topRiskStores.slice(0, 3)) {
    if (store.overallScore < 40) continue;
    const template = RECOMMENDATION_TEMPLATES["Store Risk"]!(store.entityLabel);
    recs.push({
      id: `rec-store-${store.entityId}`,
      band: store.riskBand,
      priority: store.overallScore,
      title: template.title,
      detail: `${template.detail} Store: ${store.entityLabel} (${store.overallScore}/100).`,
      entityType: "store",
      entityId: store.entityId,
      entityLabel: store.entityLabel,
    });
  }

  for (const mgr of dashboard.topRiskManagers.slice(0, 3)) {
    if (mgr.overallScore < 40) continue;
    recs.push({
      id: `rec-mgr-${mgr.entityId}`,
      band: mgr.riskBand,
      priority: mgr.overallScore,
      title: "Review overtime approvals for this manager",
      detail: `Manager risk index ${mgr.overallScore}/100 for ${mgr.entityLabel}. Prioritise exception closure and attendance follow-up.`,
      entityType: "manager",
      entityId: mgr.entityId,
      entityLabel: mgr.entityLabel,
    });
  }

  if (recs.length === 0) {
    recs.push({
      id: "rec-all-clear",
      band: "green",
      priority: 0,
      title: "Workforce risk within tolerance",
      detail:
        "No critical red-band patterns detected across clocking, field operations, cost leakage, leave, or payroll readiness.",
    });
  }

  return recs.sort((a, b) => b.priority - a.priority).slice(0, 12);
}

export function buildWorkforceRiskDashboard(
  context: WorkforceRiskContext,
  options?: {
    employeeDayLeakage?: Map<string, number>;
    employeeOvertimeSeconds?: Map<string, number>;
    employeeWorkingSeconds?: Map<string, number>;
    employeeFieldSignals?: Map<string, EmployeeFieldOpsSignals>;
    journeyDashboard?: WorkforceJourneyDashboard | null;
    costDashboard?: WorkforceCostDashboard | null;
    tablesAvailable?: boolean;
  }
): WorkforceRiskDashboard {
  const weekStart = daysAgoIso(7);
  const rosterDaysByEmployee = new Map<string, number>();
  for (const shift of context.rosterShifts) {
    if (shift.shift_date < weekStart) continue;
    rosterDaysByEmployee.set(
      shift.employee_id,
      (rosterDaysByEmployee.get(shift.employee_id) || 0) + 1
    );
  }

  const employeeScores = computeEmployeeRiskScores({
    context,
    employeeDayLeakage: options?.employeeDayLeakage || new Map(),
    employeeOvertimeSeconds: options?.employeeOvertimeSeconds || new Map(),
    employeeWorkingSeconds: options?.employeeWorkingSeconds || new Map(),
    employeeFieldSignals: options?.employeeFieldSignals || new Map(),
    rosterDaysByEmployee,
  });

  const storeScores = computeStoreRiskScores({ context, employeeScores });
  const managerScores = computeManagerRiskScores({
    context,
    employeeScores,
    storeScores,
  });

  const employeeList = [...employeeScores.values()].sort(
    (a, b) => b.overallScore - a.overallScore
  );

  const employeeLabels = new Map(
    context.employees.map((e) => [e.id, employeeLabel(e)])
  );
  const events = buildDetailedRiskEvents({
    context,
    employeeLabels,
    journeyDashboard: options?.journeyDashboard,
    costDashboard: options?.costDashboard,
  });

  const allBands = employeeList.map((e) => e.riskBand);
  const partial = {
    scoreDate: context.scoreDate,
    companyId: context.companyId,
    topRiskEmployees: employeeList.slice(0, 8),
    topRiskStores: storeScores.slice(0, 8),
    topRiskManagers: [...managerScores]
      .sort((a, b) => b.overallScore - a.overallScore)
      .slice(0, 8),
    employeeScores: employeeList,
    storeScores,
    managerScores,
    events,
  };

  const recommendations = generateAiRecommendations(partial);

  const withRecs = employeeList.map((e) => ({
    ...e,
    recommendations: recommendations.filter((r) => r.entityId === e.entityId),
  }));

  const workforceRiskIndex = employeeList.length
    ? clampScore(employeeList.reduce((s, e) => s + e.overallScore, 0) / employeeList.length)
    : 0;

  const categorySummary: WorkforceRiskCategorySummary = {
    attendanceRisk: avgCategory(employeeList, "Attendance Risk"),
    overtimeRisk: avgCategory(employeeList, "Overtime Risk"),
    payrollLeakageRisk: avgCategory(employeeList, "Payroll Leakage Risk"),
    burnoutRisk: avgCategory(employeeList, "Burnout Risk"),
    fieldOperationsRisk: avgCategory(employeeList, "Field Operations Risk"),
  };

  return {
    ...partial,
    employeeScores: withRecs,
    topRiskEmployees: withRecs.slice(0, 8),
    workforceRiskIndex,
    greenCount: allBands.filter((b) => b === "green").length,
    amberCount: allBands.filter((b) => b === "amber").length,
    redCount: allBands.filter((b) => b === "red").length,
    highRiskEmployeeCount: employeeList.filter((e) => e.overallScore >= 70).length,
    highRiskStoreCount: storeScores.filter((s) => s.overallScore >= 70).length,
    highRiskManagerCount: managerScores.filter((m) => m.overallScore >= 70).length,
    categorySummary,
    recommendations,
    tablesAvailable: options?.tablesAvailable ?? true,
  };
}

export async function fetchWorkforceRiskContext(
  supabase: SupabaseClient,
  companyId: string,
  scoreDate: string
): Promise<WorkforceRiskContext> {
  const weekStart = daysAgoIso(14);

  const [
    employeesRes,
    storesRes,
    clockRes,
    rosterRes,
    payrollHoursRes,
    payrollChecksRes,
    leaveRes,
    hrCasesRes,
    hrWarningsRes,
    exceptionsRes,
    rolesRes,
  ] = await Promise.all([
    supabase
      .from("employees")
      .select("id, first_name, last_name, default_store_id, job_title")
      .eq("company_id", companyId)
      .eq("active", true),
    supabase.from("stores").select("id, name").eq("company_id", companyId),
    supabase
      .from("clock_events")
      .select("id, employee_id, store_id, event_type, event_time")
      .eq("company_id", companyId)
      .gte("event_time", `${weekStart}T00:00:00`)
      .order("event_time", { ascending: false })
      .limit(500),
    supabase
      .from("roster_shifts")
      .select("id, employee_id, store_id, shift_date, planned_start, planned_end, status")
      .eq("company_id", companyId)
      .gte("shift_date", weekStart),
    supabase
      .from("payroll_hours")
      .select("employee_id, overtime_hours, late_minutes, missing_clock_events, status")
      .eq("company_id", companyId)
      .order("created_at", { ascending: false })
      .limit(200),
    supabase
      .from("payroll_clock_checks")
      .select(
        "employee_id, store_id, shift_date, missing_clock_in, missing_clock_out, late_minutes, overtime_minutes, exception_required, payroll_status"
      )
      .eq("company_id", companyId)
      .gte("shift_date", weekStart),
    supabase.from("leave_requests").select("employee_id, status, leave_type, start_date").limit(300),
    supabase
      .from("hr_cases")
      .select("employee_id, status, case_type")
      .eq("company_id", companyId)
      .limit(200),
    supabase.from("hr_warnings").select("employee_id, status").limit(200),
    supabase
      .from("time_exceptions")
      .select("employee_id, store_id, status")
      .eq("company_id", companyId)
      .limit(200),
    supabase
      .from("user_roles")
      .select("user_email, role")
      .eq("company_id", companyId),
  ]);

  return {
    companyId,
    scoreDate,
    employees: (employeesRes.data || []) as WorkforceRiskEmployee[],
    stores: (storesRes.data || []) as WorkforceRiskStore[],
    clockEvents: (clockRes.data || []) as WorkforceRiskClockEvent[],
    rosterShifts: (rosterRes.data || []) as WorkforceRiskRosterShift[],
    payrollHours: (payrollHoursRes.data || []) as WorkforceRiskPayrollHours[],
    payrollClockChecks: (payrollChecksRes.data || []) as WorkforceRiskPayrollClockCheck[],
    leaveRequests: (leaveRes.data || []) as WorkforceRiskLeaveRequest[],
    hrCases: (hrCasesRes.data || []) as WorkforceRiskHrCase[],
    hrWarnings: (hrWarningsRes.data || []) as WorkforceRiskHrWarning[],
    exceptions: (exceptionsRes.data || []) as WorkforceRiskException[],
    userRoles: (rolesRes.data || []) as WorkforceRiskUserRole[],
  };
}

export async function syncWorkforceRiskData(
  supabase: SupabaseClient,
  dashboard: WorkforceRiskDashboard
): Promise<{ ok: boolean; error: string | null }> {
  const now = new Date().toISOString();
  const allScores = [
    ...dashboard.employeeScores,
    ...dashboard.storeScores,
    ...dashboard.managerScores,
  ];

  for (const row of allScores) {
    const { error } = await supabase.from("workforce_risk_scores").upsert(
      {
        company_id: dashboard.companyId,
        score_date: dashboard.scoreDate,
        entity_type: row.entityType,
        entity_id: row.entityId,
        entity_label: row.entityLabel,
        attendance_risk: row.categories["Attendance Risk"],
        overtime_risk: row.categories["Overtime Risk"],
        payroll_leakage_risk: row.categories["Payroll Leakage Risk"],
        burnout_risk: row.categories["Burnout Risk"],
        resignation_risk: row.categories["Resignation Risk"],
        manager_risk: row.categories["Manager Risk"],
        store_risk: row.categories["Store Risk"],
        field_operations_risk: row.categories["Field Operations Risk"],
        overall_score: row.overallScore,
        risk_band: row.riskBand,
        factors: row.factors,
        recommendations: row.recommendations,
        computed_at: now,
        updated_at: now,
      },
      { onConflict: "company_id,score_date,entity_type,entity_id" }
    );
    if (error && !isRiskMissingTableError(error)) return { ok: false, error: error.message };
  }

  await supabase
    .from("workforce_risk_events")
    .delete()
    .eq("company_id", dashboard.companyId)
    .eq("score_date", dashboard.scoreDate);

  if (dashboard.events.length) {
    const { error } = await supabase.from("workforce_risk_events").insert(
      dashboard.events.map((ev) => ({
        company_id: dashboard.companyId,
        score_date: dashboard.scoreDate,
        entity_type: ev.entityType,
        entity_id: ev.entityId,
        category: ev.category,
        severity: ev.severity,
        score: ev.score,
        message: ev.message,
        recorded_at: now,
      }))
    );
    if (error && !isRiskMissingTableError(error)) return { ok: false, error: error.message };
  }

  await supabase
    .from("workforce_risk_recommendations")
    .delete()
    .eq("company_id", dashboard.companyId)
    .eq("score_date", dashboard.scoreDate);

  if (dashboard.recommendations.length) {
    const { error: recError } = await supabase.from("workforce_risk_recommendations").insert(
      dashboard.recommendations.map((rec) => ({
        company_id: dashboard.companyId,
        score_date: dashboard.scoreDate,
        entity_type: rec.entityType || null,
        entity_id: rec.entityId || null,
        entity_label: rec.entityLabel || null,
        title: rec.title,
        detail: rec.detail,
        priority: rec.priority,
        risk_band: rec.band,
      }))
    );
    if (recError && !isRiskMissingTableError(recError)) {
      return { ok: false, error: recError.message };
    }
  }

  return { ok: true, error: null };
}

export async function loadWorkforceRiskDashboard(
  supabase: SupabaseClient,
  companyId: string,
  scoreDate: string
): Promise<{ dashboard: WorkforceRiskDashboard | null; error: string | null }> {
  if (!companyId) return { dashboard: null, error: "No company selected." };

  const context = await fetchWorkforceRiskContext(supabase, companyId, scoreDate);

  const fieldSnapshot = await fetchFieldOperationsSnapshot(supabase, companyId);
  const journeyDashboard = fieldSnapshot.tablesAvailable
    ? buildWorkforceJourneyDashboard(fieldSnapshot, scoreDate, companyId)
    : null;
  const costDashboard = fieldSnapshot.tablesAvailable
    ? buildWorkforceCostDashboard({
        snapshot: fieldSnapshot,
        costDate: scoreDate,
        companyId,
      })
    : null;

  const employeeDayLeakage = new Map<string, number>();
  const employeeOvertimeSeconds = new Map<string, number>();
  const employeeWorkingSeconds = new Map<string, number>();
  const employeeFieldSignals = new Map<string, EmployeeFieldOpsSignals>();

  if (journeyDashboard) {
    for (const j of journeyDashboard.journeys) {
      const ot = Math.max(0, j.route.travelSeconds + j.route.workingSeconds - 8 * 3600);
      employeeOvertimeSeconds.set(j.employeeId, ot);
      employeeWorkingSeconds.set(j.employeeId, j.route.workingSeconds);
      employeeFieldSignals.set(j.employeeId, {
        idleSeconds: j.route.idleSeconds,
        travelSeconds: j.route.travelSeconds,
        productivityPct: j.route.productivityPct,
        alertCount: j.alerts.length,
        travelCost: 0,
        jobsCompleted: j.route.jobsCompleted,
      });
    }
  }
  if (costDashboard) {
    for (const day of costDashboard.employeeDayCosts) {
      employeeDayLeakage.set(day.employeeId, day.leakageValue);
      const existing = employeeFieldSignals.get(day.employeeId);
      if (existing) {
        existing.travelCost = day.travelCost;
      } else {
        employeeFieldSignals.set(day.employeeId, {
          idleSeconds: 0,
          travelSeconds: 0,
          productivityPct: 100,
          alertCount: 0,
          travelCost: day.travelCost,
          jobsCompleted: 0,
        });
      }
    }
  }

  const dashboard = buildWorkforceRiskDashboard(context, {
    employeeDayLeakage,
    employeeOvertimeSeconds,
    employeeWorkingSeconds,
    employeeFieldSignals,
    journeyDashboard,
    costDashboard,
    tablesAvailable: true,
  });

  const sync = await syncWorkforceRiskData(supabase, dashboard);
  return { dashboard, error: sync.error };
}

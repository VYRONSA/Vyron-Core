/**
 * VYRON CORE Batch 9 — Workforce Operating System foundation.
 * Aggregates clocking, leave, rosters, payroll, field, cost, risk & recruitment signals.
 * No fake AI, no auto-execution, no destructive actions.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { isSupabaseMissingTableError } from "@/lib/company-access";
import { buildWorkforceCostDashboard } from "@/lib/field-cost-intelligence";
import { fetchFieldOperationsSnapshot } from "@/lib/field-operations";
import {
  loadPayrollIntelligence,
  type PayrollIntelligenceDashboard,
} from "@/lib/payroll-intelligence";
import {
  loadRecruitmentIntelligence,
  type RecruitmentIntelligenceDashboard,
} from "@/lib/recruitment-intelligence";
import { fetchCopilotContext } from "@/lib/workforce-ai-copilot";
import { buildWorkforceDigitalTwinDashboard } from "@/lib/workforce-digital-twin";
import {
  loadWorkforceRiskDashboard,
  type WorkforceRiskDashboard,
} from "@/lib/workforce-risk-intelligence";

export const AUTOMATION_LIBRARY_TEMPLATES = [
  {
    template_key: "late_arrival_warning",
    template_name: "Late Arrival Warning",
    trigger_description: "Employee clocks in late beyond roster threshold",
    required_approval: true,
    action_type: "Create Warning",
    risk_level: "low",
    status: "library",
  },
  {
    template_key: "excessive_overtime_review",
    template_name: "Excessive Overtime Review",
    trigger_description: "Overtime minutes exceed policy limit for pay period",
    required_approval: true,
    action_type: "Mark Payroll Item For Review",
    risk_level: "medium",
    status: "library",
  },
  {
    template_key: "leave_approval_workflow",
    template_name: "Leave Approval Workflow",
    trigger_description: "Leave request submitted and awaiting manager decision",
    required_approval: true,
    action_type: "Approve Leave",
    risk_level: "low",
    status: "library",
  },
  {
    template_key: "field_job_assignment",
    template_name: "Field Job Assignment",
    trigger_description: "New field job created and requires primary assignee",
    required_approval: true,
    action_type: "Create Field Job",
    risk_level: "medium",
    status: "library",
  },
  {
    template_key: "manager_escalation",
    template_name: "Manager Escalation",
    trigger_description: "Unresolved exception or HR case exceeds SLA",
    required_approval: true,
    action_type: "Escalate Exception",
    risk_level: "high",
    status: "library",
  },
  {
    template_key: "payroll_exception_review",
    template_name: "Payroll Exception Review",
    trigger_description: "Payroll readiness blocker or leakage signal detected",
    required_approval: true,
    action_type: "Mark Payroll Item For Review",
    risk_level: "high",
    status: "library",
  },
] as const;

export type WorkforceHealthBand = "red" | "amber" | "green";

export type MetricValue = {
  value: string | number | null;
  display: string;
  needsMoreData: boolean;
};

export type ExecutiveCommandCentre = {
  workforceHealth: MetricValue;
  labourCost: MetricValue;
  payrollReadiness: MetricValue;
  productivity: MetricValue;
  workforceRisk: MetricValue;
  openVacancies: MetricValue;
  activeFieldJobs: MetricValue;
  predictedLeakage: MetricValue;
};

export type OperationalCommandCentre = {
  employeesWorking: MetricValue;
  employeesTravelling: MetricValue;
  employeesOnSite: MetricValue;
  employeesOnLeave: MetricValue;
  activeJobs: MetricValue;
  delayedJobs: MetricValue;
  exceptions: MetricValue;
  highRiskEmployees: MetricValue;
  activityFeed: { id: string; time: string; label: string; detail: string }[];
};

export type WorkforceOperatingSummary = {
  workforceHealth: MetricValue;
  workforceRisk: MetricValue;
  payrollReadiness: MetricValue;
  labourCost: MetricValue;
  productivity: MetricValue;
  hiringReadiness: MetricValue;
  fieldOperationsHealth: MetricValue;
};

export type WorkforceHealthCategory = {
  key: string;
  label: string;
  score: number | null;
  band: WorkforceHealthBand | null;
  needsMoreData: boolean;
};

export type WorkforceHealthScore = {
  overallScore: number | null;
  overallBand: WorkforceHealthBand | null;
  needsMoreData: boolean;
  categories: WorkforceHealthCategory[];
};

export type AutomationTemplate = {
  id?: string;
  templateKey: string;
  templateName: string;
  triggerDescription: string;
  requiredApproval: boolean;
  actionType: string;
  riskLevel: string;
  status: string;
};

export type OperatingInsight = {
  id: string;
  severity: "info" | "warning" | "critical";
  title: string;
  detail: string;
  sourceModules: string[];
};

export type WorkforceOperatingDashboard = {
  companyId: string;
  snapshotDate: string;
  executive: ExecutiveCommandCentre;
  operational: OperationalCommandCentre;
  summary: WorkforceOperatingSummary;
  healthScore: WorkforceHealthScore;
  automationTemplates: AutomationTemplate[];
  insights: OperatingInsight[];
  recommendations: OperatingInsight[];
  tablesAvailable: boolean;
};

const WOS_TABLES = [
  "workforce_operating_snapshots",
  "workforce_operating_health_scores",
  "workforce_operating_insights",
  "workforce_automation_templates",
  "workforce_operating_audit_log",
] as const;

const NEEDS_MORE = "Needs more data";

function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function metric(
  value: string | number | null,
  formatter?: (v: number) => string
): MetricValue {
  if (value === null || value === undefined || Number.isNaN(value as number)) {
    return { value: null, display: NEEDS_MORE, needsMoreData: true };
  }
  if (typeof value === "number" && formatter) {
    return { value, display: formatter(value), needsMoreData: false };
  }
  return { value, display: String(value), needsMoreData: false };
}

export function scoreToHealthBand(score: number): WorkforceHealthBand {
  if (score >= 70) return "green";
  if (score >= 40) return "amber";
  return "red";
}

export function healthBandClass(band: WorkforceHealthBand | null): string {
  if (band === "green") return "border-emerald-200 bg-emerald-50 text-emerald-800";
  if (band === "amber") return "border-amber-200 bg-amber-50 text-amber-800";
  return "border-rose-200 bg-rose-50 text-rose-800";
}

function invertRisk(risk: number | null | undefined): number | null {
  if (risk == null || Number.isNaN(risk)) return null;
  return Math.max(0, Math.min(100, Math.round(100 - risk)));
}

function avgNullable(values: (number | null)[]): number | null {
  const valid = values.filter((v): v is number => v != null && !Number.isNaN(v));
  if (valid.length === 0) return null;
  return Math.round(valid.reduce((s, v) => s + v, 0) / valid.length);
}

export function computeWorkforceHealthScore(input: {
  riskDashboard: WorkforceRiskDashboard | null;
  payrollDashboard: PayrollIntelligenceDashboard | null;
  twinProductivity: number | null;
  twinWorkforceHealth: number | null;
  costProductivity: number | null;
  unapprovedLeaveCount: number;
  activeEmployeeCount: number;
  fieldTablesAvailable: boolean;
  openFieldJobs: number;
  completedFieldJobs: number;
}): WorkforceHealthScore {
  const cs = input.riskDashboard?.categorySummary;

  const attendance = cs
    ? invertRisk(cs.attendanceRisk)
    : input.twinWorkforceHealth != null
      ? Math.round(input.twinWorkforceHealth)
      : null;

  const productivity =
    input.twinProductivity != null
      ? Math.round(input.twinProductivity)
      : input.costProductivity != null
        ? Math.round(input.costProductivity)
        : null;

  const leavePenalty = Math.min(40, input.unapprovedLeaveCount * 8);
  const leave =
    input.activeEmployeeCount > 0 ? Math.max(0, 100 - leavePenalty) : null;

  const risk = input.riskDashboard
    ? invertRisk(input.riskDashboard.workforceRiskIndex)
    : null;

  const overtime = cs ? invertRisk(cs.overtimeRisk) : null;

  let fieldOps: number | null = null;
  if (input.fieldTablesAvailable) {
    const total = input.openFieldJobs + input.completedFieldJobs;
    if (total > 0) {
      fieldOps = Math.round((input.completedFieldJobs / total) * 100);
    }
  }

  const payrollReadiness = input.payrollDashboard?.readinessScore ?? null;

  const categories: WorkforceHealthCategory[] = [
    { key: "attendance", label: "Attendance", score: attendance, band: attendance != null ? scoreToHealthBand(attendance) : null, needsMoreData: attendance == null },
    { key: "productivity", label: "Productivity", score: productivity, band: productivity != null ? scoreToHealthBand(productivity) : null, needsMoreData: productivity == null },
    { key: "leave", label: "Leave", score: leave, band: leave != null ? scoreToHealthBand(leave) : null, needsMoreData: leave == null },
    { key: "risk", label: "Risk", score: risk, band: risk != null ? scoreToHealthBand(risk) : null, needsMoreData: risk == null },
    { key: "overtime", label: "Overtime", score: overtime, band: overtime != null ? scoreToHealthBand(overtime) : null, needsMoreData: overtime == null },
    { key: "field_ops", label: "Field Operations", score: fieldOps, band: fieldOps != null ? scoreToHealthBand(fieldOps) : null, needsMoreData: fieldOps == null },
    { key: "payroll", label: "Payroll Readiness", score: payrollReadiness, band: payrollReadiness != null ? scoreToHealthBand(payrollReadiness) : null, needsMoreData: payrollReadiness == null },
  ];

  const available = categories.filter((c) => c.score != null).map((c) => c.score!);
  const needsMoreData = available.length < 3;
  const overallScore = needsMoreData ? null : avgNullable(categories.map((c) => c.score));

  return {
    overallScore,
    overallBand: overallScore != null ? scoreToHealthBand(overallScore) : null,
    needsMoreData,
    categories,
  };
}

type OperatingContext = {
  companyId: string;
  snapshotDate: string;
  employees: { id: string; first_name: string; last_name: string; active: boolean }[];
  clockEvents: { employee_id: string; event_type: string; event_time: string }[];
  leaveRequests: { employee_id: string; status: string; start_date: string; end_date: string }[];
  timeExceptions: { id: string; status: string; description?: string; employee_id?: string }[];
  riskDashboard: WorkforceRiskDashboard | null;
  payrollDashboard: PayrollIntelligenceDashboard | null;
  recruitmentDashboard: RecruitmentIntelligenceDashboard | null;
  twinProductivity: number | null;
  twinWorkforceHealth: number | null;
  twinPredictedLeakage: number | null;
  labourCost: number | null;
  costProductivity: number | null;
  fieldSnapshot: Awaited<ReturnType<typeof fetchFieldOperationsSnapshot>>;
};

async function fetchOperatingContext(
  supabase: SupabaseClient,
  companyId: string,
  snapshotDate: string
): Promise<OperatingContext> {
  const weekStart = `${snapshotDate}T00:00:00`;

  const [ctx, clockRes, timeExceptionsRes, rosterRes, riskLoad, fieldSnapshot, payrollLoad, recruitmentLoad] =
    await Promise.all([
      fetchCopilotContext(supabase, companyId, snapshotDate),
      supabase
        .from("clock_events")
        .select("employee_id, event_type, event_time")
        .eq("company_id", companyId)
        .gte("event_time", weekStart)
        .order("event_time", { ascending: false })
        .limit(200),
      supabase
        .from("time_exceptions")
        .select("id, status, description, employee_id")
        .eq("company_id", companyId)
        .limit(100),
      supabase
        .from("roster_shifts")
        .select("store_id, shift_date, employee_id")
        .eq("company_id", companyId)
        .gte("shift_date", snapshotDate)
        .limit(300),
      loadWorkforceRiskDashboard(supabase, companyId, snapshotDate),
      fetchFieldOperationsSnapshot(supabase, companyId),
      loadPayrollIntelligence(supabase, companyId, snapshotDate),
      loadRecruitmentIntelligence(supabase, companyId, snapshotDate),
    ]);

  const twin = buildWorkforceDigitalTwinDashboard(
    ctx,
    (rosterRes.data || []) as { store_id: string | null; shift_date: string; employee_id: string }[]
  );

  const costDashboard = fieldSnapshot.tablesAvailable
    ? buildWorkforceCostDashboard({
        snapshot: fieldSnapshot,
        costDate: snapshotDate,
        companyId,
      })
    : null;

  return {
    companyId,
    snapshotDate,
    employees: ctx.employees.map((e) => ({
      id: e.id,
      first_name: e.first_name,
      last_name: e.last_name,
      active: true,
    })),
    clockEvents: (clockRes.data || []) as OperatingContext["clockEvents"],
    leaveRequests: ctx.leaveRequests as OperatingContext["leaveRequests"],
    timeExceptions: (timeExceptionsRes.data || []) as OperatingContext["timeExceptions"],
    riskDashboard: riskLoad.dashboard,
    payrollDashboard: payrollLoad.dashboard,
    recruitmentDashboard: recruitmentLoad.dashboard,
    twinProductivity: twin.executive.productivityPct,
    twinWorkforceHealth: twin.executive.workforceHealthPct,
    twinPredictedLeakage: twin.executive.predictedLeakage,
    labourCost: costDashboard?.totalCost ?? twin.executive.labourCostToday,
    costProductivity: costDashboard?.fieldMarginPct ?? null,
    fieldSnapshot,
  };
}

function buildActivityFeed(ctx: OperatingContext): OperationalCommandCentre["activityFeed"] {
  const feed: OperationalCommandCentre["activityFeed"] = [];

  for (const ev of ctx.clockEvents.slice(0, 12)) {
    const emp = ctx.employees.find((e) => e.id === ev.employee_id);
    feed.push({
      id: `clock-${ev.event_time}-${ev.employee_id}`,
      time: ev.event_time,
      label: emp ? `${emp.first_name} ${emp.last_name}` : ev.employee_id,
      detail: `Clock ${ev.event_type.replace("_", " ")}`,
    });
  }

  if (ctx.fieldSnapshot.tablesAvailable) {
    for (const ev of ctx.fieldSnapshot.events.slice(0, 8)) {
      feed.push({
        id: `field-${ev.id}`,
        time: ev.recordedAt,
        label: ev.employeeId,
        detail: ev.eventType,
      });
    }
  }

  return feed.sort((a, b) => Date.parse(b.time) - Date.parse(a.time)).slice(0, 15);
}

export function buildWorkforceOperatingDashboard(ctx: OperatingContext): WorkforceOperatingDashboard {
  const today = ctx.snapshotDate;
  const activeEmployees = ctx.employees.filter((e) => e.active !== false);

  const clockedInToday = new Set<string>();
  const eventsToday = ctx.clockEvents.filter((e) => e.event_time.slice(0, 10) === today);
  const lastByEmployee = new Map<string, string>();
  for (const e of eventsToday) {
    lastByEmployee.set(e.employee_id, e.event_type);
  }
  for (const [empId, type] of lastByEmployee) {
    if (type === "clock_in" || type === "break_end") clockedInToday.add(empId);
  }

  const onLeaveToday = ctx.leaveRequests.filter(
    (l) =>
      ["approved", "pending", "submitted", "awaiting_approval"].includes(
        (l.status || "").toLowerCase()
      ) &&
      l.start_date <= today &&
      l.end_date >= today
  ).length;

  const travelling = ctx.fieldSnapshot.tablesAvailable
    ? ctx.fieldSnapshot.jobs.filter((j) => j.status === "Travelling").length
    : null;

  const onSite = ctx.fieldSnapshot.tablesAvailable
    ? ctx.fieldSnapshot.jobs.filter((j) => j.status === "On Site").length
    : null;

  const activeJobs = ctx.fieldSnapshot.tablesAvailable
    ? ctx.fieldSnapshot.jobs.filter(
        (j) => !["Completed", "Cancelled"].includes(j.status)
      ).length
    : null;

  const delayedJobs = ctx.fieldSnapshot.tablesAvailable
    ? ctx.fieldSnapshot.jobs.filter((j) => {
        if (!j.scheduledEnd || ["Completed", "Cancelled"].includes(j.status)) return false;
        return j.scheduledEnd.slice(0, 10) < today && j.status !== "Completed";
      }).length
    : null;

  const openExceptions = ctx.timeExceptions.filter(
    (e) => e.status !== "closed" && e.status !== "approved"
  ).length;

  const highRisk = ctx.riskDashboard?.highRiskEmployeeCount ?? null;

  const unapprovedLeave = ctx.leaveRequests.filter((l) =>
    ["pending", "submitted", "awaiting_approval"].includes((l.status || "").toLowerCase())
  ).length;

  const completedJobs = ctx.fieldSnapshot.tablesAvailable
    ? ctx.fieldSnapshot.jobs.filter((j) => j.status === "Completed").length
    : 0;

  const healthScore = computeWorkforceHealthScore({
    riskDashboard: ctx.riskDashboard,
    payrollDashboard: ctx.payrollDashboard,
    twinProductivity: ctx.twinProductivity,
    twinWorkforceHealth: ctx.twinWorkforceHealth,
    costProductivity: ctx.costProductivity,
    unapprovedLeaveCount: unapprovedLeave,
    activeEmployeeCount: activeEmployees.length,
    fieldTablesAvailable: ctx.fieldSnapshot.tablesAvailable,
    openFieldJobs: activeJobs ?? 0,
    completedFieldJobs: completedJobs,
  });

  const executive: ExecutiveCommandCentre = {
    workforceHealth: metric(
      healthScore.overallScore,
      (v) => `${v}%`
    ),
    labourCost: metric(
      ctx.labourCost,
      (v) => `R${Math.round(v).toLocaleString("en-ZA")}`
    ),
    payrollReadiness: metric(
      ctx.payrollDashboard?.readinessScore ?? null,
      (v) => `${v}%`
    ),
    productivity: metric(ctx.twinProductivity, (v) => `${Math.round(v)}%`),
    workforceRisk: metric(
      ctx.riskDashboard?.workforceRiskIndex ?? null,
      (v) => String(v)
    ),
    openVacancies: metric(ctx.recruitmentDashboard?.openVacancyCount ?? null),
    activeFieldJobs: metric(activeJobs),
    predictedLeakage: metric(
      ctx.twinPredictedLeakage ?? ctx.payrollDashboard?.totalLeakageZar ?? null,
      (v) => `R${Math.round(v).toLocaleString("en-ZA")}`
    ),
  };

  const operational: OperationalCommandCentre = {
    employeesWorking: metric(clockedInToday.size),
    employeesTravelling: metric(travelling),
    employeesOnSite: metric(onSite),
    employeesOnLeave: metric(onLeaveToday),
    activeJobs: metric(activeJobs),
    delayedJobs: metric(delayedJobs),
    exceptions: metric(openExceptions),
    highRiskEmployees: metric(highRisk),
    activityFeed: buildActivityFeed(ctx),
  };

  const hiringReadiness =
    ctx.recruitmentDashboard?.hiringForecast.futureHiringNeeds != null
      ? Math.max(
          0,
          100 -
            Math.min(
              60,
              (ctx.recruitmentDashboard.hiringForecast.futureHiringNeeds || 0) * 5
            )
        )
      : null;

  let fieldHealth: number | null = null;
  if (ctx.fieldSnapshot.tablesAvailable) {
    const pressure = ctx.riskDashboard?.categorySummary.fieldOperationsRisk;
    if (pressure != null) {
      fieldHealth = invertRisk(pressure);
    } else if (activeJobs != null && completedJobs + activeJobs > 0) {
      fieldHealth = Math.round((completedJobs / (activeJobs + completedJobs)) * 100);
    }
  }

  const summary: WorkforceOperatingSummary = {
    workforceHealth: executive.workforceHealth,
    workforceRisk: executive.workforceRisk,
    payrollReadiness: executive.payrollReadiness,
    labourCost: executive.labourCost,
    productivity: executive.productivity,
    hiringReadiness: metric(hiringReadiness, (v) => `${v}%`),
    fieldOperationsHealth: metric(fieldHealth, (v) => `${v}%`),
  };

  const insights: OperatingInsight[] = [];
  const pushInsight = (
    id: string,
    severity: OperatingInsight["severity"],
    title: string,
    detail: string,
    sourceModules: string[]
  ) => {
    insights.push({ id, severity, title, detail, sourceModules });
  };

  if (healthScore.needsMoreData) {
    pushInsight(
      "gap-data",
      "info",
      "Limited operating data",
      "Connect more modules (clocking, field ops, payroll hours) for a full health score.",
      ["Workforce OS"]
    );
  }
  if (openExceptions > 0) {
    pushInsight(
      "ops-exceptions",
      openExceptions >= 5 ? "critical" : "warning",
      "Open exceptions require review",
      `${openExceptions} unresolved exception(s) in operational command centre.`,
      ["Exceptions", "Compliance"]
    );
  }
  if (ctx.payrollDashboard && ctx.payrollDashboard.blockerCount > 0) {
    pushInsight(
      "payroll-blockers",
      "warning",
      "Payroll readiness blockers",
      `${ctx.payrollDashboard.blockerCount} blocker(s) before payroll export.`,
      ["Payroll Intelligence"]
    );
  }
  if (highRisk != null && highRisk > 0) {
    pushInsight(
      "risk-employees",
      "warning",
      "High-risk employees flagged",
      `${highRisk} employee(s) above risk threshold.`,
      ["Workforce Risk Intelligence"]
    );
  }
  if (ctx.recruitmentDashboard && ctx.recruitmentDashboard.openVacancyCount > 0) {
    pushInsight(
      "open-vacancies",
      "info",
      "Open vacancies in pipeline",
      `${ctx.recruitmentDashboard.openVacancyCount} vacancy(ies) tracked.`,
      ["Recruitment Intelligence"]
    );
  }

  const recommendations =
    insights.length > 0
      ? insights
      : [
          {
            id: "rec-stable",
            severity: "info" as const,
            title: "Operating posture stable",
            detail: "No critical signals across executive and operational views.",
            sourceModules: ["Workforce OS"],
          },
        ];

  return {
    companyId: ctx.companyId,
    snapshotDate: ctx.snapshotDate,
    executive,
    operational,
    summary,
    healthScore,
    automationTemplates: AUTOMATION_LIBRARY_TEMPLATES.map((t) => ({
      templateKey: t.template_key,
      templateName: t.template_name,
      triggerDescription: t.trigger_description,
      requiredApproval: t.required_approval,
      actionType: t.action_type,
      riskLevel: t.risk_level,
      status: t.status,
    })),
    insights,
    recommendations,
    tablesAvailable: true,
  };
}

function isWosMissingTable(error: { message?: string } | null): boolean {
  if (!error) return false;
  return (
    isSupabaseMissingTableError(error) ||
    WOS_TABLES.some((t) => error.message?.includes(t))
  );
}

async function ensureAutomationTemplates(
  supabase: SupabaseClient,
  companyId: string
): Promise<AutomationTemplate[]> {
  const { count } = await supabase
    .from("workforce_automation_templates")
    .select("id", { count: "exact", head: true })
    .eq("company_id", companyId);

  if ((count ?? 0) === 0) {
    await supabase.from("workforce_automation_templates").insert(
      AUTOMATION_LIBRARY_TEMPLATES.map((t) => ({
        company_id: companyId,
        template_key: t.template_key,
        template_name: t.template_name,
        trigger_description: t.trigger_description,
        required_approval: t.required_approval,
        action_type: t.action_type,
        risk_level: t.risk_level,
        status: t.status,
      }))
    );
  }

  const { data } = await supabase
    .from("workforce_automation_templates")
    .select("*")
    .eq("company_id", companyId)
    .order("template_name");

  return ((data || []) as Record<string, unknown>[]).map((row) => ({
    id: String(row.id),
    templateKey: String(row.template_key),
    templateName: String(row.template_name),
    triggerDescription: String(row.trigger_description),
    requiredApproval: Boolean(row.required_approval),
    actionType: String(row.action_type),
    riskLevel: String(row.risk_level),
    status: String(row.status),
  }));
}

export async function syncWorkforceOperatingSystem(
  supabase: SupabaseClient,
  dashboard: WorkforceOperatingDashboard
): Promise<{ ok: boolean; error: string | null }> {
  const now = new Date().toISOString();
  const hs = dashboard.healthScore;

  const { error: snapError } = await supabase.from("workforce_operating_snapshots").upsert(
    {
      company_id: dashboard.companyId,
      snapshot_date: dashboard.snapshotDate,
      executive_json: dashboard.executive,
      operational_json: dashboard.operational,
      dashboard_json: dashboard.summary,
      data_gaps: hs.categories.filter((c) => c.needsMoreData).map((c) => c.label),
      computed_at: now,
    },
    { onConflict: "company_id,snapshot_date" }
  );
  if (snapError && !isWosMissingTable(snapError)) return { ok: false, error: snapError.message };

  const { error: healthError } = await supabase.from("workforce_operating_health_scores").upsert(
    {
      company_id: dashboard.companyId,
      score_date: dashboard.snapshotDate,
      overall_score: hs.overallScore,
      health_band: hs.overallBand,
      attendance_score: hs.categories.find((c) => c.key === "attendance")?.score ?? null,
      productivity_score: hs.categories.find((c) => c.key === "productivity")?.score ?? null,
      leave_score: hs.categories.find((c) => c.key === "leave")?.score ?? null,
      risk_score: hs.categories.find((c) => c.key === "risk")?.score ?? null,
      overtime_score: hs.categories.find((c) => c.key === "overtime")?.score ?? null,
      field_ops_score: hs.categories.find((c) => c.key === "field_ops")?.score ?? null,
      payroll_readiness_score:
        hs.categories.find((c) => c.key === "payroll")?.score ?? null,
      category_json: hs.categories,
      needs_more_data: hs.needsMoreData,
      computed_at: now,
    },
    { onConflict: "company_id,score_date" }
  );
  if (healthError && !isWosMissingTable(healthError)) return { ok: false, error: healthError.message };

  await supabase
    .from("workforce_operating_insights")
    .delete()
    .eq("company_id", dashboard.companyId)
    .eq("insight_date", dashboard.snapshotDate);

  if (dashboard.insights.length > 0) {
    const { error: insError } = await supabase.from("workforce_operating_insights").insert(
      dashboard.insights.map((i) => ({
        company_id: dashboard.companyId,
        insight_date: dashboard.snapshotDate,
        insight_type: "insight",
        severity: i.severity,
        title: i.title,
        detail: i.detail,
        source_modules: i.sourceModules,
      }))
    );
    if (insError && !isWosMissingTable(insError)) return { ok: false, error: insError.message };
  }

  await supabase.from("workforce_operating_audit_log").insert({
    company_id: dashboard.companyId,
    event_type: "snapshot_computed",
    message: `Workforce OS snapshot computed for ${dashboard.snapshotDate}`,
    metadata: {
      overallHealth: hs.overallScore,
      needsMoreData: hs.needsMoreData,
    },
  });

  return { ok: true, error: null };
}

export async function loadWorkforceOperatingSystem(
  supabase: SupabaseClient,
  companyId: string,
  snapshotDate = todayIsoDate()
): Promise<{ dashboard: WorkforceOperatingDashboard | null; error: string | null }> {
  if (!companyId) return { dashboard: null, error: "No company selected." };

  const ctx = await fetchOperatingContext(supabase, companyId, snapshotDate);
  const dashboard = buildWorkforceOperatingDashboard(ctx);
  const templates = await ensureAutomationTemplates(supabase, companyId);
  dashboard.automationTemplates =
    templates.length > 0 ? templates : dashboard.automationTemplates;

  const sync = await syncWorkforceOperatingSystem(supabase, dashboard);
  return { dashboard, error: sync.error };
}

/**
 * VYRON CORE Phase 7 — Payroll Intelligence & Payroll Readiness.
 * Aggregates clocking, leave, rosters, field ops, travel, cost & risk signals.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { isSupabaseMissingTableError } from "@/lib/company-access";
import { DEFAULT_FIELD_COST_RATE } from "@/lib/field-cost-intelligence";
import { fetchFieldOperationsSnapshot } from "@/lib/field-operations";
import { fetchCopilotContext } from "@/lib/workforce-ai-copilot";
import { loadWorkforceRiskDashboard } from "@/lib/workforce-risk-intelligence";

export const PAYROLL_READINESS_CHECK_TYPES = [
  "missing_clock_out",
  "missing_clock_in",
  "unapproved_leave",
  "roster_mismatch",
  "unresolved_exception",
  "open_field_job",
  "missing_end_day",
] as const;

export type PayrollReadinessCheckType = (typeof PAYROLL_READINESS_CHECK_TYPES)[number];

export const PAYROLL_LEAKAGE_TYPES = [
  "paid_not_worked",
  "worked_not_approved",
  "duplicate_hours",
  "overtime_without_approval",
  "travel_without_jobs",
] as const;

export type PayrollLeakageType = (typeof PAYROLL_LEAKAGE_TYPES)[number];

export type PayrollReadinessBand = "ready" | "caution" | "blocked";

export type PayrollReadinessCheck = {
  id: string;
  checkType: PayrollReadinessCheckType;
  severity: "info" | "warning" | "blocker";
  employeeId: string | null;
  entityRef: string | null;
  message: string;
  status: "open" | "resolved";
  metadata: Record<string, unknown>;
};

export type PayrollLeakageEvent = {
  id: string;
  leakageType: PayrollLeakageType;
  employeeId: string | null;
  amountZar: number;
  severity: "warning" | "critical";
  message: string;
  status: "open" | "resolved";
  metadata: Record<string, unknown>;
};

export type PayrollCostDriver = {
  label: string;
  amountZar: number;
  pct: number;
  detail: string;
};

export type PayrollForecast = {
  expectedPayroll: number;
  priorPeriodPayroll: number | null;
  variancePct: number | null;
  normalHours: number;
  overtimeHours: number;
  travelCost: number;
  idleCost: number;
  leakageExposure: number;
  costDrivers: PayrollCostDriver[];
  needsMoreData: boolean;
};

export type PayrollAiRecommendation = {
  id: string;
  priority: number;
  band: "green" | "amber" | "red";
  title: string;
  detail: string;
};

export type PayrollPayPeriod = {
  id: string | null;
  periodStart: string;
  periodEnd: string;
  label: string;
  status: string;
};

export type PayrollIntelligenceDashboard = {
  companyId: string;
  scoreDate: string;
  payPeriod: PayrollPayPeriod;
  readinessScore: number;
  readinessBand: PayrollReadinessBand;
  blockerCount: number;
  warningCount: number;
  readinessChecks: PayrollReadinessCheck[];
  leakageEvents: PayrollLeakageEvent[];
  totalLeakageZar: number;
  forecast: PayrollForecast;
  recommendations: PayrollAiRecommendation[];
  exceptionCount: number;
  tablesAvailable: boolean;
};

const PAYROLL_TABLES = [
  "payroll_pay_periods",
  "payroll_readiness_scores",
  "payroll_readiness_checks",
  "payroll_leakage_events",
  "payroll_forecasts",
] as const;

const DEFAULT_HOURLY_RATE = DEFAULT_FIELD_COST_RATE.labourRatePerHour;

function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function currentPayPeriod(): { periodStart: string; periodEnd: string; label: string } {
  const now = new Date();
  const periodStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
  const periodEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().slice(0, 10);
  const label = now.toLocaleString("en-ZA", { month: "long", year: "numeric" });
  return { periodStart, periodEnd, label };
}

function daysAgoIso(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

function empLabel(
  employees: { id: string; first_name: string; last_name: string }[],
  id: string
): string {
  const e = employees.find((x) => x.id === id);
  return e ? `${e.first_name} ${e.last_name}` : id;
}

export function readinessBandFromScore(score: number): PayrollReadinessBand {
  if (score >= 85) return "ready";
  if (score >= 60) return "caution";
  return "blocked";
}

export function readinessBandClass(band: PayrollReadinessBand): string {
  if (band === "ready") return "border-emerald-200 bg-emerald-50 text-emerald-800";
  if (band === "caution") return "border-amber-200 bg-amber-50 text-amber-800";
  return "border-rose-200 bg-rose-50 text-rose-800";
}

export function leakageSeverityClass(severity: "warning" | "critical"): string {
  return severity === "critical"
    ? "border-rose-200 bg-rose-50 text-rose-800"
    : "border-amber-200 bg-amber-50 text-amber-800";
}

function checkId(type: string, ref: string): string {
  return `chk-${type}-${ref}`;
}

function leakageId(type: string, ref: string): string {
  return `lk-${type}-${ref}`;
}

type PayrollContext = {
  companyId: string;
  scoreDate: string;
  payPeriod: PayrollPayPeriod;
  employees: { id: string; first_name: string; last_name: string; default_store_id: string | null }[];
  payrollClockChecks: {
    employee_id: string;
    store_id: string | null;
    shift_date: string;
    missing_clock_in: boolean | null;
    missing_clock_out: boolean | null;
    late_minutes: number | null;
    overtime_minutes: number | null;
    exception_required: boolean | null;
    payroll_status: string | null;
  }[];
  payrollHours: {
    employee_id: string;
    normal_hours: number | null;
    overtime_hours: number | null;
    missing_clock_events: number | null;
    status: string | null;
  }[];
  rosterShifts: {
    id: string;
    employee_id: string;
    store_id: string | null;
    shift_date: string;
    planned_start: string | null;
    planned_end: string | null;
    status: string | null;
  }[];
  clockEvents: {
    employee_id: string;
    store_id: string | null;
    event_type: string;
    event_time: string;
  }[];
  leaveRequests: {
    id: string;
    employee_id: string;
    employee_name: string | null;
    status: string;
    leave_type: string | null;
    start_date: string;
    end_date: string;
  }[];
  timeExceptions: {
    id?: string;
    employee_id: string | null;
    store_id: string | null;
    status: string;
  }[];
  fieldSnapshot: Awaited<ReturnType<typeof fetchFieldOperationsSnapshot>> | null;
  journeyDashboard: Awaited<ReturnType<typeof fetchCopilotContext>>["journeyDashboard"];
  costDashboard: Awaited<ReturnType<typeof fetchCopilotContext>>["costDashboard"];
  riskDashboard: Awaited<ReturnType<typeof loadWorkforceRiskDashboard>>["dashboard"];
};

async function fetchPayrollContext(
  supabase: SupabaseClient,
  companyId: string,
  scoreDate: string
): Promise<PayrollContext> {
  const weekStart = daysAgoIso(14);
  const payPeriod = currentPayPeriod();

  const [
    ctx,
    payrollHoursRes,
    rosterRes,
    clockRes,
    timeExceptionsRes,
    periodRes,
  ] = await Promise.all([
    fetchCopilotContext(supabase, companyId, scoreDate),
    supabase
      .from("payroll_hours")
      .select("employee_id, normal_hours, overtime_hours, missing_clock_events, status")
      .eq("company_id", companyId)
      .order("created_at", { ascending: false })
      .limit(300),
    supabase
      .from("roster_shifts")
      .select("id, employee_id, store_id, shift_date, planned_start, planned_end, status")
      .eq("company_id", companyId)
      .gte("shift_date", weekStart)
      .lte("shift_date", payPeriod.periodEnd),
    supabase
      .from("clock_events")
      .select("employee_id, store_id, event_type, event_time")
      .eq("company_id", companyId)
      .gte("event_time", `${weekStart}T00:00:00`)
      .order("event_time", { ascending: false })
      .limit(800),
    supabase
      .from("time_exceptions")
      .select("id, employee_id, store_id, status")
      .eq("company_id", companyId)
      .limit(200),
    supabase
      .from("payroll_pay_periods")
      .select("id, period_start, period_end, label, status")
      .eq("company_id", companyId)
      .eq("period_start", payPeriod.periodStart)
      .eq("period_end", payPeriod.periodEnd)
      .maybeSingle(),
  ]);

  const storedPeriod = periodRes.data as {
    id: string;
    period_start: string;
    period_end: string;
    label: string;
    status: string;
  } | null;

  return {
    companyId,
    scoreDate,
    payPeriod: storedPeriod
      ? {
          id: storedPeriod.id,
          periodStart: storedPeriod.period_start,
          periodEnd: storedPeriod.period_end,
          label: storedPeriod.label,
          status: storedPeriod.status,
        }
      : { id: null, ...payPeriod, status: "open" },
    employees: ctx.employees,
    payrollClockChecks: ctx.payrollClockChecks as PayrollContext["payrollClockChecks"],
    payrollHours: (payrollHoursRes.data || []) as PayrollContext["payrollHours"],
    rosterShifts: (rosterRes.data || []) as PayrollContext["rosterShifts"],
    clockEvents: (clockRes.data || []) as PayrollContext["clockEvents"],
    leaveRequests: ctx.leaveRequests as PayrollContext["leaveRequests"],
    timeExceptions: (timeExceptionsRes.data || []) as PayrollContext["timeExceptions"],
    fieldSnapshot: ctx.fieldSnapshot,
    journeyDashboard: ctx.journeyDashboard,
    costDashboard: ctx.costDashboard,
    riskDashboard: ctx.riskDashboard,
  };
}

export function buildPayrollReadinessChecks(ctx: PayrollContext): PayrollReadinessCheck[] {
  const checks: PayrollReadinessCheck[] = [];
  const { scoreDate } = ctx;

  for (const row of ctx.payrollClockChecks) {
    if (row.missing_clock_out) {
      checks.push({
        id: checkId("missing_clock_out", `${row.employee_id}-${row.shift_date}`),
        checkType: "missing_clock_out",
        severity: "blocker",
        employeeId: row.employee_id,
        entityRef: row.shift_date,
        message: `${empLabel(ctx.employees, row.employee_id)} missing clock-out on ${row.shift_date}.`,
        status: "open",
        metadata: { shiftDate: row.shift_date, storeId: row.store_id },
      });
    }
    if (row.missing_clock_in) {
      checks.push({
        id: checkId("missing_clock_in", `${row.employee_id}-${row.shift_date}`),
        checkType: "missing_clock_in",
        severity: "blocker",
        employeeId: row.employee_id,
        entityRef: row.shift_date,
        message: `${empLabel(ctx.employees, row.employee_id)} missing clock-in on ${row.shift_date}.`,
        status: "open",
        metadata: { shiftDate: row.shift_date, storeId: row.store_id },
      });
    }
  }

  for (const leave of ctx.leaveRequests) {
    const pending = ["pending", "submitted", "awaiting_approval"].includes(
      (leave.status || "").toLowerCase()
    );
    if (!pending) continue;
    if (leave.start_date <= scoreDate && leave.end_date >= scoreDate) {
      checks.push({
        id: checkId("unapproved_leave", leave.id),
        checkType: "unapproved_leave",
        severity: "warning",
        employeeId: leave.employee_id,
        entityRef: leave.id,
        message: `Unapproved ${leave.leave_type || "leave"} for ${leave.employee_name || empLabel(ctx.employees, leave.employee_id)} (${leave.start_date} → ${leave.end_date}).`,
        status: "open",
        metadata: { status: leave.status },
      });
    }
  }

  for (const shift of ctx.rosterShifts) {
    if (shift.shift_date > scoreDate) continue;
    const dayClock = ctx.clockEvents.filter(
      (e) => e.employee_id === shift.employee_id && e.event_time.slice(0, 10) === shift.shift_date
    );
    const clockIn = dayClock.find((e) => e.event_type === "clock_in");
    if (!clockIn) {
      checks.push({
        id: checkId("roster_mismatch", shift.id),
        checkType: "roster_mismatch",
        severity: "warning",
        employeeId: shift.employee_id,
        entityRef: shift.id,
        message: `Rostered shift on ${shift.shift_date} with no clock-in for ${empLabel(ctx.employees, shift.employee_id)}.`,
        status: "open",
        metadata: { shiftDate: shift.shift_date },
      });
    } else if (shift.store_id && clockIn.store_id && shift.store_id !== clockIn.store_id) {
      checks.push({
        id: checkId("roster_mismatch", `${shift.id}-store`),
        checkType: "roster_mismatch",
        severity: "warning",
        employeeId: shift.employee_id,
        entityRef: shift.id,
        message: `Clock-in store mismatch on ${shift.shift_date} for ${empLabel(ctx.employees, shift.employee_id)}.`,
        status: "open",
        metadata: { rosterStore: shift.store_id, clockStore: clockIn.store_id },
      });
    }
  }

  for (const tex of ctx.timeExceptions) {
    if (tex.status === "closed" || tex.status === "approved" || tex.status === "resolved") continue;
    const entityRef = tex.id || `te-${tex.employee_id}-${tex.store_id}`;
    checks.push({
      id: checkId("unresolved_exception", entityRef),
      checkType: "unresolved_exception",
      severity: "blocker",
      employeeId: tex.employee_id,
      entityRef: tex.id || null,
      message: tex.id
        ? `Unresolved time exception ${tex.id.slice(0, 8)}…`
        : `Open time exception for ${tex.employee_id ? empLabel(ctx.employees, tex.employee_id) : "unknown employee"}.`,
      status: "open",
      metadata: { status: tex.status },
    });
  }

  if (ctx.fieldSnapshot?.tablesAvailable) {
    const openStatuses = new Set(["Pending", "Dispatched", "Travelling", "On Site"]);
    for (const job of ctx.fieldSnapshot.jobs) {
      if (!openStatuses.has(job.status)) continue;
      const assignee = ctx.fieldSnapshot.assignments.find((a) => a.jobId === job.id && a.status === "assigned");
      checks.push({
        id: checkId("open_field_job", job.id),
        checkType: "open_field_job",
        severity: "warning",
        employeeId: assignee?.employeeId || null,
        entityRef: job.jobRef,
        message: `Open field job ${job.jobRef} (${job.status}) may block payroll sign-off.`,
        status: "open",
        metadata: { jobTitle: job.title, status: job.status },
      });
    }

    const eventsByEmpDay = new Map<string, typeof ctx.fieldSnapshot.events>();
    for (const ev of ctx.fieldSnapshot.events) {
      const day = ev.recordedAt.slice(0, 10);
      if (day !== scoreDate) continue;
      const key = `${ev.employeeId}|${day}`;
      const list = eventsByEmpDay.get(key) || [];
      list.push(ev);
      eventsByEmpDay.set(key, list);
    }
    for (const [key, dayEvents] of eventsByEmpDay) {
      const [employeeId] = key.split("|");
      const started = dayEvents.some((e) => e.eventType === "Start Day");
      const ended = dayEvents.some((e) => e.eventType === "End Day");
      if (started && !ended) {
        checks.push({
          id: checkId("missing_end_day", key),
          checkType: "missing_end_day",
          severity: "warning",
          employeeId,
          entityRef: scoreDate,
          message: `${empLabel(ctx.employees, employeeId)} started field day without End Day on ${scoreDate}.`,
          status: "open",
          metadata: {},
        });
      }
    }
  }

  return checks;
}

export function computePayrollReadinessScore(checks: PayrollReadinessCheck[]): {
  score: number;
  band: PayrollReadinessBand;
  blockerCount: number;
  warningCount: number;
} {
  let score = 100;
  let blockerCount = 0;
  let warningCount = 0;

  for (const c of checks) {
    if (c.severity === "blocker") {
      score -= 8;
      blockerCount += 1;
    } else if (c.severity === "warning") {
      score -= 4;
      warningCount += 1;
    } else {
      score -= 2;
      warningCount += 1;
    }
  }

  const clamped = Math.max(0, Math.min(100, score));
  return {
    score: clamped,
    band: readinessBandFromScore(clamped),
    blockerCount,
    warningCount,
  };
}

export function buildPayrollLeakageEvents(ctx: PayrollContext): PayrollLeakageEvent[] {
  const events: PayrollLeakageEvent[] = [];
  const hourly = DEFAULT_HOURLY_RATE;
  const otMult = DEFAULT_FIELD_COST_RATE.overtimeMultiplier;

  for (const ph of ctx.payrollHours) {
    const normal = Number(ph.normal_hours || 0);
    const ot = Number(ph.overtime_hours || 0);
    const missing = Number(ph.missing_clock_events || 0);

    if (missing > 0 && normal + ot > 0) {
      const amount = (normal + ot) * hourly * 0.5;
      events.push({
        id: leakageId("paid_not_worked", ph.employee_id),
        leakageType: "paid_not_worked",
        employeeId: ph.employee_id,
        amountZar: Math.round(amount),
        severity: amount > 800 ? "critical" : "warning",
        message: `${empLabel(ctx.employees, ph.employee_id)} has ${missing} missing clock event(s) with recorded hours.`,
        status: "open",
        metadata: { missingClockEvents: missing, normalHours: normal, overtimeHours: ot },
      });
    }

    if (ph.status && ph.status !== "approved" && ph.status !== "exported" && normal + ot > 0) {
      const amount = normal * hourly + ot * hourly * otMult;
      events.push({
        id: leakageId("worked_not_approved", `${ph.employee_id}-${ph.status}`),
        leakageType: "worked_not_approved",
        employeeId: ph.employee_id,
        amountZar: Math.round(amount),
        severity: ot > 2 ? "critical" : "warning",
        message: `${empLabel(ctx.employees, ph.employee_id)} worked hours not approved (status: ${ph.status}).`,
        status: "open",
        metadata: { status: ph.status },
      });
    }
  }

  const shiftPairs = new Map<string, number>();
  for (const c of ctx.payrollClockChecks) {
    const key = `${c.employee_id}|${c.shift_date}`;
    shiftPairs.set(key, (shiftPairs.get(key) || 0) + 1);
  }
  for (const [key, count] of shiftPairs) {
    if (count < 2) continue;
    const [employeeId, shiftDate] = key.split("|");
    events.push({
      id: leakageId("duplicate_hours", key),
      leakageType: "duplicate_hours",
      employeeId,
      amountZar: Math.round(8 * hourly),
      severity: "warning",
      message: `Duplicate payroll clock entries for ${empLabel(ctx.employees, employeeId)} on ${shiftDate}.`,
      status: "open",
      metadata: { duplicateCount: count },
    });
  }

  for (const c of ctx.payrollClockChecks) {
    const otMin = Number(c.overtime_minutes || 0);
    if (otMin <= 0) continue;
    const approved = (c.payroll_status || "").toLowerCase() === "approved";
    if (!approved) {
      const amount = (otMin / 60) * hourly * otMult;
      events.push({
        id: leakageId("overtime_without_approval", `${c.employee_id}-${c.shift_date}`),
        leakageType: "overtime_without_approval",
        employeeId: c.employee_id,
        amountZar: Math.round(amount),
        severity: otMin > 120 ? "critical" : "warning",
        message: `${empLabel(ctx.employees, c.employee_id)} has ${otMin} min overtime without payroll approval on ${c.shift_date}.`,
        status: "open",
        metadata: { overtimeMinutes: otMin },
      });
    }
  }

  if (ctx.journeyDashboard) {
    for (const j of ctx.journeyDashboard.journeys) {
      if (j.route.jobsCompleted > 0) continue;
      if (j.route.travelSeconds < 1800) continue;
      const travelHours = j.route.travelSeconds / 3600;
      const amount = travelHours * hourly;
      events.push({
        id: leakageId("travel_without_jobs", `${j.employeeId}-${ctx.scoreDate}`),
        leakageType: "travel_without_jobs",
        employeeId: j.employeeId,
        amountZar: Math.round(amount),
        severity: travelHours > 2 ? "critical" : "warning",
        message: `${empLabel(ctx.employees, j.employeeId)} travelled ${Math.round(travelHours * 10) / 10}h with no completed jobs.`,
        status: "open",
        metadata: { travelSeconds: j.route.travelSeconds },
      });
    }
  }

  return events;
}

export function buildPayrollForecast(
  ctx: PayrollContext,
  leakageEvents: PayrollLeakageEvent[]
): PayrollForecast {
  const hourly = DEFAULT_HOURLY_RATE;
  const otMult = DEFAULT_FIELD_COST_RATE.overtimeMultiplier;

  const normalHours = ctx.payrollHours.reduce((s, r) => s + Number(r.normal_hours || 0), 0);
  const overtimeHours = ctx.payrollHours.reduce((s, r) => s + Number(r.overtime_hours || 0), 0);

  const labourPayroll = normalHours * hourly + overtimeHours * hourly * otMult;
  const travelCost = ctx.costDashboard?.travelCost ?? 0;
  const idleCost = ctx.costDashboard?.idleCost ?? 0;
  const leakageExposure = leakageEvents.reduce((s, e) => s + e.amountZar, 0);

  const expectedPayroll = Math.round(labourPayroll + travelCost * 0.35 + idleCost * 0.2);

  const employeeCount = Math.max(1, ctx.employees.length);
  const priorPeriodPayroll = Math.round(employeeCount * 8 * 22 * hourly * 0.92);
  const variancePct =
    priorPeriodPayroll > 0
      ? Math.round(((expectedPayroll - priorPeriodPayroll) / priorPeriodPayroll) * 1000) / 10
      : null;

  const drivers: PayrollCostDriver[] = [
    {
      label: "Regular labour",
      amountZar: Math.round(normalHours * hourly),
      pct: expectedPayroll > 0 ? Math.round((normalHours * hourly * 100) / expectedPayroll) : 0,
      detail: `${Math.round(normalHours * 10) / 10} normal hours`,
    },
    {
      label: "Overtime",
      amountZar: Math.round(overtimeHours * hourly * otMult),
      pct: expectedPayroll > 0 ? Math.round((overtimeHours * hourly * otMult * 100) / expectedPayroll) : 0,
      detail: `${Math.round(overtimeHours * 10) / 10} OT hours`,
    },
    {
      label: "Field travel",
      amountZar: Math.round(travelCost * 0.35),
      pct: expectedPayroll > 0 ? Math.round((travelCost * 0.35 * 100) / expectedPayroll) : 0,
      detail: "Travel cost allocation from journey intelligence",
    },
    {
      label: "Idle labour",
      amountZar: Math.round(idleCost * 0.2),
      pct: expectedPayroll > 0 ? Math.round((idleCost * 0.2 * 100) / expectedPayroll) : 0,
      detail: "Idle time from cost intelligence",
    },
    {
      label: "Leakage exposure",
      amountZar: leakageExposure,
      pct: expectedPayroll > 0 ? Math.round((leakageExposure * 100) / expectedPayroll) : 0,
      detail: "Open payroll leakage signals",
    },
  ]
    .filter((d) => d.amountZar > 0)
    .sort((a, b) => b.amountZar - a.amountZar);

  const needsMoreData =
    ctx.payrollHours.length === 0 &&
    !ctx.costDashboard &&
    !ctx.fieldSnapshot?.tablesAvailable;

  return {
    expectedPayroll,
    priorPeriodPayroll,
    variancePct,
    normalHours,
    overtimeHours,
    travelCost,
    idleCost,
    leakageExposure,
    costDrivers: drivers,
    needsMoreData,
  };
}

type PayrollRecommendationInput = Omit<
  PayrollIntelligenceDashboard,
  "recommendations" | "tablesAvailable"
> & {
  riskDashboard?: PayrollContext["riskDashboard"];
};

export function buildPayrollRecommendations(
  dashboard: PayrollRecommendationInput
): PayrollAiRecommendation[] {
  const recs: PayrollAiRecommendation[] = [];

  if (dashboard.blockerCount > 0) {
    recs.push({
      id: "rec-blockers",
      priority: 1,
      band: "red",
      title: "Resolve payroll blockers before export",
      detail: `${dashboard.blockerCount} blocker(s) detected — missing punches and unresolved exceptions must be cleared.`,
    });
  }

  const missingClock = dashboard.readinessChecks.filter(
    (c) => c.checkType === "missing_clock_in" || c.checkType === "missing_clock_out"
  );
  if (missingClock.length >= 3) {
    recs.push({
      id: "rec-clock",
      priority: 2,
      band: "amber",
      title: "Batch-fix missing clock events",
      detail: `${missingClock.length} missing clock-in/out signals. Review Clocking and payroll clock checks for the current period.`,
    });
  }

  const otLeak = dashboard.leakageEvents.filter((e) => e.leakageType === "overtime_without_approval");
  if (otLeak.length > 0) {
    recs.push({
      id: "rec-ot",
      priority: 3,
      band: "amber",
      title: "Approve or reject unapproved overtime",
      detail: `${otLeak.length} overtime leakage signal(s) totalling ~R${otLeak.reduce((s, e) => s + e.amountZar, 0).toLocaleString()}.`,
    });
  }

  if (dashboard.totalLeakageZar > 2000) {
    recs.push({
      id: "rec-leakage",
      priority: 4,
      band: "red",
      title: "Investigate payroll leakage exposure",
      detail: `Estimated open leakage R${dashboard.totalLeakageZar.toLocaleString()}. Prioritise worked-not-approved and duplicate hours.`,
    });
  }

  if (dashboard.forecast.variancePct !== null && dashboard.forecast.variancePct > 8) {
    recs.push({
      id: "rec-variance",
      priority: 5,
      band: "amber",
      title: "Payroll variance above baseline",
      detail: `Forecast is ${dashboard.forecast.variancePct}% above modelled prior period. Review overtime and travel cost drivers.`,
    });
  }

  if (dashboard.riskDashboard && dashboard.riskDashboard.workforceRiskIndex >= 60) {
    recs.push({
      id: "rec-risk",
      priority: 6,
      band: "amber",
      title: "Align payroll prep with workforce risk",
      detail: `Workforce risk index ${dashboard.riskDashboard.workforceRiskIndex}. High-risk employees may need manual payroll review.`,
    });
  }

  if (recs.length === 0) {
    recs.push({
      id: "rec-ok",
      priority: 99,
      band: "green",
      title: "Payroll intelligence looks healthy",
      detail: "No critical leakage or blocker patterns detected for the selected date.",
    });
  }

  return recs.sort((a, b) => a.priority - b.priority);
}

export function buildPayrollIntelligenceDashboard(ctx: PayrollContext): PayrollIntelligenceDashboard {
  const readinessChecks = buildPayrollReadinessChecks(ctx);
  const { score, band, blockerCount, warningCount } = computePayrollReadinessScore(readinessChecks);
  const leakageEvents = buildPayrollLeakageEvents(ctx);
  const totalLeakageZar = leakageEvents.reduce((s, e) => s + e.amountZar, 0);
  const forecast = buildPayrollForecast(ctx, leakageEvents);

  const exceptionChecks = readinessChecks.filter(
    (c) => c.checkType === "unresolved_exception"
  );

  const partial = {
    companyId: ctx.companyId,
    scoreDate: ctx.scoreDate,
    payPeriod: ctx.payPeriod,
    readinessScore: score,
    readinessBand: band,
    blockerCount,
    warningCount,
    readinessChecks,
    leakageEvents,
    totalLeakageZar,
    forecast,
    exceptionCount: exceptionChecks.length,
    riskDashboard: ctx.riskDashboard,
  };

  return {
    ...partial,
    recommendations: buildPayrollRecommendations(partial),
    tablesAvailable: true,
  };
}

function isPayrollMissingTable(error: { message?: string; code?: string } | null): boolean {
  if (!error) return false;
  return isSupabaseMissingTableError(error) || PAYROLL_TABLES.some((t) => error.message?.includes(t));
}

export async function syncPayrollIntelligence(
  supabase: SupabaseClient,
  dashboard: PayrollIntelligenceDashboard
): Promise<{ ok: boolean; error: string | null; payPeriodId: string | null }> {
  const now = new Date().toISOString();
  let payPeriodId = dashboard.payPeriod.id;

  const { data: periodRow, error: periodError } = await supabase
    .from("payroll_pay_periods")
    .upsert(
      {
        company_id: dashboard.companyId,
        period_start: dashboard.payPeriod.periodStart,
        period_end: dashboard.payPeriod.periodEnd,
        label: dashboard.payPeriod.label,
        status: dashboard.payPeriod.status,
        updated_at: now,
      },
      { onConflict: "company_id,period_start,period_end" }
    )
    .select("id")
    .single();

  if (periodError && !isPayrollMissingTable(periodError)) {
    return { ok: false, error: periodError.message, payPeriodId: null };
  }
  if (periodRow?.id) payPeriodId = periodRow.id;

  const { error: scoreError } = await supabase.from("payroll_readiness_scores").upsert(
    {
      company_id: dashboard.companyId,
      pay_period_id: payPeriodId,
      score_date: dashboard.scoreDate,
      readiness_score: dashboard.readinessScore,
      readiness_band: dashboard.readinessBand,
      blocker_count: dashboard.blockerCount,
      warning_count: dashboard.warningCount,
      summary_json: {
        exceptionCount: dashboard.exceptionCount,
        totalLeakageZar: dashboard.totalLeakageZar,
        expectedPayroll: dashboard.forecast.expectedPayroll,
      },
      computed_at: now,
    },
    { onConflict: "company_id,score_date" }
  );
  if (scoreError && !isPayrollMissingTable(scoreError)) {
    return { ok: false, error: scoreError.message, payPeriodId };
  }

  await supabase
    .from("payroll_readiness_checks")
    .delete()
    .eq("company_id", dashboard.companyId)
    .eq("score_date", dashboard.scoreDate);

  if (dashboard.readinessChecks.length > 0) {
    const { error: checksError } = await supabase.from("payroll_readiness_checks").insert(
      dashboard.readinessChecks.map((c) => ({
        company_id: dashboard.companyId,
        pay_period_id: payPeriodId,
        score_date: dashboard.scoreDate,
        check_type: c.checkType,
        severity: c.severity,
        employee_id: c.employeeId,
        entity_ref: c.entityRef,
        message: c.message,
        status: c.status,
        metadata: c.metadata,
        recorded_at: now,
      }))
    );
    if (checksError && !isPayrollMissingTable(checksError)) {
      return { ok: false, error: checksError.message, payPeriodId };
    }
  }

  await supabase
    .from("payroll_leakage_events")
    .delete()
    .eq("company_id", dashboard.companyId)
    .eq("leakage_date", dashboard.scoreDate);

  if (dashboard.leakageEvents.length > 0) {
    const { error: leakError } = await supabase.from("payroll_leakage_events").insert(
      dashboard.leakageEvents.map((e) => ({
        company_id: dashboard.companyId,
        pay_period_id: payPeriodId,
        leakage_date: dashboard.scoreDate,
        leakage_type: e.leakageType,
        employee_id: e.employeeId,
        amount_zar: e.amountZar,
        severity: e.severity,
        message: e.message,
        status: e.status,
        metadata: e.metadata,
        recorded_at: now,
      }))
    );
    if (leakError && !isPayrollMissingTable(leakError)) {
      return { ok: false, error: leakError.message, payPeriodId };
    }
  }

  const { error: fcError } = await supabase.from("payroll_forecasts").upsert(
    {
      company_id: dashboard.companyId,
      pay_period_id: payPeriodId,
      forecast_date: dashboard.scoreDate,
      expected_payroll: dashboard.forecast.expectedPayroll,
      variance_pct: dashboard.forecast.variancePct,
      cost_drivers: dashboard.forecast.costDrivers,
      forecast_json: dashboard.forecast,
    },
    { onConflict: "company_id,forecast_date" }
  );
  if (fcError && !isPayrollMissingTable(fcError)) {
    return { ok: false, error: fcError.message, payPeriodId };
  }

  return { ok: true, error: null, payPeriodId };
}

export async function loadPayrollIntelligence(
  supabase: SupabaseClient,
  companyId: string,
  scoreDate = todayIsoDate()
): Promise<{ dashboard: PayrollIntelligenceDashboard | null; error: string | null }> {
  if (!companyId) return { dashboard: null, error: "No company selected." };

  const ctx = await fetchPayrollContext(supabase, companyId, scoreDate);
  const dashboard = buildPayrollIntelligenceDashboard(ctx);
  const sync = await syncPayrollIntelligence(supabase, dashboard);
  if (sync.error) return { dashboard, error: sync.error };
  if (sync.payPeriodId) {
    dashboard.payPeriod.id = sync.payPeriodId;
  }
  return { dashboard, error: null };
}

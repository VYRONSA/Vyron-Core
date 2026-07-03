/**
 * VYRON CORE Phase 4C — Workforce Cost Intelligence.
 * Uses Field Operations events + Workforce Journey time breakdowns.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { isSupabaseMissingTableError } from "@/lib/company-access";
import {
  fetchFieldOperationsSnapshot,
  type FieldJob,
  type FieldJobEvent,
  type FieldOperationsSnapshot,
} from "@/lib/field-operations";
import {
  buildWorkforceJourneyDashboard,
  formatDuration,
  haversineKm,
  type EmployeeJourneySummary,
  type FieldRoute,
} from "@/lib/field-travel-intelligence";

export const FIELD_COST_ALERT_TYPES = [
  "High Idle Cost",
  "Travel Cost Too High",
  "Labour Cost Exceeds Revenue",
  "Low Margin Job",
  "Overtime Not Linked To Job",
] as const;

export type FieldCostAlertType = (typeof FIELD_COST_ALERT_TYPES)[number];

export const FIELD_COST_THRESHOLDS = {
  highIdleCostZar: 450,
  highIdleCostPct: 22,
  highTravelCostZar: 650,
  highTravelCostPct: 32,
  lowMarginPct: 15,
  overtimeUnlinkedMinutes: 30,
} as const;

export const DEFAULT_FIELD_COST_RATE = {
  labourRatePerHour: 185,
  travelRatePerKm: 4.5,
  travelRatePerHour: 0,
  overtimeMultiplier: 1.5,
  standardHoursPerDay: 8,
  idleCostFactor: 1,
  currency: "ZAR",
} as const;

export type FieldCostRate = {
  id?: string;
  companyId: string;
  employeeId: string | null;
  effectiveFrom: string;
  labourRatePerHour: number;
  travelRatePerKm: number;
  travelRatePerHour: number;
  overtimeMultiplier: number;
  standardHoursPerDay: number;
  idleCostFactor: number;
  currency: string;
};

export type FieldJobCost = {
  jobId: string;
  employeeId: string | null;
  costDate: string;
  labourSeconds: number;
  travelSeconds: number;
  idleSeconds: number;
  overtimeSeconds: number;
  labourCost: number;
  travelCost: number;
  idleCost: number;
  overtimeCost: number;
  totalCost: number;
  billableValue: number;
  estimatedMargin: number;
  estimatedLabourSeconds: number;
  siteKey: string | null;
  jobRef: string;
  jobTitle: string;
};

export type FieldEmployeeDayCost = {
  employeeId: string;
  costDate: string;
  labourCost: number;
  travelCost: number;
  idleCost: number;
  overtimeCost: number;
  totalCost: number;
  jobsTouched: number;
  billableValue: number;
  leakageValue: number;
};

export type FieldCostAlert = {
  id: string;
  type: FieldCostAlertType;
  severity: "warning" | "critical";
  employeeId: string | null;
  jobId: string | null;
  message: string;
  recordedAt: string;
  amountZar?: number;
};

export type FieldSiteCostSummary = {
  siteKey: string;
  label: string;
  labourCost: number;
  travelCost: number;
  totalCost: number;
  billableValue: number;
  margin: number;
  jobCount: number;
};

export type WorkforceCostDashboard = {
  costDate: string;
  labourCost: number;
  travelCost: number;
  idleCost: number;
  overtimeCost: number;
  totalCost: number;
  costPerJob: number;
  estimatedLeakage: number;
  billableValue: number;
  fieldMargin: number;
  fieldMarginPct: number;
  jobCosts: FieldJobCost[];
  employeeDayCosts: FieldEmployeeDayCost[];
  siteCosts: FieldSiteCostSummary[];
  alerts: FieldCostAlert[];
  currency: string;
};

const COST_TABLES = [
  "field_cost_rates",
  "field_job_costs",
  "field_employee_day_costs",
  "field_leakage_events",
] as const;

function isCostMissingTableError(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  return COST_TABLES.some((table) => isSupabaseMissingTableError(error, table));
}

function secondsBetween(startIso: string, endIso: string): number {
  const start = Date.parse(startIso);
  const end = Date.parse(endIso);
  if (Number.isNaN(start) || Number.isNaN(end) || end <= start) return 0;
  return Math.round((end - start) / 1000);
}

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

function hoursFromSeconds(seconds: number): number {
  return seconds / 3600;
}

function defaultBillableForJob(job: FieldJob): number {
  if (job.notes && job.notes.includes("billable:")) {
    const match = job.notes.match(/billable:\s*([\d.]+)/i);
    if (match) return Number(match[1]) || 0;
  }
  const priority = (job.priority || "normal").toLowerCase();
  if (priority === "urgent") return 2500;
  if (priority === "high") return 1800;
  if (priority === "low") return 800;
  return 1200;
}

function defaultEstimatedLabourMinutes(job: FieldJob): number {
  const priority = (job.priority || "normal").toLowerCase();
  if (priority === "urgent") return 180;
  if (priority === "high") return 120;
  if (priority === "low") return 60;
  return 90;
}

export function resolveJobBillableValue(job: FieldJob & { billableValue?: number | null }): number {
  const explicit = (job as { billableValue?: number | null }).billableValue;
  if (explicit != null && explicit > 0) return explicit;
  return defaultBillableForJob(job);
}

export function resolveJobEstimatedLabourSeconds(
  job: FieldJob & { estimatedLabourMinutes?: number | null }
): number {
  const explicit = (job as { estimatedLabourMinutes?: number | null }).estimatedLabourMinutes;
  if (explicit != null && explicit > 0) return explicit * 60;
  return defaultEstimatedLabourMinutes(job) * 60;
}

export function resolveSiteKey(job: FieldJob): string {
  if (job.storeId) return `store:${job.storeId}`;
  if (job.customerAddress) return `addr:${job.customerAddress.trim().toLowerCase()}`;
  if (job.latitude != null && job.longitude != null) {
    return `gps:${job.latitude.toFixed(4)},${job.longitude.toFixed(4)}`;
  }
  return `job:${job.id}`;
}

export function resolveSiteLabel(job: FieldJob): string {
  if (job.customerName) return job.customerName;
  if (job.customerAddress) return job.customerAddress;
  if (job.storeId) return `Store ${job.storeId.slice(0, 8)}`;
  return job.title;
}

function computeJobTravelSeconds(events: FieldJobEvent[], jobId: string): number {
  let total = 0;
  for (const start of events.filter((e) => e.eventType === "Start Travel" && e.jobId === jobId)) {
    const end = events.find(
      (e) =>
        e.eventType === "Arrive Site" &&
        e.jobId === jobId &&
        Date.parse(e.recordedAt) > Date.parse(start.recordedAt)
    );
    if (end) total += secondsBetween(start.recordedAt, end.recordedAt);
  }
  return total;
}

function computeJobTravelKm(events: FieldJobEvent[], jobId: string): number {
  let total = 0;
  for (const start of events.filter((e) => e.eventType === "Start Travel" && e.jobId === jobId)) {
    const end = events.find(
      (e) =>
        e.eventType === "Arrive Site" &&
        e.jobId === jobId &&
        Date.parse(e.recordedAt) > Date.parse(start.recordedAt)
    );
    if (
      !end ||
      start.latitude == null ||
      start.longitude == null ||
      end.latitude == null ||
      end.longitude == null
    ) {
      continue;
    }
    total += haversineKm(start.latitude, start.longitude, end.latitude, end.longitude);
  }
  return total;
}

function computeJobWorkingSeconds(events: FieldJobEvent[], jobId: string): number {
  const sorted = [...events].sort((a, b) => Date.parse(a.recordedAt) - Date.parse(b.recordedAt));
  let total = 0;
  for (const event of sorted) {
    if (event.eventType !== "Start Job" || event.jobId !== jobId) continue;
    const complete = sorted.find(
      (e) =>
        e.eventType === "Complete Job" &&
        e.jobId === jobId &&
        Date.parse(e.recordedAt) > Date.parse(event.recordedAt)
    );
    if (!complete) continue;
    let block = secondsBetween(event.recordedAt, complete.recordedAt);
    const pauses = sorted.filter(
      (e) =>
        e.eventType === "Pause Job" &&
        e.jobId === jobId &&
        Date.parse(e.recordedAt) > Date.parse(event.recordedAt) &&
        Date.parse(e.recordedAt) < Date.parse(complete.recordedAt)
    );
    for (const pause of pauses) {
      const resume = sorted.find(
        (e) =>
          e.eventType === "Resume Job" &&
          e.jobId === jobId &&
          Date.parse(e.recordedAt) > Date.parse(pause.recordedAt)
      );
      if (resume) block -= secondsBetween(pause.recordedAt, resume.recordedAt);
    }
    total += Math.max(0, block);
  }
  return total;
}

function computeJobIdleSeconds(events: FieldJobEvent[], jobId: string): number {
  const sorted = [...events].sort((a, b) => Date.parse(a.recordedAt) - Date.parse(b.recordedAt));
  let total = 0;
  for (const pause of sorted.filter((e) => e.eventType === "Pause Job" && e.jobId === jobId)) {
    const resume = sorted.find(
      (e) =>
        e.eventType === "Resume Job" &&
        e.jobId === jobId &&
        Date.parse(e.recordedAt) > Date.parse(pause.recordedAt)
    );
    if (resume) total += secondsBetween(pause.recordedAt, resume.recordedAt);
  }
  return total;
}

function resolveRateForEmployee(
  rates: FieldCostRate[],
  employeeId: string
): FieldCostRate {
  const employeeRate = rates
    .filter((r) => r.employeeId === employeeId)
    .sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom))[0];
  if (employeeRate) return employeeRate;
  const companyRate = rates
    .filter((r) => !r.employeeId)
    .sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom))[0];
  if (companyRate) return companyRate;
  return {
    companyId: rates[0]?.companyId || "",
    employeeId: null,
    effectiveFrom: new Date().toISOString().slice(0, 10),
    ...DEFAULT_FIELD_COST_RATE,
  };
}

function computeOvertimeSeconds(
  route: FieldRoute,
  rate: Pick<FieldCostRate, "standardHoursPerDay">
): number {
  const standardSeconds = rate.standardHoursPerDay * 3600;
  const worked = route.workingSeconds + route.travelSeconds;
  return Math.max(0, worked - standardSeconds);
}

function costFromSeconds(seconds: number, hourlyRate: number): number {
  return roundMoney(hoursFromSeconds(seconds) * hourlyRate);
}

export function computeJobCost(input: {
  job: FieldJob & { billableValue?: number | null; estimatedLabourMinutes?: number | null };
  events: FieldJobEvent[];
  employeeId: string | null;
  costDate: string;
  rate: FieldCostRate;
  overtimeShareSeconds?: number;
}): FieldJobCost {
  const jobEvents = input.events.filter(
    (e) => e.recordedAt.slice(0, 10) === input.costDate
  );
  const labourSeconds = computeJobWorkingSeconds(jobEvents, input.job.id);
  const travelSeconds = computeJobTravelSeconds(jobEvents, input.job.id);
  const idleSeconds = computeJobIdleSeconds(jobEvents, input.job.id);
  const travelKm = computeJobTravelKm(jobEvents, input.job.id);
  const overtimeSeconds = input.overtimeShareSeconds ?? 0;

  const labourCost = costFromSeconds(labourSeconds, input.rate.labourRatePerHour);
  const travelCost = roundMoney(
    costFromSeconds(travelSeconds, input.rate.travelRatePerHour || input.rate.labourRatePerHour * 0.75) +
      travelKm * input.rate.travelRatePerKm
  );
  const idleCost = roundMoney(
    costFromSeconds(idleSeconds, input.rate.labourRatePerHour) * input.rate.idleCostFactor
  );
  const overtimeCost = roundMoney(
    costFromSeconds(overtimeSeconds, input.rate.labourRatePerHour) *
      (input.rate.overtimeMultiplier - 1)
  );
  const totalCost = roundMoney(labourCost + travelCost + idleCost + overtimeCost);
  const billableValue = resolveJobBillableValue(input.job);
  const estimatedMargin = roundMoney(billableValue - totalCost);

  return {
    jobId: input.job.id,
    employeeId: input.employeeId,
    costDate: input.costDate,
    labourSeconds,
    travelSeconds,
    idleSeconds,
    overtimeSeconds,
    labourCost,
    travelCost,
    idleCost,
    overtimeCost,
    totalCost,
    billableValue,
    estimatedMargin,
    estimatedLabourSeconds: resolveJobEstimatedLabourSeconds(input.job),
    siteKey: resolveSiteKey(input.job),
    jobRef: input.job.jobRef,
    jobTitle: input.job.title,
  };
}

export function computeEmployeeDayCost(input: {
  journey: EmployeeJourneySummary;
  jobCosts: FieldJobCost[];
  rate: FieldCostRate;
}): FieldEmployeeDayCost {
  const { route, employeeId, routeDate } = input.journey;
  const employeeJobs = input.jobCosts.filter((j) => j.employeeId === employeeId);

  const labourCost = roundMoney(
    employeeJobs.reduce((s, j) => s + j.labourCost, 0) ||
      costFromSeconds(route.workingSeconds, input.rate.labourRatePerHour)
  );
  const travelCost = roundMoney(
    employeeJobs.reduce((s, j) => s + j.travelCost, 0) ||
      costFromSeconds(route.travelSeconds, input.rate.travelRatePerHour || input.rate.labourRatePerHour * 0.75) +
        route.distanceKm * input.rate.travelRatePerKm
  );
  const idleCost = roundMoney(
    employeeJobs.reduce((s, j) => s + j.idleCost, 0) ||
      costFromSeconds(route.idleSeconds, input.rate.labourRatePerHour) * input.rate.idleCostFactor
  );
  const overtimeSeconds = computeOvertimeSeconds(route, input.rate);
  const overtimeCost = roundMoney(
    employeeJobs.reduce((s, j) => s + j.overtimeCost, 0) ||
      costFromSeconds(overtimeSeconds, input.rate.labourRatePerHour) *
        (input.rate.overtimeMultiplier - 1)
  );
  const totalCost = roundMoney(labourCost + travelCost + idleCost + overtimeCost);
  const billableValue = roundMoney(employeeJobs.reduce((s, j) => s + j.billableValue, 0));
  const leakageValue = roundMoney(
    Math.max(0, idleCost) +
      Math.max(0, overtimeCost * 0.5) +
      employeeJobs.reduce((s, j) => s + Math.max(0, j.totalCost - j.billableValue), 0)
  );

  return {
    employeeId,
    costDate: routeDate,
    labourCost,
    travelCost,
    idleCost,
    overtimeCost,
    totalCost,
    jobsTouched: employeeJobs.length || route.jobsCompleted,
    billableValue,
    leakageValue,
  };
}

export function detectCostAlerts(input: {
  dashboard: Omit<WorkforceCostDashboard, "alerts">;
  journeys: EmployeeJourneySummary[];
  events: FieldJobEvent[];
}): FieldCostAlert[] {
  const alerts: FieldCostAlert[] = [];
  const { dashboard, journeys, events } = input;

  if (
    dashboard.idleCost >= FIELD_COST_THRESHOLDS.highIdleCostZar ||
    (dashboard.totalCost > 0 &&
      (dashboard.idleCost / dashboard.totalCost) * 100 >= FIELD_COST_THRESHOLDS.highIdleCostPct)
  ) {
    alerts.push({
      id: `high-idle-${dashboard.costDate}`,
      type: "High Idle Cost",
      severity: "warning",
      employeeId: null,
      jobId: null,
      message: `Idle cost ${formatCurrency(dashboard.idleCost)} exceeds policy.`,
      recordedAt: new Date().toISOString(),
      amountZar: dashboard.idleCost,
    });
  }

  if (
    dashboard.travelCost >= FIELD_COST_THRESHOLDS.highTravelCostZar ||
    (dashboard.totalCost > 0 &&
      (dashboard.travelCost / dashboard.totalCost) * 100 >= FIELD_COST_THRESHOLDS.highTravelCostPct)
  ) {
    alerts.push({
      id: `high-travel-${dashboard.costDate}`,
      type: "Travel Cost Too High",
      severity: "warning",
      employeeId: null,
      jobId: null,
      message: `Travel cost ${formatCurrency(dashboard.travelCost)} is elevated.`,
      recordedAt: new Date().toISOString(),
      amountZar: dashboard.travelCost,
    });
  }

  for (const jobCost of dashboard.jobCosts) {
    if (jobCost.totalCost > jobCost.billableValue && jobCost.billableValue > 0) {
      alerts.push({
        id: `cost-exceeds-value-${jobCost.jobId}`,
        type: "Labour Cost Exceeds Revenue",
        severity: "critical",
        employeeId: jobCost.employeeId,
        jobId: jobCost.jobId,
        message: `${jobCost.jobRef}: cost ${formatCurrency(jobCost.totalCost)} exceeds billable ${formatCurrency(jobCost.billableValue)}.`,
        recordedAt: new Date().toISOString(),
        amountZar: roundMoney(jobCost.totalCost - jobCost.billableValue),
      });
    }

    const marginPct =
      jobCost.billableValue > 0
        ? (jobCost.estimatedMargin / jobCost.billableValue) * 100
        : 0;
    if (jobCost.billableValue > 0 && marginPct < FIELD_COST_THRESHOLDS.lowMarginPct) {
      alerts.push({
        id: `low-margin-${jobCost.jobId}`,
        type: "Low Margin Job",
        severity: "warning",
        employeeId: jobCost.employeeId,
        jobId: jobCost.jobId,
        message: `${jobCost.jobRef}: margin ${marginPct.toFixed(1)}% below target.`,
        recordedAt: new Date().toISOString(),
      });
    }
  }

  for (const journey of journeys) {
    const route = journey.route;
    const overtimeSeconds = computeOvertimeSeconds(route, DEFAULT_FIELD_COST_RATE);
    const dayEvents = events.filter(
      (e) =>
        e.employeeId === journey.employeeId &&
        e.recordedAt.slice(0, 10) === journey.routeDate
    );
    const jobLinked = dayEvents.some((e) => e.jobId && e.eventType !== "Start Day" && e.eventType !== "End Day");
    if (
      overtimeSeconds >= FIELD_COST_THRESHOLDS.overtimeUnlinkedMinutes * 60 &&
      !jobLinked
    ) {
      alerts.push({
        id: `ot-unlinked-${journey.employeeId}-${journey.routeDate}`,
        type: "Overtime Not Linked To Job",
        severity: "critical",
        employeeId: journey.employeeId,
        jobId: null,
        message: `Overtime ${formatDuration(overtimeSeconds)} not linked to field jobs.`,
        recordedAt: route.endedAt || route.startedAt || new Date().toISOString(),
      });
    }
  }

  return alerts;
}

export function buildWorkforceCostDashboard(input: {
  snapshot: FieldOperationsSnapshot;
  costDate: string;
  companyId: string;
  rates?: FieldCostRate[];
  jobsWithBilling?: Array<FieldJob & { billableValue?: number | null; estimatedLabourMinutes?: number | null }>;
}): WorkforceCostDashboard {
  const journeyDashboard = buildWorkforceJourneyDashboard(
    input.snapshot,
    input.costDate,
    input.companyId
  );
  const rates = input.rates?.length
    ? input.rates
    : [
        {
          companyId: input.companyId,
          employeeId: null,
          effectiveFrom: input.costDate,
          ...DEFAULT_FIELD_COST_RATE,
        },
      ];

  const jobs = (input.jobsWithBilling || input.snapshot.jobs) as Array<
    FieldJob & { billableValue?: number | null; estimatedLabourMinutes?: number | null }
  >;
  const dayEvents = input.snapshot.events.filter(
    (e) => e.recordedAt.slice(0, 10) === input.costDate
  );

  const jobIdsForDay = new Set(
    dayEvents.map((e) => e.jobId).filter((id): id is string => Boolean(id))
  );
  const jobsForDay = jobs.filter((j) => jobIdsForDay.has(j.id));

  const jobCosts: FieldJobCost[] = [];
  for (const job of jobsForDay) {
    const assignment = input.snapshot.assignments.find(
      (a) => a.jobId === job.id && a.status === "assigned"
    );
    const employeeId =
      assignment?.employeeId ||
      dayEvents.find((e) => e.jobId === job.id)?.employeeId ||
      null;
    if (!employeeId) continue;
    const rate = resolveRateForEmployee(rates, employeeId);
    const journey = journeyDashboard.journeys.find((j) => j.employeeId === employeeId);
    const otShare =
      journey && journeyDashboard.journeys.length > 0
        ? Math.round(
            (computeOvertimeSeconds(journey.route, rate) / Math.max(1, journey.route.jobsCompleted || 1))
          )
        : 0;
    jobCosts.push(
      computeJobCost({
        job,
        events: input.snapshot.events,
        employeeId,
        costDate: input.costDate,
        rate,
        overtimeShareSeconds: otShare,
      })
    );
  }

  const employeeDayCosts: FieldEmployeeDayCost[] = journeyDashboard.journeys.map((journey) => {
    const rate = resolveRateForEmployee(rates, journey.employeeId);
    return computeEmployeeDayCost({
      journey,
      jobCosts,
      rate,
    });
  });

  const labourCost = roundMoney(employeeDayCosts.reduce((s, e) => s + e.labourCost, 0));
  const travelCost = roundMoney(employeeDayCosts.reduce((s, e) => s + e.travelCost, 0));
  const idleCost = roundMoney(employeeDayCosts.reduce((s, e) => s + e.idleCost, 0));
  const overtimeCost = roundMoney(employeeDayCosts.reduce((s, e) => s + e.overtimeCost, 0));
  const totalCost = roundMoney(labourCost + travelCost + idleCost + overtimeCost);
  const billableValue = roundMoney(jobCosts.reduce((s, j) => s + j.billableValue, 0));
  const fieldMargin = roundMoney(billableValue - totalCost);
  const fieldMarginPct =
    billableValue > 0 ? roundMoney((fieldMargin / billableValue) * 100) : 0;
  const estimatedLeakage = roundMoney(
    employeeDayCosts.reduce((s, e) => s + e.leakageValue, 0)
  );
  const costPerJob =
    jobCosts.length > 0 ? roundMoney(totalCost / jobCosts.length) : 0;

  const siteMap = new Map<string, FieldSiteCostSummary>();
  for (const jobCost of jobCosts) {
    const job = jobs.find((j) => j.id === jobCost.jobId);
    const key = jobCost.siteKey || jobCost.jobId;
    const label = job ? resolveSiteLabel(job) : jobCost.jobTitle;
    const existing = siteMap.get(key) || {
      siteKey: key,
      label,
      labourCost: 0,
      travelCost: 0,
      totalCost: 0,
      billableValue: 0,
      margin: 0,
      jobCount: 0,
    };
    existing.labourCost = roundMoney(existing.labourCost + jobCost.labourCost);
    existing.travelCost = roundMoney(existing.travelCost + jobCost.travelCost);
    existing.totalCost = roundMoney(existing.totalCost + jobCost.totalCost);
    existing.billableValue = roundMoney(existing.billableValue + jobCost.billableValue);
    existing.margin = roundMoney(existing.billableValue - existing.totalCost);
    existing.jobCount += 1;
    siteMap.set(key, existing);
  }

  const partial: Omit<WorkforceCostDashboard, "alerts"> = {
    costDate: input.costDate,
    labourCost,
    travelCost,
    idleCost,
    overtimeCost,
    totalCost,
    costPerJob,
    estimatedLeakage,
    billableValue,
    fieldMargin,
    fieldMarginPct,
    jobCosts,
    employeeDayCosts,
    siteCosts: [...siteMap.values()],
    currency: rates[0]?.currency || "ZAR",
  };

  const alerts = detectCostAlerts({
    dashboard: partial,
    journeys: journeyDashboard.journeys,
    events: input.snapshot.events,
  });

  return { ...partial, alerts };
}

export function formatCurrency(amount: number, currency = "ZAR"): string {
  try {
    return new Intl.NumberFormat("en-ZA", {
      style: "currency",
      currency,
      maximumFractionDigits: 0,
    }).format(amount);
  } catch {
    return `R ${Math.round(amount)}`;
  }
}

export function costAlertSeverityClass(severity: FieldCostAlert["severity"]): string {
  return severity === "critical"
    ? "bg-rose-100 text-rose-900 border-rose-200"
    : "bg-amber-100 text-amber-950 border-amber-200";
}

function rowToRate(row: Record<string, unknown>): FieldCostRate {
  return {
    id: String(row.id),
    companyId: String(row.company_id),
    employeeId: row.employee_id ? String(row.employee_id) : null,
    effectiveFrom: String(row.effective_from).slice(0, 10),
    labourRatePerHour: Number(row.labour_rate_per_hour || DEFAULT_FIELD_COST_RATE.labourRatePerHour),
    travelRatePerKm: Number(row.travel_rate_per_km || DEFAULT_FIELD_COST_RATE.travelRatePerKm),
    travelRatePerHour: Number(row.travel_rate_per_hour || 0),
    overtimeMultiplier: Number(row.overtime_multiplier || DEFAULT_FIELD_COST_RATE.overtimeMultiplier),
    standardHoursPerDay: Number(row.standard_hours_per_day || DEFAULT_FIELD_COST_RATE.standardHoursPerDay),
    idleCostFactor: Number(row.idle_cost_factor || 1),
    currency: String(row.currency || "ZAR"),
  };
}

export async function fetchFieldCostRates(
  supabase: SupabaseClient,
  companyId: string
): Promise<{ rates: FieldCostRate[]; tablesAvailable: boolean }> {
  if (!companyId) return { rates: [], tablesAvailable: false };
  const { data, error } = await supabase
    .from("field_cost_rates")
    .select("*")
    .eq("company_id", companyId)
    .order("effective_from", { ascending: false });

  if (error) {
    if (isCostMissingTableError(error)) return { rates: [], tablesAvailable: false };
    return { rates: [], tablesAvailable: true };
  }

  const rates = (data || []).map((row) => rowToRate(row as Record<string, unknown>));
  if (!rates.length) {
    return {
      rates: [
        {
          companyId,
          employeeId: null,
          effectiveFrom: new Date().toISOString().slice(0, 10),
          ...DEFAULT_FIELD_COST_RATE,
        },
      ],
      tablesAvailable: true,
    };
  }
  return { rates, tablesAvailable: true };
}

export async function ensureDefaultFieldCostRate(
  supabase: SupabaseClient,
  companyId: string
): Promise<void> {
  const { rates, tablesAvailable } = await fetchFieldCostRates(supabase, companyId);
  if (!tablesAvailable || rates.some((r) => !r.employeeId)) return;

  await supabase.from("field_cost_rates").insert({
    company_id: companyId,
    employee_id: null,
    effective_from: new Date().toISOString().slice(0, 10),
    labour_rate_per_hour: DEFAULT_FIELD_COST_RATE.labourRatePerHour,
    travel_rate_per_km: DEFAULT_FIELD_COST_RATE.travelRatePerKm,
    travel_rate_per_hour: DEFAULT_FIELD_COST_RATE.travelRatePerHour,
    overtime_multiplier: DEFAULT_FIELD_COST_RATE.overtimeMultiplier,
    standard_hours_per_day: DEFAULT_FIELD_COST_RATE.standardHoursPerDay,
    idle_cost_factor: DEFAULT_FIELD_COST_RATE.idleCostFactor,
    currency: DEFAULT_FIELD_COST_RATE.currency,
    updated_at: new Date().toISOString(),
  });
}

async function fetchJobsWithBilling(
  supabase: SupabaseClient,
  companyId: string
): Promise<Array<FieldJob & { billableValue?: number | null; estimatedLabourMinutes?: number | null }>> {
  const { data, error } = await supabase
    .from("field_jobs")
    .select(
      "id, company_id, job_ref, title, description, status, site_type, store_id, customer_name, customer_address, asset_id, vehicle_id, latitude, longitude, scheduled_start, scheduled_end, priority, notes, created_at, updated_at, billable_value, estimated_labour_minutes"
    )
    .eq("company_id", companyId);

  if (error || !data) return [];

  return data.map((row) => {
    const base = row as Record<string, unknown>;
    return {
      id: String(base.id),
      companyId: String(base.company_id),
      jobRef: String(base.job_ref),
      title: String(base.title),
      description: base.description ? String(base.description) : null,
      status: base.status as FieldJob["status"],
      siteType: base.site_type as FieldJob["siteType"],
      storeId: base.store_id ? String(base.store_id) : null,
      customerName: base.customer_name ? String(base.customer_name) : null,
      customerAddress: base.customer_address ? String(base.customer_address) : null,
      assetId: base.asset_id ? String(base.asset_id) : null,
      vehicleId: base.vehicle_id ? String(base.vehicle_id) : null,
      trailerId: base.trailer_id ? String(base.trailer_id) : null,
      latitude: base.latitude != null ? Number(base.latitude) : null,
      longitude: base.longitude != null ? Number(base.longitude) : null,
      scheduledStart: base.scheduled_start ? String(base.scheduled_start) : null,
      scheduledEnd: base.scheduled_end ? String(base.scheduled_end) : null,
      priority: String(base.priority || "normal"),
      notes: base.notes ? String(base.notes) : null,
      createdAt: String(base.created_at),
      updatedAt: String(base.updated_at),
      billableValue: base.billable_value != null ? Number(base.billable_value) : null,
      estimatedLabourMinutes:
        base.estimated_labour_minutes != null ? Number(base.estimated_labour_minutes) : null,
    };
  });
}

export async function syncFieldCostData(
  supabase: SupabaseClient,
  dashboard: WorkforceCostDashboard,
  companyId: string
): Promise<{ ok: boolean; error: string | null }> {
  const now = new Date().toISOString();

  for (const dayCost of dashboard.employeeDayCosts) {
    const { error } = await supabase.from("field_employee_day_costs").upsert(
      {
        company_id: companyId,
        employee_id: dayCost.employeeId,
        cost_date: dashboard.costDate,
        labour_cost: dayCost.labourCost,
        travel_cost: dayCost.travelCost,
        idle_cost: dayCost.idleCost,
        overtime_cost: dayCost.overtimeCost,
        total_cost: dayCost.totalCost,
        jobs_touched: dayCost.jobsTouched,
        billable_value: dayCost.billableValue,
        leakage_value: dayCost.leakageValue,
        updated_at: now,
      },
      { onConflict: "company_id,employee_id,cost_date" }
    );
    if (error && !isCostMissingTableError(error)) return { ok: false, error: error.message };
  }

  for (const jobCost of dashboard.jobCosts) {
    const { error } = await supabase.from("field_job_costs").upsert(
      {
        company_id: companyId,
        job_id: jobCost.jobId,
        employee_id: jobCost.employeeId,
        cost_date: dashboard.costDate,
        labour_seconds: jobCost.labourSeconds,
        travel_seconds: jobCost.travelSeconds,
        idle_seconds: jobCost.idleSeconds,
        overtime_seconds: jobCost.overtimeSeconds,
        labour_cost: jobCost.labourCost,
        travel_cost: jobCost.travelCost,
        idle_cost: jobCost.idleCost,
        overtime_cost: jobCost.overtimeCost,
        total_cost: jobCost.totalCost,
        billable_value: jobCost.billableValue,
        estimated_margin: jobCost.estimatedMargin,
        estimated_labour_seconds: jobCost.estimatedLabourSeconds,
        site_key: jobCost.siteKey,
        updated_at: now,
      },
      { onConflict: "company_id,job_id,cost_date,employee_id" }
    );
    if (error && !isCostMissingTableError(error)) return { ok: false, error: error.message };
  }

  await supabase
    .from("field_leakage_events")
    .delete()
    .eq("company_id", companyId)
    .eq("cost_date", dashboard.costDate);

  if (dashboard.alerts.length) {
    const leakageRows = dashboard.alerts.map((alert) => ({
      company_id: companyId,
      employee_id: alert.employeeId,
      job_id: alert.jobId,
      leakage_type: mapAlertToLeakageType(alert.type),
      leakage_value: alert.amountZar ?? dashboard.estimatedLeakage,
      severity: alert.severity,
      message: alert.message,
      recorded_at: alert.recordedAt,
      cost_date: dashboard.costDate,
    }));
    const { error } = await supabase.from("field_leakage_events").insert(leakageRows);
    if (error && !isCostMissingTableError(error)) return { ok: false, error: error.message };
  }

  return { ok: true, error: null };
}

function mapAlertToLeakageType(type: FieldCostAlertType): string {
  switch (type) {
    case "High Idle Cost":
      return "idle_leakage";
    case "Travel Cost Too High":
      return "travel_leakage";
    case "Overtime Not Linked To Job":
      return "overtime_unlinked";
    case "Labour Cost Exceeds Revenue":
      return "cost_exceeds_value";
    case "Low Margin Job":
      return "low_margin";
    default:
      return "idle_leakage";
  }
}

export async function loadWorkforceCostDashboard(
  supabase: SupabaseClient,
  companyId: string,
  costDate: string
): Promise<{
  dashboard: WorkforceCostDashboard | null;
  tablesAvailable: boolean;
  error: string | null;
}> {
  const snapshot = await fetchFieldOperationsSnapshot(supabase, companyId);
  if (!snapshot.tablesAvailable) {
    return { dashboard: null, tablesAvailable: false, error: snapshot.error };
  }

  const { rates, tablesAvailable: costTables } = await fetchFieldCostRates(supabase, companyId);
  if (costTables) await ensureDefaultFieldCostRate(supabase, companyId);

  const jobsWithBilling = await fetchJobsWithBilling(supabase, companyId);
  const dashboard = buildWorkforceCostDashboard({
    snapshot,
    costDate,
    companyId,
    rates,
    jobsWithBilling: jobsWithBilling.length ? jobsWithBilling : undefined,
  });

  const sync = await syncFieldCostData(supabase, dashboard, companyId);
  return {
    dashboard,
    tablesAvailable: snapshot.tablesAvailable,
    error: sync.error || snapshot.error,
  };
}

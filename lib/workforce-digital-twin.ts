/**
 * VYRON CORE Phase 6 — Workforce Digital Twin foundation.
 * Structured operational model from existing clocking, field, cost, risk & roster data.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { isSupabaseMissingTableError } from "@/lib/company-access";
import { buildWorkforceCostDashboard } from "@/lib/field-cost-intelligence";
import { fetchFieldOperationsSnapshot } from "@/lib/field-operations";
import { buildWorkforceJourneyDashboard } from "@/lib/field-travel-intelligence";
import { fetchCopilotContext } from "@/lib/workforce-ai-copilot";
import { loadWorkforceRiskDashboard, scoreToRiskBand } from "@/lib/workforce-risk-intelligence";

const TWIN_TABLES = [
  "workforce_digital_twin_snapshots",
  "workforce_health_scores",
  "workforce_forecasts",
  "workforce_simulations",
  "workforce_twin_insights",
] as const;

export type TwinRiskBand = "green" | "amber" | "red";

export type TwinConfidence = "low" | "medium" | "high";

export type WorkforceTwinExecutive = {
  workforceHealthPct: number | null;
  labourCostToday: number | null;
  productivityPct: number | null;
  riskLevel: TwinRiskBand | null;
  predictedLeakage: number | null;
  activeEmployees: number;
  activeFieldJobs: number;
  highRiskEmployees: number;
  dataGaps: string[];
};

export type WorkforceTwinHeatMapRow = {
  storeId: string;
  storeName: string;
  region: string;
  employeeCount: number;
  labourCost: number | null;
  productivityPct: number | null;
  attendanceRisk: number | null;
  overtimeRisk: number | null;
  fieldRisk: number | null;
  overallHealth: number | null;
};

export type WorkforceTwinForecast = {
  staffingRisk7d: number | null;
  predictedShortages: string[];
  predictedOverstaffing: string[];
  payrollPressure: number | null;
  fieldOpsPressure: number | null;
  needsMoreData: boolean;
};

export type WorkforceTwinSimulationInput = {
  reduceOvertimePct?: number;
  addEmployees?: number;
  removeEmployees?: number;
  moveEmployeesCount?: number;
  fromStoreId?: string;
  toStoreId?: string;
};

export type WorkforceTwinSimulationResult = {
  scenarioType: string;
  estimatedSaving: number | null;
  expectedRiskChange: number | null;
  staffingImpact: string;
  confidenceLevel: TwinConfidence;
  needsMoreData: boolean;
};

export type WorkforceTwinInsight = {
  id: string;
  category: string;
  severity: "info" | "warning" | "critical";
  title: string;
  detail: string;
  sourceModules: string[];
};

export type WorkforceDigitalTwinDashboard = {
  snapshotDate: string;
  companyId: string;
  executive: WorkforceTwinExecutive;
  heatMap: WorkforceTwinHeatMapRow[];
  forecast: WorkforceTwinForecast;
  insights: WorkforceTwinInsight[];
  tablesAvailable: boolean;
};

function isTwinMissingTable(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  return TWIN_TABLES.some((t) => isSupabaseMissingTableError(error, t));
}

function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function daysAheadIso(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function clampPct(n: number): number {
  return Math.max(0, Math.min(100, Math.round(n)));
}

function avg(nums: number[]): number | null {
  if (!nums.length) return null;
  return nums.reduce((s, n) => s + n, 0) / nums.length;
}

export function buildWorkforceTwinInsights(input: {
  ctx: Awaited<ReturnType<typeof fetchCopilotContext>>;
  heatMap: WorkforceTwinHeatMapRow[];
  executive: WorkforceTwinExecutive;
}): WorkforceTwinInsight[] {
  const insights: WorkforceTwinInsight[] = [];
  const { ctx, heatMap, executive } = input;
  const risk = ctx.riskDashboard;
  const cost = ctx.costDashboard;
  const journey = ctx.journeyDashboard;

  const lateCount = ctx.payrollClockChecks.filter(
    (c) => c.shift_date === ctx.scoreDate && Number(c.late_minutes || 0) > 0
  ).length;
  const attendanceVolume = ctx.payrollClockChecks.filter((c) => c.shift_date === ctx.scoreDate).length;

  if (cost && attendanceVolume > 0 && cost.labourCost > 0) {
    const costPerCheck = cost.labourCost / Math.max(1, attendanceVolume);
    if (costPerCheck > 500 && lateCount < attendanceVolume * 0.2) {
      insights.push({
        id: "insight-labour-attendance",
        category: "Labour Cost",
        severity: "warning",
        title: "Labour cost rising faster than attendance volume",
        detail: `Labour cost today is R${Math.round(cost.labourCost)} across ${attendanceVolume} clock checks with only ${lateCount} late flags — review roster efficiency.`,
        sourceModules: ["Cost Intelligence", "Clocking"],
      });
    }
  }

  for (const row of heatMap) {
    if (
      row.overtimeRisk != null &&
      row.productivityPct != null &&
      row.overtimeRisk >= 50 &&
      row.productivityPct < 60
    ) {
      insights.push({
        id: `insight-store-ot-${row.storeId}`,
        category: "Store Performance",
        severity: "warning",
        title: `${row.storeName} has high overtime but low productivity`,
        detail: `Overtime risk ${row.overtimeRisk}/100 with productivity ${row.productivityPct}% — investigate scheduling and task coverage.`,
        sourceModules: ["Risk Intelligence", "Travel Intelligence", "Cost Intelligence"],
      });
    }
  }

  if (journey && journey.travelSeconds > journey.workingSeconds && journey.journeys.length > 0) {
    insights.push({
      id: "insight-field-travel",
      category: "Field Operations",
      severity: "warning",
      title: "Field technicians spend excessive time travelling",
      detail: `Aggregate travel ${Math.round(journey.travelSeconds / 60)} min vs working ${Math.round(journey.workingSeconds / 60)} min today — re-sequence jobs where possible.`,
      sourceModules: ["Travel Intelligence", "Field Operations"],
    });
  }

  if (cost && cost.estimatedLeakage >= 200) {
    insights.push({
      id: "insight-leakage-week",
      category: "Payroll Leakage",
      severity: executive.predictedLeakage && executive.predictedLeakage >= 500 ? "critical" : "warning",
      title: "Payroll leakage risk increased this week",
      detail: `Estimated leakage R${Math.round(cost.estimatedLeakage)} on ${ctx.scoreDate}. Review payroll readiness exceptions before export.`,
      sourceModules: ["Cost Intelligence", "Payroll Readiness", "Risk Intelligence"],
    });
  }

  if (risk && risk.highRiskEmployeeCount >= 3) {
    insights.push({
      id: "insight-high-risk",
      category: "Workforce Risk",
      severity: "critical",
      title: `${risk.highRiskEmployeeCount} employees in high risk band`,
      detail: `Workforce risk index ${risk.workforceRiskIndex}/100. Prioritise manager follow-up on attendance and field signals.`,
      sourceModules: ["Risk Intelligence"],
    });
  }

  const onLeave = ctx.leaveRequests.filter((l) => {
    const s = (l.status || "").toLowerCase();
    return ["approved", "pending"].includes(s) && l.start_date && l.start_date <= ctx.scoreDate && (l.end_date || l.start_date) >= ctx.scoreDate;
  });
  if (onLeave.length >= Math.max(3, ctx.employees.length * 0.15)) {
    insights.push({
      id: "insight-leave-pressure",
      category: "Leave",
      severity: "info",
      title: "Elevated leave coverage pressure today",
      detail: `${onLeave.length} leave records cover ${ctx.scoreDate}. Review roster gaps at understaffed sites.`,
      sourceModules: ["Leave", "Rosters"],
    });
  }

  if (!insights.length) {
    insights.push({
      id: "insight-stable",
      category: "Overview",
      severity: "info",
      title: "Workforce digital twin within normal range",
      detail: "No critical structured signals from clocking, field, cost, or risk modules for this snapshot.",
      sourceModules: ["Digital Twin"],
    });
  }

  return insights;
}

export function buildWorkforceDigitalTwinDashboard(
  ctx: Awaited<ReturnType<typeof fetchCopilotContext>>,
  rosterShifts: { store_id: string | null; shift_date: string; employee_id: string }[]
): WorkforceDigitalTwinDashboard {
  const dataGaps: string[] = [];
  const risk = ctx.riskDashboard;
  const cost = ctx.costDashboard;
  const journey = ctx.journeyDashboard;
  const field = ctx.fieldSnapshot;

  if (!cost && field && !field.tablesAvailable) {
    dataGaps.push("Field cost data unavailable — run sql/018-field-cost-intelligence.sql");
  }
  if (!journey && field && !field.tablesAvailable) {
    dataGaps.push("Travel journey data unavailable — run sql/017-field-travel-intelligence.sql");
  }
  if (!risk) {
    dataGaps.push("Risk intelligence unavailable — run sql/019-workforce-risk-intelligence.sql");
  }
  if (!rosterShifts.length) {
    dataGaps.push("Roster shifts — needs more data for 7-day forecast");
  }

  const riskIndex = risk?.workforceRiskIndex ?? null;
  const workforceHealthPct =
    riskIndex != null ? clampPct(100 - riskIndex) : null;

  const productivityPct =
    journey && journey.journeys.length > 0
      ? clampPct(
          journey.journeys.reduce((s, j) => s + j.route.productivityPct, 0) /
            journey.journeys.length
        )
      : null;

  const labourCostToday = cost ? cost.totalCost : null;
  const predictedLeakage = cost ? cost.estimatedLeakage : null;
  const activeFieldJobs =
    field?.jobs.filter((j) => ["Dispatched", "Travelling", "On Site", "Pending"].includes(j.status))
      .length ?? 0;

  const executive: WorkforceTwinExecutive = {
    workforceHealthPct,
    labourCostToday,
    productivityPct,
    riskLevel: riskIndex != null ? scoreToRiskBand(riskIndex) : null,
    predictedLeakage,
    activeEmployees: ctx.employees.length,
    activeFieldJobs,
    highRiskEmployees: risk?.highRiskEmployeeCount ?? 0,
    dataGaps,
  };

  const heatMap: WorkforceTwinHeatMapRow[] = ctx.stores.map((store) => {
    const team = ctx.employees.filter((e) => e.default_store_id === store.id);
    const storeRisk = risk?.storeScores.find((s) => s.entityId === store.id);
    const labourByStore = cost
      ? cost.employeeDayCosts
          .filter((d) => {
            const emp = ctx.employees.find((e) => e.id === d.employeeId);
            return emp?.default_store_id === store.id;
          })
          .reduce((s, d) => s + d.totalCost, 0)
      : null;
    const teamProductivity = journey
      ? journey.journeys
          .filter((j) => team.some((e) => e.id === j.employeeId))
          .map((j) => j.route.productivityPct)
      : [];

    const attendanceRisk = storeRisk?.categories["Attendance Risk"] ?? null;
    const overtimeRisk = storeRisk?.categories["Overtime Risk"] ?? null;
    const fieldRisk = storeRisk?.categories["Field Operations Risk"] ?? null;
    const overallHealth =
      storeRisk != null ? clampPct(100 - storeRisk.overallScore) : null;

    return {
      storeId: store.id,
      storeName: store.name,
      region: "Default",
      employeeCount: team.length,
      labourCost: labourByStore != null && labourByStore > 0 ? labourByStore : null,
      productivityPct: avg(teamProductivity) != null ? clampPct(avg(teamProductivity)!) : null,
      attendanceRisk,
      overtimeRisk,
      fieldRisk,
      overallHealth,
    };
  });

  const weekEnd = daysAheadIso(7);
  const upcomingShifts = rosterShifts.filter(
    (s) => s.shift_date >= ctx.scoreDate && s.shift_date <= weekEnd
  );
  const shiftsByStore = new Map<string, number>();
  for (const s of upcomingShifts) {
    if (!s.store_id) continue;
    shiftsByStore.set(s.store_id, (shiftsByStore.get(s.store_id) || 0) + 1);
  }

  const predictedShortages: string[] = [];
  const predictedOverstaffing: string[] = [];
  for (const store of ctx.stores) {
    const team = ctx.employees.filter((e) => e.default_store_id === store.id).length;
    const shifts = shiftsByStore.get(store.id) || 0;
    const expected = team * 5;
    if (team > 0 && shifts < team * 2) {
      predictedShortages.push(`${store.name}: ${shifts} shifts vs ${team} employees (7d)`);
    }
    if (shifts > expected && team > 0) {
      predictedOverstaffing.push(`${store.name}: ${shifts} shifts may exceed coverage need`);
    }
  }

  const otMinutes = ctx.payrollClockChecks
    .filter((c) => c.shift_date >= ctx.scoreDate)
    .reduce((s, c) => s + Number(c.overtime_minutes || 0), 0);
  const payrollPressure =
    otMinutes > 0 ? clampPct(Math.min(100, otMinutes / 30)) : rosterShifts.length ? 20 : null;
  const fieldOpsPressure = journey
    ? clampPct(Math.min(100, (journey.alerts.length * 15) + journey.idleSeconds / 600))
    : null;
  const staffingRisk7d =
    upcomingShifts.length && ctx.employees.length
      ? clampPct(
          (predictedShortages.length / Math.max(1, ctx.stores.length)) * 60 +
            (predictedOverstaffing.length > 0 ? 15 : 0)
        )
      : null;

  const forecast: WorkforceTwinForecast = {
    staffingRisk7d,
    predictedShortages,
    predictedOverstaffing,
    payrollPressure,
    fieldOpsPressure,
    needsMoreData: !rosterShifts.length || !ctx.employees.length,
  };

  const insights = buildWorkforceTwinInsights({ ctx, heatMap, executive });

  return {
    snapshotDate: ctx.scoreDate,
    companyId: ctx.companyId,
    executive,
    heatMap,
    forecast,
    insights,
    tablesAvailable: true,
  };
}

export function runWorkforceTwinSimulation(
  dashboard: WorkforceDigitalTwinDashboard,
  input: WorkforceTwinSimulationInput
): WorkforceTwinSimulationResult {
  const cost = dashboard.executive.labourCostToday;
  const riskIndex = dashboard.executive.workforceHealthPct != null
    ? 100 - dashboard.executive.workforceHealthPct
    : null;
  const hasCost = cost != null && cost > 0;
  const confidence: TwinConfidence = hasCost && dashboard.heatMap.length ? "medium" : "low";

  if (input.reduceOvertimePct && input.reduceOvertimePct > 0) {
    const otShare = dashboard.executive.predictedLeakage
      ? dashboard.executive.predictedLeakage * 0.4
      : hasCost
        ? cost! * 0.12
        : null;
    const saving = otShare != null ? Math.round(otShare * (input.reduceOvertimePct / 100)) : null;
    return {
      scenarioType: "reduce_overtime",
      estimatedSaving: saving,
      expectedRiskChange: input.reduceOvertimePct > 0 ? -Math.round(input.reduceOvertimePct / 5) : null,
      staffingImpact: `Overtime reduced by ${input.reduceOvertimePct}% — no automatic roster changes.`,
      confidenceLevel: saving != null ? confidence : "low",
      needsMoreData: saving == null,
    };
  }

  if (input.addEmployees && input.addEmployees > 0) {
    return {
      scenarioType: "add_employees",
      estimatedSaving: null,
      expectedRiskChange: -Math.min(15, input.addEmployees * 3),
      staffingImpact: `+${input.addEmployees} FTE would ease coverage at ${dashboard.heatMap.filter((h) => (h.overallHealth ?? 100) < 60).length || "understaffed"} weak sites (model only).`,
      confidenceLevel: dashboard.forecast.needsMoreData ? "low" : "medium",
      needsMoreData: dashboard.forecast.needsMoreData,
    };
  }

  if (input.removeEmployees && input.removeEmployees > 0) {
    return {
      scenarioType: "remove_employees",
      estimatedSaving: hasCost
        ? Math.round((cost! / Math.max(1, dashboard.executive.activeEmployees)) * input.removeEmployees)
        : null,
      expectedRiskChange: input.removeEmployees * 8,
      staffingImpact: `−${input.removeEmployees} FTE increases shortage risk — simulation only, no HR action.`,
      confidenceLevel: hasCost ? "medium" : "low",
      needsMoreData: !hasCost,
    };
  }

  if (input.moveEmployeesCount && input.fromStoreId && input.toStoreId) {
    const from = dashboard.heatMap.find((h) => h.storeId === input.fromStoreId);
    const to = dashboard.heatMap.find((h) => h.storeId === input.toStoreId);
    return {
      scenarioType: "move_employees",
      estimatedSaving: null,
      expectedRiskChange: from && to && (from.overallHealth ?? 0) > (to.overallHealth ?? 0) ? -5 : 0,
      staffingImpact: `Move ${input.moveEmployeesCount} from ${from?.storeName || "site A"} to ${to?.storeName || "site B"} — modelled rebalance only.`,
      confidenceLevel: from && to ? "medium" : "low",
      needsMoreData: !from || !to,
    };
  }

  return {
    scenarioType: "none",
    estimatedSaving: null,
    expectedRiskChange: null,
    staffingImpact: "Select a simulation scenario.",
    confidenceLevel: "low",
    needsMoreData: true,
  };
}

export async function loadWorkforceDigitalTwin(
  supabase: SupabaseClient,
  companyId: string,
  snapshotDate = todayIsoDate()
): Promise<{ dashboard: WorkforceDigitalTwinDashboard | null; error: string | null }> {
  if (!companyId) return { dashboard: null, error: "No company selected." };

  const weekEnd = daysAheadIso(7);
  const [ctx, rosterRes] = await Promise.all([
    fetchCopilotContext(supabase, companyId, snapshotDate),
    supabase
      .from("roster_shifts")
      .select("store_id, shift_date, employee_id")
      .eq("company_id", companyId)
      .gte("shift_date", snapshotDate)
      .lte("shift_date", weekEnd),
  ]);

  const dashboard = buildWorkforceDigitalTwinDashboard(
    ctx,
    (rosterRes.data || []) as { store_id: string | null; shift_date: string; employee_id: string }[]
  );

  const sync = await syncWorkforceDigitalTwin(supabase, dashboard);
  return { dashboard, error: sync.error };
}

export async function syncWorkforceDigitalTwin(
  supabase: SupabaseClient,
  dashboard: WorkforceDigitalTwinDashboard
): Promise<{ ok: boolean; error: string | null }> {
  const now = new Date().toISOString();
  const exec = dashboard.executive;

  const { error: snapError } = await supabase.from("workforce_digital_twin_snapshots").upsert(
    {
      company_id: dashboard.companyId,
      snapshot_date: dashboard.snapshotDate,
      workforce_health_pct: exec.workforceHealthPct,
      labour_cost_today: exec.labourCostToday,
      productivity_pct: exec.productivityPct,
      risk_level: exec.riskLevel,
      predicted_leakage: exec.predictedLeakage,
      active_employees: exec.activeEmployees,
      active_field_jobs: exec.activeFieldJobs,
      high_risk_employees: exec.highRiskEmployees,
      summary_json: exec,
      heatmap_json: dashboard.heatMap,
      data_gaps: exec.dataGaps,
      updated_at: now,
    },
    { onConflict: "company_id,snapshot_date" }
  );
  if (snapError && !isTwinMissingTable(snapError)) {
    return { ok: false, error: snapError.message };
  }

  for (const row of dashboard.heatMap) {
    await supabase.from("workforce_health_scores").upsert(
      {
        company_id: dashboard.companyId,
        score_date: dashboard.snapshotDate,
        entity_type: "store",
        entity_id: row.storeId,
        entity_label: row.storeName,
        region: row.region,
        overall_health: row.overallHealth ?? 0,
        labour_cost: row.labourCost,
        productivity_pct: row.productivityPct,
        attendance_risk: row.attendanceRisk ?? 0,
        overtime_risk: row.overtimeRisk ?? 0,
        field_risk: row.fieldRisk ?? 0,
        employee_count: row.employeeCount,
      },
      { onConflict: "company_id,score_date,entity_type,entity_id" }
    );
  }

  const fc = dashboard.forecast;
  await supabase.from("workforce_forecasts").upsert(
    {
      company_id: dashboard.companyId,
      forecast_date: dashboard.snapshotDate,
      horizon_days: 7,
      staffing_risk_score: fc.staffingRisk7d,
      payroll_pressure_score: fc.payrollPressure,
      field_ops_pressure_score: fc.fieldOpsPressure,
      predicted_shortages: fc.predictedShortages,
      predicted_overstaffing: fc.predictedOverstaffing,
      forecast_json: fc,
      needs_more_data: fc.needsMoreData,
    },
    { onConflict: "company_id,forecast_date,horizon_days" }
  );

  await supabase
    .from("workforce_twin_insights")
    .delete()
    .eq("company_id", dashboard.companyId)
    .eq("insight_date", dashboard.snapshotDate);

  if (dashboard.insights.length) {
    const { error: insError } = await supabase.from("workforce_twin_insights").insert(
      dashboard.insights.map((ins) => ({
        company_id: dashboard.companyId,
        insight_date: dashboard.snapshotDate,
        category: ins.category,
        severity: ins.severity,
        title: ins.title,
        detail: ins.detail,
        source_modules: ins.sourceModules,
      }))
    );
    if (insError && !isTwinMissingTable(insError)) {
      return { ok: false, error: insError.message };
    }
  }

  return { ok: true, error: null };
}

export async function saveWorkforceTwinSimulation(
  supabase: SupabaseClient,
  companyId: string,
  input: WorkforceTwinSimulationInput,
  result: WorkforceTwinSimulationResult,
  createdBy?: string
): Promise<{ ok: boolean; error: string | null }> {
  const { error } = await supabase.from("workforce_simulations").insert({
    company_id: companyId,
    simulation_date: todayIsoDate(),
    scenario_type: result.scenarioType,
    input_json: input,
    estimated_saving: result.estimatedSaving,
    expected_risk_change: result.expectedRiskChange,
    staffing_impact: result.staffingImpact,
    confidence_level: result.confidenceLevel,
    result_json: result,
    created_by: createdBy || null,
  });
  if (error && !isTwinMissingTable(error)) return { ok: false, error: error.message };
  return { ok: true, error: null };
}

export function twinHealthClass(pct: number | null): string {
  if (pct == null) return "bg-slate-100 text-slate-600 border-slate-200";
  if (pct >= 70) return "bg-emerald-100 text-emerald-900 border-emerald-200";
  if (pct >= 40) return "bg-amber-100 text-amber-950 border-amber-200";
  return "bg-rose-100 text-rose-900 border-rose-200";
}

export function formatTwinValue(value: number | null, prefix = "", suffix = ""): string {
  if (value == null) return "Needs more data";
  return `${prefix}${typeof value === "number" ? value.toLocaleString("en-ZA") : value}${suffix}`;
}

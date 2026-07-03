/**
 * VYRON CORE — Workforce Lifecycle funnel engine.
 * Need Staff → Recruit → Hire → Onboard → Manage → Develop → Promote → Retain → Exit
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { isSupabaseMissingTableError } from "@/lib/company-access";
import { fetchCopilotContext } from "@/lib/workforce-ai-copilot";
import { loadWorkforceRiskDashboard } from "@/lib/workforce-risk-intelligence";

export const LIFECYCLE_STAGES = [
  "need_staff",
  "recruit",
  "hire",
  "onboard",
  "manage",
  "develop",
  "promote",
  "retain",
  "exit",
] as const;

export type LifecycleStage = (typeof LIFECYCLE_STAGES)[number];

export const LIFECYCLE_STAGE_LABELS: Record<LifecycleStage, string> = {
  need_staff: "Need Staff",
  recruit: "Recruit",
  hire: "Hire",
  onboard: "Onboard",
  manage: "Manage",
  develop: "Develop",
  promote: "Promote",
  retain: "Retain",
  exit: "Exit",
};

export const LIFECYCLE_STAGE_MODULES: Record<LifecycleStage, string> = {
  need_staff: "Rosters · Digital Twin",
  recruit: "Recruitment Intelligence",
  hire: "Employees · HR Documents",
  onboard: "Client Onboarding · PIN/Kiosk",
  manage: "Clocking · Rosters · Exceptions",
  develop: "HR Cases · Warnings",
  promote: "Employee Profiles",
  retain: "Workforce Risk Intelligence",
  exit: "Staff Archive · HR Cases",
};

export type LifecycleStageMetric = {
  stage: LifecycleStage;
  label: string;
  count: number;
  signalCount: number;
  band: "green" | "amber" | "red";
  summary: string;
  coreModule: string;
};

export type LifecycleEmployeeStatus = {
  employeeId: string;
  employeeLabel: string;
  currentStage: LifecycleStage;
  reason: string;
};

export type LifecycleSignal = {
  id: string;
  stage: LifecycleStage;
  employeeId: string | null;
  message: string;
  severity: "info" | "warning" | "critical";
};

export type LifecycleRecommendation = {
  id: string;
  priority: number;
  band: "green" | "amber" | "red";
  title: string;
  detail: string;
  stage: LifecycleStage;
};

export type WorkforceLifecycleDashboard = {
  companyId: string;
  snapshotDate: string;
  funnel: LifecycleStageMetric[];
  totalActive: number;
  totalExited: number;
  employeeStatuses: LifecycleEmployeeStatus[];
  signals: LifecycleSignal[];
  recommendations: LifecycleRecommendation[];
  tablesAvailable: boolean;
};

const LIFECYCLE_TABLES = [
  "employee_lifecycle_status",
  "workforce_lifecycle_events",
  "workforce_lifecycle_snapshots",
] as const;

function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function daysAgoIso(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

function empLabel(e: { first_name: string; last_name: string }): string {
  return `${e.first_name} ${e.last_name}`.trim();
}

function bandFromCount(count: number, warnAt: number, critAt: number): "green" | "amber" | "red" {
  if (count >= critAt) return "red";
  if (count >= warnAt) return "amber";
  return "green";
}

function isOnboardingIncomplete(emp: {
  id: string;
  default_store_id: string | null;
  pin_code?: string | null;
  kiosk_access_enabled?: boolean | null;
}): boolean {
  return !emp.default_store_id || !emp.pin_code || emp.kiosk_access_enabled === false;
}

function isPromoteCandidate(jobTitle: string | null | undefined): boolean {
  if (!jobTitle) return false;
  const t = jobTitle.toLowerCase();
  return /supervisor|manager|lead|senior|head|chief/.test(t);
}

type LifecycleContext = {
  companyId: string;
  snapshotDate: string;
  employees: {
    id: string;
    first_name: string;
    last_name: string;
    job_title: string | null;
    default_store_id: string | null;
    active: boolean;
    pin_code?: string | null;
    kiosk_access_enabled?: boolean | null;
    created_at?: string | null;
  }[];
  rosterShifts: { store_id: string | null; shift_date: string; employee_id: string }[];
  clockEmployeeIds: Set<string>;
  hrCases: { employee_id: string | null; status: string; case_type: string | null }[];
  hrWarnings: { employee_id: string | null; status: string }[];
  riskByEmployee: Map<string, { resignation: number; burnout: number; overall: number }>;
  staffingGaps: { storeId: string; storeName: string; gap: number }[];
};

export function buildWorkforceLifecycleDashboard(ctx: LifecycleContext): WorkforceLifecycleDashboard {
  const active = ctx.employees.filter((e) => e.active !== false);
  const exited = ctx.employees.filter((e) => e.active === false);

  const signals: LifecycleSignal[] = [];
  const employeeStatuses: LifecycleEmployeeStatus[] = [];

  const needStaffCount = ctx.staffingGaps.reduce((s, g) => s + g.gap, 0);
  for (const gap of ctx.staffingGaps) {
    if (gap.gap <= 0) continue;
    signals.push({
      id: `need-${gap.storeId}`,
      stage: "need_staff",
      employeeId: null,
      message: `${gap.storeName}: ${gap.gap} roster gap(s) detected`,
      severity: gap.gap >= 3 ? "critical" : "warning",
    });
  }

  const recruitCount = needStaffCount;
  if (recruitCount > 0) {
    signals.push({
      id: "recruit-pipeline",
      stage: "recruit",
      employeeId: null,
      message: `${recruitCount} open hiring need(s) from roster coverage gaps`,
      severity: recruitCount >= 5 ? "critical" : "warning",
    });
  }

  const recentCutoff = daysAgoIso(30);
  const hireCandidates = active.filter(
    (e) => e.created_at && e.created_at.slice(0, 10) >= recentCutoff
  );
  for (const e of hireCandidates) {
    signals.push({
      id: `hire-${e.id}`,
      stage: "hire",
      employeeId: e.id,
      message: `${empLabel(e)} added recently — confirm offer & contract`,
      severity: "info",
    });
  }

  const onboardEmployees = active.filter((e) => isOnboardingIncomplete(e));
  const newWithoutClock = active.filter(
    (e) =>
      e.created_at &&
      e.created_at.slice(0, 10) >= daysAgoIso(14) &&
      !ctx.clockEmployeeIds.has(e.id)
  );
  for (const e of onboardEmployees) {
    signals.push({
      id: `onboard-${e.id}`,
      stage: "onboard",
      employeeId: e.id,
      message: `${empLabel(e)} onboarding incomplete (store/PIN/kiosk)`,
      severity: "warning",
    });
  }
  for (const e of newWithoutClock) {
    if (onboardEmployees.some((o) => o.id === e.id)) continue;
    signals.push({
      id: `onboard-clock-${e.id}`,
      stage: "onboard",
      employeeId: e.id,
      message: `${empLabel(e)} has no clock events yet`,
      severity: "info",
    });
  }

  const manageCount = active.filter(
    (e) =>
      ctx.clockEmployeeIds.has(e.id) &&
      !isOnboardingIncomplete(e) &&
      !onboardEmployees.some((o) => o.id === e.id)
  ).length;

  const developEmployees = new Set<string>();
  for (const w of ctx.hrWarnings) {
    if (!w.employee_id || w.status === "closed" || w.status === "resolved") continue;
    developEmployees.add(w.employee_id);
    signals.push({
      id: `develop-warn-${w.employee_id}`,
      stage: "develop",
      employeeId: w.employee_id,
      message: `Open HR warning for employee`,
      severity: "warning",
    });
  }
  for (const c of ctx.hrCases) {
    if (!c.employee_id || c.status === "closed") continue;
    const type = (c.case_type || "").toLowerCase();
    if (type.includes("exit") || type.includes("termination") || type.includes("resign")) continue;
    developEmployees.add(c.employee_id);
    signals.push({
      id: `develop-case-${c.employee_id}-${c.case_type}`,
      stage: "develop",
      employeeId: c.employee_id,
      message: `Open HR case (${c.case_type || "case"})`,
      severity: "warning",
    });
  }

  const promoteEmployees = active.filter((e) => isPromoteCandidate(e.job_title));
  for (const e of promoteEmployees) {
    signals.push({
      id: `promote-${e.id}`,
      stage: "promote",
      employeeId: e.id,
      message: `${empLabel(e)} — leadership role (${e.job_title})`,
      severity: "info",
    });
  }

  const retainEmployees = active.filter((e) => {
    const r = ctx.riskByEmployee.get(e.id);
    return r && (r.resignation >= 40 || r.burnout >= 40 || r.overall >= 70);
  });
  for (const e of retainEmployees) {
    const r = ctx.riskByEmployee.get(e.id)!;
    signals.push({
      id: `retain-${e.id}`,
      stage: "retain",
      employeeId: e.id,
      message: `${empLabel(e)} retention risk (overall ${r.overall}, resignation ${r.resignation})`,
      severity: r.overall >= 70 ? "critical" : "warning",
    });
  }

  for (const e of exited) {
    signals.push({
      id: `exit-${e.id}`,
      stage: "exit",
      employeeId: e.id,
      message: `${empLabel(e)} archived / inactive`,
      severity: "info",
    });
  }

  for (const e of active) {
    let stage: LifecycleStage = "manage";
    let reason = "Active — in daily workforce management";

    if (isOnboardingIncomplete(e) || newWithoutClock.some((n) => n.id === e.id)) {
      stage = "onboard";
      reason = "Onboarding in progress";
    } else if (retainEmployees.some((r) => r.id === e.id)) {
      stage = "retain";
      reason = "Elevated retention risk";
    } else if (developEmployees.has(e.id)) {
      stage = "develop";
      reason = "Open HR development / discipline signal";
    } else if (promoteEmployees.some((p) => p.id === e.id)) {
      stage = "promote";
      reason = "Leadership / promotion track";
    } else if (hireCandidates.some((h) => h.id === e.id)) {
      stage = "hire";
      reason = "Recently hired";
    }

    employeeStatuses.push({
      employeeId: e.id,
      employeeLabel: empLabel(e),
      currentStage: stage,
      reason,
    });
  }

  for (const e of exited) {
    employeeStatuses.push({
      employeeId: e.id,
      employeeLabel: empLabel(e),
      currentStage: "exit",
      reason: "Archived or inactive",
    });
  }

  const stageSignalCount = (stage: LifecycleStage) =>
    signals.filter((s) => s.stage === stage).length;

  const funnel: LifecycleStageMetric[] = [
    {
      stage: "need_staff",
      label: LIFECYCLE_STAGE_LABELS.need_staff,
      count: needStaffCount,
      signalCount: stageSignalCount("need_staff"),
      band: bandFromCount(needStaffCount, 2, 5),
      summary:
        needStaffCount > 0
          ? `${needStaffCount} staffing gap(s) from roster coverage`
          : "Roster coverage looks adequate",
      coreModule: LIFECYCLE_STAGE_MODULES.need_staff,
    },
    {
      stage: "recruit",
      label: LIFECYCLE_STAGE_LABELS.recruit,
      count: recruitCount,
      signalCount: stageSignalCount("recruit"),
      band: bandFromCount(recruitCount, 2, 5),
      summary:
        recruitCount > 0
          ? `${recruitCount} role(s) to fill via recruitment`
          : "No active recruitment pressure",
      coreModule: LIFECYCLE_STAGE_MODULES.recruit,
    },
    {
      stage: "hire",
      label: LIFECYCLE_STAGE_LABELS.hire,
      count: hireCandidates.length,
      signalCount: stageSignalCount("hire"),
      band: bandFromCount(hireCandidates.length, 3, 8),
      summary: `${hireCandidates.length} recent hire(s) in last 30 days`,
      coreModule: LIFECYCLE_STAGE_MODULES.hire,
    },
    {
      stage: "onboard",
      label: LIFECYCLE_STAGE_LABELS.onboard,
      count: new Set([...onboardEmployees, ...newWithoutClock].map((e) => e.id)).size,
      signalCount: stageSignalCount("onboard"),
      band: bandFromCount(onboardEmployees.length, 2, 5),
      summary: `${onboardEmployees.length} incomplete onboarding checklist(s)`,
      coreModule: LIFECYCLE_STAGE_MODULES.onboard,
    },
    {
      stage: "manage",
      label: LIFECYCLE_STAGE_LABELS.manage,
      count: manageCount,
      signalCount: 0,
      band: "green",
      summary: `${manageCount} employee(s) in active daily management`,
      coreModule: LIFECYCLE_STAGE_MODULES.manage,
    },
    {
      stage: "develop",
      label: LIFECYCLE_STAGE_LABELS.develop,
      count: developEmployees.size,
      signalCount: stageSignalCount("develop"),
      band: bandFromCount(developEmployees.size, 2, 5),
      summary: `${developEmployees.size} employee(s) with HR development signals`,
      coreModule: LIFECYCLE_STAGE_MODULES.develop,
    },
    {
      stage: "promote",
      label: LIFECYCLE_STAGE_LABELS.promote,
      count: promoteEmployees.length,
      signalCount: stageSignalCount("promote"),
      band: "green",
      summary: `${promoteEmployees.length} leadership / promotion track`,
      coreModule: LIFECYCLE_STAGE_MODULES.promote,
    },
    {
      stage: "retain",
      label: LIFECYCLE_STAGE_LABELS.retain,
      count: retainEmployees.length,
      signalCount: stageSignalCount("retain"),
      band: bandFromCount(retainEmployees.length, 2, 5),
      summary: `${retainEmployees.length} employee(s) need retention focus`,
      coreModule: LIFECYCLE_STAGE_MODULES.retain,
    },
    {
      stage: "exit",
      label: LIFECYCLE_STAGE_LABELS.exit,
      count: exited.length,
      signalCount: stageSignalCount("exit"),
      band: "green",
      summary: `${exited.length} archived / exited employee(s)`,
      coreModule: LIFECYCLE_STAGE_MODULES.exit,
    },
  ];

  const partial = {
    companyId: ctx.companyId,
    snapshotDate: ctx.snapshotDate,
    funnel,
    totalActive: active.length,
    totalExited: exited.length,
    employeeStatuses,
    signals,
  };

  return {
    ...partial,
    recommendations: buildLifecycleRecommendations(partial),
    tablesAvailable: true,
  };
}

function buildLifecycleRecommendations(
  dash: Omit<WorkforceLifecycleDashboard, "recommendations" | "tablesAvailable">
): LifecycleRecommendation[] {
  const recs: LifecycleRecommendation[] = [];
  const need = dash.funnel.find((f) => f.stage === "need_staff");
  const onboard = dash.funnel.find((f) => f.stage === "onboard");
  const retain = dash.funnel.find((f) => f.stage === "retain");

  if (need && need.count >= 2) {
    recs.push({
      id: "rec-need-staff",
      priority: 1,
      band: need.band === "red" ? "red" : "amber",
      title: "Address staffing gaps before roster publish",
      detail: `${need.count} gap(s) detected. Review Rosters and Digital Twin shortage forecast.`,
      stage: "need_staff",
    });
  }

  if (onboard && onboard.count > 0) {
    recs.push({
      id: "rec-onboard",
      priority: 2,
      band: "amber",
      title: "Complete employee onboarding checklists",
      detail: `${onboard.count} employee(s) missing store, PIN, kiosk, or first clock event.`,
      stage: "onboard",
    });
  }

  if (retain && retain.count > 0) {
    recs.push({
      id: "rec-retain",
      priority: 3,
      band: retain.band === "red" ? "red" : "amber",
      title: "Run retention interventions",
      detail: `${retain.count} high-risk employee(s). Review Workforce Risk Intelligence.`,
      stage: "retain",
    });
  }

  const develop = dash.funnel.find((f) => f.stage === "develop");
  if (develop && develop.count >= 3) {
    recs.push({
      id: "rec-develop",
      priority: 4,
      band: "amber",
      title: "Clear HR development backlog",
      detail: `${develop.count} open warning/case signal(s) affecting development stage.`,
      stage: "develop",
    });
  }

  if (recs.length === 0) {
    recs.push({
      id: "rec-healthy",
      priority: 99,
      band: "green",
      title: "Workforce lifecycle looks balanced",
      detail: "No critical gaps across recruit → retain funnel for this snapshot.",
      stage: "manage",
    });
  }

  return recs.sort((a, b) => a.priority - b.priority);
}

function isLifecycleMissingTable(error: { message?: string } | null): boolean {
  if (!error) return false;
  return (
    isSupabaseMissingTableError(error) ||
    LIFECYCLE_TABLES.some((t) => error.message?.includes(t))
  );
}

async function fetchLifecycleContext(
  supabase: SupabaseClient,
  companyId: string,
  snapshotDate: string
): Promise<LifecycleContext> {
  const weekStart = daysAgoIso(7);

  const [ctx, employeesRes, rosterRes, clockRes, hrCasesRes, hrWarningsRes, riskLoad] =
    await Promise.all([
      fetchCopilotContext(supabase, companyId, snapshotDate),
      supabase
        .from("employees")
        .select(
          "id, first_name, last_name, job_title, default_store_id, active, pin_code, kiosk_access_enabled, created_at"
        )
        .eq("company_id", companyId),
      supabase
        .from("roster_shifts")
        .select("store_id, shift_date, employee_id")
        .eq("company_id", companyId)
        .gte("shift_date", snapshotDate)
        .lte("shift_date", daysAgoIso(-7)),
      supabase
        .from("clock_events")
        .select("employee_id")
        .eq("company_id", companyId)
        .gte("event_time", `${weekStart}T00:00:00`)
        .limit(1000),
      supabase
        .from("hr_cases")
        .select("employee_id, status, case_type")
        .eq("company_id", companyId)
        .limit(300),
      supabase.from("hr_warnings").select("employee_id, status").limit(300),
      loadWorkforceRiskDashboard(supabase, companyId, snapshotDate),
    ]);

  const employees = (employeesRes.data || []) as LifecycleContext["employees"];
  const stores = ctx.stores;
  const activeByStore = new Map<string, number>();
  for (const e of employees.filter((x) => x.active !== false)) {
    const sid = e.default_store_id || "unassigned";
    activeByStore.set(sid, (activeByStore.get(sid) || 0) + 1);
  }

  const shiftsNeededByStore = new Map<string, number>();
  for (const shift of (rosterRes.data || []) as LifecycleContext["rosterShifts"]) {
    const sid = shift.store_id || "unassigned";
    shiftsNeededByStore.set(sid, (shiftsNeededByStore.get(sid) || 0) + 1);
  }

  const staffingGaps: LifecycleContext["staffingGaps"] = [];
  for (const [storeId, shiftsNeeded] of shiftsNeededByStore) {
    const available = activeByStore.get(storeId) || 0;
    const gap = Math.max(0, Math.ceil(shiftsNeeded / 5) - available);
    if (gap <= 0) continue;
    const storeName = stores.find((s) => s.id === storeId)?.name || storeId;
    staffingGaps.push({ storeId, storeName, gap });
  }

  const riskByEmployee = new Map<string, { resignation: number; burnout: number; overall: number }>();
  for (const row of riskLoad.dashboard?.employeeScores || []) {
    if (row.entityType !== "employee") continue;
    riskByEmployee.set(row.entityId, {
      resignation: row.categories["Resignation Risk"] ?? 0,
      burnout: row.categories["Burnout Risk"] ?? 0,
      overall: row.overallScore,
    });
  }

  const clockEmployeeIds = new Set(
    ((clockRes.data || []) as { employee_id: string }[]).map((c) => c.employee_id)
  );

  return {
    companyId,
    snapshotDate,
    employees,
    rosterShifts: (rosterRes.data || []) as LifecycleContext["rosterShifts"],
    clockEmployeeIds,
    hrCases: (hrCasesRes.data || []) as LifecycleContext["hrCases"],
    hrWarnings: (hrWarningsRes.data || []) as LifecycleContext["hrWarnings"],
    riskByEmployee,
    staffingGaps,
  };
}

export async function syncWorkforceLifecycle(
  supabase: SupabaseClient,
  dashboard: WorkforceLifecycleDashboard
): Promise<{ ok: boolean; error: string | null }> {
  const now = new Date().toISOString();

  const stageCounts = Object.fromEntries(
    dashboard.funnel.map((f) => [f.stage, f.count])
  );

  const { error: snapError } = await supabase.from("workforce_lifecycle_snapshots").upsert(
    {
      company_id: dashboard.companyId,
      snapshot_date: dashboard.snapshotDate,
      stage_counts: stageCounts,
      funnel_json: dashboard.funnel,
      recommendations: dashboard.recommendations,
      computed_at: now,
    },
    { onConflict: "company_id,snapshot_date" }
  );
  if (snapError && !isLifecycleMissingTable(snapError)) {
    return { ok: false, error: snapError.message };
  }

  for (const status of dashboard.employeeStatuses) {
    await supabase.from("employee_lifecycle_status").upsert(
      {
        company_id: dashboard.companyId,
        employee_id: status.employeeId,
        current_stage: status.currentStage,
        metadata: { reason: status.reason, label: status.employeeLabel },
        updated_at: now,
      },
      { onConflict: "company_id,employee_id" }
    );
  }

  await supabase
    .from("workforce_lifecycle_events")
    .delete()
    .eq("company_id", dashboard.companyId)
    .gte("recorded_at", `${dashboard.snapshotDate}T00:00:00`)
    .lte("recorded_at", `${dashboard.snapshotDate}T23:59:59`);

  if (dashboard.signals.length > 0) {
    const { error: evError } = await supabase.from("workforce_lifecycle_events").insert(
      dashboard.signals.map((s) => ({
        company_id: dashboard.companyId,
        employee_id: s.employeeId,
        lifecycle_stage: s.stage,
        event_type: "signal",
        message: s.message,
        severity: s.severity,
        metadata: { signalId: s.id },
        recorded_at: now,
      }))
    );
    if (evError && !isLifecycleMissingTable(evError)) {
      return { ok: false, error: evError.message };
    }
  }

  return { ok: true, error: null };
}

export async function loadWorkforceLifecycle(
  supabase: SupabaseClient,
  companyId: string,
  snapshotDate = todayIsoDate()
): Promise<{ dashboard: WorkforceLifecycleDashboard | null; error: string | null }> {
  if (!companyId) return { dashboard: null, error: "No company selected." };

  const ctx = await fetchLifecycleContext(supabase, companyId, snapshotDate);
  const dashboard = buildWorkforceLifecycleDashboard(ctx);
  const sync = await syncWorkforceLifecycle(supabase, dashboard);
  return { dashboard, error: sync.error };
}

export function lifecycleBandClass(band: "green" | "amber" | "red"): string {
  if (band === "green") return "border-emerald-200 bg-emerald-50 text-emerald-800";
  if (band === "amber") return "border-amber-200 bg-amber-50 text-amber-800";
  return "border-rose-200 bg-rose-50 text-rose-800";
}

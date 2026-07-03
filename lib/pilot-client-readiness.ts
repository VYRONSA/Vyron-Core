/**
 * VYRON CORE — Pilot Client Readiness Program
 * Computes setup completion, payroll readiness, and training progress.
 */

import {
  countTrainingArticles,
  listAllTrainingArticleIds,
} from "@/lib/training-centre-content";

export type PilotSetupStepId =
  | "company_profile"
  | "first_store"
  | "employees_loaded"
  | "kiosk_pins"
  | "kiosk_urls"
  | "roster_started"
  | "clock_events"
  | "payroll_generated"
  | "exceptions_clear"
  | "training_started";

export type PilotSetupStep = {
  id: PilotSetupStepId;
  label: string;
  phase: "company" | "employees" | "kiosks" | "payroll" | "training";
  done: boolean;
  detail: string;
  estimatedMinutes: number;
};

export type PilotReadinessInput = {
  companyId: string;
  companyName: string;
  companyContactSet?: boolean;
  stores: Array<{ id: string; name: string }>;
  employees: Array<{
    id: string;
    pin_code?: string | null;
    kiosk_access_enabled?: boolean | null;
  }>;
  rosterShifts: Array<{ id: string }>;
  clockEvents: Array<{ id: string }>;
  payrollHours: Array<{ id: string; status?: string | null }>;
  exceptions: Array<{ status: string }>;
  hrCases: Array<{ status?: string | null }>;
  trainingCompletedIds?: string[];
};

export type PilotReadinessReport = {
  setupCompletionPercent: number;
  payrollReadinessPercent: number;
  trainingProgressPercent: number;
  overallPercent: number;
  missingSteps: PilotSetupStep[];
  completedSteps: PilotSetupStep[];
  allSteps: PilotSetupStep[];
  estimatedMinutesRemaining: number;
  kioskClockUrl: string;
  kioskLeaveUrl: string;
  employeesWithKiosk: number;
  openExceptions: number;
  openHrCases: number;
};

const TRAINING_STORAGE_PREFIX = "vyron-training-progress-";

export function trainingProgressStorageKey(companyId: string): string {
  return `${TRAINING_STORAGE_PREFIX}${companyId}`;
}

export function readTrainingProgress(companyId: string): string[] {
  if (typeof window === "undefined" || !companyId) return [];
  try {
    const raw = localStorage.getItem(trainingProgressStorageKey(companyId));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.filter((id) => typeof id === "string") : [];
  } catch {
    return [];
  }
}

export function writeTrainingProgress(companyId: string, articleIds: string[]): void {
  if (typeof window === "undefined" || !companyId) return;
  const valid = new Set(listAllTrainingArticleIds());
  const cleaned = [...new Set(articleIds.filter((id) => valid.has(id)))];
  localStorage.setItem(trainingProgressStorageKey(companyId), JSON.stringify(cleaned));
}

export function markTrainingArticleComplete(companyId: string, articleId: string): string[] {
  const current = readTrainingProgress(companyId);
  if (!current.includes(articleId)) {
    const next = [...current, articleId];
    writeTrainingProgress(companyId, next);
    return next;
  }
  return current;
}

export function computeTrainingProgressPercent(completedIds: string[]): number {
  const total = countTrainingArticles();
  if (total === 0) return 100;
  const valid = new Set(listAllTrainingArticleIds());
  const done = completedIds.filter((id) => valid.has(id)).length;
  return Math.round((done / total) * 100);
}

function percentSafe(done: number, total: number): number {
  if (total <= 0) return 0;
  return Math.round((done / total) * 100);
}

function isOpenException(status: string): boolean {
  return status !== "closed" && status !== "approved";
}

function isOpenHrCase(status: string | null | undefined): boolean {
  return status !== "closed";
}

export function buildKioskUrl(path: "/clock" | "/leave", companyId: string): string {
  if (typeof window !== "undefined" && window.location?.origin) {
    return `${window.location.origin}${path}?company=${companyId}`;
  }
  return `${path}?company=${companyId}`;
}

export function computePilotReadiness(input: PilotReadinessInput): PilotReadinessReport {
  const {
    companyId,
    companyName,
    companyContactSet = false,
    stores,
    employees,
    rosterShifts,
    clockEvents,
    payrollHours,
    exceptions,
    hrCases,
    trainingCompletedIds = [],
  } = input;

  const hasCompanyProfile = Boolean(companyId) && Boolean(companyName?.trim()) && companyContactSet;
  const hasStore = stores.length > 0;
  const hasEmployees = employees.length > 0;
  const employeesWithKiosk = employees.filter(
    (e) => e.kiosk_access_enabled !== false && Boolean(e.pin_code?.trim())
  ).length;
  const kioskPinsReady = hasEmployees && employeesWithKiosk >= Math.min(3, employees.length);
  const hasRoster = rosterShifts.length > 0;
  const hasClockEvents = clockEvents.length > 0;
  const hasPayrollHours = payrollHours.length > 0;
  const openExceptions = exceptions.filter((e) => isOpenException(e.status)).length;
  const openHrCases = hrCases.filter((c) => isOpenHrCase(c.status)).length;
  const exceptionsClear = openExceptions === 0;
  const hrClear = openHrCases === 0;
  const approvedPayroll = payrollHours.some(
    (row) => row.status === "approved" || row.status === "exported"
  );
  const trainingStarted = trainingCompletedIds.length > 0;
  const trainingPercent = computeTrainingProgressPercent(trainingCompletedIds);

  const allSteps: PilotSetupStep[] = [
    {
      id: "company_profile",
      label: "Company profile saved",
      phase: "company",
      done: hasCompanyProfile,
      detail: hasCompanyProfile
        ? `Workspace "${companyName}" is configured.`
        : "Save company name and contact person in Company Setup.",
      estimatedMinutes: 5,
    },
    {
      id: "first_store",
      label: "At least one store / site",
      phase: "company",
      done: hasStore,
      detail: hasStore
        ? `${stores.length} store(s) ready for clocking and rosters.`
        : "Add your first store or site location.",
      estimatedMinutes: 5,
    },
    {
      id: "employees_loaded",
      label: "Employees imported",
      phase: "employees",
      done: hasEmployees,
      detail: hasEmployees
        ? `${employees.length} employee(s) on file.`
        : "Import or add at least one employee.",
      estimatedMinutes: 8,
    },
    {
      id: "kiosk_pins",
      label: "Kiosk PINs configured",
      phase: "kiosks",
      done: kioskPinsReady,
      detail: kioskPinsReady
        ? `${employeesWithKiosk} employee(s) have kiosk PINs.`
        : "Set 4-digit PINs and enable kiosk access for staff.",
      estimatedMinutes: 5,
    },
    {
      id: "kiosk_urls",
      label: "Kiosk URLs deployed",
      phase: "kiosks",
      done: Boolean(companyId) && hasStore && kioskPinsReady,
      detail: "Copy clock and leave kiosk links to shared tablets.",
      estimatedMinutes: 3,
    },
    {
      id: "roster_started",
      label: "Roster shifts created",
      phase: "payroll",
      done: hasRoster,
      detail: hasRoster
        ? `${rosterShifts.length} shift(s) scheduled.`
        : "Create at least one roster shift for payroll comparison.",
      estimatedMinutes: 5,
    },
    {
      id: "clock_events",
      label: "Clocking evidence captured",
      phase: "payroll",
      done: hasClockEvents,
      detail: hasClockEvents
        ? `${clockEvents.length} clock event(s) recorded.`
        : "Run a test clock-in from the kiosk or workspace.",
      estimatedMinutes: 3,
    },
    {
      id: "payroll_generated",
      label: "Payroll hours generated",
      phase: "payroll",
      done: hasPayrollHours,
      detail: hasPayrollHours
        ? `${payrollHours.length} payroll row(s) generated.`
        : "Open Payroll Prep and generate the first payroll batch.",
      estimatedMinutes: 5,
    },
    {
      id: "exceptions_clear",
      label: "Blockers cleared for export",
      phase: "payroll",
      done: exceptionsClear && hrClear && (approvedPayroll || !hasPayrollHours),
      detail:
        openExceptions + openHrCases > 0
          ? `${openExceptions} open exception(s), ${openHrCases} open HR case(s).`
          : approvedPayroll
            ? "Payroll rows approved — ready for export."
            : "Resolve exceptions and approve clean payroll rows.",
      estimatedMinutes: 5,
    },
    {
      id: "training_started",
      label: "Training progress started",
      phase: "training",
      done: trainingStarted,
      detail: trainingStarted
        ? `${trainingPercent}% of guides completed.`
        : "Complete at least one Training Centre guide.",
      estimatedMinutes: 5,
    },
  ];

  const completedSteps = allSteps.filter((s) => s.done);
  const missingSteps = allSteps.filter((s) => !s.done);
  const setupCompletionPercent = percentSafe(completedSteps.length, allSteps.length);
  const estimatedMinutesRemaining = missingSteps.reduce((sum, s) => sum + s.estimatedMinutes, 0);

  const payrollSteps = allSteps.filter((s) => s.phase === "payroll");
  const payrollDone = payrollSteps.filter((s) => s.done).length;
  const payrollReadinessPercent = percentSafe(payrollDone, payrollSteps.length);

  const overallPercent = Math.round(
    setupCompletionPercent * 0.45 +
      payrollReadinessPercent * 0.35 +
      trainingPercent * 0.2
  );

  return {
    setupCompletionPercent,
    payrollReadinessPercent,
    trainingProgressPercent: trainingPercent,
    overallPercent,
    missingSteps,
    completedSteps,
    allSteps,
    estimatedMinutesRemaining,
    kioskClockUrl: buildKioskUrl("/clock", companyId),
    kioskLeaveUrl: buildKioskUrl("/leave", companyId),
    employeesWithKiosk,
    openExceptions,
    openHrCases,
  };
}

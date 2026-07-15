import type { SupabaseClient } from "@supabase/supabase-js";
import { calculateWorkforceIntelligence } from "@/lib/intelligence-suite";
import { evaluateDiscipline } from "@/lib/progressive-discipline-engine";
import { shouldSuppressWorkspaceLoadError } from "@/lib/company-access";

type RiskLevel = "low" | "medium" | "high" | "critical";
type StatusLevel = "missing" | "expired" | "expiring" | "unsigned" | "overdue" | "valid" | "active";

type EmployeeRow = Record<string, unknown>;
type GenericRow = Record<string, unknown>;

export type EmployeeIntelligence = {
  employeeId: string;
  employeeName: string;
  department: string;
  manager: string;
  employeeHealthScore: number;
  attendanceRisk: RiskLevel;
  disciplineRisk: RiskLevel;
  complianceRisk: RiskLevel;
  documentationCompleteness: number;
  contractStatus: StatusLevel;
  qualificationStatus: StatusLevel;
  medicalCertificateStatus: StatusLevel;
  performanceStatus: StatusLevel;
  activeCases: number;
  activeHearings: number;
  activeWarnings: number;
  expiredWarnings: number;
  openActions: number;
  outstandingDocuments: string[];
};

export type DepartmentIntelligence = {
  department: string;
  employeeCount: number;
  averageHealthScore: number;
  highRiskEmployees: number;
  activeCases: number;
  activeHearings: number;
  activeWarnings: number;
  documentationCompletenessAvg: number;
  disciplinaryActivity: number;
};

export type ManagerIntelligence = {
  manager: string;
  employeeCount: number;
  averageHealthScore: number;
  activeCases: number;
  activeHearings: number;
  openActions: number;
  highRiskEmployees: number;
  workloadRisk: RiskLevel;
};

export type WorkforceRisk = {
  highRiskEmployees: Array<{ employeeId: string; employeeName: string; employeeHealthScore: number }>;
  hearingOverdue: Array<{ hearingId: string; employeeId: string; employeeName: string; daysOverdue: number }>;
  expiringContracts: Array<{ employeeId: string; employeeName: string; daysToExpiry: number }>;
  missingDocuments: Array<{ employeeId: string; employeeName: string; missing: string[] }>;
  missingQualifications: Array<{ employeeId: string; employeeName: string; status: StatusLevel }>;
  expiredMedicals: Array<{ employeeId: string; employeeName: string; daysExpired: number }>;
  repeatMisconduct: Array<{ employeeId: string; employeeName: string; incidents: number }>;
  repeatAbsenteeism: Array<{ employeeId: string; employeeName: string; incidents: number }>;
  highManagerWorkload: Array<{ manager: string; openActions: number; highRiskEmployees: number }>;
  topDisciplinaryDepartments: Array<{ department: string; activityCount: number }>;
};

export type WorkforceRecommendation = {
  id: string;
  category:
    | "hearing_overdue"
    | "contract_expiry"
    | "missing_qualification"
    | "final_warning_expiry"
    | "hr_review"
    | "repeat_misconduct"
    | "department_intervention";
  priority: "critical" | "high" | "medium" | "low";
  title: string;
  description: string;
  employeeId: string | null;
  department: string | null;
  manager: string | null;
  recommendedDecision: string;
  alternativeDecision: string;
  expectedOutcome: string;
  confidence: number;
};

export type ExecutiveWorkforceSummary = {
  employeeCount: number;
  averageEmployeeHealthScore: number;
  highRiskEmployeeCount: number;
  hearingOverdueCount: number;
  expiringContractCount: number;
  missingDocumentCount: number;
  recommendationsCount: number;
  topRiskDepartments: Array<{ department: string; riskScore: number }>;
  computedAtIso: string;
};

export type ExecutiveWorkforceIntelligenceResult = {
  companyId: string;
  summary: ExecutiveWorkforceSummary;
  employees: EmployeeIntelligence[];
  departments: DepartmentIntelligence[];
  managers: ManagerIntelligence[];
  risks: WorkforceRisk;
  recommendations: WorkforceRecommendation[];
};

type LoadedDataset = {
  employees: GenericRow[];
  rosters: GenericRow[];
  clockEvents: GenericRow[];
  leaveRequests: GenericRow[];
  hrCases: GenericRow[];
  hearingCases: GenericRow[];
  hrWarnings: GenericRow[];
  employeeNotes: GenericRow[];
  timeline: GenericRow[];
  employeeDocuments: GenericRow[];
  generatedDocuments: GenericRow[];
  aiGenerations: GenericRow[];
  skills: GenericRow[];
  performanceReviews: GenericRow[];
};

function asText(value: unknown): string {
  return String(value ?? "").trim();
}

function lower(value: unknown): string {
  return asText(value).toLowerCase();
}

function asNumber(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function asDate(value: unknown): Date | null {
  const raw = asText(value);
  if (!raw) return null;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function daysBetween(a: Date, b: Date): number {
  const ms = a.getTime() - b.getTime();
  return Math.floor(ms / 86_400_000);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function riskFromScore(score: number): RiskLevel {
  if (score >= 80) return "low";
  if (score >= 60) return "medium";
  if (score >= 40) return "high";
  return "critical";
}

function isActiveCaseStatus(status: string): boolean {
  const s = status.toLowerCase();
  return !!s && !["closed", "resolved", "cancelled", "cancelled_by_hr"].includes(s);
}

function isActiveWarningStatus(status: string): boolean {
  const s = status.toLowerCase();
  return !!s && !["expired", "withdrawn", "closed", "inactive"].includes(s);
}

function isActiveHearingStatus(status: string): boolean {
  const s = status.toLowerCase();
  return !!s && !["completed", "closed", "cancelled", "outcome_recorded"].includes(s);
}

function looksLikeContract(row: GenericRow): boolean {
  const type = lower(row.document_type);
  const title = lower(row.document_title);
  const cls = lower(row.document_classification);
  return (
    type.includes("contract") ||
    title.includes("contract") ||
    cls === "employment_contract" ||
    cls === "signed_contract"
  );
}

function looksLikeQualification(row: GenericRow): boolean {
  const type = lower(row.document_type);
  const title = lower(row.document_title);
  const cls = lower(row.document_classification);
  return cls === "qualification" || type.includes("qualification") || title.includes("qualification");
}

function looksLikeMedical(row: GenericRow): boolean {
  const type = lower(row.document_type);
  const title = lower(row.document_title);
  const cls = lower(row.document_classification);
  return cls === "medical_certificate" || type.includes("medical") || title.includes("medical");
}

function looksLikePerformance(row: GenericRow): boolean {
  const type = lower(row.document_type);
  const title = lower(row.document_title);
  const cls = lower(row.document_classification);
  return cls === "performance_review" || type.includes("performance") || title.includes("performance");
}

async function selectMaybe(
  query: PromiseLike<{ data: GenericRow[] | null; error: { message?: string } | null }>
): Promise<GenericRow[]> {
  const result = await query;
  if (result.error && !shouldSuppressWorkspaceLoadError(result.error)) {
    throw new Error(result.error.message || "Could not load intelligence inputs.");
  }
  return result.data || [];
}

function getEmployeeName(row: EmployeeRow): string {
  const first = asText(row.first_name);
  const last = asText(row.last_name);
  return `${first} ${last}`.trim() || asText(row.employee_name) || asText(row.id) || "Unknown";
}

function getEmployeeDepartment(row: EmployeeRow): string {
  return asText(row.department || row.job_title) || "Unassigned";
}

function latestDate(rows: GenericRow[], fields: string[]): Date | null {
  const dates = rows
    .map((row) => {
      for (const field of fields) {
        const d = asDate(row[field]);
        if (d) return d;
      }
      return null;
    })
    .filter((d): d is Date => Boolean(d));

  if (!dates.length) return null;
  return dates.sort((a, b) => b.getTime() - a.getTime())[0];
}

function average(values: number[]): number {
  if (!values.length) return 0;
  return Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 100) / 100;
}

async function loadDataset(supabase: SupabaseClient, companyId: string): Promise<LoadedDataset> {
  const fromDate = new Date();
  fromDate.setDate(fromDate.getDate() - 180);
  const fromIso = fromDate.toISOString().slice(0, 10);

  const [
    employees,
    rosters,
    clockEvents,
    leaveRequests,
    hrCases,
    hearingCases,
    hrWarnings,
    employeeNotes,
    timeline,
    employeeDocuments,
    generatedDocuments,
    aiGenerations,
    skills,
    performanceReviews,
  ] = await Promise.all([
    selectMaybe(
      supabase
        .from("employees")
        .select("*")
        .eq("company_id", companyId)
    ),
    selectMaybe(
      supabase
        .from("roster_shifts")
        .select("*")
        .eq("company_id", companyId)
        .gte("shift_date", fromIso)
    ),
    selectMaybe(
      supabase
        .from("clock_events")
        .select("*")
        .eq("company_id", companyId)
    ),
    selectMaybe(
      supabase
        .from("leave_requests")
        .select("*")
        .eq("company_id", companyId)
    ),
    selectMaybe(
      supabase
        .from("hr_cases")
        .select("*")
        .eq("company_id", companyId)
    ),
    selectMaybe(
      supabase
        .from("hearing_cases")
        .select("*")
        .eq("company_id", companyId)
    ),
    selectMaybe(
      supabase
        .from("hr_warnings")
        .select("*")
        .eq("company_id", companyId)
    ),
    selectMaybe(
      supabase
        .from("employee_notes")
        .select("*")
        .eq("company_id", companyId)
    ),
    selectMaybe(
      supabase
        .from("employee_relations_timeline_events")
        .select("*")
        .eq("company_id", companyId)
    ),
    selectMaybe(
      supabase
        .from("employee_documents")
        .select("*")
        .eq("company_id", companyId)
    ),
    selectMaybe(
      supabase
        .from("employee_generated_documents")
        .select("*")
        .eq("company_id", companyId)
    ),
    selectMaybe(
      supabase
        .from("ai_document_generations")
        .select("*")
        .eq("company_id", companyId)
    ),
    selectMaybe(
      supabase
        .from("employee_skills")
        .select("*")
        .eq("company_id", companyId)
    ),
    selectMaybe(
      supabase
        .from("performance_reviews")
        .select("*")
        .eq("company_id", companyId)
    ),
  ]);

  return {
    employees,
    rosters,
    clockEvents,
    leaveRequests,
    hrCases,
    hearingCases,
    hrWarnings,
    employeeNotes,
    timeline,
    employeeDocuments,
    generatedDocuments,
    aiGenerations,
    skills,
    performanceReviews,
  };
}

function buildEmployeeIntelligence(
  companyId: string,
  dataset: LoadedDataset,
): EmployeeIntelligence[] {
  const now = new Date();

  const wf = calculateWorkforceIntelligence(
    companyId,
    dataset.employees,
    dataset.clockEvents,
    dataset.rosters,
    dataset.leaveRequests,
    dataset.hrCases,
    dataset.hrWarnings,
    [],
    []
  );

  const workforceByEmployee = new Map(
    (wf.workforceHealth || []).map((row) => [asText(row.employeeId), row])
  );

  const byEmployeeId = <T extends GenericRow>(rows: T[], key = "employee_id") => {
    const map = new Map<string, T[]>();
    for (const row of rows) {
      const id = asText(row[key]);
      if (!id) continue;
      if (!map.has(id)) map.set(id, []);
      map.get(id)!.push(row);
    }
    return map;
  };

  const casesByEmployee = byEmployeeId(dataset.hrCases);
  const hearingsByEmployee = byEmployeeId(dataset.hearingCases);
  const warningsByEmployee = byEmployeeId(dataset.hrWarnings);
  const notesByEmployee = byEmployeeId(dataset.employeeNotes);
  const timelineByEmployee = byEmployeeId(dataset.timeline);
  const docsByEmployee = byEmployeeId(dataset.employeeDocuments);
  const generatedByEmployee = byEmployeeId(dataset.generatedDocuments);
  const aiDocsByEmployee = byEmployeeId(dataset.aiGenerations, "employee_id");
  const skillsByEmployee = byEmployeeId(dataset.skills);
  const performanceByEmployee = byEmployeeId(dataset.performanceReviews);

  const policyFallback = {
    warningExpiryDays: { verbal: 90, written: 180, finalWritten: 365 },
    counsellingBeforeWarning: false,
    hearingAfterFinalWarning: true,
    appealResetEnabled: true,
    repeatOffenceWindowDays: 365,
    escalationThresholds: { verbalToWrittenCount: 1, writtenToFinalCount: 1, finalToHearingCount: 1 },
    similarOffenceGroups: {
      attendance: ["late_coming", "absenteeism", "timekeeping", "unauthorised_absence"],
      misconduct: ["insubordination", "harassment", "abuse", "theft", "fraud"],
      performance: ["poor_performance", "negligence", "quality_issue"],
      safety: ["safety_violation", "ppe_non_compliance", "dangerous_act"],
    },
    dismissalRules: {
      requireHearingOutcomeCodes: ["guilty_major", "gross_misconduct_confirmed"],
      minFinalWarningsInWindow: 1,
      minSuspensionsInWindow: 1,
    },
  };

  const employees = (dataset.employees || []).map((employee) => {
    const employeeId = asText(employee.id);
    const employeeCases = casesByEmployee.get(employeeId) || [];
    const employeeHearings = hearingsByEmployee.get(employeeId) || [];
    const employeeWarnings = warningsByEmployee.get(employeeId) || [];
    const employeeNotes = notesByEmployee.get(employeeId) || [];
    const employeeTimeline = timelineByEmployee.get(employeeId) || [];
    const employeeDocs = docsByEmployee.get(employeeId) || [];
    const employeeGenerated = generatedByEmployee.get(employeeId) || [];
    const employeeAiGenerated = aiDocsByEmployee.get(employeeId) || [];
    const employeeSkills = skillsByEmployee.get(employeeId) || [];
    const employeePerformance = performanceByEmployee.get(employeeId) || [];

    const activeCases = employeeCases.filter((row) => isActiveCaseStatus(lower(row.status))).length;
    const activeHearings = employeeHearings.filter((row) => isActiveHearingStatus(lower(row.hearing_status || row.status))).length;

    const activeWarnings = employeeWarnings.filter((row) => {
      const expiry = asDate(row.expiry_date);
      if (expiry && expiry.getTime() < now.getTime()) return false;
      return isActiveWarningStatus(lower(row.status));
    }).length;

    const expiredWarnings = employeeWarnings.filter((row) => {
      const expiry = asDate(row.expiry_date);
      return lower(row.status) === "expired" || (expiry ? expiry.getTime() < now.getTime() : false);
    }).length;

    const allContractDocs = [
      ...employeeDocs.filter(looksLikeContract),
      ...employeeGenerated.filter(looksLikeContract),
    ];
    const contractExpiry = latestDate(allContractDocs, ["expiry_date", "review_date"]);
    const signedContract = allContractDocs.some((row) => {
      const signatureStatus = lower(row.signature_status || row.signed_status);
      return signatureStatus === "signed" || Boolean(asDate(row.signed_at));
    });

    let contractStatus: StatusLevel = "missing";
    if (allContractDocs.length) {
      if (contractExpiry && contractExpiry.getTime() < now.getTime()) contractStatus = "expired";
      else if (contractExpiry && daysBetween(contractExpiry, now) <= 30) contractStatus = "expiring";
      else if (signedContract) contractStatus = "active";
      else contractStatus = "unsigned";
    }

    const qualificationDocs = employeeDocs.filter(looksLikeQualification);
    const hasSkills = employeeSkills.length > 0;
    const skillsExpired = employeeSkills.some((row) => {
      const status = lower(row.status);
      const expiry = asDate(row.expiry_date || row.valid_until || row.renewal_due_at);
      return status === "expired" || (expiry ? expiry.getTime() < now.getTime() : false);
    });
    let qualificationStatus: StatusLevel = "missing";
    if (hasSkills || qualificationDocs.length) {
      qualificationStatus = skillsExpired ? "expired" : "valid";
    }

    const medicalDocs = employeeDocs.filter(looksLikeMedical);
    const medicalExpiry = latestDate(medicalDocs, ["expiry_date"]);
    let medicalCertificateStatus: StatusLevel = "missing";
    if (medicalDocs.length) {
      if (medicalExpiry && medicalExpiry.getTime() < now.getTime()) medicalCertificateStatus = "expired";
      else if (medicalExpiry && daysBetween(medicalExpiry, now) <= 30) medicalCertificateStatus = "expiring";
      else medicalCertificateStatus = "valid";
    }

    const performanceDocs = employeeDocs.filter(looksLikePerformance);
    const perfLatest = latestDate([...employeePerformance, ...performanceDocs], ["review_date", "created_at", "issue_date"]);
    let performanceStatus: StatusLevel = "missing";
    if (perfLatest) {
      performanceStatus = daysBetween(now, perfLatest) > 365 ? "overdue" : "active";
    }

    const hasAnyHrDocs = employeeDocs.length + employeeGenerated.length + employeeAiGenerated.length > 0;
    const requirements = [
      contractStatus !== "missing",
      qualificationStatus !== "missing",
      medicalCertificateStatus !== "missing",
      performanceStatus !== "missing",
      hasAnyHrDocs,
    ];
    const documentationCompleteness = Math.round((requirements.filter(Boolean).length / requirements.length) * 100);

    const wfHealth = workforceByEmployee.get(employeeId);
    const attendanceScore = asNumber(wfHealth?.attendance, 50);

    const disciplineRecommendation = evaluateDiscipline(
      policyFallback as any,
      {
        companyId,
        employeeId,
        evaluationDateIso: now.toISOString(),
        triggerType: "batch9_intelligence",
        triggerIncidentType: asText(employeeCases[0]?.category || employeeWarnings[0]?.incident_type),
      },
      {
        warnings: employeeWarnings,
        hearings: employeeHearings,
        hrCases: employeeCases,
        notes: employeeNotes,
        progression: null,
      }
    );

    const disciplineRisk = disciplineRecommendation.riskLevel as RiskLevel;
    const attendanceRisk = riskFromScore(attendanceScore);
    const complianceInputs = [
      qualificationStatus === "expired" || qualificationStatus === "missing" ? 35 : 0,
      medicalCertificateStatus === "expired" || medicalCertificateStatus === "missing" ? 35 : 0,
      contractStatus === "expired" || contractStatus === "missing" ? 30 : 0,
    ];
    const complianceRiskScore = 100 - clamp(complianceInputs.reduce((sum, v) => sum + v, 0), 0, 100);
    const complianceRisk = riskFromScore(complianceRiskScore);

    const healthScore = clamp(
      Math.round(
        attendanceScore * 0.25 +
          asNumber(wfHealth?.overall, 50) * 0.35 +
          complianceRiskScore * 0.2 +
          documentationCompleteness * 0.2
      ),
      0,
      100
    );

    const outstandingDocuments: string[] = [];
    if (contractStatus === "missing" || contractStatus === "expired" || contractStatus === "unsigned") {
      outstandingDocuments.push("Contract");
    }
    if (qualificationStatus === "missing" || qualificationStatus === "expired") {
      outstandingDocuments.push("Qualification");
    }
    if (medicalCertificateStatus === "missing" || medicalCertificateStatus === "expired") {
      outstandingDocuments.push("Medical Certificate");
    }
    if (performanceStatus === "missing" || performanceStatus === "overdue") {
      outstandingDocuments.push("Performance Review");
    }

    const overdueHearings = employeeHearings.filter((row) => {
      const status = lower(row.hearing_status || row.status);
      if (!isActiveHearingStatus(status)) return false;
      const scheduled = asDate(row.scheduled_at || row.hearing_date);
      return Boolean(scheduled && scheduled.getTime() < now.getTime());
    }).length;

    const openActions = activeCases + overdueHearings + outstandingDocuments.length;

    return {
      employeeId,
      employeeName: getEmployeeName(employee),
      department: getEmployeeDepartment(employee),
      manager: asText(employee.manager_email) || asText(employeeCases[0]?.manager_email) || "Unassigned",
      employeeHealthScore: healthScore,
      attendanceRisk,
      disciplineRisk,
      complianceRisk,
      documentationCompleteness,
      contractStatus,
      qualificationStatus,
      medicalCertificateStatus,
      performanceStatus,
      activeCases,
      activeHearings,
      activeWarnings,
      expiredWarnings,
      openActions,
      outstandingDocuments,
    };
  });

  return employees;
}

function buildDepartmentIntelligence(employees: EmployeeIntelligence[]): DepartmentIntelligence[] {
  const grouped = new Map<string, EmployeeIntelligence[]>();
  for (const employee of employees) {
    if (!grouped.has(employee.department)) grouped.set(employee.department, []);
    grouped.get(employee.department)!.push(employee);
  }

  return Array.from(grouped.entries())
    .map(([department, rows]) => ({
      department,
      employeeCount: rows.length,
      averageHealthScore: average(rows.map((row) => row.employeeHealthScore)),
      highRiskEmployees: rows.filter((row) => row.employeeHealthScore < 60).length,
      activeCases: rows.reduce((sum, row) => sum + row.activeCases, 0),
      activeHearings: rows.reduce((sum, row) => sum + row.activeHearings, 0),
      activeWarnings: rows.reduce((sum, row) => sum + row.activeWarnings, 0),
      documentationCompletenessAvg: average(rows.map((row) => row.documentationCompleteness)),
      disciplinaryActivity: rows.reduce((sum, row) => sum + row.activeCases + row.activeWarnings + row.activeHearings, 0),
    }))
    .sort((a, b) => b.disciplinaryActivity - a.disciplinaryActivity);
}

function buildManagerIntelligence(employees: EmployeeIntelligence[]): ManagerIntelligence[] {
  const grouped = new Map<string, EmployeeIntelligence[]>();
  for (const employee of employees) {
    const manager = employee.manager || "Unassigned";
    if (!grouped.has(manager)) grouped.set(manager, []);
    grouped.get(manager)!.push(employee);
  }

  return Array.from(grouped.entries())
    .map(([manager, rows]) => {
      const openActions = rows.reduce((sum, row) => sum + row.openActions, 0);
      const highRiskEmployees = rows.filter((row) => row.employeeHealthScore < 60).length;
      const workloadScore = 100 - clamp(openActions * 3 + highRiskEmployees * 10, 0, 100);
      return {
        manager,
        employeeCount: rows.length,
        averageHealthScore: average(rows.map((row) => row.employeeHealthScore)),
        activeCases: rows.reduce((sum, row) => sum + row.activeCases, 0),
        activeHearings: rows.reduce((sum, row) => sum + row.activeHearings, 0),
        openActions,
        highRiskEmployees,
        workloadRisk: riskFromScore(workloadScore),
      };
    })
    .sort((a, b) => b.openActions - a.openActions);
}

function buildWorkforceRisks(
  employees: EmployeeIntelligence[],
  hearings: GenericRow[],
  warnings: GenericRow[],
  leaveRequests: GenericRow[],
  departments: DepartmentIntelligence[],
  managers: ManagerIntelligence[]
): WorkforceRisk {
  const now = new Date();
  const employeeMap = new Map(employees.map((row) => [row.employeeId, row]));

  const highRiskEmployees = employees
    .filter(
      (row) =>
        row.employeeHealthScore < 55 ||
        ["high", "critical"].includes(row.attendanceRisk) ||
        ["high", "critical"].includes(row.disciplineRisk)
    )
    .map((row) => ({ employeeId: row.employeeId, employeeName: row.employeeName, employeeHealthScore: row.employeeHealthScore }));

  const hearingOverdue = hearings
    .filter((row) => {
      const status = lower(row.hearing_status || row.status);
      const scheduled = asDate(row.scheduled_at || row.hearing_date);
      return isActiveHearingStatus(status) && Boolean(scheduled && scheduled.getTime() < now.getTime());
    })
    .map((row) => {
      const scheduled = asDate(row.scheduled_at || row.hearing_date) || now;
      const employeeId = asText(row.employee_id);
      return {
        hearingId: asText(row.id),
        employeeId,
        employeeName: employeeMap.get(employeeId)?.employeeName || employeeId || "Unknown",
        daysOverdue: Math.max(1, daysBetween(now, scheduled)),
      };
    })
    .sort((a, b) => b.daysOverdue - a.daysOverdue);

  const expiringContracts = employees
    .filter((row) => row.contractStatus === "expiring")
    .map((row) => ({ employeeId: row.employeeId, employeeName: row.employeeName, daysToExpiry: 30 }));

  const missingDocuments = employees
    .filter((row) => row.outstandingDocuments.length > 0)
    .map((row) => ({ employeeId: row.employeeId, employeeName: row.employeeName, missing: row.outstandingDocuments }));

  const missingQualifications = employees
    .filter((row) => row.qualificationStatus === "missing" || row.qualificationStatus === "expired")
    .map((row) => ({ employeeId: row.employeeId, employeeName: row.employeeName, status: row.qualificationStatus }));

  const expiredMedicals = employees
    .filter((row) => row.medicalCertificateStatus === "expired")
    .map((row) => ({ employeeId: row.employeeId, employeeName: row.employeeName, daysExpired: 1 }));

  const repeatMisconductMap = new Map<string, number>();
  for (const warning of warnings) {
    const incident = lower(warning.incident_type);
    if (!incident || !["misconduct", "insubordination", "theft", "fraud", "harassment", "abuse"].some((k) => incident.includes(k))) {
      continue;
    }
    const id = asText(warning.employee_id);
    repeatMisconductMap.set(id, (repeatMisconductMap.get(id) || 0) + 1);
  }
  const repeatMisconduct = Array.from(repeatMisconductMap.entries())
    .filter(([, incidents]) => incidents >= 2)
    .map(([employeeId, incidents]) => ({ employeeId, incidents, employeeName: employeeMap.get(employeeId)?.employeeName || employeeId }));

  const repeatAbsenceMap = new Map<string, number>();
  for (const leave of leaveRequests) {
    const status = lower(leave.status);
    const leaveType = lower(leave.leave_type);
    if (!["approved", "pending", "submitted"].includes(status)) continue;
    if (!leaveType || !(leaveType.includes("sick") || leaveType.includes("absence") || leaveType.includes("unpaid"))) continue;
    const id = asText(leave.employee_id);
    repeatAbsenceMap.set(id, (repeatAbsenceMap.get(id) || 0) + 1);
  }
  const repeatAbsenteeism = Array.from(repeatAbsenceMap.entries())
    .filter(([, incidents]) => incidents >= 3)
    .map(([employeeId, incidents]) => ({ employeeId, incidents, employeeName: employeeMap.get(employeeId)?.employeeName || employeeId }));

  const highManagerWorkload = managers
    .filter((row) => row.openActions >= 12 || row.highRiskEmployees >= 3)
    .map((row) => ({ manager: row.manager, openActions: row.openActions, highRiskEmployees: row.highRiskEmployees }));

  const topDisciplinaryDepartments = departments
    .filter((row) => row.disciplinaryActivity > 0)
    .slice(0, 10)
    .map((row) => ({ department: row.department, activityCount: row.disciplinaryActivity }));

  return {
    highRiskEmployees,
    hearingOverdue,
    expiringContracts,
    missingDocuments,
    missingQualifications,
    expiredMedicals,
    repeatMisconduct,
    repeatAbsenteeism,
    highManagerWorkload,
    topDisciplinaryDepartments,
  };
}

function buildRecommendations(
  employees: EmployeeIntelligence[],
  risks: WorkforceRisk,
  departments: DepartmentIntelligence[]
): WorkforceRecommendation[] {
  const recommendations: WorkforceRecommendation[] = [];

  for (const item of risks.hearingOverdue.slice(0, 20)) {
    recommendations.push({
      id: `hearing_overdue_${item.hearingId}`,
      category: "hearing_overdue",
      priority: item.daysOverdue >= 7 ? "critical" : "high",
      title: "Hearing overdue",
      description: `${item.employeeName} has a hearing overdue by ${item.daysOverdue} day(s).`,
      employeeId: item.employeeId,
      department: null,
      manager: null,
      recommendedDecision: "Schedule and complete the hearing within 48 hours.",
      alternativeDecision: "Escalate to HR operations lead for immediate re-assignment.",
      expectedOutcome: "Reduce compliance risk and close disciplinary backlog.",
      confidence: 95,
    });
  }

  for (const item of risks.expiringContracts.slice(0, 20)) {
    recommendations.push({
      id: `contract_expiry_${item.employeeId}`,
      category: "contract_expiry",
      priority: "high",
      title: "Contract expires in 30 days",
      description: `${item.employeeName} requires a renewal workflow before contract expiry.`,
      employeeId: item.employeeId,
      department: null,
      manager: null,
      recommendedDecision: "Prepare renewal pack and assign approval owner now.",
      alternativeDecision: "Flag for HR review if renewal not intended.",
      expectedOutcome: "Avoid contract lapse and staffing disruption.",
      confidence: 92,
    });
  }

  for (const item of risks.missingQualifications.slice(0, 20)) {
    recommendations.push({
      id: `missing_qualification_${item.employeeId}`,
      category: "missing_qualification",
      priority: item.status === "expired" ? "high" : "medium",
      title: "Employee missing mandatory qualification",
      description: `${item.employeeName} has ${item.status} qualification records.`,
      employeeId: item.employeeId,
      department: null,
      manager: null,
      recommendedDecision: "Request valid qualification proof and update employee file.",
      alternativeDecision: "Temporarily reassign high-compliance duties.",
      expectedOutcome: "Restore role compliance and reduce audit exposure.",
      confidence: 90,
    });
  }

  for (const employee of employees.filter((row) => row.activeWarnings > 0 && row.expiredWarnings > 0).slice(0, 20)) {
    recommendations.push({
      id: `final_warning_expiry_${employee.employeeId}`,
      category: "final_warning_expiry",
      priority: "medium",
      title: "Final warning expires soon",
      description: `${employee.employeeName} has warning lifecycle requiring HR review.`,
      employeeId: employee.employeeId,
      department: employee.department,
      manager: employee.manager,
      recommendedDecision: "Review disciplinary timeline and confirm next action.",
      alternativeDecision: "Maintain monitoring with documented checkpoint.",
      expectedOutcome: "Preserve progressive discipline consistency.",
      confidence: 84,
    });
  }

  for (const employee of employees.filter((row) => row.openActions >= 4 || row.employeeHealthScore < 45).slice(0, 20)) {
    recommendations.push({
      id: `hr_review_${employee.employeeId}`,
      category: "hr_review",
      priority: employee.employeeHealthScore < 40 ? "critical" : "high",
      title: "Employee requires HR review",
      description: `${employee.employeeName} has elevated open actions and risk indicators.`,
      employeeId: employee.employeeId,
      department: employee.department,
      manager: employee.manager,
      recommendedDecision: "Create HR intervention case with owner and due date.",
      alternativeDecision: "Escalate manager coaching and monitor weekly.",
      expectedOutcome: "Lower disciplinary escalation and improve workforce health.",
      confidence: 88,
    });
  }

  for (const item of risks.repeatMisconduct.slice(0, 20)) {
    const employee = employees.find((row) => row.employeeId === item.employeeId);
    recommendations.push({
      id: `repeat_misconduct_${item.employeeId}`,
      category: "repeat_misconduct",
      priority: "high",
      title: "Employee has repeated misconduct",
      description: `${item.employeeName} has ${item.incidents} misconduct incidents in active records.`,
      employeeId: item.employeeId,
      department: employee?.department || null,
      manager: employee?.manager || null,
      recommendedDecision: "Apply progressive discipline checkpoint and hearing readiness.",
      alternativeDecision: "Issue final counselling with documented commitments.",
      expectedOutcome: "Reduce repeat incidents and legal exposure.",
      confidence: 89,
    });
  }

  for (const department of departments.filter((row) => row.disciplinaryActivity >= 8).slice(0, 10)) {
    recommendations.push({
      id: `department_intervention_${department.department.toLowerCase().replace(/[^a-z0-9]+/g, "_")}`,
      category: "department_intervention",
      priority: department.highRiskEmployees >= 3 ? "high" : "medium",
      title: "Department requires intervention",
      description: `${department.department} shows elevated disciplinary activity and workforce risk.`,
      employeeId: null,
      department: department.department,
      manager: null,
      recommendedDecision: "Run manager intervention plan and compliance review in this department.",
      alternativeDecision: "Increase HR oversight and weekly corrective checkpoints.",
      expectedOutcome: "Reduce cases backlog and improve department stability.",
      confidence: 86,
    });
  }

  return recommendations
    .sort((a, b) => {
      const order = { critical: 4, high: 3, medium: 2, low: 1 };
      return order[b.priority] - order[a.priority];
    })
    .slice(0, 200);
}

function buildSummary(
  employees: EmployeeIntelligence[],
  departments: DepartmentIntelligence[],
  risks: WorkforceRisk,
  recommendations: WorkforceRecommendation[]
): ExecutiveWorkforceSummary {
  const topRiskDepartments = departments
    .map((row) => ({
      department: row.department,
      riskScore: clamp(Math.round((100 - row.averageHealthScore) * 0.6 + row.disciplinaryActivity * 2), 0, 100),
    }))
    .sort((a, b) => b.riskScore - a.riskScore)
    .slice(0, 10);

  return {
    employeeCount: employees.length,
    averageEmployeeHealthScore: average(employees.map((row) => row.employeeHealthScore)),
    highRiskEmployeeCount: risks.highRiskEmployees.length,
    hearingOverdueCount: risks.hearingOverdue.length,
    expiringContractCount: risks.expiringContracts.length,
    missingDocumentCount: risks.missingDocuments.length,
    recommendationsCount: recommendations.length,
    topRiskDepartments,
    computedAtIso: new Date().toISOString(),
  };
}

export async function computeExecutiveWorkforceIntelligence(
  supabase: SupabaseClient,
  companyId: string
): Promise<ExecutiveWorkforceIntelligenceResult> {
  const dataset = await loadDataset(supabase, companyId);
  const employees = buildEmployeeIntelligence(companyId, dataset);
  const departments = buildDepartmentIntelligence(employees);
  const managers = buildManagerIntelligence(employees);
  const risks = buildWorkforceRisks(
    employees,
    dataset.hearingCases,
    dataset.hrWarnings,
    dataset.leaveRequests,
    departments,
    managers
  );
  const recommendations = buildRecommendations(employees, risks, departments);
  const summary = buildSummary(employees, departments, risks, recommendations);

  return {
    companyId,
    summary,
    employees,
    departments,
    managers,
    risks,
    recommendations,
  };
}

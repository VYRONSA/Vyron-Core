/**
 * Insert shape for public.hr_warnings as it exists in production.
 *
 * The table requires employee_name, warning_type, incident_type, incident_date, issue_date,
 * expiry_date and description, and constrains warning_type / incident_type / status to fixed
 * lists. The screen uses shorter names (e.g. "verbal", "absenteeism"); they are mapped here.
 * Previously every insert failed because required columns were missing and "verbal" is not
 * an allowed warning type.
 */

export type HrWarningInsert = {
  company_id: string;
  employee_id: string;
  employee_name: string;
  warning_type: string;
  incident_type: string;
  incident_date: string;
  issue_date: string;
  expiry_date: string;
  severity: string;
  description: string;
  manager_notes: string | null;
  status: string;
};

const WARNING_TYPES: Record<string, string> = {
  verbal: "verbal_warning",
  verbal_warning: "verbal_warning",
  written: "written_warning",
  written_warning: "written_warning",
  final_written: "final_written_warning",
  final_written_warning: "final_written_warning",
};

const INCIDENT_TYPES: Record<string, string> = {
  attendance: "attendance",
  late_coming: "late_coming",
  clocking: "clocking",
  misconduct: "misconduct",
  insubordination: "misconduct",
  performance: "performance",
  poor_performance: "performance",
  absence: "absence",
  absenteeism: "absence",
  sick_leave: "sick_leave",
  other: "other",
};

const STATUSES = new Set(["active", "expired", "cancelled", "withdrawn", "closed"]);
const SEVERITIES = new Set(["low", "medium", "high", "critical"]);

/** Warning type as stored → the screen's short form ("verbal_warning" → "verbal"). */
export function warningTypeFromDb(value: string | null | undefined): string {
  return String(value || "").replace(/_warning$/, "");
}

function todayIso(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Africa/Johannesburg" });
}

function addMonths(isoDate: string, months: number): string {
  const date = new Date(`${isoDate}T00:00:00Z`);
  date.setUTCMonth(date.getUTCMonth() + months);
  return date.toISOString().slice(0, 10);
}

export function buildHrWarningInsert(input: {
  companyId: string;
  employeeId: string;
  warningType: string;
  description: string;
  status: string;
  expiryDate?: string | null;
  employeeName?: string;
  incidentType?: string;
  incidentDate?: string;
  issueDate?: string;
  severity?: string;
  managerNotes?: string | null;
}): HrWarningInsert {
  const warningType = WARNING_TYPES[input.warningType];
  if (!warningType) throw new Error(`Unknown warning type: ${input.warningType}`);

  const issueDate = input.issueDate || todayIso();
  // Expiry is required by the table; default to six months after issue when not given.
  const expiryDate = input.expiryDate || addMonths(issueDate, 6);
  // "expiring_soon" is a display state, not a stored one.
  const status = STATUSES.has(input.status) ? input.status : "active";

  return {
    company_id: input.companyId,
    employee_id: input.employeeId,
    employee_name: (input.employeeName || "").trim() || "Employee",
    warning_type: warningType,
    incident_type: INCIDENT_TYPES[input.incidentType || "other"] || "other",
    incident_date: input.incidentDate || issueDate,
    issue_date: issueDate,
    expiry_date: expiryDate < issueDate ? issueDate : expiryDate,
    severity: SEVERITIES.has(input.severity || "") ? (input.severity as string) : "medium",
    description: input.description.trim(),
    manager_notes: input.managerNotes?.trim() || null,
    status,
  };
}

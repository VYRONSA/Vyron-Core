/** Production hr_warnings columns (live DB on ldnrmgafsquzfitcuvxq). */

export type HrWarningInsert = {
  company_id: string;
  employee_id: string;
  warning_type: string;
  description: string;
  status: string;
  expiry_date?: string | null;
};

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
  const parts = [
    input.employeeName ? `[${input.employeeName}]` : null,
    input.incidentType ? `Incident: ${input.incidentType.replaceAll("_", " ")}` : null,
    input.incidentDate ? `Incident date: ${input.incidentDate}` : null,
    input.issueDate ? `Issue date: ${input.issueDate}` : null,
    input.severity ? `Severity: ${input.severity}` : null,
    input.description.trim(),
    input.managerNotes?.trim() ? `Manager notes: ${input.managerNotes.trim()}` : null,
  ].filter(Boolean);

  return {
    company_id: input.companyId,
    employee_id: input.employeeId,
    warning_type: input.warningType,
    description: parts.join(" · "),
    status: input.status,
    expiry_date: input.expiryDate || null,
  };
}

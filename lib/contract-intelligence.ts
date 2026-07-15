import PizZip from "pizzip";
import Docxtemplater from "docxtemplater";
import type { SupabaseClient } from "@supabase/supabase-js";

export const CONTRACT_TEMPLATE_BUCKET = "hr-contract-templates";
export const CONTRACT_OUTPUT_BUCKET = "hr-signed-documents";
export const CONTRACT_DOCX_MIME =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

export type PlaceholderRegistryRow = {
  placeholder_key: string;
  label: string;
  source_type: string;
  source_field: string | null;
  required: boolean;
  questionnaire_field: string | null;
};

export type MergeValidationError = {
  code: string;
  placeholder?: string;
  message: string;
};

export type MergeValidationResult = {
  ok: boolean;
  placeholders: string[];
  missingRequired: string[];
  missingQuestionnaireFields: string[];
  unknownPlaceholders: string[];
  errors: MergeValidationError[];
  mergeValues: Record<string, string>;
  mergeSnapshot: Record<string, unknown>;
};

function asText(value: unknown): string {
  return String(value ?? "").trim();
}

function asLower(value: unknown): string {
  return asText(value).toLowerCase();
}

function pickFirst(row: Record<string, unknown> | null | undefined, keys: string[]): string {
  if (!row) return "";
  for (const key of keys) {
    const value = row[key];
    if (value !== undefined && value !== null && String(value).trim()) {
      return String(value).trim();
    }
  }
  return "";
}

export function cleanFileName(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)+/g, "")
    .slice(0, 90);
}

export function normaliseTemplateKey(templateName: string, templateCategory: string): string {
  const base = `${templateName}_${templateCategory}`;
  return base
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 120);
}

export async function loadContractPlaceholderRegistry(
  supabase: SupabaseClient,
  companyId: string
): Promise<PlaceholderRegistryRow[]> {
  const { data, error } = await supabase
    .from("contract_placeholder_registry")
    .select("placeholder_key,label,source_type,source_field,required,questionnaire_field,company_id")
    .eq("active", true)
    .or(`company_id.is.null,company_id.eq.${companyId}`)
    .order("company_id", { ascending: true });

  if (error) {
    throw new Error("Could not load contract placeholder registry.");
  }

  const bestByKey = new Map<string, PlaceholderRegistryRow>();
  (data || []).forEach((row: any) => {
    const key = asText(row.placeholder_key);
    if (!key) return;

    const existing = bestByKey.get(key);
    // Prefer company-specific records over global defaults.
    if (existing && !row.company_id) return;

    bestByKey.set(key, {
      placeholder_key: key,
      label: asText(row.label) || key,
      source_type: asText(row.source_type) || "employee",
      source_field: row.source_field ? asText(row.source_field) : null,
      required: Boolean(row.required),
      questionnaire_field: row.questionnaire_field ? asText(row.questionnaire_field) : null,
    });
  });

  return Array.from(bestByKey.values());
}

export function extractDocxPlaceholders(docxBuffer: Buffer): string[] {
  const zip = new PizZip(docxBuffer);
  const files = Object.keys(zip.files || {}).filter((name) => name.startsWith("word/") && name.endsWith(".xml"));
  const found = new Set<string>();

  const regex = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;

  for (const file of files) {
    const content = zip.file(file)?.asText() || "";
    regex.lastIndex = 0;
    let match: RegExpExecArray | null = regex.exec(content);
    while (match) {
      found.add(String(match[1] || "").trim());
      match = regex.exec(content);
    }
  }

  return Array.from(found.values()).sort();
}

export async function renderDocxTemplate(
  templateBuffer: Buffer,
  mergeValues: Record<string, string>
): Promise<Buffer> {
  const zip = new PizZip(templateBuffer);

  const doc = new Docxtemplater(zip, {
    paragraphLoop: true,
    linebreaks: true,
    delimiters: {
      start: "{{",
      end: "}}",
    },
  });

  doc.render(mergeValues);

  return doc.getZip().generate({
    type: "nodebuffer",
    compression: "DEFLATE",
  }) as Buffer;
}

export async function assertTemplateOwnershipById(
  supabase: SupabaseClient,
  companyId: string,
  templateId: string
): Promise<any> {
  const { data, error } = await supabase
    .from("contract_templates")
    .select("id,company_id,template_name,template_category,status,archived,file_bucket,file_path,active_version_number,template_key")
    .eq("id", templateId)
    .eq("company_id", companyId)
    .maybeSingle();

  if (error) {
    throw new Error("Could not verify template ownership.");
  }

  if (!data) {
    throw new Error("Template not found in this company workspace.");
  }

  if (data.archived) {
    throw new Error("Template is archived and cannot be used.");
  }

  return data;
}

export async function resolveTemplateVersion(
  supabase: SupabaseClient,
  companyId: string,
  templateId: string,
  templateVersionId?: string | null
): Promise<any> {
  if (templateVersionId) {
    const { data, error } = await supabase
      .from("contract_template_versions")
      .select("id,company_id,template_id,version_number,file_bucket,file_path,is_active,status,placeholder_schema,questionnaire_schema")
      .eq("id", templateVersionId)
      .eq("company_id", companyId)
      .eq("template_id", templateId)
      .maybeSingle();

    if (error) throw new Error("Could not load selected template version.");
    if (!data) throw new Error("Template version not found for this company.");
    return data;
  }

  const { data, error } = await supabase
    .from("contract_template_versions")
    .select("id,company_id,template_id,version_number,file_bucket,file_path,is_active,status,placeholder_schema,questionnaire_schema")
    .eq("company_id", companyId)
    .eq("template_id", templateId)
    .eq("is_active", true)
    .maybeSingle();

  if (error) throw new Error("Could not load active template version.");
  if (!data) throw new Error("No active template version found.");
  return data;
}

export function buildDefaultMergeValues(
  employeeRow: Record<string, unknown> | null,
  companyRow: Record<string, unknown> | null
): Record<string, string> {
  return {
    EmployeeName: pickFirst(employeeRow, ["name", "first_name", "given_name"]),
    EmployeeSurname: pickFirst(employeeRow, ["surname", "last_name", "family_name"]),
    EmployeeNumber: pickFirst(employeeRow, ["employee_number", "staff_number", "employee_code"]),
    Position: pickFirst(employeeRow, ["position", "job_title", "role", "designation"]),
    Department: pickFirst(employeeRow, ["department", "department_name"]),
    Branch: pickFirst(employeeRow, ["branch", "branch_name", "store_name"]),
    Manager: pickFirst(employeeRow, ["manager_name", "manager", "reports_to"]),
    StartDate: pickFirst(employeeRow, ["start_date", "employment_start_date", "hire_date"]),
    Probation: pickFirst(employeeRow, ["probation", "probation_period"]),
    Salary: pickFirst(employeeRow, ["salary", "basic_salary", "monthly_salary"]),
    HourlyRate: pickFirst(employeeRow, ["hourly_rate"]),
    DailyRate: pickFirst(employeeRow, ["daily_rate"]),
    WorkingHours: pickFirst(employeeRow, ["working_hours", "work_hours"]),
    LeaveCycle: pickFirst(employeeRow, ["leave_cycle"]),
    BankingDetails: pickFirst(employeeRow, ["banking_details", "bank_details"]),
    EmergencyContact: pickFirst(employeeRow, ["emergency_contact", "next_of_kin_contact"]),
    Benefits: pickFirst(employeeRow, ["benefits"]),
    Allowances: pickFirst(employeeRow, ["allowances"]),
    CompanyName: pickFirst(companyRow, ["name", "company_name"]),
    CompanyRegistration: pickFirst(companyRow, ["registration_number", "company_registration"]),
    CompanyAddress: pickFirst(companyRow, ["address", "physical_address"]),
  };
}

function toStringMap(values: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  Object.entries(values || {}).forEach(([key, value]) => {
    out[key] = value === null || value === undefined ? "" : String(value);
  });
  return out;
}

export function validateMergeInput(params: {
  placeholdersInTemplate: string[];
  registry: PlaceholderRegistryRow[];
  defaultValues: Record<string, string>;
  inputValues?: Record<string, unknown>;
}): MergeValidationResult {
  const placeholders = params.placeholdersInTemplate || [];
  const registry = params.registry || [];
  const defaultValues = params.defaultValues || {};
  const inputValues = toStringMap(params.inputValues || {});

  const registryByKey = new Map<string, PlaceholderRegistryRow>();
  registry.forEach((row) => {
    registryByKey.set(row.placeholder_key, row);
  });

  const mergeValues: Record<string, string> = {};
  const missingRequired: string[] = [];
  const missingQuestionnaireFields: string[] = [];
  const unknownPlaceholders: string[] = [];
  const errors: MergeValidationError[] = [];

  placeholders.forEach((placeholder) => {
    const reg = registryByKey.get(placeholder);
    const value = asText(inputValues[placeholder] || defaultValues[placeholder] || "");
    mergeValues[placeholder] = value;

    if (!reg) {
      unknownPlaceholders.push(placeholder);
      errors.push({
        code: "UNKNOWN_PLACEHOLDER",
        placeholder,
        message: `Placeholder {{${placeholder}}} is not registered.`,
      });
      return;
    }

    if (reg.required && !value) {
      missingRequired.push(placeholder);
      if (reg.questionnaire_field) {
        missingQuestionnaireFields.push(reg.questionnaire_field);
      }
      errors.push({
        code: "MISSING_REQUIRED_VALUE",
        placeholder,
        message: `Required placeholder {{${placeholder}}} has no value.`,
      });
    }
  });

  const mergeSnapshot = {
    placeholders,
    registryVersion: registry.map((row) => ({
      placeholder_key: row.placeholder_key,
      required: row.required,
      source_type: row.source_type,
      source_field: row.source_field,
      questionnaire_field: row.questionnaire_field,
    })),
    defaultsUsed: Object.keys(defaultValues).filter((key) => asText(defaultValues[key])),
    submittedValues: Object.keys(inputValues).filter((key) => asText(inputValues[key])),
    validationTimestamp: new Date().toISOString(),
  };

  return {
    ok: errors.length === 0,
    placeholders,
    missingRequired: Array.from(new Set(missingRequired)),
    missingQuestionnaireFields: Array.from(new Set(missingQuestionnaireFields)),
    unknownPlaceholders,
    errors,
    mergeValues,
    mergeSnapshot,
  };
}

export async function fetchEmployeeAndCompanyData(
  supabase: SupabaseClient,
  companyId: string,
  employeeId: string
): Promise<{ employee: Record<string, unknown>; company: Record<string, unknown> }> {
  const [employeeRes, companyRes] = await Promise.all([
    supabase.from("employees").select("*").eq("id", employeeId).eq("company_id", companyId).maybeSingle(),
    supabase.from("companies").select("*").eq("id", companyId).maybeSingle(),
  ]);

  if (employeeRes.error) {
    throw new Error("Could not load employee data for merge validation.");
  }
  if (!employeeRes.data) {
    throw new Error("Employee not found in this company workspace.");
  }

  if (companyRes.error) {
    throw new Error("Could not load company data for merge validation.");
  }
  if (!companyRes.data) {
    throw new Error("Company not found.");
  }

  return {
    employee: employeeRes.data as Record<string, unknown>,
    company: companyRes.data as Record<string, unknown>,
  };
}

export function contractOutputPath(
  companyId: string,
  employeeId: string,
  templateId: string,
  fileLabel: string
): string {
  const stamp = Date.now();
  return `${companyId}/${employeeId}/${templateId}/${stamp}-${cleanFileName(fileLabel)}.docx`;
}

export function coerceTemplateCategory(value: unknown): string {
  const allowed = new Set([
    "permanent_employment",
    "fixed_term",
    "casual",
    "seasonal",
    "learnership",
    "internship",
    "contractor",
    "executive",
  ]);

  const normalized = asLower(value).replace(/[^a-z0-9]+/g, "_");
  if (!normalized) return "permanent_employment";
  if (allowed.has(normalized)) return normalized;
  return normalized;
}

/** CSV bulk staff import — columns align with Add Employee / employees table. */

export const STAFF_IMPORT_TEMPLATE_FILENAME = "vyron-staff-import-template.csv";

export const STAFF_IMPORT_HEADERS = [
  "first_name",
  "last_name",
  "email",
  "employee_number",
  "job_title",
  "store_branch",
  "employment_type",
  "phone",
] as const;

export type StaffImportHeader = (typeof STAFF_IMPORT_HEADERS)[number];

const EMPLOYMENT_TYPES = new Set(["permanent", "part_time", "casual", "fixed_term"]);

export type StaffImportPreparedRow = {
  rowNumber: number;
  payload: {
    company_id: string;
    employee_number: string | null;
    first_name: string;
    last_name: string;
    job_title: string | null;
    default_store_id: string | null;
    employment_type: string;
    phone: string | null;
    email: string | null;
    active: boolean;
  };
};

export type StaffImportRowError = {
  rowNumber: number;
  message: string;
};

export type StaffImportValidationResult = {
  prepared: StaffImportPreparedRow[];
  errors: StaffImportRowError[];
  skippedBlank: number;
};

function normalizeHeader(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_")
    .replace(/[^a-z0-9_]/g, "");
}

function escapeCsvCell(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

export function buildStaffImportTemplateCsv(): string {
  const header = STAFF_IMPORT_HEADERS.join(",");
  const examples = [
    [
      "Thandi",
      "Mokoena",
      "thandi@example.com",
      "EMP101",
      "Counter Assistant",
      "Main Store",
      "permanent",
      "0821234567",
    ],
    [
      "Jason",
      "Peters",
      "jason@example.com",
      "EMP102",
      "Sushi Chef",
      "Waterfront",
      "part_time",
      "0829876543",
    ],
  ];
  const lines = [header, ...examples.map((row) => row.map(escapeCsvCell).join(","))];
  return lines.join("\n");
}

/** Minimal RFC4180-style CSV parser (quoted fields, commas). */
export function parseCsvText(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];

    if (inQuotes) {
      if (ch === '"' && next === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        cell += ch;
      }
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || (ch === "\r" && next === "\n")) {
      row.push(cell);
      cell = "";
      if (row.some((c) => c.trim() !== "")) rows.push(row);
      row = [];
      if (ch === "\r") i++;
    } else if (ch !== "\r") {
      cell += ch;
    }
  }

  row.push(cell);
  if (row.some((c) => c.trim() !== "")) rows.push(row);

  return rows;
}

export function parseStaffImportCsv(text: string): Array<Record<StaffImportHeader, string>> {
  const matrix = parseCsvText(text.replace(/^\uFEFF/, ""));
  if (matrix.length === 0) return [];

  const headerCells = matrix[0].map(normalizeHeader);
  const records: Array<Record<StaffImportHeader, string>> = [];

  for (let r = 1; r < matrix.length; r++) {
    const line = matrix[r];
    const record = {} as Record<StaffImportHeader, string>;
    for (const key of STAFF_IMPORT_HEADERS) {
      const idx = headerCells.indexOf(key);
      record[key] = idx >= 0 ? (line[idx] ?? "").trim() : "";
    }
    records.push(record);
  }

  return records;
}

function isBlankImportRow(row: Record<StaffImportHeader, string>): boolean {
  return STAFF_IMPORT_HEADERS.every((key) => !row[key]?.trim());
}

function resolveStoreId(
  storeBranch: string,
  stores: Array<{ id: string; name: string }>
): string | null {
  const raw = storeBranch.trim();
  if (!raw) return null;

  const byId = stores.find((s) => s.id === raw);
  if (byId) return byId.id;

  const lower = raw.toLowerCase();
  const byName = stores.find((s) => s.name.trim().toLowerCase() === lower);
  return byName?.id ?? null;
}

function normalizeEmploymentType(value: string): string {
  const raw = value.trim().toLowerCase().replace(/\s+/g, "_").replace(/-/g, "_");
  if (!raw) return "permanent";
  if (EMPLOYMENT_TYPES.has(raw)) return raw;
  if (raw === "parttime" || raw === "part") return "part_time";
  if (raw === "fixed" || raw === "fixedterm") return "fixed_term";
  return raw;
}

function isValidEmail(value: string): boolean {
  if (!value) return true;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export function validateStaffImportRows(
  rows: Array<Record<StaffImportHeader, string>>,
  options: {
    companyId: string;
    stores: Array<{ id: string; name: string }>;
    employeeCap: number | null;
    currentActiveCount: number;
    skipEmployeeLimit: boolean;
  }
): StaffImportValidationResult {
  const errors: StaffImportRowError[] = [];
  const prepared: StaffImportPreparedRow[] = [];
  let skippedBlank = 0;
  const seenNumbers = new Set<string>();

  const dataRows = rows.filter((row) => {
    if (isBlankImportRow(row)) {
      skippedBlank++;
      return false;
    }
    return true;
  });

  if (dataRows.length === 0) {
    errors.push({ rowNumber: 0, message: "No staff rows found in the file." });
    return { prepared, errors, skippedBlank };
  }

  const cap = options.skipEmployeeLimit ? null : options.employeeCap;
  if (cap !== null && options.currentActiveCount + dataRows.length > cap) {
    const allowed = Math.max(0, cap - options.currentActiveCount);
    errors.push({
      rowNumber: 0,
      message: `Import would exceed your plan limit (${cap} active employees). You can add ${allowed} more staff on this plan.`,
    });
    return { prepared, errors, skippedBlank };
  }

  dataRows.forEach((row, index) => {
    const rowNumber = index + 2;
    const firstName = row.first_name.trim();
    const lastName = row.last_name.trim();

    if (!firstName || !lastName) {
      errors.push({ rowNumber, message: "First name and last name are required." });
      return;
    }

    const email = row.email.trim();
    if (!isValidEmail(email)) {
      errors.push({ rowNumber, message: "Email address is not valid." });
      return;
    }

    const empNumber = row.employee_number.trim();
    if (empNumber) {
      const key = empNumber.toLowerCase();
      if (seenNumbers.has(key)) {
        errors.push({ rowNumber, message: `Duplicate employee number "${empNumber}" in this file.` });
        return;
      }
      seenNumbers.add(key);
    }

    const storeBranch = row.store_branch.trim();
    let defaultStoreId: string | null = null;
    if (storeBranch) {
      defaultStoreId = resolveStoreId(storeBranch, options.stores);
      if (!defaultStoreId) {
        errors.push({
          rowNumber,
          message: `Store "${storeBranch}" was not found. Use an exact store name from your workspace.`,
        });
        return;
      }
    }

    const employmentType = normalizeEmploymentType(row.employment_type);
    if (!EMPLOYMENT_TYPES.has(employmentType)) {
      errors.push({
        rowNumber,
        message: `Employment type "${row.employment_type}" is not supported. Use: permanent, part_time, casual, fixed_term.`,
      });
      return;
    }

    prepared.push({
      rowNumber,
      payload: {
        company_id: options.companyId,
        employee_number: empNumber || null,
        first_name: firstName,
        last_name: lastName,
        job_title: row.job_title.trim() || null,
        default_store_id: defaultStoreId,
        employment_type: employmentType,
        phone: row.phone.trim() || null,
        email: email || null,
        active: true,
      },
    });
  });

  return { prepared, errors, skippedBlank };
}

export function downloadStaffImportTemplate(): void {
  if (typeof document === "undefined") return;

  const csv = buildStaffImportTemplateCsv();
  const blob = new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = STAFF_IMPORT_TEMPLATE_FILENAME;
  link.rel = "noopener";
  link.style.display = "none";
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  window.setTimeout(() => URL.revokeObjectURL(url), 200);
}

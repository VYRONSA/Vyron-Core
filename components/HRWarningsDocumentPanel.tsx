"use client";

import React, { useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  FileText,
  Printer,
  Save,
  Search,
} from "lucide-react";
import { supabase } from "../lib/supabase";

type HrWarningRow = {
  id: string;
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
  created_at: string;
};

type EmployeeRow = {
  id: string;
  employee_number: string | null;
  first_name: string;
  last_name: string;
  job_title: string | null;
  default_store_id: string | null;
  active: boolean;
  email: string | null;
  phone: string | null;
  employment_type: string | null;
};

function formatText(value: string | null | undefined) {
  if (!value) return "Not set";
  return value.replaceAll("_", " ");
}

function formatDate(value: string | null | undefined) {
  if (!value) return "Not set";

  try {
    return new Date(`${value}T12:00:00`).toLocaleDateString("en-ZA", {
      day: "2-digit",
      month: "long",
      year: "numeric",
    });
  } catch {
    return value;
  }
}

function statusClass(value: string) {
  if (value === "active") return "bg-emerald-100 text-emerald-700";
  if (value === "expired") return "bg-slate-200 text-slate-700";
  if (value === "cancelled" || value === "withdrawn") return "bg-rose-100 text-rose-700";
  return "bg-amber-100 text-amber-700";
}

function severityClass(value: string) {
  if (value === "critical" || value === "high") return "bg-rose-100 text-rose-700";
  if (value === "medium") return "bg-amber-100 text-amber-700";
  return "bg-blue-100 text-blue-700";
}

function employeeNumber(warning: HrWarningRow, employees: EmployeeRow[]) {
  return employees.find((employee) => employee.id === warning.employee_id)?.employee_number || "Not set";
}

function employeeJobTitle(warning: HrWarningRow, employees: EmployeeRow[]) {
  return employees.find((employee) => employee.id === warning.employee_id)?.job_title || "Not set";
}

function cleanFileName(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

function escapePdfText(value: string) {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)")
    .replace(/\r?\n/g, " ");
}

function wrapText(text: string, maxChars: number) {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";

  words.forEach((word) => {
    if ((line + " " + word).trim().length > maxChars) {
      if (line) lines.push(line);
      line = word;
    } else {
      line = `${line} ${word}`.trim();
    }
  });

  if (line) lines.push(line);
  return lines;
}

function buildSimplePdf(lines: string[]) {
  const objects: string[] = [];
  const offsets: number[] = [];
  const pageWidth = 595;
  const pageHeight = 842;

  const safeLines = lines.flatMap((line) => wrapText(line, 88));
  let y = 790;
  const textCommands = ["BT", "/F1 11 Tf", "50 790 Td", "14 TL"];

  safeLines.forEach((line, index) => {
    if (index === 0) {
      textCommands.push(`(${escapePdfText(line)}) Tj`);
    } else {
      textCommands.push("T*");
      textCommands.push(`(${escapePdfText(line)}) Tj`);
    }
    y -= 14;
  });

  textCommands.push("ET");
  const stream = textCommands.join("\n");

  objects.push("1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n");
  objects.push("2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n");
  objects.push(
    `3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>\nendobj\n`
  );
  objects.push("4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n");
  objects.push(`5 0 obj\n<< /Length ${stream.length} >>\nstream\n${stream}\nendstream\nendobj\n`);

  let pdf = "%PDF-1.4\n";
  objects.forEach((object) => {
    offsets.push(pdf.length);
    pdf += object;
  });

  const xrefStart = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n`;
  pdf += "0000000000 65535 f \n";

  offsets.forEach((offset) => {
    pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  });

  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`;

  return new Blob([pdf], { type: "application/pdf" });
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();

  URL.revokeObjectURL(url);
}

function warningDocumentLines(warning: HrWarningRow, employees: EmployeeRow[]) {
  return [
    "VYRON CORE",
    "FORMAL EMPLOYEE WARNING",
    "",
    `Warning Type: ${formatText(warning.warning_type).toUpperCase()}`,
    `Employee Name: ${warning.employee_name}`,
    `Employee Code: ${employeeNumber(warning, employees)}`,
    `Position: ${employeeJobTitle(warning, employees)}`,
    `Incident Type: ${formatText(warning.incident_type)}`,
    `Incident Date: ${formatDate(warning.incident_date)}`,
    `Issue Date: ${formatDate(warning.issue_date)}`,
    `Expiry Date: ${formatDate(warning.expiry_date)}`,
    `Severity: ${formatText(warning.severity)}`,
    `Status: ${formatText(warning.status)}`,
    "",
    "DETAILS OF WARNING",
    warning.description || "No description supplied.",
    "",
    "MANAGER NOTES",
    warning.manager_notes || "No manager notes supplied.",
    "",
    "EMPLOYEE ACKNOWLEDGEMENT",
    "I acknowledge that the above warning has been discussed with me. My signature does not necessarily mean that I agree with the warning, but confirms that I received and understood the contents.",
    "",
    "Employee Signature: ________________________________",
    "Date: _____________________________________________",
    "",
    "Manager Signature: _________________________________",
    "Date: _____________________________________________",
    "",
    "Witness Signature: _________________________________",
    "Date: _____________________________________________",
  ];
}

export default function HRWarningsDocumentPanel({
  hrWarnings,
  employees,
  onRefresh,
  userEmail,
}: {
  hrWarnings: HrWarningRow[];
  employees: EmployeeRow[];
  onRefresh?: () => void | Promise<void>;
  userEmail?: string | null;
}) {
  const [selectedWarning, setSelectedWarning] = useState<HrWarningRow | null>(hrWarnings[0] || null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [savingDocument, setSavingDocument] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const printRef = useRef<HTMLDivElement | null>(null);

  const activeCount = useMemo(() => hrWarnings.filter((warning) => warning.status === "active").length, [hrWarnings]);
  const expiredCount = useMemo(() => hrWarnings.filter((warning) => warning.status === "expired").length, [hrWarnings]);
  const highCount = useMemo(
    () => hrWarnings.filter((warning) => warning.severity === "high" || warning.severity === "critical").length,
    [hrWarnings]
  );

  const filteredWarnings = useMemo(() => {
    const term = search.trim().toLowerCase();

    return hrWarnings.filter((warning) => {
      if (statusFilter !== "all" && warning.status !== statusFilter) return false;

      if (!term) return true;

      return [
        warning.employee_name,
        employeeNumber(warning, employees),
        employeeJobTitle(warning, employees),
        warning.warning_type,
        warning.incident_type,
        warning.severity,
        warning.status,
        warning.description,
        warning.manager_notes,
      ]
        .join(" ")
        .toLowerCase()
        .includes(term);
    });
  }, [hrWarnings, search, statusFilter, employees]);

  function openWarning(warning: HrWarningRow) {
    setSelectedWarning(warning);
    setMessage(null);
    setError(null);
  }

  function downloadPdf() {
    if (!selectedWarning) return;

    const lines = warningDocumentLines(selectedWarning, employees);
    const pdf = buildSimplePdf(lines);
    const filename = `warning-${cleanFileName(selectedWarning.employee_name)}-${selectedWarning.issue_date}.pdf`;

    downloadBlob(pdf, filename);
  }

  function printWarning() {
    if (!selectedWarning || !printRef.current) return;

    const printWindow = window.open("", "_blank", "width=900,height=1100");
    if (!printWindow) return;

    printWindow.document.write(`
      <html>
        <head>
          <title>Warning - ${selectedWarning.employee_name}</title>
          <style>
            body {
              font-family: Arial, sans-serif;
              padding: 40px;
              color: #0f172a;
            }
            .doc {
              max-width: 800px;
              margin: 0 auto;
            }
            h1 {
              font-size: 26px;
              margin: 0 0 8px;
              letter-spacing: 0.08em;
            }
            h2 {
              font-size: 18px;
              margin-top: 28px;
              border-bottom: 1px solid #cbd5e1;
              padding-bottom: 8px;
            }
            .muted {
              color: #64748b;
              font-size: 12px;
              text-transform: uppercase;
              letter-spacing: 0.2em;
            }
            .grid {
              display: grid;
              grid-template-columns: 1fr 1fr;
              gap: 12px;
              margin-top: 20px;
            }
            .box {
              border: 1px solid #e2e8f0;
              border-radius: 12px;
              padding: 12px;
            }
            .label {
              font-size: 10px;
              text-transform: uppercase;
              letter-spacing: 0.18em;
              color: #64748b;
              font-weight: bold;
            }
            .value {
              margin-top: 6px;
              font-weight: bold;
            }
            p {
              line-height: 1.7;
              font-size: 13px;
            }
            .signature {
              margin-top: 36px;
              display: grid;
              grid-template-columns: 1fr 1fr;
              gap: 30px;
            }
            .line {
              border-top: 1px solid #0f172a;
              padding-top: 8px;
              font-size: 12px;
              font-weight: bold;
            }
          </style>
        </head>
        <body>${printRef.current.innerHTML}</body>
      </html>
    `);

    printWindow.document.close();
    printWindow.focus();
    printWindow.print();
  }

  async function saveToHrDocuments() {
    if (!selectedWarning) return;

    setSavingDocument(true);
    setMessage(null);
    setError(null);

    const { error: insertError } = await supabase.from("hr_documents").insert({
      employee_id: selectedWarning.employee_id,
      employee_name: selectedWarning.employee_name,
      document_type: "warning",
      document_title: `${formatText(selectedWarning.warning_type)} - ${formatDate(selectedWarning.issue_date)}`,
      document_notes: `Generated from HR warning record ${selectedWarning.id}. Use the HR Warnings page to print or download the PDF copy.`,
      file_name: `warning-${cleanFileName(selectedWarning.employee_name)}-${selectedWarning.issue_date}.pdf`,
      file_url: null,
      file_bucket: null,
      file_path: null,
      status: "active",
      uploaded_by: userEmail || "system",
    });

    if (insertError) {
      setError(insertError.message);
      setSavingDocument(false);
      return;
    }

    setMessage("Warning saved to HR Documents register.");

    if (onRefresh) {
      await onRefresh();
    }

    setSavingDocument(false);
  }

  return (
    <section className="mt-8 space-y-8">
      <style>{`
        @media print {
          body * {
            visibility: hidden;
          }
          #warning-print-area, #warning-print-area * {
            visibility: visible;
          }
          #warning-print-area {
            position: absolute;
            left: 0;
            top: 0;
            width: 100%;
          }
        }
      `}</style>

      <div className="grid gap-5 md:grid-cols-4">
        <div className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-[0_10px_30px_rgba(0,0,0,0.08)]">
          <div className="text-xs font-black uppercase tracking-[0.2em] text-slate-400">Total warnings</div>
          <div className="mt-3 text-4xl font-black text-slate-950">{hrWarnings.length}</div>
          <p className="mt-2 text-sm font-semibold text-slate-500">All warning documents</p>
        </div>

        <div className="rounded-[28px] border border-emerald-200 bg-emerald-50 p-6 text-emerald-800">
          <div className="text-xs font-black uppercase tracking-[0.2em] opacity-70">Active</div>
          <div className="mt-3 text-4xl font-black">{activeCount}</div>
          <p className="mt-2 text-sm font-semibold opacity-80">Still valid</p>
        </div>

        <div className="rounded-[28px] border border-rose-200 bg-rose-50 p-6 text-rose-800">
          <div className="text-xs font-black uppercase tracking-[0.2em] opacity-70">High Risk</div>
          <div className="mt-3 text-4xl font-black">{highCount}</div>
          <p className="mt-2 text-sm font-semibold opacity-80">High or critical warnings</p>
        </div>

        <div className="rounded-[28px] border border-slate-200 bg-slate-50 p-6 text-slate-800">
          <div className="text-xs font-black uppercase tracking-[0.2em] opacity-70">Expired</div>
          <div className="mt-3 text-4xl font-black">{expiredCount}</div>
          <p className="mt-2 text-sm font-semibold opacity-80">Historical only</p>
        </div>
      </div>

      <div className="grid gap-8 xl:grid-cols-[0.85fr_1.15fr]">
        <div className="rounded-[34px] border border-slate-200 bg-white p-6 shadow-[0_10px_30px_rgba(0,0,0,0.08)]">
          <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
            <div>
              <div className="text-xs font-bold uppercase tracking-[0.35em] text-blue-600">HR Warnings</div>
              <h2 className="mt-2 text-3xl font-bold text-slate-950">Warning Register</h2>
              <p className="mt-2 text-sm leading-6 text-slate-500">
                Open warnings, print formal letters, download PDF copies and save them to HR Documents.
              </p>
            </div>

            <button
              onClick={() => onRefresh?.()}
              className="rounded-2xl bg-slate-950 px-5 py-3 text-sm font-bold text-white"
            >
              Refresh
            </button>
          </div>

          <div className="mt-6 grid gap-3 md:grid-cols-[1fr_0.45fr]">
            <div className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
              <Search className="h-5 w-5 text-slate-400" />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search employee, warning type, incident..."
                className="w-full bg-transparent text-sm font-semibold outline-none"
              />
            </div>

            <select
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value)}
              className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-bold outline-none"
            >
              <option value="all">All</option>
              <option value="active">Active</option>
              <option value="expired">Expired</option>
              <option value="cancelled">Cancelled</option>
              <option value="withdrawn">Withdrawn</option>
            </select>
          </div>

          <div className="mt-6 space-y-3">
            {filteredWarnings.length === 0 ? (
              <div className="rounded-[26px] border border-dashed border-slate-200 bg-slate-50 p-8 text-center">
                <FileText className="mx-auto h-10 w-10 text-slate-300" />
                <div className="mt-3 text-lg font-bold text-slate-950">No warnings found</div>
                <p className="mt-2 text-sm text-slate-500">Create warning records to print and export.</p>
              </div>
            ) : (
              filteredWarnings.map((warning) => {
                const selected = selectedWarning?.id === warning.id;

                return (
                  <button
                    key={warning.id}
                    onClick={() => openWarning(warning)}
                    className={`w-full rounded-[24px] border p-5 text-left transition hover:-translate-y-0.5 hover:shadow-lg ${
                      selected ? "border-blue-400 bg-blue-50" : "border-slate-200 bg-slate-50"
                    }`}
                  >
                    <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                      <div>
                        <div className="font-black text-slate-950">{warning.employee_name}</div>
                        <div className="mt-1 text-xs font-semibold text-slate-500">
                          {employeeNumber(warning, employees)} · {formatText(warning.warning_type)} · {formatDate(warning.issue_date)}
                        </div>
                      </div>

                      <div className="flex flex-wrap gap-2">
                        <span className={`rounded-full px-3 py-1 text-xs font-black uppercase ${severityClass(warning.severity)}`}>
                          {warning.severity}
                        </span>
                        <span className={`rounded-full px-3 py-1 text-xs font-black uppercase ${statusClass(warning.status)}`}>
                          {formatText(warning.status)}
                        </span>
                      </div>
                    </div>

                    <p className="mt-3 line-clamp-2 text-sm leading-6 text-slate-600">{warning.description}</p>
                  </button>
                );
              })
            )}
          </div>
        </div>

        <div className="rounded-[34px] border border-slate-200 bg-white p-6 shadow-[0_10px_30px_rgba(0,0,0,0.08)]">
          {!selectedWarning ? (
            <div className="flex min-h-[680px] flex-col items-center justify-center text-center">
              <FileText className="h-14 w-14 text-slate-300" />
              <h3 className="mt-4 text-2xl font-bold text-slate-950">Select a warning</h3>
              <p className="mt-2 max-w-md text-sm leading-6 text-slate-500">
                Choose a warning to open the formal document view.
              </p>
            </div>
          ) : (
            <>
              <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                <div>
                  <div className="text-xs font-bold uppercase tracking-[0.35em] text-blue-600">Warning Document</div>
                  <h2 className="mt-2 text-3xl font-bold text-slate-950">
                    {formatText(selectedWarning.warning_type)}
                  </h2>
                  <p className="mt-2 text-sm font-semibold text-slate-500">
                    {selectedWarning.employee_name} · {employeeNumber(selectedWarning, employees)}
                  </p>
                </div>

                <div className="flex flex-wrap gap-2">
                  <span className={`rounded-full px-3 py-1 text-xs font-black uppercase ${severityClass(selectedWarning.severity)}`}>
                    {selectedWarning.severity}
                  </span>
                  <span className={`rounded-full px-3 py-1 text-xs font-black uppercase ${statusClass(selectedWarning.status)}`}>
                    {formatText(selectedWarning.status)}
                  </span>
                </div>
              </div>

              <div className="mt-6 flex flex-wrap gap-3">
                <button
                  onClick={printWarning}
                  className="flex items-center gap-2 rounded-2xl bg-slate-950 px-5 py-3 text-sm font-black text-white"
                >
                  <Printer className="h-4 w-4" />
                  Print
                </button>

                <button
                  onClick={downloadPdf}
                  className="flex items-center gap-2 rounded-2xl bg-blue-600 px-5 py-3 text-sm font-black text-white"
                >
                  <Download className="h-4 w-4" />
                  Download PDF
                </button>

                <button
                  onClick={saveToHrDocuments}
                  disabled={savingDocument}
                  className="flex items-center gap-2 rounded-2xl bg-emerald-600 px-5 py-3 text-sm font-black text-white disabled:bg-slate-300"
                >
                  <Save className="h-4 w-4" />
                  {savingDocument ? "Saving..." : "Save to HR Documents"}
                </button>
              </div>

              {message && (
                <div className="mt-5 rounded-2xl bg-emerald-50 p-4 text-sm font-semibold text-emerald-700">
                  <CheckCircle2 className="mr-2 inline h-4 w-4" />
                  {message}
                </div>
              )}

              {error && (
                <div className="mt-5 rounded-2xl bg-rose-50 p-4 text-sm font-semibold text-rose-700">
                  <AlertTriangle className="mr-2 inline h-4 w-4" />
                  {error}
                </div>
              )}

              <div
                id="warning-print-area"
                ref={printRef}
                className="doc mt-6 rounded-[26px] border border-slate-200 bg-white p-8"
              >
                <div className="muted text-xs font-black uppercase tracking-[0.35em] text-blue-600">VYRON CORE</div>
                <h1 className="mt-2 text-3xl font-black text-slate-950">FORMAL EMPLOYEE WARNING</h1>

                <div className="grid mt-6 gap-3 md:grid-cols-2">
                  <DocumentBox label="Employee Name" value={selectedWarning.employee_name} />
                  <DocumentBox label="Employee Code" value={employeeNumber(selectedWarning, employees)} />
                  <DocumentBox label="Position" value={employeeJobTitle(selectedWarning, employees)} />
                  <DocumentBox label="Warning Type" value={formatText(selectedWarning.warning_type)} />
                  <DocumentBox label="Incident Type" value={formatText(selectedWarning.incident_type)} />
                  <DocumentBox label="Incident Date" value={formatDate(selectedWarning.incident_date)} />
                  <DocumentBox label="Issue Date" value={formatDate(selectedWarning.issue_date)} />
                  <DocumentBox label="Expiry Date" value={formatDate(selectedWarning.expiry_date)} />
                </div>

                <h2 className="mt-8 border-b border-slate-200 pb-3 text-xl font-black text-slate-950">Details of Warning</h2>
                <p className="mt-4 whitespace-pre-wrap text-sm leading-7 text-slate-700">{selectedWarning.description}</p>

                <h2 className="mt-8 border-b border-slate-200 pb-3 text-xl font-black text-slate-950">Manager Notes</h2>
                <p className="mt-4 whitespace-pre-wrap text-sm leading-7 text-slate-700">
                  {selectedWarning.manager_notes || "No manager notes supplied."}
                </p>

                <h2 className="mt-8 border-b border-slate-200 pb-3 text-xl font-black text-slate-950">Employee Acknowledgement</h2>
                <p className="mt-4 text-sm leading-7 text-slate-700">
                  I acknowledge that the above warning has been discussed with me. My signature does not necessarily
                  mean that I agree with the warning, but confirms that I received and understood the contents.
                </p>

                <div className="signature mt-12 grid gap-10 md:grid-cols-2">
                  <SignatureLine label="Employee Signature / Date" />
                  <SignatureLine label="Manager Signature / Date" />
                  <SignatureLine label="Witness Signature / Date" />
                  <SignatureLine label="Employee Comments" />
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </section>
  );
}

function DocumentBox({ label, value }: { label: string; value: string }) {
  return (
    <div className="box rounded-2xl border border-slate-200 bg-slate-50 p-4">
      <div className="label text-xs font-black uppercase tracking-[0.2em] text-slate-400">{label}</div>
      <div className="value mt-2 text-sm font-bold text-slate-950">{value}</div>
    </div>
  );
}

function SignatureLine({ label }: { label: string }) {
  return (
    <div>
      <div className="line border-t border-slate-950 pt-3 text-xs font-bold text-slate-700">{label}</div>
    </div>
  );
}

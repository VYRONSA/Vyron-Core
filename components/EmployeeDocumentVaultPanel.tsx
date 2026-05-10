"use client";

import React, { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  Eye,
  FileArchive,
  FileText,
  RefreshCcw,
  Search,
  ShieldCheck,
  UserRound,
} from "lucide-react";
import { supabase } from "../lib/supabase";

type EmployeeRow = {
  id: string;
  employee_number: string | null;
  first_name: string;
  last_name: string;
  job_title: string | null;
  active: boolean;
  email: string | null;
  phone: string | null;
};

type HrDocumentRow = {
  id: string;
  employee_id: string;
  employee_name: string | null;
  document_type: string;
  document_title: string;
  document_notes: string | null;
  file_name: string | null;
  file_url: string | null;
  file_bucket: string | null;
  file_path: string | null;
  status: string;
  uploaded_by: string | null;
  created_at: string;
};

type GeneratedDocumentRow = {
  id: string;
  employee_id: string;
  document_type: string;
  document_title: string;
  filled_values: Record<string, any>;
  generated_word_html?: string | null;
  signature_status: string;
  signed_at: string | null;
  signed_by_name: string | null;
  signature_bucket: string | null;
  signature_path: string | null;
  created_at: string;
};

type DigitalSignatureRow = {
  id: string;
  employee_id: string;
  document_id: string | null;
  signature_bucket: string | null;
  signature_path: string | null;
  signer_name: string | null;
  signer_role: string | null;
  signed_at: string;
  user_agent: string | null;
  consent_text: string | null;
};

function employeeName(employee: EmployeeRow | null | undefined) {
  if (!employee) return "Unknown employee";
  return `${employee.first_name || ""} ${employee.last_name || ""}`.trim();
}

function formatText(value: string | null | undefined) {
  if (!value) return "Not set";
  return value.replaceAll("_", " ");
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return "Not set";
  try {
    return new Date(value).toLocaleString("en-ZA", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return value;
  }
}

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function StatusPill({ value }: { value: string }) {
  const className =
    value === "signed" || value === "active" || value === "completed"
      ? "bg-emerald-100 text-emerald-700"
      : value === "unsigned" || value === "pending" || value === "pending_signature"
      ? "bg-amber-100 text-amber-700"
      : value === "cancelled" || value === "expired"
      ? "bg-rose-100 text-rose-700"
      : "bg-slate-100 text-slate-700";

  return (
    <span className={`rounded-full px-3 py-1 text-xs font-black uppercase ${className}`}>
      {formatText(value)}
    </span>
  );
}

function StatCard({
  title,
  value,
  subtitle,
  tone,
  icon,
}: {
  title: string;
  value: string;
  subtitle: string;
  tone: string;
  icon: React.ReactNode;
}) {
  return (
    <div className={`rounded-[28px] border p-5 ${tone}`}>
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-xs font-black uppercase tracking-[0.22em] opacity-70">
            {title}
          </div>
          <div className="mt-3 text-4xl font-black">{value}</div>
          <div className="mt-2 text-sm font-semibold opacity-80">{subtitle}</div>
        </div>
        <div className="rounded-2xl bg-white/70 p-3">{icon}</div>
      </div>
    </div>
  );
}

export default function EmployeeDocumentVaultPanel() {
  const [employees, setEmployees] = useState<EmployeeRow[]>([]);
  const [hrDocuments, setHrDocuments] = useState<HrDocumentRow[]>([]);
  const [generatedDocuments, setGeneratedDocuments] = useState<GeneratedDocumentRow[]>([]);
  const [signatures, setSignatures] = useState<DigitalSignatureRow[]>([]);
  const [selectedEmployeeId, setSelectedEmployeeId] = useState("");
  const [search, setSearch] = useState("");
  const [documentFilter, setDocumentFilter] = useState<"all" | "signed" | "unsigned" | "hr_documents" | "contracts">("all");
  const [selectedGeneratedDocument, setSelectedGeneratedDocument] = useState<GeneratedDocumentRow | null>(null);
  const [selectedHrDocument, setSelectedHrDocument] = useState<HrDocumentRow | null>(null);
  const [signedFileUrl, setSignedFileUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [fileLoading, setFileLoading] = useState(false);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const employeeMap = useMemo(() => {
    const map = new Map<string, EmployeeRow>();
    employees.forEach((employee) => map.set(employee.id, employee));
    return map;
  }, [employees]);

  const selectedEmployee = selectedEmployeeId ? employeeMap.get(selectedEmployeeId) || null : null;

  const filteredEmployees = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return employees;

    return employees.filter((employee) =>
      [
        employee.employee_number || "",
        employee.first_name || "",
        employee.last_name || "",
        employee.job_title || "",
        employee.email || "",
        employee.phone || "",
      ]
        .join(" ")
        .toLowerCase()
        .includes(term)
    );
  }, [employees, search]);

  const visibleHrDocuments = useMemo(() => {
    return hrDocuments.filter((document) => {
      if (selectedEmployeeId && document.employee_id !== selectedEmployeeId) return false;
      if (documentFilter === "contracts") return false;
      if (documentFilter === "signed" && document.status !== "signed") return false;
      if (documentFilter === "unsigned") return false;
      return true;
    });
  }, [hrDocuments, selectedEmployeeId, documentFilter]);

  const visibleGeneratedDocuments = useMemo(() => {
    return generatedDocuments.filter((document) => {
      if (selectedEmployeeId && document.employee_id !== selectedEmployeeId) return false;
      if (documentFilter === "hr_documents") return false;
      if (documentFilter === "signed" && document.signature_status !== "signed") return false;
      if (documentFilter === "unsigned" && document.signature_status === "signed") return false;
      return true;
    });
  }, [generatedDocuments, selectedEmployeeId, documentFilter]);

  const signedContractCount = useMemo(
    () => generatedDocuments.filter((document) => document.signature_status === "signed").length,
    [generatedDocuments]
  );

  const unsignedContractCount = useMemo(
    () => generatedDocuments.filter((document) => document.signature_status !== "signed").length,
    [generatedDocuments]
  );

  const totalVisibleDocuments = visibleHrDocuments.length + visibleGeneratedDocuments.length;

  useEffect(() => {
    loadVaultData();
  }, []);

  async function loadVaultData() {
    setLoading(true);
    setError(null);

    const [employeeResult, hrDocumentResult, generatedDocumentResult, signatureResult] =
      await Promise.all([
        supabase
          .from("employees")
          .select("id,employee_number,first_name,last_name,job_title,active,email,phone")
          .order("first_name", { ascending: true }),
        supabase
          .from("hr_documents")
          .select("*")
          .order("created_at", { ascending: false })
          .limit(300),
        supabase
          .from("employee_generated_documents")
          .select("*")
          .order("created_at", { ascending: false })
          .limit(300),
        supabase
          .from("digital_signatures")
          .select("*")
          .order("signed_at", { ascending: false })
          .limit(300),
      ]);

    if (employeeResult.error) {
      setError(employeeResult.error.message);
      setLoading(false);
      return;
    }

    if (hrDocumentResult.error) {
      setError(hrDocumentResult.error.message);
      setLoading(false);
      return;
    }

    if (generatedDocumentResult.error) {
      setError(generatedDocumentResult.error.message);
      setLoading(false);
      return;
    }

    if (signatureResult.error) {
      setError(signatureResult.error.message);
      setLoading(false);
      return;
    }

    const loadedEmployees = (employeeResult.data || []) as EmployeeRow[];

    setEmployees(loadedEmployees);
    setHrDocuments((hrDocumentResult.data || []) as HrDocumentRow[]);
    setGeneratedDocuments((generatedDocumentResult.data || []) as GeneratedDocumentRow[]);
    setSignatures((signatureResult.data || []) as DigitalSignatureRow[]);

    if (!selectedEmployeeId && loadedEmployees.length > 0) {
      setSelectedEmployeeId(loadedEmployees[0].id);
    }

    setLoading(false);
  }

  async function openHrDocument(document: HrDocumentRow) {
    setSelectedHrDocument(document);
    setSelectedGeneratedDocument(null);
    setSignedFileUrl(null);
    setFileLoading(true);
    setError(null);

    if (!document.file_bucket || !document.file_path) {
      setFileLoading(false);
      return;
    }

    const { data, error: signedError } = await supabase.storage
      .from(document.file_bucket)
      .createSignedUrl(document.file_path, 60 * 10);

    if (signedError) {
      setError(signedError.message);
      setFileLoading(false);
      return;
    }

    setSignedFileUrl(data.signedUrl);
    setFileLoading(false);
  }

  function openGeneratedDocument(document: GeneratedDocumentRow) {
    setSelectedGeneratedDocument(document);
    setSelectedHrDocument(null);
    setSignedFileUrl(null);
  }

  function signatureRowsForDocument(documentId: string) {
    return signatures.filter((signature) => signature.document_id === documentId);
  }

  async function signatureImageData(signature: DigitalSignatureRow | null) {
    if (!signature?.signature_bucket || !signature?.signature_path) return "";

    const { data, error: signedError } = await supabase.storage
      .from(signature.signature_bucket)
      .createSignedUrl(signature.signature_path, 60 * 5);

    if (signedError || !data?.signedUrl) return "";

    const response = await fetch(data.signedUrl);
    const blob = await response.blob();

    return await new Promise<string>((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(String(reader.result || ""));
      reader.readAsDataURL(blob);
    });
  }

  function signatureImageBlock(imageData: string, fallbackText: string) {
    if (!imageData) return `<div class="signature-line">${escapeHtml(fallbackText)}</div>`;

    return `
      <div class="signature-image-wrap">
        <img src="${imageData}" class="signature-image" />
      </div>
    `;
  }

  async function downloadGeneratedWordContract(document: GeneratedDocumentRow) {
    setDownloadingId(document.id);
    setError(null);
    setMessage(null);

    try {
      const relatedSignatures = signatureRowsForDocument(document.id);
      const employeeSignature =
        relatedSignatures.find((signature) => String(signature.signer_role || "").includes("employee")) || null;
      const managerSignature =
        relatedSignatures.find(
          (signature) =>
            String(signature.signer_role || "").includes("manager") ||
            String(signature.signer_role || "").includes("hr")
        ) || null;

      const employeeImage = await signatureImageData(employeeSignature);
      const managerImage = await signatureImageData(managerSignature);

      const values = document.filled_values || {};
      const rows = Object.entries(values)
        .map(
          ([key, value]) => `
            <tr>
              <td class="label">${escapeHtml(formatText(key))}</td>
              <td>${escapeHtml(value)}</td>
            </tr>
          `
        )
        .join("");

      const employee = employeeMap.get(document.employee_id);
      const baseBody =
        document.generated_word_html
          ? document.generated_word_html.replace(/<html[\s\S]*?<body>/i, "").replace(/<\/body>[\s\S]*?<\/html>/i, "")
          : `<h1>${escapeHtml(document.document_title)}</h1><table>${rows}</table>`;

      const signatureFooter = `
        <table class="signature-table">
          <tr>
            <td>
              ${signatureImageBlock(employeeImage, employeeSignature?.signer_name || document.signed_by_name || employeeName(employee))}
              <div class="signature-label">Employee signature</div>
              <div class="signature-date">${escapeHtml(employeeSignature?.signer_name || document.signed_by_name || "Not signed")} · ${escapeHtml(formatDateTime(employeeSignature?.signed_at || document.signed_at))}</div>
            </td>
            <td>
              ${signatureImageBlock(managerImage, managerSignature?.signer_name || "HR / Manager")}
              <div class="signature-label">HR manager / employer representative</div>
              <div class="signature-date">${escapeHtml(managerSignature?.signer_name || "Not signed")} · ${escapeHtml(formatDateTime(managerSignature?.signed_at))}</div>
            </td>
          </tr>
        </table>
      `;

      const html = `
        <html xmlns:o="urn:schemas-microsoft-com:office:office"
              xmlns:w="urn:schemas-microsoft-com:office:word"
              xmlns="http://www.w3.org/TR/REC-html40">
          <head>
            <meta charset="utf-8" />
            <title>${escapeHtml(document.document_title)}</title>
            <style>
              @page Section1 { size: A4; margin: 1.7cm; }
              div.Section1 { page: Section1; }
              body { font-family: Arial, sans-serif; color: #111827; }
              h1 { font-size: 22px; margin: 0 0 16px 0; text-align: center; }
              h2 { font-size: 15px; margin: 18px 0 8px 0; }
              p { font-size: 12px; line-height: 1.55; margin: 7px 0; }
              table { width: 100%; border-collapse: collapse; margin: 12px 0 20px 0; }
              td { border: 1px solid #d1d5db; padding: 8px; font-size: 12px; vertical-align: top; }
              .label { width: 34%; font-weight: bold; background: #f3f4f6; }
              .page { page-break-after: always; min-height: 900px; }
              .page.last { page-break-after: auto; }
              .signature-table { width: 100%; margin-top: 36px; page-break-inside: avoid; }
              .signature-table td { width: 50%; height: 105px; border: none; padding: 12px; }
              .signature-image-wrap { min-height: 48px; border-bottom: 1px solid #111827; }
              .signature-image { max-height: 46px; max-width: 260px; }
              .signature-line { border-bottom: 1px solid #111827; min-height: 48px; font-weight: bold; }
              .signature-label { font-size: 11px; margin-top: 6px; color: #4b5563; }
              .signature-date { font-size: 10px; margin-top: 4px; color: #6b7280; }
              .footer { font-size: 10px; color: #6b7280; margin-top: 20px; }
            </style>
          </head>
          <body>
            <div class="Section1">
              <div class="page">
                ${baseBody}
                ${signatureFooter}
                <div class="footer">VYRON CORE · HR Document Vault</div>
              </div>
              <div class="page last">
                <h1>Final Signature & Audit Page</h1>
                <table>
                  <tr><td class="label">Employee</td><td>${escapeHtml(employeeName(employee))}</td></tr>
                  <tr><td class="label">Document</td><td>${escapeHtml(document.document_title)}</td></tr>
                  <tr><td class="label">Signature status</td><td>${escapeHtml(formatText(document.signature_status))}</td></tr>
                  <tr><td class="label">Employee signer</td><td>${escapeHtml(employeeSignature?.signer_name || document.signed_by_name || "Not signed")}</td></tr>
                  <tr><td class="label">HR manager signer</td><td>${escapeHtml(managerSignature?.signer_name || "Not signed")}</td></tr>
                </table>
                ${signatureFooter}
                <div class="footer">Downloaded from VYRON CORE HR Document Vault</div>
              </div>
            </div>
          </body>
        </html>
      `;

      const blob = new Blob(["\ufeff", html], { type: "application/msword;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const link = window.document.createElement("a");
      link.href = url;
      link.download = `${document.document_title.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}-hr-vault.doc`;
      link.click();
      URL.revokeObjectURL(url);

      setMessage("Word document downloaded from HR vault.");
    } catch (downloadError: any) {
      setError(downloadError?.message || "Could not download document.");
    }

    setDownloadingId(null);
  }

  return (
    <div className="mt-8 space-y-8">
      <section className="rounded-[34px] bg-gradient-to-r from-[#07101f] to-[#0b1a33] p-6 text-white shadow-2xl shadow-slate-300">
        <div className="flex flex-col gap-5 xl:flex-row xl:items-center xl:justify-between">
          <div>
            <div className="text-xs font-bold uppercase tracking-[0.4em] text-cyan-300">
              HR Document Vault
            </div>
            <h2 className="mt-3 text-4xl font-bold">Employee Document Control</h2>
            <p className="mt-4 max-w-3xl text-sm leading-7 text-slate-300">
              View employee contracts, signatures, warnings, uploaded HR files and signed documents
              in one searchable employee file.
            </p>
          </div>

          <button
            onClick={loadVaultData}
            className="flex w-fit items-center gap-2 rounded-2xl bg-white px-5 py-3 text-sm font-bold text-slate-950"
          >
            <RefreshCcw className="h-4 w-4" />
            {loading ? "Loading..." : "Refresh"}
          </button>
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-4">
        <StatCard
          title="Visible Docs"
          value={String(totalVisibleDocuments)}
          subtitle="Current filter"
          tone="border-slate-200 bg-white text-slate-950"
          icon={<FileArchive className="h-6 w-6 text-slate-700" />}
        />
        <StatCard
          title="Generated Contracts"
          value={String(generatedDocuments.length)}
          subtitle="Contract Centre records"
          tone="border-blue-200 bg-blue-50 text-blue-900"
          icon={<FileText className="h-6 w-6 text-blue-700" />}
        />
        <StatCard
          title="Signed"
          value={String(signedContractCount)}
          subtitle="Signed contracts"
          tone="border-emerald-200 bg-emerald-50 text-emerald-900"
          icon={<CheckCircle2 className="h-6 w-6 text-emerald-700" />}
        />
        <StatCard
          title="Unsigned"
          value={String(unsignedContractCount)}
          subtitle="Needs action"
          tone="border-amber-200 bg-amber-50 text-amber-900"
          icon={<AlertTriangle className="h-6 w-6 text-amber-700" />}
        />
      </section>

      {error && (
        <section className="rounded-2xl bg-rose-50 p-4 text-sm font-semibold text-rose-700">
          <AlertTriangle className="mr-2 inline h-4 w-4" />
          {error}
        </section>
      )}

      {message && (
        <section className="rounded-2xl bg-emerald-50 p-4 text-sm font-semibold text-emerald-700">
          <CheckCircle2 className="mr-2 inline h-4 w-4" />
          {message}
        </section>
      )}

      <section className="grid gap-8 xl:grid-cols-[0.78fr_1.22fr]">
        <div className="rounded-[34px] border border-slate-200 bg-white p-6 shadow-[0_10px_30px_rgba(0,0,0,0.08)]">
          <div className="text-xs font-bold uppercase tracking-[0.35em] text-blue-600">
            Employee File
          </div>
          <h3 className="mt-2 text-2xl font-bold text-slate-950">
            Select Employee
          </h3>

          <div className="mt-5 flex items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
            <Search className="h-5 w-5 text-slate-400" />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search employees..."
              className="w-full bg-transparent text-sm font-semibold outline-none"
            />
          </div>

          <div className="mt-5 space-y-3">
            {filteredEmployees.map((employee) => {
              const selected = employee.id === selectedEmployeeId;

              return (
                <button
                  key={employee.id}
                  onClick={() => setSelectedEmployeeId(employee.id)}
                  className={`w-full rounded-[24px] border p-5 text-left transition hover:-translate-y-0.5 hover:shadow-lg ${
                    selected
                      ? "border-blue-400 bg-blue-50"
                      : "border-slate-200 bg-slate-50"
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="font-black text-slate-950">
                        {employeeName(employee)}
                      </div>
                      <div className="mt-1 text-xs font-semibold text-slate-500">
                        {employee.employee_number || "No employee number"} ·{" "}
                        {employee.job_title || "No job title"}
                      </div>
                    </div>
                    <UserRound className="h-5 w-5 text-blue-600" />
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        <div className="rounded-[34px] border border-slate-200 bg-white p-6 shadow-[0_10px_30px_rgba(0,0,0,0.08)]">
          <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
            <div>
              <div className="text-xs font-bold uppercase tracking-[0.35em] text-blue-600">
                Document Register
              </div>
              <h3 className="mt-2 text-2xl font-bold text-slate-950">
                {selectedEmployee ? employeeName(selectedEmployee) : "All Documents"}
              </h3>
              <p className="mt-2 text-sm leading-6 text-slate-500">
                Open, review and download signed contract records and HR documents.
              </p>
            </div>

            <ShieldCheck className="h-8 w-8 text-blue-600" />
          </div>

          <div className="mt-5 flex flex-wrap gap-2">
            {(["all", "signed", "unsigned", "hr_documents", "contracts"] as const).map((item) => (
              <button
                key={item}
                onClick={() => setDocumentFilter(item)}
                className={`rounded-full px-4 py-2 text-xs font-black uppercase tracking-[0.16em] ${
                  documentFilter === item
                    ? "bg-slate-950 text-white"
                    : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                }`}
              >
                {formatText(item)}
              </button>
            ))}
          </div>

          <div className="mt-6 space-y-3">
            {visibleGeneratedDocuments.map((document) => {
              const employee = employeeMap.get(document.employee_id);

              return (
                <article
                  key={`generated-${document.id}`}
                  className="rounded-[24px] border border-slate-200 bg-slate-50 p-5"
                >
                  <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                    <div>
                      <div className="font-black text-slate-950">{document.document_title}</div>
                      <div className="mt-1 text-xs font-semibold text-slate-500">
                        {employeeName(employee)} · {formatText(document.document_type)} ·{" "}
                        {formatDateTime(document.created_at)}
                      </div>
                    </div>

                    <StatusPill value={document.signature_status} />
                  </div>

                  <div className="mt-4 grid gap-2 md:grid-cols-2">
                    <button
                      onClick={() => openGeneratedDocument(document)}
                      className="flex items-center justify-center gap-2 rounded-2xl bg-slate-950 px-4 py-3 text-sm font-black text-white"
                    >
                      <Eye className="h-4 w-4" />
                      Open Record
                    </button>

                    <button
                      onClick={() => downloadGeneratedWordContract(document)}
                      disabled={downloadingId === document.id}
                      className="flex items-center justify-center gap-2 rounded-2xl bg-white px-4 py-3 text-sm font-black text-slate-700 disabled:bg-slate-200"
                    >
                      <Download className="h-4 w-4" />
                      {downloadingId === document.id ? "Building..." : "Download Word"}
                    </button>
                  </div>
                </article>
              );
            })}

            {visibleHrDocuments.map((document) => (
              <article
                key={`hr-${document.id}`}
                className="rounded-[24px] border border-slate-200 bg-slate-50 p-5"
              >
                <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                  <div>
                    <div className="font-black text-slate-950">{document.document_title}</div>
                    <div className="mt-1 text-xs font-semibold text-slate-500">
                      {document.employee_name || employeeName(employeeMap.get(document.employee_id))} ·{" "}
                      {formatText(document.document_type)} · {formatDateTime(document.created_at)}
                    </div>
                  </div>

                  <StatusPill value={document.status || "active"} />
                </div>

                <button
                  onClick={() => openHrDocument(document)}
                  className="mt-4 flex w-full items-center justify-center gap-2 rounded-2xl bg-white px-4 py-3 text-sm font-black text-slate-700"
                >
                  <Eye className="h-4 w-4" />
                  Open HR Document
                </button>
              </article>
            ))}

            {!loading && visibleGeneratedDocuments.length === 0 && visibleHrDocuments.length === 0 && (
              <div className="rounded-2xl bg-slate-50 p-5 text-sm font-semibold text-slate-500">
                No documents found for this employee/filter.
              </div>
            )}
          </div>
        </div>
      </section>

      {(selectedGeneratedDocument || selectedHrDocument) && (
        <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/60 p-4">
          <div className="max-h-[92vh] w-full max-w-5xl overflow-y-auto rounded-[34px] bg-white p-6 shadow-2xl">
            <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
              <div>
                <div className="text-xs font-bold uppercase tracking-[0.35em] text-blue-600">
                  HR Vault Preview
                </div>
                <h3 className="mt-2 text-3xl font-black text-slate-950">
                  {selectedGeneratedDocument?.document_title || selectedHrDocument?.document_title}
                </h3>
                <p className="mt-2 text-sm leading-6 text-slate-500">
                  {selectedGeneratedDocument
                    ? "Generated contract record and signature audit."
                    : "Uploaded/saved HR document preview."}
                </p>
              </div>

              <button
                onClick={() => {
                  setSelectedGeneratedDocument(null);
                  setSelectedHrDocument(null);
                  setSignedFileUrl(null);
                }}
                className="rounded-2xl bg-slate-100 px-5 py-3 text-sm font-black text-slate-700"
              >
                Close
              </button>
            </div>

            {selectedGeneratedDocument && (
              <div className="mt-6 grid gap-6 xl:grid-cols-[1fr_0.8fr]">
                <section className="rounded-[28px] border border-slate-200 bg-slate-50 p-5">
                  {selectedGeneratedDocument.generated_word_html ? (
                    <div
                      className="prose prose-sm max-h-[620px] overflow-auto rounded-2xl bg-white p-5 text-slate-800"
                      dangerouslySetInnerHTML={{ __html: selectedGeneratedDocument.generated_word_html }}
                    />
                  ) : (
                    <pre className="max-h-[620px] overflow-auto whitespace-pre-wrap rounded-2xl bg-white p-5 text-xs font-semibold text-slate-700">
                      {JSON.stringify(selectedGeneratedDocument.filled_values, null, 2)}
                    </pre>
                  )}
                </section>

                <section className="rounded-[28px] border border-slate-200 bg-slate-50 p-5">
                  <div className="text-xs font-bold uppercase tracking-[0.35em] text-blue-600">
                    Signature Audit
                  </div>

                  <div className="mt-4 space-y-3">
                    {signatureRowsForDocument(selectedGeneratedDocument.id).length === 0 ? (
                      <div className="rounded-2xl bg-white p-4 text-sm font-semibold text-slate-500">
                        No signatures saved for this document yet.
                      </div>
                    ) : (
                      signatureRowsForDocument(selectedGeneratedDocument.id).map((signature) => (
                        <div key={signature.id} className="rounded-2xl bg-white p-4">
                          <div className="font-black text-slate-950">
                            {signature.signer_name || "Unknown signer"}
                          </div>
                          <div className="mt-1 text-xs font-semibold text-slate-500">
                            {formatText(signature.signer_role)} · {formatDateTime(signature.signed_at)}
                          </div>
                          <div className="mt-3 text-xs font-semibold leading-5 text-slate-600">
                            {signature.consent_text || "No consent text saved."}
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </section>
              </div>
            )}

            {selectedHrDocument && (
              <section className="mt-6 rounded-[28px] border border-slate-200 bg-slate-50 p-5">
                {fileLoading ? (
                  <div className="rounded-2xl bg-white p-8 text-center text-sm font-bold text-slate-500">
                    Loading file...
                  </div>
                ) : signedFileUrl ? (
                  <div className="space-y-4">
                    <a
                      href={signedFileUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex rounded-2xl bg-slate-950 px-5 py-3 text-sm font-black text-white"
                    >
                      Open File in New Tab
                    </a>
                    <div className="rounded-2xl bg-white p-5 text-sm font-semibold leading-6 text-slate-700">
                      File path: {selectedHrDocument.file_path}
                    </div>
                  </div>
                ) : (
                  <div className="rounded-2xl bg-white p-8 text-center text-sm font-bold text-slate-500">
                    This HR document has no file attached.
                  </div>
                )}

                {selectedHrDocument.document_notes && (
                  <div className="mt-4 rounded-2xl bg-white p-5 text-sm font-semibold leading-6 text-slate-700">
                    {selectedHrDocument.document_notes}
                  </div>
                )}
              </section>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

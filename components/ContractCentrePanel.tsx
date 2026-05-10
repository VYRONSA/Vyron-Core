"use client";

import React, { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  Eye,
  FileArchive,
  RefreshCcw,
  Search,
  Trash2,
  Upload,
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
  document_category?: string | null;
  expiry_date?: string | null;
  review_date?: string | null;
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

function StatusPill({ value }: { value: string }) {
  const className =
    value === "signed" || value === "active"
      ? "bg-emerald-100 text-emerald-700"
      : value === "archived"
      ? "bg-slate-100 text-slate-700"
      : "bg-blue-100 text-cyan-700";

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
    <div className={`rounded-[2rem] border p-5 shadow-[0_18px_55px_rgba(15,23,42,0.12)] backdrop-blur-xl transition hover:-translate-y-1 hover:shadow-[0_28px_80px_rgba(37,99,235,0.20)] ${tone}`}>
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

export default function ContractCentrePanel() {
  const [employees, setEmployees] = useState<EmployeeRow[]>([]);
  const [documents, setDocuments] = useState<HrDocumentRow[]>([]);

  const [selectedEmployeeId, setSelectedEmployeeId] = useState("");
  const [documentTitle, setDocumentTitle] = useState("");
  const [notes, setNotes] = useState("");
  const [file, setFile] = useState<File | null>(null);

  const [search, setSearch] = useState("");
  const [selectedDocument, setSelectedDocument] = useState<HrDocumentRow | null>(null);
  const [signedFileUrl, setSignedFileUrl] = useState<string | null>(null);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [fileLoading, setFileLoading] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

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

  const selectedEmployeeDocuments = useMemo(() => {
    if (!selectedEmployeeId) return [];

    return documents.filter((document) => document.employee_id === selectedEmployeeId);
  }, [documents, selectedEmployeeId]);

  const signedContractCount = useMemo(
    () =>
      documents.filter(
        (document) =>
          document.status === "signed" &&
          ["employment_contract", "contract"].includes(document.document_type)
      ).length,
    [documents]
  );

  useEffect(() => {
    loadData();
  }, []);

  useEffect(() => {
    if (!selectedEmployee) return;

    setDocumentTitle(`${employeeName(selectedEmployee)} - Signed Contract`);
  }, [selectedEmployeeId]);

  async function loadData() {
    setLoading(true);
    setError(null);

    const [employeeResult, documentResult] = await Promise.all([
      supabase
        .from("employees")
        .select("id,employee_number,first_name,last_name,job_title,active,email,phone")
        .order("first_name", { ascending: true }),
      supabase
        .from("hr_documents")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(500),
    ]);

    if (employeeResult.error) {
      setError(employeeResult.error.message);
      setLoading(false);
      return;
    }

    if (documentResult.error) {
      setError(documentResult.error.message);
      setLoading(false);
      return;
    }

    const loadedEmployees = (employeeResult.data || []) as EmployeeRow[];

    setEmployees(loadedEmployees);
    setDocuments((documentResult.data || []) as HrDocumentRow[]);

    if (!selectedEmployeeId && loadedEmployees.length > 0) {
      setSelectedEmployeeId(loadedEmployees[0].id);
    }

    setLoading(false);
  }

  function cleanFileName(value: string) {
    return value
      .toLowerCase()
      .replace(/[^a-z0-9.]+/g, "-")
      .replace(/(^-|-$)+/g, "")
      .slice(0, 140);
  }

  async function saveSignedContract() {
    setSaving(true);
    setError(null);
    setMessage(null);

    if (!selectedEmployee) {
      setError("Select an employee first.");
      setSaving(false);
      return;
    }

    if (!file) {
      setError("Choose the signed contract file first.");
      setSaving(false);
      return;
    }

    if (!documentTitle.trim()) {
      setError("Document title is required.");
      setSaving(false);
      return;
    }

    const filePath = `${selectedEmployee.id}/contracts/${Date.now()}-${cleanFileName(file.name)}`;

    const { error: uploadError } = await supabase.storage
      .from("hr-signed-documents")
      .upload(filePath, file, {
        contentType: file.type || "application/octet-stream",
        upsert: false,
      });

    if (uploadError) {
      setError(uploadError.message);
      setSaving(false);
      return;
    }

    const { error: insertError } = await supabase.from("hr_documents").insert({
      employee_id: selectedEmployee.id,
      employee_name: employeeName(selectedEmployee),
      document_type: "employment_contract",
      document_category: "signed_contract",
      document_title: documentTitle.trim(),
      document_notes: notes.trim() || null,
      file_name: file.name,
      file_url: null,
      file_bucket: "hr-signed-documents",
      file_path: filePath,
      status: "signed",
      uploaded_by: "VYRON CORE",
      review_date: null,
      expiry_date: null,
    });

    if (insertError) {
      setError(insertError.message);
      setSaving(false);
      return;
    }

    setMessage("Signed contract saved under the employee.");
    setFile(null);
    setNotes("");
    await loadData();
    setSaving(false);
  }

  async function openDocument(document: HrDocumentRow) {
    setSelectedDocument(document);
    setSignedFileUrl(null);
    setFileLoading(true);
    setError(null);

    if (!document.file_bucket || !document.file_path) {
      setFileLoading(false);
      setError("This document has no file attached.");
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

  async function downloadDocument(document: HrDocumentRow) {
    setError(null);

    if (!document.file_bucket || !document.file_path) {
      setError("This document has no file attached.");
      return;
    }

    const { data, error: downloadError } = await supabase.storage
      .from(document.file_bucket)
      .download(document.file_path);

    if (downloadError || !data) {
      setError(downloadError?.message || "Could not download document.");
      return;
    }

    const url = URL.createObjectURL(data);
    const link = window.document.createElement("a");
    link.href = url;
    link.download = document.file_name || `${document.document_title}.file`;
    link.click();
    URL.revokeObjectURL(url);
  }

  async function deleteDocument(document: HrDocumentRow) {
    const confirmed = window.confirm(`Delete this document?\n\n${document.document_title}`);
    if (!confirmed) return;

    setDeletingId(document.id);
    setError(null);
    setMessage(null);

    if (document.file_bucket && document.file_path) {
      await supabase.storage.from(document.file_bucket).remove([document.file_path]);
    }

    const { error: deleteError } = await supabase
      .from("hr_documents")
      .delete()
      .eq("id", document.id);

    if (deleteError) {
      setError(deleteError.message);
      setDeletingId(null);
      return;
    }

    setDocuments((current) => current.filter((item) => item.id !== document.id));
    setMessage("Document deleted.");
    setDeletingId(null);
  }

  return (
    <div className="mt-8 space-y-8">
      <section className="relative overflow-hidden rounded-[2.2rem] border border-white/70 bg-white/95 p-7 text-[#06101f] shadow-[0_22px_70px_rgba(15,23,42,0.16)] backdrop-blur-xl">
        <div className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full bg-cyan-300/30 blur-[80px]" />
        <div className="pointer-events-none absolute bottom-[-120px] left-1/3 h-72 w-72 rounded-full bg-blue-400/20 blur-[90px]" />
        <div className="relative z-10">
        <div className="flex flex-col gap-5 xl:flex-row xl:items-center xl:justify-between">
          <div>
            <div className="text-xs font-bold uppercase tracking-[0.4em] text-cyan-700">
              Signed Contract Vault
            </div>
            <h2 className="mt-3 text-4xl font-bold">Save Signed Contracts</h2>
            <p className="mt-4 max-w-3xl text-sm leading-7 text-slate-600">
              Simple workflow: select employee, upload the signed contract, save it under the employee.
            </p>
          </div>

          <button
            onClick={loadData}
            className="flex w-fit items-center gap-2 rounded-2xl bg-white px-5 py-3 text-sm font-bold text-slate-950"
          >
            <RefreshCcw className="h-4 w-4" />
            {loading ? "Loading..." : "Refresh"}
          </button>
        </div>
      </div>
      </section>

      <section className="grid gap-4 md:grid-cols-3">
        <StatCard
          title="Employees"
          value={String(employees.length)}
          subtitle="Loaded employees"
          tone="border-slate-200 bg-white text-slate-950"
          icon={<UserRound className="h-6 w-6 text-slate-700" />}
        />

        <StatCard
          title="Contracts"
          value={String(signedContractCount)}
          subtitle="Signed contracts saved"
          tone="border-emerald-200 bg-emerald-50 text-emerald-900"
          icon={<CheckCircle2 className="h-6 w-6 text-emerald-700" />}
        />

        <StatCard
          title="Selected"
          value={String(selectedEmployeeDocuments.length)}
          subtitle="Files for selected employee"
          tone="border-cyan-200 bg-cyan-50 text-cyan-900"
          icon={<FileArchive className="h-6 w-6 text-cyan-700" />}
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

      <section className="grid gap-8 xl:grid-cols-[0.75fr_1.25fr]">
        <div className="rounded-[2rem] border border-white/80 bg-white/95 p-6 shadow-[0_18px_55px_rgba(15,23,42,0.12)] backdrop-blur-xl">
          <div className="text-xs font-bold uppercase tracking-[0.35em] text-cyan-600">
            Step 1
          </div>
          <h3 className="mt-2 text-2xl font-bold text-slate-950">
            Select Employee
          </h3>

          <div className="mt-5 flex items-center gap-3 rounded-2xl border border-white/80 bg-white/80 shadow-sm backdrop-blur-xl px-4 py-3">
            <Search className="h-5 w-5 text-slate-400" />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search employees..."
              className="w-full bg-transparent text-sm font-semibold outline-none"
            />
          </div>

          <div className="mt-5 max-h-[620px] space-y-3 overflow-auto pr-1">
            {filteredEmployees.map((employee) => {
              const selected = employee.id === selectedEmployeeId;

              return (
                <button
                  key={employee.id}
                  onClick={() => setSelectedEmployeeId(employee.id)}
                  className={`w-full rounded-[24px] border p-5 text-left transition hover:-translate-y-0.5 hover:shadow-lg ${
                    selected ? "border-cyan-400 bg-cyan-50" : "border-slate-200 bg-slate-50"
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="font-black text-slate-950">{employeeName(employee)}</div>
                      <div className="mt-1 text-xs font-semibold text-slate-500">
                        {employee.employee_number || "No employee number"} ·{" "}
                        {employee.job_title || "No job title"}
                      </div>
                    </div>
                    <UserRound className="h-5 w-5 text-cyan-600" />
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        <div className="space-y-8">
          <div className="rounded-[2rem] border border-white/80 bg-white/95 p-6 shadow-[0_18px_55px_rgba(15,23,42,0.12)] backdrop-blur-xl">
            <div className="text-xs font-bold uppercase tracking-[0.35em] text-cyan-600">
              Step 2
            </div>
            <h3 className="mt-2 text-2xl font-bold text-slate-950">
              Upload Signed Contract
            </h3>

            <div className="mt-6 grid gap-4">
              {selectedEmployee && (
                <div className="rounded-[2rem] border border-cyan-100 bg-cyan-50/90 p-5 shadow-[0_16px_45px_rgba(15,23,42,0.08)] backdrop-blur-xl">
                  <div className="font-black text-blue-950">
                    Saving for {employeeName(selectedEmployee)}
                  </div>
                  <div className="mt-1 text-xs font-semibold text-cyan-700">
                    {selectedEmployee.employee_number || "No employee number"} ·{" "}
                    {selectedEmployee.job_title || "No job title"}
                  </div>
                </div>
              )}

              <label className="text-sm font-bold text-slate-800">
                Contract Title
                <input
                  value={documentTitle}
                  onChange={(event) => setDocumentTitle(event.target.value)}
                  placeholder="Employee Name - Signed Contract"
                  className="mt-2 w-full rounded-2xl border border-white/80 bg-white/80 shadow-sm backdrop-blur-xl px-4 py-3 text-sm font-semibold text-slate-950 outline-none focus:border-cyan-400"
                />
              </label>

              <label className="text-sm font-bold text-slate-800">
                Notes
                <textarea
                  value={notes}
                  onChange={(event) => setNotes(event.target.value)}
                  rows={4}
                  placeholder="Optional notes..."
                  className="mt-2 w-full rounded-2xl border border-white/80 bg-white/80 shadow-sm backdrop-blur-xl px-4 py-3 text-sm font-semibold text-slate-950 outline-none focus:border-cyan-400"
                />
              </label>

              <label className="text-sm font-bold text-slate-800">
                Signed Contract File
                <input
                  type="file"
                  accept=".pdf,.doc,.docx,.png,.jpg,.jpeg,.webp"
                  onChange={(event) => setFile(event.target.files?.[0] || null)}
                  className="mt-2 w-full rounded-2xl border border-white/80 bg-white/80 shadow-sm backdrop-blur-xl px-4 py-3 text-sm font-semibold text-slate-950 outline-none focus:border-cyan-400"
                />
              </label>

              <button
                onClick={saveSignedContract}
                disabled={saving}
                className="flex items-center justify-center gap-2 rounded-2xl bg-emerald-600 px-5 py-4 text-sm font-black text-[#06101f] disabled:bg-slate-300"
              >
                <Upload className="h-4 w-4" />
                {saving ? "Saving..." : "Save Signed Contract"}
              </button>
            </div>
          </div>

          <div className="rounded-[2rem] border border-white/80 bg-white/95 p-6 shadow-[0_18px_55px_rgba(15,23,42,0.12)] backdrop-blur-xl">
            <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
              <div>
                <div className="text-xs font-bold uppercase tracking-[0.35em] text-cyan-600">
                  Employee Files
                </div>
                <h3 className="mt-2 text-2xl font-bold text-slate-950">
                  {selectedEmployee ? employeeName(selectedEmployee) : "Saved Contracts"}
                </h3>
              </div>

              <button
                onClick={loadData}
                className="rounded-2xl bg-slate-100 px-4 py-3 text-sm font-black text-slate-700"
              >
                Refresh
              </button>
            </div>

            <div className="mt-6 space-y-3">
              {loading ? (
                <div className="rounded-2xl bg-white/80 shadow-sm backdrop-blur-xl p-5 text-sm font-semibold text-slate-500">
                  Loading documents...
                </div>
              ) : selectedEmployeeDocuments.length === 0 ? (
                <div className="rounded-2xl bg-white/80 shadow-sm backdrop-blur-xl p-5 text-sm font-semibold text-slate-500">
                  No signed contracts saved for this employee yet.
                </div>
              ) : (
                selectedEmployeeDocuments.map((document) => (
                  <article key={document.id} className="rounded-[2rem] border border-white/80 bg-white/90 p-5 shadow-[0_16px_45px_rgba(15,23,42,0.10)] backdrop-blur-xl">
                    <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                      <div>
                        <div className="font-black text-slate-950">{document.document_title}</div>
                        <div className="mt-1 text-xs font-semibold text-slate-500">
                          {formatText(document.document_type)} · {formatDateTime(document.created_at)}
                        </div>
                        <div className="mt-2 text-xs font-semibold text-slate-500">
                          {document.file_name || "No file name"}
                        </div>
                      </div>

                      <StatusPill value={document.status || "signed"} />
                    </div>

                    {document.document_notes && (
                      <div className="mt-4 rounded-2xl border border-white/80 bg-white/95 p-4 shadow-sm text-sm font-semibold leading-6 text-slate-700">
                        {document.document_notes}
                      </div>
                    )}

                    <div className="mt-4 grid gap-2 md:grid-cols-3">
                      <button
                        onClick={() => openDocument(document)}
                        className="flex items-center justify-center gap-2 rounded-2xl bg-[#06101f] px-4 py-3 text-sm font-black text-cyan-300"
                      >
                        <Eye className="h-4 w-4" />
                        Open
                      </button>

                      <button
                        onClick={() => downloadDocument(document)}
                        className="flex items-center justify-center gap-2 rounded-2xl bg-white px-4 py-3 text-sm font-black text-slate-700"
                      >
                        <Download className="h-4 w-4" />
                        Download
                      </button>

                      <button
                        onClick={() => deleteDocument(document)}
                        disabled={deletingId === document.id}
                        className="flex items-center justify-center gap-2 rounded-2xl bg-rose-600 px-4 py-3 text-sm font-black text-[#06101f] disabled:bg-slate-300"
                      >
                        <Trash2 className="h-4 w-4" />
                        {deletingId === document.id ? "Deleting..." : "Delete"}
                      </button>
                    </div>
                  </article>
                ))
              )}
            </div>
          </div>
        </div>
      </section>

      {selectedDocument && (
        <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/60 p-4">
          <div className="max-h-[92vh] w-full max-w-4xl overflow-y-auto rounded-[34px] bg-white p-6 shadow-2xl">
            <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
              <div>
                <div className="text-xs font-bold uppercase tracking-[0.35em] text-cyan-600">
                  Signed Contract
                </div>
                <h3 className="mt-2 text-3xl font-black text-slate-950">
                  {selectedDocument.document_title}
                </h3>
                <p className="mt-2 text-sm leading-6 text-slate-500">
                  {selectedDocument.file_name || "Uploaded contract"}
                </p>
              </div>

              <button
                onClick={() => {
                  setSelectedDocument(null);
                  setSignedFileUrl(null);
                }}
                className="rounded-2xl bg-slate-100 px-5 py-3 text-sm font-black text-slate-700"
              >
                Close
              </button>
            </div>

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
                    className="inline-flex rounded-2xl bg-slate-950 px-5 py-3 text-sm font-black text-[#06101f]"
                  >
                    Open File in New Tab
                  </a>

                  <div className="rounded-2xl bg-white p-5 text-sm font-semibold leading-6 text-slate-700">
                    File path: {selectedDocument.file_path}
                  </div>
                </div>
              ) : (
                <div className="rounded-2xl bg-white p-8 text-center text-sm font-bold text-slate-500">
                  No file attached.
                </div>
              )}

              {selectedDocument.document_notes && (
                <div className="mt-4 rounded-2xl bg-white p-5 text-sm font-semibold leading-6 text-slate-700">
                  {selectedDocument.document_notes}
                </div>
              )}
            </section>
          </div>
        </div>
      )}
    </div>
  );
}

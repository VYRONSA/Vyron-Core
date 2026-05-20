"use client";

import React, { useMemo, useState } from "react";
import { Download, FileText, Search, Trash2, Upload } from "lucide-react";
import { supabase } from "../lib/supabase";

const DEMO_COMPANY_ID = "11111111-1111-1111-1111-111111111111";

function employeeName(e: any) {
  return e ? `${e.first_name || ""} ${e.last_name || ""}`.trim() || e.employee_number || "Employee" : "Employee";
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function sizeText(v?: number | null) {
  if (!v) return "Unknown";
  if (v < 1024) return `${v} B`;
  if (v < 1048576) return `${Math.round(v / 1024)} KB`;
  return `${(v / 1048576).toFixed(2)} MB`;
}

function formatType(value: string) {
  return String(value || "").replaceAll("_", " ");
}

function fileDisplayName(doc: any) {
  return doc.file_name || doc.document_title || "Uploaded HR file";
}

const documentTypes = [
  { value: "employment_contract", label: "Employment Contract" },
  { value: "signed_job_description", label: "Signed Job Description" },
  { value: "offer_letter", label: "Offer Letter" },
  { value: "increase_letter", label: "Increase Letter" },
  { value: "loan_agreement", label: "Loan Agreement / Loan Letter" },
  { value: "warning_document", label: "Warning Document" },
  { value: "disciplinary_document", label: "Disciplinary Document" },
  { value: "leave_document", label: "Leave Document" },
  { value: "medical_certificate", label: "Medical Certificate" },
  { value: "id_document", label: "ID / Passport Copy" },
  { value: "bank_confirmation", label: "Bank Confirmation" },
  { value: "tax_document", label: "Tax / SARS Document" },
  { value: "training_certificate", label: "Training Certificate" },
  { value: "policy_acknowledgement", label: "Policy Acknowledgement" },
  { value: "performance_review", label: "Performance Review" },
  { value: "other", label: "Other HR Document" },
];

export default function ContractCentrePanel({
  employees = [],
  employeeDocuments = [],
  companyId = DEMO_COMPANY_ID,
  onUpdated,
}: any) {
  const activeEmployees = employees.filter((e: any) => e.active !== false);

  const [employeeId, setEmployeeId] = useState(activeEmployees[0]?.id || "");
  const [documentType, setDocumentType] = useState("employment_contract");
  const [documentTitle, setDocumentTitle] = useState("");
  const [documentNotes, setDocumentNotes] = useState("");
  const [issueDate, setIssueDate] = useState(today());
  const [expiryDate, setExpiryDate] = useState("");
  const [signedStatus, setSignedStatus] = useState("signed");
  const [file, setFile] = useState<File | null>(null);
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const selectedEmployee = activeEmployees.find((e: any) => e.id === employeeId);

  const filteredDocs = useMemo(() => {
    return employeeDocuments.filter((d: any) => {
      if (employeeId && d.employee_id !== employeeId) return false;

      const term = search.trim().toLowerCase();
      if (!term) return true;

      return [
        d.employee_name,
        d.document_type,
        d.document_title,
        d.file_name,
        d.status,
        d.signed_status,
        d.document_notes,
      ]
        .join(" ")
        .toLowerCase()
        .includes(term);
    });
  }, [employeeDocuments, employeeId, search]);

  const activeDocs = filteredDocs.filter((d: any) => d.status !== "archived");
  const archivedDocs = filteredDocs.filter((d: any) => d.status === "archived");

  function handleTypeChange(value: string) {
    setDocumentType(value);
  }

  async function uploadDocument() {
    setBusy(true);
    setMessage(null);

    if (!selectedEmployee) {
      setMessage("Select an employee first.");
      setBusy(false);
      return;
    }

    if (!file) {
      setMessage("Browse and select a file first.");
      setBusy(false);
      return;
    }

    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
    const path = `${companyId}/${selectedEmployee.id}/${documentType}/${Date.now()}-${safeName}`;

    const upload = await supabase.storage
      .from("employee-documents")
      .upload(path, file, { cacheControl: "3600", upsert: false });

    if (upload.error) {
      setMessage(upload.error.message);
      setBusy(false);
      return;
    }

    const publicUrl = supabase.storage.from("employee-documents").getPublicUrl(path).data.publicUrl;

    const selectedTypeLabel =
      documentTypes.find((item) => item.value === documentType)?.label || "HR Document";

    const insert = await supabase.from("employee_documents").insert({
      company_id: companyId,
      employee_id: selectedEmployee.id,
      employee_name: employeeName(selectedEmployee),
      document_type: documentType,
      document_title: documentTitle.trim() || selectedTypeLabel,
      document_notes: documentNotes.trim() || null,
      file_name: file.name,
      file_url: publicUrl,
      file_bucket: "employee-documents",
      file_path: path,
      file_mime_type: file.type || null,
      file_size_bytes: file.size,
      issue_date: issueDate || null,
      expiry_date: expiryDate || null,
      signed_status: signedStatus,
      status: "active",
      uploaded_by: "manager",
    });

    if (insert.error) {
      setMessage(insert.error.message);
      setBusy(false);
      return;
    }

    setMessage("HR file uploaded successfully.");
    setFile(null);
    setDocumentTitle("");
    setDocumentNotes("");
    setExpiryDate("");

    if (onUpdated) await onUpdated();

    setBusy(false);
  }

  async function archiveDoc(doc: any) {
    setBusy(true);

    const result = await supabase
      .from("employee_documents")
      .update({ status: "archived" })
      .eq("id", doc.id);

    if (result.error) {
      setMessage(result.error.message);
    } else {
      setMessage("Document archived successfully.");
      if (onUpdated) await onUpdated();
    }

    setBusy(false);
  }

  async function restoreDoc(doc: any) {
    setBusy(true);

    const result = await supabase
      .from("employee_documents")
      .update({ status: "active" })
      .eq("id", doc.id);

    if (result.error) {
      setMessage(result.error.message);
    } else {
      setMessage("Document restored successfully.");
      if (onUpdated) await onUpdated();
    }

    setBusy(false);
  }

  async function deleteDoc(doc: any) {
    const confirmed = window.confirm("Delete this document permanently? Use this only if the wrong file was uploaded.");
    if (!confirmed) return;

    setBusy(true);

    if (doc.file_path) {
      await supabase.storage.from("employee-documents").remove([doc.file_path]);
    }

    const result = await supabase.from("employee_documents").delete().eq("id", doc.id);

    if (result.error) {
      setMessage(result.error.message);
    } else {
      setMessage("Document deleted permanently.");
      if (onUpdated) await onUpdated();
    }

    setBusy(false);
  }

  function DocumentCard({ d, archived = false }: { d: any; archived?: boolean }) {
    return (
      <div className="rounded-3xl border border-slate-200 bg-slate-50 p-5">
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div>
            <div className="font-black text-slate-950">{fileDisplayName(d)}</div>
            <div className="mt-1 text-sm font-semibold capitalize text-slate-500">
              {formatType(d.document_type)} · {d.document_title || "HR File"}
            </div>
            <div className="mt-1 text-xs font-bold text-slate-400">
              {d.employee_name} · {sizeText(d.file_size_bytes)}
            </div>
          </div>

          <span className={`rounded-full px-3 py-1 text-xs font-black uppercase ${
            archived ? "bg-slate-300 text-slate-700" : "bg-emerald-100 text-emerald-700"
          }`}>
            {archived ? "Archived" : d.signed_status || "Active"}
          </span>
        </div>

        <div className="mt-3 text-sm text-slate-600">
          {d.document_notes || "No notes."}
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-3">
          {d.file_url && (
            <a
              href={d.file_url}
              target="_blank"
              rel="noreferrer"
              className="rounded-2xl bg-blue-600 px-4 py-3 text-center text-sm font-black text-white"
            >
              <Download className="mr-2 inline h-4 w-4" />
              Open
            </a>
          )}

          {archived ? (
            <button
              onClick={() => restoreDoc(d)}
              disabled={busy}
              className="rounded-2xl bg-emerald-600 px-4 py-3 text-sm font-black text-white disabled:bg-slate-300"
            >
              Restore
            </button>
          ) : (
            <button
              onClick={() => archiveDoc(d)}
              disabled={busy}
              className="rounded-2xl bg-amber-500 px-4 py-3 text-sm font-black text-white disabled:bg-slate-300"
            >
              Archive
            </button>
          )}

          <button
            onClick={() => deleteDoc(d)}
            disabled={busy}
            className="rounded-2xl bg-rose-600 px-4 py-3 text-sm font-black text-white disabled:bg-slate-300"
          >
            <Trash2 className="mr-2 inline h-4 w-4" />
            Delete
          </button>
        </div>
      </div>
    );
  }

  return (
    <section className="space-y-6">
      <div className="rounded-[34px] bg-gradient-to-r from-[#07101f] to-[#0b1a33] p-7 text-white shadow-2xl">
        <div className="text-xs font-black uppercase tracking-[0.4em] text-cyan-300">
          EMPLOYEE HR FILES
        </div>

        <h1 className="mt-3 text-4xl font-black">
          Employee HR Files
        </h1>

        <p className="mt-3 max-w-3xl text-sm leading-7 text-slate-300">
          Upload separate HR files per employee. Each file keeps its own category, file name, notes and status.
        </p>
      </div>

      <div className="grid gap-6 xl:grid-cols-[0.9fr_1.1fr]">
        <div className="rounded-[34px] bg-white p-6 shadow-lg">
          <div className="flex items-center gap-3">
            <Upload className="h-7 w-7" />
            <h2 className="text-2xl font-black">Upload Employee HR File</h2>
          </div>

          <div className="mt-6 space-y-4">
            <label className="block text-sm font-black">
              Employee
              <select
                value={employeeId}
                onChange={(e) => setEmployeeId(e.target.value)}
                className="mt-2 w-full rounded-2xl bg-slate-50 px-4 py-3 font-bold"
              >
                <option value="">Select employee</option>

                {activeEmployees.map((e: any) => (
                  <option key={e.id} value={e.id}>
                    {employeeName(e)} · {e.employee_number || "No code"}
                  </option>
                ))}
              </select>
            </label>

            <label className="block text-sm font-black">
              HR file category
              <select
                value={documentType}
                onChange={(e) => handleTypeChange(e.target.value)}
                className="mt-2 w-full rounded-2xl bg-slate-50 px-4 py-3 font-bold"
              >
                {documentTypes.map((item) => (
                  <option key={item.value} value={item.value}>
                    {item.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="block text-sm font-black">
              Optional file label
              <input
                value={documentTitle}
                onChange={(e) => setDocumentTitle(e.target.value)}
                placeholder="Optional label, e.g. 2026 Increase Letter"
                className="mt-2 w-full rounded-2xl bg-slate-50 px-4 py-3 font-bold"
              />
            </label>

            <textarea
              value={documentNotes}
              onChange={(e) => setDocumentNotes(e.target.value)}
              rows={3}
              placeholder="Notes about this HR file..."
              className="w-full rounded-2xl bg-slate-50 px-4 py-3 font-bold"
            />

            <div className="grid gap-4 md:grid-cols-2">
              <label className="block text-sm font-black">
                Issue date
                <input
                  type="date"
                  value={issueDate}
                  onChange={(e) => setIssueDate(e.target.value)}
                  className="mt-2 w-full rounded-2xl bg-slate-50 px-4 py-3 font-bold"
                />
              </label>

              <label className="block text-sm font-black">
                Expiry / review date
                <input
                  type="date"
                  value={expiryDate}
                  onChange={(e) => setExpiryDate(e.target.value)}
                  className="mt-2 w-full rounded-2xl bg-slate-50 px-4 py-3 font-bold"
                />
              </label>
            </div>

            <label className="block text-sm font-black">
              Status
              <select
                value={signedStatus}
                onChange={(e) => setSignedStatus(e.target.value)}
                className="mt-2 w-full rounded-2xl bg-slate-50 px-4 py-3 font-bold"
              >
                <option value="signed">Signed</option>
                <option value="unsigned">Unsigned</option>
                <option value="pending_signature">Pending signature</option>
                <option value="not_required">Signature not required</option>
              </select>
            </label>

            <label className="block rounded-[28px] border-2 border-dashed border-cyan-200 bg-cyan-50 p-6 text-center text-sm font-black text-cyan-900">
              <Upload className="mx-auto h-8 w-8" />
              <div className="mt-3">Browse and select HR file</div>

              <input
                type="file"
                accept=".pdf,.doc,.docx,.jpg,.jpeg,.png,.webp"
                onChange={(e) => setFile(e.target.files?.[0] || null)}
                className="mt-4 block w-full rounded-2xl bg-white px-4 py-3"
              />
            </label>

            {file && (
              <div className="rounded-2xl bg-slate-50 p-4 text-sm font-bold">
                Selected: {file.name} · {sizeText(file.size)}
              </div>
            )}

            {message && (
              <div className="rounded-2xl bg-blue-50 p-4 text-sm font-bold text-blue-700">
                {message}
              </div>
            )}

            <button
              onClick={uploadDocument}
              disabled={busy}
              className="w-full rounded-2xl bg-slate-950 px-5 py-4 text-sm font-black text-white disabled:bg-slate-300"
            >
              {busy ? "Working..." : "Upload to Employee HR File"}
            </button>
          </div>
        </div>

        <div className="rounded-[34px] bg-white p-6 shadow-lg">
          <div className="flex items-center gap-3 rounded-2xl bg-slate-50 px-4 py-3">
            <Search className="h-5 w-5 text-slate-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search file name, category or notes..."
              className="w-full bg-transparent text-sm font-bold outline-none"
            />
          </div>

          <div className="mt-6 space-y-4">
            {activeDocs.length === 0 ? (
              <div className="rounded-3xl border border-dashed border-slate-200 p-8 text-center">
                <FileText className="mx-auto h-10 w-10 text-slate-300" />
                <div className="mt-3 font-black text-slate-500">
                  No active HR files found.
                </div>
              </div>
            ) : (
              activeDocs.map((d: any) => <DocumentCard key={d.id} d={d} />)
            )}

            {archivedDocs.length > 0 && (
              <div className="pt-6">
                <div className="mb-3 text-xs font-black uppercase tracking-[0.3em] text-slate-400">
                  Archived HR files
                </div>

                <div className="space-y-4">
                  {archivedDocs.map((d: any) => (
                    <DocumentCard key={d.id} d={d} archived />
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

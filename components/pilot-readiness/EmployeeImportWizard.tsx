"use client";

import React, { useState } from "react";
import { Download, Upload, UserPlus, Users } from "lucide-react";
import { seedEmployeeLeaveBalances } from "@/lib/leave-balance-seed";
import { supabase } from "@/lib/supabase";
import {
  downloadStaffImportTemplate,
  parseStaffImportCsv,
  validateStaffImportRows,
} from "@/lib/staff-import";

type StoreRow = { id: string; name: string };

type Props = {
  companyId: string;
  stores: StoreRow[];
  employeeCount: number;
  onRefresh: () => void;
  onOpenFullImport?: () => void;
};

const QUICK_STAFF = [
  { first: "Thabo", last: "Mokoena", job: "Supervisor" },
  { first: "Lerato", last: "Nkosi", job: "Administrator" },
  { first: "Sipho", last: "Dlamini", job: "Technician" },
  { first: "Nomsa", last: "Khumalo", job: "Coordinator" },
  { first: "David", last: "Botha", job: "Team Lead" },
];

export default function EmployeeImportWizard({
  companyId,
  stores,
  employeeCount,
  onRefresh,
  onOpenFullImport,
}: Props) {
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);

  async function addQuickEmployees() {
    if (!companyId) return;
    setBusy("quick");
    setError(null);
    setMessage(null);
    const defaultStoreId = stores[0]?.id || null;
    const startNum = employeeCount + 1;
    const payloads = QUICK_STAFF.map((person, index) => ({
      company_id: companyId,
      employee_number: `EMP-${String(startNum + index).padStart(3, "0")}`,
      first_name: person.first,
      last_name: person.last,
      job_title: person.job,
      default_store_id: defaultStoreId,
      employment_type: "permanent",
      active: true,
      pin_code: String(1000 + startNum + index).slice(-4),
      kiosk_access_enabled: true,
    }));
    const { data: inserted, error: insertErr } = await supabase
      .from("employees")
      .insert(payloads)
      .select("id,first_name,last_name");
    setBusy(null);
    if (insertErr) {
      setError(insertErr.message);
      return;
    }
    for (const row of inserted || []) {
      await seedEmployeeLeaveBalances(supabase, {
        companyId,
        employeeId: row.id,
        employeeName: `${row.first_name} ${row.last_name}`.trim(),
      });
    }
    setMessage(`Added ${payloads.length} starter employees with kiosk PINs.`);
    onRefresh();
  }

  async function handleCsvUpload(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || !companyId) return;
    setBusy("csv");
    setError(null);
    setMessage(null);
    setFileName(file.name);
    try {
      const text = await file.text();
      const rows = parseStaffImportCsv(text);
      const validation = validateStaffImportRows(rows, {
        companyId,
        stores: stores.map((s) => ({ id: s.id, name: s.name })),
        employeeCap: null,
        currentActiveCount: employeeCount,
        skipEmployeeLimit: true,
      });
      if (validation.errors.length > 0) {
        setError(validation.errors[0]?.message || "CSV validation failed.");
        setBusy(null);
        return;
      }
      if (validation.prepared.length === 0) {
        setError("No importable rows found.");
        setBusy(null);
        return;
      }
      const payloads = validation.prepared.map((row) => ({
        ...row.payload,
        pin_code: "1234",
        kiosk_access_enabled: true,
      }));
      const { data: imported, error: insertErr } = await supabase
        .from("employees")
        .insert(payloads)
        .select("id,first_name,last_name");
      setBusy(null);
      if (insertErr) {
        setError(insertErr.message);
        return;
      }
      for (const row of imported || []) {
        await seedEmployeeLeaveBalances(supabase, {
          companyId,
          employeeId: row.id,
          employeeName: `${row.first_name} ${row.last_name}`.trim(),
        });
      }
      setMessage(`Imported ${payloads.length} employee(s) from ${file.name}. Default kiosk PIN: 1234.`);
      onRefresh();
    } catch {
      setBusy(null);
      setError("Could not read CSV file.");
      setFileName(null);
    }
  }

  return (
    <div className="space-y-6">
      <section className="rounded-[1.5rem] border border-white/80 bg-white p-6 shadow-sm">
        <div className="flex items-center gap-2 text-xs font-black uppercase tracking-[0.35em] text-cyan-700">
          <Users className="h-4 w-4" />
          Employee import (~8 min)
        </div>
        <p className="mt-2 text-sm text-slate-500">
          {employeeCount > 0
            ? `${employeeCount} employee(s) on file. Add more via quick start or CSV.`
            : stores.length === 0
              ? "Add a store first, then import employees."
              : "Choose quick start for pilots or upload a completed CSV."}
        </p>

        <div className="mt-6 grid gap-4 lg:grid-cols-2">
          <article className="rounded-2xl border border-cyan-100 bg-cyan-50/50 p-5">
            <div className="text-sm font-black text-slate-950">Quick start (5 staff)</div>
            <p className="mt-2 text-sm text-slate-600">
              Instantly adds five realistic employees with auto PINs for kiosk testing.
            </p>
            <button
              type="button"
              onClick={addQuickEmployees}
              disabled={busy !== null || !companyId || stores.length === 0}
              className="mt-4 flex w-full items-center justify-center gap-2 rounded-2xl bg-[#06101f] px-4 py-3 text-sm font-black text-cyan-300 disabled:opacity-60"
            >
              <UserPlus className="h-4 w-4" />
              {busy === "quick" ? "Adding…" : "Add 5 starter employees"}
            </button>
          </article>

          <article className="rounded-2xl border border-slate-200 bg-slate-50/80 p-5">
            <div className="text-sm font-black text-slate-950">CSV import</div>
            <p className="mt-2 text-sm text-slate-600">
              Download template, fill in Excel, upload here. Kiosk PIN defaults to 1234.
            </p>
            <div className="mt-4 flex flex-col gap-2">
              <button
                type="button"
                onClick={() => downloadStaffImportTemplate()}
                className="flex items-center justify-center gap-2 rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm font-black text-slate-800"
              >
                <Download className="h-4 w-4" />
                Download template
              </button>
              <label className="flex cursor-pointer items-center justify-center gap-2 rounded-2xl bg-[#06101f] px-4 py-3 text-sm font-black text-cyan-300">
                <Upload className="h-4 w-4" />
                {busy === "csv" ? "Importing…" : fileName ? `Uploaded: ${fileName}` : "Upload CSV"}
                <input
                  type="file"
                  accept=".csv,text/csv"
                  className="hidden"
                  disabled={busy !== null || stores.length === 0}
                  onChange={handleCsvUpload}
                />
              </label>
            </div>
          </article>
        </div>

        {onOpenFullImport && (
          <button
            type="button"
            onClick={onOpenFullImport}
            className="mt-4 text-sm font-bold text-cyan-700 underline"
          >
            Open full Import Staff screen for validation preview →
          </button>
        )}
      </section>

      {message && <p className="text-sm font-bold text-emerald-700">{message}</p>}
      {error && <p className="text-sm font-bold text-rose-700">{error}</p>}
    </div>
  );
}

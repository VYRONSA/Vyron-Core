"use client";

import React, { useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  FileText,
  RefreshCcw,
  Search,
  ShieldCheck,
  UserRound,
  XCircle,
} from "lucide-react";
import { supabase } from "../lib/supabase";

type ExceptionRow = {
  id: string;
  exception_type: string;
  severity: string;
  description: string;
  status: string;
  employee_id: string;
  store_id: string | null;
  roster_shift_id?: string | null;
  source?: string | null;
  exception_key?: string | null;
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

type StoreRow = {
  id: string;
  name: string;
  city: string | null;
  region: string | null;
  status: string;
};

function formatText(value: string | null | undefined) {
  if (!value) return "Not set";
  return value.replaceAll("_", " ");
}

function severityClass(value: string) {
  if (value === "critical" || value === "high") return "bg-rose-100 text-rose-700";
  if (value === "medium") return "bg-amber-100 text-amber-700";
  return "bg-blue-100 text-blue-700";
}

function statusClass(value: string) {
  if (value === "closed" || value === "approved") return "bg-emerald-100 text-emerald-700";
  if (value === "dismissed") return "bg-slate-200 text-slate-700";
  return "bg-rose-100 text-rose-700";
}

function isOpenException(item: ExceptionRow) {
  return item.status !== "closed" && item.status !== "approved" && item.status !== "dismissed";
}

export default function ExceptionsActionPanel({
  exceptions,
  employees,
  stores,
  companyId,
  onUpdated,
  onNavigate,
}: {
  exceptions: ExceptionRow[];
  employees: EmployeeRow[];
  stores: StoreRow[];
  companyId: string;
  onUpdated?: () => void | Promise<void>;
  onNavigate?: (value: string) => void;
}) {
  const [selectedException, setSelectedException] = useState<ExceptionRow | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("open");
  const [typeFilter, setTypeFilter] = useState("all");
  const [managerNote, setManagerNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const openCount = useMemo(() => exceptions.filter(isOpenException).length, [exceptions]);
  const criticalCount = useMemo(
    () => exceptions.filter((item) => isOpenException(item) && (item.severity === "critical" || item.severity === "high")).length,
    [exceptions]
  );
  const smartCount = useMemo(
    () => exceptions.filter((item) => item.source === "smart_detection_engine" || item.exception_type === "pattern_risk").length,
    [exceptions]
  );

  const exceptionTypes = useMemo(() => {
    return Array.from(new Set(exceptions.map((item) => item.exception_type).filter(Boolean))).sort();
  }, [exceptions]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();

    return exceptions.filter((item) => {
      if (statusFilter === "open" && !isOpenException(item)) return false;
      if (statusFilter === "closed" && isOpenException(item)) return false;
      if (typeFilter !== "all" && item.exception_type !== typeFilter) return false;

      if (!term) return true;

      const employee = employeeFor(item.employee_id);
      const store = storeFor(item.store_id);

      return [
        item.exception_type,
        item.severity,
        item.status,
        item.description,
        item.source,
        employee?.employee_number,
        employee?.first_name,
        employee?.last_name,
        store?.name,
      ]
        .join(" ")
        .toLowerCase()
        .includes(term);
    });
  }, [exceptions, search, statusFilter, typeFilter]);

  function employeeFor(id: string) {
    return employees.find((employee) => employee.id === id) || null;
  }

  function storeFor(id: string | null) {
    if (!id) return null;
    return stores.find((store) => store.id === id) || null;
  }

  function employeeName(id: string) {
    const employee = employeeFor(id);
    if (!employee) return "Unknown employee";
    return `${employee.first_name} ${employee.last_name}`;
  }

  function employeeCode(id: string) {
    return employeeFor(id)?.employee_number || "No code";
  }

  function storeName(id: string | null) {
    return storeFor(id)?.name || "No store";
  }

  async function updateExceptionStatus(nextStatus: "approved" | "closed" | "dismissed" | "needs_review") {
    if (!selectedException) return;

    setSaving(true);
    setMessage(null);
    setError(null);

    const { error: updateError } = await supabase
      .from("time_exceptions")
      .update({
        status: nextStatus,
        description:
          managerNote.trim()
            ? `${selectedException.description}\n\nManager note: ${managerNote.trim()}`
            : selectedException.description,
      })
      .eq("id", selectedException.id)
      .eq("company_id", companyId);

    if (updateError) {
      setError(updateError.message);
      setSaving(false);
      return;
    }

    setMessage(`Exception marked as ${formatText(nextStatus)}.`);
    setSelectedException(null);
    setManagerNote("");

    if (onUpdated) {
      await onUpdated();
    }

    setSaving(false);
  }

  async function createHrCaseFromException() {
    if (!selectedException) return;

    setSaving(true);
    setMessage(null);
    setError(null);

    const employee = employeeFor(selectedException.employee_id);
    const caseTitle = `${formatText(selectedException.exception_type)} review`;
    const caseDescription =
      `${selectedException.description}\n\nCreated from exception: ${selectedException.id}` +
      (managerNote.trim() ? `\n\nManager note: ${managerNote.trim()}` : "");

    const { error: insertError } = await supabase.from("hr_cases").insert({
      company_id: companyId,
      employee_id: selectedException.employee_id,
      linked_exception_id: selectedException.id,
      case_type: "disciplinary",
      title: caseTitle,
      description: caseDescription,
      validity_status: "review_required",
      status: "open",
      employee_response_required: true,
      employee_response: null,
    });

    if (insertError) {
      setError(insertError.message);
      setSaving(false);
      return;
    }

    await supabase
      .from("time_exceptions")
      .update({
        status: "needs_review",
      })
      .eq("id", selectedException.id)
      .eq("company_id", companyId);

    setMessage(`HR case created for ${employee ? `${employee.first_name} ${employee.last_name}` : "employee"}.`);
    setSelectedException(null);
    setManagerNote("");

    if (onUpdated) {
      await onUpdated();
    }

    setSaving(false);

    if (onNavigate) {
      onNavigate("HR Cases");
    }
  }

  return (
    <section className="mt-8 space-y-8">
      <div className="grid gap-5 md:grid-cols-4">
        <div className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-[0_10px_30px_rgba(0,0,0,0.08)]">
          <div className="text-xs font-black uppercase tracking-[0.2em] text-slate-400">Total exceptions</div>
          <div className="mt-3 text-4xl font-black text-slate-950">{exceptions.length}</div>
          <p className="mt-2 text-sm font-semibold text-slate-500">All exception records</p>
        </div>

        <div className="rounded-[28px] border border-rose-200 bg-rose-50 p-6 text-rose-800">
          <div className="text-xs font-black uppercase tracking-[0.2em] opacity-70">Open exceptions</div>
          <div className="mt-3 text-4xl font-black">{openCount}</div>
          <p className="mt-2 text-sm font-semibold opacity-80">Needs manager action</p>
        </div>

        <div className="rounded-[28px] border border-amber-200 bg-amber-50 p-6 text-amber-800">
          <div className="text-xs font-black uppercase tracking-[0.2em] opacity-70">High risk</div>
          <div className="mt-3 text-4xl font-black">{criticalCount}</div>
          <p className="mt-2 text-sm font-semibold opacity-80">High or critical severity</p>
        </div>

        <div className="rounded-[28px] border border-blue-200 bg-blue-50 p-6 text-blue-800">
          <div className="text-xs font-black uppercase tracking-[0.2em] opacity-70">Smart detected</div>
          <div className="mt-3 text-4xl font-black">{smartCount}</div>
          <p className="mt-2 text-sm font-semibold opacity-80">Created by engine</p>
        </div>
      </div>

      <div className="grid gap-8 xl:grid-cols-[0.95fr_1.05fr]">
        <div className="rounded-[34px] border border-slate-200 bg-white p-6 shadow-[0_10px_30px_rgba(0,0,0,0.08)]">
          <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
            <div>
              <div className="text-xs font-bold uppercase tracking-[0.35em] text-blue-600">Exceptions</div>
              <h2 className="mt-2 text-3xl font-bold text-slate-950">Action Queue</h2>
              <p className="mt-2 text-sm leading-6 text-slate-500">
                Open exceptions, smart detection results and payroll risks appear here.
              </p>
            </div>

            <button
              onClick={() => onUpdated?.()}
              className="flex items-center gap-2 rounded-2xl bg-slate-950 px-5 py-3 text-sm font-bold text-white"
            >
              <RefreshCcw className="h-4 w-4" />
              Refresh
            </button>
          </div>

          <div className="mt-6 grid gap-3 md:grid-cols-[1fr_0.55fr_0.55fr]">
            <div className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
              <Search className="h-5 w-5 text-slate-400" />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search employee, store, risk type..."
                className="w-full bg-transparent text-sm font-semibold outline-none"
              />
            </div>

            <select
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value)}
              className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-bold outline-none"
            >
              <option value="open">Open</option>
              <option value="closed">Closed / resolved</option>
              <option value="all">All</option>
            </select>

            <select
              value={typeFilter}
              onChange={(event) => setTypeFilter(event.target.value)}
              className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-bold outline-none"
            >
              <option value="all">All types</option>
              {exceptionTypes.map((type) => (
                <option key={type} value={type}>
                  {formatText(type)}
                </option>
              ))}
            </select>
          </div>

          <div className="mt-6 space-y-3">
            {filtered.length === 0 ? (
              <div className="rounded-[26px] border border-dashed border-slate-200 bg-slate-50 p-8 text-center">
                <AlertTriangle className="mx-auto h-10 w-10 text-slate-300" />
                <div className="mt-3 text-lg font-bold text-slate-950">No exceptions found</div>
                <p className="mt-2 text-sm text-slate-500">
                  Run Smart Detection or change the filters.
                </p>
              </div>
            ) : (
              filtered.map((item) => {
                const selected = selectedException?.id === item.id;

                return (
                  <button
                    key={item.id}
                    onClick={() => {
                      setSelectedException(item);
                      setManagerNote("");
                      setMessage(null);
                      setError(null);
                    }}
                    className={`w-full rounded-[24px] border p-5 text-left transition hover:-translate-y-0.5 hover:shadow-lg ${
                      selected ? "border-blue-400 bg-blue-50" : "border-slate-200 bg-slate-50"
                    }`}
                  >
                    <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                      <div>
                        <div className="font-black text-slate-950">{formatText(item.exception_type)}</div>
                        <div className="mt-1 text-xs font-semibold text-slate-500">
                          {employeeName(item.employee_id)} · {employeeCode(item.employee_id)} · {storeName(item.store_id)}
                        </div>
                      </div>

                      <div className="flex flex-wrap gap-2">
                        <span className={`rounded-full px-3 py-1 text-xs font-black uppercase ${severityClass(item.severity)}`}>
                          {item.severity}
                        </span>
                        <span className={`rounded-full px-3 py-1 text-xs font-black uppercase ${statusClass(item.status)}`}>
                          {formatText(item.status)}
                        </span>
                      </div>
                    </div>

                    <p className="mt-3 line-clamp-2 text-sm leading-6 text-slate-600">{item.description}</p>
                  </button>
                );
              })
            )}
          </div>
        </div>

        <div className="rounded-[34px] border border-slate-200 bg-white p-6 shadow-[0_10px_30px_rgba(0,0,0,0.08)]">
          {!selectedException ? (
            <div className="flex min-h-[620px] flex-col items-center justify-center text-center">
              <ShieldCheck className="h-14 w-14 text-slate-300" />
              <h3 className="mt-4 text-2xl font-bold text-slate-950">Select an exception</h3>
              <p className="mt-2 max-w-md text-sm leading-6 text-slate-500">
                Choose a record from the action queue to approve, close, dismiss or create an HR case.
              </p>
            </div>
          ) : (
            <>
              <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                <div>
                  <div className="text-xs font-bold uppercase tracking-[0.35em] text-blue-600">Exception Detail</div>
                  <h2 className="mt-2 text-3xl font-bold text-slate-950">
                    {formatText(selectedException.exception_type)}
                  </h2>
                  <p className="mt-2 text-sm font-semibold text-slate-500">
                    {employeeName(selectedException.employee_id)} · {employeeCode(selectedException.employee_id)}
                  </p>
                </div>

                <div className="flex flex-wrap gap-2">
                  <span className={`rounded-full px-3 py-1 text-xs font-black uppercase ${severityClass(selectedException.severity)}`}>
                    {selectedException.severity}
                  </span>
                  <span className={`rounded-full px-3 py-1 text-xs font-black uppercase ${statusClass(selectedException.status)}`}>
                    {formatText(selectedException.status)}
                  </span>
                </div>
              </div>

              <div className="mt-6 grid gap-3 md:grid-cols-2">
                <InfoTile label="Employee" value={employeeName(selectedException.employee_id)} />
                <InfoTile label="Store" value={storeName(selectedException.store_id)} />
                <InfoTile label="Source" value={selectedException.source || "manual"} />
                <InfoTile label="Exception Key" value={selectedException.exception_key || "No key"} />
              </div>

              <div className="mt-5 rounded-2xl bg-slate-50 p-5">
                <div className="text-xs font-black uppercase tracking-[0.2em] text-slate-400">Description</div>
                <p className="mt-3 whitespace-pre-wrap text-sm leading-7 text-slate-700">
                  {selectedException.description}
                </p>
              </div>

              <label className="mt-5 block text-sm font-bold text-slate-800">
                Manager Note
                <textarea
                  value={managerNote}
                  onChange={(event) => setManagerNote(event.target.value)}
                  rows={5}
                  className="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-semibold outline-none focus:border-blue-500"
                  placeholder="Optional note before closing, approving, dismissing or creating HR case..."
                />
              </label>

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

              <div className="mt-6 grid gap-3 md:grid-cols-2">
                <button
                  onClick={() => updateExceptionStatus("approved")}
                  disabled={saving}
                  className="flex items-center justify-center gap-2 rounded-2xl bg-emerald-600 px-5 py-4 text-sm font-black text-white disabled:bg-slate-300"
                >
                  <CheckCircle2 className="h-4 w-4" />
                  Approve
                </button>

                <button
                  onClick={() => updateExceptionStatus("closed")}
                  disabled={saving}
                  className="flex items-center justify-center gap-2 rounded-2xl bg-slate-950 px-5 py-4 text-sm font-black text-white disabled:bg-slate-300"
                >
                  <ShieldCheck className="h-4 w-4" />
                  Close
                </button>

                <button
                  onClick={() => updateExceptionStatus("dismissed")}
                  disabled={saving}
                  className="flex items-center justify-center gap-2 rounded-2xl bg-slate-100 px-5 py-4 text-sm font-black text-slate-700 disabled:bg-slate-300"
                >
                  <XCircle className="h-4 w-4" />
                  Dismiss
                </button>

                <button
                  onClick={createHrCaseFromException}
                  disabled={saving}
                  className="flex items-center justify-center gap-2 rounded-2xl bg-blue-600 px-5 py-4 text-sm font-black text-white disabled:bg-slate-300"
                >
                  <FileText className="h-4 w-4" />
                  Create HR Case
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </section>
  );
}

function InfoTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl bg-slate-50 p-4">
      <div className="text-xs font-black uppercase tracking-[0.2em] text-slate-400">{label}</div>
      <div className="mt-2 break-words text-sm font-bold text-slate-950">{value}</div>
    </div>
  );
}

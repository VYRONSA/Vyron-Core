"use client";

import React, { useMemo, useState } from "react";
import {
  AlertTriangle,
  CalendarDays,
  Download,
  FileText,
  RefreshCcw,
  Search,
  ShieldCheck,
} from "lucide-react";
import { supabase } from "../lib/supabase";

type LeaveDecisionAuditRow = {
  id: string;
  leave_request_id: string;
  employee_id: string | null;
  employee_name: string | null;
  leave_type: string | null;
  start_date: string | null;
  end_date: string | null;
  old_status: string | null;
  new_status: string | null;
  manager_feedback: string | null;
  changed_by: string | null;
  changed_source: string;
  changed_at: string;
  created_at: string;
};

function todayIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

function monthStartIsoDate() {
  const date = new Date();
  date.setDate(1);
  return date.toISOString().slice(0, 10);
}

function formatText(value: string | null | undefined) {
  if (!value) return "Not set";
  return value.replaceAll("_", " ");
}

function formatDate(value: string | null | undefined) {
  if (!value) return "Not set";

  try {
    return new Date(`${value}T12:00:00`).toLocaleDateString("en-ZA", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  } catch {
    return value;
  }
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

function csvEscape(value: unknown) {
  return `"${String(value ?? "").replaceAll('"', '""')}"`;
}

function downloadCsv(filename: string, rows: Array<Array<string | number | null | undefined>>) {
  const csv = rows.map((row) => row.map(csvEscape).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function statusTone(value: string | null | undefined) {
  if (value === "approved") return "bg-emerald-100 text-emerald-700";
  if (value === "declined") return "bg-rose-100 text-rose-700";
  if (value === "amended") return "bg-blue-100 text-blue-700";
  if (value === "pending") return "bg-amber-100 text-amber-700";
  return "bg-slate-200 text-slate-700";
}

export default function LeaveDecisionAuditPanel() {
  const [auditRows, setAuditRows] = useState<LeaveDecisionAuditRow[]>([]);
  const [startDate, setStartDate] = useState(monthStartIsoDate());
  const [endDate, setEndDate] = useState(todayIsoDate());
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [loading, setLoading] = useState(false);
  const [hasRun, setHasRun] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const filteredRows = useMemo(() => {
    const term = search.trim().toLowerCase();

    return auditRows.filter((row) => {
      const statusMatches = statusFilter === "all" || row.new_status === statusFilter;

      if (!statusMatches) return false;

      if (!term) return true;

      return [
        row.employee_id,
        row.employee_name,
        row.leave_type,
        row.old_status,
        row.new_status,
        row.manager_feedback,
        row.changed_by,
        row.changed_source,
      ]
        .join(" ")
        .toLowerCase()
        .includes(term);
    });
  }, [auditRows, search, statusFilter]);

  const approvedCount = useMemo(
    () => auditRows.filter((row) => row.new_status === "approved").length,
    [auditRows]
  );

  const declinedCount = useMemo(
    () => auditRows.filter((row) => row.new_status === "declined").length,
    [auditRows]
  );

  const amendedCount = useMemo(
    () => auditRows.filter((row) => row.new_status === "amended").length,
    [auditRows]
  );

  async function loadAuditTrail() {
    setLoading(true);
    setError(null);
    setHasRun(true);

    const dateFrom = `${startDate}T00:00:00+02:00`;
    const dateTo = `${endDate}T23:59:59+02:00`;

    const { data, error: fetchError } = await supabase
      .from("leave_decision_audit")
      .select("*")
      .gte("changed_at", dateFrom)
      .lte("changed_at", dateTo)
      .order("changed_at", { ascending: false })
      .limit(500);

    if (fetchError) {
      setError(fetchError.message);
      setLoading(false);
      return;
    }

    setAuditRows((data || []) as LeaveDecisionAuditRow[]);
    setLoading(false);
  }

  function exportAuditTrail() {
    downloadCsv(`vyron-leave-decision-audit-${startDate}-to-${endDate}.csv`, [
      [
        "Changed At",
        "Employee Code",
        "Employee Name",
        "Leave Type",
        "Leave Start",
        "Leave End",
        "Old Status",
        "New Status",
        "Manager Feedback",
        "Changed By",
        "Changed Source",
        "Leave Request ID",
      ],
      ...filteredRows.map((row) => [
        row.changed_at,
        row.employee_id || "",
        row.employee_name || "",
        formatText(row.leave_type),
        row.start_date || "",
        row.end_date || "",
        formatText(row.old_status),
        formatText(row.new_status),
        row.manager_feedback || "",
        row.changed_by || "",
        row.changed_source || "",
        row.leave_request_id,
      ]),
    ]);
  }

  return (
    <div className="mt-8 space-y-8">
      <section className="rounded-[34px] bg-gradient-to-r from-[#07101f] to-[#0b1a33] p-6 text-white shadow-2xl shadow-slate-300">
        <div className="flex flex-col gap-5 md:flex-row md:items-center md:justify-between">
          <div>
            <div className="text-xs font-bold uppercase tracking-[0.4em] text-cyan-300">
              Leave Governance
            </div>
            <h2 className="mt-3 text-4xl font-bold">Leave Decision Audit Trail</h2>
            <p className="mt-4 max-w-3xl text-sm leading-7 text-slate-300">
              View every leave approval, decline and amendment with who changed it,
              when it changed, what the old status was and what feedback was captured.
            </p>
          </div>

          <ShieldCheck className="h-12 w-12 text-cyan-300" />
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-4">
        <div className="rounded-[28px] border border-slate-200 bg-white p-5">
          <div className="text-xs font-black uppercase tracking-[0.2em] text-slate-400">
            Records Loaded
          </div>
          <div className="mt-3 text-4xl font-black text-slate-950">{filteredRows.length}</div>
          <p className="mt-2 text-sm font-semibold text-slate-500">Current filtered results</p>
        </div>

        <div className="rounded-[28px] border border-emerald-200 bg-emerald-50 p-5 text-emerald-800">
          <div className="text-xs font-black uppercase tracking-[0.2em] opacity-70">
            Approved
          </div>
          <div className="mt-3 text-4xl font-black">{approvedCount}</div>
          <p className="mt-2 text-sm font-semibold opacity-80">Approved decisions</p>
        </div>

        <div className="rounded-[28px] border border-rose-200 bg-rose-50 p-5 text-rose-800">
          <div className="text-xs font-black uppercase tracking-[0.2em] opacity-70">
            Declined
          </div>
          <div className="mt-3 text-4xl font-black">{declinedCount}</div>
          <p className="mt-2 text-sm font-semibold opacity-80">Declined decisions</p>
        </div>

        <div className="rounded-[28px] border border-blue-200 bg-blue-50 p-5 text-blue-800">
          <div className="text-xs font-black uppercase tracking-[0.2em] opacity-70">
            Amended
          </div>
          <div className="mt-3 text-4xl font-black">{amendedCount}</div>
          <p className="mt-2 text-sm font-semibold opacity-80">Amended decisions</p>
        </div>
      </section>

      <section className="rounded-[34px] border border-slate-200 bg-white p-6 shadow-[0_10px_30px_rgba(0,0,0,0.08)]">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <div className="text-xs font-bold uppercase tracking-[0.35em] text-blue-600">
              Audit Search
            </div>
            <h3 className="mt-2 text-3xl font-bold text-slate-950">
              Calendar Filter
            </h3>
            <p className="mt-2 text-sm text-slate-500">
              Select a start and end date, then run the report.
            </p>
          </div>

          <div className="grid w-full gap-3 md:grid-cols-[1fr_1fr_1fr_auto_auto] xl:w-auto">
            <label className="text-sm font-bold text-slate-800">
              Start date
              <input
                type="date"
                value={startDate}
                onChange={(event) => setStartDate(event.target.value)}
                className="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 outline-none focus:border-blue-500"
              />
            </label>

            <label className="text-sm font-bold text-slate-800">
              End date
              <input
                type="date"
                value={endDate}
                onChange={(event) => setEndDate(event.target.value)}
                className="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 outline-none focus:border-blue-500"
              />
            </label>

            <label className="text-sm font-bold text-slate-800">
              Status
              <select
                value={statusFilter}
                onChange={(event) => setStatusFilter(event.target.value)}
                className="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 font-bold outline-none focus:border-blue-500"
              >
                <option value="all">All</option>
                <option value="approved">Approved</option>
                <option value="declined">Declined</option>
                <option value="amended">Amended</option>
                <option value="pending">Pending</option>
              </select>
            </label>

            <button
              onClick={loadAuditTrail}
              disabled={loading}
              className="mt-7 rounded-2xl bg-slate-950 px-5 py-3 text-sm font-bold text-white disabled:opacity-60"
            >
              <RefreshCcw className="mr-2 inline h-4 w-4" />
              {loading ? "Loading..." : "Run"}
            </button>

            <button
              onClick={exportAuditTrail}
              disabled={filteredRows.length === 0}
              className="mt-7 rounded-2xl bg-blue-600 px-5 py-3 text-sm font-bold text-white disabled:bg-slate-300"
            >
              <Download className="mr-2 inline h-4 w-4" />
              Export
            </button>
          </div>
        </div>

        <div className="mt-5 flex items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
          <Search className="h-5 w-5 text-slate-400" />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search by employee, status, feedback or manager..."
            className="w-full bg-transparent text-sm font-semibold outline-none"
          />
        </div>

        {error && (
          <div className="mt-5 rounded-2xl bg-rose-50 p-4 text-sm font-semibold text-rose-700">
            <AlertTriangle className="mr-2 inline h-4 w-4" />
            {error}
          </div>
        )}

        {loading ? (
          <div className="mt-6 rounded-[26px] border border-dashed border-slate-200 bg-slate-50 p-8 text-center text-sm font-semibold text-slate-500">
            Loading audit trail...
          </div>
        ) : filteredRows.length === 0 ? (
          <div className="mt-6 rounded-[26px] border border-dashed border-slate-200 bg-slate-50 p-8 text-center">
            <FileText className="mx-auto h-10 w-10 text-slate-300" />
            <div className="mt-3 text-lg font-bold text-slate-950">
              {hasRun ? "No audit records found" : "Run the audit report"}
            </div>
            <p className="mt-2 text-sm text-slate-500">
              {hasRun
                ? "No leave decision records matched your selected filters."
                : "Select dates and click Run to load leave decision history."}
            </p>
          </div>
        ) : (
          <div className="mt-6 space-y-4">
            {filteredRows.map((row) => (
              <article
                key={row.id}
                className="rounded-[26px] border border-slate-200 bg-slate-50 p-5"
              >
                <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                  <div>
                    <div className="text-xl font-bold text-slate-950">
                      {row.employee_name || "Unknown employee"}
                    </div>
                    <div className="mt-1 text-xs font-semibold text-slate-500">
                      {row.employee_id || "No employee code"} · {formatText(row.leave_type)}
                    </div>
                  </div>

                  <span
                    className={`w-fit rounded-full px-3 py-1 text-xs font-black uppercase ${statusTone(
                      row.new_status
                    )}`}
                  >
                    {formatText(row.old_status)} → {formatText(row.new_status)}
                  </span>
                </div>

                <div className="mt-4 grid gap-3 md:grid-cols-4">
                  <InfoTile label="Leave Start" value={formatDate(row.start_date)} />
                  <InfoTile label="Leave End" value={formatDate(row.end_date)} />
                  <InfoTile label="Changed At" value={formatDateTime(row.changed_at)} />
                  <InfoTile label="Changed By" value={row.changed_by || "Unknown"} />
                </div>

                {row.manager_feedback && (
                  <div className="mt-4 rounded-2xl bg-white p-4">
                    <div className="text-xs font-black uppercase tracking-[0.2em] text-slate-400">
                      Manager Feedback
                    </div>
                    <p className="mt-2 text-sm leading-6 text-slate-700">
                      {row.manager_feedback}
                    </p>
                  </div>
                )}
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function InfoTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl bg-white p-4">
      <div className="text-xs font-black uppercase tracking-[0.2em] text-slate-400">
        {label}
      </div>
      <div className="mt-2 text-sm font-bold text-slate-950">{value}</div>
    </div>
  );
}

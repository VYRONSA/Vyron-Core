"use client";

import React, { useMemo, useState } from "react";
import {
  AlertTriangle,
  CalendarDays,
  Clock3,
  Download,
  FileText,
  Gavel,
  RefreshCcw,
  Search,
} from "lucide-react";
import { supabase } from "../lib/supabase";

type ReportTab = "leave" | "hr" | "clocking";

type LeaveHistoryRow = {
  id: string;
  employee_id: string | null;
  employee_name: string | null;
  leave_type: string | null;
  start_date: string;
  end_date: string;
  reason: string | null;
  status: string;
  manager_feedback: string | null;
  created_at: string;
};

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

type HrCaseRow = {
  id: string;
  employee_id: string;
  linked_exception_id: string | null;
  case_type: string;
  title: string;
  description: string;
  validity_status: string;
  status: string;
  employee_response_required: boolean | null;
  employee_response: string | null;
};

type HrDocumentRow = {
  id: string;
  employee_id: string;
  employee_name: string;
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

type ClockingHistoryRow = {
  id: string;
  employee_id: string;
  store_id: string | null;
  roster_shift_id: string | null;
  event_type: string;
  event_time: string;
  source: string;
  latitude: number | null;
  longitude: number | null;
  employee_name?: string;
  store_name?: string;
};

type EmployeeRow = {
  id: string;
  employee_number: string | null;
  first_name: string;
  last_name: string;
};

type StoreRow = {
  id: string;
  name: string;
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

function employeeDisplayName(employee: EmployeeRow | undefined) {
  if (!employee) return "Unknown employee";
  return `${employee.first_name || ""} ${employee.last_name || ""}`.trim() || "Unknown employee";
}

function tabTitle(tab: ReportTab) {
  if (tab === "leave") return "Leave History";
  if (tab === "hr") return "HR History";
  return "Clocking History";
}

export default function HistoryReportsPanel() {
  const [activeTab, setActiveTab] = useState<ReportTab>("leave");
  const [startDate, setStartDate] = useState(monthStartIsoDate());
  const [endDate, setEndDate] = useState(todayIsoDate());
  const [search, setSearch] = useState("");

  const [leaveRows, setLeaveRows] = useState<LeaveHistoryRow[]>([]);
  const [hrWarnings, setHrWarnings] = useState<HrWarningRow[]>([]);
  const [hrCases, setHrCases] = useState<HrCaseRow[]>([]);
  const [hrDocuments, setHrDocuments] = useState<HrDocumentRow[]>([]);
  const [clockRows, setClockRows] = useState<ClockingHistoryRow[]>([]);
  const [employees, setEmployees] = useState<EmployeeRow[]>([]);
  const [stores, setStores] = useState<StoreRow[]>([]);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const employeeById = useMemo(() => {
    const map = new Map<string, EmployeeRow>();
    employees.forEach((employee) => map.set(employee.id, employee));
    return map;
  }, [employees]);

  const storeById = useMemo(() => {
    const map = new Map<string, StoreRow>();
    stores.forEach((store) => map.set(store.id, store));
    return map;
  }, [stores]);

  const filteredLeaveRows = useMemo(() => {
    const term = search.trim().toLowerCase();

    if (!term) return leaveRows;

    return leaveRows.filter((row) =>
      [
        row.employee_id,
        row.employee_name,
        row.leave_type,
        row.reason,
        row.status,
        row.manager_feedback,
      ]
        .join(" ")
        .toLowerCase()
        .includes(term)
    );
  }, [leaveRows, search]);

  const filteredHrWarnings = useMemo(() => {
    const term = search.trim().toLowerCase();

    if (!term) return hrWarnings;

    return hrWarnings.filter((row) =>
      [
        row.employee_id,
        row.employee_name,
        row.warning_type,
        row.incident_type,
        row.severity,
        row.description,
        row.manager_notes,
        row.status,
      ]
        .join(" ")
        .toLowerCase()
        .includes(term)
    );
  }, [hrWarnings, search]);

  const filteredHrCases = useMemo(() => {
    const term = search.trim().toLowerCase();

    if (!term) return hrCases;

    return hrCases.filter((row) => {
      const employee = employeeById.get(row.employee_id);

      return [
        employeeDisplayName(employee),
        row.case_type,
        row.title,
        row.description,
        row.validity_status,
        row.status,
        row.employee_response,
      ]
        .join(" ")
        .toLowerCase()
        .includes(term);
    });
  }, [hrCases, search, employeeById]);

  const filteredHrDocuments = useMemo(() => {
    const term = search.trim().toLowerCase();

    if (!term) return hrDocuments;

    return hrDocuments.filter((row) =>
      [
        row.employee_id,
        row.employee_name,
        row.document_type,
        row.document_title,
        row.document_notes,
        row.file_name,
        row.status,
        row.uploaded_by,
      ]
        .join(" ")
        .toLowerCase()
        .includes(term)
    );
  }, [hrDocuments, search]);

  const filteredClockRows = useMemo(() => {
    const term = search.trim().toLowerCase();

    if (!term) return clockRows;

    return clockRows.filter((row) =>
      [
        row.employee_name,
        row.store_name,
        row.event_type,
        row.source,
        row.event_time,
      ]
        .join(" ")
        .toLowerCase()
        .includes(term)
    );
  }, [clockRows, search]);

  const totalHrRows =
    filteredHrWarnings.length + filteredHrCases.length + filteredHrDocuments.length;

  async function loadReports() {
    setLoading(true);
    setError(null);

    const dateFrom = `${startDate}T00:00:00+02:00`;
    const dateTo = `${endDate}T23:59:59+02:00`;

    const [employeesResult, storesResult] = await Promise.all([
      supabase
        .from("employees")
        .select("id,employee_number,first_name,last_name"),
      supabase
        .from("stores")
        .select("id,name"),
    ]);

    if (employeesResult.data) {
      setEmployees(employeesResult.data as EmployeeRow[]);
    }

    if (storesResult.data) {
      setStores(storesResult.data as StoreRow[]);
    }

    if (activeTab === "leave") {
      const { data, error: leaveError } = await supabase
        .from("leave_requests")
        .select("*")
        .or(`and(start_date.gte.${startDate},start_date.lte.${endDate}),and(end_date.gte.${startDate},end_date.lte.${endDate}),and(start_date.lte.${startDate},end_date.gte.${endDate})`)
        .order("start_date", { ascending: false });

      if (leaveError) {
        setError(leaveError.message);
        setLoading(false);
        return;
      }

      setLeaveRows((data || []) as LeaveHistoryRow[]);
    }

    if (activeTab === "hr") {
      const [warningsResult, casesResult, documentsResult] = await Promise.all([
        supabase
          .from("hr_warnings")
          .select("*")
          .gte("incident_date", startDate)
          .lte("incident_date", endDate)
          .order("incident_date", { ascending: false }),
        supabase
          .from("hr_cases")
          .select("*")
          .order("case_type", { ascending: true }),
        supabase
          .from("hr_documents")
          .select("*")
          .gte("created_at", dateFrom)
          .lte("created_at", dateTo)
          .order("created_at", { ascending: false }),
      ]);

      if (warningsResult.error) {
        setError(warningsResult.error.message);
        setLoading(false);
        return;
      }

      if (casesResult.error) {
        setError(casesResult.error.message);
        setLoading(false);
        return;
      }

      if (documentsResult.error) {
        setError(documentsResult.error.message);
        setLoading(false);
        return;
      }

      setHrWarnings((warningsResult.data || []) as HrWarningRow[]);
      setHrCases((casesResult.data || []) as HrCaseRow[]);
      setHrDocuments((documentsResult.data || []) as HrDocumentRow[]);
    }

    if (activeTab === "clocking") {
      const { data, error: clockError } = await supabase
        .from("clock_events")
        .select("*")
        .gte("event_time", dateFrom)
        .lte("event_time", dateTo)
        .order("event_time", { ascending: false });

      if (clockError) {
        setError(clockError.message);
        setLoading(false);
        return;
      }

      const rawRows = (data || []) as ClockingHistoryRow[];

      const employeeMap = new Map<string, EmployeeRow>();
      (employeesResult.data || []).forEach((employee) =>
        employeeMap.set(employee.id, employee as EmployeeRow)
      );

      const storeMap = new Map<string, StoreRow>();
      (storesResult.data || []).forEach((store) => storeMap.set(store.id, store as StoreRow));

      const hydratedRows = rawRows.map((row) => ({
        ...row,
        employee_name: employeeDisplayName(employeeMap.get(row.employee_id)),
        store_name: row.store_id ? storeMap.get(row.store_id)?.name || "Unknown store" : "No store",
      }));

      setClockRows(hydratedRows);
    }

    setLoading(false);
  }

  function exportCurrentReport() {
    if (activeTab === "leave") {
      downloadCsv(`vyron-leave-history-${startDate}-to-${endDate}.csv`, [
        [
          "Employee Code",
          "Employee Name",
          "Leave Type",
          "Start Date",
          "End Date",
          "Status",
          "Reason",
          "Manager Feedback",
          "Created At",
        ],
        ...filteredLeaveRows.map((row) => [
          row.employee_id || "",
          row.employee_name || "",
          formatText(row.leave_type),
          row.start_date,
          row.end_date,
          row.status,
          row.reason || "",
          row.manager_feedback || "",
          row.created_at,
        ]),
      ]);
    }

    if (activeTab === "hr") {
      downloadCsv(`vyron-hr-history-${startDate}-to-${endDate}.csv`, [
        [
          "Record Type",
          "Employee Code",
          "Employee Name",
          "Type",
          "Title / Incident",
          "Date",
          "Status",
          "Severity / Validity",
          "Description / Notes",
        ],
        ...filteredHrWarnings.map((row) => [
          "Warning",
          row.employee_id,
          row.employee_name,
          row.warning_type,
          row.incident_type,
          row.incident_date,
          row.status,
          row.severity,
          row.description,
        ]),
        ...filteredHrCases.map((row) => {
          const employee = employeeById.get(row.employee_id);

          return [
            "HR Case",
            row.employee_id,
            employeeDisplayName(employee),
            row.case_type,
            row.title,
            "",
            row.status,
            row.validity_status,
            row.description,
          ];
        }),
        ...filteredHrDocuments.map((row) => [
          "Document",
          row.employee_id,
          row.employee_name,
          row.document_type,
          row.document_title,
          row.created_at,
          row.status,
          "",
          row.document_notes || row.file_name || "",
        ]),
      ]);
    }

    if (activeTab === "clocking") {
      downloadCsv(`vyron-clocking-history-${startDate}-to-${endDate}.csv`, [
        [
          "Employee ID",
          "Employee Name",
          "Store",
          "Event Type",
          "Event Time",
          "Source",
          "Latitude",
          "Longitude",
        ],
        ...filteredClockRows.map((row) => [
          row.employee_id,
          row.employee_name || "",
          row.store_name || "",
          formatText(row.event_type),
          row.event_time,
          row.source,
          row.latitude,
          row.longitude,
        ]),
      ]);
    }
  }

  return (
    <div className="mt-8 space-y-8">
      <section className="rounded-[34px] bg-gradient-to-r from-[#07101f] to-[#0b1a33] p-6 text-white shadow-2xl shadow-slate-300">
        <div className="flex flex-col gap-5 md:flex-row md:items-center md:justify-between">
          <div>
            <div className="text-xs font-bold uppercase tracking-[0.4em] text-cyan-300">
              History Reports
            </div>
            <h2 className="mt-3 text-4xl font-bold">Leave, HR & Clocking History</h2>
            <p className="mt-4 max-w-3xl text-sm leading-7 text-slate-300">
              Pull full history reports by selecting a calendar start date and end date.
              Export each report to CSV for payroll, HR records or management review.
            </p>
          </div>

          <button
            onClick={loadReports}
            disabled={loading}
            className="flex w-fit items-center gap-2 rounded-2xl bg-white px-5 py-3 text-sm font-bold text-slate-950 disabled:opacity-60"
          >
            <RefreshCcw className="h-4 w-4" />
            {loading ? "Loading..." : "Run Report"}
          </button>
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-3">
        <button
          onClick={() => setActiveTab("leave")}
          className={`rounded-[28px] border p-5 text-left transition ${
            activeTab === "leave"
              ? "border-blue-400 bg-blue-50 text-blue-900"
              : "border-slate-200 bg-white text-slate-900 hover:bg-slate-50"
          }`}
        >
          <CalendarDays className="h-7 w-7" />
          <div className="mt-4 text-2xl font-black">Leave History</div>
          <p className="mt-2 text-sm font-semibold opacity-70">
            {filteredLeaveRows.length} records loaded
          </p>
        </button>

        <button
          onClick={() => setActiveTab("hr")}
          className={`rounded-[28px] border p-5 text-left transition ${
            activeTab === "hr"
              ? "border-blue-400 bg-blue-50 text-blue-900"
              : "border-slate-200 bg-white text-slate-900 hover:bg-slate-50"
          }`}
        >
          <Gavel className="h-7 w-7" />
          <div className="mt-4 text-2xl font-black">HR History</div>
          <p className="mt-2 text-sm font-semibold opacity-70">
            {totalHrRows} records loaded
          </p>
        </button>

        <button
          onClick={() => setActiveTab("clocking")}
          className={`rounded-[28px] border p-5 text-left transition ${
            activeTab === "clocking"
              ? "border-blue-400 bg-blue-50 text-blue-900"
              : "border-slate-200 bg-white text-slate-900 hover:bg-slate-50"
          }`}
        >
          <Clock3 className="h-7 w-7" />
          <div className="mt-4 text-2xl font-black">Clocking History</div>
          <p className="mt-2 text-sm font-semibold opacity-70">
            {filteredClockRows.length} records loaded
          </p>
        </button>
      </section>

      <section className="rounded-[34px] border border-slate-200 bg-white p-6 shadow-[0_10px_30px_rgba(0,0,0,0.08)]">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <div className="text-xs font-bold uppercase tracking-[0.35em] text-blue-600">
              {tabTitle(activeTab)}
            </div>
            <h3 className="mt-2 text-3xl font-bold text-slate-950">
              Calendar Filter
            </h3>
            <p className="mt-2 text-sm text-slate-500">
              Select the start date and end date, then click Run Report.
            </p>
          </div>

          <div className="grid w-full gap-3 md:grid-cols-[1fr_1fr_auto_auto] xl:w-auto">
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

            <button
              onClick={loadReports}
              disabled={loading}
              className="mt-7 rounded-2xl bg-slate-950 px-5 py-3 text-sm font-bold text-white disabled:opacity-60"
            >
              <RefreshCcw className="mr-2 inline h-4 w-4" />
              Run
            </button>

            <button
              onClick={exportCurrentReport}
              className="mt-7 rounded-2xl bg-blue-600 px-5 py-3 text-sm font-bold text-white"
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
            placeholder="Search current report..."
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
            Loading report...
          </div>
        ) : activeTab === "leave" ? (
          <div className="mt-6 space-y-3">
            {filteredLeaveRows.length === 0 ? (
              <EmptyReport message="No leave history found for this date range." />
            ) : (
              filteredLeaveRows.map((row) => (
                <article key={row.id} className="rounded-[24px] border border-slate-200 bg-slate-50 p-5">
                  <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                    <div>
                      <div className="text-lg font-bold text-slate-950">
                        {row.employee_name || "Unknown employee"}
                      </div>
                      <div className="mt-1 text-xs font-semibold text-slate-500">
                        {row.employee_id || "No code"} · {formatText(row.leave_type)}
                      </div>
                    </div>

                    <span className="w-fit rounded-full bg-blue-100 px-3 py-1 text-xs font-black uppercase text-blue-700">
                      {formatText(row.status)}
                    </span>
                  </div>

                  <div className="mt-4 grid gap-3 md:grid-cols-3">
                    <InfoBlock label="Start" value={formatDate(row.start_date)} />
                    <InfoBlock label="End" value={formatDate(row.end_date)} />
                    <InfoBlock label="Created" value={formatDateTime(row.created_at)} />
                  </div>

                  <p className="mt-4 text-sm leading-6 text-slate-600">
                    {row.reason || "No reason supplied."}
                  </p>

                  {row.manager_feedback && (
                    <div className="mt-3 rounded-2xl bg-white p-4 text-sm leading-6 text-slate-700">
                      Manager feedback: {row.manager_feedback}
                    </div>
                  )}
                </article>
              ))
            )}
          </div>
        ) : activeTab === "hr" ? (
          <div className="mt-6 space-y-6">
            {totalHrRows === 0 ? (
              <EmptyReport message="No HR history found for this date range." />
            ) : (
              <>
                <ReportGroup title="Warnings" count={filteredHrWarnings.length}>
                  {filteredHrWarnings.map((row) => (
                    <article key={row.id} className="rounded-[24px] border border-slate-200 bg-slate-50 p-5">
                      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                        <div>
                          <div className="text-lg font-bold text-slate-950">
                            {row.employee_name}
                          </div>
                          <div className="mt-1 text-xs font-semibold text-slate-500">
                            {row.employee_id} · {formatText(row.warning_type)}
                          </div>
                        </div>

                        <span className="w-fit rounded-full bg-rose-100 px-3 py-1 text-xs font-black uppercase text-rose-700">
                          {formatText(row.severity)}
                        </span>
                      </div>

                      <div className="mt-4 grid gap-3 md:grid-cols-3">
                        <InfoBlock label="Incident Date" value={formatDate(row.incident_date)} />
                        <InfoBlock label="Issue Date" value={formatDate(row.issue_date)} />
                        <InfoBlock label="Status" value={formatText(row.status)} />
                      </div>

                      <p className="mt-4 text-sm leading-6 text-slate-600">
                        {row.description}
                      </p>
                    </article>
                  ))}
                </ReportGroup>

                <ReportGroup title="HR Cases" count={filteredHrCases.length}>
                  {filteredHrCases.map((row) => {
                    const employee = employeeById.get(row.employee_id);

                    return (
                      <article key={row.id} className="rounded-[24px] border border-slate-200 bg-slate-50 p-5">
                        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                          <div>
                            <div className="text-lg font-bold text-slate-950">
                              {employeeDisplayName(employee)}
                            </div>
                            <div className="mt-1 text-xs font-semibold text-slate-500">
                              {row.employee_id} · {formatText(row.case_type)}
                            </div>
                          </div>

                          <span className="w-fit rounded-full bg-amber-100 px-3 py-1 text-xs font-black uppercase text-amber-700">
                            {formatText(row.status)}
                          </span>
                        </div>

                        <div className="mt-4 rounded-2xl bg-white p-4">
                          <div className="font-bold text-slate-950">{row.title}</div>
                          <p className="mt-2 text-sm leading-6 text-slate-600">
                            {row.description}
                          </p>
                        </div>
                      </article>
                    );
                  })}
                </ReportGroup>

                <ReportGroup title="HR Documents" count={filteredHrDocuments.length}>
                  {filteredHrDocuments.map((row) => (
                    <article key={row.id} className="rounded-[24px] border border-slate-200 bg-slate-50 p-5">
                      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                        <div>
                          <div className="text-lg font-bold text-slate-950">
                            {row.employee_name}
                          </div>
                          <div className="mt-1 text-xs font-semibold text-slate-500">
                            {row.employee_id} · {formatText(row.document_type)}
                          </div>
                        </div>

                        <span className="w-fit rounded-full bg-slate-200 px-3 py-1 text-xs font-black uppercase text-slate-700">
                          {formatText(row.status)}
                        </span>
                      </div>

                      <div className="mt-4 rounded-2xl bg-white p-4">
                        <div className="font-bold text-slate-950">{row.document_title}</div>
                        <div className="mt-2 text-sm text-slate-600">
                          {row.file_name || "No file name"}
                        </div>
                      </div>
                    </article>
                  ))}
                </ReportGroup>
              </>
            )}
          </div>
        ) : (
          <div className="mt-6 space-y-3">
            {filteredClockRows.length === 0 ? (
              <EmptyReport message="No clocking history found for this date range." />
            ) : (
              filteredClockRows.map((row) => (
                <article key={row.id} className="rounded-[24px] border border-slate-200 bg-slate-50 p-5">
                  <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                    <div>
                      <div className="text-lg font-bold text-slate-950">
                        {row.employee_name || "Unknown employee"}
                      </div>
                      <div className="mt-1 text-xs font-semibold text-slate-500">
                        {row.store_name || "No store"} · {row.source}
                      </div>
                    </div>

                    <span className="w-fit rounded-full bg-cyan-100 px-3 py-1 text-xs font-black uppercase text-cyan-700">
                      {formatText(row.event_type)}
                    </span>
                  </div>

                  <div className="mt-4 grid gap-3 md:grid-cols-3">
                    <InfoBlock label="Event Time" value={formatDateTime(row.event_time)} />
                    <InfoBlock label="Latitude" value={row.latitude === null ? "Not captured" : String(row.latitude)} />
                    <InfoBlock label="Longitude" value={row.longitude === null ? "Not captured" : String(row.longitude)} />
                  </div>
                </article>
              ))
            )}
          </div>
        )}
      </section>
    </div>
  );
}

function InfoBlock({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl bg-white p-4">
      <div className="text-xs font-black uppercase tracking-[0.2em] text-slate-400">
        {label}
      </div>
      <div className="mt-2 text-sm font-bold text-slate-950">{value}</div>
    </div>
  );
}

function EmptyReport({ message }: { message: string }) {
  return (
    <div className="rounded-[26px] border border-dashed border-slate-200 bg-slate-50 p-8 text-center">
      <FileText className="mx-auto h-10 w-10 text-slate-300" />
      <div className="mt-3 text-lg font-bold text-slate-950">No records found</div>
      <p className="mt-2 text-sm text-slate-500">{message}</p>
    </div>
  );
}

function ReportGroup({
  title,
  count,
  children,
}: {
  title: string;
  count: number;
  children: React.ReactNode;
}) {
  return (
    <section>
      <div className="mb-3 flex items-center justify-between gap-4">
        <h4 className="text-xl font-black text-slate-950">{title}</h4>
        <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-bold text-slate-600">
          {count} records
        </span>
      </div>

      <div className="space-y-3">{children}</div>
    </section>
  );
}

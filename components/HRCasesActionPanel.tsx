"use client";

import React, { useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  FileText,
  Gavel,
  RefreshCcw,
  Search,
  UserRound,
} from "lucide-react";
import { supabase } from "../lib/supabase";

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

function formatText(value: string | null | undefined) {
  if (!value) return "Not set";
  return value.replaceAll("_", " ");
}

function statusClass(value: string) {
  if (value === "closed") return "bg-emerald-100 text-emerald-700";
  if (value === "open") return "bg-rose-100 text-rose-700";
  return "bg-amber-100 text-amber-700";
}

function validityClass(value: string) {
  if (value === "valid") return "bg-emerald-100 text-emerald-700";
  if (value === "invalid") return "bg-rose-100 text-rose-700";
  return "bg-amber-100 text-amber-700";
}

function isOpenCase(item: HrCaseRow) {
  return item.status !== "closed";
}

export default function HRCasesActionPanel({
  hrCases,
  employees,
  exceptions,
  companyId,
  onUpdated,
}: {
  hrCases: HrCaseRow[];
  employees: EmployeeRow[];
  exceptions: ExceptionRow[];
  companyId: string;
  onUpdated?: () => void | Promise<void>;
}) {
  const [selectedCase, setSelectedCase] = useState<HrCaseRow | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("open");
  const [caseTypeFilter, setCaseTypeFilter] = useState("all");
  const [employeeResponse, setEmployeeResponse] = useState("");
  const [managerNote, setManagerNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newEmployeeId, setNewEmployeeId] = useState("");
  const [newCaseType, setNewCaseType] = useState("disciplinary");
  const [newTitle, setNewTitle] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [newResponseRequired, setNewResponseRequired] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const openCount = useMemo(() => hrCases.filter(isOpenCase).length, [hrCases]);
  const closedCount = useMemo(() => hrCases.filter((item) => item.status === "closed").length, [hrCases]);
  const responseRequiredCount = useMemo(
    () => hrCases.filter((item) => item.status !== "closed" && item.employee_response_required).length,
    [hrCases]
  );

  const caseTypes = useMemo(
    () => Array.from(new Set(hrCases.map((item) => item.case_type).filter(Boolean))).sort(),
    [hrCases]
  );

  const filteredCases = useMemo(() => {
    const term = search.trim().toLowerCase();

    return hrCases.filter((item) => {
      if (statusFilter === "open" && !isOpenCase(item)) return false;
      if (statusFilter === "closed" && item.status !== "closed") return false;
      if (caseTypeFilter !== "all" && item.case_type !== caseTypeFilter) return false;

      if (!term) return true;

      const employee = employeeFor(item.employee_id);
      const linkedException = item.linked_exception_id
        ? exceptions.find((exception) => exception.id === item.linked_exception_id)
        : null;

      return [
        item.case_type,
        item.title,
        item.description,
        item.validity_status,
        item.status,
        item.employee_response,
        employee?.employee_number,
        employee?.first_name,
        employee?.last_name,
        linkedException?.exception_type,
      ]
        .join(" ")
        .toLowerCase()
        .includes(term);
    });
  }, [hrCases, search, statusFilter, caseTypeFilter, employees, exceptions]);

  function employeeFor(id: string) {
    return employees.find((employee) => employee.id === id) || null;
  }

  function employeeName(id: string) {
    const employee = employeeFor(id);
    if (!employee) return "Unknown employee";
    return `${employee.first_name} ${employee.last_name}`;
  }

  function employeeCode(id: string) {
    return employeeFor(id)?.employee_number || "No code";
  }

  function linkedException(caseRow: HrCaseRow | null) {
    if (!caseRow?.linked_exception_id) return null;
    return exceptions.find((item) => item.id === caseRow.linked_exception_id) || null;
  }

  async function updateCase(values: Partial<HrCaseRow>, successMessage: string) {
    if (!selectedCase) return;

    setSaving(true);
    setMessage(null);
    setError(null);

    const { error: updateError } = await supabase
      .from("hr_cases")
      .update(values)
      .eq("id", selectedCase.id);

    if (updateError) {
      setError(updateError.message);
      setSaving(false);
      return;
    }

    setMessage(successMessage);
    setSelectedCase(null);
    setEmployeeResponse("");
    setManagerNote("");

    if (onUpdated) {
      await onUpdated();
    }

    setSaving(false);
  }

  async function saveEmployeeResponse() {
    if (!selectedCase) return;

    if (!employeeResponse.trim()) {
      setError("Employee response cannot be blank.");
      return;
    }

    await updateCase(
      {
        employee_response: employeeResponse.trim(),
        employee_response_required: false,
        validity_status: "review_required",
      },
      "Employee response saved."
    );
  }

  async function closeCase() {
    if (!selectedCase) return;

    const finalDescription =
      managerNote.trim()
        ? `${selectedCase.description}\n\nClosing note: ${managerNote.trim()}`
        : selectedCase.description;

    await updateCase(
      {
        status: "closed",
        validity_status: selectedCase.validity_status === "invalid" ? "review_required" : "valid",
        description: finalDescription,
        employee_response_required: false,
      },
      "HR case closed."
    );
  }

  async function reopenCase() {
    if (!selectedCase) return;

    await updateCase(
      {
        status: "open",
        validity_status: "review_required",
      },
      "HR case reopened."
    );
  }

  async function createCase() {
    setSaving(true);
    setMessage(null);
    setError(null);

    if (!newEmployeeId) {
      setError("Select an employee.");
      setSaving(false);
      return;
    }

    if (!newTitle.trim() || !newDescription.trim()) {
      setError("Title and description are required.");
      setSaving(false);
      return;
    }

    const { error: insertError } = await supabase.from("hr_cases").insert({
      company_id: companyId,
      employee_id: newEmployeeId,
      linked_exception_id: null,
      case_type: newCaseType,
      title: newTitle.trim(),
      description: newDescription.trim(),
      validity_status: "review_required",
      status: "open",
      employee_response_required: newResponseRequired,
      employee_response: null,
    });

    if (insertError) {
      setError(insertError.message);
      setSaving(false);
      return;
    }

    setMessage("HR case created.");
    setCreating(false);
    setNewEmployeeId("");
    setNewCaseType("disciplinary");
    setNewTitle("");
    setNewDescription("");
    setNewResponseRequired(true);

    if (onUpdated) {
      await onUpdated();
    }

    setSaving(false);
  }

  function openCase(item: HrCaseRow) {
    setSelectedCase(item);
    setEmployeeResponse(item.employee_response || "");
    setManagerNote("");
    setMessage(null);
    setError(null);
    setCreating(false);
  }

  const selectedLinkedException = linkedException(selectedCase);

  return (
    <section className="mt-8 space-y-8">
      <div className="grid gap-5 md:grid-cols-4">
        <div className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-[0_10px_30px_rgba(0,0,0,0.08)]">
          <div className="text-xs font-black uppercase tracking-[0.2em] text-slate-400">Total HR cases</div>
          <div className="mt-3 text-4xl font-black text-slate-950">{hrCases.length}</div>
          <p className="mt-2 text-sm font-semibold text-slate-500">All HR case records</p>
        </div>

        <div className="rounded-[28px] border border-rose-200 bg-rose-50 p-6 text-rose-800">
          <div className="text-xs font-black uppercase tracking-[0.2em] opacity-70">Open cases</div>
          <div className="mt-3 text-4xl font-black">{openCount}</div>
          <p className="mt-2 text-sm font-semibold opacity-80">Needs manager action</p>
        </div>

        <div className="rounded-[28px] border border-amber-200 bg-amber-50 p-6 text-amber-800">
          <div className="text-xs font-black uppercase tracking-[0.2em] opacity-70">Responses needed</div>
          <div className="mt-3 text-4xl font-black">{responseRequiredCount}</div>
          <p className="mt-2 text-sm font-semibold opacity-80">Employee side outstanding</p>
        </div>

        <div className="rounded-[28px] border border-emerald-200 bg-emerald-50 p-6 text-emerald-800">
          <div className="text-xs font-black uppercase tracking-[0.2em] opacity-70">Closed</div>
          <div className="mt-3 text-4xl font-black">{closedCount}</div>
          <p className="mt-2 text-sm font-semibold opacity-80">HR history completed</p>
        </div>
      </div>

      <div className="grid gap-8 xl:grid-cols-[0.95fr_1.05fr]">
        <div className="rounded-[34px] border border-slate-200 bg-white p-6 shadow-[0_10px_30px_rgba(0,0,0,0.08)]">
          <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
            <div>
              <div className="text-xs font-bold uppercase tracking-[0.35em] text-blue-600">HR Cases</div>
              <h2 className="mt-2 text-3xl font-bold text-slate-950">Case Register</h2>
              <p className="mt-2 text-sm leading-6 text-slate-500">
                Open, close, review and record employee responses.
              </p>
            </div>

            <button
              onClick={() => {
                setCreating(true);
                setSelectedCase(null);
                setMessage(null);
                setError(null);
              }}
              className="rounded-2xl bg-slate-950 px-5 py-3 text-sm font-bold text-white"
            >
              + Create HR Case
            </button>
          </div>

          <div className="mt-6 grid gap-3 md:grid-cols-[1fr_0.55fr_0.55fr]">
            <div className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
              <Search className="h-5 w-5 text-slate-400" />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search employee, case, response..."
                className="w-full bg-transparent text-sm font-semibold outline-none"
              />
            </div>

            <select
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value)}
              className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-bold outline-none"
            >
              <option value="open">Open</option>
              <option value="closed">Closed</option>
              <option value="all">All</option>
            </select>

            <select
              value={caseTypeFilter}
              onChange={(event) => setCaseTypeFilter(event.target.value)}
              className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-bold outline-none"
            >
              <option value="all">All types</option>
              {caseTypes.map((type) => (
                <option key={type} value={type}>{formatText(type)}</option>
              ))}
            </select>
          </div>

          <div className="mt-6 space-y-3">
            {filteredCases.length === 0 ? (
              <div className="rounded-[26px] border border-dashed border-slate-200 bg-slate-50 p-8 text-center">
                <Gavel className="mx-auto h-10 w-10 text-slate-300" />
                <div className="mt-3 text-lg font-bold text-slate-950">No HR cases found</div>
                <p className="mt-2 text-sm text-slate-500">Create a case or change the filters.</p>
              </div>
            ) : (
              filteredCases.map((item) => {
                const selected = selectedCase?.id === item.id;

                return (
                  <button
                    key={item.id}
                    onClick={() => openCase(item)}
                    className={`w-full rounded-[24px] border p-5 text-left transition hover:-translate-y-0.5 hover:shadow-lg ${
                      selected ? "border-blue-400 bg-blue-50" : "border-slate-200 bg-slate-50"
                    }`}
                  >
                    <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                      <div>
                        <div className="font-black text-slate-950">{item.title}</div>
                        <div className="mt-1 text-xs font-semibold text-slate-500">
                          {employeeName(item.employee_id)} · {employeeCode(item.employee_id)} · {formatText(item.case_type)}
                        </div>
                      </div>

                      <div className="flex flex-wrap gap-2">
                        <span className={`rounded-full px-3 py-1 text-xs font-black uppercase ${statusClass(item.status)}`}>
                          {formatText(item.status)}
                        </span>
                        <span className={`rounded-full px-3 py-1 text-xs font-black uppercase ${validityClass(item.validity_status)}`}>
                          {formatText(item.validity_status)}
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
          {creating ? (
            <>
              <div className="text-xs font-bold uppercase tracking-[0.35em] text-blue-600">New HR Case</div>
              <h2 className="mt-2 text-3xl font-bold text-slate-950">Create HR Case</h2>
              <p className="mt-2 text-sm leading-6 text-slate-500">
                Add a manual HR case and attach it to an employee history.
              </p>

              <div className="mt-6 space-y-4">
                <label className="block text-sm font-bold text-slate-800">
                  Employee
                  <select
                    value={newEmployeeId}
                    onChange={(event) => setNewEmployeeId(event.target.value)}
                    className="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-bold outline-none focus:border-blue-500"
                  >
                    <option value="">Select employee</option>
                    {employees.filter((item) => item.active).map((employee) => (
                      <option key={employee.id} value={employee.id}>
                        {employee.first_name} {employee.last_name} · {employee.employee_number || "No code"}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="block text-sm font-bold text-slate-800">
                  Case type
                  <select
                    value={newCaseType}
                    onChange={(event) => setNewCaseType(event.target.value)}
                    className="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-bold outline-none focus:border-blue-500"
                  >
                    <option value="disciplinary">Disciplinary</option>
                    <option value="counselling">Counselling</option>
                    <option value="warning">Warning</option>
                    <option value="investigation">Investigation</option>
                    <option value="written_warning">Written warning</option>
                    <option value="final_written_warning">Final written warning</option>
                  </select>
                </label>

                <label className="block text-sm font-bold text-slate-800">
                  Title
                  <input
                    value={newTitle}
                    onChange={(event) => setNewTitle(event.target.value)}
                    className="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-bold outline-none focus:border-blue-500"
                    placeholder="Late arrival discussion"
                  />
                </label>

                <label className="block text-sm font-bold text-slate-800">
                  Description
                  <textarea
                    value={newDescription}
                    onChange={(event) => setNewDescription(event.target.value)}
                    rows={6}
                    className="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-bold outline-none focus:border-blue-500"
                    placeholder="Describe what happened and what must be reviewed..."
                  />
                </label>

                <label className="flex items-center gap-3 rounded-2xl bg-slate-50 p-4 text-sm font-bold text-slate-800">
                  <input
                    type="checkbox"
                    checked={newResponseRequired}
                    onChange={(event) => setNewResponseRequired(event.target.checked)}
                    className="h-4 w-4"
                  />
                  Employee response required
                </label>
              </div>

              {error && (
                <div className="mt-5 rounded-2xl bg-rose-50 p-4 text-sm font-semibold text-rose-700">
                  <AlertTriangle className="mr-2 inline h-4 w-4" />
                  {error}
                </div>
              )}

              {message && (
                <div className="mt-5 rounded-2xl bg-emerald-50 p-4 text-sm font-semibold text-emerald-700">
                  <CheckCircle2 className="mr-2 inline h-4 w-4" />
                  {message}
                </div>
              )}

              <div className="mt-6 grid gap-3 md:grid-cols-2">
                <button
                  onClick={() => setCreating(false)}
                  className="rounded-2xl bg-slate-100 px-5 py-4 text-sm font-black text-slate-700"
                >
                  Cancel
                </button>

                <button
                  onClick={createCase}
                  disabled={saving}
                  className="rounded-2xl bg-slate-950 px-5 py-4 text-sm font-black text-white disabled:bg-slate-300"
                >
                  Save HR Case
                </button>
              </div>
            </>
          ) : !selectedCase ? (
            <div className="flex min-h-[680px] flex-col items-center justify-center text-center">
              <FileText className="h-14 w-14 text-slate-300" />
              <h3 className="mt-4 text-2xl font-bold text-slate-950">Select or create a case</h3>
              <p className="mt-2 max-w-md text-sm leading-6 text-slate-500">
                Choose a case to manage it, or create a new manual HR case.
              </p>
            </div>
          ) : (
            <>
              <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                <div>
                  <div className="text-xs font-bold uppercase tracking-[0.35em] text-blue-600">Case Detail</div>
                  <h2 className="mt-2 text-3xl font-bold text-slate-950">{selectedCase.title}</h2>
                  <p className="mt-2 text-sm font-semibold text-slate-500">
                    {employeeName(selectedCase.employee_id)} · {employeeCode(selectedCase.employee_id)}
                  </p>
                </div>

                <div className="flex flex-wrap gap-2">
                  <span className={`rounded-full px-3 py-1 text-xs font-black uppercase ${statusClass(selectedCase.status)}`}>
                    {formatText(selectedCase.status)}
                  </span>
                  <span className={`rounded-full px-3 py-1 text-xs font-black uppercase ${validityClass(selectedCase.validity_status)}`}>
                    {formatText(selectedCase.validity_status)}
                  </span>
                </div>
              </div>

              <div className="mt-6 grid gap-3 md:grid-cols-2">
                <InfoTile label="Case Type" value={formatText(selectedCase.case_type)} />
                <InfoTile label="Response Required" value={selectedCase.employee_response_required ? "Yes" : "No"} />
                <InfoTile label="Linked Exception" value={selectedLinkedException ? formatText(selectedLinkedException.exception_type) : "No linked exception"} />
                <InfoTile label="Employee" value={employeeName(selectedCase.employee_id)} />
              </div>

              <div className="mt-5 rounded-2xl bg-slate-50 p-5">
                <div className="text-xs font-black uppercase tracking-[0.2em] text-slate-400">Case Description</div>
                <p className="mt-3 whitespace-pre-wrap text-sm leading-7 text-slate-700">
                  {selectedCase.description}
                </p>
              </div>

              {selectedLinkedException && (
                <div className="mt-5 rounded-2xl bg-amber-50 p-5">
                  <div className="text-xs font-black uppercase tracking-[0.2em] text-amber-700">Linked Exception</div>
                  <p className="mt-3 text-sm leading-7 text-amber-900">
                    {selectedLinkedException.description}
                  </p>
                </div>
              )}

              <label className="mt-5 block text-sm font-bold text-slate-800">
                Employee Response
                <textarea
                  value={employeeResponse}
                  onChange={(event) => setEmployeeResponse(event.target.value)}
                  rows={5}
                  className="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-semibold outline-none focus:border-blue-500"
                  placeholder="Capture employee side of story..."
                />
              </label>

              <label className="mt-5 block text-sm font-bold text-slate-800">
                Closing / Manager Note
                <textarea
                  value={managerNote}
                  onChange={(event) => setManagerNote(event.target.value)}
                  rows={4}
                  className="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-semibold outline-none focus:border-blue-500"
                  placeholder="Optional note before closing..."
                />
              </label>

              {error && (
                <div className="mt-5 rounded-2xl bg-rose-50 p-4 text-sm font-semibold text-rose-700">
                  <AlertTriangle className="mr-2 inline h-4 w-4" />
                  {error}
                </div>
              )}

              {message && (
                <div className="mt-5 rounded-2xl bg-emerald-50 p-4 text-sm font-semibold text-emerald-700">
                  <CheckCircle2 className="mr-2 inline h-4 w-4" />
                  {message}
                </div>
              )}

              <div className="mt-6 grid gap-3 md:grid-cols-3">
                <button
                  onClick={saveEmployeeResponse}
                  disabled={saving}
                  className="rounded-2xl bg-blue-600 px-5 py-4 text-sm font-black text-white disabled:bg-slate-300"
                >
                  Save Response
                </button>

                {selectedCase.status === "closed" ? (
                  <button
                    onClick={reopenCase}
                    disabled={saving}
                    className="rounded-2xl bg-amber-500 px-5 py-4 text-sm font-black text-white disabled:bg-slate-300"
                  >
                    Reopen
                  </button>
                ) : (
                  <button
                    onClick={closeCase}
                    disabled={saving}
                    className="rounded-2xl bg-emerald-600 px-5 py-4 text-sm font-black text-white disabled:bg-slate-300"
                  >
                    Close Case
                  </button>
                )}

                <button
                  onClick={() => setSelectedCase(null)}
                  className="rounded-2xl bg-slate-100 px-5 py-4 text-sm font-black text-slate-700"
                >
                  Clear
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

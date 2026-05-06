"use client";

import { useMemo, useState } from "react";
import {
  AlertTriangle,
  CalendarDays,
  CheckCircle2,
  Clock3,
  LockKeyhole,
  Search,
  UserRound,
  XCircle,
} from "lucide-react";
import { supabase } from "../../lib/supabase";

type EmployeeRow = {
  id: string;
  employee_number: string | null;
  first_name: string;
  last_name: string;
  active: boolean;
  pin_code: string | null;
  kiosk_access_enabled: boolean | null;
};

type LeaveRequestRow = {
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

function fullName(employee: EmployeeRow | null) {
  if (!employee) return "";
  return `${employee.first_name || ""} ${employee.last_name || ""}`.trim();
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

function leaveDays(startDate: string, endDate: string) {
  if (!startDate || !endDate) return 0;

  const start = new Date(`${startDate}T12:00:00`);
  const end = new Date(`${endDate}T12:00:00`);
  const difference = end.getTime() - start.getTime();

  if (difference < 0) return 0;

  return Math.floor(difference / (1000 * 60 * 60 * 24)) + 1;
}

function statusTone(status: string) {
  if (status === "approved") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (status === "declined") return "border-rose-200 bg-rose-50 text-rose-700";
  if (status === "amended") return "border-blue-200 bg-blue-50 text-blue-700";
  return "border-amber-200 bg-amber-50 text-amber-700";
}

function statusIcon(status: string) {
  if (status === "approved") return <CheckCircle2 className="h-5 w-5" />;
  if (status === "declined") return <XCircle className="h-5 w-5" />;
  if (status === "amended") return <AlertTriangle className="h-5 w-5" />;
  return <Clock3 className="h-5 w-5" />;
}

export default function LeaveStatusPage() {
  const [employeeCode, setEmployeeCode] = useState("");
  const [pinCode, setPinCode] = useState("");
  const [employee, setEmployee] = useState<EmployeeRow | null>(null);
  const [leaveRequests, setLeaveRequests] = useState<LeaveRequestRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [authenticated, setAuthenticated] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pendingCount = useMemo(
    () => leaveRequests.filter((leave) => leave.status === "pending").length,
    [leaveRequests]
  );

  const approvedCount = useMemo(
    () => leaveRequests.filter((leave) => leave.status === "approved").length,
    [leaveRequests]
  );

  const declinedOrAmendedCount = useMemo(
    () =>
      leaveRequests.filter(
        (leave) => leave.status === "declined" || leave.status === "amended"
      ).length,
    [leaveRequests]
  );

  async function checkLeaveStatus() {
    setLoading(true);
    setError(null);
    setAuthenticated(false);
    setEmployee(null);
    setLeaveRequests([]);

    const code = employeeCode.trim();

    if (!code) {
      setError("Employee code is required.");
      setLoading(false);
      return;
    }

    if (!pinCode.trim()) {
      setError("PIN code is required.");
      setLoading(false);
      return;
    }

    const { data: employeeData, error: employeeError } = await supabase
      .from("employees")
      .select("id,employee_number,first_name,last_name,active,pin_code,kiosk_access_enabled")
      .eq("employee_number", code)
      .maybeSingle();

    if (employeeError) {
      setError(employeeError.message);
      setLoading(false);
      return;
    }

    if (!employeeData) {
      setError("Employee code was not found.");
      setLoading(false);
      return;
    }

    const loadedEmployee = employeeData as EmployeeRow;

    if (loadedEmployee.active === false) {
      setError("This employee is not active.");
      setLoading(false);
      return;
    }

    if (loadedEmployee.kiosk_access_enabled === false) {
      setError("Kiosk access is disabled for this employee.");
      setLoading(false);
      return;
    }

    if (!loadedEmployee.pin_code) {
      setError("No PIN is set for this employee. Please ask a manager to create one.");
      setLoading(false);
      return;
    }

    if (pinCode.trim() !== loadedEmployee.pin_code) {
      setError("Incorrect PIN code.");
      setLoading(false);
      return;
    }

    const { data: leaveData, error: leaveError } = await supabase
      .from("leave_requests")
      .select("*")
      .eq("employee_id", loadedEmployee.employee_number || loadedEmployee.id)
      .order("created_at", { ascending: false })
      .limit(50);

    if (leaveError) {
      setError(leaveError.message);
      setLoading(false);
      return;
    }

    setEmployee(loadedEmployee);
    setLeaveRequests((leaveData || []) as LeaveRequestRow[]);
    setAuthenticated(true);
    setLoading(false);
  }

  function reset() {
    setEmployeeCode("");
    setPinCode("");
    setEmployee(null);
    setLeaveRequests([]);
    setAuthenticated(false);
    setError(null);
  }

  return (
    <main className="min-h-screen bg-[#f6f8fb] p-4 text-slate-950 md:p-8">
      <section className="mx-auto max-w-5xl">
        <header className="rounded-[34px] bg-gradient-to-r from-[#07101f] to-[#0b1a33] p-6 text-white shadow-2xl shadow-slate-300 md:p-7">
          <div className="flex items-center gap-4">
            <div className="relative h-12 w-12 rounded-2xl bg-gradient-to-br from-blue-600 to-cyan-400 shadow-lg shadow-blue-500/30">
              <div className="absolute left-[13px] top-[10px] h-8 w-3 rotate-[-28deg] rounded-sm bg-white" />
              <div className="absolute right-[13px] top-[10px] h-8 w-3 rotate-[28deg] rounded-sm bg-slate-950/80" />
            </div>

            <div>
              <div className="text-2xl font-black tracking-[0.34em] text-white">
                VYRON
              </div>
              <div className="mt-[-2px] text-xs font-semibold tracking-[0.55em] text-cyan-300">
                CORE
              </div>
            </div>
          </div>

          <div className="mt-8 text-xs font-bold uppercase tracking-[0.4em] text-cyan-300">
            Employee Leave Kiosk
          </div>

          <h1 className="mt-3 text-4xl font-black tracking-tight md:text-5xl">
            Leave Status
          </h1>

          <p className="mt-4 max-w-2xl text-sm leading-7 text-slate-300">
            Employees can securely check pending, approved, declined and amended leave
            applications using their employee code and PIN.
          </p>
        </header>

        <section className="mt-6 grid gap-6 lg:grid-cols-[0.75fr_1.25fr]">
          <div className="rounded-[34px] border border-slate-200 bg-white p-6 shadow-[0_10px_30px_rgba(0,0,0,0.08)]">
            <div className="text-xs font-bold uppercase tracking-[0.35em] text-blue-600">
              Secure Lookup
            </div>

            <h2 className="mt-2 text-3xl font-bold text-slate-950">
              Check Status
            </h2>

            <p className="mt-2 text-sm leading-6 text-slate-500">
              Enter your employee code and PIN. Nothing is pre-filled for privacy.
            </p>

            <label className="mt-6 block text-sm font-bold text-slate-800">
              Employee Code
              <div className="mt-2 flex items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                <Search className="h-5 w-5 text-slate-400" />
                <input
                  value={employeeCode}
                  onChange={(event) => {
                    setEmployeeCode(event.target.value.toUpperCase());
                    setError(null);
                  }}
                  autoComplete="off"
                  className="w-full bg-transparent text-sm font-semibold text-slate-950 outline-none"
                  placeholder="Enter employee code"
                />
              </div>
            </label>

            <label className="mt-4 block text-sm font-bold text-slate-800">
              PIN Code
              <div className="mt-2 flex items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                <LockKeyhole className="h-5 w-5 text-slate-400" />
                <input
                  type="password"
                  value={pinCode}
                  onChange={(event) => {
                    setPinCode(event.target.value.replace(/\D/g, "").slice(0, 4));
                    setError(null);
                  }}
                  autoComplete="new-password"
                  inputMode="numeric"
                  maxLength={4}
                  className="w-full bg-transparent text-sm font-semibold text-slate-950 outline-none"
                  placeholder="Enter 4-digit PIN"
                />
              </div>
            </label>

            {error && (
              <div className="mt-5 rounded-2xl bg-rose-50 p-4 text-sm font-semibold text-rose-700">
                {error}
              </div>
            )}

            <button
              onClick={checkLeaveStatus}
              disabled={loading}
              className="mt-6 w-full rounded-2xl bg-slate-950 px-5 py-4 text-sm font-black text-white disabled:bg-slate-300 disabled:text-slate-500"
            >
              {loading ? "Checking..." : "Check Leave Status"}
            </button>

            {authenticated && (
              <button
                onClick={reset}
                className="mt-3 w-full rounded-2xl bg-slate-100 px-5 py-4 text-sm font-black text-slate-700"
              >
                Clear Screen
              </button>
            )}
          </div>

          <div className="rounded-[34px] border border-slate-200 bg-white p-6 shadow-[0_10px_30px_rgba(0,0,0,0.08)]">
            {!authenticated || !employee ? (
              <div className="flex min-h-[520px] flex-col items-center justify-center text-center">
                <CalendarDays className="h-14 w-14 text-slate-300" />
                <h2 className="mt-4 text-2xl font-bold text-slate-950">
                  Leave records will appear here
                </h2>
                <p className="mt-2 max-w-md text-sm leading-6 text-slate-500">
                  Once the employee code and PIN are verified, the employee can see
                  their latest leave applications and manager feedback.
                </p>
              </div>
            ) : (
              <>
                <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                  <div>
                    <div className="text-xs font-bold uppercase tracking-[0.35em] text-blue-600">
                      Employee
                    </div>
                    <h2 className="mt-2 text-3xl font-bold text-slate-950">
                      {fullName(employee)}
                    </h2>
                    <p className="mt-2 text-sm font-semibold text-slate-500">
                      {employee.employee_number || employee.id}
                    </p>
                  </div>

                  <UserRound className="h-9 w-9 text-blue-600" />
                </div>

                <div className="mt-6 grid gap-3 md:grid-cols-3">
                  <div className="rounded-2xl bg-amber-50 p-4 text-amber-800">
                    <div className="text-xs font-black uppercase tracking-[0.2em]">
                      Pending
                    </div>
                    <div className="mt-2 text-3xl font-black">{pendingCount}</div>
                  </div>

                  <div className="rounded-2xl bg-emerald-50 p-4 text-emerald-800">
                    <div className="text-xs font-black uppercase tracking-[0.2em]">
                      Approved
                    </div>
                    <div className="mt-2 text-3xl font-black">{approvedCount}</div>
                  </div>

                  <div className="rounded-2xl bg-slate-100 p-4 text-slate-800">
                    <div className="text-xs font-black uppercase tracking-[0.2em]">
                      Other
                    </div>
                    <div className="mt-2 text-3xl font-black">
                      {declinedOrAmendedCount}
                    </div>
                  </div>
                </div>

                <div className="mt-6 space-y-4">
                  {leaveRequests.length === 0 ? (
                    <div className="rounded-[26px] border border-dashed border-slate-200 bg-slate-50 p-8 text-center">
                      <CalendarDays className="mx-auto h-10 w-10 text-slate-300" />
                      <div className="mt-3 text-lg font-bold text-slate-950">
                        No leave applications found
                      </div>
                      <p className="mt-2 text-sm text-slate-500">
                        Submitted leave applications will appear here.
                      </p>
                    </div>
                  ) : (
                    leaveRequests.map((leave) => (
                      <article
                        key={leave.id}
                        className="rounded-[26px] border border-slate-200 bg-slate-50 p-5"
                      >
                        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                          <div>
                            <div className="text-lg font-bold text-slate-950">
                              {formatText(leave.leave_type)}
                            </div>
                            <div className="mt-1 text-xs font-semibold text-slate-500">
                              Submitted {formatDateTime(leave.created_at)}
                            </div>
                          </div>

                          <span
                            className={`flex w-fit items-center gap-2 rounded-full border px-3 py-1 text-xs font-black uppercase ${statusTone(
                              leave.status
                            )}`}
                          >
                            {statusIcon(leave.status)}
                            {formatText(leave.status)}
                          </span>
                        </div>

                        <div className="mt-4 grid gap-3 md:grid-cols-3">
                          <div className="rounded-2xl bg-white p-4">
                            <div className="text-xs font-black uppercase tracking-[0.2em] text-slate-400">
                              Start
                            </div>
                            <div className="mt-2 text-sm font-bold text-slate-950">
                              {formatDate(leave.start_date)}
                            </div>
                          </div>

                          <div className="rounded-2xl bg-white p-4">
                            <div className="text-xs font-black uppercase tracking-[0.2em] text-slate-400">
                              End
                            </div>
                            <div className="mt-2 text-sm font-bold text-slate-950">
                              {formatDate(leave.end_date)}
                            </div>
                          </div>

                          <div className="rounded-2xl bg-white p-4">
                            <div className="text-xs font-black uppercase tracking-[0.2em] text-slate-400">
                              Days
                            </div>
                            <div className="mt-2 text-sm font-bold text-slate-950">
                              {leaveDays(leave.start_date, leave.end_date)} day(s)
                            </div>
                          </div>
                        </div>

                        {leave.reason && (
                          <div className="mt-4 rounded-2xl bg-white p-4">
                            <div className="text-xs font-black uppercase tracking-[0.2em] text-slate-400">
                              Employee Reason
                            </div>
                            <p className="mt-2 text-sm leading-6 text-slate-700">
                              {leave.reason}
                            </p>
                          </div>
                        )}

                        {leave.manager_feedback && (
                          <div className="mt-4 rounded-2xl bg-blue-50 p-4">
                            <div className="text-xs font-black uppercase tracking-[0.2em] text-blue-700">
                              Manager Feedback
                            </div>
                            <p className="mt-2 text-sm leading-6 text-blue-900">
                              {leave.manager_feedback}
                            </p>
                          </div>
                        )}
                      </article>
                    ))
                  )}
                </div>
              </>
            )}
          </div>
        </section>
      </section>
    </main>
  );
}

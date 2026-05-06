"use client";

import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CalendarDays,
  CheckCircle2,
  Clock3,
  LockKeyhole,
  Search,
  Send,
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

type LeaveBalanceLiveRow = {
  id: string;
  employee_id: string;
  employee_name: string;
  leave_type: string;
  opening_balance_days: number;
  cycle_leave_entitlement_days: number;
  monthly_accrual_days: number;
  completed_months: number;
  days_accrued_live: number;
  days_taken: number;
  pending_days: number;
  adjustment_days: number;
  carry_forward_days: number;
  days_due_live: number;
  status: string;
};

function fullName(employee: EmployeeRow | null) {
  if (!employee) return "";
  return `${employee.first_name || ""} ${employee.last_name || ""}`.trim();
}

function todayIsoDate() {
  return new Date().toISOString().slice(0, 10);
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

function normaliseLeaveType(value: string) {
  if (value === "annual_leave") return "annual_leave";
  if (value === "sick_leave") return "sick_leave";
  if (value === "family_responsibility_leave") return "family_responsibility_leave";
  if (value === "unpaid_leave") return "unpaid_leave";
  if (value === "study_leave") return "study_leave";
  return "other";
}

function formatDays(value: number | string | null | undefined) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed.toFixed(2) : "0.00";
}

export default function LeavePage() {
  const [employees, setEmployees] = useState<EmployeeRow[]>([]);
  const [employeeCode, setEmployeeCode] = useState("");
  const [pinCode, setPinCode] = useState("");
  const [employee, setEmployee] = useState<EmployeeRow | null>(null);
  const [authenticated, setAuthenticated] = useState(false);

  const [leaveType, setLeaveType] = useState("annual_leave");
  const [startDate, setStartDate] = useState(todayIsoDate());
  const [endDate, setEndDate] = useState(todayIsoDate());
  const [reason, setReason] = useState("");

  const [leaveRequests, setLeaveRequests] = useState<LeaveRequestRow[]>([]);
  const [leaveBalances, setLeaveBalances] = useState<LeaveBalanceLiveRow[]>([]);
  const [loadingEmployees, setLoadingEmployees] = useState(true);
  const [checkingPin, setCheckingPin] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [lookupMessage, setLookupMessage] = useState<string | null>(null);
  const [submitMessage, setSubmitMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const selectedEmployee = useMemo(() => {
    const code = employeeCode.trim().toLowerCase();

    if (!code) return null;

    return (
      employees.find(
        (item) => (item.employee_number || "").trim().toLowerCase() === code
      ) || null
    );
  }, [employees, employeeCode]);

  const selectedLeaveBalance = useMemo(() => {
    const type = normaliseLeaveType(leaveType);
    return leaveBalances.find((balance) => balance.leave_type === type) || null;
  }, [leaveBalances, leaveType]);

  const calculatedDays = leaveDays(startDate, endDate);

  const pendingCount = useMemo(
    () => leaveRequests.filter((leave) => leave.status === "pending").length,
    [leaveRequests]
  );

  const approvedCount = useMemo(
    () => leaveRequests.filter((leave) => leave.status === "approved").length,
    [leaveRequests]
  );

  const otherCount = useMemo(
    () =>
      leaveRequests.filter(
        (leave) => leave.status === "declined" || leave.status === "amended"
      ).length,
    [leaveRequests]
  );

  const annualLeaveWarning =
    leaveType === "annual_leave" &&
    selectedLeaveBalance &&
    Number(selectedLeaveBalance.days_due_live || 0) < calculatedDays;

  useEffect(() => {
    loadEmployees();
  }, []);

  useEffect(() => {
    setAuthenticated(false);
    setEmployee(null);
    setLeaveRequests([]);
    setLeaveBalances([]);
    setSubmitMessage(null);
    setError(null);

    if (!employeeCode.trim()) {
      setLookupMessage(null);
      return;
    }

    if (!selectedEmployee) {
      setLookupMessage("No employee found for this code.");
      return;
    }

    setLookupMessage(`${fullName(selectedEmployee)} found. Enter PIN to continue.`);
  }, [employeeCode, selectedEmployee]);

  async function loadEmployees() {
    setLoadingEmployees(true);
    setError(null);

    const { data, error: employeesError } = await supabase
      .from("employees")
      .select("id,employee_number,first_name,last_name,active,pin_code,kiosk_access_enabled")
      .eq("active", true)
      .order("first_name", { ascending: true });

    if (employeesError) {
      setError(employeesError.message);
      setLoadingEmployees(false);
      return;
    }

    setEmployees((data || []) as EmployeeRow[]);
    setLoadingEmployees(false);

    setEmployeeCode("");
    setPinCode("");
    setEmployee(null);
    setAuthenticated(false);
  }

  async function loadLeaveRequestsForEmployee(targetEmployee: EmployeeRow) {
    const employeeId = targetEmployee.employee_number || targetEmployee.id;

    const { data, error: leaveError } = await supabase
      .from("leave_requests")
      .select("*")
      .eq("employee_id", employeeId)
      .order("created_at", { ascending: false })
      .limit(50);

    if (leaveError) {
      setError(leaveError.message);
      return;
    }

    setLeaveRequests((data || []) as LeaveRequestRow[]);
  }

  async function loadLeaveBalancesForEmployee(targetEmployee: EmployeeRow) {
    const employeeId = targetEmployee.employee_number || targetEmployee.id;

    const { data, error: balanceError } = await supabase
      .from("leave_balances_live")
      .select("*")
      .eq("employee_id", employeeId)
      .eq("status", "active")
      .order("leave_type", { ascending: true });

    if (balanceError) {
      setError(balanceError.message);
      return;
    }

    setLeaveBalances((data || []) as LeaveBalanceLiveRow[]);
  }

  async function verifyEmployeePin() {
    setCheckingPin(true);
    setError(null);
    setSubmitMessage(null);

    if (!employeeCode.trim()) {
      setError("Employee code is required.");
      setCheckingPin(false);
      return;
    }

    if (!selectedEmployee) {
      setError("Employee code was not found. Please check the code and try again.");
      setCheckingPin(false);
      return;
    }

    if (selectedEmployee.kiosk_access_enabled === false) {
      setError("Kiosk access is disabled for this employee.");
      setCheckingPin(false);
      return;
    }

    if (!pinCode.trim()) {
      setError("PIN code is required.");
      setCheckingPin(false);
      return;
    }

    if (!selectedEmployee.pin_code) {
      setError("This employee does not have a PIN set up yet. A manager must create one first.");
      setCheckingPin(false);
      return;
    }

    if (pinCode.trim() !== selectedEmployee.pin_code) {
      setError("Incorrect PIN code.");
      setCheckingPin(false);
      return;
    }

    setEmployee(selectedEmployee);
    setAuthenticated(true);
    setLookupMessage("PIN verified. You can apply for leave and view your leave status.");
    await loadLeaveRequestsForEmployee(selectedEmployee);
    await loadLeaveBalancesForEmployee(selectedEmployee);
    setCheckingPin(false);
  }

  function resetApplicationFields() {
    setLeaveType("annual_leave");
    setStartDate(todayIsoDate());
    setEndDate(todayIsoDate());
    setReason("");
  }

  async function submitLeave() {
    setError(null);
    setSubmitMessage(null);

    if (!authenticated || !employee) {
      setError("Please verify employee code and PIN first.");
      return;
    }

    if (!startDate || !endDate) {
      setError("Start date and end date are required.");
      return;
    }

    if (calculatedDays <= 0) {
      setError("End date must be the same as or after the start date.");
      return;
    }

    if (annualLeaveWarning) {
      setError(
        "You do not currently have enough annual leave days due for this request. Please speak to your manager or apply for unpaid leave."
      );
      return;
    }

    setSubmitting(true);

    const { error: insertError } = await supabase.from("leave_requests").insert({
      employee_id: employee.employee_number || employee.id,
      employee_name: fullName(employee),
      leave_type: leaveType,
      start_date: startDate,
      end_date: endDate,
      reason: reason.trim() || null,
      status: "pending",
      manager_feedback: null,
    });

    if (insertError) {
      setError(insertError.message);
      setSubmitting(false);
      return;
    }

    setSubmitMessage("Leave application submitted successfully.");
    resetApplicationFields();
    await loadLeaveRequestsForEmployee(employee);
    await loadLeaveBalancesForEmployee(employee);
    setSubmitting(false);
  }

  function clearScreen() {
    setEmployeeCode("");
    setPinCode("");
    setEmployee(null);
    setAuthenticated(false);
    setLeaveRequests([]);
    setLeaveBalances([]);
    setLookupMessage(null);
    setSubmitMessage(null);
    setError(null);
    resetApplicationFields();
  }

  return (
    <main className="min-h-screen bg-[#f6f8fb] p-4 text-slate-950 md:p-8">
      <section className="mx-auto max-w-6xl">
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
            Leave Application
          </h1>

          <p className="mt-4 max-w-3xl text-sm leading-7 text-slate-300">
            One simple place for employees to apply for leave, view leave balances,
            and check their leave status. Employee code and PIN must be entered every time.
          </p>
        </header>

        <section className="mt-6 grid gap-6 lg:grid-cols-[0.78fr_1.22fr]">
          <div className="space-y-6">
            <div className="rounded-[34px] border border-slate-200 bg-white p-6 shadow-[0_10px_30px_rgba(0,0,0,0.08)]">
              <div className="text-xs font-bold uppercase tracking-[0.35em] text-blue-600">
                Step 1
              </div>

              <h2 className="mt-2 text-3xl font-bold text-slate-950">
                Verify Employee
              </h2>

              <p className="mt-2 text-sm leading-6 text-slate-500">
                Enter employee code and PIN to apply for leave and view existing requests.
              </p>

              {loadingEmployees && (
                <div className="mt-5 rounded-2xl bg-blue-50 p-4 text-sm font-semibold text-blue-700">
                  Loading employees...
                </div>
              )}

              <label className="mt-6 block text-sm font-bold text-slate-800">
                Employee Code
                <div className="mt-2 flex items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                  <Search className="h-5 w-5 text-slate-400" />
                  <input
                    value={employeeCode}
                    onChange={(event) => {
                      setEmployeeCode(event.target.value.toUpperCase());
                      setPinCode("");
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
                      setSubmitMessage(null);
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

              {lookupMessage && (
                <div
                  className={`mt-4 rounded-2xl p-4 text-sm font-semibold ${
                    selectedEmployee
                      ? "bg-emerald-50 text-emerald-700"
                      : "bg-amber-50 text-amber-700"
                  }`}
                >
                  {selectedEmployee && <CheckCircle2 className="mr-2 inline h-4 w-4" />}
                  {lookupMessage}
                </div>
              )}

              {error && (
                <div className="mt-5 rounded-2xl bg-rose-50 p-4 text-sm font-semibold text-rose-700">
                  {error}
                </div>
              )}

              <button
                onClick={verifyEmployeePin}
                disabled={checkingPin || loadingEmployees}
                className="mt-6 w-full rounded-2xl bg-slate-950 px-5 py-4 text-sm font-black text-white disabled:bg-slate-300 disabled:text-slate-500"
              >
                {checkingPin ? "Checking..." : "Verify Employee"}
              </button>

              {authenticated && (
                <button
                  onClick={clearScreen}
                  className="mt-3 w-full rounded-2xl bg-slate-100 px-5 py-4 text-sm font-black text-slate-700"
                >
                  Clear Screen
                </button>
              )}
            </div>

            <div className="rounded-[34px] border border-slate-200 bg-white p-6 shadow-[0_10px_30px_rgba(0,0,0,0.08)]">
              <div className="text-xs font-bold uppercase tracking-[0.35em] text-blue-600">
                Step 2
              </div>

              <h2 className="mt-2 text-3xl font-bold text-slate-950">
                Apply for Leave
              </h2>

              {!authenticated || !employee ? (
                <div className="mt-5 rounded-2xl bg-slate-50 p-5 text-sm font-semibold text-slate-500">
                  Verify employee code and PIN first.
                </div>
              ) : (
                <>
                  <div className="mt-5 rounded-2xl bg-blue-50 p-4">
                    <div className="flex items-center gap-3">
                      <UserRound className="h-5 w-5 text-blue-700" />
                      <div>
                        <div className="font-bold text-blue-950">{fullName(employee)}</div>
                        <div className="text-xs font-semibold text-blue-700">
                          {employee.employee_number || employee.id}
                        </div>
                      </div>
                    </div>
                  </div>

                  {leaveBalances.length > 0 && (
                    <div className="mt-5 rounded-[24px] border border-slate-200 bg-slate-50 p-4">
                      <div className="text-xs font-black uppercase tracking-[0.2em] text-slate-400">
                        My Leave Balances
                      </div>

                      <div className="mt-3 grid gap-3">
                        {leaveBalances.map((balance) => (
                          <div
                            key={balance.id}
                            className="rounded-2xl bg-white p-4 text-sm"
                          >
                            <div className="flex items-center justify-between gap-3">
                              <div>
                                <div className="font-black text-slate-950">
                                  {formatText(balance.leave_type)}
                                </div>
                                <div className="mt-1 text-xs font-semibold text-slate-500">
                                  Accrued {formatDays(balance.days_accrued_live)} · Taken{" "}
                                  {formatDays(balance.days_taken)} · Pending{" "}
                                  {formatDays(balance.pending_days)}
                                </div>
                              </div>

                              <div className="text-right">
                                <div className="text-xs font-black uppercase tracking-[0.15em] text-slate-400">
                                  Days Due
                                </div>
                                <div className="text-xl font-black text-slate-950">
                                  {formatDays(balance.days_due_live)}
                                </div>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  <label className="mt-5 block text-sm font-bold text-slate-800">
                    Leave Type
                    <select
                      value={leaveType}
                      onChange={(event) => {
                        setLeaveType(event.target.value);
                        setSubmitMessage(null);
                        setError(null);
                      }}
                      className="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-950 outline-none focus:border-blue-500"
                    >
                      <option value="annual_leave">Annual leave</option>
                      <option value="sick_leave">Sick leave</option>
                      <option value="family_responsibility_leave">
                        Family responsibility leave
                      </option>
                      <option value="unpaid_leave">Unpaid leave</option>
                      <option value="study_leave">Study leave</option>
                      <option value="other">Other</option>
                    </select>
                  </label>

                  {selectedLeaveBalance && (
                    <div
                      className={`mt-4 rounded-2xl p-4 text-sm font-semibold ${
                        annualLeaveWarning
                          ? "bg-rose-50 text-rose-700"
                          : "bg-emerald-50 text-emerald-700"
                      }`}
                    >
                      {annualLeaveWarning
                        ? `Warning: You requested ${calculatedDays} day(s), but only ${formatDays(
                            selectedLeaveBalance.days_due_live
                          )} annual leave day(s) are currently due.`
                        : `Available for selected leave type: ${formatDays(
                            selectedLeaveBalance.days_due_live
                          )} day(s).`}
                    </div>
                  )}

                  <div className="mt-5 grid gap-4 md:grid-cols-2">
                    <label className="text-sm font-bold text-slate-800">
                      Start Date
                      <input
                        type="date"
                        value={startDate}
                        onChange={(event) => {
                          setStartDate(event.target.value);
                          setSubmitMessage(null);
                          setError(null);
                        }}
                        className="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-950 outline-none focus:border-blue-500"
                      />
                    </label>

                    <label className="text-sm font-bold text-slate-800">
                      End Date
                      <input
                        type="date"
                        value={endDate}
                        onChange={(event) => {
                          setEndDate(event.target.value);
                          setSubmitMessage(null);
                          setError(null);
                        }}
                        className="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-950 outline-none focus:border-blue-500"
                      />
                    </label>
                  </div>

                  <div className="mt-5 rounded-2xl bg-slate-50 p-4">
                    <div className="text-xs font-black uppercase tracking-[0.2em] text-slate-400">
                      Total Leave Days
                    </div>
                    <div className="mt-2 text-3xl font-black text-slate-950">
                      {calculatedDays} day{calculatedDays === 1 ? "" : "s"}
                    </div>
                  </div>

                  <label className="mt-5 block text-sm font-bold text-slate-800">
                    Reason / Notes
                    <textarea
                      value={reason}
                      onChange={(event) => setReason(event.target.value)}
                      rows={5}
                      className="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-950 outline-none focus:border-blue-500"
                      placeholder="Optional reason for leave..."
                    />
                  </label>

                  {submitMessage && (
                    <div className="mt-5 rounded-2xl bg-emerald-50 p-4 text-sm font-semibold text-emerald-700">
                      {submitMessage}
                    </div>
                  )}

                  <button
                    onClick={submitLeave}
                    disabled={submitting || Boolean(annualLeaveWarning)}
                    className="mt-6 flex w-full items-center justify-center gap-2 rounded-2xl bg-slate-950 px-5 py-4 text-sm font-black text-white disabled:bg-slate-300 disabled:text-slate-500"
                  >
                    <Send className="h-4 w-4" />
                    {submitting ? "Submitting Leave..." : "Submit Leave Application"}
                  </button>
                </>
              )}
            </div>
          </div>

          <div className="rounded-[34px] border border-slate-200 bg-white p-6 shadow-[0_10px_30px_rgba(0,0,0,0.08)]">
            <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
              <div>
                <div className="text-xs font-bold uppercase tracking-[0.35em] text-blue-600">
                  My Leave Status
                </div>
                <h2 className="mt-2 text-3xl font-bold text-slate-950">
                  Status & Manager Feedback
                </h2>
                <p className="mt-2 text-sm leading-6 text-slate-500">
                  Once verified, employees can see their pending, approved, declined
                  and amended leave applications here.
                </p>
              </div>

              <CalendarDays className="h-9 w-9 text-blue-600" />
            </div>

            {!authenticated || !employee ? (
              <div className="mt-6 flex min-h-[520px] flex-col items-center justify-center text-center">
                <CalendarDays className="h-14 w-14 text-slate-300" />
                <h3 className="mt-4 text-2xl font-bold text-slate-950">
                  Leave status appears here
                </h3>
                <p className="mt-2 max-w-md text-sm leading-6 text-slate-500">
                  Enter employee code and PIN first. This keeps employee leave
                  information private.
                </p>
              </div>
            ) : (
              <>
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
                    <div className="mt-2 text-3xl font-black">{otherCount}</div>
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

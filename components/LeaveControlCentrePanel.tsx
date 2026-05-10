"use client";

import React, { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CalendarDays,
  CheckCircle2,
  Clock3,
  RefreshCcw,
  ShieldCheck,
  XCircle,
} from "lucide-react";
import { supabase } from "../lib/supabase";

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

type EmployeeRow = {
  id: string;
  employee_number: string | null;
  first_name: string;
  last_name: string;
  active: boolean;
  email: string | null;
  phone: string | null;
};

type LeaveBalanceLive = {
  id: string;
  employee_id: string;
  employee_name: string;
  leave_type: string;
  days_due_live: number;
  days_accrued_live: number;
  days_taken: number;
  pending_days: number;
  cycle_leave_entitlement_days: number;
};

function employeeName(employee: EmployeeRow | null | undefined) {
  if (!employee) return "Unknown employee";
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

function leaveDays(startDate: string, endDate: string) {
  const start = new Date(`${startDate}T12:00:00`);
  const end = new Date(`${endDate}T12:00:00`);
  const difference = end.getTime() - start.getTime();
  if (difference < 0) return 0;
  return Math.floor(difference / (1000 * 60 * 60 * 24)) + 1;
}

function normaliseLeaveType(value: string | null | undefined) {
  const lower = String(value || "annual_leave").toLowerCase();
  if (["annual", "annual leave", "annual_leave"].includes(lower)) return "annual_leave";
  if (["sick", "sick leave", "sick_leave"].includes(lower)) return "sick_leave";
  if (["family", "family responsibility", "family responsibility leave", "family_responsibility_leave"].includes(lower)) return "family_responsibility_leave";
  if (["unpaid", "unpaid leave", "unpaid_leave"].includes(lower)) return "unpaid_leave";
  return "annual_leave";
}

function formatDays(value: number | string | null | undefined) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed.toFixed(2) : "0.00";
}

function StatusPill({ value }: { value: string }) {
  const className =
    value === "approved"
      ? "bg-emerald-100 text-emerald-700"
      : value === "pending"
      ? "bg-amber-100 text-amber-700"
      : value === "declined"
      ? "bg-rose-100 text-rose-700"
      : "bg-blue-100 text-blue-700";

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

export default function LeaveControlCentrePanel() {
  const [leaveRequests, setLeaveRequests] = useState<LeaveRequestRow[]>([]);
  const [employees, setEmployees] = useState<EmployeeRow[]>([]);
  const [leaveBalances, setLeaveBalances] = useState<LeaveBalanceLive[]>([]);
  const [selectedRequest, setSelectedRequest] = useState<LeaveRequestRow | null>(null);
  const [feedback, setFeedback] = useState("");
  const [filter, setFilter] = useState<"pending" | "all" | "approved" | "declined" | "amended">("pending");
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const employeeMap = useMemo(() => {
    const map = new Map<string, EmployeeRow>();
    employees.forEach((employee) => map.set(employee.id, employee));
    return map;
  }, [employees]);

  const filteredRequests = useMemo(() => {
    if (filter === "all") return leaveRequests;
    return leaveRequests.filter((request) => request.status === filter);
  }, [leaveRequests, filter]);

  const pendingCount = useMemo(
    () => leaveRequests.filter((request) => request.status === "pending").length,
    [leaveRequests]
  );

  const approvedCount = useMemo(
    () => leaveRequests.filter((request) => request.status === "approved").length,
    [leaveRequests]
  );

  const riskCount = useMemo(() => {
    return leaveRequests.filter((request) => {
      if (request.status !== "pending") return false;
      const leaveType = normaliseLeaveType(request.leave_type);
      if (leaveType !== "annual_leave") return false;
      const balance = leaveBalances.find(
        (item) => item.employee_id === request.employee_id && item.leave_type === leaveType
      );
      if (!balance) return true;
      return Number(balance.days_due_live || 0) < leaveDays(request.start_date, request.end_date);
    }).length;
  }, [leaveRequests, leaveBalances]);

  const selectedBalance = useMemo(() => {
    if (!selectedRequest?.employee_id) return null;
    return (
      leaveBalances.find(
        (item) =>
          item.employee_id === selectedRequest.employee_id &&
          item.leave_type === normaliseLeaveType(selectedRequest.leave_type)
      ) || null
    );
  }, [selectedRequest, leaveBalances]);

  const selectedDays = selectedRequest ? leaveDays(selectedRequest.start_date, selectedRequest.end_date) : 0;

  const balancePassed =
    !selectedRequest ||
    normaliseLeaveType(selectedRequest.leave_type) !== "annual_leave" ||
    !selectedBalance ||
    Number(selectedBalance.days_due_live || 0) >= selectedDays;

  useEffect(() => {
    loadLeaveControl();
  }, []);

  async function loadLeaveControl() {
    setLoading(true);
    setError(null);

    const [leaveResult, employeeResult, balanceResult] = await Promise.all([
      supabase
        .from("leave_requests")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(200),
      supabase
        .from("employees")
        .select("id,employee_number,first_name,last_name,active,email,phone")
        .order("first_name", { ascending: true }),
      supabase
        .from("leave_balances_live")
        .select("*")
        .limit(500),
    ]);

    if (leaveResult.error) {
      setError(leaveResult.error.message);
      setLoading(false);
      return;
    }

    if (employeeResult.error) {
      setError(employeeResult.error.message);
      setLoading(false);
      return;
    }

    if (balanceResult.error) {
      setError(balanceResult.error.message);
      setLoading(false);
      return;
    }

    setLeaveRequests((leaveResult.data || []) as LeaveRequestRow[]);
    setEmployees((employeeResult.data || []) as EmployeeRow[]);
    setLeaveBalances((balanceResult.data || []) as LeaveBalanceLive[]);
    setLoading(false);
  }

  function openRequest(request: LeaveRequestRow) {
    setSelectedRequest(request);
    setFeedback(request.manager_feedback || "");
    setError(null);
    setMessage(null);
  }

  async function updateRequest(status: "approved" | "declined" | "amended") {
    if (!selectedRequest) return;

    if (status === "approved" && !balancePassed) {
      setError("Annual leave balance check failed. Amend or decline unless you manually verify an override.");
      return;
    }

    setSavingId(selectedRequest.id);
    setError(null);
    setMessage(null);

    const { error: updateError } = await supabase
      .from("leave_requests")
      .update({
        status,
        manager_feedback: feedback.trim() || null,
      })
      .eq("id", selectedRequest.id);

    if (updateError) {
      setError(updateError.message);
      setSavingId(null);
      return;
    }

    setMessage(`Leave request ${formatText(status)}.`);
    setSelectedRequest(null);
    setFeedback("");
    await loadLeaveControl();
    setSavingId(null);
  }

  return (
    <div className="mt-8 space-y-8">
      <section className="rounded-[34px] bg-gradient-to-r from-[#07101f] to-[#0b1a33] p-6 text-white shadow-2xl shadow-slate-300">
        <div className="flex flex-col gap-5 xl:flex-row xl:items-center xl:justify-between">
          <div>
            <div className="text-xs font-bold uppercase tracking-[0.4em] text-cyan-300">
              Leave Control Centre
            </div>
            <h2 className="mt-3 text-4xl font-bold">Leave Approvals & Balance Risk</h2>
            <p className="mt-4 max-w-3xl text-sm leading-7 text-slate-300">
              Review leave requests, check balances, approve/decline/amend, and prevent payroll
              or staffing issues before the roster is affected.
            </p>
          </div>

          <button
            onClick={loadLeaveControl}
            className="flex w-fit items-center gap-2 rounded-2xl bg-white px-5 py-3 text-sm font-bold text-slate-950"
          >
            <RefreshCcw className="h-4 w-4" />
            {loading ? "Loading..." : "Refresh"}
          </button>
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-4">
        <StatCard
          title="Pending"
          value={String(pendingCount)}
          subtitle="Needs manager action"
          tone="border-amber-200 bg-amber-50 text-amber-900"
          icon={<Clock3 className="h-6 w-6 text-amber-700" />}
        />
        <StatCard
          title="Approved"
          value={String(approvedCount)}
          subtitle="Approved requests"
          tone="border-emerald-200 bg-emerald-50 text-emerald-900"
          icon={<CheckCircle2 className="h-6 w-6 text-emerald-700" />}
        />
        <StatCard
          title="Balance Risk"
          value={String(riskCount)}
          subtitle="Annual leave issues"
          tone="border-rose-200 bg-rose-50 text-rose-900"
          icon={<AlertTriangle className="h-6 w-6 text-rose-700" />}
        />
        <StatCard
          title="Total"
          value={String(leaveRequests.length)}
          subtitle="Loaded leave records"
          tone="border-blue-200 bg-blue-50 text-blue-900"
          icon={<CalendarDays className="h-6 w-6 text-blue-700" />}
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

      <section className="grid gap-8 xl:grid-cols-[0.95fr_1.05fr]">
        <div className="rounded-[34px] border border-slate-200 bg-white p-6 shadow-[0_10px_30px_rgba(0,0,0,0.08)]">
          <div className="text-xs font-bold uppercase tracking-[0.35em] text-blue-600">
            Request Queue
          </div>
          <h3 className="mt-2 text-2xl font-bold text-slate-950">
            Leave Requests
          </h3>

          <div className="mt-5 flex flex-wrap gap-2">
            {(["pending", "all", "approved", "declined", "amended"] as const).map((item) => (
              <button
                key={item}
                onClick={() => setFilter(item)}
                className={`rounded-full px-4 py-2 text-xs font-black uppercase tracking-[0.16em] ${
                  filter === item
                    ? "bg-slate-950 text-white"
                    : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                }`}
              >
                {formatText(item)}
              </button>
            ))}
          </div>

          <div className="mt-6 space-y-3">
            {filteredRequests.length === 0 ? (
              <div className="rounded-2xl bg-slate-50 p-5 text-sm font-semibold text-slate-500">
                No leave requests for this filter.
              </div>
            ) : (
              filteredRequests.map((request) => (
                <button
                  key={request.id}
                  onClick={() => openRequest(request)}
                  className={`w-full rounded-[24px] border p-5 text-left transition hover:-translate-y-0.5 hover:shadow-lg ${
                    selectedRequest?.id === request.id
                      ? "border-blue-400 bg-blue-50"
                      : "border-slate-200 bg-slate-50"
                  }`}
                >
                  <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                    <div>
                      <div className="font-black text-slate-950">
                        {request.employee_name ||
                          employeeName(employeeMap.get(String(request.employee_id || "")))}
                      </div>
                      <div className="mt-1 text-xs font-semibold text-slate-500">
                        {formatText(request.leave_type)} · {formatDate(request.start_date)} →{" "}
                        {formatDate(request.end_date)} · {leaveDays(request.start_date, request.end_date)} day(s)
                      </div>
                    </div>

                    <StatusPill value={request.status} />
                  </div>
                </button>
              ))
            )}
          </div>
        </div>

        <div className="rounded-[34px] border border-slate-200 bg-white p-6 shadow-[0_10px_30px_rgba(0,0,0,0.08)]">
          <div className="text-xs font-bold uppercase tracking-[0.35em] text-blue-600">
            Approval Detail
          </div>
          <h3 className="mt-2 text-2xl font-bold text-slate-950">
            Manager Decision
          </h3>

          {!selectedRequest ? (
            <div className="mt-6 rounded-[26px] border border-dashed border-slate-200 bg-slate-50 p-8 text-center">
              <CalendarDays className="mx-auto h-10 w-10 text-slate-300" />
              <div className="mt-3 text-lg font-bold text-slate-950">
                Select a leave request
              </div>
            </div>
          ) : (
            <>
              <div className="mt-6 rounded-[26px] border border-slate-200 bg-slate-50 p-5">
                <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                  <div>
                    <div className="text-2xl font-black text-slate-950">
                      {selectedRequest.employee_name ||
                        employeeName(employeeMap.get(String(selectedRequest.employee_id || "")))}
                    </div>
                    <div className="mt-1 text-sm font-semibold text-slate-500">
                      {formatText(selectedRequest.leave_type)} · {selectedDays} day(s)
                    </div>
                  </div>

                  <StatusPill value={selectedRequest.status} />
                </div>

                <div className="mt-5 grid gap-3 md:grid-cols-3">
                  <Info label="Start" value={formatDate(selectedRequest.start_date)} />
                  <Info label="End" value={formatDate(selectedRequest.end_date)} />
                  <Info label="Days" value={String(selectedDays)} />
                </div>

                <div className="mt-4 rounded-2xl bg-white p-4 text-sm font-semibold leading-6 text-slate-700">
                  {selectedRequest.reason || "No reason supplied."}
                </div>
              </div>

              <div className="mt-5 rounded-[26px] border border-slate-200 bg-slate-50 p-5">
                <div className="flex items-center gap-2">
                  <ShieldCheck className="h-5 w-5 text-blue-600" />
                  <div className="font-black text-slate-950">Balance Check</div>
                </div>

                {!selectedBalance ? (
                  <div className="mt-4 rounded-2xl bg-amber-50 p-4 text-sm font-semibold text-amber-700">
                    No matching leave balance record found. Verify manually before approval.
                  </div>
                ) : (
                  <div className="mt-4 grid gap-3 md:grid-cols-3">
                    <Info label="Days Due" value={`${formatDays(selectedBalance.days_due_live)} days`} />
                    <Info label="Days Taken" value={`${formatDays(selectedBalance.days_taken)} days`} />
                    <Info label="Pending" value={`${formatDays(selectedBalance.pending_days)} days`} />
                  </div>
                )}

                <div
                  className={`mt-4 rounded-2xl p-4 text-sm font-semibold ${
                    balancePassed ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700"
                  }`}
                >
                  {balancePassed
                    ? "Balance check passed or not required for this leave type."
                    : "Balance check failed. This request needs amendment or manual review."}
                </div>
              </div>

              <label className="mt-5 block text-sm font-bold text-slate-800">
                Manager Feedback
                <textarea
                  value={feedback}
                  onChange={(event) => setFeedback(event.target.value)}
                  rows={5}
                  className="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-semibold outline-none focus:border-blue-500"
                  placeholder="Feedback to employee..."
                />
              </label>

              <div className="mt-5 grid gap-3 md:grid-cols-3">
                <button
                  onClick={() => updateRequest("approved")}
                  disabled={savingId === selectedRequest.id || !balancePassed}
                  className="rounded-2xl bg-emerald-600 px-5 py-4 text-sm font-black text-white disabled:bg-slate-300"
                >
                  Approve
                </button>

                <button
                  onClick={() => updateRequest("declined")}
                  disabled={savingId === selectedRequest.id}
                  className="rounded-2xl bg-rose-600 px-5 py-4 text-sm font-black text-white disabled:bg-slate-300"
                >
                  Decline
                </button>

                <button
                  onClick={() => updateRequest("amended")}
                  disabled={savingId === selectedRequest.id}
                  className="rounded-2xl bg-blue-600 px-5 py-4 text-sm font-black text-white disabled:bg-slate-300"
                >
                  Amend
                </button>
              </div>
            </>
          )}
        </div>
      </section>
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl bg-white p-4">
      <div className="text-xs font-black uppercase tracking-[0.18em] text-slate-400">
        {label}
      </div>
      <div className="mt-2 text-sm font-bold text-slate-950">{value}</div>
    </div>
  );
}

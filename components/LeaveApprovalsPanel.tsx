"use client";

import React, { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CalendarDays,
  CheckCircle2,
  RefreshCcw,
  Search,
} from "lucide-react";
import { supabase } from "../lib/supabase";

type LeaveStatus = "pending" | "approved" | "declined" | "amended";

type LeaveRequest = {
  id: string;
  company_id?: string | null;
  employee_id: string | null;
  employee_name: string | null;
  leave_type: string | null;
  start_date: string;
  end_date: string;
  reason: string | null;
  status: LeaveStatus | string;
  workflow_stage?: string | null;
  submitted_at?: string | null;
  manager_approved_at?: string | null;
  hr_approved_at?: string | null;
  rejected_at?: string | null;
  cancelled_at?: string | null;
  completed_at?: string | null;
  manager_feedback: string | null;
  created_at: string;
};

type LeaveBalanceLive = {
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

const statusStyles: Record<string, string> = {
  pending: "bg-amber-100 text-amber-700 border-amber-200",
  approved: "bg-emerald-100 text-emerald-700 border-emerald-200",
  declined: "bg-rose-100 text-rose-700 border-rose-200",
  amended: "bg-blue-100 text-blue-700 border-blue-200",
};

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

function datesOverlap(startA: string, endA: string, startB: string, endB: string) {
  const aStart = new Date(`${startA}T12:00:00`).getTime();
  const aEnd = new Date(`${endA}T12:00:00`).getTime();
  const bStart = new Date(`${startB}T12:00:00`).getTime();
  const bEnd = new Date(`${endB}T12:00:00`).getTime();
  return aStart <= bEnd && bStart <= aEnd;
}

function normaliseLeaveType(value: string | null | undefined) {
  const lower = String(value || "annual_leave").toLowerCase();

  if (["annual", "annual leave", "annual_leave"].includes(lower)) return "annual_leave";
  if (["sick", "sick leave", "sick_leave"].includes(lower)) return "sick_leave";
  if (
    [
      "family",
      "family responsibility",
      "family responsibility leave",
      "family_responsibility_leave",
    ].includes(lower)
  ) {
    return "family_responsibility_leave";
  }
  if (["unpaid", "unpaid leave", "unpaid_leave"].includes(lower)) return "unpaid_leave";
  if (["study", "study leave", "study_leave"].includes(lower)) return "study_leave";

  return "annual_leave";
}

function formatDays(value: number | string | null | undefined) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed.toFixed(2) : "0.00";
}

function statusLabel(status: string | null | undefined) {
  return formatText(status || "pending");
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

export default function LeaveApprovalsPanel({
  companyId,
  onUpdated,
}: {
  companyId?: string;
  onUpdated?: () => void | Promise<void>;
}) {
  const [leaveRequests, setLeaveRequests] = useState<LeaveRequest[]>([]);
  const [selectedLeave, setSelectedLeave] = useState<LeaveRequest | null>(null);
  const [selectedLeaveBalance, setSelectedLeaveBalance] = useState<LeaveBalanceLive | null>(null);
  const [feedback, setFeedback] = useState("");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"pending" | "approved" | "declined" | "amended" | "all">("pending");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const filteredRequests = useMemo(() => {
    const term = search.trim().toLowerCase();

    return leaveRequests.filter((request) => {
      const statusMatches = statusFilter === "all" || request.status === statusFilter;
      if (!statusMatches) return false;
      if (!term) return true;

      return [
        request.employee_id,
        request.employee_name,
        request.leave_type,
        request.status,
        request.reason,
        request.manager_feedback,
      ]
        .join(" ")
        .toLowerCase()
        .includes(term);
    });
  }, [leaveRequests, search, statusFilter]);

  const pendingCount = useMemo(
    () => leaveRequests.filter((request) => request.status === "pending").length,
    [leaveRequests]
  );

  const approvedCount = useMemo(
    () => leaveRequests.filter((request) => request.status === "approved").length,
    [leaveRequests]
  );

  const declinedCount = useMemo(
    () => leaveRequests.filter((request) => request.status === "declined").length,
    [leaveRequests]
  );

  const selectedLeaveDays = selectedLeave ? leaveDays(selectedLeave.start_date, selectedLeave.end_date) : 0;
  const selectedLeaveType = normaliseLeaveType(selectedLeave?.leave_type);

  const selectedLeaveHasEnoughBalance =
    !selectedLeaveBalance ||
    selectedLeaveType !== "annual_leave" ||
    Number(selectedLeaveBalance.days_due_live || 0) >= selectedLeaveDays;

  async function fetchLeaveRequests() {
    setLoading(true);
    setError(null);

    let query = supabase
      .from("leave_requests")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(250);

    if (companyId) {
      query = query.eq("company_id", companyId);
    }

    const { data, error: fetchError } = await query;

    if (fetchError) {
      setError(fetchError.message);
      setLoading(false);
      return;
    }

    setLeaveRequests((data || []) as LeaveRequest[]);
    setLoading(false);
  }

  async function loadLeaveBalanceForRequest(leave: LeaveRequest) {
    setSelectedLeaveBalance(null);

    if (!leave.employee_id) return;

    const leaveType = normaliseLeaveType(leave.leave_type);

    let query = supabase
      .from("leave_balances_live")
      .select("*")
      .eq("employee_id", String(leave.employee_id))
      .eq("leave_type", leaveType)
      .limit(1);

    if (companyId) {
      query = query.eq("company_id", companyId);
    }

    const { data } = await query.maybeSingle();

    if (data) {
      setSelectedLeaveBalance(data as LeaveBalanceLive);
    }
  }

  async function openLeave(leave: LeaveRequest) {
    setSelectedLeave(leave);
    setFeedback(leave.manager_feedback || "");
    setError(null);
    setSuccess(null);
    await loadLeaveBalanceForRequest(leave);
  }

  async function updateLeaveStatus(nextStatus: LeaveStatus | "cancelled" | "completed", nextWorkflowStage: string) {
    if (!selectedLeave) return;

    setSaving(true);
    setError(null);
    setSuccess(null);

    if (nextStatus === "approved" && !selectedLeaveHasEnoughBalance) {
      setError(
        "This employee does not have enough annual leave days due. Adjust the balance or decline/amend the request."
      );
      setSaving(false);
      return;
    }

    const leaveRequestId = selectedLeave.id;

    if (!leaveRequestId) {
      setError("Leave request ID is missing. Cannot update this request.");
      setSaving(false);
      return;
    }

    if (["manager_approved", "hr_approved"].includes(nextWorkflowStage) && selectedLeave.employee_id) {
      const { data: overlapRows, error: overlapError } = await supabase
        .from("leave_requests")
        .select("id,start_date,end_date,status,workflow_stage")
        .eq("employee_id", selectedLeave.employee_id)
        .neq("id", leaveRequestId);

      if (overlapError) {
        setError(overlapError.message);
        setSaving(false);
        return;
      }

      const hasOverlap = (overlapRows || []).some((row) => {
        const stage = String((row as any).workflow_stage || "submitted").toLowerCase();
        const status = String((row as any).status || "pending").toLowerCase();
        const active = ["submitted", "manager_approved", "hr_approved", "approved", "pending"].includes(stage) || ["approved", "pending"].includes(status);
        if (!active) return false;
        return datesOverlap(selectedLeave.start_date, selectedLeave.end_date, String((row as any).start_date), String((row as any).end_date));
      });

      if (hasOverlap) {
        setError("Conflict detected: this employee has another overlapping leave request.");
        setSaving(false);
        return;
      }
    }

    const nowIso = new Date().toISOString();

    const { error: updateError } = await supabase
      .from("leave_requests")
      .update({
        status: nextStatus,
        workflow_stage: nextWorkflowStage,
        manager_approved_at: nextWorkflowStage === "manager_approved" ? nowIso : null,
        hr_approved_at: nextWorkflowStage === "hr_approved" ? nowIso : null,
        rejected_at: nextWorkflowStage === "rejected" ? nowIso : null,
        cancelled_at: nextWorkflowStage === "cancelled" ? nowIso : null,
        completed_at: nextWorkflowStage === "completed" ? nowIso : null,
        reviewed_by_manager: nextWorkflowStage === "manager_approved" ? "manager" : null,
        reviewed_by_hr: nextWorkflowStage === "hr_approved" ? "hr" : null,
        manager_feedback: feedback.trim() || null,
      })
      .eq("id", leaveRequestId)
      .eq("company_id", companyId || selectedLeave.company_id || "");

    if (updateError) {
      setError(updateError.message);
      setSaving(false);
      return;
    }

    setSuccess(`Leave request ${statusLabel(nextStatus)} successfully.`);
    setSelectedLeave(null);
    setSelectedLeaveBalance(null);
    setFeedback("");
    await fetchLeaveRequests();

    if (onUpdated) {
      await onUpdated();
    }

    setSaving(false);
  }

  useEffect(() => {
    fetchLeaveRequests();
  }, []);

  return (
    <div className="mt-8 grid gap-8 xl:grid-cols-[0.78fr_1.22fr]">
      <section className="rounded-[34px] bg-gradient-to-r from-[#07101f] to-[#0b1a33] p-6 text-white shadow-2xl shadow-slate-300">
        <div className="text-xs font-bold uppercase tracking-[0.4em] text-cyan-300">
          Leave Approvals
        </div>
        <h2 className="mt-3 text-3xl font-bold">Manager Leave Review</h2>
        <p className="mt-4 text-sm leading-7 text-slate-300">
          Review employee leave applications, check leave balances, approve, decline or
          amend requests, and store manager feedback.
        </p>

        <div className="mt-6 grid gap-3">
          <div className="rounded-2xl bg-white/10 p-4">
            <div className="text-xs font-black uppercase tracking-[0.2em] text-slate-400">
              Pending approvals
            </div>
            <div className="mt-2 text-4xl font-black text-amber-300">
              {pendingCount}
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-2xl bg-white/10 p-4">
              <div className="text-xs font-bold text-slate-400">Approved</div>
              <div className="mt-2 text-2xl font-black text-emerald-300">
                {approvedCount}
              </div>
            </div>

            <div className="rounded-2xl bg-white/10 p-4">
              <div className="text-xs font-bold text-slate-400">Declined</div>
              <div className="mt-2 text-2xl font-black text-rose-300">
                {declinedCount}
              </div>
            </div>
          </div>
        </div>

        <div className="mt-6 rounded-2xl bg-white/10 p-4 text-sm leading-6 text-slate-300">
          Annual leave approval is blocked if the employee does not have enough
          days due. Sick, unpaid and other leave can still be reviewed normally.
        </div>
      </section>

      <section className="rounded-[34px] border border-slate-200/70 bg-white p-6 shadow-[0_10px_30px_rgba(0,0,0,0.08)]">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <div className="text-xs font-bold uppercase tracking-[0.35em] text-blue-600">
              VYRON CORE
            </div>
            <h2 className="mt-2 text-3xl font-bold text-slate-950">
              Leave Requests
            </h2>
            <p className="mt-2 text-sm leading-6 text-slate-500">
              Search and filter all leave requests by status.
            </p>
          </div>

          <button
            onClick={fetchLeaveRequests}
            className="flex w-fit items-center gap-2 rounded-2xl bg-slate-950 px-5 py-3 text-sm font-bold text-white"
          >
            <RefreshCcw className="h-4 w-4" />
            Refresh
          </button>
        </div>

        <div className="mt-5 grid gap-3 md:grid-cols-[1fr_auto]">
          <div className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
            <Search className="h-5 w-5 text-slate-400" />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search by employee, code, leave type or status..."
              className="w-full bg-transparent text-sm font-semibold outline-none"
            />
          </div>

          <select
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value as typeof statusFilter)}
            className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-bold text-slate-950 outline-none"
          >
            <option value="pending">Pending</option>
            <option value="approved">Approved</option>
            <option value="declined">Declined</option>
            <option value="amended">Amended</option>
            <option value="all">All</option>
          </select>
        </div>

        {error && (
          <div className="mt-5 rounded-2xl bg-rose-50 p-4 text-sm font-semibold text-rose-700">
            <AlertTriangle className="mr-2 inline h-4 w-4" />
            {error}
          </div>
        )}

        {success && (
          <div className="mt-5 rounded-2xl bg-emerald-50 p-4 text-sm font-semibold text-emerald-700">
            <CheckCircle2 className="mr-2 inline h-4 w-4" />
            {success}
          </div>
        )}

        {loading ? (
          <div className="mt-6 rounded-[26px] border border-dashed border-slate-200 bg-slate-50 p-8 text-center text-sm font-semibold text-slate-500">
            Loading leave requests...
          </div>
        ) : (
          <div className="mt-6 grid gap-6 xl:grid-cols-[0.9fr_1.1fr]">
            <div className="space-y-3">
              {filteredRequests.length === 0 ? (
                <div className="rounded-[26px] border border-dashed border-slate-200 bg-slate-50 p-8 text-center">
                  <CalendarDays className="mx-auto h-10 w-10 text-slate-300" />
                  <div className="mt-3 text-lg font-bold text-slate-950">
                    No leave requests found
                  </div>
                  <p className="mt-2 text-sm text-slate-500">
                    Change the filter or submit a leave request from the employee kiosk.
                  </p>
                </div>
              ) : (
                filteredRequests.map((leave) => {
                  const selected = selectedLeave?.id === leave.id;
                  const requestedDays = leaveDays(leave.start_date, leave.end_date);

                  return (
                    <button
                      key={leave.id}
                      onClick={() => openLeave(leave)}
                      className={`w-full rounded-[24px] border p-4 text-left transition hover:-translate-y-0.5 hover:shadow-lg ${
                        selected
                          ? "border-blue-400 bg-blue-50"
                          : "border-slate-200 bg-slate-50"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="font-bold text-slate-950">
                            {leave.employee_name || "Unknown employee"}
                          </div>
                          <div className="mt-1 text-xs font-semibold text-slate-500">
                            {leave.employee_id || "No employee code"} ·{" "}
                            {formatText(leave.leave_type)}
                          </div>
                        </div>

                        <span
                          className={`rounded-full border px-3 py-1 text-xs font-black uppercase ${
                            statusStyles[leave.status] || "border-slate-200 bg-slate-100 text-slate-700"
                          }`}
                        >
                          {statusLabel(leave.status)}
                        </span>
                      </div>

                      <div className="mt-3 text-xs font-semibold text-slate-600">
                        {formatDate(leave.start_date)} → {formatDate(leave.end_date)} ·{" "}
                        {requestedDays} day(s)
                      </div>
                    </button>
                  );
                })
              )}
            </div>

            <div className="rounded-[26px] border border-slate-200 bg-slate-50 p-5">
              {!selectedLeave ? (
                <div className="flex min-h-[520px] flex-col items-center justify-center text-center">
                  <CalendarDays className="h-12 w-12 text-slate-300" />
                  <div className="mt-3 text-lg font-bold text-slate-950">
                    Select a leave request
                  </div>
                  <p className="mt-2 max-w-md text-sm text-slate-500">
                    Choose a request on the left to review details, balance and approval actions.
                  </p>
                </div>
              ) : (
                <>
                  <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                    <div>
                      <h3 className="text-2xl font-black text-slate-950">
                        {selectedLeave.employee_name || "Unknown employee"}
                      </h3>
                      <p className="mt-1 text-sm font-semibold text-slate-500">
                        {selectedLeave.employee_id || "No employee code"} ·{" "}
                        {formatText(selectedLeave.leave_type)}
                      </p>
                    </div>

                    <span
                      className={`w-fit rounded-full border px-3 py-1 text-xs font-black uppercase ${
                        statusStyles[selectedLeave.status] ||
                        "border-slate-200 bg-slate-100 text-slate-700"
                      }`}
                    >
                      {statusLabel(selectedLeave.status)}
                    </span>
                  </div>

                  <div className="mt-5 grid gap-3 md:grid-cols-3">
                    <InfoTile label="Start Date" value={formatDate(selectedLeave.start_date)} />
                    <InfoTile label="End Date" value={formatDate(selectedLeave.end_date)} />
                    <InfoTile
                      label="Requested Days"
                      value={`${selectedLeaveDays} day(s)`}
                    />
                  </div>

                  <div className="mt-4 rounded-2xl bg-white p-4">
                    <div className="text-xs font-black uppercase tracking-[0.2em] text-slate-400">
                      Reason
                    </div>
                    <div className="mt-2 text-sm leading-6 text-slate-700">
                      {selectedLeave.reason || "No reason supplied."}
                    </div>
                  </div>

                  <div className="mt-5 rounded-[24px] border border-slate-200 bg-white p-5">
                    <div className="text-xs font-bold uppercase tracking-[0.35em] text-blue-600">
                      Leave Balance Check
                    </div>

                    {!selectedLeaveBalance ? (
                      <div className="mt-4 rounded-2xl bg-amber-50 p-4 text-sm font-semibold text-amber-700">
                        No matching leave balance found. Check Leave Balance Control before approving.
                      </div>
                    ) : (
                      <>
                        <div className="mt-4 grid gap-3 md:grid-cols-3">
                          <InfoTile
                            label="Days Due"
                            value={`${formatDays(selectedLeaveBalance.days_due_live)} days`}
                          />
                          <InfoTile
                            label="Days Taken"
                            value={`${formatDays(selectedLeaveBalance.days_taken)} days`}
                          />
                          <InfoTile
                            label="Pending Days"
                            value={`${formatDays(selectedLeaveBalance.pending_days)} days`}
                          />
                        </div>

                        <div
                          className={`mt-4 rounded-2xl p-4 text-sm font-semibold ${
                            selectedLeaveHasEnoughBalance
                              ? "bg-emerald-50 text-emerald-700"
                              : "bg-rose-50 text-rose-700"
                          }`}
                        >
                          {selectedLeaveHasEnoughBalance
                            ? "Balance check passed."
                            : "Not enough annual leave days due for this request."}
                        </div>
                      </>
                    )}
                  </div>

                  <label className="mt-5 block text-sm font-bold text-slate-800">
                    Manager Feedback
                    <textarea
                      value={feedback}
                      onChange={(event) => setFeedback(event.target.value)}
                      rows={4}
                      className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold outline-none focus:border-blue-500"
                      placeholder="Optional feedback to employee..."
                    />
                  </label>

                  <div className="mt-5 grid gap-3 md:grid-cols-3">
                    <button
                      onClick={() => updateLeaveStatus("pending", "manager_approved")}
                      disabled={
                        saving ||
                        selectedLeave.workflow_stage === "manager_approved" ||
                        !selectedLeaveHasEnoughBalance
                      }
                      className="rounded-2xl bg-cyan-600 px-5 py-4 text-sm font-black text-white disabled:bg-slate-300 disabled:text-slate-500"
                    >
                      Manager Approve
                    </button>

                    <button
                      onClick={() => updateLeaveStatus("approved", "hr_approved")}
                      disabled={
                        saving ||
                        selectedLeave.workflow_stage === "hr_approved" ||
                        !selectedLeaveHasEnoughBalance
                      }
                      className="rounded-2xl bg-emerald-600 px-5 py-4 text-sm font-black text-white disabled:bg-slate-300 disabled:text-slate-500"
                    >
                      HR Approve
                    </button>

                    <button
                      onClick={() => updateLeaveStatus("declined", "rejected")}
                      disabled={saving || selectedLeave.workflow_stage === "rejected"}
                      className="rounded-2xl bg-blue-600 px-5 py-4 text-sm font-black text-white disabled:bg-slate-300 disabled:text-slate-500"
                    >
                      Reject
                    </button>
                  </div>

                  <div className="mt-3 grid gap-3 md:grid-cols-3">
                    <button
                      onClick={() => updateLeaveStatus("pending", "draft")}
                      disabled={saving || selectedLeave.workflow_stage === "draft"}
                      className="rounded-2xl bg-slate-700 px-5 py-4 text-sm font-black text-white disabled:bg-slate-300 disabled:text-slate-500"
                    >
                      Move To Draft
                    </button>

                    <button
                      onClick={() => updateLeaveStatus("cancelled", "cancelled")}
                      disabled={saving || selectedLeave.workflow_stage === "cancelled"}
                      className="rounded-2xl bg-rose-600 px-5 py-4 text-sm font-black text-white disabled:bg-slate-300 disabled:text-slate-500"
                    >
                      Cancel
                    </button>

                    <button
                      onClick={() => updateLeaveStatus("completed", "completed")}
                      disabled={saving || selectedLeave.workflow_stage === "completed"}
                      className="rounded-2xl bg-indigo-600 px-5 py-4 text-sm font-black text-white disabled:bg-slate-300 disabled:text-slate-500"
                    >
                      Complete
                    </button>
                  </div>

                  <div className="mt-4 rounded-2xl bg-slate-100 p-4 text-xs font-semibold leading-6 text-slate-600">
                    Submitted: {formatDateTime(selectedLeave.created_at)}
                    <br />
                    Workflow: {formatText(selectedLeave.workflow_stage || "submitted")}
                  </div>
                </>
              )}
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

"use client";

import React, { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Bell,
  CalendarDays,
  CheckCircle2,
  Clock3,
  RefreshCcw,
  ShieldAlert,
  X,
} from "lucide-react";
import { supabase } from "../lib/supabase";

type LeaveRequest = {
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

type EmployeeNotification = {
  id: string;
  employee_id: string;
  employee_name: string;
  notification_type: string;
  /** Legacy column alias when notification_type is absent */
  type?: string;
  title: string;
  message: string;
  delivery_status: string;
  created_at: string;
};

type ExceptionRow = {
  id: string;
  exception_type: string;
  severity: string;
  description: string;
  status: string;
  created_at?: string;
};

type PayrollClockCheck = {
  id: string;
  employee_name: string;
  shift_date: string;
  payroll_status: string;
  exception_required: boolean;
  exception_reason: string | null;
};


type GeneratedDocument = {
  id: string;
  employee_id: string;
  document_title: string;
  document_type: string;
  signature_status: string;
  signed_at: string | null;
  created_at: string;
};

type SigningLink = {
  id: string;
  employee_id: string;
  document_id: string;
  status: string;
  expires_at: string | null;
  opened_at: string | null;
  signed_at: string | null;
  created_at: string;
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

const actionableNotificationTypes = new Set([
  "hr_warning",
  "hr_document",
  "clocking_feedback",
  "payroll_feedback",
  "general",
  "manager_message",
]);

function notificationNeedsManagerAction(notification: EmployeeNotification) {
  return (
    actionableNotificationTypes.has((notification.notification_type || (notification as any).type || 'general')) &&
    ["pending", "drafted", "failed"].includes(notification.delivery_status)
  );
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

function ActionCard({
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
    <div className={`rounded-[2rem] border p-5 shadow-[0_18px_55px_rgba(15,23,42,0.12)] backdrop-blur-xl transition hover:-translate-y-1 hover:shadow-[0_28px_80px_rgba(37,99,235,0.20)] ${tone}`}>
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-xs font-black uppercase tracking-[0.2em] opacity-70">
            {title}
          </div>
          <div className="mt-3 text-4xl font-black">{value}</div>
          <p className="mt-2 text-sm font-semibold opacity-80">{subtitle}</p>
        </div>
        <div className="rounded-2xl bg-white/70 p-3">{icon}</div>
      </div>
    </div>
  );
}

function InfoTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-white/80 bg-white/95 p-4 shadow-sm">
      <div className="text-xs font-black uppercase tracking-[0.2em] text-slate-400">
        {label}
      </div>
      <div className="mt-2 text-sm font-bold text-slate-950">{value}</div>
    </div>
  );
}


function FileSignatureIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-6 w-6 text-cyan-700" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <path d="M14 2v6h6" />
      <path d="M8 17c1.5-2 3-2 4 0s2.5 2 4 0" />
    </svg>
  );
}

function LinkIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-6 w-6 text-emerald-700" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M10 13a5 5 0 0 0 7.07 0l2.83-2.83a5 5 0 0 0-7.07-7.07L11.5 4.43" />
      <path d="M14 11a5 5 0 0 0-7.07 0L4.1 13.83a5 5 0 0 0 7.07 7.07l1.33-1.33" />
    </svg>
  );
}


export default function ManagerActionCentrePanel({
  onNavigate,
}: {
  onNavigate?: (screen: string) => void;
}) {
  const [leaveRequests, setLeaveRequests] = useState<LeaveRequest[]>([]);
  const [notifications, setNotifications] = useState<EmployeeNotification[]>([]);
  const [exceptions, setExceptions] = useState<ExceptionRow[]>([]);
  const [payrollChecks, setPayrollChecks] = useState<PayrollClockCheck[]>([]);
  const [generatedDocuments, setGeneratedDocuments] = useState<GeneratedDocument[]>([]);
  const [signingLinks, setSigningLinks] = useState<SigningLink[]>([]);
  const [selectedLeave, setSelectedLeave] = useState<LeaveRequest | null>(null);
  const [selectedLeaveBalance, setSelectedLeaveBalance] = useState<LeaveBalanceLive | null>(null);
  const [feedback, setFeedback] = useState("");
  const [loading, setLoading] = useState(true);
  const [actionSaving, setActionSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pendingLeave = useMemo(
    () => leaveRequests.filter((item) => item.status === "pending"),
    [leaveRequests]
  );

  const pendingNotifications = useMemo(
    () => notifications.filter((item) => notificationNeedsManagerAction(item)),
    [notifications]
  );

  const openExceptions = useMemo(
    () =>
      exceptions.filter(
        (item) => item.status !== "closed" && item.status !== "approved"
      ),
    [exceptions]
  );

  const blockedPayroll = useMemo(
    () =>
      payrollChecks.filter(
        (item) => item.payroll_status === "blocked" || item.exception_required
      ),
    [payrollChecks]
  );

  const unsignedDocuments = useMemo(
    () => generatedDocuments.filter((item) => item.signature_status !== "signed"),
    [generatedDocuments]
  );

  const openSigningLinks = useMemo(
    () => signingLinks.filter((item) => item.status === "active" && (!item.expires_at || new Date(item.expires_at).getTime() > Date.now())),
    [signingLinks]
  );

  const selectedLeaveDays = selectedLeave
    ? leaveDays(selectedLeave.start_date, selectedLeave.end_date)
    : 0;

  const selectedLeaveHasEnoughBalance =
    !selectedLeaveBalance ||
    Number(selectedLeaveBalance.days_due_live || 0) >= selectedLeaveDays ||
    normaliseLeaveType(selectedLeave?.leave_type) !== "annual_leave";

  async function loadActionCentre() {
    setLoading(true);
    setError(null);

    const [leaveResult, notificationResult, exceptionsResult, payrollResult, documentsResult, signingLinksResult] =
      await Promise.all([
        supabase
          .from("leave_requests")
          .select("*")
          .order("created_at", { ascending: false })
          .limit(50),
        supabase
          .from("employee_notifications").select("*")
          .in("notification_type", [
            "hr_warning",
            "hr_document",
            "clocking_feedback",
            "payroll_feedback",
            "general",
            "manager_message",
          ])
          .in("delivery_status", ["pending", "drafted", "failed"])
          .order("created_at", { ascending: false })
          .limit(20),
        supabase
          .from("exceptions")
          .select("*")
          .order("created_at", { ascending: false })
          .limit(20),
        supabase
          .from("payroll_clock_checks")
          .select("*")
          .order("shift_date", { ascending: false })
          .limit(20),
        supabase
          .from("employee_generated_documents")
          .select("id,employee_id,document_title,document_type,signature_status,signed_at,created_at")
          .order("created_at", { ascending: false })
          .limit(20),
        supabase
          .from("document_signing_links")
          .select("id,employee_id,document_id,status,expires_at,opened_at,signed_at,created_at")
          .order("created_at", { ascending: false })
          .limit(20),
      ]);

    if (leaveResult.error) {
      setError(leaveResult.error.message);
    } else {
      setLeaveRequests((leaveResult.data || []) as LeaveRequest[]);
    }

    if (notificationResult.error) {
      setError(notificationResult.error.message);
    } else {
      setNotifications((notificationResult.data || []) as EmployeeNotification[]);
    }

    if (exceptionsResult.data) {
      setExceptions(exceptionsResult.data as ExceptionRow[]);
    }

    if (payrollResult.data) {
      setPayrollChecks(payrollResult.data as PayrollClockCheck[]);
    }

    if (documentsResult.data) {
      setGeneratedDocuments(documentsResult.data as GeneratedDocument[]);
    }

    if (signingLinksResult.data) {
      setSigningLinks(signingLinksResult.data as SigningLink[]);
    }

    setLoading(false);
  }

  async function loadLeaveBalanceForRequest(leave: LeaveRequest) {
    setSelectedLeaveBalance(null);

    if (!leave.employee_id) return;

    const leaveType = normaliseLeaveType(leave.leave_type);

    const { data } = await supabase
      .from("leave_balances_live")
      .select("*")
      .eq("employee_id", leave.employee_id)
      .eq("leave_type", leaveType)
      .limit(1)
      .maybeSingle();

    if (data) {
      setSelectedLeaveBalance(data as LeaveBalanceLive);
    }
  }

  useEffect(() => {
    loadActionCentre();
  }, []);

  function go(screen: string) {
    if (onNavigate) onNavigate(screen);
  }

  async function openLeaveDetails(leave: LeaveRequest) {
    setSelectedLeave(leave);
    setFeedback(leave.manager_feedback || "");
    setError(null);
    await loadLeaveBalanceForRequest(leave);
  }

  async function updateSelectedLeave(status: "approved" | "declined" | "amended") {
    if (!selectedLeave) return;

    setActionSaving(true);
    setError(null);

    if (status === "approved" && !selectedLeaveHasEnoughBalance) {
      setError(
        "This employee does not have enough annual leave days due. Approve only after adjusting the balance or selecting unpaid leave."
      );
      setActionSaving(false);
      return;
    }

    const { error: updateError } = await supabase
      .from("leave_requests")
      .update({
        status,
        manager_feedback: feedback.trim() || null,
      })
      .eq("id", selectedLeave.id);

    if (updateError) {
      setError(updateError.message);
      setActionSaving(false);
      return;
    }

    setSelectedLeave(null);
    setSelectedLeaveBalance(null);
    setFeedback("");
    await loadActionCentre();
    setActionSaving(false);
  }

  return (
    <div className="mt-8 space-y-8">
      <section className="relative overflow-hidden rounded-[2.2rem] border border-white/70 bg-white/95 p-7 text-[#06101f] shadow-[0_22px_70px_rgba(15,23,42,0.16)] backdrop-blur-xl">
        <div className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full bg-cyan-300/30 blur-[80px]" />
        <div className="pointer-events-none absolute bottom-[-120px] left-1/3 h-72 w-72 rounded-full bg-blue-400/20 blur-[90px]" />
        <div className="relative z-10">
        <div className="flex flex-col gap-5 md:flex-row md:items-center md:justify-between">
          <div>
            <div className="text-xs font-bold uppercase tracking-[0.4em] text-cyan-700">
              Manager Action Centre
            </div>
            <h2 className="mt-3 text-4xl font-bold">What needs attention now</h2>
            <p className="mt-4 max-w-3xl text-sm leading-7 text-slate-600">
              Pending leave, actionable employee notifications, open exceptions and blocked
              payroll checks are shown here so managers know what to action first.
            </p>
          </div>

          <button
            onClick={loadActionCentre}
            className="flex w-fit items-center gap-2 rounded-2xl bg-white px-5 py-3 text-sm font-bold text-slate-950"
          >
            <RefreshCcw className="h-4 w-4" />
            {loading ? "Loading..." : "Refresh"}
          </button>
        </div>
      </div>
      </section>

      <section className="grid gap-4 md:grid-cols-6">
        <button onClick={() => go("Leave Approvals")} className="text-left">
          <ActionCard
            title="Pending Leave"
            value={String(pendingLeave.length)}
            subtitle="Needs manager approval"
            tone="border-amber-200 bg-amber-50 text-amber-900"
            icon={<CalendarDays className="h-6 w-6 text-amber-700" />}
          />
        </button>

        <button onClick={() => go("Employee Notifications")} className="text-left">
          <ActionCard
            title="Notifications"
            value={String(pendingNotifications.length)}
            subtitle="Actionable only"
            tone="border-cyan-200 bg-cyan-50 text-cyan-900"
            icon={<Bell className="h-6 w-6 text-cyan-700" />}
          />
        </button>

        <button onClick={() => go("Exceptions")} className="text-left">
          <ActionCard
            title="Exceptions"
            value={String(openExceptions.length)}
            subtitle="Open operational issues"
            tone="border-rose-200 bg-rose-50 text-rose-900"
            icon={<AlertTriangle className="h-6 w-6 text-rose-700" />}
          />
        </button>

        <button onClick={() => go("Payroll Clock Engine")} className="text-left">
          <ActionCard
            title="Blocked Payroll"
            value={String(blockedPayroll.length)}
            subtitle="Cannot export yet"
            tone="border-slate-200 bg-slate-50 text-slate-900"
            icon={<ShieldAlert className="h-6 w-6 text-slate-700" />}
          />
        </button>

        <button onClick={() => go("HR Contract Centre")} className="text-left">
          <ActionCard
            title="Unsigned Docs"
            value={String(unsignedDocuments.length)}
            subtitle="Need signature"
            tone="border-cyan-200 bg-cyan-50 text-cyan-900"
            icon={<FileSignatureIcon />}
          />
        </button>

        <button onClick={() => go("HR Contract Centre")} className="text-left">
          <ActionCard
            title="Signing Links"
            value={String(openSigningLinks.length)}
            subtitle="Active WhatsApp links"
            tone="border-emerald-200 bg-emerald-50 text-emerald-900"
            icon={<LinkIcon />}
          />
        </button>
      </section>

      {error && (
        <section className="rounded-2xl bg-rose-50 p-4 text-sm font-semibold text-rose-700">
          <AlertTriangle className="mr-2 inline h-4 w-4" />
          {error}
        </section>
      )}

      <section className="grid gap-8 xl:grid-cols-2">
        <div className="rounded-[2rem] border border-white/80 bg-white/95 p-6 shadow-[0_18px_55px_rgba(15,23,42,0.12)] backdrop-blur-xl">
          <div className="flex items-center justify-between gap-4">
            <div>
              <div className="text-xs font-bold uppercase tracking-[0.35em] text-amber-600">
                Leave
              </div>
              <h3 className="mt-2 text-2xl font-bold text-slate-950">
                Latest Pending Leave
              </h3>
            </div>

            <button
              onClick={() => go("Leave Approvals")}
              className="rounded-2xl bg-slate-950 px-4 py-3 text-sm font-bold text-[#06101f]"
            >
              Open Leave Approvals
            </button>
          </div>

          <div className="mt-5 space-y-3">
            {pendingLeave.length === 0 ? (
              <div className="rounded-2xl bg-emerald-50 p-5 text-sm font-semibold text-emerald-700">
                <CheckCircle2 className="mr-2 inline h-4 w-4" />
                No pending leave requests.
              </div>
            ) : (
              pendingLeave.slice(0, 10).map((leave) => (
                <button
                  type="button"
                  key={leave.id}
                  onClick={() => openLeaveDetails(leave)}
                  className={`w-full rounded-2xl border p-4 text-left transition hover:-translate-y-0.5 hover:shadow-lg ${
                    selectedLeave?.id === leave.id
                      ? "border-cyan-400 bg-cyan-50"
                      : "border-slate-200 bg-slate-50"
                  }`}
                >
                  <div className="font-bold text-slate-950">
                    {leave.employee_name || "Unknown employee"}
                  </div>
                  <div className="mt-1 text-xs font-semibold text-slate-500">
                    {leave.employee_id || "No employee code"} Â· {formatText(leave.leave_type)}
                  </div>
                  <div className="mt-3 text-sm text-slate-600">
                    {formatDate(leave.start_date)} â†’ {formatDate(leave.end_date)} Â·{" "}
                    {leaveDays(leave.start_date, leave.end_date)} day(s)
                  </div>
                  <div className="mt-3 rounded-2xl bg-white px-4 py-3 text-xs font-bold text-cyan-700">
                    Click to open approval details
                  </div>
                </button>
              ))
            )}
          </div>
        </div>

        <div className="rounded-[2rem] border border-white/80 bg-white/95 p-6 shadow-[0_18px_55px_rgba(15,23,42,0.12)] backdrop-blur-xl">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="text-xs font-bold uppercase tracking-[0.35em] text-cyan-600">
                Leave Review
              </div>
              <h3 className="mt-2 text-2xl font-bold text-slate-950">
                Approval Details
              </h3>
              <p className="mt-2 text-sm text-slate-500">
                Click a pending leave request on the left to review and approve.
              </p>
            </div>

            {selectedLeave && (
              <button
                onClick={() => {
                  setSelectedLeave(null);
                  setSelectedLeaveBalance(null);
                  setFeedback("");
                  setError(null);
                }}
                className="rounded-2xl bg-slate-100 p-3 text-slate-700"
              >
                <X className="h-5 w-5" />
              </button>
            )}
          </div>

          {!selectedLeave ? (
            <div className="mt-6 rounded-[26px] border border-dashed border-slate-200 bg-slate-50 p-8 text-center">
              <CalendarDays className="mx-auto h-10 w-10 text-slate-600" />
              <div className="mt-3 text-lg font-bold text-slate-950">
                No leave request selected
              </div>
              <p className="mt-2 text-sm text-slate-500">
                Select a leave request to see details, leave balance, and approval buttons.
              </p>
            </div>
          ) : (
            <>
              <div className="mt-6 rounded-[2rem] border border-white/80 bg-white/90 p-5 shadow-[0_16px_45px_rgba(15,23,42,0.10)] backdrop-blur-xl">
                <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                  <div>
                    <div className="text-2xl font-black text-slate-950">
                      {selectedLeave.employee_name || "Unknown employee"}
                    </div>
                    <div className="mt-1 text-sm font-semibold text-slate-500">
                      {selectedLeave.employee_id || "No employee code"} Â·{" "}
                      {formatText(selectedLeave.leave_type)}
                    </div>
                  </div>

                  <span className="w-fit rounded-full bg-amber-100 px-3 py-1 text-xs font-black uppercase text-amber-700">
                    Pending
                  </span>
                </div>

                <div className="mt-5 grid gap-3 md:grid-cols-3">
                  <InfoTile label="Start" value={formatDate(selectedLeave.start_date)} />
                  <InfoTile label="End" value={formatDate(selectedLeave.end_date)} />
                  <InfoTile label="Requested Days" value={`${selectedLeaveDays} day(s)`} />
                </div>

                <div className="mt-4 rounded-2xl border border-white/80 bg-white/95 p-4 shadow-sm">
                  <div className="text-xs font-black uppercase tracking-[0.2em] text-slate-400">
                    Reason
                  </div>
                  <div className="mt-2 text-sm leading-6 text-slate-700">
                    {selectedLeave.reason || "No reason supplied."}
                  </div>
                </div>
              </div>

              <div className="mt-5 rounded-[2rem] border border-white/80 bg-white/90 p-5 shadow-[0_16px_45px_rgba(15,23,42,0.10)] backdrop-blur-xl">
                <div className="text-xs font-bold uppercase tracking-[0.35em] text-cyan-600">
                  Leave Balance Check
                </div>

                {!selectedLeaveBalance ? (
                  <div className="mt-4 rounded-2xl bg-amber-50 p-4 text-sm font-semibold text-amber-700">
                    No matching leave balance found for this employee/type. You can still decline
                    or amend, but approval should only happen after checking Leave Balance Control.
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
                        ? "Balance check passed for this request."
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
                  className="mt-2 w-full rounded-2xl border border-white/80 bg-white/80 shadow-sm backdrop-blur-xl px-4 py-3 text-sm font-semibold outline-none focus:border-cyan-400"
                  placeholder="Optional feedback to employee..."
                />
              </label>

              <div className="mt-5 grid gap-3 md:grid-cols-3">
                <button
                  onClick={() => updateSelectedLeave("approved")}
                  disabled={actionSaving || !selectedLeaveHasEnoughBalance}
                  className="rounded-2xl bg-emerald-600 px-5 py-4 text-sm font-black text-[#06101f] disabled:bg-slate-300 disabled:text-slate-500"
                >
                  Approve
                </button>

                <button
                  onClick={() => updateSelectedLeave("declined")}
                  disabled={actionSaving}
                  className="rounded-2xl bg-rose-600 px-5 py-4 text-sm font-black text-[#06101f] disabled:bg-slate-300 disabled:text-slate-500"
                >
                  Decline
                </button>

                <button
                  onClick={() => updateSelectedLeave("amended")}
                  disabled={actionSaving}
                  className="rounded-2xl bg-blue-600 px-5 py-4 text-sm font-black text-[#06101f] disabled:bg-slate-300 disabled:text-slate-500"
                >
                  Amend
                </button>
              </div>
            </>
          )}
        </div>
      </section>

      <section className="grid gap-8 xl:grid-cols-2">
        <div className="rounded-[2rem] border border-white/80 bg-white/95 p-6 shadow-[0_18px_55px_rgba(15,23,42,0.12)] backdrop-blur-xl">
          <div className="flex items-center justify-between gap-4">
            <div>
              <div className="text-xs font-bold uppercase tracking-[0.35em] text-cyan-600">
                Messages
              </div>
              <h3 className="mt-2 text-2xl font-bold text-slate-950">
                Latest Actionable Notifications
              </h3>
            </div>

            <button
              onClick={() => go("Employee Notifications")}
              className="rounded-2xl bg-slate-950 px-4 py-3 text-sm font-bold text-[#06101f]"
            >
              Open
            </button>
          </div>

          <div className="mt-5 space-y-3">
            {pendingNotifications.length === 0 ? (
              <div className="rounded-2xl bg-emerald-50 p-5 text-sm font-semibold text-emerald-700">
                <CheckCircle2 className="mr-2 inline h-4 w-4" />
                No actionable employee notifications.
              </div>
            ) : (
              pendingNotifications.slice(0, 5).map((notification) => (
                <div
                  key={notification.id}
                  className="rounded-2xl border border-white/80 bg-white/80 shadow-sm backdrop-blur-xl p-4"
                >
                  <div className="font-bold text-slate-950">
                    {notification.employee_name}
                  </div>
                  <div className="mt-1 text-xs font-semibold text-slate-500">
                    {notification.title} Â· {notification.delivery_status}
                  </div>
                  <div className="mt-3 text-sm text-slate-600">
                    {formatDateTime(notification.created_at)}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="rounded-[34px] border border-cyan-200 bg-cyan-50 p-6 text-sm leading-6 text-cyan-900">
          <Clock3 className="mr-2 inline h-4 w-4" />
          Best practice: managers should start every day here before payroll, leave or HR
          work. This prevents missed leave requests and payroll blockers.
        </div>
      </section>
    </div>
  );
}

  

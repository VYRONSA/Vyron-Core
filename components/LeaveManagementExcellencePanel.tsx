"use client";

import React, { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CalendarDays,
  CheckCircle2,
  Clock3,
  RefreshCcw,
  ShieldCheck,
  TrendingUp,
  Users,
} from "lucide-react";
import { getCompanyAccess } from "@/lib/company-access";
import {
  absenteeismRate,
  detectLeaveOverlaps,
  forecastBalance,
  leaveDays,
  leaveTypeLabel,
  normalizeMonthlyAccrual,
  projectAllBalances,
  upcomingRequests,
  workflowCounts,
} from "@/lib/leave-enterprise";
import { supabase } from "@/lib/supabase";

type LeaveRequestRow = {
  id: string;
  company_id: string;
  employee_id: string | null;
  employee_name: string | null;
  leave_type: string | null;
  start_date: string;
  end_date: string;
  reason: string | null;
  status: string;
  workflow_stage: string | null;
  reviewed_by_manager: string | null;
  reviewed_by_hr: string | null;
  manager_feedback: string | null;
  created_at: string;
};

type LeaveBalanceRow = {
  id: string;
  employee_id: string;
  employee_name: string;
  leave_type: string;
  days_due_live: number;
  days_accrued_live: number;
  days_taken: number;
  pending_days: number;
  monthly_accrual_days?: number | null;
};

type LeaveTypeConfig = {
  id: string;
  leave_type_code: string;
  leave_type_name: string;
  monthly_accrual_days: number;
  carry_forward_limit_days: number;
  carry_forward_expiry_months: number;
  maximum_balance_days: number | null;
  requires_attachment: boolean;
  requires_medical_certificate: boolean;
  is_custom: boolean;
  status: string;
};

type LeaveRuleRow = {
  id: string;
  rule_name: string;
  leave_type_code: string | null;
  minimum_notice_days: number | null;
  maximum_consecutive_days: number | null;
  max_team_members_on_leave: number | null;
  enforce_peak_period_restriction: boolean;
  enforce_blackout_restriction: boolean;
  enforce_attachment: boolean;
  enforce_medical_certificate: boolean;
  status: string;
};

type HolidayRow = {
  id: string;
  holiday_name: string;
  holiday_date: string;
  region: string | null;
};

type PeakPeriodRow = {
  id: string;
  period_name: string;
  start_date: string;
  end_date: string;
  max_leave_headcount: number | null;
  status: string;
};

type BlackoutRow = {
  id: string;
  period_name: string;
  start_date: string;
  end_date: string;
  applies_to_leave_type: string | null;
  status: string;
};

type EmployeeRow = {
  id: string;
  first_name: string;
  last_name: string;
  default_store_id: string | null;
};

type StoreRow = {
  id: string;
  name: string;
};

type LeaveDocumentRow = {
  id: string;
  employee_id: string | null;
  employee_name: string | null;
  document_title: string | null;
  document_type: string | null;
  file_url: string | null;
  archive_status: string | null;
  leave_request_id: string | null;
  created_at: string;
};

type LeaveAccrualRun = {
  id: string;
  run_for_date: string;
  run_status: string;
  processed_employees: number;
  notes: string | null;
  created_at: string;
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
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return value;
  }
}

function employeeName(employee: EmployeeRow | undefined) {
  if (!employee) return "Unknown employee";
  return `${employee.first_name || ""} ${employee.last_name || ""}`.trim();
}

function MetricCard({ title, value, subtitle, tone }: { title: string; value: string; subtitle: string; tone: string }) {
  return (
    <div className={`rounded-[28px] border p-5 ${tone}`}>
      <div className="text-xs font-black uppercase tracking-[0.2em] opacity-70">{title}</div>
      <div className="mt-3 text-4xl font-black">{value}</div>
      <div className="mt-2 text-sm font-semibold opacity-80">{subtitle}</div>
    </div>
  );
}

export default function LeaveManagementExcellencePanel() {
  const [companyId, setCompanyId] = useState("");
  const [requests, setRequests] = useState<LeaveRequestRow[]>([]);
  const [balances, setBalances] = useState<LeaveBalanceRow[]>([]);
  const [leaveTypes, setLeaveTypes] = useState<LeaveTypeConfig[]>([]);
  const [rules, setRules] = useState<LeaveRuleRow[]>([]);
  const [holidays, setHolidays] = useState<HolidayRow[]>([]);
  const [peakPeriods, setPeakPeriods] = useState<PeakPeriodRow[]>([]);
  const [blackoutPeriods, setBlackoutPeriods] = useState<BlackoutRow[]>([]);
  const [employees, setEmployees] = useState<EmployeeRow[]>([]);
  const [stores, setStores] = useState<StoreRow[]>([]);
  const [documents, setDocuments] = useState<LeaveDocumentRow[]>([]);
  const [accrualRuns, setAccrualRuns] = useState<LeaveAccrualRun[]>([]);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const [forecastMonths, setForecastMonths] = useState("6");
  const [projectedLeavePerMonth, setProjectedLeavePerMonth] = useState("1.5");

  const [newRuleName, setNewRuleName] = useState("");
  const [newRuleLeaveType, setNewRuleLeaveType] = useState("annual_leave");
  const [newRuleMinimumNotice, setNewRuleMinimumNotice] = useState("3");
  const [newRuleMaxConsecutive, setNewRuleMaxConsecutive] = useState("20");
  const [newRuleTeamLimit, setNewRuleTeamLimit] = useState("2");

  const [newHolidayName, setNewHolidayName] = useState("");
  const [newHolidayDate, setNewHolidayDate] = useState("");
  const [newHolidayRegion, setNewHolidayRegion] = useState("ZA");

  const [newPeakName, setNewPeakName] = useState("");
  const [newPeakStart, setNewPeakStart] = useState("");
  const [newPeakEnd, setNewPeakEnd] = useState("");
  const [newPeakLimit, setNewPeakLimit] = useState("2");

  const [newBlackoutName, setNewBlackoutName] = useState("");
  const [newBlackoutStart, setNewBlackoutStart] = useState("");
  const [newBlackoutEnd, setNewBlackoutEnd] = useState("");
  const [newBlackoutType, setNewBlackoutType] = useState("annual_leave");

  useEffect(() => {
    let cancelled = false;

    async function resolveCompany() {
      const { access, error: accessError } = await getCompanyAccess(supabase);
      if (cancelled) return;

      if (accessError || !access?.company_id) {
        setError(accessError || "No company access.");
        return;
      }

      setCompanyId(access.company_id);
    }

    resolveCompany();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!companyId) return;
    void loadAll(companyId);
  }, [companyId]);

  async function loadAll(activeCompanyId: string) {
    setLoading(true);
    setError(null);

    const [
      requestsRes,
      balancesRes,
      leaveTypesRes,
      rulesRes,
      holidaysRes,
      peakRes,
      blackoutRes,
      employeesRes,
      storesRes,
      documentsRes,
      accrualRunsRes,
    ] = await Promise.all([
      supabase
        .from("leave_requests")
        .select("id,company_id,employee_id,employee_name,leave_type,start_date,end_date,reason,status,workflow_stage,reviewed_by_manager,reviewed_by_hr,manager_feedback,created_at")
        .eq("company_id", activeCompanyId)
        .order("created_at", { ascending: false })
        .limit(2000),
      supabase
        .from("leave_balances_live")
        .select("id,employee_id,employee_name,leave_type,days_due_live,days_accrued_live,days_taken,pending_days,monthly_accrual_days")
        .eq("company_id", activeCompanyId)
        .limit(3000),
      supabase
        .from("leave_types_config")
        .select("id,leave_type_code,leave_type_name,monthly_accrual_days,carry_forward_limit_days,carry_forward_expiry_months,maximum_balance_days,requires_attachment,requires_medical_certificate,is_custom,status")
        .eq("company_id", activeCompanyId)
        .order("leave_type_name", { ascending: true }),
      supabase
        .from("leave_rules")
        .select("id,rule_name,leave_type_code,minimum_notice_days,maximum_consecutive_days,max_team_members_on_leave,enforce_peak_period_restriction,enforce_blackout_restriction,enforce_attachment,enforce_medical_certificate,status")
        .eq("company_id", activeCompanyId)
        .order("created_at", { ascending: false }),
      supabase
        .from("leave_public_holidays")
        .select("id,holiday_name,holiday_date,region")
        .eq("company_id", activeCompanyId)
        .order("holiday_date", { ascending: true }),
      supabase
        .from("leave_peak_periods")
        .select("id,period_name,start_date,end_date,max_leave_headcount,status")
        .eq("company_id", activeCompanyId)
        .order("start_date", { ascending: true }),
      supabase
        .from("leave_blackout_periods")
        .select("id,period_name,start_date,end_date,applies_to_leave_type,status")
        .eq("company_id", activeCompanyId)
        .order("start_date", { ascending: true }),
      supabase
        .from("employees")
        .select("id,first_name,last_name,default_store_id")
        .eq("company_id", activeCompanyId)
        .eq("active", true)
        .order("first_name", { ascending: true }),
      supabase
        .from("stores")
        .select("id,name")
        .eq("company_id", activeCompanyId)
        .order("name", { ascending: true }),
      supabase
        .from("hr_documents")
        .select("id,employee_id,employee_name,document_title,document_type,file_url,archive_status,leave_request_id,created_at")
        .eq("company_id", activeCompanyId)
        .in("document_type", ["leave", "leave_form", "medical_certificate", "supporting_document"])
        .order("created_at", { ascending: false })
        .limit(400),
      supabase
        .from("leave_accrual_runs")
        .select("id,run_for_date,run_status,processed_employees,notes,created_at")
        .eq("company_id", activeCompanyId)
        .order("created_at", { ascending: false })
        .limit(50),
    ]);

    const firstError = [
      requestsRes.error,
      balancesRes.error,
      leaveTypesRes.error,
      rulesRes.error,
      holidaysRes.error,
      peakRes.error,
      blackoutRes.error,
      employeesRes.error,
      storesRes.error,
      documentsRes.error,
      accrualRunsRes.error,
    ].find(Boolean);

    if (firstError) {
      setError(firstError.message);
      setLoading(false);
      return;
    }

    setRequests((requestsRes.data || []) as LeaveRequestRow[]);
    setBalances((balancesRes.data || []) as LeaveBalanceRow[]);
    setLeaveTypes((leaveTypesRes.data || []) as LeaveTypeConfig[]);
    setRules((rulesRes.data || []) as LeaveRuleRow[]);
    setHolidays((holidaysRes.data || []) as HolidayRow[]);
    setPeakPeriods((peakRes.data || []) as PeakPeriodRow[]);
    setBlackoutPeriods((blackoutRes.data || []) as BlackoutRow[]);
    setEmployees((employeesRes.data || []) as EmployeeRow[]);
    setStores((storesRes.data || []) as StoreRow[]);
    setDocuments((documentsRes.data || []) as LeaveDocumentRow[]);
    setAccrualRuns((accrualRunsRes.data || []) as LeaveAccrualRun[]);

    setLoading(false);
  }

  const overlaps = useMemo(() => detectLeaveOverlaps(requests), [requests]);

  const workflow = useMemo(() => workflowCounts(requests), [requests]);

  const upcoming = useMemo(() => upcomingRequests(requests, 21), [requests]);

  const monthRangeDays = 30;
  const last30DaysRequests = useMemo(() => {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 30);
    return requests.filter((item) => new Date(`${item.start_date}T12:00:00`).getTime() >= cutoff.getTime());
  }, [requests]);

  const absenteeism = useMemo(
    () =>
      absenteeismRate({
        totalEmployees: employees.length,
        leaveRequestsInRange: last30DaysRequests,
        rangeDays: monthRangeDays,
      }),
    [employees.length, last30DaysRequests]
  );

  const projected = useMemo(() => {
    const months = Math.max(1, Number(forecastMonths || "6"));
    const projectedUse = Math.max(0, Number(projectedLeavePerMonth || "1.5"));
    return projectAllBalances({ balances, months, projectedLeaveDaysPerMonth: projectedUse });
  }, [balances, forecastMonths, projectedLeavePerMonth]);

  const managerPending = useMemo(
    () => requests.filter((item) => String(item.workflow_stage || "submitted") === "submitted"),
    [requests]
  );

  const hrPending = useMemo(
    () => requests.filter((item) => String(item.workflow_stage || "submitted") === "manager_approved"),
    [requests]
  );

  const leaveByType = useMemo(() => {
    const counts = new Map<string, number>();
    for (const request of requests) {
      const key = String(request.leave_type || "other");
      counts.set(key, (counts.get(key) || 0) + leaveDays(request.start_date, request.end_date));
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [requests]);

  const leaveByStore = useMemo(() => {
    const employeeStore = new Map<string, string>();
    employees.forEach((employee) => employeeStore.set(employee.id, employee.default_store_id || ""));

    const counts = new Map<string, number>();
    for (const request of requests) {
      const storeId = request.employee_id ? employeeStore.get(request.employee_id) || "unassigned" : "unassigned";
      counts.set(storeId, (counts.get(storeId) || 0) + leaveDays(request.start_date, request.end_date));
    }

    return [...counts.entries()].map(([storeId, value]) => ({
      storeId,
      storeName: stores.find((store) => store.id === storeId)?.name || "Unassigned",
      leaveDays: value,
    }));
  }, [employees, requests, stores]);

  async function runAccrualNow() {
    if (!companyId) return;

    setSaving(true);
    setError(null);
    setMessage(null);

    const accrualByType = new Map<string, number>();
    for (const item of leaveTypes) {
      accrualByType.set(item.leave_type_code, normalizeMonthlyAccrual(item.leave_type_code, item.monthly_accrual_days));
    }

    let processed = 0;

    for (const balance of balances) {
      const accrual = accrualByType.get(balance.leave_type) ?? normalizeMonthlyAccrual(balance.leave_type, balance.monthly_accrual_days);
      const currentAccrued = Number(balance.days_accrued_live || 0);

      const { error: updateError } = await supabase
        .from("leave_balances")
        .update({
          accrued: Math.round((currentAccrued + accrual) * 100) / 100,
          updated_at: new Date().toISOString(),
        })
        .eq("id", balance.id)
        .eq("company_id", companyId);

      if (!updateError) processed += 1;
    }

    await supabase.from("leave_accrual_runs").upsert({
      company_id: companyId,
      run_for_date: new Date().toISOString().slice(0, 10),
      run_status: "completed",
      processed_employees: processed,
      notes: "Manual accrual run from Leave Management Excellence panel.",
    });

    setMessage(`Accrual run complete. ${processed} balance row(s) updated.`);
    setSaving(false);
    await loadAll(companyId);
  }

  async function createRule() {
    if (!companyId) return;
    if (!newRuleName.trim()) {
      setError("Rule name is required.");
      return;
    }

    const { error: insertError } = await supabase.from("leave_rules").insert({
      company_id: companyId,
      rule_name: newRuleName.trim(),
      leave_type_code: newRuleLeaveType,
      minimum_notice_days: Number(newRuleMinimumNotice || "0"),
      maximum_consecutive_days: Number(newRuleMaxConsecutive || "0"),
      max_team_members_on_leave: Number(newRuleTeamLimit || "0"),
      enforce_peak_period_restriction: true,
      enforce_blackout_restriction: true,
      enforce_attachment: true,
      enforce_medical_certificate: newRuleLeaveType === "sick_leave",
      status: "active",
    });

    if (insertError) {
      setError(insertError.message);
      return;
    }

    setMessage("Leave rule saved.");
    setNewRuleName("");
    await loadAll(companyId);
  }

  async function createHoliday() {
    if (!companyId) return;
    if (!newHolidayName.trim() || !newHolidayDate) {
      setError("Holiday name and date are required.");
      return;
    }

    const { error: insertError } = await supabase.from("leave_public_holidays").insert({
      company_id: companyId,
      holiday_name: newHolidayName.trim(),
      holiday_date: newHolidayDate,
      region: newHolidayRegion.trim() || null,
    });

    if (insertError) {
      setError(insertError.message);
      return;
    }

    setMessage("Public holiday saved.");
    setNewHolidayName("");
    setNewHolidayDate("");
    await loadAll(companyId);
  }

  async function createPeakPeriod() {
    if (!companyId) return;
    if (!newPeakName.trim() || !newPeakStart || !newPeakEnd) {
      setError("Peak period name and date range are required.");
      return;
    }

    const { error: insertError } = await supabase.from("leave_peak_periods").insert({
      company_id: companyId,
      period_name: newPeakName.trim(),
      start_date: newPeakStart,
      end_date: newPeakEnd,
      max_leave_headcount: Number(newPeakLimit || "0") || null,
      status: "active",
    });

    if (insertError) {
      setError(insertError.message);
      return;
    }

    setMessage("Peak period saved.");
    setNewPeakName("");
    setNewPeakStart("");
    setNewPeakEnd("");
    await loadAll(companyId);
  }

  async function createBlackoutPeriod() {
    if (!companyId) return;
    if (!newBlackoutName.trim() || !newBlackoutStart || !newBlackoutEnd) {
      setError("Blackout period name and date range are required.");
      return;
    }

    const { error: insertError } = await supabase.from("leave_blackout_periods").insert({
      company_id: companyId,
      period_name: newBlackoutName.trim(),
      start_date: newBlackoutStart,
      end_date: newBlackoutEnd,
      applies_to_leave_type: newBlackoutType,
      status: "active",
    });

    if (insertError) {
      setError(insertError.message);
      return;
    }

    setMessage("Blackout period saved.");
    setNewBlackoutName("");
    setNewBlackoutStart("");
    setNewBlackoutEnd("");
    await loadAll(companyId);
  }

  async function archiveDocument(documentId: string) {
    if (!companyId) return;

    const { error: updateError } = await supabase
      .from("hr_documents")
      .update({ archive_status: "archived", updated_at: new Date().toISOString() })
      .eq("id", documentId)
      .eq("company_id", companyId);

    if (updateError) {
      setError(updateError.message);
      return;
    }

    setMessage("Document archived.");
    await loadAll(companyId);
  }

  const organisationLeavePercent = useMemo(() => {
    const totalPossible = employees.length * 30;
    if (totalPossible <= 0) return 0;
    const totalLeaveDays = last30DaysRequests.reduce(
      (sum, item) => sum + leaveDays(item.start_date, item.end_date),
      0
    );
    return Math.round((totalLeaveDays / totalPossible) * 1000) / 10;
  }, [employees.length, last30DaysRequests]);

  return (
    <div className="mt-8 space-y-8">
      <section className="rounded-[34px] bg-gradient-to-r from-[#07101f] to-[#0b1a33] p-6 text-white shadow-2xl shadow-slate-300">
        <div className="flex flex-col gap-5 md:flex-row md:items-center md:justify-between">
          <div>
            <div className="text-xs font-bold uppercase tracking-[0.4em] text-cyan-300">Leave Excellence</div>
            <h2 className="mt-3 text-4xl font-bold">Enterprise Leave Management</h2>
            <p className="mt-4 max-w-4xl text-sm leading-7 text-slate-300">
              Accrual automation, planner conflicts, workflow stages, forecasting,
              leave rules, analytics, manager command metrics and executive visibility.
            </p>
          </div>

          <button
            onClick={() => companyId && loadAll(companyId)}
            className="flex w-fit items-center gap-2 rounded-2xl bg-white px-5 py-3 text-sm font-bold text-slate-950"
          >
            <RefreshCcw className="h-4 w-4" />
            {loading ? "Loading..." : "Refresh"}
          </button>
        </div>
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

      <section className="grid gap-4 md:grid-cols-4 xl:grid-cols-8">
        <MetricCard title="Pending" value={String(managerPending.length)} subtitle="Manager queue" tone="border-amber-200 bg-amber-50 text-amber-900" />
        <MetricCard title="HR Queue" value={String(hrPending.length)} subtitle="Awaiting HR" tone="border-cyan-200 bg-cyan-50 text-cyan-900" />
        <MetricCard title="Upcoming" value={String(upcoming.length)} subtitle="Next 21 days" tone="border-slate-200 bg-white text-slate-950" />
        <MetricCard title="Conflicts" value={String(overlaps.length)} subtitle="Overlap detections" tone="border-rose-200 bg-rose-50 text-rose-900" />
        <MetricCard title="Absenteeism" value={`${absenteeism}%`} subtitle="Last 30 days" tone="border-violet-200 bg-violet-50 text-violet-900" />
        <MetricCard title="Org Leave %" value={`${organisationLeavePercent}%`} subtitle="Executive KPI" tone="border-indigo-200 bg-indigo-50 text-indigo-900" />
        <MetricCard title="Documents" value={String(documents.length)} subtitle="Leave docs" tone="border-emerald-200 bg-emerald-50 text-emerald-900" />
        <MetricCard title="Accrual Runs" value={String(accrualRuns.length)} subtitle="Run history" tone="border-slate-200 bg-slate-50 text-slate-900" />
      </section>

      <section className="grid gap-6 xl:grid-cols-2">
        <div className="rounded-[34px] border border-slate-200 bg-white p-6 shadow-[0_10px_30px_rgba(0,0,0,0.08)]">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-xs font-bold uppercase tracking-[0.35em] text-blue-600">Workflow</div>
              <h3 className="mt-2 text-2xl font-bold text-slate-950">Leave Workflow Stages</h3>
            </div>
            <ShieldCheck className="h-6 w-6 text-blue-700" />
          </div>

          <div className="mt-5 grid gap-3 md:grid-cols-3">
            <MetricCard title="Draft" value={String(workflow.draft)} subtitle="Saved drafts" tone="border-slate-200 bg-slate-50 text-slate-900" />
            <MetricCard title="Submitted" value={String(workflow.submitted)} subtitle="Waiting manager" tone="border-amber-200 bg-amber-50 text-amber-900" />
            <MetricCard title="Mgr Approved" value={String(workflow.manager_approved)} subtitle="Waiting HR" tone="border-cyan-200 bg-cyan-50 text-cyan-900" />
            <MetricCard title="HR Approved" value={String(workflow.hr_approved)} subtitle="Final approved" tone="border-emerald-200 bg-emerald-50 text-emerald-900" />
            <MetricCard title="Rejected" value={String(workflow.rejected)} subtitle="Declined" tone="border-rose-200 bg-rose-50 text-rose-900" />
            <MetricCard title="Closed" value={String(workflow.cancelled + workflow.completed)} subtitle="Cancelled/complete" tone="border-slate-200 bg-white text-slate-950" />
          </div>
        </div>

        <div className="rounded-[34px] border border-slate-200 bg-white p-6 shadow-[0_10px_30px_rgba(0,0,0,0.08)]">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-xs font-bold uppercase tracking-[0.35em] text-blue-600">Accrual Engine</div>
              <h3 className="mt-2 text-2xl font-bold text-slate-950">Automatic Accrual Controls</h3>
            </div>
            <Clock3 className="h-6 w-6 text-blue-700" />
          </div>

          <div className="mt-5 grid gap-3 md:grid-cols-2">
            <button
              onClick={runAccrualNow}
              disabled={saving}
              className="rounded-2xl bg-slate-950 px-4 py-3 text-sm font-black text-cyan-300"
            >
              {saving ? "Running..." : "Run Accrual Now"}
            </button>

            <div className="rounded-2xl bg-slate-50 p-4">
              <div className="text-xs font-black uppercase tracking-[0.18em] text-slate-500">Last Run</div>
              <div className="mt-2 text-sm font-bold text-slate-900">
                {formatDateTime(accrualRuns[0]?.created_at || null)}
              </div>
            </div>
          </div>

          <div className="mt-4 max-h-56 space-y-2 overflow-y-auto">
            {accrualRuns.map((run) => (
              <div key={run.id} className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                <div className="text-xs font-black uppercase tracking-[0.16em] text-slate-500">{formatDate(run.run_for_date)}</div>
                <div className="mt-1 text-sm font-bold text-slate-950">
                  {formatText(run.run_status)} · Processed {run.processed_employees}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="grid gap-6 xl:grid-cols-[1.15fr_0.85fr]">
        <div className="rounded-[34px] border border-slate-200 bg-white p-6 shadow-[0_10px_30px_rgba(0,0,0,0.08)]">
          <div className="text-xs font-bold uppercase tracking-[0.35em] text-blue-600">Planner</div>
          <h3 className="mt-2 text-2xl font-bold text-slate-950">Team/Store Calendar + Conflicts</h3>

          <div className="mt-5 grid gap-3 md:grid-cols-3">
            <div className="rounded-2xl bg-slate-50 p-4">
              <div className="text-xs font-black uppercase tracking-[0.16em] text-slate-500">Public Holidays</div>
              <div className="mt-2 text-2xl font-black text-slate-900">{holidays.length}</div>
            </div>
            <div className="rounded-2xl bg-slate-50 p-4">
              <div className="text-xs font-black uppercase tracking-[0.16em] text-slate-500">Peak Periods</div>
              <div className="mt-2 text-2xl font-black text-slate-900">{peakPeriods.length}</div>
            </div>
            <div className="rounded-2xl bg-slate-50 p-4">
              <div className="text-xs font-black uppercase tracking-[0.16em] text-slate-500">Blackout Periods</div>
              <div className="mt-2 text-2xl font-black text-slate-900">{blackoutPeriods.length}</div>
            </div>
          </div>

          <div className="mt-5 space-y-2">
            {upcoming.slice(0, 18).map((item) => (
              <div key={item.id} className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="text-sm font-black text-slate-900">
                    {item.employee_name || item.employee_id} · {leaveTypeLabel(item.leave_type)}
                  </div>
                  <div className="text-xs font-semibold text-slate-500">
                    {formatDate(item.start_date)} - {formatDate(item.end_date)}
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div className="mt-5 rounded-2xl border border-rose-200 bg-rose-50 p-4">
            <div className="text-sm font-black text-rose-900">Conflict Warnings</div>
            <div className="mt-2 space-y-2">
              {overlaps.length === 0 ? (
                <div className="text-xs font-semibold text-rose-800">No overlap conflicts detected.</div>
              ) : (
                overlaps.slice(0, 12).map((conflict, index) => (
                  <div key={`${conflict.leaveRequestId}-${index}`} className="rounded-xl bg-white p-3 text-xs font-semibold text-rose-800">
                    {conflict.notes}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        <div className="space-y-6">
          <div className="rounded-[34px] border border-slate-200 bg-white p-6 shadow-[0_10px_30px_rgba(0,0,0,0.08)]">
            <div className="text-xs font-bold uppercase tracking-[0.35em] text-blue-600">Rules</div>
            <h3 className="mt-2 text-2xl font-bold text-slate-950">Leave Policy Rules</h3>

            <div className="mt-4 grid gap-3">
              <input value={newRuleName} onChange={(e) => setNewRuleName(e.target.value)} placeholder="Rule name" className="rounded-2xl border border-slate-200 px-4 py-3 text-sm font-semibold" />
              <select value={newRuleLeaveType} onChange={(e) => setNewRuleLeaveType(e.target.value)} className="rounded-2xl border border-slate-200 px-4 py-3 text-sm font-semibold">
                {leaveTypes.map((item) => (
                  <option key={item.id} value={item.leave_type_code}>{item.leave_type_name}</option>
                ))}
              </select>
              <div className="grid gap-3 md:grid-cols-3">
                <input value={newRuleMinimumNotice} onChange={(e) => setNewRuleMinimumNotice(e.target.value)} placeholder="Min notice" className="rounded-2xl border border-slate-200 px-4 py-3 text-sm font-semibold" />
                <input value={newRuleMaxConsecutive} onChange={(e) => setNewRuleMaxConsecutive(e.target.value)} placeholder="Max consecutive" className="rounded-2xl border border-slate-200 px-4 py-3 text-sm font-semibold" />
                <input value={newRuleTeamLimit} onChange={(e) => setNewRuleTeamLimit(e.target.value)} placeholder="Team limit" className="rounded-2xl border border-slate-200 px-4 py-3 text-sm font-semibold" />
              </div>
              <button onClick={createRule} className="rounded-2xl bg-slate-950 px-4 py-3 text-sm font-black text-cyan-300">Save Rule</button>
            </div>

            <div className="mt-4 max-h-44 space-y-2 overflow-y-auto">
              {rules.map((rule) => (
                <div key={rule.id} className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                  <div className="text-xs font-black uppercase tracking-[0.16em] text-slate-500">{rule.rule_name}</div>
                  <div className="mt-1 text-xs font-semibold text-slate-700">
                    Notice {rule.minimum_notice_days ?? 0}d · Max {rule.maximum_consecutive_days ?? 0}d · Team {rule.max_team_members_on_leave ?? 0}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-[34px] border border-slate-200 bg-white p-6 shadow-[0_10px_30px_rgba(0,0,0,0.08)]">
            <div className="text-xs font-bold uppercase tracking-[0.35em] text-blue-600">Calendar Controls</div>
            <h3 className="mt-2 text-2xl font-bold text-slate-950">Holidays, Peak, Blackout</h3>

            <div className="mt-4 grid gap-2">
              <input value={newHolidayName} onChange={(e) => setNewHolidayName(e.target.value)} placeholder="Holiday name" className="rounded-2xl border border-slate-200 px-4 py-3 text-sm font-semibold" />
              <div className="grid gap-2 md:grid-cols-2">
                <input type="date" value={newHolidayDate} onChange={(e) => setNewHolidayDate(e.target.value)} className="rounded-2xl border border-slate-200 px-4 py-3 text-sm font-semibold" />
                <input value={newHolidayRegion} onChange={(e) => setNewHolidayRegion(e.target.value)} placeholder="Region" className="rounded-2xl border border-slate-200 px-4 py-3 text-sm font-semibold" />
              </div>
              <button onClick={createHoliday} className="rounded-2xl bg-cyan-100 px-4 py-3 text-sm font-black text-cyan-900">Add Public Holiday</button>
            </div>

            <div className="mt-4 grid gap-2">
              <input value={newPeakName} onChange={(e) => setNewPeakName(e.target.value)} placeholder="Peak period name" className="rounded-2xl border border-slate-200 px-4 py-3 text-sm font-semibold" />
              <div className="grid gap-2 md:grid-cols-3">
                <input type="date" value={newPeakStart} onChange={(e) => setNewPeakStart(e.target.value)} className="rounded-2xl border border-slate-200 px-4 py-3 text-sm font-semibold" />
                <input type="date" value={newPeakEnd} onChange={(e) => setNewPeakEnd(e.target.value)} className="rounded-2xl border border-slate-200 px-4 py-3 text-sm font-semibold" />
                <input value={newPeakLimit} onChange={(e) => setNewPeakLimit(e.target.value)} placeholder="Headcount" className="rounded-2xl border border-slate-200 px-4 py-3 text-sm font-semibold" />
              </div>
              <button onClick={createPeakPeriod} className="rounded-2xl bg-violet-100 px-4 py-3 text-sm font-black text-violet-900">Add Peak Period</button>
            </div>

            <div className="mt-4 grid gap-2">
              <input value={newBlackoutName} onChange={(e) => setNewBlackoutName(e.target.value)} placeholder="Blackout period name" className="rounded-2xl border border-slate-200 px-4 py-3 text-sm font-semibold" />
              <div className="grid gap-2 md:grid-cols-3">
                <input type="date" value={newBlackoutStart} onChange={(e) => setNewBlackoutStart(e.target.value)} className="rounded-2xl border border-slate-200 px-4 py-3 text-sm font-semibold" />
                <input type="date" value={newBlackoutEnd} onChange={(e) => setNewBlackoutEnd(e.target.value)} className="rounded-2xl border border-slate-200 px-4 py-3 text-sm font-semibold" />
                <select value={newBlackoutType} onChange={(e) => setNewBlackoutType(e.target.value)} className="rounded-2xl border border-slate-200 px-4 py-3 text-sm font-semibold">
                  {leaveTypes.map((item) => (
                    <option key={item.id} value={item.leave_type_code}>{item.leave_type_name}</option>
                  ))}
                </select>
              </div>
              <button onClick={createBlackoutPeriod} className="rounded-2xl bg-rose-100 px-4 py-3 text-sm font-black text-rose-900">Add Blackout Period</button>
            </div>
          </div>
        </div>
      </section>

      <section className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
        <div className="rounded-[34px] border border-slate-200 bg-white p-6 shadow-[0_10px_30px_rgba(0,0,0,0.08)]">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-xs font-bold uppercase tracking-[0.35em] text-blue-600">Forecast</div>
              <h3 className="mt-2 text-2xl font-bold text-slate-950">Future Balance Forecast</h3>
            </div>
            <TrendingUp className="h-6 w-6 text-blue-700" />
          </div>

          <div className="mt-4 grid gap-3 md:grid-cols-2">
            <label className="text-xs font-black uppercase tracking-[0.16em] text-slate-500">
              Projection months
              <input value={forecastMonths} onChange={(e) => setForecastMonths(e.target.value)} className="mt-2 w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm font-semibold text-slate-900" />
            </label>
            <label className="text-xs font-black uppercase tracking-[0.16em] text-slate-500">
              Projected usage / month
              <input value={projectedLeavePerMonth} onChange={(e) => setProjectedLeavePerMonth(e.target.value)} className="mt-2 w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm font-semibold text-slate-900" />
            </label>
          </div>

          <div className="mt-5 max-h-80 space-y-2 overflow-y-auto">
            {projected.slice(0, 40).map((item) => (
              <div key={`${item.employee_id}-${item.leave_type}`} className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="text-sm font-black text-slate-900">
                    {item.employee_name} · {leaveTypeLabel(item.leave_type)}
                  </div>
                  <div className={`rounded-full px-3 py-1 text-xs font-black ${item.hasNegativeForecast ? "bg-rose-100 text-rose-700" : "bg-emerald-100 text-emerald-700"}`}>
                    {item.hasNegativeForecast ? "Negative risk" : "Healthy"}
                  </div>
                </div>
                <div className="mt-1 text-xs font-semibold text-slate-600">
                  Current {Number(item.days_due_live || 0).toFixed(2)} · Forecast {Number(item.projectedFinalBalance || 0).toFixed(2)}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-[34px] border border-slate-200 bg-white p-6 shadow-[0_10px_30px_rgba(0,0,0,0.08)]">
          <div className="text-xs font-bold uppercase tracking-[0.35em] text-blue-600">Executive Dashboard</div>
          <h3 className="mt-2 text-2xl font-bold text-slate-950">Organisation Leave Intelligence</h3>

          <div className="mt-4 grid gap-3">
            <div className="rounded-2xl bg-slate-50 p-4">
              <div className="text-xs font-black uppercase tracking-[0.16em] text-slate-500">Leave by Type</div>
              <div className="mt-2 space-y-1">
                {leaveByType.slice(0, 6).map(([type, days]) => (
                  <div key={type} className="flex items-center justify-between gap-2 text-xs font-semibold text-slate-700">
                    <span>{leaveTypeLabel(type)}</span>
                    <span>{days} day(s)</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-2xl bg-slate-50 p-4">
              <div className="text-xs font-black uppercase tracking-[0.16em] text-slate-500">Store Analysis</div>
              <div className="mt-2 space-y-1">
                {leaveByStore.slice(0, 6).map((item) => (
                  <div key={item.storeId} className="flex items-center justify-between gap-2 text-xs font-semibold text-slate-700">
                    <span>{item.storeName}</span>
                    <span>{item.leaveDays} day(s)</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-2xl bg-amber-50 p-4 text-amber-900">
              <div className="text-xs font-black uppercase tracking-[0.16em]">Upcoming Shortage Risk</div>
              <div className="mt-2 text-sm font-semibold">
                {overlaps.length > 0
                  ? `${overlaps.length} overlap warning(s) detected in upcoming leave windows.`
                  : "No immediate overlap-driven shortage warnings detected."}
              </div>
            </div>

            <div className="rounded-2xl bg-rose-50 p-4 text-rose-900">
              <div className="text-xs font-black uppercase tracking-[0.16em]">High-Risk Departments</div>
              <div className="mt-2 text-sm font-semibold">
                Department-level data is not populated in current employee schema. Store analysis is active and shown above.
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="rounded-[34px] border border-slate-200 bg-white p-6 shadow-[0_10px_30px_rgba(0,0,0,0.08)]">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-xs font-bold uppercase tracking-[0.35em] text-blue-600">Leave Documents</div>
            <h3 className="mt-2 text-2xl font-bold text-slate-950">Medical Certificates & Supporting Documents</h3>
          </div>
          <CalendarDays className="h-6 w-6 text-blue-700" />
        </div>

        <div className="mt-5 space-y-2">
          {documents.length === 0 ? (
            <div className="rounded-2xl bg-slate-50 p-5 text-sm font-semibold text-slate-500">
              No leave documents captured yet.
            </div>
          ) : (
            documents.slice(0, 80).map((document) => (
              <div key={document.id} className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="text-sm font-black text-slate-900">{document.document_title || "Leave document"}</div>
                    <div className="mt-1 text-xs font-semibold text-slate-500">
                      {document.employee_name || document.employee_id || "No employee"} · {formatText(document.document_type)} · {formatDateTime(document.created_at)}
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    {document.file_url && (
                      <a href={document.file_url} target="_blank" rel="noreferrer" className="rounded-xl bg-cyan-100 px-3 py-2 text-xs font-black text-cyan-900">
                        Preview / Download
                      </a>
                    )}
                    {(document.archive_status || "active") !== "archived" && (
                      <button onClick={() => archiveDocument(document.id)} className="rounded-xl bg-rose-100 px-3 py-2 text-xs font-black text-rose-900">
                        Archive
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </section>

      <section className="rounded-[34px] border border-slate-200 bg-white p-6 shadow-[0_10px_30px_rgba(0,0,0,0.08)]">
        <div className="text-xs font-bold uppercase tracking-[0.35em] text-blue-600">Coverage Snapshot</div>
        <h3 className="mt-2 text-2xl font-bold text-slate-950">Manager Dashboard Warnings</h3>

        <div className="mt-4 grid gap-4 md:grid-cols-3">
          <div className="rounded-2xl bg-amber-50 p-4 text-amber-900">
            <div className="text-xs font-black uppercase tracking-[0.16em]">Pending Approvals</div>
            <div className="mt-2 text-3xl font-black">{managerPending.length + hrPending.length}</div>
          </div>

          <div className="rounded-2xl bg-cyan-50 p-4 text-cyan-900">
            <div className="text-xs font-black uppercase tracking-[0.16em]">Upcoming Leave</div>
            <div className="mt-2 text-3xl font-black">{upcoming.length}</div>
          </div>

          <div className="rounded-2xl bg-rose-50 p-4 text-rose-900">
            <div className="text-xs font-black uppercase tracking-[0.16em]">Coverage Warnings</div>
            <div className="mt-2 text-3xl font-black">{overlaps.length}</div>
          </div>
        </div>

        <div className="mt-5 grid gap-3">
          {overlaps.slice(0, 8).map((item, idx) => (
            <div key={`${item.leaveRequestId}-${idx}`} className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs font-semibold text-rose-800">
              {item.notes}
            </div>
          ))}
          {overlaps.length === 0 && (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-xs font-semibold text-emerald-800">
              No overlap coverage warnings in current queue.
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

"use client";

function GlobalWarningBanner({ exceptions, hrCases, payrollHours }: any) {
  const hasIssues =
    exceptions.some((e:any) => e.status !== "closed" && e.status !== "approved") ||
    hrCases.some((c:any) => c.status !== "closed") ||
    payrollHours.some((p:any) => p.status === "needs_review");

  if (!hasIssues) return null;

  return (
    <div className="w-full border-b border-rose-300/30 bg-gradient-to-r from-rose-700 via-rose-600 to-orange-500 p-4 text-center text-sm font-black text-white shadow-[0_18px_60px_rgba(225,29,72,0.28)]">
      ⚠️ ACTION REQUIRED: Unresolved issues detected
    </div>
  );
}


// VYRON CORE FINAL PREMIUM POLISH BUILD
// Full app preserved. Payroll stability, duplicate-safe calculations, exception safety, dashboard polish, and safer UI states.

import React, { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Bell,
  CalendarDays,
  CheckCircle2,
  Clock3,
  Gavel,
  Menu,
  Plus,
  ShieldCheck,
  Store,
  Users,
  WalletCards,
  X,
  Zap,
  FileText,
  Camera,
  MapPin,
  Image as ImageIcon
} from "lucide-react";
import { supabase } from "../lib/supabase";
import ManagerActionCentrePanel from "../components/ManagerActionCentrePanel";
import EmployeeNotificationsPanel from "../components/EmployeeNotificationsPanel";
import LeaveBalancePanel from "../components/LeaveBalancePanel";
import HistoryReportsPanel from "../components/HistoryReportsPanel";
import LeaveDecisionAuditPanel from "../components/LeaveDecisionAuditPanel";
import SmartDetectionEnginePanel from "../components/SmartDetectionEnginePanel";
import ExceptionsActionPanel from "../components/ExceptionsActionPanel";
import HRCasesActionPanel from "../components/HRCasesActionPanel";
import HRWarningsDocumentPanel from "../components/HRWarningsDocumentPanel";
import ClockReviewPanel from "../components/ClockReviewPanel";
import WorkforceMovementPanel from "../components/WorkforceMovementPanel";
import RosterIntelligencePanel from "../components/RosterIntelligencePanel";
import ContractCentrePanel from "../components/ContractCentrePanel";
import EmployeeDocumentVaultPanel from "../components/EmployeeDocumentVaultPanel";
import LeaveControlCentrePanel from "../components/LeaveControlCentrePanel";

const DEMO_COMPANY_ID = "11111111-1111-1111-1111-111111111111";

type StoreRow = {
  id: string;
  name: string;
  city: string | null;
  region: string | null;
  status: string;
  address: string | null;
  opening_time: string | null;
  closing_time: string | null;
  gps_radius_meters: number | null;
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
  pin_code?: string | null;
  kiosk_access_enabled?: boolean | null;
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

type HrNoteRow = {
  id: string;
  employee_id: string;
  employee_name: string;
  note_type: string;
  note_title: string;
  note_body: string;
  visibility: string;
  status: string;
  created_by: string | null;
  created_at: string;
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

type RosterShiftRow = {
  id: string;
  shift_date: string;
  planned_start: string;
  planned_end: string;
  role: string | null;
  status: string;
  employee_id: string;
  store_id: string;
};

type ClockEventRow = {
  id: string;
  employee_id: string;
  store_id: string | null;
  roster_shift_id: string | null;
  event_type: string;
  event_time: string;
  source: string;
  latitude: number | null;
  longitude: number | null;
  gps_accuracy?: number | null;
  photo_url?: string | null;
  photo_bucket?: string | null;
  photo_path?: string | null;
  device_info?: string | null;
  clock_note?: string | null;
};

type PayrollBatchRow = {
  id: string;
  batch_name: string;
  period_start: string;
  period_end: string;
  payroll_system: string;
  status: string;
  exported_at: string | null;
};

type PayrollHoursRow = {
  id: string;
  company_id: string;
  employee_id: string;
  period_start: string;
  period_end: string;
  normal_hours: number;
  overtime_hours: number;
  late_minutes: number;
  missing_clock_events: number;
  status: string;
  approved_at: string | null;
  approval_note: string | null;
  exported_at: string | null;
  export_batch_id: string | null;
  created_at: string;
};

type PayrollClockCheckRow = {
  id: string;
  company_id: string | null;
  employee_id: string;
  employee_number: string | null;
  employee_name: string;
  store_id: string | null;
  store_name: string | null;
  roster_shift_id: string | null;
  shift_date: string;
  planned_start: string | null;
  planned_end: string | null;
  actual_clock_in: string | null;
  actual_clock_out: string | null;
  missing_clock_in: boolean;
  missing_clock_out: boolean;
  late_minutes: number;
  early_leave_minutes: number;
  overtime_minutes: number;
  normal_minutes: number;
  payable_minutes: number;
  payroll_status: string;
  exception_required: boolean;
  exception_reason: string | null;
  manager_review_status: string;
  manager_note: string | null;
  generated_from: string;
  generated_at: string;
  created_at: string;
  updated_at: string;
};

type UserRoleRow = {
  id: string;
  company_id: string;
  user_email: string;
  role: string;
  created_at: string;
};

type CompanyUserRow = {
  id?: string;
  company_id: string;
  user_email: string;
  role: string;
  status: string;
};

const navItems = [
  "Command Centre",
  "Super Dashboard",
  "Stores",
  "Employees",
  "Roster Builder",
  "Clocking Live",
  "Staff Clocking",
  "Exceptions",
  "HR Cases",
  "Payroll Prep",
  "Final V1 Control",
  "Live Activity",
  "Executive Reports",
  "Launch Checklist",
  "Client Onboarding",
  "Compliance",
  "Settings / Roles",
];

function formatText(value: string) {
  return value.replaceAll("_", " ");
}

function userInitials(email: string | null | undefined) {
  if (!email) return "AD";
  const name = email.split("@")[0] || "AD";
  return name.slice(0, 2).toUpperCase();
}


function NavIcon({ item }: { item: string }) {
  if (item.includes("Action Centre")) return <Bell className="h-5 w-5" />;
  if (item.includes("Smart Detection")) return <Zap className="h-5 w-5" />;
  if (item.includes("Stores & Rosters")) return <Store className="h-5 w-5" />;
  if (item.includes("Store")) return <Store className="h-5 w-5" />;
  if (item.includes("Employee")) return <Users className="h-5 w-5" />;
  if (item.includes("Roster")) return <Clock3 className="h-5 w-5" />;
  if (item.includes("Clock")) return <Clock3 className="h-5 w-5" />;
  if (item.includes("Exception")) return <AlertTriangle className="h-5 w-5" />;
  if (item.includes("Balance")) return <CalendarDays className="h-5 w-5" />;
  if (item.includes("Leave")) return <Clock3 className="h-5 w-5" />;
  if (item.includes("Notification")) return <Bell className="h-5 w-5" />;
  if (item.includes("HR")) return <Gavel className="h-5 w-5" />;
  if (item.includes("Payroll")) return <WalletCards className="h-5 w-5" />;
  if (item.includes("Compliance")) return <ShieldCheck className="h-5 w-5" />;
  if (item.includes("Decision Audit")) return <ShieldCheck className="h-5 w-5" />;
  if (item.includes("History")) return <Clock3 className="h-5 w-5" />;
  if (item.includes("Reports Centre")) return <FileText className="h-5 w-5" />;
  if (item.includes("Report")) return <Zap className="h-5 w-5" />;
  if (item.includes("Launch")) return <CheckCircle2 className="h-5 w-5" />;
  if (item.includes("Settings")) return <ShieldCheck className="h-5 w-5" />;
  return <Zap className="h-5 w-5" />;
}


function formatTimeOnly(value: string | null) {
  if (!value) return "Not set";
  return value.slice(0, 5);
}

function formatTime(value: string) {
  try {
    return new Date(value).toLocaleTimeString("en-ZA", {
      hour: "2-digit",
      minute: "2-digit"
});
  } catch {
    return "--:--";
  }
}

function formatDate(value: string) {
  try {
    return new Date(value).toLocaleDateString("en-ZA", {
      weekday: "short",
      day: "2-digit",
      month: "short"
});
  } catch {
    return value;
  }
}

function toShiftDateTime(date: string, time: string) {
  return `${date}T${time}:00+02:00`;
}

function safeNumber(value: number | null | undefined) {
  if (value === null || value === undefined) return 0;
  return Number(value) || 0;
}

function isClockIn(value: string) {
  return value === "clock_in" || value === "in";
}

function isClockOut(value: string) {
  return value === "clock_out" || value === "out";
}

function dayKeyFromIso(value: string) {
  try {
    return new Date(value).toISOString().slice(0, 10);
  } catch {
    return value.slice(0, 10);
  }
}

function gpsDistanceMeters(lat1: number, lon1: number, lat2: number, lon2: number) {
  const earthRadius = 6371000;
  const toRad = (value: number) => (value * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return earthRadius * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function currentDateLabel() {
  return new Date().toLocaleDateString("en-ZA", {
    weekday: "long",
    day: "2-digit",
    month: "long",
    year: "numeric"
});
}

function percentSafe(numerator: number, denominator: number) {
  if (!denominator || denominator <= 0) return 0;
  return Math.round((numerator / denominator) * 100);
}

function riskWord(count: number) {
  if (count === 0) return "Clean";
  if (count <= 3) return "Watch";
  return "High Risk";
}


function readinessLabel(problemCount: number, cleanCount: number) {
  if (problemCount > 0) return "Blocked";
  if (cleanCount > 0) return "Ready";
  return "No data";
}

function statusToClientText(value: string) {
  if (value === "needs_review" || value === "blocked") return "Needs Review";
  if (value === "review_required") return "Review Required";
  return formatText(value);
}

function formatHours(value: number | null | undefined) {
  return safeNumber(value).toFixed(2);
}

function csvEscape(value: string | number | null | undefined) {
  return `"${String(value ?? "").replaceAll('"', '""')}"`;
}


function todayIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

function niceDateTime(value: string | null | undefined) {
  if (!value) return "Not set";
  try {
    return new Date(value).toLocaleString("en-ZA", {
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit"
});
  } catch {
    return value;
  }
}

function rowHasPayrollProblem(item: PayrollHoursRow) {
  return (
    safeNumber(item.missing_clock_events) > 0 ||
    safeNumber(item.late_minutes) > 0 ||
    safeNumber(item.overtime_hours) > 0 ||
    item.status === "needs_review"
  );
}

function exceptionIsOpen(item: ExceptionRow) {
  return item.status !== "closed" && item.status !== "approved";
}

function hrCaseIsOpen(item: HrCaseRow) {
  return item.status !== "closed";
}

function buildCsv(rows: Array<Array<string | number | null | undefined>>) {
  return rows
    .map((row) => row.map((cell) => `"${String(cell ?? "").replaceAll('"', '""')}"`).join(","))
    .join("\n");
}

function downloadTextFile(filename: string, content: string, mimeType = "text/plain;charset=utf-8") {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}


function LogoMark() {
  return (
    <div className="flex items-center gap-4">
      <div className="relative h-12 w-12 rounded-2xl bg-gradient-to-br from-blue-700 via-blue-500 to-cyan-300 shadow-[0_0_34px_rgba(34,211,238,0.34)] ring-1 ring-cyan-200/30">
        <div className="absolute left-[13px] top-[10px] h-8 w-3 rotate-[-28deg] rounded-sm bg-white" />
        <div className="absolute right-[13px] top-[10px] h-8 w-3 rotate-[28deg] rounded-sm bg-slate-950/80" />
      </div>
      <div>
        <div className="text-2xl font-black tracking-[0.34em] text-white">VYRON</div>
        <div className="mt-[-2px] text-xs font-semibold tracking-[0.55em] text-cyan-300">CORE</div>
      </div>
    </div>
  );
}

function Panel({ children, dark = false }: { children: React.ReactNode; dark?: boolean }) {
  return (
    <section
      className={
        dark
          ? "relative overflow-hidden rounded-[34px] border border-cyan-300/15 bg-gradient-to-br from-[#050914] via-[#07101f] to-[#0b1a33] p-6 text-white shadow-[0_28px_90px_rgba(2,6,23,0.36),0_0_46px_rgba(34,211,238,0.16)] before:pointer-events-none before:absolute before:-right-20 before:-top-24 before:h-64 before:w-64 before:rounded-full before:bg-cyan-300/12 before:blur-[70px]"
          : "rounded-[2rem] border border-white/75 bg-white/90 p-6 shadow-[0_22px_70px_rgba(15,23,42,0.14)] backdrop-blur-2xl transition duration-200 hover:-translate-y-0.5 hover:border-cyan-200/80 hover:shadow-[0_28px_86px_rgba(15,23,42,0.18),0_0_36px_rgba(34,211,238,0.12)]"
      }
    >
      {children}
    </section>
  );
}

function StatusPill({ value }: { value: string }) {
  const cls =
    value === "completed" ||
    value === "ready" ||
    value === "exported" ||
    value === "approved" ||
    value === "active" ||
    value === "closed"
      ? "bg-emerald-100 text-emerald-700"
      : value === "open" || value === "exceptions_open"
      ? "bg-rose-100 text-rose-700"
      : value === "needs_review" || value === "blocked"
      ? "bg-amber-100 text-amber-700"
      : value === "scheduled" || value === "changed"
      ? "bg-blue-100 text-cyan-700"
      : "bg-slate-200 text-slate-700";

  return <span className={`rounded-full px-3 py-1 text-xs font-bold capitalize ${cls}`}>{statusToClientText(value)}</span>;
}

function Severity({ value }: { value: string }) {
  const cls =
    value === "high" || value === "critical"
      ? "bg-rose-100 text-rose-700"
      : value === "medium"
      ? "bg-amber-100 text-amber-700"
      : "bg-blue-100 text-cyan-700";

  return <span className={`rounded-full px-3 py-1 text-xs font-bold capitalize ${cls}`}>{value}</span>;
}

function ValidityPill({ value }: { value: string }) {
  const cls =
    value === "valid"
      ? "bg-emerald-100 text-emerald-700"
      : value === "risky" || value === "review_required"
      ? "bg-amber-100 text-amber-700"
      : value === "invalid"
      ? "bg-rose-100 text-rose-700"
      : "bg-slate-200 text-slate-700";

  return <span className={`rounded-full px-3 py-1 text-xs font-bold capitalize ${cls}`}>{statusToClientText(value)}</span>;
}

function EventPill({ value }: { value: string }) {
  return <span className="rounded-full bg-slate-200 px-3 py-1 text-xs font-bold">{statusToClientText(value)}</span>;
}

function StatCard({
  title,
  value,
  subtitle,
  icon
}: {
  title: string;
  value: string;
  subtitle: string;
  icon: React.ReactNode;
}) {
  return (
    <div className="rounded-[2rem] border border-white/75 bg-white/90 p-6 shadow-[0_22px_70px_rgba(15,23,42,0.14)] backdrop-blur-2xl transition duration-200 hover:-translate-y-1 hover:border-cyan-200/80 hover:shadow-[0_30px_90px_rgba(37,99,235,0.20),0_0_38px_rgba(34,211,238,0.16)]">
      <div className="flex items-start justify-between">
        <div className="rounded-2xl bg-[#06101f] p-3 text-cyan-300 shadow-lg shadow-cyan-950/15">{icon}</div>
        <span className="rounded-full bg-slate-100 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.25em] text-slate-500">
          Live
        </span>
      </div>
      <div className="mt-7 text-4xl font-bold tracking-tight text-slate-950">{value}</div>
      <div className="mt-2 text-sm font-semibold text-slate-700">{title}</div>
      <div className="mt-3 text-xs text-slate-500">{subtitle}</div>
    </div>
  );
}

function InfoBox({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-white/75 bg-white/88 p-4 shadow-[0_12px_34px_rgba(15,23,42,0.09)] backdrop-blur-xl">
      <div className="text-xs font-bold uppercase tracking-[0.2em] text-slate-400">{label}</div>
      <div className="mt-2 font-bold">{value}</div>
    </div>
  );
}

function ModalHeader({ title, subtitle, onClose }: { title: string; subtitle: string; onClose: () => void }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div>
        <div className="text-xs font-bold uppercase tracking-[0.35em] text-cyan-700">VYRON CORE</div>
        <h2 className="mt-2 text-3xl font-bold text-slate-950">{title}</h2>
        <p className="mt-2 text-sm text-slate-500">{subtitle}</p>
      </div>
      <button onClick={onClose} className="rounded-2xl border border-slate-200/70 bg-white/90 p-3 shadow-[0_10px_24px_rgba(15,23,42,0.08)] transition hover:-translate-y-0.5 hover:border-cyan-200">
        <X className="h-5 w-5" />
      </button>
    </div>
  );
}

function FormInput({
  label,
  value,
  onChange,
  placeholder,
  type = "text"
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  type?: string;
}) {
  return (
    <label className="text-sm font-bold">
      {label}
      <input
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="mt-2 w-full rounded-2xl border border-slate-200/80 bg-white/90 px-4 py-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.7),0_10px_28px_rgba(15,23,42,0.06)] backdrop-blur-xl outline-none transition focus:border-cyan-400 focus:shadow-[0_0_0_4px_rgba(34,211,238,0.14)]"
        placeholder={placeholder}
      />
    </label>
  );
}

function ModalActions({
  onCancel,
  onSave,
  saving,
  saveText
}: {
  onCancel: () => void;
  onSave: () => void;
  saving: boolean;
  saveText: string;
}) {
  return (
    <div className="mt-6 flex flex-col gap-3 md:flex-row md:justify-end">
      <button onClick={onCancel} className="rounded-2xl border border-slate-200/70 bg-white/90 px-5 py-3 text-sm font-bold text-slate-700 shadow-[0_10px_26px_rgba(15,23,42,0.08)] transition hover:-translate-y-0.5 hover:border-cyan-200">
        Cancel
      </button>
      <button
        onClick={onSave}
        disabled={saving}
        className="rounded-2xl border border-cyan-300/20 bg-[#06101f] px-5 py-3 text-sm font-black text-cyan-300 shadow-[0_18px_45px_rgba(8,47,73,0.28),0_0_26px_rgba(34,211,238,0.18)] transition hover:-translate-y-0.5 hover:text-white disabled:opacity-60"
      >
        {saving ? "Saving..." : saveText}
      </button>
    </div>
  );
}
const navGroups = [
  {
    label: "Command",
    items: [
      "Command Centre",
      "Manager Action Centre",
      "Smart Detection",
      "Live Activity",
    ]
},
  {
    label: "People",
    items: [
      "Employees",
      "Employee HR File",
      "Employee Notifications",
    ]
},
  {
    label: "Time & Shifts",
    items: [
      "Clocking",
      "Clocking Review",
      "Workforce Movement",
      "Roster Intelligence",
      "Payroll Clock Engine",
      "Exceptions",
      "Stores & Rosters",
      "Leave Management",
      "Leave Control Centre",
    ]
},
  {
    label: "HR & Compliance",
    items: [
      "HR Cases",
      "HR Warnings",
      "HR Documents",
      "HR Contract Centre",
      "Employee Document Vault",
      "Compliance",
    ]
},
  {
    label: "Reports",
    items: [
      "Reports Centre",
    ]
},
];

function Sidebar({
  active,
  setActive,
  closeMobile,
  alertCounts = {},
  openGroup,
  setOpenGroup
}: {
  active: string;
  setActive: (value: string) => void;
  closeMobile?: () => void;
  alertCounts?: Record<string, number>;
  openGroup: string;
  setOpenGroup: (value: string) => void;
}) {
  function openItem(item: string) {
    setActive(item);
    if (closeMobile) closeMobile();
  }

  return (
    <aside className="flex h-full flex-col border-r border-cyan-300/10 bg-[radial-gradient(circle_at_20%_0%,rgba(34,211,238,0.18),transparent_30%),linear-gradient(180deg,#050914_0%,#07101f_46%,#020617_100%)] text-white shadow-[28px_0_90px_rgba(2,6,23,0.42)]">
      <div className="border-b border-white/10 bg-white/[0.035] px-5 py-6 shadow-[inset_0_-1px_0_rgba(255,255,255,0.04)]">
        <div className="flex items-center gap-3">
          <div className="relative h-12 w-12 rounded-2xl bg-gradient-to-br from-blue-700 via-blue-500 to-cyan-300 shadow-[0_0_34px_rgba(34,211,238,0.34)] ring-1 ring-cyan-200/30">
            <div className="absolute left-[13px] top-[10px] h-8 w-3 rotate-[-28deg] rounded-sm bg-white" />
            <div className="absolute right-[13px] top-[10px] h-8 w-3 rotate-[28deg] rounded-sm bg-slate-950/80" />
          </div>
          <div>
            <div className="text-2xl font-black tracking-[0.32em]">VYRON</div>
            <div className="mt-[-2px] text-xs font-bold tracking-[0.55em] text-cyan-300">
              CORE
            </div>
          </div>
        </div>
      </div>

      <nav className="flex-1 space-y-3 overflow-y-auto px-4 py-5">
        {navGroups.map((group) => {
          const isOpen = openGroup === group.label;
          const groupAlertCount = group.items.reduce(
            (sum, item) => sum + (alertCounts[item] || 0),
            0
          );

          return (
            <div key={group.label} className="rounded-[24px] border border-white/10 bg-white/[0.055] shadow-[inset_0_1px_0_rgba(255,255,255,0.07),0_14px_34px_rgba(2,6,23,0.16)] backdrop-blur-xl">
              <button
                onClick={() => setOpenGroup(isOpen ? "" : group.label)}
                className={`flex w-full items-center justify-between rounded-2xl px-4 py-4 text-left text-xs font-black uppercase tracking-[0.24em] transition ${
                  isOpen ? "text-cyan-300" : "text-slate-400 hover:text-white"
                }`}
              >
                <span>{group.label}</span>
                <span className="flex items-center gap-2">
                  {groupAlertCount > 0 && (
                    <span className="rounded-full bg-rose-500 px-2 py-1 text-[10px] font-black leading-none text-white">
                      {groupAlertCount > 99 ? "99+" : groupAlertCount}
                    </span>
                  )}
                  <span className="text-base">{isOpen ? "−" : "+"}</span>
                </span>
              </button>

              {isOpen && (
                <div className="space-y-1 px-2 pb-3">
                  {group.items.map((item) => (
                    <button
                      key={item}
                      onClick={() => openItem(item)}
                      className={`flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left text-sm font-bold transition ${
                        active === item
                          ? "bg-gradient-to-r from-blue-700 via-blue-600 to-cyan-500 text-white shadow-[0_14px_34px_rgba(34,211,238,0.26)] ring-1 ring-cyan-200/20"
                          : "text-slate-300 hover:bg-white/10 hover:text-white hover:shadow-[0_0_30px_rgba(34,211,238,0.16)]"
                      }`}
                    >
                      <span className={active === item ? "text-white" : "text-slate-400"}>
                        <NavIcon item={item} />
                      </span>

                      <span className="flex-1">{item}</span>

                      {alertCounts[item] > 0 && (
                        <span
                          className={`ml-auto rounded-full px-2.5 py-1 text-[11px] font-black leading-none ${
                            active === item
                              ? "bg-white text-cyan-700"
                              : "bg-rose-500 text-white shadow-lg shadow-rose-500/30"
                          }`}
                        >
                          {alertCounts[item] > 99 ? "99+" : alertCounts[item]}
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </nav>
    </aside>
  );
}


function Header({
  active,
  openMobileNav,
  loading,
  error
}: {
  active: string;
  openMobileNav: () => void;
  loading: boolean;
  error: string | null;
}) {
  return (
    <header className="relative overflow-hidden rounded-[34px] border border-cyan-300/15 bg-[radial-gradient(circle_at_82%_-10%,rgba(34,211,238,0.24),transparent_34%),linear-gradient(135deg,#050914_0%,#07101f_48%,#0b1a33_100%)] p-6 text-white shadow-[0_28px_90px_rgba(2,6,23,0.35),0_0_46px_rgba(34,211,238,0.14)] md:p-7">
      <div className="flex flex-col gap-6 xl:flex-row xl:items-center xl:justify-between">
        <div>
          <div className="flex items-center gap-3">
            <button onClick={openMobileNav} className="rounded-2xl bg-white/10 p-3 text-white lg:hidden">
              <Menu className="h-5 w-5" />
            </button>
            <div className="text-xs font-bold uppercase tracking-[0.4em] text-cyan-300">VYRON CORE</div>
          </div>

          <h1 className="mt-4 text-3xl font-bold tracking-tight md:text-5xl">{active}</h1>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-300">
            Workforce control, clocking, HR risk, roster movement and payroll readiness in one controlled system.
          </p>

          <div className="mt-4 text-xs font-semibold">
            {loading && <span className="text-cyan-300">Connecting to Supabase...</span>}
            {!loading && !error && <span className="text-emerald-300">Live Supabase connection active</span>}
            {error && <span className="text-rose-300">Supabase issue: {error}</span>}
          </div>
        </div>

        <button className="w-fit rounded-2xl bg-white px-5 py-3 text-sm font-bold text-slate-950 shadow-xl">
          Export Payroll Pack
        </button>
      </div>
    </header>
  );
}


function LoginScreen({ onAuthenticated }: { onAuthenticated: (email: string) => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleAuth() {
    setLoading(true);
    setMessage(null);
    setError(null);

    if (!email.trim() || !password.trim()) {
      setError("Email and password are required.");
      setLoading(false);
      return;
    }

    if (password.length < 6) {
      setError("Password must be at least 6 characters.");
      setLoading(false);
      return;
    }

    if (mode === "login") {
      const { data, error: signInError } = await supabase.auth.signInWithPassword({
        email: email.trim().toLowerCase(),
        password
});

      if (signInError) {
        setError(signInError.message);
        setLoading(false);
        return;
      }

      const userEmail = data.user?.email || email.trim().toLowerCase();
      onAuthenticated(userEmail);
      setLoading(false);
      return;
    }

    const { data, error: signUpError } = await supabase.auth.signUp({
      email: email.trim().toLowerCase(),
      password
});

    if (signUpError) {
      setError(signUpError.message);
      setLoading(false);
      return;
    }

    if (data.user?.email) {
      onAuthenticated(data.user.email);
      setMessage("Account created. If Supabase email confirmation is enabled, confirm the email before logging in.");
    } else {
      setMessage("Account created. Check your email if confirmation is enabled.");
    }

    setLoading(false);
  }

  return (
    <main className="flex min-h-screen items-center justify-center overflow-hidden bg-[radial-gradient(circle_at_20%_10%,rgba(34,211,238,0.24),transparent_32%),linear-gradient(135deg,#050914_0%,#07101f_34%,#eef7ff_34%,#f8fbff_100%)] p-4 text-slate-950">
      <div className="w-full max-w-5xl overflow-hidden rounded-[34px] bg-white shadow-[0_30px_90px_rgba(15,23,42,0.18)]">
        <div className="grid lg:grid-cols-[0.9fr_1.1fr]">
          <section className="bg-gradient-to-br from-[#050d1a] to-[#071a33] p-8 text-white md:p-10">
            <LogoMark />
            <div className="mt-16 text-xs font-bold uppercase tracking-[0.4em] text-cyan-300">Secure Access</div>
            <h1 className="mt-4 text-4xl font-black tracking-tight md:text-5xl">Sign in to VYRON CORE</h1>
            <p className="mt-5 max-w-md text-sm leading-7 text-slate-300">
              Workforce control, clocking, HR risk, roster movement and payroll readiness in one controlled system.
            </p>

            <div className="mt-10 grid gap-3 text-sm text-slate-300">
              <div className="rounded-2xl bg-white/10 p-4">Role-based access for Admin, Manager and Staff users.</div>
              <div className="rounded-2xl bg-white/10 p-4">Company users are matched by logged-in email address.</div>
              <div className="rounded-2xl bg-white/10 p-4">Payroll and HR actions stay protected behind login.</div>
            </div>
          </section>

          <section className="p-8 md:p-10">
            <div className="text-xs font-bold uppercase tracking-[0.3em] text-cyan-700">VYRON CORE</div>
            <h2 className="mt-3 text-3xl font-bold tracking-tight">{mode === "login" ? "Login" : "Create account"}</h2>
            <p className="mt-2 text-sm leading-6 text-slate-500">
              Use the email that was added under Settings / Roles → Company Users.
            </p>

            <div className="mt-8 space-y-4">
              <FormInput label="Email address" value={email} onChange={setEmail} placeholder="admin@company.co.za" type="email" />
              <FormInput label="Password" value={password} onChange={setPassword} placeholder="Minimum 6 characters" type="password" />
            </div>

            {error && <div className="mt-5 rounded-2xl bg-rose-50 p-4 text-sm font-semibold text-rose-700">{error}</div>}
            {message && <div className="mt-5 rounded-2xl bg-emerald-50 p-4 text-sm font-semibold text-emerald-700">{message}</div>}

            <button
              onClick={handleAuth}
              disabled={loading}
              className="mt-6 w-full rounded-2xl bg-[#06101f] px-5 py-4 text-sm font-black text-cyan-300 shadow-lg shadow-cyan-950/15 disabled:opacity-60"
            >
              {loading ? "Please wait..." : mode === "login" ? "Login" : "Create Account"}
            </button>

            <button
              onClick={() => {
                setMode(mode === "login" ? "signup" : "login");
                setError(null);
                setMessage(null);
              }}
              className="mt-4 w-full rounded-2xl bg-slate-100 px-5 py-4 text-sm font-bold text-slate-700"
            >
              {mode === "login" ? "Need an account? Create one" : "Already have an account? Login"}
            </button>
          </section>
        </div>
      </div>
    </main>
  );
}

function AddStoreModal({
  open,
  onClose,
  onSaved,
  companyId
}: {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  companyId: string;
}) {
  const [name, setName] = useState("");
  const [region, setRegion] = useState("Western Cape");
  const [city, setCity] = useState("Cape Town");
  const [address, setAddress] = useState("");
  const [openingTime, setOpeningTime] = useState("07:00");
  const [closingTime, setClosingTime] = useState("20:00");
  const [gpsRadius, setGpsRadius] = useState("150");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

  async function saveStore() {
    setSaving(true);
    setError(null);

    if (!name.trim()) {
      setError("Store name is required.");
      setSaving(false);
      return;
    }

    const { error: insertError } = await supabase.from("stores").insert({
      company_id: companyId,
      name: name.trim(),
      region: region.trim() || null,
      city: city.trim() || null,
      address: address.trim() || null,
      opening_time: openingTime || null,
      closing_time: closingTime || null,
      gps_radius_meters: Number(gpsRadius) || 150,
      status: "active"
});

    if (insertError) {
      setError(insertError.message);
      setSaving(false);
      return;
    }

    setName("");
    setRegion("Western Cape");
    setCity("Cape Town");
    setAddress("");
    setOpeningTime("07:00");
    setClosingTime("20:00");
    setGpsRadius("150");
    setSaving(false);
    onSaved();
    onClose();
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-2xl rounded-[34px] bg-white p-6 shadow-2xl">
        <ModalHeader title="Add Store" subtitle="Add a counter/store with opening times and GPS clocking rules." onClose={onClose} />

        <div className="mt-6 grid gap-4 md:grid-cols-2">
          <FormInput label="Store name" value={name} onChange={setName} placeholder="Woolworths Sea Point" />
          <FormInput label="City" value={city} onChange={setCity} placeholder="Cape Town" />
          <FormInput label="Region" value={region} onChange={setRegion} placeholder="Western Cape" />
          <FormInput label="GPS radius meters" value={gpsRadius} onChange={setGpsRadius} placeholder="150" />
          <FormInput label="Opening time" value={openingTime} onChange={setOpeningTime} type="time" />
          <FormInput label="Closing time" value={closingTime} onChange={setClosingTime} type="time" />
        </div>

        <label className="mt-4 block text-sm font-bold">
          Address
          <textarea
            value={address}
            onChange={(event) => setAddress(event.target.value)}
            className="mt-2 min-h-24 w-full rounded-2xl border border-white/80 bg-white/80 shadow-sm backdrop-blur-xl px-4 py-3 outline-none focus:border-cyan-400"
            placeholder="Store address for GPS validation"
          />
        </label>

        {error && <div className="mt-4 rounded-2xl bg-rose-50 p-4 text-sm font-semibold text-rose-700">{error}</div>}

        <ModalActions onCancel={onClose} onSave={saveStore} saving={saving} saveText="Save Store" />
      </div>
    </div>
  );
}
function AddEmployeeModal({
  open,
  onClose,
  onSaved,
  stores,
  companyId
}: {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  stores: StoreRow[];
  companyId: string;
}) {
  const [employeeNumber, setEmployeeNumber] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [jobTitle, setJobTitle] = useState("Counter Assistant");
  const [defaultStoreId, setDefaultStoreId] = useState("");
  const [employmentType, setEmploymentType] = useState("permanent");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

  async function saveEmployee() {
    setSaving(true);
    setError(null);

    if (!firstName.trim() || !lastName.trim()) {
      setError("First name and last name are required.");
      setSaving(false);
      return;
    }

    const { error: insertError } = await supabase.from("employees").insert({
      company_id: companyId,
      employee_number: employeeNumber.trim() || null,
      first_name: firstName.trim(),
      last_name: lastName.trim(),
      job_title: jobTitle.trim() || null,
      default_store_id: defaultStoreId || null,
      employment_type: employmentType || "permanent",
      phone: phone.trim() || null,
      email: email.trim() || null,
      active: true
});

    if (insertError) {
      setError(insertError.message);
      setSaving(false);
      return;
    }

    setEmployeeNumber("");
    setFirstName("");
    setLastName("");
    setJobTitle("Counter Assistant");
    setDefaultStoreId("");
    setEmploymentType("permanent");
    setPhone("");
    setEmail("");
    setSaving(false);
    onSaved();
    onClose();
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-2xl rounded-[34px] bg-white p-6 shadow-2xl">
        <ModalHeader title="Add Employee" subtitle="Add staff that can be rostered, clocked and linked to HR cases." onClose={onClose} />

        <div className="mt-6 grid gap-4 md:grid-cols-2">
          <FormInput label="Employee number" value={employeeNumber} onChange={setEmployeeNumber} placeholder="EMP005" />
          <FormInput label="Job title" value={jobTitle} onChange={setJobTitle} placeholder="Sushi Chef" />
          <FormInput label="First name" value={firstName} onChange={setFirstName} placeholder="Jason" />
          <FormInput label="Last name" value={lastName} onChange={setLastName} placeholder="Peters" />
          <FormInput label="Phone" value={phone} onChange={setPhone} placeholder="082..." />
          <FormInput label="Email" value={email} onChange={setEmail} placeholder="name@email.com" />
        </div>

        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <label className="text-sm font-bold">
            Default store
            <select
              value={defaultStoreId}
              onChange={(event) => setDefaultStoreId(event.target.value)}
              className="mt-2 w-full rounded-2xl border border-slate-200/80 bg-white/90 px-4 py-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.7),0_10px_28px_rgba(15,23,42,0.06)] backdrop-blur-xl outline-none transition focus:border-cyan-400 focus:shadow-[0_0_0_4px_rgba(34,211,238,0.14)]"
            >
              <option value="">No default store</option>
              {stores.map((store) => (
                <option key={store.id} value={store.id}>
                  {store.name}
                </option>
              ))}
            </select>
          </label>

          <label className="text-sm font-bold">
            Employment type
            <select
              value={employmentType}
              onChange={(event) => setEmploymentType(event.target.value)}
              className="mt-2 w-full rounded-2xl border border-slate-200/80 bg-white/90 px-4 py-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.7),0_10px_28px_rgba(15,23,42,0.06)] backdrop-blur-xl outline-none transition focus:border-cyan-400 focus:shadow-[0_0_0_4px_rgba(34,211,238,0.14)]"
            >
              <option value="permanent">Permanent</option>
              <option value="part_time">Part-time</option>
              <option value="casual">Casual</option>
              <option value="fixed_term">Fixed term</option>
            </select>
          </label>
        </div>

        {error && <div className="mt-4 rounded-2xl bg-rose-50 p-4 text-sm font-semibold text-rose-700">{error}</div>}

        <ModalActions onCancel={onClose} onSave={saveEmployee} saving={saving} saveText="Save Employee" />
      </div>
    </div>
  );
}

function CreateShiftModal({
  open,
  onClose,
  onSaved,
  stores,
  employees,
  companyId
}: {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  stores: StoreRow[];
  employees: EmployeeRow[];
  companyId: string;
}) {
  const today = new Date().toISOString().slice(0, 10);
  const activeEmployees = employees.filter((employee) => employee.active);

  const [employeeId, setEmployeeId] = useState("");
  const [storeId, setStoreId] = useState("");
  const [shiftDate, setShiftDate] = useState(today);
  const [startTime, setStartTime] = useState("08:00");
  const [endTime, setEndTime] = useState("17:00");
  const [role, setRole] = useState("Counter Assistant");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

  async function saveShift() {
    setSaving(true);
    setError(null);

    if (!employeeId || !storeId) {
      setError("Employee and store are required.");
      setSaving(false);
      return;
    }

    const { error: insertError } = await supabase.from("roster_shifts").insert({
      company_id: companyId,
      employee_id: employeeId,
      store_id: storeId,
      shift_date: shiftDate,
      planned_start: toShiftDateTime(shiftDate, startTime),
      planned_end: toShiftDateTime(shiftDate, endTime),
      role: role.trim() || null,
      status: "scheduled"
});

    if (insertError) {
      setError(insertError.message);
      setSaving(false);
      return;
    }

    setEmployeeId("");
    setStoreId("");
    setShiftDate(today);
    setStartTime("08:00");
    setEndTime("17:00");
    setRole("Counter Assistant");
    setSaving(false);
    onSaved();
    onClose();
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-2xl rounded-[34px] bg-white p-6 shadow-2xl">
        <ModalHeader title="Create Shift" subtitle="Create a planned roster shift for one employee at one store." onClose={onClose} />

        <div className="mt-6 grid gap-4 md:grid-cols-2">
          <label className="text-sm font-bold">
            Employee
            <select
              value={employeeId}
              onChange={(event) => setEmployeeId(event.target.value)}
              className="mt-2 w-full rounded-2xl border border-slate-200/80 bg-white/90 px-4 py-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.7),0_10px_28px_rgba(15,23,42,0.06)] backdrop-blur-xl outline-none transition focus:border-cyan-400 focus:shadow-[0_0_0_4px_rgba(34,211,238,0.14)]"
            >
              <option value="">Select employee</option>
              {activeEmployees.map((employee) => (
                <option key={employee.id} value={employee.id}>
                  {employee.first_name} {employee.last_name}
                </option>
              ))}
            </select>
          </label>

          <label className="text-sm font-bold">
            Store
            <select
              value={storeId}
              onChange={(event) => setStoreId(event.target.value)}
              className="mt-2 w-full rounded-2xl border border-slate-200/80 bg-white/90 px-4 py-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.7),0_10px_28px_rgba(15,23,42,0.06)] backdrop-blur-xl outline-none transition focus:border-cyan-400 focus:shadow-[0_0_0_4px_rgba(34,211,238,0.14)]"
            >
              <option value="">Select store</option>
              {stores.map((store) => (
                <option key={store.id} value={store.id}>
                  {store.name}
                </option>
              ))}
            </select>
          </label>

          <FormInput label="Shift date" value={shiftDate} onChange={setShiftDate} type="date" />
          <FormInput label="Role" value={role} onChange={setRole} placeholder="Sushi Chef" />
          <FormInput label="Start time" value={startTime} onChange={setStartTime} type="time" />
          <FormInput label="End time" value={endTime} onChange={setEndTime} type="time" />
        </div>

        {error && <div className="mt-4 rounded-2xl bg-rose-50 p-4 text-sm font-semibold text-rose-700">{error}</div>}

        <ModalActions onCancel={onClose} onSave={saveShift} saving={saving} saveText="Save Shift" />
      </div>
    </div>
  );
}
function ManualClockEventModal({
  open,
  onClose,
  onSaved,
  stores,
  employees,
  rosterShifts,
  companyId
}: {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  stores: StoreRow[];
  employees: EmployeeRow[];
  rosterShifts: RosterShiftRow[];
  companyId: string;
}) {
  const today = new Date().toISOString().slice(0, 10);
  const now = new Date();
  const currentTime = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;

  const [employeeId, setEmployeeId] = useState("");
  const [storeId, setStoreId] = useState("");
  const [rosterShiftId, setRosterShiftId] = useState("");
  const [eventType, setEventType] = useState("clock_in");
  const [eventDate, setEventDate] = useState(today);
  const [eventTime, setEventTime] = useState(currentTime);
  const [source, setSource] = useState("manual");
  const [latitude, setLatitude] = useState("");
  const [longitude, setLongitude] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const activeEmployees = employees.filter((employee) => employee.active);

  const filteredShifts = rosterShifts.filter((shift) => {
    if (employeeId && shift.employee_id !== employeeId) return false;
    if (storeId && shift.store_id !== storeId) return false;
    return true;
  });

  if (!open) return null;

  async function saveClockEvent() {
    setSaving(true);
    setError(null);

    if (!employeeId) {
      setError("Employee is required.");
      setSaving(false);
      return;
    }

    const { error: insertError } = await supabase.from("clock_events").insert({
      company_id: companyId,
      employee_id: employeeId,
      store_id: storeId || null,
      roster_shift_id: rosterShiftId || null,
      event_type: eventType,
      event_time: toShiftDateTime(eventDate, eventTime),
      source: "kiosk",
      latitude: latitude.trim() ? Number(latitude) : null,
      longitude: longitude.trim() ? Number(longitude) : null
});

    if (insertError) {
      setError(insertError.message);
      setSaving(false);
      return;
    }

    setEmployeeId("");
    setStoreId("");
    setRosterShiftId("");
    setEventType("clock_in");
    setEventDate(today);
    setEventTime(currentTime);
    setSource("manual");
    setLatitude("");
    setLongitude("");
    setSaving(false);
    onSaved();
    onClose();
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-2xl rounded-[34px] bg-white p-6 shadow-2xl">
        <ModalHeader title="Manual Clock Event" subtitle="Capture a manager-approved manual clocking event with source and audit trail." onClose={onClose} />

        <div className="mt-6 grid gap-4 md:grid-cols-2">
          <label className="text-sm font-bold">
            Employee
            <select
              value={employeeId}
              onChange={(event) => setEmployeeId(event.target.value)}
              className="mt-2 w-full rounded-2xl border border-slate-200/80 bg-white/90 px-4 py-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.7),0_10px_28px_rgba(15,23,42,0.06)] backdrop-blur-xl outline-none transition focus:border-cyan-400 focus:shadow-[0_0_0_4px_rgba(34,211,238,0.14)]"
            >
              <option value="">Select employee</option>
              {activeEmployees.map((employee) => (
                <option key={employee.id} value={employee.id}>
                  {employee.first_name} {employee.last_name}
                </option>
              ))}
            </select>
          </label>

          <label className="text-sm font-bold">
            Store
            <select
              value={storeId}
              onChange={(event) => setStoreId(event.target.value)}
              className="mt-2 w-full rounded-2xl border border-slate-200/80 bg-white/90 px-4 py-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.7),0_10px_28px_rgba(15,23,42,0.06)] backdrop-blur-xl outline-none transition focus:border-cyan-400 focus:shadow-[0_0_0_4px_rgba(34,211,238,0.14)]"
            >
              <option value="">No store linked</option>
              {stores.map((store) => (
                <option key={store.id} value={store.id}>
                  {store.name}
                </option>
              ))}
            </select>
          </label>

          <label className="text-sm font-bold">
            Linked roster shift
            <select
              value={rosterShiftId}
              onChange={(event) => setRosterShiftId(event.target.value)}
              className="mt-2 w-full rounded-2xl border border-slate-200/80 bg-white/90 px-4 py-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.7),0_10px_28px_rgba(15,23,42,0.06)] backdrop-blur-xl outline-none transition focus:border-cyan-400 focus:shadow-[0_0_0_4px_rgba(34,211,238,0.14)]"
            >
              <option value="">No linked shift</option>
              {filteredShifts.map((shift) => (
                <option key={shift.id} value={shift.id}>
                  {formatDate(shift.shift_date)} · {formatTime(shift.planned_start)}–{formatTime(shift.planned_end)}
                </option>
              ))}
            </select>
          </label>

          <label className="text-sm font-bold">
            Event type
            <select
              value={eventType}
              onChange={(event) => setEventType(event.target.value)}
              className="mt-2 w-full rounded-2xl border border-slate-200/80 bg-white/90 px-4 py-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.7),0_10px_28px_rgba(15,23,42,0.06)] backdrop-blur-xl outline-none transition focus:border-cyan-400 focus:shadow-[0_0_0_4px_rgba(34,211,238,0.14)]"
            >
              <option value="clock_in">Clock in</option>
              <option value="clock_out">Clock out</option>
              <option value="break_start">Break start</option>
              <option value="break_end">Break end</option>
            </select>
          </label>

          <FormInput label="Event date" value={eventDate} onChange={setEventDate} type="date" />
          <FormInput label="Event time" value={eventTime} onChange={setEventTime} type="time" />

          <label className="text-sm font-bold">
            Source
            <select
              value={source}
              onChange={(event) => setSource(event.target.value)}
              className="mt-2 w-full rounded-2xl border border-slate-200/80 bg-white/90 px-4 py-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.7),0_10px_28px_rgba(15,23,42,0.06)] backdrop-blur-xl outline-none transition focus:border-cyan-400 focus:shadow-[0_0_0_4px_rgba(34,211,238,0.14)]"
            >
              <option value="manual">Manual</option>
              <option value="mobile">Mobile</option>
              <option value="web">Web</option>
            </select>
          </label>

          <FormInput label="Latitude optional" value={latitude} onChange={setLatitude} placeholder="-33.9249" />
          <FormInput label="Longitude optional" value={longitude} onChange={setLongitude} placeholder="18.4241" />
        </div>

        {error && <div className="mt-4 rounded-2xl bg-rose-50 p-4 text-sm font-semibold text-rose-700">{error}</div>}

        <ModalActions onCancel={onClose} onSave={saveClockEvent} saving={saving} saveText="Save Clock Event" />
      </div>
    </div>
  );
}

function HrResponseModal({
  open,
  onClose,
  onSaved,
  hrCase,
  employeeName
}: {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  hrCase: HrCaseRow | null;
  employeeName: string;
}) {
  const [responseText, setResponseText] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setResponseText(hrCase?.employee_response || "");
    setError(null);
  }, [hrCase]);

  if (!open || !hrCase) return null;

  async function saveResponse() {
    setSaving(true);
    setError(null);

    if (!responseText.trim()) {
      setError("Employee response is required.");
      setSaving(false);
      return;
    }

    const { error: updateError } = await supabase
      .from("hr_cases")
      .update({
        employee_response: responseText.trim(),
        employee_response_required: false,
        validity_status: "review_required"
})
      .eq("id", hrCase.id);

    if (updateError) {
      setError(updateError.message);
      setSaving(false);
      return;
    }

    setSaving(false);
    onSaved();
    onClose();
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-2xl rounded-[34px] bg-white p-6 shadow-2xl">
        <ModalHeader
          title="Employee Response"
          subtitle="Capture the employee's version of events before management finalises the HR case."
          onClose={onClose}
        />

        <div className="mt-6 rounded-2xl bg-white/80 shadow-sm backdrop-blur-xl p-4">
          <div className="text-xs font-bold uppercase tracking-[0.2em] text-slate-400">Employee</div>
          <div className="mt-2 font-bold text-slate-950">{employeeName}</div>

          <div className="mt-4 text-xs font-bold uppercase tracking-[0.2em] text-slate-400">Case</div>
          <div className="mt-2 font-bold text-slate-950">{hrCase.title}</div>
          <div className="mt-2 text-sm leading-6 text-slate-600">{hrCase.description}</div>
        </div>

        <label className="mt-4 block text-sm font-bold">
          Employee response
          <textarea
            value={responseText}
            onChange={(event) => setResponseText(event.target.value)}
            className="mt-2 min-h-36 w-full rounded-2xl border border-white/80 bg-white/80 shadow-sm backdrop-blur-xl px-4 py-3 outline-none focus:border-cyan-400"
            placeholder="Type the employee's response here..."
          />
        </label>

        {error && <div className="mt-4 rounded-2xl bg-rose-50 p-4 text-sm font-semibold text-rose-700">{error}</div>}

        <ModalActions onCancel={onClose} onSave={saveResponse} saving={saving} saveText="Save Response" />
      </div>
    </div>
  );
}function ManualHrCaseModal({
  open,
  onClose,
  onSaved,
  employees,
  companyId
}: {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  employees: EmployeeRow[];
  companyId: string;
}) {
  const activeEmployees = employees.filter((employee) => employee.active);

  const [employeeId, setEmployeeId] = useState("");
  const [caseType, setCaseType] = useState("disciplinary");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [employeeResponseRequired, setEmployeeResponseRequired] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

  async function saveHrCase() {
    setSaving(true);
    setError(null);

    if (!employeeId) {
      setError("Employee is required.");
      setSaving(false);
      return;
    }

    if (!title.trim()) {
      setError("Case title is required.");
      setSaving(false);
      return;
    }

    if (!description.trim()) {
      setError("Case description is required.");
      setSaving(false);
      return;
    }

    const { error: insertError } = await supabase.from("hr_cases").insert({
      company_id: companyId,
      employee_id: employeeId,
      linked_exception_id: null,
      case_type: caseType,
      title: title.trim(),
      description: description.trim(),
      validity_status: "review_required",
      status: "open",
      employee_response_required: employeeResponseRequired,
      employee_response: null
});

    if (insertError) {
      setError(insertError.message);
      setSaving(false);
      return;
    }

    setEmployeeId("");
    setCaseType("disciplinary");
    setTitle("");
    setDescription("");
    setEmployeeResponseRequired(true);
    setSaving(false);
    onSaved();
    onClose();
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-2xl rounded-[34px] bg-white p-6 shadow-2xl">
        <ModalHeader
          title="New HR Case"
          subtitle="Capture a manual HR case for coaching, counselling, warnings, or investigations."
          onClose={onClose}
        />

        <div className="mt-6 grid gap-4 md:grid-cols-2">
          <label className="text-sm font-bold">
            Employee
            <select
              value={employeeId}
              onChange={(event) => setEmployeeId(event.target.value)}
              className="mt-2 w-full rounded-2xl border border-slate-200/80 bg-white/90 px-4 py-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.7),0_10px_28px_rgba(15,23,42,0.06)] backdrop-blur-xl outline-none transition focus:border-cyan-400 focus:shadow-[0_0_0_4px_rgba(34,211,238,0.14)]"
            >
              <option value="">Select employee</option>
              {activeEmployees.map((employee) => (
                <option key={employee.id} value={employee.id}>
                  {employee.first_name} {employee.last_name}
                </option>
              ))}
            </select>
          </label>

          <label className="text-sm font-bold">
            Case type
            <select
              value={caseType}
              onChange={(event) => setCaseType(event.target.value)}
              className="mt-2 w-full rounded-2xl border border-slate-200/80 bg-white/90 px-4 py-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.7),0_10px_28px_rgba(15,23,42,0.06)] backdrop-blur-xl outline-none transition focus:border-cyan-400 focus:shadow-[0_0_0_4px_rgba(34,211,238,0.14)]"
            >
              <option value="disciplinary">Disciplinary</option>
              <option value="warning">Warning</option>
              <option value="verbal_warning">Verbal warning</option>
              <option value="written_warning">Written warning</option>
              <option value="final_written_warning">Final written warning</option>
              <option value="counselling">Counselling</option>
              <option value="investigation">Investigation</option>
            </select>
          </label>

          <div className="md:col-span-2">
            <FormInput label="Case title" value={title} onChange={setTitle} placeholder="Missed lunch clocking" />
          </div>
        </div>

        <label className="mt-4 block text-sm font-bold">
          Case description
          <textarea
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            className="mt-2 min-h-32 w-full rounded-2xl border border-white/80 bg-white/80 shadow-sm backdrop-blur-xl px-4 py-3 outline-none focus:border-cyan-400"
            placeholder="Describe the issue, what happened, and what needs to be reviewed..."
          />
        </label>

        <label className="mt-4 flex items-center gap-3 rounded-2xl bg-white/80 shadow-sm backdrop-blur-xl p-4 text-sm font-bold">
          <input
            type="checkbox"
            checked={employeeResponseRequired}
            onChange={(event) => setEmployeeResponseRequired(event.target.checked)}
            className="h-4 w-4"
          />
          Employee response required before case can be validated
        </label>

        {error && <div className="mt-4 rounded-2xl bg-rose-50 p-4 text-sm font-semibold text-rose-700">{error}</div>}

        <ModalActions onCancel={onClose} onSave={saveHrCase} saving={saving} saveText="Save HR Case" />
      </div>
    </div>
  );
}


function LeaveApprovalsScreen({
  leaveRequests,
  employees,
  onRefresh
}: {
  leaveRequests: LeaveRequestRow[];
  employees: EmployeeRow[];
  onRefresh: () => void;
}) {
  const [savingId, setSavingId] = useState<string | null>(null);
  const [filter, setFilter] = useState<"pending" | "all" | "approved" | "declined" | "amended">("pending");
  const [error, setError] = useState<string | null>(null);

  const filteredLeaveRequests = leaveRequests.filter((request) => {
    if (filter === "all") return true;
    return request.status === filter;
  });

  const pendingCount = leaveRequests.filter((request) => request.status === "pending").length;
  const approvedCount = leaveRequests.filter((request) => request.status === "approved").length;
  const declinedCount = leaveRequests.filter((request) => request.status === "declined").length;
  const amendedCount = leaveRequests.filter((request) => request.status === "amended").length;

  function leaveDays(startDate: string, endDate: string) {
    try {
      const start = new Date(`${startDate}T12:00:00`);
      const end = new Date(`${endDate}T12:00:00`);
      return Math.max(1, Math.floor((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1);
    } catch {
      return 1;
    }
  }

  function employeeContact(employeeCode: string | null) {
    if (!employeeCode) return "No employee code";
    const found = employees.find((employee) => {
      return employee.employee_number === employeeCode || employee.id === employeeCode;
    });

    if (!found) return employeeCode;

    return `${found.employee_number || "No code"} · ${found.phone || found.email || "No contact"}`;
  }

  async function updateLeaveStatus(request: LeaveRequestRow, status: "approved" | "declined" | "amended") {
    const promptText =
      status === "approved"
        ? "Message to employee for approval:"
        : status === "declined"
        ? "Reason for declining:"
        : "Explain the amendment:";

    const feedback = window.prompt(promptText);

    if (feedback === null) return;

    setSavingId(request.id);
    setError(null);

    const { error: updateError } = await supabase
      .from("leave_requests")
      .update({
        status,
        manager_feedback: feedback.trim() || null
})
      .eq("id", request.id);

    if (updateError) {
      setError(updateError.message);
      setSavingId(null);
      return;
    }

    setSavingId(null);
    onRefresh();
  }

  return (
    <>
      <div className="mt-6 grid gap-5 md:grid-cols-2 xl:grid-cols-4">
        <StatCard title="Pending leave" value={String(pendingCount)} subtitle="Needs manager approval" icon={<Clock3 className="h-6 w-6" />} />
        <StatCard title="Approved" value={String(approvedCount)} subtitle="Already approved" icon={<CheckCircle2 className="h-6 w-6" />} />
        <StatCard title="Declined" value={String(declinedCount)} subtitle="Rejected requests" icon={<AlertTriangle className="h-6 w-6" />} />
        <StatCard title="Amended" value={String(amendedCount)} subtitle="Changed by manager" icon={<Gavel className="h-6 w-6" />} />
      </div>

      <div className="mt-8 grid gap-8 xl:grid-cols-[1fr_0.7fr]">
        <Panel>
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div>
              <h2 className="text-2xl font-bold tracking-tight">Leave Approval Queue</h2>
              <p className="mt-2 text-sm text-slate-500">
                Employee leave applications from the kiosk appear here for manager approval, decline or amendment.
              </p>
            </div>

            <button
              onClick={onRefresh}
              className="w-fit rounded-2xl bg-[#06101f] px-5 py-3 text-sm font-black text-cyan-300 shadow-lg shadow-cyan-950/15"
            >
              Refresh
            </button>
          </div>

          <div className="mt-5 flex flex-wrap gap-2">
            {(["pending", "all", "approved", "declined", "amended"] as const).map((item) => (
              <button
                key={item}
                onClick={() => setFilter(item)}
                className={`rounded-full px-4 py-2 text-xs font-bold uppercase tracking-[0.15em] ${
                  filter === item
                    ? "bg-slate-950 text-white"
                    : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                }`}
              >
                {item === "all" ? "All" : formatText(item)}
              </button>
            ))}
          </div>

          {error && (
            <div className="mt-5 rounded-2xl bg-rose-50 p-4 text-sm font-semibold text-rose-700">
              {error}
            </div>
          )}

          <div className="mt-6 space-y-4">
            {filteredLeaveRequests.length === 0 ? (
              <div className="rounded-[26px] border border-dashed border-slate-200 bg-slate-50 p-8 text-center">
                <div className="text-lg font-bold text-slate-950">No leave requests found</div>
                <p className="mt-2 text-sm text-slate-500">
                  New employee leave applications will appear here as pending.
                </p>
              </div>
            ) : (
              filteredLeaveRequests.map((request) => (
                <article key={request.id} className="rounded-[2rem] border border-white/80 bg-white/90 p-5 shadow-[0_16px_45px_rgba(15,23,42,0.10)] backdrop-blur-xl">
                  <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                    <div>
                      <div className="text-xl font-bold text-slate-950">
                        {request.employee_name || "Unknown employee"}
                      </div>
                      <div className="mt-1 text-xs font-semibold text-slate-500">
                        {employeeContact(request.employee_id)}
                      </div>
                    </div>
                    <StatusPill value={request.status} />
                  </div>

                  <div className="mt-5 grid gap-3 md:grid-cols-4">
                    <InfoBox label="Leave Type" value={request.leave_type || "Leave"} />
                    <InfoBox label="Start Date" value={formatDate(request.start_date)} />
                    <InfoBox label="End Date" value={formatDate(request.end_date)} />
                    <InfoBox label="Days" value={String(leaveDays(request.start_date, request.end_date))} />
                  </div>

                  <div className="mt-4 rounded-2xl border border-white/80 bg-white/95 p-4 shadow-sm">
                    <div className="text-xs font-bold uppercase tracking-[0.2em] text-slate-400">Employee reason</div>
                    <p className="mt-2 text-sm leading-6 text-slate-600">{request.reason || "No reason supplied."}</p>
                  </div>

                  {request.manager_feedback && (
                    <div className="mt-4 rounded-2xl bg-cyan-50 p-4">
                      <div className="text-xs font-bold uppercase tracking-[0.2em] text-cyan-700">Manager feedback</div>
                      <p className="mt-2 text-sm leading-6 text-blue-900">{request.manager_feedback}</p>
                    </div>
                  )}

                  {request.status === "pending" && (
                    <div className="mt-4 flex flex-wrap gap-2">
                      <button
                        onClick={() => updateLeaveStatus(request, "approved")}
                        disabled={savingId === request.id}
                        className="rounded-2xl bg-emerald-600 px-4 py-3 text-sm font-bold text-white disabled:opacity-60"
                      >
                        Approve
                      </button>

                      <button
                        onClick={() => updateLeaveStatus(request, "declined")}
                        disabled={savingId === request.id}
                        className="rounded-2xl bg-rose-600 px-4 py-3 text-sm font-bold text-white disabled:opacity-60"
                      >
                        Decline
                      </button>

                      <button
                        onClick={() => updateLeaveStatus(request, "amended")}
                        disabled={savingId === request.id}
                        className="rounded-2xl bg-blue-600 px-4 py-3 text-sm font-bold text-white disabled:opacity-60"
                      >
                        Amend
                      </button>
                    </div>
                  )}
                </article>
              ))
            )}
          </div>
        </Panel>

        <Panel dark>
          <div className="text-xs font-bold uppercase tracking-[0.4em] text-cyan-300">Manager Control</div>
          <h2 className="mt-3 text-3xl font-bold">How you know leave was filed</h2>
          <div className="mt-6 space-y-3 text-sm text-slate-300">
            <div className="rounded-2xl bg-white/10 p-4">The sidebar now has Leave Approvals under HR & Compliance.</div>
            <div className="rounded-2xl bg-white/10 p-4">Pending leave requests show in this approval queue.</div>
            <div className="rounded-2xl bg-white/10 p-4">Approving, declining or amending saves manager feedback to the employee request.</div>
            <div className="rounded-2xl bg-white/10 p-4">Employee kiosk remains separate and never shows this manager queue.</div>
          </div>
        </Panel>
      </div>
    </>
  );
}


function StoresScreen({
  stores,
  employees,
  exceptions,
  onAddStore
}: {
  stores: StoreRow[];
  employees: EmployeeRow[];
  exceptions: ExceptionRow[];
  onAddStore: () => void;
}) {
  const activeStores = stores.filter((store) => store.status === "active").length;

  return (
    <>
      <div className="mt-6 grid gap-5 md:grid-cols-2 xl:grid-cols-4">
        <StatCard title="Total stores" value={String(stores.length)} subtitle="All stores loaded from Supabase" icon={<Store className="h-6 w-6" />} />
        <StatCard title="Active stores" value={String(activeStores)} subtitle="Ready for roster and clocking" icon={<CheckCircle2 className="h-6 w-6" />} />
        <StatCard title="Employees" value={String(employees.length)} subtitle="Available for scheduling" icon={<Users className="h-6 w-6" />} />
        <StatCard title="Exceptions" value={String(exceptions.length)} subtitle="Store-linked risk items" icon={<AlertTriangle className="h-6 w-6" />} />
      </div>

      <div className="mt-8 grid gap-8 xl:grid-cols-[1fr_0.7fr]">
        <Panel>
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div>
              <h2 className="text-2xl font-bold tracking-tight">Store Network</h2>
              <p className="mt-2 text-sm text-slate-500">Manage opening times, GPS rules, region grouping and clocking controls per store.</p>
            </div>

            <button onClick={onAddStore} className="flex w-fit items-center gap-2 rounded-2xl bg-[#06101f] px-5 py-3 text-sm font-black text-cyan-300 shadow-lg shadow-cyan-950/15">
              <Plus className="h-4 w-4" />
              Add Store
            </button>
          </div>

          <div className="mt-6 grid gap-5 xl:grid-cols-2">
            {stores.map((store) => {
              const storeExceptions = exceptions.filter((item) => item.store_id === store.id).length;

              return (
                <div key={store.id} className="rounded-[2rem] border border-white/80 bg-white/90 p-5 shadow-[0_16px_45px_rgba(15,23,42,0.10)] backdrop-blur-xl">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <div className="text-lg font-bold text-slate-950">{store.name}</div>
                      <div className="mt-1 text-xs font-semibold text-slate-500">
                        {store.region || "No region"} · {store.city || "No city"}
                      </div>
                    </div>
                    <StatusPill value={store.status} />
                  </div>

                  <div className="mt-5 grid gap-3 text-sm md:grid-cols-2">
                    <InfoBox label="Opening" value={formatTimeOnly(store.opening_time)} />
                    <InfoBox label="Closing" value={formatTimeOnly(store.closing_time)} />
                    <InfoBox label="GPS Radius" value={`${store.gps_radius_meters || 150}m`} />
                    <InfoBox label="Exceptions" value={String(storeExceptions)} />
                  </div>

                  <div className="mt-4 text-xs leading-5 text-slate-500">{store.address || "No address loaded yet."}</div>
                </div>
              );
            })}
          </div>
        </Panel>

        <Panel dark>
          <div className="text-xs font-bold uppercase tracking-[0.4em] text-cyan-300">Store Control</div>
          <h2 className="mt-3 text-3xl font-bold">Why this matters</h2>
          <div className="mt-6 space-y-3 text-sm text-slate-300">
            <div className="rounded-2xl bg-white/10 p-4">Each store can have different opening and closing times.</div>
            <div className="rounded-2xl bg-white/10 p-4">Clocking can be locked to a GPS radius per counter.</div>
            <div className="rounded-2xl bg-white/10 p-4">Staff can rotate between stores while keeping payroll clean.</div>
          </div>
        </Panel>
      </div>
    </>
  );
}

function EmployeesScreen({
  employees,
  stores,
  exceptions,
  hrCases,
  onAddEmployee,
  onRefresh
}: {
  employees: EmployeeRow[];
  stores: StoreRow[];
  exceptions: ExceptionRow[];
  hrCases: HrCaseRow[];
  onAddEmployee: () => void;
  onRefresh: () => void;
}) {
  const [localEmployees, setLocalEmployees] = useState<EmployeeRow[]>(employees);
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [savingEmployee, setSavingEmployee] = useState(false);
  const [employeeSaveMessage, setEmployeeSaveMessage] = useState<string | null>(null);
  const [employeeSaveError, setEmployeeSaveError] = useState<string | null>(null);

  const [editEmployeeNumber, setEditEmployeeNumber] = useState("");
  const [editFirstName, setEditFirstName] = useState("");
  const [editLastName, setEditLastName] = useState("");
  const [editJobTitle, setEditJobTitle] = useState("");
  const [editDefaultStoreId, setEditDefaultStoreId] = useState("");
  const [editEmploymentType, setEditEmploymentType] = useState("permanent");
  const [editPhone, setEditPhone] = useState("");
  const [editEmail, setEditEmail] = useState("");
  const [editPinCode, setEditPinCode] = useState("");
  const [editKioskEnabled, setEditKioskEnabled] = useState(true);
  const [editActive, setEditActive] = useState(true);

  useEffect(() => {
    setLocalEmployees(employees);

    if (selectedEmployeeId && !employees.some((employee) => employee.id === selectedEmployeeId)) {
      setSelectedEmployeeId(null);
    }
  }, [employees, selectedEmployeeId]);

  const activeEmployees = localEmployees.filter((employee) => employee.active).length;
  const inactiveEmployees = localEmployees.filter((employee) => !employee.active).length;
  const selectedEmployee = localEmployees.find((employee) => employee.id === selectedEmployeeId) || null;

  const filteredEmployees = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();

    if (!term) return localEmployees;

    return localEmployees.filter((employee) => {
      const searchable = [
        employee.employee_number || "",
        employee.first_name || "",
        employee.last_name || "",
        employee.job_title || "",
        employee.email || "",
        employee.phone || "",
        storeName(employee.default_store_id),
      ]
        .join(" ")
        .toLowerCase();

      return searchable.includes(term);
    });
  }, [localEmployees, searchTerm, stores]);

  useEffect(() => {
    if (!selectedEmployee) return;

    setEditEmployeeNumber(selectedEmployee.employee_number || "");
    setEditFirstName(selectedEmployee.first_name || "");
    setEditLastName(selectedEmployee.last_name || "");
    setEditJobTitle(selectedEmployee.job_title || "");
    setEditDefaultStoreId(selectedEmployee.default_store_id || "");
    setEditEmploymentType(selectedEmployee.employment_type || "permanent");
    setEditPhone(selectedEmployee.phone || "");
    setEditEmail(selectedEmployee.email || "");
    setEditPinCode(selectedEmployee.pin_code || "");
    setEditKioskEnabled(selectedEmployee.kiosk_access_enabled !== false);
    setEditActive(selectedEmployee.active !== false);
    setEmployeeSaveMessage(null);
    setEmployeeSaveError(null);
  }, [selectedEmployee]);

  function storeName(id: string | null) {
    const store = stores.find((item) => item.id === id);
    return store ? store.name : "No default store";
  }

  function employeeFullName(employee: EmployeeRow) {
    return `${employee.first_name || ""} ${employee.last_name || ""}`.trim() || "Unnamed employee";
  }

  function generateEmployeePin() {
    setEditPinCode(String(Math.floor(1000 + Math.random() * 9000)));
  }

  async function saveSelectedEmployee() {
    if (!selectedEmployee) {
      setEmployeeSaveError("Select an employee first.");
      return;
    }

    if (!editFirstName.trim() || !editLastName.trim()) {
      setEmployeeSaveError("First name and last name are required.");
      return;
    }

    if (editPinCode.trim() && !/^\d{4}$/.test(editPinCode.trim())) {
      setEmployeeSaveError("PIN must be exactly 4 numbers.");
      return;
    }

    setSavingEmployee(true);
    setEmployeeSaveError(null);
    setEmployeeSaveMessage(null);

    const updatePayload = {
      employee_number: editEmployeeNumber.trim() || null,
      first_name: editFirstName.trim(),
      last_name: editLastName.trim(),
      job_title: editJobTitle.trim() || null,
      default_store_id: editDefaultStoreId || null,
      employment_type: editEmploymentType || "permanent",
      phone: editPhone.trim() || null,
      email: editEmail.trim() || null,
      pin_code: editPinCode.trim() || null,
      kiosk_access_enabled: editKioskEnabled,
      active: editActive
};

    const { data: savedEmployee, error: updateError } = await supabase
      .from("employees")
      .update(updatePayload)
      .eq("id", selectedEmployee.id)
      .select("id,employee_number,first_name,last_name,job_title,default_store_id,active,email,phone,employment_type,pin_code,kiosk_access_enabled")
      .maybeSingle();

    if (updateError) {
      setEmployeeSaveError(updateError.message);
      setSavingEmployee(false);
      return;
    }

    if (!savedEmployee) {
      setEmployeeSaveError("No employee was updated. Please check database permissions/RLS.");
      setSavingEmployee(false);
      return;
    }

    const typedSavedEmployee = savedEmployee as EmployeeRow;

    setLocalEmployees((current) =>
      current.map((employee) =>
        employee.id === typedSavedEmployee.id ? typedSavedEmployee : employee
      )
    );

    setSelectedEmployeeId(typedSavedEmployee.id);
    setEmployeeSaveMessage("Employee saved successfully.");
    setSavingEmployee(false);

    onRefresh();
  }

  if (selectedEmployee) {
    const exceptionCount = exceptions.filter((item) => item.employee_id === selectedEmployee.id).length;
    const employeeHrCases = hrCases.filter((item) => item.employee_id === selectedEmployee.id).length;

    return (
      <>
        <div className="mt-6 grid gap-5 md:grid-cols-2 xl:grid-cols-4">
          <StatCard title="Employee" value={employeeFullName(selectedEmployee)} subtitle={selectedEmployee.employee_number || "No employee number"} icon={<Users className="h-6 w-6" />} />
          <StatCard title="Store" value={storeName(selectedEmployee.default_store_id)} subtitle="Default work location" icon={<Store className="h-6 w-6" />} />
          <StatCard title="Exceptions" value={String(exceptionCount)} subtitle="Linked payroll/clocking items" icon={<AlertTriangle className="h-6 w-6" />} />
          <StatCard title="HR cases" value={String(employeeHrCases)} subtitle="Employee HR records" icon={<ShieldCheck className="h-6 w-6" />} />
        </div>

        <div className="mt-8 grid gap-8 xl:grid-cols-[1fr_0.7fr]">
          <Panel>
            <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
              <div>
                <h2 className="text-2xl font-bold tracking-tight">Edit Employee</h2>
                <p className="mt-2 text-sm text-slate-500">Update staff details, kiosk PIN and access status.</p>
              </div>

              <button onClick={() => setSelectedEmployeeId(null)} className="rounded-2xl border border-slate-200 bg-white px-5 py-3 text-sm font-bold text-slate-700 hover:bg-slate-50">
                Back to Staff List
              </button>
            </div>

            <div className="mt-6 grid gap-4 md:grid-cols-2">
              <FormInput label="Employee code" value={editEmployeeNumber} onChange={setEditEmployeeNumber} placeholder="EMP001" />
              <FormInput label="Job title" value={editJobTitle} onChange={setEditJobTitle} placeholder="Counter Assistant" />
              <FormInput label="First name" value={editFirstName} onChange={setEditFirstName} placeholder="First name" />
              <FormInput label="Last name" value={editLastName} onChange={setEditLastName} placeholder="Last name" />
              <FormInput label="Phone" value={editPhone} onChange={setEditPhone} placeholder="082..." />
              <FormInput label="Email" value={editEmail} onChange={setEditEmail} placeholder="name@company.co.za" />
            </div>

            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <label className="text-sm font-bold">
                Default store
                <select
                  value={editDefaultStoreId}
                  onChange={(event) => setEditDefaultStoreId(event.target.value)}
                  className="mt-2 w-full rounded-2xl border border-slate-200/80 bg-white/90 px-4 py-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.7),0_10px_28px_rgba(15,23,42,0.06)] backdrop-blur-xl outline-none transition focus:border-cyan-400 focus:shadow-[0_0_0_4px_rgba(34,211,238,0.14)]"
                >
                  <option value="">No default store</option>
                  {stores.map((store) => (
                    <option key={store.id} value={store.id}>
                      {store.name}
                    </option>
                  ))}
                </select>
              </label>

              <label className="text-sm font-bold">
                Employment type
                <select
                  value={editEmploymentType}
                  onChange={(event) => setEditEmploymentType(event.target.value)}
                  className="mt-2 w-full rounded-2xl border border-slate-200/80 bg-white/90 px-4 py-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.7),0_10px_28px_rgba(15,23,42,0.06)] backdrop-blur-xl outline-none transition focus:border-cyan-400 focus:shadow-[0_0_0_4px_rgba(34,211,238,0.14)]"
                >
                  <option value="permanent">Permanent</option>
                  <option value="part_time">Part-time</option>
                  <option value="casual">Casual</option>
                  <option value="fixed_term">Fixed term</option>
                  <option value="temporary">Temporary</option>
                  <option value="contractor">Contractor</option>
                </select>
              </label>
            </div>

            <div className="mt-6 rounded-[2rem] border border-white/80 bg-white/90 p-5 shadow-[0_16px_45px_rgba(15,23,42,0.10)] backdrop-blur-xl">
              <div className="text-xs font-bold uppercase tracking-[0.2em] text-slate-400">PIN / Kiosk Access</div>

              <div className="mt-4 grid gap-3 md:grid-cols-[1fr_auto]">
                <input
                  value={editPinCode}
                  onChange={(event) => setEditPinCode(event.target.value.replace(/\D/g, "").slice(0, 4))}
                  placeholder="4-digit PIN"
                  className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-bold outline-none focus:border-cyan-400"
                />

                <button onClick={generateEmployeePin} className="rounded-2xl bg-blue-600 px-5 py-3 text-sm font-bold text-white">
                  Auto Generate PIN
                </button>
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                <button
                  onClick={() => setEditKioskEnabled((value) => !value)}
                  className={`rounded-2xl px-4 py-3 text-sm font-bold text-white ${editKioskEnabled ? "bg-emerald-600" : "bg-rose-600"}`}
                >
                  Kiosk Access: {editKioskEnabled ? "Enabled" : "Disabled"}
                </button>

                <button
                  onClick={() => setEditActive((value) => !value)}
                  className={`rounded-2xl px-4 py-3 text-sm font-bold text-white ${editActive ? "bg-emerald-600" : "bg-rose-600"}`}
                >
                  Employee Status: {editActive ? "Active" : "Inactive"}
                </button>
              </div>
            </div>

            {employeeSaveError && <div className="mt-5 rounded-2xl bg-rose-50 p-4 text-sm font-semibold text-rose-700">{employeeSaveError}</div>}
            {employeeSaveMessage && <div className="mt-5 rounded-2xl bg-emerald-50 p-4 text-sm font-semibold text-emerald-700">{employeeSaveMessage}</div>}

            <button
              onClick={saveSelectedEmployee}
              disabled={savingEmployee}
              className="mt-6 w-full rounded-2xl bg-[#06101f] px-5 py-4 text-sm font-black text-cyan-300 shadow-lg shadow-cyan-950/15 disabled:opacity-60"
            >
              {savingEmployee ? "Saving Employee..." : "Save Employee Changes"}
            </button>
          </Panel>

          <Panel dark>
            <div className="text-xs font-bold uppercase tracking-[0.4em] text-cyan-300">Employee Control</div>
            <h2 className="mt-3 text-3xl font-bold">Staff profile management</h2>
            <div className="mt-6 space-y-3 text-sm text-slate-300">
              <div className="rounded-2xl bg-white/10 p-4">Employee changes save directly to Supabase.</div>
              <div className="rounded-2xl bg-white/10 p-4">PIN is used for kiosk clocking and leave access.</div>
              <div className="rounded-2xl bg-white/10 p-4">Inactive staff are excluded from daily operations.</div>
              <div className="rounded-2xl bg-white/10 p-4">Use the searchable staff list for large teams.</div>
            </div>
          </Panel>
        </div>
      </>
    );
  }

  return (
    <>
      <div className="mt-6 grid gap-5 md:grid-cols-2 xl:grid-cols-4">
        <StatCard title="Total employees" value={String(localEmployees.length)} subtitle="Live from employees table" icon={<Users className="h-6 w-6" />} />
        <StatCard title="Active staff" value={String(activeEmployees)} subtitle="Can be rostered and clocked" icon={<CheckCircle2 className="h-6 w-6" />} />
        <StatCard title="Inactive staff" value={String(inactiveEmployees)} subtitle="Excluded from rosters" icon={<AlertTriangle className="h-6 w-6" />} />
        <StatCard title="HR records" value={String(hrCases.length)} subtitle="Linked to disciplinary workflow" icon={<ShieldCheck className="h-6 w-6" />} />
      </div>

      <div className="mt-8 grid gap-8 xl:grid-cols-[1fr_0.7fr]">
        <Panel>
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div>
              <h2 className="text-2xl font-bold tracking-tight">Staff List</h2>
              <p className="mt-2 text-sm text-slate-500">Search and open staff records. Designed for 100+ employees.</p>
            </div>

            <button onClick={onAddEmployee} className="flex w-fit items-center gap-2 rounded-2xl bg-[#06101f] px-5 py-3 text-sm font-black text-cyan-300 shadow-lg shadow-cyan-950/15">
              <Plus className="h-4 w-4" />
              Add Employee
            </button>
          </div>

          <input
            value={searchTerm}
            onChange={(event) => setSearchTerm(event.target.value)}
            className="mt-6 w-full rounded-2xl border border-white/80 bg-white/80 shadow-sm backdrop-blur-xl px-4 py-4 text-sm font-semibold outline-none focus:border-cyan-400"
            placeholder="Search by code, name, job, store, phone or email..."
          />

          <div className="mt-5 overflow-hidden rounded-[26px] border border-slate-200">
            <div className="grid grid-cols-[1.2fr_1fr_1fr_90px] bg-slate-950 px-4 py-3 text-xs font-black uppercase tracking-[0.16em] text-white">
              <div>Employee</div>
              <div>Store</div>
              <div>Contact</div>
              <div>Status</div>
            </div>

            <div className="max-h-[620px] overflow-y-auto bg-white">
              {filteredEmployees.length === 0 ? (
                <div className="p-6 text-sm font-semibold text-slate-500">No employees match your search.</div>
              ) : (
                filteredEmployees.map((employee) => {
                  const exceptionCount = exceptions.filter((item) => item.employee_id === employee.id).length;

                  return (
                    <button
                      key={employee.id}
                      type="button"
                      onClick={() => setSelectedEmployeeId(employee.id)}
                      className="grid w-full grid-cols-[1.2fr_1fr_1fr_90px] items-center gap-3 border-t border-slate-100 px-4 py-4 text-left transition hover:bg-cyan-50"
                    >
                      <div>
                        <div className="font-bold text-slate-950">{employeeFullName(employee)}</div>
                        <div className="mt-1 text-xs font-semibold text-slate-500">
                          {employee.employee_number || "No employee number"} · {employee.job_title || "No job title"} · Exceptions: {exceptionCount}
                        </div>
                      </div>

                      <div className="text-sm font-semibold text-slate-600">{storeName(employee.default_store_id)}</div>
                      <div className="text-sm font-semibold text-slate-600">{employee.phone || employee.email || "Not loaded"}</div>
                      <div>
                        <StatusPill value={employee.active ? "active" : "inactive"} />
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          </div>
        </Panel>

        <Panel dark>
          <div className="text-xs font-bold uppercase tracking-[0.4em] text-cyan-300">Employee Control</div>
          <h2 className="mt-3 text-3xl font-bold">Search-first staff management</h2>
          <div className="mt-6 space-y-3 text-sm text-slate-300">
            <div className="rounded-2xl bg-white/10 p-4">Search by code, name, store, phone or email.</div>
            <div className="rounded-2xl bg-white/10 p-4">Open a staff member to edit and save details.</div>
            <div className="rounded-2xl bg-white/10 p-4">Manage kiosk PINs from the same employee profile.</div>
            <div className="rounded-2xl bg-white/10 p-4">Built for large staff lists, not small demo cards only.</div>
          </div>
        </Panel>
      </div>
    </>
  );
}
function RosterBuilderScreen({
  rosterShifts,
  employees,
  stores,
  onCreateShift
}: {
  rosterShifts: RosterShiftRow[];
  employees: EmployeeRow[];
  stores: StoreRow[];
  onCreateShift: () => void;
}) {
  function employeeName(id: string) {
    const employee = employees.find((item) => item.id === id);
    return employee ? `${employee.first_name} ${employee.last_name}` : "Unassigned employee";
  }

  function storeName(id: string) {
    const store = stores.find((item) => item.id === id);
    return store ? store.name : "No store linked";
  }

  const grouped = rosterShifts.reduce<Record<string, RosterShiftRow[]>>((acc, shift) => {
    const key = shift.shift_date;
    if (!acc[key]) acc[key] = [];
    acc[key].push(shift);
    return acc;
  }, {});

  const groupedDates = Object.keys(grouped).sort();

  return (
    <div className="mt-8 grid gap-8 xl:grid-cols-[1fr_0.7fr]">
      <Panel>
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 className="text-2xl font-bold tracking-tight">Weekly Roster Builder</h2>
            <p className="mt-2 text-sm text-slate-500">Create planned shifts, allocate staff and keep payroll clean before clocking starts.</p>
          </div>

          <button onClick={onCreateShift} className="flex w-fit items-center gap-2 rounded-2xl bg-[#06101f] px-5 py-3 text-sm font-black text-cyan-300 shadow-lg shadow-cyan-950/15">
            <Plus className="h-4 w-4" />
            Create Shift
          </button>
        </div>

        <div className="mt-6 space-y-5">
          {groupedDates.length === 0 && <div className="rounded-[2rem] border border-white/80 bg-white/90 p-5 shadow-[0_16px_45px_rgba(15,23,42,0.10)] backdrop-blur-xl text-sm text-slate-500">No roster shifts found yet. Create shifts to start payroll planning.</div>}

          {groupedDates.map((date) => (
            <div key={date} className="overflow-hidden rounded-[26px] border border-slate-200 bg-slate-50">
              <div className="border-b border-slate-200 bg-white px-5 py-4">
                <div className="text-sm font-bold uppercase tracking-[0.2em] text-slate-400">{formatDate(date)}</div>
              </div>

              <div className="divide-y divide-slate-200">
                {grouped[date].map((shift) => (
                  <div key={shift.id} className="grid gap-4 p-5 md:grid-cols-[1fr_1fr_120px] md:items-center">
                    <div>
                      <div className="font-bold text-slate-950">{employeeName(shift.employee_id)}</div>
                      <div className="mt-1 text-xs text-slate-500">{shift.role || "Shift role not set"}</div>
                    </div>

                    <div>
                      <div className="text-sm font-bold text-slate-700">{storeName(shift.store_id)}</div>
                      <div className="mt-1 text-xs text-slate-500">
                        {formatTime(shift.planned_start)} – {formatTime(shift.planned_end)}
                      </div>
                    </div>

                    <StatusPill value={shift.status} />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </Panel>

      <Panel dark>
        <div className="text-xs font-bold uppercase tracking-[0.4em] text-cyan-300">Auto Roster Rules</div>
        <h2 className="mt-3 text-3xl font-bold">Rules engine preview</h2>
        <div className="mt-6 space-y-3 text-sm text-slate-300">
          <div className="rounded-2xl bg-white/10 p-4">Each counter needs opening, peak and closing coverage.</div>
          <div className="rounded-2xl bg-white/10 p-4">Rotate weekends fairly across active staff.</div>
          <div className="rounded-2xl bg-white/10 p-4">Block inactive employees from shift suggestions.</div>
          <div className="rounded-2xl bg-white/10 p-4">Flag shifts that may create overtime before approval.</div>
        </div>
      </Panel>
    </div>
  );
}

function ClockingLiveScreen({
  clockEvents,
  employees,
  stores,
  onManualEvent
}: {
  clockEvents: ClockEventRow[];
  employees: EmployeeRow[];
  stores: StoreRow[];
  onManualEvent: () => void;
}) {
  function employeeName(id: string) {
    const employee = employees.find((item) => item.id === id);
    return employee ? `${employee.first_name} ${employee.last_name}` : "Unassigned employee";
  }

  function storeName(id: string | null) {
    const store = stores.find((item) => item.id === id);
    return store ? store.name : "No store linked";
  }

  return (
    <div className="mt-8">
      <Panel>
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 className="text-2xl font-bold tracking-tight">Live Clocking Feed</h2>
            <p className="mt-2 text-sm text-slate-500">View clock-ins, clock-outs and lunch events across all stores.</p>
          </div>

          <button onClick={onManualEvent} className="flex w-fit items-center gap-2 rounded-2xl bg-[#06101f] px-5 py-3 text-sm font-black text-cyan-300 shadow-lg shadow-cyan-950/15">
            <Plus className="h-4 w-4" />
            Manual Event
          </button>
        </div>

        <div className="mt-6 space-y-4">
          {clockEvents.length === 0 && <div className="rounded-[2rem] border border-white/80 bg-white/90 p-5 shadow-[0_16px_45px_rgba(15,23,42,0.10)] backdrop-blur-xl text-sm text-slate-500">No clock events yet. Clocking data will appear here.</div>}

          {clockEvents.map((event) => (
            <div key={event.id} className="rounded-[2rem] border border-white/80 bg-white/90 p-5 shadow-[0_16px_45px_rgba(15,23,42,0.10)] backdrop-blur-xl">
              <div className="grid gap-4 md:grid-cols-[1fr_1fr_120px] md:items-center">
                <div>
                  <div className="font-bold text-slate-950">{employeeName(event.employee_id)}</div>
                  <div className="mt-1 text-xs text-slate-500">{storeName(event.store_id)}</div>
                </div>

                <div>
                  <div className="text-sm font-bold text-slate-700">{formatTime(event.event_time)}</div>
                  <div className="mt-1 text-xs capitalize text-slate-500">Source: {event.source}</div>
                </div>

                <EventPill value={event.event_type} />
              </div>
            </div>
          ))}
        </div>
      </Panel>
    </div>
  );
}

function ExceptionsPanel({
  exceptions,
  employees,
  stores,
  onRefresh,
  companyId
}: {
  exceptions: ExceptionRow[];
  employees: EmployeeRow[];
  stores: StoreRow[];
  onRefresh: () => void;
  companyId: string;
}) {
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  function employeeName(id: string) {
    const employee = employees.find((item) => item.id === id);
    return employee ? `${employee.first_name} ${employee.last_name}` : "Unassigned employee";
  }

  function storeName(id: string | null) {
    const store = stores.find((item) => item.id === id);
    return store ? store.name : "No store linked";
  }

  async function updateException(id: string, status: "approved" | "closed") {
    setUpdatingId(id);
    setActionError(null);

    const { error } = await supabase.from("time_exceptions").update({ status }).eq("id", id);

    if (error) {
      setActionError(error.message);
      setUpdatingId(null);
      return;
    }

    setUpdatingId(null);
    onRefresh();
  }

  async function createHrCase(exceptionItem: ExceptionRow) {
    setUpdatingId(exceptionItem.id);
    setActionError(null);

    const { error } = await supabase.from("hr_cases").insert({
      company_id: companyId,
      employee_id: exceptionItem.employee_id,
      linked_exception_id: null,
      case_type: "disciplinary",
      title: `Case: ${formatText(exceptionItem.exception_type)}`,
      description: exceptionItem.description,
      validity_status: "review_required",
      status: "open",
      employee_response_required: true
});

    if (error) {
      alert("ERROR: " + error.message);
      setUpdatingId(null);
      return;
    }

    alert("HR CASE CREATED");
    setUpdatingId(null);
    onRefresh();
  }

  return (
    <Panel>
      <h2 className="text-2xl font-bold tracking-tight">Exception Approval Queue</h2>
      <p className="mt-2 text-sm text-slate-500">Approve, close, or create HR cases from time exceptions.</p>

      {actionError && <div className="mt-4 rounded-2xl bg-rose-50 p-4 text-sm font-semibold text-rose-700">{actionError}</div>}

      <div className="mt-6 space-y-4">
        {exceptions.length === 0 && <div className="rounded-[2rem] border border-white/80 bg-white/90 p-5 shadow-[0_16px_45px_rgba(15,23,42,0.10)] backdrop-blur-xl text-sm text-slate-500">No open exceptions found.</div>}

        {exceptions.map((item) => {
          const isClosed = item.status === "closed";

          return (
            <div key={item.id} className="rounded-[2rem] border border-white/80 bg-white/90 p-5 shadow-[0_16px_45px_rgba(15,23,42,0.10)] backdrop-blur-xl">
              <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                <div>
                  <div className="text-base font-bold">{employeeName(item.employee_id)}</div>
                  <div className="mt-1 text-xs text-slate-500">{storeName(item.store_id)}</div>
                  <div className="mt-4 text-sm font-bold capitalize">{formatText(item.exception_type)}</div>
                  <div className="mt-1 text-sm text-slate-500">{item.description}</div>

                  <div className="mt-4 flex flex-wrap gap-2">
                    <Severity value={item.severity} />
                    <StatusPill value={item.status} />
                  </div>
                </div>

                <div className="flex flex-col gap-2 md:min-w-[190px]">
                  <button disabled={isClosed || updatingId === item.id} onClick={() => updateException(item.id, "approved")} className="rounded-2xl bg-emerald-600 px-4 py-3 text-sm font-bold text-white disabled:bg-slate-300 disabled:text-slate-500">
                    {updatingId === item.id ? "Updating..." : "Approve"}
                  </button>

                  <button disabled={isClosed || updatingId === item.id} onClick={() => updateException(item.id, "closed")} className="rounded-2xl bg-slate-950 px-4 py-3 text-sm font-bold text-white disabled:bg-slate-300 disabled:text-slate-500">
                    Close
                  </button>

                  <button disabled={updatingId === item.id} onClick={() => createHrCase(item)} className="rounded-2xl bg-blue-600 px-4 py-3 text-sm font-bold text-white disabled:bg-slate-300 disabled:text-slate-500">
                    Create HR Case
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </Panel>
  );
}

function HRCasesScreen({
  hrCases,
  employees,
  exceptions,
  onRefresh,
  companyId
}: {
  hrCases: HrCaseRow[];
  employees: EmployeeRow[];
  exceptions: ExceptionRow[];
  onRefresh: () => void;
  companyId: string;
}) {
  const [selectedCase, setSelectedCase] = useState<HrCaseRow | null>(null);
  const [manualCaseOpen, setManualCaseOpen] = useState(false);
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  function employeeName(id: string) {
    const employee = employees.find((item) => item.id === id);
    return employee ? `${employee.first_name} ${employee.last_name}` : "Unassigned employee";
  }

  function linkedException(id: string | null) {
    const found = exceptions.find((item) => item.id === id);
    return found ? formatText(found.exception_type) : "No linked exception";
  }

  function isLocked(caseItem: HrCaseRow) {
    return caseItem.status === "closed";
  }

  function needsResponse(caseItem: HrCaseRow) {
    return caseItem.employee_response_required === true;
  }

  async function updateHrCase(id: string, updates: Partial<HrCaseRow>) {
    setUpdatingId(id);

    const { error } = await supabase.from("hr_cases").update(updates).eq("id", id);

    if (error) {
      alert("ERROR: " + error.message);
      setUpdatingId(null);
      return;
    }

    setUpdatingId(null);
    onRefresh();
  }

  return (
    <>
      <ManualHrCaseModal
        open={manualCaseOpen}
        onClose={() => setManualCaseOpen(false)}
        onSaved={onRefresh}
        employees={employees}
        companyId={companyId}
      />

      <HrResponseModal
        open={!!selectedCase}
        onClose={() => setSelectedCase(null)}
        onSaved={onRefresh}
        hrCase={selectedCase}
        employeeName={selectedCase ? employeeName(selectedCase.employee_id) : ""}
      />

      <div className="mt-8 grid gap-8 xl:grid-cols-[1fr_0.7fr]">
        <Panel>
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div>
              <h2 className="text-2xl font-bold tracking-tight">Disciplinary Case Files</h2>
              <p className="mt-2 text-sm text-slate-500">
                Create HR cases, capture responses, validate warnings, and close cases correctly.
              </p>
            </div>

            <button
              onClick={() => setManualCaseOpen(true)}
              className="flex w-fit items-center gap-2 rounded-2xl bg-[#06101f] px-5 py-3 text-sm font-black text-cyan-300 shadow-lg shadow-cyan-950/15"
            >
              <Plus className="h-4 w-4" />
              New HR Case
            </button>
          </div>

          <div className="mt-6 space-y-4">
            {hrCases.length === 0 && (
              <div className="rounded-[2rem] border border-white/80 bg-white/90 p-5 shadow-[0_16px_45px_rgba(15,23,42,0.10)] backdrop-blur-xl text-sm text-slate-500">
                No HR cases yet. Create a case only when action is required. Click <span className="font-bold">New HR Case</span> to capture one manually.
              </div>
            )}

            {hrCases.map((caseItem) => {
              const locked = isLocked(caseItem);
              const requireResponse = needsResponse(caseItem);

              return (
                <div key={caseItem.id} className="rounded-[2rem] border border-white/80 bg-white/90 p-5 shadow-[0_16px_45px_rgba(15,23,42,0.10)] backdrop-blur-xl">
                  <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                    <div>
                      <div className="text-lg font-bold text-slate-950">{caseItem.title}</div>
                      <div className="mt-1 text-xs font-semibold text-slate-500">
                        {employeeName(caseItem.employee_id)} · {formatText(caseItem.case_type)}
                      </div>
                      <div className="mt-4 text-sm leading-6 text-slate-600">{caseItem.description}</div>

                      <div className="mt-4 grid gap-3 md:grid-cols-2">
                        <InfoBox label="Linked Evidence" value={linkedException(caseItem.linked_exception_id)} />
                        <InfoBox
                          label="Employee Response"
                          value={
                            caseItem.employee_response
                              ? "Captured"
                              : requireResponse
                              ? "Required"
                              : "Not required"
                          }
                        />
                      </div>

                      {caseItem.employee_response && (
                        <div className="mt-4 rounded-2xl border border-slate-200 bg-white p-4">
                          <div className="text-xs font-bold uppercase tracking-[0.2em] text-slate-400">Employee response</div>
                          <div className="mt-2 text-sm leading-6 text-slate-700">{caseItem.employee_response}</div>
                        </div>
                      )}
                    </div>

                    <div className="flex flex-col items-start gap-2 md:min-w-[220px] md:items-end">
                      <ValidityPill value={caseItem.validity_status} />
                      <StatusPill value={caseItem.status} />

                      <button
                        disabled={locked}
                        onClick={() => setSelectedCase(caseItem)}
                        className="mt-2 w-full rounded-2xl bg-slate-950 px-4 py-3 text-sm font-bold text-white disabled:bg-slate-300 disabled:text-slate-500"
                      >
                        {caseItem.employee_response ? "Edit Response" : "Capture Response"}
                      </button>

                      <button
                        disabled={locked || requireResponse || updatingId === caseItem.id}
                        onClick={() => updateHrCase(caseItem.id, { validity_status: "valid" })}
                        className="w-full rounded-2xl bg-emerald-600 px-4 py-3 text-sm font-bold text-white disabled:bg-slate-300 disabled:text-slate-500"
                      >
                        Mark Valid
                      </button>

                      <button
                        disabled={locked || requireResponse || updatingId === caseItem.id}
                        onClick={() => updateHrCase(caseItem.id, { validity_status: "risky" })}
                        className="w-full rounded-2xl bg-amber-500 px-4 py-3 text-sm font-bold text-white disabled:bg-slate-300 disabled:text-slate-500"
                      >
                        Mark Risky
                      </button>

                      <button
                        disabled={locked || requireResponse || updatingId === caseItem.id}
                        onClick={() => updateHrCase(caseItem.id, { validity_status: "invalid" })}
                        className="w-full rounded-2xl bg-rose-600 px-4 py-3 text-sm font-bold text-white disabled:bg-slate-300 disabled:text-slate-500"
                      >
                        Mark Invalid
                      </button>

                      <button
                        disabled={locked || requireResponse || updatingId === caseItem.id}
                        onClick={() => updateHrCase(caseItem.id, { status: "closed" })}
                        className="w-full rounded-2xl bg-black px-4 py-3 text-sm font-bold text-white disabled:bg-slate-300 disabled:text-slate-500"
                      >
                        Close Case
                      </button>

                      {requireResponse && !locked && (
                        <div className="mt-2 text-right text-xs font-semibold text-amber-600">
                          Response required before action
                        </div>
                      )}

                      {locked && (
                        <div className="mt-2 text-right text-xs font-semibold text-slate-500">
                          Case closed and locked
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </Panel>

        <Panel dark>
          <div className="text-xs font-bold uppercase tracking-[0.4em] text-cyan-300">Legal Protection Engine</div>
          <h2 className="mt-3 text-3xl font-bold">Before a warning is valid</h2>
          <div className="mt-6 space-y-3 text-sm text-slate-300">
            <div className="rounded-2xl bg-white/10 p-4">1. Rule must exist.</div>
            <div className="rounded-2xl bg-white/10 p-4">2. Employee must know the rule.</div>
            <div className="rounded-2xl bg-white/10 p-4">3. Evidence must exist.</div>
            <div className="rounded-2xl bg-white/10 p-4">4. Employee response must be captured.</div>
            <div className="rounded-2xl bg-white/10 p-4">5. Consistency across cases.</div>
          </div>
        </Panel>
      </div>
    </>
  );
}

function PayrollPrepScreen({
  payrollBatches,
  payrollHours,
  rosterShifts,
  clockEvents,
  exceptions,
  hrCases,
  employees,
  companyId,
  onRefresh
}: {
  payrollBatches: PayrollBatchRow[];
  payrollHours: PayrollHoursRow[];
  rosterShifts: RosterShiftRow[];
  clockEvents: ClockEventRow[];
  exceptions: ExceptionRow[];
  hrCases: HrCaseRow[];
  employees: EmployeeRow[];
  companyId: string;
  onRefresh: () => void;
}) {
  const [generating, setGenerating] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);
  const [updatingHourId, setUpdatingHourId] = useState<string | null>(null);

  const blockedExceptions = exceptions.filter((item) => item.status !== "closed" && item.status !== "approved").length;
  const hrBlocks = hrCases.filter(
    (item) =>
      item.status !== "closed" &&
      (item.employee_response_required === true ||
        item.validity_status === "risky" ||
        item.validity_status === "invalid" ||
        item.validity_status === "review_required")
  ).length;
  const readiness = Math.max(0, Math.min(100, 100 - blockedExceptions * 12 - hrBlocks * 15));
  const isReady = readiness === 100;

  const totalNormalHours = payrollHours.reduce((sum, item) => sum + Number(item.normal_hours || 0), 0);
  const totalOvertimeHours = payrollHours.reduce((sum, item) => sum + Number(item.overtime_hours || 0), 0);
  const totalLateMinutes = payrollHours.reduce((sum, item) => sum + Number(item.late_minutes || 0), 0);
  const totalMissingClockEvents = payrollHours.reduce((sum, item) => sum + Number(item.missing_clock_events || 0), 0);
  const approvedHoursCount = payrollHours.filter((item) => item.status === "approved").length;
  const exportedHoursCount = payrollHours.filter((item) => item.status === "exported" || Boolean(item.exported_at)).length;
  const reviewHoursCount = payrollHours.filter((item) => item.status !== "approved" && item.status !== "exported").length;
  const approvedUnexportedHours = payrollHours.filter((item) => item.status === "approved" && !item.exported_at);
  const canExportPayroll = isReady && approvedUnexportedHours.length > 0 && reviewHoursCount === 0;

  const periodStart = useMemo(() => {
    const date = new Date();
    return new Date(date.getFullYear(), date.getMonth(), 1).toISOString().slice(0, 10);
  }, []);

  const periodEnd = useMemo(() => {
    const date = new Date();
    return new Date(date.getFullYear(), date.getMonth() + 1, 0).toISOString().slice(0, 10);
  }, []);

  function employeeName(id: string) {
    const employee = employees.find((item) => item.id === id);
    return employee ? `${employee.first_name} ${employee.last_name}` : "Unknown employee";
  }

  function minutesBetween(start: string, end: string) {
    const startMs = new Date(start).getTime();
    const endMs = new Date(end).getTime();
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) return 0;
    return Math.round((endMs - startMs) / 60000);
  }

  function findShiftClockEvents(shift: RosterShiftRow) {
    const shiftDate = shift.shift_date;
    const shiftEvents = clockEvents
      .filter((event) => event.employee_id === shift.employee_id && event.event_time.slice(0, 10) === shiftDate)
      .sort((a, b) => new Date(a.event_time).getTime() - new Date(b.event_time).getTime());

    const firstClockIn = shiftEvents.find((event) => event.event_type === "clock_in") || null;
    const lastClockOut =
      [...shiftEvents].reverse().find((event) => event.event_type === "clock_out") || null;

    return { shiftEvents, firstClockIn, lastClockOut };
  }

  function buildAutoExceptionKey(exceptionType: string, employeeId: string, shiftId: string, companyId: string) {
    return `${companyId}:${employeeId}:${shiftId}:${exceptionType}`;
  }

  async function updatePayrollHourStatus(id: string, status: "approved" | "needs_review") {
    setUpdatingHourId(id);
    setGenerateError(null);

    const updates =
      status === "approved"
        ? {
            status,
            approved_at: new Date().toISOString(),
            approval_note: "Approved after manager review"
}
        : {
            status,
            approved_at: null,
            approval_note: "Sent back for payroll review"
};

    const { error } = await supabase
      .from("payroll_hours")
      .update(updates)
      .eq("id", id)
      .eq("company_id", companyId);

    if (error) {
      setGenerateError(error.message);
      setUpdatingHourId(null);
      return;
    }

    setUpdatingHourId(null);
    onRefresh();
  }

  async function approveAllCleanHours() {
    setUpdatingHourId("all");
    setGenerateError(null);

    const cleanIds = payrollHours
      .filter(
        (row) =>
          Number(row.late_minutes || 0) === 0 &&
          Number(row.missing_clock_events || 0) === 0 &&
          Number(row.overtime_hours || 0) === 0 &&
          row.status !== "approved"
      )
      .map((row) => row.id);

    if (cleanIds.length === 0) {
      setGenerateError("No clean payroll hour rows available to approve.");
      setUpdatingHourId(null);
      return;
    }

    const { error } = await supabase
      .from("payroll_hours")
      .update({
        status: "approved",
        approved_at: new Date().toISOString(),
        approval_note: "Bulk-approved clean payroll rows"
})
      .in("id", cleanIds)
      .eq("company_id", companyId);

    if (error) {
      setGenerateError(error.message);
      setUpdatingHourId(null);
      return;
    }

    setUpdatingHourId(null);
    onRefresh();
  }

  async function approveAllHoursAfterReview() {
    setUpdatingHourId("all");
    setGenerateError(null);

    const { error } = await supabase
      .from("payroll_hours")
      .update({
        status: "approved",
        approved_at: new Date().toISOString(),
        approval_note: "Approved after final payroll review"
})
      .eq("company_id", companyId)
      .eq("period_start", periodStart)
      .eq("period_end", periodEnd);

    if (error) {
      setGenerateError(error.message);
      setUpdatingHourId(null);
      return;
    }

    setUpdatingHourId(null);
    onRefresh();
  }

  async function exportApprovedPayrollCsv() {
    if (!canExportPayroll) {
      alert("Payroll export is blocked until all exceptions, HR cases and payroll hour rows are approved.");
      return;
    }

    const exportRows = approvedUnexportedHours;
    const header = ["Employee", "Period Start", "Period End", "Normal Hours", "Overtime Hours", "Late Minutes", "Missing Clock Events", "Status"];
    const lines = exportRows.map((row) => [
      employeeName(row.employee_id),
      row.period_start,
      row.period_end,
      Number(row.normal_hours || 0).toFixed(2),
      Number(row.overtime_hours || 0).toFixed(2),
      String(row.late_minutes || 0),
      String(row.missing_clock_events || 0),
      row.status,
    ]);

    const csv = [header, ...lines]
      .map((line) => line.map((value) => `"${String(value).replaceAll('"', '""')}"`).join(","))
      .join("\n");

    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `vyron-payroll-${periodStart}-to-${periodEnd}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    const exportBatchId = crypto.randomUUID();

    const { error: logError } = await supabase.from("payroll_export_logs").insert({
      id: exportBatchId,
      company_id: companyId,
      export_name: `Payroll CSV ${periodStart} to ${periodEnd}`,
      export_status: "exported",
      employee_count: exportRows.length,
      shift_count: rosterShifts.length,
      exception_blocks: blockedExceptions,
      hr_blocks: hrBlocks
});

    if (logError) {
      alert("Payroll CSV downloaded, but export log failed: " + logError.message);
      return;
    }

    const { error: markExportedError } = await supabase
      .from("payroll_hours")
      .update({
        status: "exported",
        exported_at: new Date().toISOString(),
        export_batch_id: exportBatchId
})
      .in("id", exportRows.map((row) => row.id))
      .eq("company_id", companyId);

    if (markExportedError) {
      alert("Payroll CSV downloaded, but locking exported hours failed: " + markExportedError.message);
      return;
    }

    alert(`${exportRows.length} approved payroll hour row(s) exported and locked.`);
    onRefresh();
  }

  async function generateHours() {
    setGenerating(true);
    setGenerateError(null);

    const { data: existingAutoExceptionRows, error: existingAutoError } = await supabase
      .from("time_exceptions")
      .select("exception_key,employee_id,roster_shift_id,exception_type")
      .eq("company_id", companyId)
      .eq("source", "auto");

    if (existingAutoError) {
      setGenerateError(existingAutoError.message);
      setGenerating(false);
      return;
    }

    const existingAutoKeys = new Set(
      (existingAutoExceptionRows || [])
        .map((item: any) =>
          item.exception_key ||
          (item.employee_id && item.roster_shift_id && item.exception_type
            ? buildAutoExceptionKey(item.exception_type, item.employee_id, item.roster_shift_id, companyId)
            : null)
        )
        .filter((key: string | null): key is string => Boolean(key))
    );

    const autoExceptions: Array<{
      company_id: string;
      employee_id: string;
      store_id: string | null;
      roster_shift_id: string | null;
      exception_type: string;
      severity: string;
      description: string;
      status: string;
      source: string;
      exception_key: string;
    }> = [];

    const autoExceptionShiftKeys = new Set<string>();

    function addAutoException({
      shift,
      exceptionType,
      severity,
      description
}: {
      shift: RosterShiftRow;
      exceptionType: string;
      severity: string;
      description: string;
    }) {
      const shiftKey = buildAutoExceptionKey(exceptionType, shift.employee_id, shift.id, companyId);

      if (autoExceptionShiftKeys.has(shiftKey)) return;
      if (existingAutoKeys.has(shiftKey)) return;

      autoExceptionShiftKeys.add(shiftKey);

      autoExceptions.push({
        company_id: companyId,
        employee_id: shift.employee_id,
        store_id: shift.store_id || null,
        roster_shift_id: shift.id,
        exception_type: exceptionType,
        severity,
        description,
        status: "open",
        source: "auto",
        exception_key: shiftKey
});
    }

    const rows = employees
      .filter((employee) => employee.active)
      .map((employee) => {
        const employeeEvents = clockEvents
          .filter((event) => employee.id === event.employee_id)
          .sort((a, b) => new Date(a.event_time).getTime() - new Date(b.event_time).getTime());

        let workedMinutes = 0;
        let missingClockEvents = 0;
        let lateMinutes = 0;

        const eventsByDate = employeeEvents.reduce<Record<string, ClockEventRow[]>>((acc, event) => {
          const key = event.event_time.slice(0, 10);
          if (!acc[key]) acc[key] = [];
          acc[key].push(event);
          return acc;
        }, {});

        Object.values(eventsByDate).forEach((events) => {
          let openClockIn: ClockEventRow | null = null;

          events.forEach((event) => {
            if (event.event_type === "clock_in") {
              openClockIn = event;
            }

            if (event.event_type === "clock_out" && openClockIn) {
              workedMinutes += minutesBetween(openClockIn.event_time, event.event_time);
              openClockIn = null;
            }
          });

          if (openClockIn) missingClockEvents += 1;
        });

        const employeeShifts = rosterShifts.filter((shift) => shift.employee_id === employee.id);

        employeeShifts.forEach((shift) => {
          const { firstClockIn, lastClockOut } = findShiftClockEvents(shift);
          const plannedMinutes = minutesBetween(shift.planned_start, shift.planned_end);
          const workedForShiftMinutes = firstClockIn && lastClockOut ? minutesBetween(firstClockIn.event_time, lastClockOut.event_time) : 0;

          if (!firstClockIn) {
            missingClockEvents += 1;
            addAutoException({
              shift,
              exceptionType: "missing_clock_in",
              severity: "high",
              description: `${employeeName(employee.id)} has no clock-in for planned shift on ${formatDate(shift.shift_date)}.`
});
          }

          if (!lastClockOut) {
            missingClockEvents += 1;
            addAutoException({
              shift,
              exceptionType: "missing_clock_out",
              severity: "high",
              description: `${employeeName(employee.id)} has no clock-out for planned shift on ${formatDate(shift.shift_date)}.`
});
          }

          if (firstClockIn) {
            const shiftLateMinutes = Math.max(0, minutesBetween(shift.planned_start, firstClockIn.event_time));
            lateMinutes += shiftLateMinutes;

            if (shiftLateMinutes > 5) {
              addAutoException({
                shift,
                exceptionType: "late_arrival",
                severity: shiftLateMinutes > 15 ? "medium" : "low",
                description: `${employeeName(employee.id)} clocked in ${shiftLateMinutes} minutes late on ${formatDate(shift.shift_date)}.`
});
            }
          }

          if (lastClockOut) {
            const earlyLeaveMinutes = Math.max(0, minutesBetween(lastClockOut.event_time, shift.planned_end));

            if (earlyLeaveMinutes > 5) {
              addAutoException({
                shift,
                exceptionType: "early_leave",
                severity: earlyLeaveMinutes > 15 ? "medium" : "low",
                description: `${employeeName(employee.id)} clocked out ${earlyLeaveMinutes} minutes before planned end on ${formatDate(shift.shift_date)}.`
});
            }
          }

          if (plannedMinutes > 0 && workedForShiftMinutes > plannedMinutes + 30) {
            const overtimeRiskMinutes = workedForShiftMinutes - plannedMinutes;

            addAutoException({
              shift,
              exceptionType: "overtime_risk",
              severity: overtimeRiskMinutes > 60 ? "high" : "medium",
              description: `${employeeName(employee.id)} worked ${overtimeRiskMinutes} minutes over planned shift on ${formatDate(shift.shift_date)}.`
});
          }
        });

        const workedHours = Number((workedMinutes / 60).toFixed(2));
        const normalCap = employeeShifts.length > 0 ? employeeShifts.length * 8 : workedHours;
        const normalHours = Math.min(workedHours, normalCap);
        const overtimeHours = Math.max(0, workedHours - normalHours);

        const hasProblem = missingClockEvents > 0 || lateMinutes > 0 || overtimeHours > 0;

        return {
          company_id: companyId,
          employee_id: employee.id,
          period_start: periodStart,
          period_end: periodEnd,
          normal_hours: Number(normalHours.toFixed(2)),
          overtime_hours: Number(overtimeHours.toFixed(2)),
          late_minutes: lateMinutes,
          missing_clock_events: missingClockEvents,
          status: hasProblem ? "needs_review" : "approved",
          approved_at: hasProblem ? null : new Date().toISOString(),
          approval_note: hasProblem
            ? "Generated with payroll risk and requires manager review"
            : "Auto-approved clean hours: no late minutes, missing clock events, or overtime risk",
          exported_at: null,
          export_batch_id: null
};
      });

    if (rows.length > 0) {
      const { error: upsertError } = await supabase.from("payroll_hours").upsert(rows, {
        onConflict: "company_id,employee_id,period_start,period_end"
});

      if (upsertError) {
        setGenerateError(upsertError.message);
        setGenerating(false);
        return;
      }
    }
    if (autoExceptions.length > 0) {
      const { error: exceptionInsertError } = await supabase
        .from("time_exceptions")
        .upsert(autoExceptions, {
          onConflict: "exception_key",
          ignoreDuplicates: true
});

      if (exceptionInsertError) {
        setGenerateError(exceptionInsertError.message);
        setGenerating(false);
        return;
      }
    }

    setGenerating(false);
    onRefresh();

    const autoApprovedCount = rows.filter((row) => row.status === "approved").length;
    const needsReviewCount = rows.filter((row) => row.status === "needs_review").length;

    if (autoExceptions.length > 0) {
      alert(`${autoExceptions.length} auto exception(s) created. ${autoApprovedCount} clean hour row(s) auto-approved and ${needsReviewCount} row(s) need review.`);
    } else {
      alert(`Hours generated. ${autoApprovedCount} clean hour row(s) auto-approved. ${needsReviewCount} row(s) need review.`);
    }
  }

  return (
    <div className="mt-8 grid gap-8 xl:grid-cols-[1fr_0.75fr]">
      <Panel>
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 className="text-2xl font-bold tracking-tight">Payroll Batch Readiness</h2>
            <p className="mt-2 text-sm text-slate-500">Generate payroll hours and automatically create exception records for missing clocks, late arrival, early leave and overtime risk.</p>
          </div>

          <div className="flex flex-col gap-3 md:flex-row">
            <button
              onClick={generateHours}
              disabled={generating}
              className="flex w-fit items-center gap-2 rounded-2xl bg-[#06101f] px-5 py-3 text-sm font-black text-cyan-300 shadow-lg shadow-cyan-950/15 disabled:bg-slate-300 disabled:text-slate-500"
            >
              <Clock3 className="h-4 w-4" />
              {generating ? "Scanning..." : "Generate Hours & Scan Exceptions"}
            </button>

            <button
              onClick={exportApprovedPayrollCsv}
              disabled={!canExportPayroll}
              className="flex w-fit items-center gap-2 rounded-2xl bg-blue-600 px-5 py-3 text-sm font-bold text-white disabled:bg-slate-300 disabled:text-slate-500"
            >
              <WalletCards className="h-4 w-4" />
              Export Approved Payroll CSV
            </button>
          </div>
        </div>

        {generateError && <div className="mt-4 rounded-2xl bg-rose-50 p-4 text-sm font-semibold text-rose-700">{generateError}</div>}

        <div className="mt-6 rounded-[2rem] border border-white/80 bg-white/90 p-5 shadow-[0_16px_45px_rgba(15,23,42,0.10)] backdrop-blur-xl">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-lg font-bold text-slate-950">Current Payroll Run</div>
              <div className="mt-1 text-sm text-slate-500">Period {periodStart} to {periodEnd}</div>
            </div>
            <StatusPill value={isReady ? "ready" : "exceptions_open"} />
          </div>

          <div className="mt-5 h-3 rounded-full bg-slate-200">
            <div className="h-3 rounded-full bg-gradient-to-r from-blue-600 to-cyan-400" style={{ width: `${readiness}%` }} />
          </div>

          <div className="mt-5 grid gap-3 md:grid-cols-4">
            <InfoBox label="Employees" value={String(employees.length)} />
            <InfoBox label="Shifts" value={String(rosterShifts.length)} />
            <InfoBox label="Exception Blocks" value={String(blockedExceptions)} />
            <InfoBox label="HR Blocks" value={String(hrBlocks)} />
          </div>

          <div className="mt-5 grid gap-3 md:grid-cols-4">
            <InfoBox label="Approved Rows" value={String(approvedHoursCount)} />
            <InfoBox label="Exported Rows" value={String(exportedHoursCount)} />
            <InfoBox label="Rows Needing Review" value={String(reviewHoursCount)} />
            <InfoBox label="Export Status" value={canExportPayroll ? "Ready to export" : "Blocked until approved"} />
          </div>
        </div>

        <div className="mt-6 grid gap-5 md:grid-cols-2 xl:grid-cols-4">
          <StatCard title="Normal hours" value={totalNormalHours.toFixed(2)} subtitle="Generated payroll-ready normal time" icon={<Clock3 className="h-6 w-6" />} />
          <StatCard title="Overtime hours" value={totalOvertimeHours.toFixed(2)} subtitle="Hours above planned normal time" icon={<Zap className="h-6 w-6" />} />
          <StatCard title="Late minutes" value={String(totalLateMinutes)} subtitle="Late arrivals from roster comparison" icon={<AlertTriangle className="h-6 w-6" />} />
          <StatCard title="Missing clocks" value={String(totalMissingClockEvents)} subtitle="Records needing payroll review" icon={<ShieldCheck className="h-6 w-6" />} />
        </div>

        <div className="mt-6 rounded-[26px] border border-slate-200 bg-white p-5">
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div>
              <div className="text-lg font-bold text-slate-950">Payroll Hours Review</div>
              <div className="mt-1 text-sm text-slate-500">Clean hours are auto-approved. Managers only review rows with late minutes, missing clocks or overtime risk.</div>
            </div>

            <div className="flex flex-col gap-2 md:flex-row">
              <button
                onClick={approveAllCleanHours}
                disabled={updatingHourId === "all" || payrollHours.length === 0}
                className="rounded-2xl bg-emerald-600 px-4 py-3 text-sm font-bold text-white disabled:bg-slate-300 disabled:text-slate-500"
              >
                Approve Remaining Clean Rows
              </button>

              <button
                onClick={approveAllHoursAfterReview}
                disabled={updatingHourId === "all" || payrollHours.length === 0 || blockedExceptions > 0 || hrBlocks > 0}
                className="rounded-2xl bg-slate-950 px-4 py-3 text-sm font-bold text-white disabled:bg-slate-300 disabled:text-slate-500"
              >
                Approve All Reviewed Rows
              </button>
            </div>
          </div>
        </div>

        <div className="mt-6 space-y-4">
          {payrollHours.length === 0 && (
            <div className="rounded-[2rem] border border-white/80 bg-white/90 p-5 shadow-[0_16px_45px_rgba(15,23,42,0.10)] backdrop-blur-xl text-sm text-slate-500">
              No generated payroll hours yet. Click <span className="font-bold">Generate Hours & Scan Exceptions</span> to calculate hours and detect payroll risk.
            </div>
          )}

          {[...payrollHours]
            .sort((a, b) => {
              const aNeedsReview = a.status !== "approved" && a.status !== "exported";
              const bNeedsReview = b.status !== "approved" && b.status !== "exported";
              if (aNeedsReview !== bNeedsReview) return aNeedsReview ? -1 : 1;
              return employeeName(a.employee_id).localeCompare(employeeName(b.employee_id));
            })
            .map((row) => {
            const rowExported = row.status === "exported" || Boolean(row.exported_at);
            const rowNeedsReview = Number(row.late_minutes || 0) > 0 || Number(row.missing_clock_events || 0) > 0 || Number(row.overtime_hours || 0) > 0 || (row.status !== "approved" && row.status !== "exported");

            return (
              <div key={row.id} className="rounded-[2rem] border border-white/80 bg-white/90 p-5 shadow-[0_16px_45px_rgba(15,23,42,0.10)] backdrop-blur-xl">
                <div className="grid gap-4 xl:grid-cols-[1fr_110px_110px_110px_120px_130px_160px] xl:items-center">
                  <div>
                    <div className="font-bold text-slate-950">{employeeName(row.employee_id)}</div>
                    <div className="mt-1 text-xs text-slate-500">{row.period_start} to {row.period_end}</div>
                    {row.approval_note && (
                      <div className="mt-2 text-xs font-semibold text-slate-500">{row.approval_note}</div>
                    )}
                    {rowExported && (
                      <div className="mt-2 text-xs font-semibold text-emerald-600">Exported and locked</div>
                    )}
                    {rowNeedsReview && row.status !== "approved" && row.status !== "exported" && (
                      <div className="mt-2 text-xs font-semibold text-amber-600">Review required before export</div>
                    )}
                  </div>

                  <InfoBox label="Normal" value={Number(row.normal_hours || 0).toFixed(2)} />
                  <InfoBox label="Overtime" value={Number(row.overtime_hours || 0).toFixed(2)} />
                  <InfoBox label="Late" value={`${row.late_minutes || 0}m`} />
                  <InfoBox label="Missing" value={String(row.missing_clock_events || 0)} />
                  <StatusPill value={row.status} />

                  <div className="flex flex-col gap-2">
                    <button
                      onClick={() => updatePayrollHourStatus(row.id, "approved")}
                      disabled={updatingHourId === row.id || blockedExceptions > 0 || hrBlocks > 0 || row.status === "approved" || rowExported}
                      className="rounded-2xl bg-emerald-600 px-4 py-3 text-sm font-bold text-white disabled:bg-slate-300 disabled:text-slate-500"
                    >
                      Approve Hours
                    </button>

                    <button
                      onClick={() => updatePayrollHourStatus(row.id, "needs_review")}
                      disabled={updatingHourId === row.id || rowExported}
                      className="rounded-2xl bg-amber-500 px-4 py-3 text-sm font-bold text-white disabled:bg-slate-300 disabled:text-slate-500"
                    >
                      Send to Review
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </Panel>

      <Panel dark>
        <div className="text-xs font-bold uppercase tracking-[0.4em] text-cyan-300">Hours Engine</div>
        <h2 className="mt-3 text-3xl font-bold">Payroll-grade time calculation</h2>
        <div className="mt-6 space-y-3 text-sm text-slate-300">
          <div className="rounded-2xl bg-white/10 p-4">1. Pair clock-in and clock-out events per employee.</div>
          <div className="rounded-2xl bg-white/10 p-4">2. Compare first clock-in against planned roster start.</div>
          <div className="rounded-2xl bg-white/10 p-4">3. Split worked time into normal and overtime hours.</div>
          <div className="rounded-2xl bg-white/10 p-4">4. Auto-create exceptions for missing clocks, late arrivals, early leave and overtime risk.</div>
          <div className="rounded-2xl bg-white/10 p-4">5. Require payroll hour approval before export.</div>
        </div>
      </Panel>
    </div>
  );
}


function ExecutiveReportsScreen({
  stores,
  employees,
  rosterShifts,
  clockEvents,
  exceptions,
  hrCases,
  payrollHours
}: {
  stores: StoreRow[];
  employees: EmployeeRow[];
  rosterShifts: RosterShiftRow[];
  clockEvents: ClockEventRow[];
  exceptions: ExceptionRow[];
  hrCases: HrCaseRow[];
  payrollHours: PayrollHoursRow[];
}) {
  const activeEmployees = employees.filter((employee) => employee.active).length;
  const openExceptions = exceptions.filter((item) => item.status !== "closed" && item.status !== "approved").length;
  const openHrCases = hrCases.filter((item) => item.status !== "closed").length;
  const approvedHours = payrollHours.filter((item) => item.status === "approved" || item.status === "exported").length;
  const problemHours = payrollHours.filter((item) => item.status === "needs_review" || item.missing_clock_events > 0 || item.late_minutes > 0 || item.overtime_hours > 0).length;
  const totalNormalHours = payrollHours.reduce((sum, item) => sum + safeNumber(item.normal_hours), 0);
  const totalOvertimeHours = payrollHours.reduce((sum, item) => sum + safeNumber(item.overtime_hours), 0);
  const payrollReadiness = percentSafe(approvedHours, payrollHours.length);
  const riskScore = Math.max(0, 100 - openExceptions * 8 - openHrCases * 10 - problemHours * 12);

  const storeExceptionMap = stores.map((store) => {
    const count = exceptions.filter((item) => item.store_id === store.id && item.status !== "closed" && item.status !== "approved").length;
    return { store, count };
  }).sort((a, b) => b.count - a.count);

  const employeeRiskMap = employees.map((employee) => {
    const exceptionCount = exceptions.filter((item) => item.employee_id === employee.id && item.status !== "closed" && item.status !== "approved").length;
    const hrCount = hrCases.filter((item) => item.employee_id === employee.id && item.status !== "closed").length;
    return { employee, score: exceptionCount + hrCount, exceptionCount, hrCount };
  }).filter((item) => item.score > 0).sort((a, b) => b.score - a.score);

  return (
    <div className="mt-8 space-y-8">
      <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-4">
        <StatCard title="Risk score" value={`${riskScore}%`} subtitle={`${riskWord(openExceptions + openHrCases + problemHours)} operating position`} icon={<ShieldCheck className="h-6 w-6" />} />
        <StatCard title="Payroll readiness" value={`${payrollReadiness}%`} subtitle={`${approvedHours}/${payrollHours.length} hour rows approved`} icon={<WalletCards className="h-6 w-6" />} />
        <StatCard title="Open issues" value={String(openExceptions + openHrCases)} subtitle="Exceptions + HR cases" icon={<AlertTriangle className="h-6 w-6" />} />
        <StatCard title="Clock events" value={String(clockEvents.length)} subtitle="Live operational records" icon={<Clock3 className="h-6 w-6" />} />
      </div>

      <div className="grid gap-8 xl:grid-cols-[1.15fr_0.85fr]">
        <Panel>
          <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
            <div>
              <div className="text-xs font-bold uppercase tracking-[0.35em] text-cyan-700">Executive View</div>
              <h2 className="mt-2 text-2xl font-bold tracking-tight">Company Workforce Snapshot</h2>
              <p className="mt-2 text-sm text-slate-500">Boardroom-ready summary of staff, payroll readiness, clocking evidence and unresolved risk.</p>
            </div>
            <StatusPill value={riskScore >= 85 ? "ready" : "needs_review"} />
          </div>

          <div className="mt-6 grid gap-4 md:grid-cols-3">
            <InfoBox label="Stores" value={String(stores.length)} />
            <InfoBox label="Active Staff" value={String(activeEmployees)} />
            <InfoBox label="Roster Shifts" value={String(rosterShifts.length)} />
            <InfoBox label="Normal Hours" value={totalNormalHours.toFixed(2)} />
            <InfoBox label="Overtime Hours" value={totalOvertimeHours.toFixed(2)} />
            <InfoBox label="Problem Hours" value={String(problemHours)} />
          </div>

          <div className="mt-6 rounded-2xl bg-white/80 shadow-sm backdrop-blur-xl p-5">
            <div className="text-sm font-black text-slate-950">Demo talking point</div>
            <p className="mt-2 text-sm leading-6 text-slate-600">
              VYRON CORE does not just record clocking. It turns clocking into payroll control, exception workflow, HR protection and management visibility.
            </p>
          </div>
        </Panel>

        <Panel dark>
          <div className="text-xs font-bold uppercase tracking-[0.4em] text-cyan-300">Client Demo Script</div>
          <h2 className="mt-3 text-3xl font-bold">What to show first</h2>
          <div className="mt-6 space-y-3 text-sm text-slate-300">
            <div className="rounded-2xl bg-white/10 p-4">1. Staff Clocking: show how easy daily use feels.</div>
            <div className="rounded-2xl bg-white/10 p-4">2. Payroll Prep: show blocked vs ready payroll.</div>
            <div className="rounded-2xl bg-white/10 p-4">3. Exceptions: show how problems are controlled.</div>
            <div className="rounded-2xl bg-white/10 p-4">4. HR Cases: show legal/process protection.</div>
          </div>
        </Panel>
      </div>

      <div className="grid gap-8 xl:grid-cols-2">
        <Panel>
          <h2 className="text-2xl font-bold tracking-tight">Store Risk Ranking</h2>
          <p className="mt-2 text-sm text-slate-500">Shows where managers should focus first.</p>
          <div className="mt-5 space-y-3">
            {storeExceptionMap.length === 0 && <div className="rounded-2xl bg-white/80 shadow-sm backdrop-blur-xl p-4 text-sm text-slate-500">No stores loaded yet.</div>}
            {storeExceptionMap.map(({ store, count }) => (
              <div key={store.id} className="flex items-center justify-between rounded-2xl border border-white/80 bg-white/80 shadow-sm backdrop-blur-xl p-4">
                <div>
                  <div className="font-black text-slate-950">{store.name}</div>
                  <div className="mt-1 text-xs text-slate-500">{store.city || "No city"} · {store.region || "No region"}</div>
                </div>
                <div className={count > 0 ? "text-lg font-black text-rose-600" : "text-lg font-black text-emerald-600"}>{count}</div>
              </div>
            ))}
          </div>
        </Panel>

        <Panel>
          <h2 className="text-2xl font-bold tracking-tight">People Risk Watchlist</h2>
          <p className="mt-2 text-sm text-slate-500">Only employees with unresolved issues appear here.</p>
          <div className="mt-5 space-y-3">
            {employeeRiskMap.length === 0 && <div className="rounded-2xl bg-emerald-50 p-4 text-sm font-bold text-emerald-700">No staff risk currently open.</div>}
            {employeeRiskMap.map(({ employee, exceptionCount, hrCount }) => (
              <div key={employee.id} className="flex items-center justify-between rounded-2xl border border-white/80 bg-white/80 shadow-sm backdrop-blur-xl p-4">
                <div>
                  <div className="font-black text-slate-950">{employee.first_name} {employee.last_name}</div>
                  <div className="mt-1 text-xs text-slate-500">{employee.employee_number || "No employee number"} · {employee.job_title || "No role"}</div>
                </div>
                <div className="text-right text-xs font-bold text-slate-500">
                  <div>{exceptionCount} exceptions</div>
                  <div>{hrCount} HR cases</div>
                </div>
              </div>
            ))}
          </div>
        </Panel>
      </div>
    </div>
  );
}

function LaunchChecklistScreen({
  stores,
  employees,
  rosterShifts,
  clockEvents,
  exceptions,
  hrCases,
  payrollHours,
  userRoles
}: {
  stores: StoreRow[];
  employees: EmployeeRow[];
  rosterShifts: RosterShiftRow[];
  clockEvents: ClockEventRow[];
  exceptions: ExceptionRow[];
  hrCases: HrCaseRow[];
  payrollHours: PayrollHoursRow[];
  userRoles: UserRoleRow[];
}) {
  const checks = [
    { label: "Company has stores", done: stores.length > 0, detail: `${stores.length} stores loaded` },
    { label: "Employees loaded", done: employees.length > 0, detail: `${employees.length} employees loaded` },
    { label: "Rosters created", done: rosterShifts.length > 0, detail: `${rosterShifts.length} shifts loaded` },
    { label: "Clocking records exist", done: clockEvents.length > 0, detail: `${clockEvents.length} clock events` },
    { label: "Payroll hours generated", done: payrollHours.length > 0, detail: `${payrollHours.length} payroll rows` },
    { label: "No open exceptions", done: exceptions.filter((item) => item.status !== "closed" && item.status !== "approved").length === 0, detail: "Exceptions cleared before export" },
    { label: "No open HR cases", done: hrCases.filter((item) => item.status !== "closed").length === 0, detail: "HR cases closed before payroll" },
    { label: "Roles configured", done: userRoles.length > 0, detail: `${userRoles.length} role records` },
  ];

  const completed = checks.filter((item) => item.done).length;
  const readiness = percentSafe(completed, checks.length);

  return (
    <div className="mt-8 grid gap-8 xl:grid-cols-[1fr_0.75fr]">
      <Panel>
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div>
            <div className="text-xs font-bold uppercase tracking-[0.35em] text-cyan-700">V1 Launch Control</div>
            <h2 className="mt-2 text-2xl font-bold tracking-tight">Client Readiness Checklist</h2>
            <p className="mt-2 text-sm text-slate-500">Use this before demo calls or first pilot onboarding.</p>
          </div>
          <div className="rounded-2xl bg-slate-950 px-5 py-3 text-sm font-black text-white">{readiness}% Ready</div>
        </div>

        <div className="mt-6 h-3 rounded-full bg-slate-200">
          <div className="h-3 rounded-full bg-gradient-to-r from-blue-600 to-cyan-400" style={{ width: `${readiness}%` }} />
        </div>

        <div className="mt-6 space-y-3">
          {checks.map((check) => (
            <div key={check.label} className="flex items-center justify-between rounded-2xl border border-white/80 bg-white/80 shadow-sm backdrop-blur-xl p-4">
              <div>
                <div className="font-black text-slate-950">{check.label}</div>
                <div className="mt-1 text-xs text-slate-500">{check.detail}</div>
              </div>
              <StatusPill value={check.done ? "ready" : "needs_review"} />
            </div>
          ))}
        </div>
      </Panel>

      <Panel dark>
        <div className="text-xs font-bold uppercase tracking-[0.4em] text-cyan-300">Launch Focus</div>
        <h2 className="mt-3 text-3xl font-bold">What still matters</h2>
        <div className="mt-6 space-y-3 text-sm text-slate-300">
          <div className="rounded-2xl bg-white/10 p-4">1. Make daily clocking effortless.</div>
          <div className="rounded-2xl bg-white/10 p-4">2. Make payroll export feel safe.</div>
          <div className="rounded-2xl bg-white/10 p-4">3. Make exceptions impossible to ignore.</div>
          <div className="rounded-2xl bg-white/10 p-4">4. Make reports look like management control.</div>
          <div className="rounded-2xl bg-white/10 p-4">5. Keep setup under 15 minutes for pilots.</div>
        </div>
      </Panel>
    </div>
  );
}


function V1ControlScreen({
  stores,
  employees,
  rosterShifts,
  clockEvents,
  exceptions,
  hrCases,
  payrollHours,
  userRoles,
  companyId,
  onRefresh
}: {
  stores: StoreRow[];
  employees: EmployeeRow[];
  rosterShifts: RosterShiftRow[];
  clockEvents: ClockEventRow[];
  exceptions: ExceptionRow[];
  hrCases: HrCaseRow[];
  payrollHours: PayrollHoursRow[];
  userRoles: UserRoleRow[];
  companyId: string;
  onRefresh: () => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const openExceptions = exceptions.filter((item) => item.status !== "closed" && item.status !== "approved");
  const openHrCases = hrCases.filter((item) => item.status !== "closed");
  const problemHours = payrollHours.filter(
    (item) =>
      item.status === "needs_review" ||
      safeNumber(item.missing_clock_events) > 0 ||
      safeNumber(item.late_minutes) > 0 ||
      safeNumber(item.overtime_hours) > 0
  );
  const cleanDraftHours = payrollHours.filter(
    (item) =>
      item.status !== "approved" &&
      item.status !== "exported" &&
      safeNumber(item.missing_clock_events) === 0 &&
      safeNumber(item.late_minutes) === 0 &&
      safeNumber(item.overtime_hours) === 0
  );
  const approvedHours = payrollHours.filter((item) => item.status === "approved" || item.status === "exported");

  const checks = [
    { name: "Stores loaded", passed: stores.length > 0, value: stores.length },
    { name: "Employees loaded", passed: employees.length > 0, value: employees.length },
    { name: "Rosters created", passed: rosterShifts.length > 0, value: rosterShifts.length },
    { name: "Clock events captured", passed: clockEvents.length > 0, value: clockEvents.length },
    { name: "Payroll hours generated", passed: payrollHours.length > 0, value: payrollHours.length },
    { name: "No open exceptions", passed: openExceptions.length === 0, value: openExceptions.length },
    { name: "No open HR cases", passed: openHrCases.length === 0, value: openHrCases.length },
    { name: "No problem payroll rows", passed: problemHours.length === 0, value: problemHours.length },
    { name: "Approved payroll exists", passed: approvedHours.length > 0, value: approvedHours.length },
    { name: "Roles configured", passed: userRoles.length > 0, value: userRoles.length },
  ];

  const readyCount = checks.filter((item) => item.passed).length;
  const readiness = percentSafe(readyCount, checks.length);

  async function approveAllCleanHours() {
    if (cleanDraftHours.length === 0) {
      alert("No clean draft payroll rows to approve.");
      return;
    }

    setBusy("approve-clean");

    const { error } = await supabase
      .from("payroll_hours")
      .update({
        status: "approved",
        approved_at: new Date().toISOString(),
        approval_note: "Approved from V1 Control clean-hours action"
})
      .in("id", cleanDraftHours.map((item) => item.id));

    setBusy(null);

    if (error) {
      alert("Approve clean hours failed: " + error.message);
      return;
    }

    onRefresh();
  }

  async function closeApprovedExceptions() {
    const approvedExceptions = exceptions.filter((item) => item.status === "approved");

    if (approvedExceptions.length === 0) {
      alert("No approved exceptions to close.");
      return;
    }

    setBusy("close-exceptions");

    const { error } = await supabase
      .from("time_exceptions")
      .update({
        status: "closed",
        resolved_at: new Date().toISOString()
})
      .in("id", approvedExceptions.map((item) => item.id));

    setBusy(null);

    if (error) {
      alert("Close approved exceptions failed: " + error.message);
      return;
    }

    onRefresh();
  }

  function downloadReadinessReport() {
    const lines = [
      "VYRON CORE V1 READINESS REPORT",
      `Generated: ${new Date().toLocaleString("en-ZA")}`,
      `Company ID: ${companyId}`,
      "",
      `Readiness: ${readiness}%`,
      "",
      "CHECKS",
      ...checks.map((check) => `${check.passed ? "PASS" : "BLOCK"} - ${check.name}: ${check.value}`),
      "",
      "SUMMARY",
      `Stores: ${stores.length}`,
      `Employees: ${employees.length}`,
      `Roster shifts: ${rosterShifts.length}`,
      `Clock events: ${clockEvents.length}`,
      `Payroll rows: ${payrollHours.length}`,
      `Open exceptions: ${openExceptions.length}`,
      `Open HR cases: ${openHrCases.length}`,
      `Problem payroll rows: ${problemHours.length}`,
      `Approved/exported payroll rows: ${approvedHours.length}`,
    ];

    downloadTextFile(`vyron-core-v1-readiness-${new Date().toISOString().slice(0, 10)}.txt`, lines.join("\\n"));
  }

  function downloadEmployeeCsv() {
    const header = ["Employee ID", "Employee Number", "First Name", "Last Name", "Job Title", "Active", "Email", "Phone"];
    const rows = employees.map((employee) => [
      employee.id,
      employee.employee_number || "",
      employee.first_name,
      employee.last_name,
      employee.job_title || "",
      employee.active ? "Yes" : "No",
      employee.email || "",
      employee.phone || "",
    ]);

    const csv = [header, ...rows].map((row) => row.map(csvEscape).join(",")).join("\\n");
    downloadTextFile(`vyron-core-employees-${new Date().toISOString().slice(0, 10)}.csv`, csv, "text/csv;charset=utf-8");
  }

  function downloadPayrollProblemsCsv() {
    const header = ["Payroll Row ID", "Employee ID", "Period Start", "Period End", "Normal Hours", "Overtime Hours", "Late Minutes", "Missing Clock Events", "Status"];
    const rows = problemHours.map((item) => [
      item.id,
      item.employee_id,
      item.period_start,
      item.period_end,
      formatHours(item.normal_hours),
      formatHours(item.overtime_hours),
      item.late_minutes,
      item.missing_clock_events,
      item.status,
    ]);

    const csv = [header, ...rows].map((row) => row.map(csvEscape).join(",")).join("\\n");
    downloadTextFile(`vyron-core-payroll-problems-${new Date().toISOString().slice(0, 10)}.csv`, csv, "text/csv;charset=utf-8");
  }

  function downloadOpenIssuesCsv() {
    const header = ["Type", "ID", "Employee ID", "Status", "Title / Exception Type", "Description"];
    const exceptionRows = openExceptions.map((item) => [
      "Exception",
      item.id,
      item.employee_id,
      item.status,
      item.exception_type,
      item.description,
    ]);
    const hrRows = openHrCases.map((item) => [
      "HR Case",
      item.id,
      item.employee_id,
      item.status,
      item.title,
      item.description,
    ]);

    const csv = [header, ...exceptionRows, ...hrRows].map((row) => row.map(csvEscape).join(",")).join("\\n");
    downloadTextFile(`vyron-core-open-issues-${new Date().toISOString().slice(0, 10)}.csv`, csv, "text/csv;charset=utf-8");
  }

  async function copyDemoSummary() {
    const summary = [
      `VYRON CORE demo status: ${readiness}% ready`,
      `${employees.length} employees, ${stores.length} stores, ${rosterShifts.length} roster shifts`,
      `${clockEvents.length} clock events captured`,
      `${openExceptions.length} open exceptions, ${openHrCases.length} open HR cases`,
      `${payrollHours.length} payroll rows, ${problemHours.length} problem rows, ${approvedHours.length} approved/exported rows`,
    ].join("\\n");

    try {
      await navigator.clipboard.writeText(summary);
      alert("Demo summary copied.");
    } catch {
      alert(summary);
    }
  }

  return (
    <div className="mt-8 space-y-8">
      <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-4">
        <StatCard title="V1 readiness" value={`${readiness}%`} subtitle={`${readyCount}/${checks.length} launch checks passed`} icon={<ShieldCheck className="h-6 w-6" />} />
        <StatCard title="Open blockers" value={String(openExceptions.length + openHrCases.length + problemHours.length)} subtitle="Must be cleared before launch" icon={<AlertTriangle className="h-6 w-6" />} />
        <StatCard title="Approved payroll" value={String(approvedHours.length)} subtitle="Ready/exported rows" icon={<WalletCards className="h-6 w-6" />} />
        <StatCard title="Clean draft rows" value={String(cleanDraftHours.length)} subtitle="Can be approved in one click" icon={<CheckCircle2 className="h-6 w-6" />} />
      </div>

      <div className="grid gap-8 xl:grid-cols-[1fr_0.8fr]">
        <Panel>
          <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
            <div>
              <div className="text-xs font-bold uppercase tracking-[0.35em] text-cyan-700">V1 Control</div>
              <h2 className="mt-2 text-2xl font-bold tracking-tight">Market-Ready Control Panel</h2>
              <p className="mt-2 text-sm text-slate-500">One place to clear blockers, export pilot data and prepare the first client demo.</p>
            </div>
            <StatusPill value={readiness >= 90 ? "ready" : "needs_review"} />
          </div>

          <div className="mt-6 h-3 rounded-full bg-slate-200">
            <div className="h-3 rounded-full bg-gradient-to-r from-blue-600 to-cyan-400" style={{ width: `${readiness}%` }} />
          </div>

          <div className="mt-6 grid gap-3 md:grid-cols-2">
            {checks.map((check) => (
              <div key={check.name} className="flex items-center justify-between rounded-2xl border border-white/80 bg-white/80 shadow-sm backdrop-blur-xl p-4">
                <div>
                  <div className="font-black text-slate-950">{check.name}</div>
                  <div className="mt-1 text-xs text-slate-500">Current value: {check.value}</div>
                </div>
                <StatusPill value={check.passed ? "ready" : "needs_review"} />
              </div>
            ))}
          </div>
        </Panel>

        <Panel dark>
          <div className="text-xs font-bold uppercase tracking-[0.4em] text-cyan-300">Fast Actions</div>
          <h2 className="mt-3 text-3xl font-bold">Finish V1 faster</h2>
          <div className="mt-6 grid gap-3">
            <button disabled={busy === "approve-clean"} onClick={approveAllCleanHours} className="rounded-2xl bg-emerald-500 px-5 py-3 text-sm font-black text-white disabled:opacity-60">
              {busy === "approve-clean" ? "Approving..." : "Approve All Clean Hours"}
            </button>
            <button disabled={busy === "close-exceptions"} onClick={closeApprovedExceptions} className="rounded-2xl bg-cyan-500 px-5 py-3 text-sm font-black text-white disabled:opacity-60">
              {busy === "close-exceptions" ? "Closing..." : "Close Approved Exceptions"}
            </button>
            <button onClick={downloadReadinessReport} className="rounded-2xl bg-white px-5 py-3 text-sm font-black text-slate-950">
              Download Readiness Report
            </button>
            <button onClick={downloadEmployeeCsv} className="rounded-2xl bg-white/10 px-5 py-3 text-sm font-black text-white">
              Download Employee CSV
            </button>
            <button onClick={downloadPayrollProblemsCsv} className="rounded-2xl bg-white/10 px-5 py-3 text-sm font-black text-white">
              Download Payroll Problems CSV
            </button>
            <button onClick={downloadOpenIssuesCsv} className="rounded-2xl bg-white/10 px-5 py-3 text-sm font-black text-white">
              Download Open Issues CSV
            </button>
            <button onClick={copyDemoSummary} className="rounded-2xl bg-cyan-400 px-5 py-3 text-sm font-black text-slate-950">
              Copy Demo Summary
            </button>
          </div>
        </Panel>
      </div>
    </div>
  );
}


function ClientOnboardingScreen({
  stores,
  employees,
  rosterShifts,
  companyId,
  onRefresh
}: {
  stores: StoreRow[];
  employees: EmployeeRow[];
  rosterShifts: RosterShiftRow[];
  companyId: string;
  onRefresh: () => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);

  const onboardingSteps = [
    {
      title: "1. Company created",
      done: !!companyId,
      detail: "Company record is active and linked to the logged-in user."
},
    {
      title: "2. Stores loaded",
      done: stores.length > 0,
      detail: `${stores.length} store(s) available for clocking and roster planning.`
},
    {
      title: "3. Employees loaded",
      done: employees.length > 0,
      detail: `${employees.length} employee(s) available for shifts and payroll.`
},
    {
      title: "4. Roster started",
      done: rosterShifts.length > 0,
      detail: `${rosterShifts.length} shift(s) created.`
},
    {
      title: "5. Payroll-ready",
      done: stores.length > 0 && employees.length > 0 && rosterShifts.length > 0,
      detail: "Client can start clocking, scanning exceptions and generating payroll."
},
  ];

  const completed = onboardingSteps.filter((step) => step.done).length;
  const readiness = percentSafe(completed, onboardingSteps.length);

  async function addDemoStoreIfNeeded() {
    setBusy("store");

    const { error } = await supabase.from("stores").insert({
      company_id: companyId,
      name: "Demo Store - Main Counter",
      city: "Cape Town",
      region: "Western Cape",
      status: "active",
      address: "Demo location",
      opening_time: "08:00",
      closing_time: "17:00",
      gps_radius_meters: 150
});

    setBusy(null);

    if (error) {
      alert("Demo store error: " + error.message);
      return;
    }

    onRefresh();
  }

  async function addDemoEmployeeIfNeeded() {
    setBusy("employee");

    const { error } = await supabase.from("employees").insert({
      company_id: companyId,
      employee_number: `DEMO-${String(employees.length + 1).padStart(3, "0")}`,
      first_name: "Demo",
      last_name: `Employee ${employees.length + 1}`,
      job_title: "Counter Assistant",
      active: true,
      employment_type: "permanent"
});

    setBusy(null);

    if (error) {
      alert("Demo employee error: " + error.message);
      return;
    }

    onRefresh();
  }

  async function createDemoShift() {
    if (stores.length === 0 || employees.length === 0) {
      alert("Create at least one store and one employee first.");
      return;
    }

    setBusy("shift");

    const today = new Date().toISOString().slice(0, 10);

    const { error } = await supabase.from("roster_shifts").insert({
      company_id: companyId,
      employee_id: employees[0].id,
      store_id: stores[0].id,
      shift_date: today,
      planned_start: toShiftDateTime(today, "08:00"),
      planned_end: toShiftDateTime(today, "17:00"),
      role: employees[0].job_title || "Counter Assistant",
      status: "scheduled"
});

    setBusy(null);

    if (error) {
      alert("Demo shift error: " + error.message);
      return;
    }

    onRefresh();
  }

  function downloadOnboardingPlan() {
    const lines = [
      "VYRON CORE CLIENT ONBOARDING PLAN",
      `Generated: ${new Date().toLocaleString("en-ZA")}`,
      `Company ID: ${companyId}`,
      "",
      `Onboarding readiness: ${readiness}%`,
      "",
      ...onboardingSteps.map((step) => `${step.done ? "DONE" : "TODO"} - ${step.title}: ${step.detail}`),
      "",
      "RECOMMENDED PILOT SETUP",
      "1. Add all stores/counters.",
      "2. Add active employees only.",
      "3. Build one week of rosters.",
      "4. Let staff clock for 3 days.",
      "5. Generate payroll hours.",
      "6. Review exceptions.",
      "7. Export payroll CSV.",
    ];

    downloadTextFile(`vyron-core-client-onboarding-${new Date().toISOString().slice(0, 10)}.txt`, lines.join("\n"));
  }

  return (
    <div className="mt-8 grid gap-8 xl:grid-cols-[1fr_0.8fr]">
      <Panel>
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div>
            <div className="text-xs font-bold uppercase tracking-[0.35em] text-cyan-700">Client Onboarding</div>
            <h2 className="mt-2 text-2xl font-bold tracking-tight">15-Minute Pilot Setup</h2>
            <p className="mt-2 text-sm text-slate-500">
              A guided setup screen to make first-client onboarding fast, controlled and demo-ready.
            </p>
          </div>
          <div className="rounded-2xl bg-slate-950 px-5 py-3 text-sm font-black text-white">{readiness}% Ready</div>
        </div>

        <div className="mt-6 h-3 rounded-full bg-slate-200">
          <div className="h-3 rounded-full bg-gradient-to-r from-blue-600 to-cyan-400" style={{ width: `${readiness}%` }} />
        </div>

        <div className="mt-6 space-y-3">
          {onboardingSteps.map((step) => (
            <div key={step.title} className="flex items-center justify-between rounded-2xl border border-white/80 bg-white/80 shadow-sm backdrop-blur-xl p-4">
              <div>
                <div className="font-black text-slate-950">{step.title}</div>
                <div className="mt-1 text-xs text-slate-500">{step.detail}</div>
              </div>
              <StatusPill value={step.done ? "ready" : "needs_review"} />
            </div>
          ))}
        </div>
      </Panel>

      <Panel dark>
        <div className="text-xs font-bold uppercase tracking-[0.4em] text-cyan-300">Fast Setup Actions</div>
        <h2 className="mt-3 text-3xl font-bold">Get a pilot running</h2>
        <div className="mt-6 grid gap-3">
          <button disabled={busy === "store"} onClick={addDemoStoreIfNeeded} className="rounded-2xl bg-cyan-500 px-5 py-3 text-sm font-black text-white disabled:opacity-60">
            {busy === "store" ? "Adding..." : "Add Demo Store"}
          </button>
          <button disabled={busy === "employee"} onClick={addDemoEmployeeIfNeeded} className="rounded-2xl bg-emerald-500 px-5 py-3 text-sm font-black text-white disabled:opacity-60">
            {busy === "employee" ? "Adding..." : "Add Demo Employee"}
          </button>
          <button disabled={busy === "shift"} onClick={createDemoShift} className="rounded-2xl bg-amber-500 px-5 py-3 text-sm font-black text-white disabled:opacity-60">
            {busy === "shift" ? "Creating..." : "Create Demo Shift"}
          </button>
          <button onClick={downloadOnboardingPlan} className="rounded-2xl bg-white px-5 py-3 text-sm font-black text-slate-950">
            Download Onboarding Plan
          </button>
        </div>

        <div className="mt-6 space-y-3 text-sm text-slate-300">
          <div className="rounded-2xl bg-white/10 p-4">Designed for first sales demos and pilot launches.</div>
          <div className="rounded-2xl bg-white/10 p-4">Keeps setup simple: company → stores → staff → roster → clocking.</div>
          <div className="rounded-2xl bg-white/10 p-4">Next: CSV import for bulk employees and stores.</div>
        </div>
      </Panel>
    </div>
  );
}


function LiveActivityScreen({
  clockEvents,
  exceptions,
  hrCases,
  employees,
  stores
}: {
  clockEvents: ClockEventRow[];
  exceptions: ExceptionRow[];
  hrCases: HrCaseRow[];
  employees: EmployeeRow[];
  stores: StoreRow[];
}) {
  function employeeName(id: string) {
    const employee = employees.find((item) => item.id === id);
    return employee ? `${employee.first_name} ${employee.last_name}` : "Unknown employee";
  }

  function storeName(id: string | null) {
    const store = stores.find((item) => item.id === id);
    return store ? store.name : "No store";
  }

  const activities = [
    ...clockEvents.slice(0, 12).map((event) => ({
      id: `clock-${event.id}`,
      type: "Clocking",
      title: `${employeeName(event.employee_id)} · ${formatText(event.event_type)}`,
      detail: `${storeName(event.store_id)} · ${formatTime(event.event_time)} · ${event.source}`,
      risk: event.event_type === "clock_in" || event.event_type === "clock_out" ? "normal" : "watch"
})),
    ...exceptions.slice(0, 8).map((item) => ({
      id: `exception-${item.id}`,
      type: "Exception",
      title: `${employeeName(item.employee_id)} · ${formatText(item.exception_type)}`,
      detail: `${item.status} · ${item.description}`,
      risk: item.status === "closed" || item.status === "approved" ? "normal" : "high"
})),
    ...hrCases.slice(0, 8).map((item) => ({
      id: `hr-${item.id}`,
      type: "HR",
      title: `${employeeName(item.employee_id)} · ${item.title}`,
      detail: `${item.status} · ${formatText(item.validity_status)}`,
      risk: item.status === "closed" ? "normal" : "high"
})),
  ].slice(0, 24);

  const openExceptions = exceptions.filter((item) => item.status !== "closed" && item.status !== "approved").length;
  const openHrCases = hrCases.filter((item) => item.status !== "closed").length;
  const todaysClockEvents = clockEvents.filter((event) => event.event_time?.slice(0, 10) === new Date().toISOString().slice(0, 10)).length;

  return (
    <div className="mt-8 grid gap-8 xl:grid-cols-[1fr_0.75fr]">
      <Panel>
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div>
            <div className="text-xs font-bold uppercase tracking-[0.35em] text-cyan-700">Live Ops Feed</div>
            <h2 className="mt-2 text-2xl font-bold tracking-tight">Live Activity</h2>
            <p className="mt-2 text-sm text-slate-500">
              A command-centre feed showing clocking, exceptions and HR movement in one place.
            </p>
          </div>
          <StatusPill value={openExceptions + openHrCases > 0 ? "needs_review" : "ready"} />
        </div>

        <div className="mt-6 space-y-3">
          {activities.length === 0 && (
            <div className="rounded-2xl bg-white/80 shadow-sm backdrop-blur-xl p-5 text-sm text-slate-500">
              No live activity yet. Create shifts and clock events to start the feed.
            </div>
          )}

          {activities.map((activity) => (
            <div key={activity.id} className="flex items-start justify-between gap-4 rounded-2xl border border-white/80 bg-white/80 shadow-sm backdrop-blur-xl p-4">
              <div>
                <div className="text-xs font-black uppercase tracking-[0.2em] text-slate-400">{activity.type}</div>
                <div className="mt-1 font-black text-slate-950">{activity.title}</div>
                <div className="mt-1 text-sm text-slate-500">{activity.detail}</div>
              </div>
              <span
                className={`rounded-full px-3 py-1 text-xs font-black ${
                  activity.risk === "high"
                    ? "bg-rose-100 text-rose-700"
                    : activity.risk === "watch"
                    ? "bg-amber-100 text-amber-700"
                    : "bg-emerald-100 text-emerald-700"
                }`}
              >
                {activity.risk}
              </span>
            </div>
          ))}
        </div>
      </Panel>

      <Panel dark>
        <div className="text-xs font-bold uppercase tracking-[0.4em] text-cyan-300">Today</div>
        <h2 className="mt-3 text-3xl font-bold">Operational heartbeat</h2>

        <div className="mt-6 grid gap-3">
          <div className="rounded-2xl bg-white/10 p-4">
            <div className="text-xs font-bold uppercase tracking-[0.25em] text-slate-400">Clock events today</div>
            <div className="mt-2 text-3xl font-black text-white">{todaysClockEvents}</div>
          </div>

          <div className="rounded-2xl bg-white/10 p-4">
            <div className="text-xs font-bold uppercase tracking-[0.25em] text-slate-400">Open exceptions</div>
            <div className="mt-2 text-3xl font-black text-white">{openExceptions}</div>
          </div>

          <div className="rounded-2xl bg-white/10 p-4">
            <div className="text-xs font-bold uppercase tracking-[0.25em] text-slate-400">Open HR cases</div>
            <div className="mt-2 text-3xl font-black text-white">{openHrCases}</div>
          </div>
        </div>

        <div className="mt-6 rounded-2xl bg-cyan-400/20 p-4 text-sm leading-6 text-cyan-100">
          This is the screen to show clients when explaining real-time workforce control.
        </div>
      </Panel>
    </div>
  );
}


function FinalV1ControlScreen({
  stores,
  employees,
  rosterShifts,
  clockEvents,
  exceptions,
  hrCases,
  payrollHours,
  payrollBatches,
  companyId,
  onRefresh
}: {
  stores: StoreRow[];
  employees: EmployeeRow[];
  rosterShifts: RosterShiftRow[];
  clockEvents: ClockEventRow[];
  exceptions: ExceptionRow[];
  hrCases: HrCaseRow[];
  payrollHours: PayrollHoursRow[];
  payrollBatches: PayrollBatchRow[];
  companyId: string;
  onRefresh: () => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [demoMode, setDemoMode] = useState(false);

  const openExceptions = exceptions.filter(exceptionIsOpen);
  const openHrCases = hrCases.filter(hrCaseIsOpen);
  const problemPayrollRows = payrollHours.filter(rowHasPayrollProblem);
  const cleanDraftRows = payrollHours.filter(
    (item) =>
      !rowHasPayrollProblem(item) &&
      item.status !== "approved" &&
      item.status !== "exported"
  );
  const approvedRows = payrollHours.filter((item) => item.status === "approved");
  const exportedRows = payrollHours.filter((item) => item.status === "exported");
  const isPayrollLocked = payrollBatches.some((batch) => batch.status === "exported") || exportedRows.length > 0;

  const readinessChecks = [
    { label: "Stores ready", done: stores.length > 0, value: stores.length },
    { label: "Employees ready", done: employees.length > 0, value: employees.length },
    { label: "Roster ready", done: rosterShifts.length > 0, value: rosterShifts.length },
    { label: "Clocking evidence exists", done: clockEvents.length > 0, value: clockEvents.length },
    { label: "Payroll generated", done: payrollHours.length > 0, value: payrollHours.length },
    { label: "No open exceptions", done: openExceptions.length === 0, value: openExceptions.length },
    { label: "No open HR cases", done: openHrCases.length === 0, value: openHrCases.length },
    { label: "No problem payroll rows", done: problemPayrollRows.length === 0, value: problemPayrollRows.length },
    { label: "Approved payroll rows exist", done: approvedRows.length > 0 || exportedRows.length > 0, value: approvedRows.length + exportedRows.length },
    { label: "Payroll lock ready", done: isPayrollLocked || approvedRows.length > 0, value: isPayrollLocked ? "Locked" : "Ready" },
  ];

  const readiness = percentSafe(readinessChecks.filter((item) => item.done).length, readinessChecks.length);
  const blockers = openExceptions.length + openHrCases.length + problemPayrollRows.length;

  async function approveAllCleanRows() {
    if (cleanDraftRows.length === 0) {
      alert("No clean draft payroll rows to approve.");
      return;
    }

    setBusy("approve-clean");

    const { error } = await supabase
      .from("payroll_hours")
      .update({
        status: "approved",
        approved_at: new Date().toISOString(),
        approval_note: "Final V1 Control: clean payroll rows approved"
})
      .in("id", cleanDraftRows.map((row) => row.id));

    setBusy(null);

    if (error) {
      alert("Approve clean rows failed: " + error.message);
      return;
    }

    onRefresh();
  }

  async function closeApprovedExceptions() {
    const approvedExceptions = exceptions.filter((item) => item.status === "approved");

    if (approvedExceptions.length === 0) {
      alert("No approved exceptions to close.");
      return;
    }

    setBusy("close-exceptions");

    const { error } = await supabase
      .from("time_exceptions")
      .update({ status: "closed", resolved_at: new Date().toISOString() })
      .in("id", approvedExceptions.map((item) => item.id));

    setBusy(null);

    if (error) {
      alert("Close approved exceptions failed: " + error.message);
      return;
    }

    onRefresh();
  }

  async function markPayrollExportedAndLocked() {
    if (blockers > 0) {
      alert("Payroll cannot be locked while open exceptions, HR cases or problem payroll rows exist.");
      return;
    }

    if (approvedRows.length === 0) {
      alert("No approved payroll rows available to lock.");
      return;
    }

    setBusy("lock-payroll");

    const exportBatchId =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `${Date.now()}`;

    const { error } = await supabase
      .from("payroll_hours")
      .update({
        status: "exported",
        exported_at: new Date().toISOString(),
        export_batch_id: exportBatchId
})
      .in("id", approvedRows.map((row) => row.id));

    setBusy(null);

    if (error) {
      alert("Payroll lock failed: " + error.message);
      return;
    }

    alert("Payroll locked. Exported rows are now protected.");
    onRefresh();
  }

  function downloadFinalPayrollCsv() {
    const rowsForExport = payrollHours.filter((row) => row.status === "approved" || row.status === "exported");

    if (rowsForExport.length === 0) {
      alert("No approved/exported payroll rows available.");
      return;
    }

    const header = [
      "Employee ID",
      "Employee Name",
      "Period Start",
      "Period End",
      "Normal Hours",
      "Overtime Hours",
      "Late Minutes",
      "Missing Clock Events",
      "Status",
      "Approved At",
      "Exported At",
    ];

    const csvRows = rowsForExport.map((row) => {
      const employee = employees.find((item) => item.id === row.employee_id);
      const employeeName = employee ? `${employee.first_name} ${employee.last_name}` : row.employee_id;

      return [
        row.employee_id,
        employeeName,
        row.period_start,
        row.period_end,
        formatHours(row.normal_hours),
        formatHours(row.overtime_hours),
        row.late_minutes,
        row.missing_clock_events,
        row.status,
        row.approved_at || "",
        row.exported_at || "",
      ];
    });

    downloadTextFile(
      `vyron-core-final-payroll-${todayIsoDate()}.csv`,
      buildCsv([header, ...csvRows]),
      "text/csv;charset=utf-8"
    );
  }

  function downloadClientDemoPack() {
    const lines = [
      "VYRON CORE CLIENT DEMO PACK",
      `Generated: ${new Date().toLocaleString("en-ZA")}`,
      `Company ID: ${companyId}`,
      "",
      "EXECUTIVE SUMMARY",
      `V1 readiness: ${readiness}%`,
      `Open blockers: ${blockers}`,
      `Stores: ${stores.length}`,
      `Employees: ${employees.length}`,
      `Roster shifts: ${rosterShifts.length}`,
      `Clock events: ${clockEvents.length}`,
      `Payroll rows: ${payrollHours.length}`,
      `Approved rows: ${approvedRows.length}`,
      `Exported rows: ${exportedRows.length}`,
      "",
      "DEMO FLOW",
      "1. Show Command Centre.",
      "2. Show Staff Clocking.",
      "3. Show Payroll Prep.",
      "4. Show Exceptions.",
      "5. Show HR Cases.",
      "6. Show Executive Reports.",
      "7. Show Final V1 Control.",
      "",
      "POSITIONING",
      "VYRON CORE is a workforce command centre that turns clocking data into payroll control, exception workflow and HR protection.",
    ];

    downloadTextFile(`vyron-core-demo-pack-${todayIsoDate()}.txt`, lines.join("\n"));
  }

  function downloadOpenBlockersCsv() {
    const header = ["Type", "ID", "Employee ID", "Status", "Issue", "Detail"];

    const exceptionRows = openExceptions.map((item) => [
      "Exception",
      item.id,
      item.employee_id,
      item.status,
      item.exception_type,
      item.description,
    ]);

    const hrRows = openHrCases.map((item) => [
      "HR Case",
      item.id,
      item.employee_id,
      item.status,
      item.title,
      item.description,
    ]);

    const payrollRows = problemPayrollRows.map((item) => [
      "Payroll Row",
      item.id,
      item.employee_id,
      item.status,
      "Payroll problem",
      `Missing ${item.missing_clock_events}; Late ${item.late_minutes}; OT ${item.overtime_hours}`,
    ]);

    downloadTextFile(
      `vyron-core-open-blockers-${todayIsoDate()}.csv`,
      buildCsv([header, ...exceptionRows, ...hrRows, ...payrollRows]),
      "text/csv;charset=utf-8"
    );
  }

  return (
    <div className="mt-8 space-y-8">
      {demoMode && (
        <div className="rounded-[30px] border border-cyan-200 bg-cyan-50 p-5 text-sm font-bold text-cyan-900">
          Demo Mode is ON — use this screen as the guided closing flow for a client presentation.
        </div>
      )}

      <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-4">
        <StatCard title="V1 readiness" value={`${readiness}%`} subtitle="Market-ready completion score" icon={<ShieldCheck className="h-6 w-6" />} />
        <StatCard title="Open blockers" value={String(blockers)} subtitle="Must be cleared before export lock" icon={<AlertTriangle className="h-6 w-6" />} />
        <StatCard title="Approved payroll" value={String(approvedRows.length)} subtitle="Rows ready for export" icon={<WalletCards className="h-6 w-6" />} />
        <StatCard title="Payroll lock" value={isPayrollLocked ? "ON" : "OFF"} subtitle={isPayrollLocked ? "Export protected" : "Not locked yet"} icon={<CheckCircle2 className="h-6 w-6" />} />
      </div>

      <div className="grid gap-8 xl:grid-cols-[1.1fr_0.9fr]">
        <Panel>
          <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
            <div>
              <div className="text-xs font-bold uppercase tracking-[0.35em] text-cyan-700">Final V1 Control</div>
              <h2 className="mt-2 text-2xl font-bold tracking-tight">Market-Ready Command Panel</h2>
              <p className="mt-2 text-sm text-slate-500">
                Clear blockers, lock payroll, export client-ready files and run the final demo flow from one place.
              </p>
            </div>

            <button
              onClick={() => setDemoMode((value) => !value)}
              className={`rounded-2xl px-5 py-3 text-sm font-black ${
                demoMode ? "bg-cyan-500 text-slate-950" : "bg-slate-950 text-white"
              }`}
            >
              {demoMode ? "Demo Mode ON" : "Demo Mode OFF"}
            </button>
          </div>

          <div className="mt-6 h-3 rounded-full bg-slate-200">
            <div className="h-3 rounded-full bg-gradient-to-r from-blue-600 to-cyan-400" style={{ width: `${readiness}%` }} />
          </div>

          <div className="mt-6 grid gap-3 md:grid-cols-2">
            {readinessChecks.map((check) => (
              <div key={check.label} className="flex items-center justify-between rounded-2xl border border-white/80 bg-white/80 shadow-sm backdrop-blur-xl p-4">
                <div>
                  <div className="font-black text-slate-950">{check.label}</div>
                  <div className="mt-1 text-xs text-slate-500">Current value: {String(check.value)}</div>
                </div>
                <StatusPill value={check.done ? "ready" : "needs_review"} />
              </div>
            ))}
          </div>
        </Panel>

        <Panel dark>
          <div className="text-xs font-bold uppercase tracking-[0.4em] text-cyan-300">Final Actions</div>
          <h2 className="mt-3 text-3xl font-bold">Finish the pilot</h2>

          <div className="mt-6 grid gap-3">
            <button disabled={busy === "approve-clean"} onClick={approveAllCleanRows} className="rounded-2xl bg-emerald-500 px-5 py-3 text-sm font-black text-white disabled:opacity-60">
              {busy === "approve-clean" ? "Approving..." : "Approve All Clean Rows"}
            </button>

            <button disabled={busy === "close-exceptions"} onClick={closeApprovedExceptions} className="rounded-2xl bg-cyan-500 px-5 py-3 text-sm font-black text-white disabled:opacity-60">
              {busy === "close-exceptions" ? "Closing..." : "Close Approved Exceptions"}
            </button>

            <button disabled={busy === "lock-payroll" || blockers > 0} onClick={markPayrollExportedAndLocked} className="rounded-2xl bg-amber-400 px-5 py-3 text-sm font-black text-slate-950 disabled:opacity-50">
              {busy === "lock-payroll" ? "Locking..." : "Lock Payroll After Export"}
            </button>

            <button onClick={downloadFinalPayrollCsv} className="rounded-2xl bg-white px-5 py-3 text-sm font-black text-slate-950">
              Download Final Payroll CSV
            </button>

            <button onClick={downloadOpenBlockersCsv} className="rounded-2xl bg-white/10 px-5 py-3 text-sm font-black text-white">
              Download Open Blockers CSV
            </button>

            <button onClick={downloadClientDemoPack} className="rounded-2xl bg-cyan-400 px-5 py-3 text-sm font-black text-slate-950">
              Download Client Demo Pack
            </button>
          </div>

          <div className="mt-6 rounded-2xl bg-white/10 p-4 text-sm leading-6 text-slate-300">
            Payroll lock is disabled until blockers are cleared. This protects the company from exporting payroll with unresolved staff risk.
          </div>
        </Panel>
      </div>
    </div>
  );
}


function ComplianceScreen({
  exceptions,
  hrCases,
  rosterShifts,
  clockEvents
}: {
  exceptions: ExceptionRow[];
  hrCases: HrCaseRow[];
  rosterShifts: RosterShiftRow[];
  clockEvents: ClockEventRow[];
}) {
  const openExceptions = exceptions.filter((item) => item.status !== "closed" && item.status !== "approved").length;
  const responseMissing = hrCases.filter((item) => item.employee_response_required === true).length;
  const complianceRisk = openExceptions + responseMissing;
  const complianceScore = Math.max(0, Math.min(100, 100 - complianceRisk * 10));

  return (
    <div className="mt-8">
      <Panel dark>
        <div className="text-xs font-bold uppercase tracking-[0.4em] text-cyan-300">Compliance Guardrails</div>
        <h2 className="mt-3 text-3xl font-bold">Payroll must stay clean</h2>

        <div className="mt-6 grid gap-3 text-sm text-slate-300 md:grid-cols-2">
          <div className="rounded-2xl bg-white/10 p-4">Uncertain time data must be flagged, not hidden.</div>
          <div className="rounded-2xl bg-white/10 p-4">Raw clocking records must never be overwritten.</div>
          <div className="rounded-2xl bg-white/10 p-4">Employee responses must be captured for HR fairness.</div>
          <div className="rounded-2xl bg-white/10 p-4">Payroll export should use approved data only.</div>
        </div>

        <div className="mt-7 grid gap-4 md:grid-cols-3">
          <div className="rounded-2xl bg-white/10 p-5">
            <div className="text-4xl font-bold">{complianceScore}%</div>
            <div className="mt-2 text-sm text-slate-300">compliance score</div>
          </div>
          <div className="rounded-2xl bg-white/10 p-5">
            <div className="text-4xl font-bold">{rosterShifts.length}</div>
            <div className="mt-2 text-sm text-slate-300">roster records</div>
          </div>
          <div className="rounded-2xl bg-white/10 p-5">
            <div className="text-4xl font-bold">{clockEvents.length}</div>
            <div className="mt-2 text-sm text-slate-300">clocking records</div>
          </div>
        </div>
      </Panel>
    </div>
  );
}


function AddRoleModal({
  open,
  onClose,
  onSaved,
  companyId
}: {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  companyId: string;
}) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("manager");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

  async function saveRole() {
    setSaving(true);
    setError(null);

    if (!email.trim() || !email.includes("@")) {
      setError("A valid email address is required.");
      setSaving(false);
      return;
    }

    const { error: insertError } = await supabase.from("user_roles").insert({
      company_id: companyId,
      user_email: email.trim().toLowerCase(),
      role
});

    if (insertError) {
      setError(insertError.message);
      setSaving(false);
      return;
    }

    setEmail("");
    setRole("manager");
    setSaving(false);
    onSaved();
    onClose();
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-2xl rounded-[34px] bg-white p-6 shadow-2xl">
        <ModalHeader title="Add User Role" subtitle="Invite or prepare access control for Admin, Manager, and Staff users." onClose={onClose} />

        <div className="mt-6 grid gap-4 md:grid-cols-2">
          <FormInput label="User email" value={email} onChange={setEmail} placeholder="manager@company.co.za" />

          <label className="text-sm font-bold">
            Role
            <select
              value={role}
              onChange={(event) => setRole(event.target.value)}
              className="mt-2 w-full rounded-2xl border border-slate-200/80 bg-white/90 px-4 py-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.7),0_10px_28px_rgba(15,23,42,0.06)] backdrop-blur-xl outline-none transition focus:border-cyan-400 focus:shadow-[0_0_0_4px_rgba(34,211,238,0.14)]"
            >
              <option value="admin">Admin</option>
              <option value="manager">Manager</option>
              <option value="staff">Staff</option>
            </select>
          </label>
        </div>

        {error && <div className="mt-4 rounded-2xl bg-rose-50 p-4 text-sm font-semibold text-rose-700">{error}</div>}

        <ModalActions onCancel={onClose} onSave={saveRole} saving={saving} saveText="Save User Role" />
      </div>
    </div>
  );
}

function RolesScreen({
  userRoles,
  onRefresh,
  companyId
}: {
  userRoles: UserRoleRow[];
  onRefresh: () => void;
  companyId: string;
}) {
  const [addRoleOpen, setAddRoleOpen] = useState(false);
  const admins = userRoles.filter((item) => item.role === "admin").length;
  const managers = userRoles.filter((item) => item.role === "manager").length;
  const staff = userRoles.filter((item) => item.role === "staff").length;

  return (
    <>
      <AddRoleModal open={addRoleOpen} onClose={() => setAddRoleOpen(false)} onSaved={onRefresh} companyId={companyId} />

      <div className="mt-6 grid gap-5 md:grid-cols-2 xl:grid-cols-4">
        <StatCard title="Total users" value={String(userRoles.length)} subtitle="Role records loaded from Supabase" icon={<Users className="h-6 w-6" />} />
        <StatCard title="Admins" value={String(admins)} subtitle="Full system control" icon={<ShieldCheck className="h-6 w-6" />} />
        <StatCard title="Managers" value={String(managers)} subtitle="Operations and HR control" icon={<Users className="h-6 w-6" />} />
        <StatCard title="Staff" value={String(staff)} subtitle="Clocking and own profile access" icon={<Clock3 className="h-6 w-6" />} />
      </div>

      <div className="mt-8 grid gap-8 xl:grid-cols-[1fr_0.7fr]">
        <Panel>
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div>
              <h2 className="text-2xl font-bold tracking-tight">User Roles & Permissions</h2>
              <p className="mt-2 text-sm text-slate-500">Control who can access VYRON CORE and prepare the app for proper multi-user login permissions.</p>
            </div>

            <button onClick={() => setAddRoleOpen(true)} className="flex w-fit items-center gap-2 rounded-2xl bg-[#06101f] px-5 py-3 text-sm font-black text-cyan-300 shadow-lg shadow-cyan-950/15">
              <Plus className="h-4 w-4" />
              Add User Role
            </button>
          </div>

          <div className="mt-6 space-y-4">
            {userRoles.length === 0 && <div className="rounded-[2rem] border border-white/80 bg-white/90 p-5 shadow-[0_16px_45px_rgba(15,23,42,0.10)] backdrop-blur-xl text-sm text-slate-500">No user roles created yet.</div>}

            {userRoles.map((item) => (
              <div key={item.id} className="rounded-[2rem] border border-white/80 bg-white/90 p-5 shadow-[0_16px_45px_rgba(15,23,42,0.10)] backdrop-blur-xl">
                <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                  <div>
                    <div className="font-bold text-slate-950">{item.user_email}</div>
                    <div className="mt-1 text-xs text-slate-500">Added {formatDate(item.created_at)}</div>
                  </div>
                  <StatusPill value={item.role} />
                </div>
              </div>
            ))}
          </div>
        </Panel>

        <Panel dark>
          <div className="text-xs font-bold uppercase tracking-[0.4em] text-cyan-300">Permission Model</div>
          <h2 className="mt-3 text-3xl font-bold">How access should work</h2>
          <div className="mt-6 space-y-3 text-sm text-slate-300">
            <div className="rounded-2xl bg-white/10 p-4">Admin: full company setup, users, payroll, HR, and exports.</div>
            <div className="rounded-2xl bg-white/10 p-4">Manager: stores, rosters, clocking exceptions, and HR case workflow.</div>
            <div className="rounded-2xl bg-white/10 p-4">Staff: clock in/out, own profile, own shifts, and own acknowledgements.</div>
            <div className="rounded-2xl bg-white/10 p-4">Next step: connect these roles to real Supabase Auth login sessions.</div>
          </div>
        </Panel>
      </div>
    </>
  );
}


function StaffClockingScreen({
  employees,
  stores,
  rosterShifts,
  clockEvents,
  companyId,
  onRefresh
}: {
  employees: EmployeeRow[];
  stores: StoreRow[];
  rosterShifts: RosterShiftRow[];
  clockEvents: ClockEventRow[];
  companyId: string;
  onRefresh: () => void;
}) {
  const activeEmployees = employees.filter((employee) => employee.active !== false);
  const [employeeId, setEmployeeId] = useState("");
  const [storeId, setStoreId] = useState("");
  const [rosterShiftId, setRosterShiftId] = useState("");
  const [staffCode, setStaffCode] = useState("");
  const [employeeSearch, setEmployeeSearch] = useState("");
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [localClockEvents, setLocalClockEvents] = useState<ClockEventRow[]>(clockEvents);
  const [saving, setSaving] = useState(false);
  const [gpsMessage, setGpsMessage] = useState<string | null>(null);
  const [lastMessage, setLastMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLocalClockEvents(clockEvents);
  }, [clockEvents]);

  const selectedEmployee = employees.find((employee) => employee.id === employeeId) || null;
  const selectedStore = stores.find((store) => store.id === storeId) || null;
  const todayKey = new Date().toISOString().slice(0, 10);

  const todayEvents = localClockEvents
    .filter((event) => {
      const dateKey = String(event.event_time || "").slice(0, 10);
      return dateKey === todayKey;
    })
    .sort((a, b) => new Date(b.event_time).getTime() - new Date(a.event_time).getTime());

  const selectedEmployeeTodayEvents = todayEvents.filter((event) => event.employee_id === employeeId);
  const lastEvent = selectedEmployeeTodayEvents[0] || null;
  const currentlyClockedIn = lastEvent ? isClockIn(lastEvent.event_type) : false;
  const nextAction: "clock_in" | "clock_out" = currentlyClockedIn ? "clock_out" : "clock_in";

  const firstClockInToday = [...selectedEmployeeTodayEvents]
    .reverse()
    .find((event) => isClockIn(event.event_type));

  const lastClockOutToday = selectedEmployeeTodayEvents.find((event) => isClockOut(event.event_type));

  const filteredEmployees = activeEmployees.filter((employee) => {
    const term = employeeSearch.trim().toLowerCase();
    if (!term) return true;

    return [
      employee.employee_number || "",
      employee.first_name || "",
      employee.last_name || "",
      employee.job_title || "",
      employee.phone || "",
      employee.email || "",
    ]
      .join(" ")
      .toLowerCase()
      .includes(term);
  });

  const filteredShifts = rosterShifts.filter((shift) => {
    if (employeeId && shift.employee_id !== employeeId) return false;
    if (storeId && shift.store_id !== storeId) return false;
    return shift.shift_date === todayKey || String(shift.planned_start || "").slice(0, 10) === todayKey;
  });

  function selectEmployee(nextEmployeeId: string) {
    setEmployeeId(nextEmployeeId);
    const employee = employees.find((item) => item.id === nextEmployeeId) || null;
    if (employee?.default_store_id) setStoreId(employee.default_store_id);
    setRosterShiftId("");
    setPhotoFile(null);
    setError(null);
    setLastMessage(null);
  }

  function findEmployeeByCode() {
    const code = staffCode.trim().toLowerCase();

    if (!code) {
      setError("Type your staff code, employee number or PIN first.");
      return;
    }

    const matchedEmployee = activeEmployees.find((employee) => {
      const pin = String(employee.pin_code || "").trim().toLowerCase();
      const employeeNumber = String(employee.employee_number || "").trim().toLowerCase();
      const phone = String(employee.phone || "").trim().toLowerCase();

      return code === pin || code === employeeNumber || code === phone;
    });

    if (!matchedEmployee) {
      setError("No employee found for that code/PIN.");
      return;
    }

    selectEmployee(matchedEmployee.id);
    setEmployeeSearch(employeeName(matchedEmployee));
    setLastMessage(`${employeeName(matchedEmployee)} selected.`);
  }

  async function getCurrentPosition(): Promise<GeolocationPosition> {
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) {
        reject(new Error("GPS is not available on this device."));
        return;
      }

      navigator.geolocation.getCurrentPosition(resolve, reject, {
        enableHighAccuracy: true,
        timeout: 15000,
        maximumAge: 0,
      });
    });
  }

  async function uploadClockPhoto(employeeIdForUpload: string, eventType: string) {
    if (!photoFile) return { photo_bucket: null, photo_path: null, photo_url: null };

    const extension = photoFile.name.includes(".") ? photoFile.name.split(".").pop() : "jpg";
    const filePath = `${employeeIdForUpload}/${todayKey}/${Date.now()}-${eventType}.${extension}`;

    const { error: uploadError } = await supabase.storage
      .from("clock-event-photos")
      .upload(filePath, photoFile, {
        contentType: photoFile.type || "image/jpeg",
        upsert: false,
      });

    if (uploadError) {
      throw new Error(uploadError.message);
    }

    return {
      photo_bucket: "clock-event-photos",
      photo_path: filePath,
      photo_url: filePath,
    };
  }

  async function openClockPhoto(event: ClockEventRow) {
    const item = event as any;

    if (!item.photo_bucket || !item.photo_path) {
      setError("No photo saved for this clock event.");
      return;
    }

    const { data, error: signedError } = await supabase.storage
      .from(item.photo_bucket)
      .createSignedUrl(item.photo_path, 60 * 10);

    if (signedError || !data?.signedUrl) {
      setError(signedError?.message || "Could not open clock photo.");
      return;
    }

    window.open(data.signedUrl, "_blank");
  }

  async function saveClockEvent() {
    setSaving(true);
    setError(null);
    setLastMessage(null);
    setGpsMessage(null);

    if (!selectedEmployee) {
      setError("Select your name or type your staff code first.");
      setSaving(false);
      return;
    }

    if (!storeId) {
      setError("Select the store/location first.");
      setSaving(false);
      return;
    }

    if (!photoFile) {
      setError("A live photo is required before clocking.");
      setSaving(false);
      return;
    }

    const latestEventNow = localClockEvents
      .filter((event) => event.employee_id === selectedEmployee.id && String(event.event_time || "").slice(0, 10) === todayKey)
      .sort((a, b) => new Date(b.event_time).getTime() - new Date(a.event_time).getTime())[0] || null;

    const latestIsClockedIn = latestEventNow ? isClockIn(latestEventNow.event_type) : false;
    const lockedNextAction: "clock_in" | "clock_out" = latestIsClockedIn ? "clock_out" : "clock_in";

    if (lockedNextAction !== nextAction) {
      setError("Clocking status changed. Please refresh and try again.");
      setSaving(false);
      return;
    }

    try {
      const position = await getCurrentPosition();
      const { latitude, longitude, accuracy } = position.coords;

      setGpsMessage(`GPS captured: ${latitude.toFixed(5)}, ${longitude.toFixed(5)} · accuracy ${Math.round(accuracy)}m`);

      const photoEvidence = await uploadClockPhoto(selectedEmployee.id, lockedNextAction);

      const payload: any = {
        company_id: companyId,
        employee_id: selectedEmployee.id,
        store_id: storeId,
        roster_shift_id: rosterShiftId || null,
        event_type: lockedNextAction,
        event_time: new Date().toISOString(),
        source: "kiosk",
        latitude,
        longitude,
        gps_accuracy: accuracy,
        photo_bucket: photoEvidence.photo_bucket,
        photo_path: photoEvidence.photo_path,
        photo_url: photoEvidence.photo_url,
        device_info: typeof window !== "undefined" ? window.navigator.userAgent : null,
        clock_note: lockedNextAction === "clock_in" ? "Staff clocked in with photo and GPS." : "Staff clocked out with photo and GPS.",
      };

      const { data, error: insertError } = await supabase
        .from("clock_events")
        .insert(payload)
        .select("*")
        .single();

      if (insertError) {
        setError(insertError.message);
        setSaving(false);
        return;
      }

      if (data) {
        setLocalClockEvents((current) => [data as ClockEventRow, ...current]);
      }

      setPhotoFile(null);
      setLastMessage(
        `${employeeName(selectedEmployee)} ${lockedNextAction === "clock_in" ? "clocked in" : "clocked out"} successfully.`
      );

      await onRefresh();
    } catch (clockError: any) {
      setError(clockError?.message || "Clocking failed.");
    }

    setSaving(false);
  }

  return (
    <section className="relative -m-6 overflow-hidden rounded-none bg-[radial-gradient(circle_at_18%_8%,rgba(34,211,238,0.22),transparent_30%),radial-gradient(circle_at_86%_18%,rgba(37,99,235,0.18),transparent_34%),linear-gradient(135deg,#050914_0%,#07101f_34%,#eef7ff_34%,#f8fbff_100%)] p-6 text-[#06101f] md:-m-8 md:p-8">
      <div className="pointer-events-none absolute inset-0 z-0">
        <div className="absolute left-[-180px] top-[-220px] h-[620px] w-[620px] rounded-full bg-cyan-400/18 blur-[140px]" />
        <div className="absolute right-[-180px] top-[120px] h-[760px] w-[760px] rounded-full bg-cyan-500/20 blur-[160px]" />
        <div className="absolute inset-0 bg-[linear-gradient(135deg,rgba(8,47,73,0.98)_0%,rgba(14,116,144,0.9)_34%,rgba(238,246,255,0.94)_34%,rgba(238,246,255,0.94)_100%)]" />
      </div>

      <div className="relative z-10 space-y-6">
        <header className="rounded-[2.2rem] border border-white/70 bg-white/95 p-7 shadow-[0_22px_70px_rgba(15,23,42,0.16)] backdrop-blur-xl">
          <div className="inline-flex rounded-full bg-cyan-100 px-4 py-2 text-xs font-black uppercase tracking-[0.35em] text-cyan-700">
            VYRON CORE CLOCKING
          </div>
          <h1 className="mt-5 text-5xl font-black tracking-tight text-[#06101f]">Staff Clocking</h1>
          <p className="mt-4 max-w-4xl text-base leading-8 text-slate-600">
            Search your name or type your staff code. The system only shows Clock In when you are out, and only Clock Out when you are already clocked in.
          </p>
        </header>

        <section className="grid gap-6 xl:grid-cols-[0.95fr_1.05fr]">
          <div className="rounded-[2.2rem] bg-[#06101f] p-7 text-white shadow-[0_22px_70px_rgba(6,16,31,0.35)]">
            <div className="inline-flex rounded-full bg-cyan-400/15 px-4 py-2 text-xs font-black uppercase tracking-[0.25em] text-cyan-300">
              EMPLOYEE IDENTIFICATION
            </div>

            <div className="mt-6 grid gap-4">
              <label className="text-sm font-black text-slate-200">
                Staff Code / Employee Number / PIN
                <div className="mt-2 flex gap-2">
                  <input
                    value={staffCode}
                    onChange={(event) => setStaffCode(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") findEmployeeByCode();
                    }}
                    placeholder="Type code..."
                    className="w-full rounded-2xl border border-cyan-400/20 bg-white/10 px-4 py-4 text-sm font-bold text-white outline-none placeholder:text-slate-400 focus:border-cyan-300"
                  />
                  <button
                    onClick={findEmployeeByCode}
                    className="rounded-2xl bg-cyan-400 px-5 py-4 text-sm font-black text-[#06101f]"
                  >
                    Find
                  </button>
                </div>
              </label>

              <label className="text-sm font-black text-slate-200">
                Or Search Employee
                <input
                  value={employeeSearch}
                  onChange={(event) => setEmployeeSearch(event.target.value)}
                  placeholder="Search by name, number, phone..."
                  className="mt-2 w-full rounded-2xl border border-cyan-400/20 bg-white/10 px-4 py-4 text-sm font-bold text-white outline-none placeholder:text-slate-400 focus:border-cyan-300"
                />
              </label>

              <div className="max-h-[320px] space-y-2 overflow-auto pr-1">
                {filteredEmployees.slice(0, 20).map((employee) => (
                  <button
                    key={employee.id}
                    onClick={() => selectEmployee(employee.id)}
                    className={`w-full rounded-2xl px-4 py-3 text-left text-sm font-black transition ${
                      employee.id === employeeId
                        ? "bg-cyan-400 text-[#06101f]"
                        : "border border-cyan-400/15 bg-white/5 text-slate-200 hover:bg-white/10"
                    }`}
                  >
                    {employeeName(employee)}
                    <span className="ml-2 text-xs opacity-70">
                      {employee.employee_number || "No number"}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="rounded-[2.2rem] border border-white/70 bg-white/95 p-7 shadow-[0_22px_70px_rgba(15,23,42,0.16)] backdrop-blur-xl">
            <div className="grid gap-4">
              <div className="rounded-[2rem] border border-white/80 bg-white p-5 shadow-[0_16px_45px_rgba(15,23,42,0.08)]">
                <div className="text-xs font-black uppercase tracking-[0.25em] text-slate-400">Selected Employee</div>
                <div className="mt-2 text-2xl font-black text-[#06101f]">
                  {selectedEmployee ? employeeName(selectedEmployee) : "No employee selected"}
                </div>
                <div className="mt-2 text-sm font-bold text-slate-500">
                  {selectedEmployee?.employee_number || "Select by search or code"}
                </div>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <label className="text-sm font-black text-slate-700">
                  Store / Location
                  <select
                    value={storeId}
                    onChange={(event) => setStoreId(event.target.value)}
                    className="mt-2 w-full rounded-2xl border border-white/80 bg-white px-4 py-4 font-bold shadow-sm outline-none focus:border-cyan-400"
                  >
                    <option value="">Select store</option>
                    {stores.map((store) => (
                      <option key={store.id} value={store.id}>
                        {store.name}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="text-sm font-black text-slate-700">
                  Roster Shift
                  <select
                    value={rosterShiftId}
                    onChange={(event) => setRosterShiftId(event.target.value)}
                    className="mt-2 w-full rounded-2xl border border-white/80 bg-white px-4 py-4 font-bold shadow-sm outline-none focus:border-cyan-400"
                  >
                    <option value="">No linked shift</option>
                    {filteredShifts.map((shift) => (
                      <option key={shift.id} value={shift.id}>
                        {formatDate(shift.shift_date)} · {formatTime(shift.planned_start)} - {formatTime(shift.planned_end)}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <label className="text-sm font-black text-slate-700">
                Live Photo Required
                <input
                  type="file"
                  accept="image/*"
                  capture="user"
                  onChange={(event) => setPhotoFile(event.target.files?.[0] || null)}
                  className="mt-2 w-full rounded-2xl border border-white/80 bg-white px-4 py-4 font-bold shadow-sm outline-none focus:border-cyan-400"
                />
              </label>

              <div className={`rounded-[2rem] p-5 ${
                currentlyClockedIn
                  ? "border border-amber-200 bg-amber-50 text-amber-900"
                  : "border border-emerald-200 bg-emerald-50 text-emerald-900"
              }`}>
                <div className="text-xs font-black uppercase tracking-[0.25em] opacity-70">
                  Current Status
                </div>
                <div className="mt-2 text-3xl font-black">
                  {selectedEmployee ? (currentlyClockedIn ? "Clocked In" : "Clocked Out") : "Waiting for Employee"}
                </div>
                <div className="mt-2 text-sm font-bold opacity-80">
                  {selectedEmployee
                    ? currentlyClockedIn
                      ? "Only Clock Out is available now."
                      : "Only Clock In is available now."
                    : "Select employee to continue."}
                </div>
              </div>

              {error && <div className="rounded-2xl bg-rose-50 p-4 text-sm font-black text-rose-700">{error}</div>}
              {gpsMessage && <div className="rounded-2xl bg-cyan-50 p-4 text-sm font-black text-cyan-700">{gpsMessage}</div>}
              {lastMessage && <div className="rounded-2xl bg-emerald-50 p-4 text-sm font-black text-emerald-700">{lastMessage}</div>}

              <button
                onClick={saveClockEvent}
                disabled={saving || !selectedEmployee}
                className={`rounded-2xl px-5 py-5 text-sm font-black shadow-lg disabled:bg-slate-300 disabled:text-slate-500 ${
                  nextAction === "clock_in"
                    ? "bg-emerald-600 text-white"
                    : "bg-amber-500 text-[#06101f]"
                }`}
              >
                {saving ? "Saving..." : nextAction === "clock_in" ? "Clock In" : "Clock Out"}
              </button>
            </div>
          </div>
        </section>

        <section className="rounded-[2.2rem] border border-white/70 bg-white/95 p-7 shadow-[0_22px_70px_rgba(15,23,42,0.16)] backdrop-blur-xl">
          <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
            <div>
              <div className="text-xs font-black uppercase tracking-[0.35em] text-cyan-700">Today’s Clocking History</div>
              <h2 className="mt-2 text-3xl font-black text-[#06101f]">
                {selectedEmployee ? employeeName(selectedEmployee) : "Select an employee"}
              </h2>
            </div>

            <div className="text-sm font-bold text-slate-500">
              In: {firstClockInToday ? formatTime(firstClockInToday.event_time) : "--:--"} · Out: {lastClockOutToday ? formatTime(lastClockOutToday.event_time) : "--:--"}
            </div>
          </div>

          <div className="mt-6 space-y-3">
            {!selectedEmployee ? (
              <div className="rounded-2xl bg-white/80 shadow-sm backdrop-blur-xl p-5 text-sm font-bold text-slate-500">
                Search or enter a staff code to view today’s clocking history.
              </div>
            ) : selectedEmployeeTodayEvents.length === 0 ? (
              <div className="rounded-2xl bg-white/80 shadow-sm backdrop-blur-xl p-5 text-sm font-bold text-slate-500">
                No clocking events for today yet.
              </div>
            ) : (
              selectedEmployeeTodayEvents.map((event) => {
                const item = event as any;
                return (
                  <div key={event.id} className="rounded-[2rem] border border-white/80 bg-white p-5 shadow-[0_16px_45px_rgba(15,23,42,0.08)]">
                    <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                      <div>
                        <div className="text-xl font-black text-[#06101f]">
                          {isClockIn(event.event_type) ? "Clock In" : "Clock Out"} · {formatTime(event.event_time)}
                        </div>
                        <div className="mt-1 text-sm font-bold text-slate-500">
                          {selectedStore?.name || stores.find((store) => store.id === event.store_id)?.name || "No store"} · Source: {formatText(event.source)}
                        </div>
                      </div>

                      <div className="flex flex-wrap gap-2">
                        {event.latitude && event.longitude && (
                          <a
                            href={`https://www.google.com/maps?q=${event.latitude},${event.longitude}`}
                            target="_blank"
                            rel="noreferrer"
                            className="rounded-full bg-cyan-50 px-4 py-2 text-xs font-black text-cyan-700"
                          >
                            GPS
                          </a>
                        )}

                        {item.photo_path && (
                          <button
                            onClick={() => openClockPhoto(event)}
                            className="rounded-full bg-slate-950 px-4 py-2 text-xs font-black text-cyan-300"
                          >
                            Photo
                          </button>
                        )}
                      </div>
                    </div>

                    <div className="mt-3 grid gap-3 md:grid-cols-3">
                      <InfoBox label="Latitude" value={event.latitude ? String(event.latitude) : "Not saved"} />
                      <InfoBox label="Longitude" value={event.longitude ? String(event.longitude) : "Not saved"} />
                      <InfoBox label="Photo" value={item.photo_path ? "Saved" : "Not saved"} />
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </section>
      </div>
    </section>
  );
}



function ClockingManagementPanel({
  clockEvents,
  employees,
  stores,
  rosterShifts,
  exceptions,
  onManualEvent,
  onRefresh,
}: {
  clockEvents: ClockEventRow[];
  employees: EmployeeRow[];
  stores: StoreRow[];
  rosterShifts: RosterShiftRow[];
  exceptions: ExceptionRow[];
  onManualEvent: () => void;
  onRefresh: () => void;
}) {
  const [search, setSearch] = useState("");
  const [storeFilter, setStoreFilter] = useState("all");
  const [eventFilter, setEventFilter] = useState("all");

  function employeeName(id: string) {
    const found = employees.find((employee) => employee.id === id);
    return found ? `${found.first_name} ${found.last_name}` : "Unknown employee";
  }

  function employeeCode(id: string) {
    return employees.find((employee) => employee.id === id)?.employee_number || "No code";
  }

  function storeName(id: string | null) {
    if (!id) return "No store";
    return stores.find((store) => store.id === id)?.name || "Unknown store";
  }

  const activeEmployees = employees.filter((employee) => employee.active);
  const today = todayIsoDate();

  const todaysEvents = clockEvents.filter((event) => dayKeyFromIso(event.event_time) === today);
  const clockInsToday = todaysEvents.filter((event) => isClockIn(event.event_type)).length;
  const clockOutsToday = todaysEvents.filter((event) => isClockOut(event.event_type)).length;

  const latestByEmployee = new Map<string, ClockEventRow>();
  [...clockEvents]
    .sort((a, b) => new Date(b.event_time).getTime() - new Date(a.event_time).getTime())
    .forEach((event) => {
      if (!latestByEmployee.has(event.employee_id)) {
        latestByEmployee.set(event.employee_id, event);
      }
    });

  const currentlyClockedIn = Array.from(latestByEmployee.values()).filter((event) => isClockIn(event.event_type)).length;

  const filteredEvents = clockEvents
    .filter((event) => {
      if (storeFilter !== "all" && event.store_id !== storeFilter) return false;
      if (eventFilter !== "all" && event.event_type !== eventFilter) return false;

      const term = search.trim().toLowerCase();
      if (!term) return true;

      return [
        employeeName(event.employee_id),
        employeeCode(event.employee_id),
        storeName(event.store_id),
        event.event_type,
        event.source,
      ]
        .join(" ")
        .toLowerCase()
        .includes(term);
    })
    .slice(0, 80);

  const todaysShifts = rosterShifts.filter((shift) => shift.shift_date === today);
  const openExceptions = exceptions.filter(exceptionIsOpen).length;

  return (
    <section className="mt-8 space-y-8">
      <div className="grid gap-5 md:grid-cols-4">
        <StatCard title="Clock events today" value={String(todaysEvents.length)} subtitle="Live timekeeping movement" icon={<Clock3 className="h-6 w-6" />} />
        <StatCard title="Clock-ins today" value={String(clockInsToday)} subtitle="Staff started work" icon={<CheckCircle2 className="h-6 w-6" />} />
        <StatCard title="Currently clocked in" value={String(currentlyClockedIn)} subtitle="Based on latest event" icon={<Users className="h-6 w-6" />} />
        <StatCard title="Open exceptions" value={String(openExceptions)} subtitle="Needs manager review" icon={<AlertTriangle className="h-6 w-6" />} />
      </div>

      <div className="grid gap-8 xl:grid-cols-[1.15fr_0.85fr]">
        <Panel>
          <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
            <div>
              <div className="text-xs font-bold uppercase tracking-[0.35em] text-cyan-700">Clocking Control</div>
              <h2 className="mt-2 text-3xl font-bold">Clock Event Register</h2>
              <p className="mt-2 text-sm text-slate-500">
                Review clock-ins, clock-outs and manual corrections. This gives movement on the Clocking page.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button onClick={onManualEvent} className="rounded-2xl bg-[#06101f] px-5 py-3 text-sm font-black text-cyan-300 shadow-lg shadow-cyan-950/15">
                + Manual Event
              </button>
              <button onClick={onRefresh} className="rounded-2xl border border-slate-200/70 bg-white/90 px-5 py-3 text-sm font-bold text-slate-700 shadow-[0_10px_26px_rgba(15,23,42,0.08)] transition hover:-translate-y-0.5 hover:border-cyan-200">
                Refresh
              </button>
            </div>
          </div>

          <div className="mt-6 grid gap-3 md:grid-cols-[1fr_0.55fr_0.55fr]">
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              className="rounded-2xl border border-white/80 bg-white/80 shadow-sm backdrop-blur-xl px-4 py-3 text-sm font-semibold outline-none focus:border-cyan-400"
              placeholder="Search employee, code, store, source..."
            />

            <select
              value={storeFilter}
              onChange={(event) => setStoreFilter(event.target.value)}
              className="rounded-2xl border border-white/80 bg-white/80 shadow-sm backdrop-blur-xl px-4 py-3 text-sm font-bold outline-none focus:border-cyan-400"
            >
              <option value="all">All stores</option>
              {stores.map((store) => (
                <option key={store.id} value={store.id}>{store.name}</option>
              ))}
            </select>

            <select
              value={eventFilter}
              onChange={(event) => setEventFilter(event.target.value)}
              className="rounded-2xl border border-white/80 bg-white/80 shadow-sm backdrop-blur-xl px-4 py-3 text-sm font-bold outline-none focus:border-cyan-400"
            >
              <option value="all">All events</option>
              <option value="clock_in">Clock in</option>
              <option value="clock_out">Clock out</option>
              <option value="break_start">Break start</option>
              <option value="break_end">Break end</option>
            </select>
          </div>

          <div className="mt-6 space-y-3">
            {filteredEvents.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-8 text-center">
                <div className="text-lg font-bold text-slate-950">No clock events found</div>
                <p className="mt-2 text-sm text-slate-500">Use the staff kiosk or manual event button to create movement.</p>
              </div>
            ) : (
              filteredEvents.map((event) => (
                <article key={event.id} className="rounded-[2rem] border border-white/80 bg-white/90 p-5 shadow-[0_16px_45px_rgba(15,23,42,0.10)] backdrop-blur-xl">
                  <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                    <div>
                      <div className="font-black text-slate-950">{employeeName(event.employee_id)}</div>
                      <div className="mt-1 text-xs font-semibold text-slate-500">
                        {employeeCode(event.employee_id)} · {storeName(event.store_id)} · {formatTime(event.event_time)} · {event.source}
                      </div>

                      <div className="mt-3 grid gap-2 text-xs font-semibold text-slate-600 md:grid-cols-2">
                        <div className="rounded-2xl bg-white p-3">
                          <MapPin className="mr-2 inline h-4 w-4 text-cyan-700" />
                          {event.latitude && event.longitude
                            ? `${Number(event.latitude).toFixed(5)}, ${Number(event.longitude).toFixed(5)}`
                            : "No GPS saved"}
                        </div>

                        <div className="rounded-2xl bg-white p-3">
                          <Camera className="mr-2 inline h-4 w-4 text-cyan-700" />
                          {event.photo_path ? "Photo saved" : "No photo saved"}
                        </div>
                      </div>
                    </div>

                    <div className="flex flex-col items-start gap-2 md:items-end">
                      <EventPill value={event.event_type} />
                      {event.photo_bucket && event.photo_path && (
                        <button
                          onClick={async () => {
                            const { data, error } = await supabase.storage
                              .from(event.photo_bucket || "clock-event-photos")
                              .createSignedUrl(event.photo_path || "", 60 * 10);

                            if (!error && data?.signedUrl) {
                              window.open(data.signedUrl, "_blank");
                            }
                          }}
                          className="rounded-full bg-cyan-50 px-3 py-2 text-xs font-black text-cyan-700"
                        >
                          Open Photo
                        </button>
                      )}
                    </div>
                  </div>
                </article>
              ))
            )}
          </div>
        </Panel>

        <Panel dark>
          <div className="text-xs font-bold uppercase tracking-[0.4em] text-cyan-300">Today</div>
          <h2 className="mt-3 text-3xl font-bold">Clocking heartbeat</h2>

          <div className="mt-6 space-y-3">
            <div className="rounded-2xl bg-white/10 p-4">
              <div className="text-xs font-bold uppercase tracking-[0.2em] text-slate-400">Scheduled shifts today</div>
              <div className="mt-2 text-3xl font-black">{todaysShifts.length}</div>
            </div>
            <div className="rounded-2xl bg-white/10 p-4">
              <div className="text-xs font-bold uppercase tracking-[0.2em] text-slate-400">Clock outs today</div>
              <div className="mt-2 text-3xl font-black">{clockOutsToday}</div>
            </div>
            <div className="rounded-2xl bg-white/10 p-4">
              <div className="text-xs font-bold uppercase tracking-[0.2em] text-slate-400">Active employees</div>
              <div className="mt-2 text-3xl font-black">{activeEmployees.length}</div>
            </div>
          </div>

          <div className="mt-6 rounded-2xl bg-cyan-500/20 p-4 text-sm leading-6 text-cyan-100">
            The Clocking page should show live movement, manual corrections and current workforce status.
          </div>
        </Panel>
      </div>
    </section>
  );
}



function VyronCoreCostStyleCommandCentre({
  stores,
  employees,
  exceptions,
  hrCases,
  onRefresh,
}: {
  stores: StoreRow[];
  employees: EmployeeRow[];
  exceptions: ExceptionRow[];
  hrCases: HrCaseRow[];
  onRefresh: () => void;
  companyId: string;
}) {
  const activeEmployees = employees.filter((employee) => employee.active !== false).length;
  const openExceptions = exceptions.filter(exceptionIsOpen).length;
  const openHrCases = hrCases.filter(hrCaseIsOpen).length;
  const estimatedLoss = openExceptions * 1200 + openHrCases * 2500;
  const payrollReadiness = openExceptions === 0 && openHrCases === 0 ? "Ready" : "Blocked";

  return (
    <section className="relative -m-6 overflow-hidden rounded-none bg-[radial-gradient(circle_at_18%_8%,rgba(34,211,238,0.22),transparent_30%),radial-gradient(circle_at_86%_18%,rgba(37,99,235,0.18),transparent_34%),linear-gradient(135deg,#050914_0%,#07101f_34%,#eef7ff_34%,#f8fbff_100%)] p-6 text-[#06101f] md:-m-8 md:p-8">
      <div className="pointer-events-none absolute inset-0 z-0">
        <div className="absolute left-[-180px] top-[-220px] h-[620px] w-[620px] rounded-full bg-cyan-400/18 blur-[140px]" />
        <div className="absolute right-[-180px] top-[120px] h-[760px] w-[760px] rounded-full bg-cyan-500/20 blur-[160px]" />
        <div className="absolute bottom-[-260px] left-[36%] h-[680px] w-[680px] rounded-full bg-sky-300/18 blur-[170px]" />
        <div className="absolute inset-0 bg-[linear-gradient(135deg,rgba(8,47,73,0.98)_0%,rgba(14,116,144,0.9)_31%,rgba(238,246,255,0.94)_31%,rgba(238,246,255,0.94)_100%)]" />
      </div>

      <div className="relative z-10 space-y-6">
        <header className="rounded-[2.2rem] border border-white/70 bg-white/95 p-7 shadow-[0_22px_70px_rgba(15,23,42,0.16)] backdrop-blur-xl">
          <div className="inline-flex rounded-full bg-cyan-100 px-4 py-2 text-xs font-black uppercase tracking-[0.35em] text-cyan-700">
            VYRON CORE COMMAND CENTRE
          </div>

          <div className="mt-5 flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
            <div>
              <h1 className="text-5xl font-black tracking-tight text-[#06101f]">
                Workforce Command Centre
              </h1>
              <p className="mt-4 max-w-5xl text-base leading-8 text-slate-600">
                Enterprise workforce control, clocking, HR risk, roster movement and payroll readiness in one connected system.
              </p>
            </div>

            <button
              onClick={onRefresh}
              className="w-fit rounded-full bg-[#06101f] px-5 py-3 text-sm font-black text-cyan-300 shadow-lg shadow-cyan-950/20 transition hover:-translate-y-0.5 hover:bg-[#0b1a33]"
            >
              Refresh Live Data
            </button>
          </div>
        </header>

        <section className="rounded-[2.2rem] bg-[#06101f] p-7 text-white shadow-[0_22px_70px_rgba(6,16,31,0.35)]">
          <div className="grid gap-7 xl:grid-cols-[1.25fr_0.75fr]">
            <div>
              <div className="inline-flex rounded-full bg-cyan-400/15 px-4 py-2 text-xs font-black uppercase tracking-[0.25em] text-cyan-300">
                LIVE OPERATIONS CONTROL
              </div>

              <h2 className="mt-5 max-w-4xl text-4xl font-black tracking-tight md:text-5xl">
                See payroll blockers before they cost money.
              </h2>

              <p className="mt-5 max-w-3xl text-base leading-8 text-slate-300">
                Monitor workforce activity, exceptions, HR risks and payroll readiness from one premium VYRON control room.
              </p>

              <div className="mt-6 flex flex-wrap gap-3">
                <span className="rounded-full bg-cyan-400 px-5 py-3 text-sm font-black text-[#06101f]">
                  {openExceptions} Exceptions
                </span>
                <span className="rounded-full border border-cyan-400/30 px-5 py-3 text-sm font-black text-cyan-300">
                  {openHrCases} HR Cases
                </span>
                <span className="rounded-full border border-cyan-400/30 px-5 py-3 text-sm font-black text-cyan-300">
                  Payroll {payrollReadiness}
                </span>
              </div>
            </div>

            <div className="rounded-[2rem] border border-cyan-400/15 bg-white/5 p-6">
              <div className="text-xs font-black uppercase tracking-[0.25em] text-cyan-300">
                ESTIMATED MONTHLY LOSS
              </div>
              <div className="mt-4 text-5xl font-black">
                R {estimatedLoss.toLocaleString("en-ZA")}
              </div>
              <div className="mt-3 text-sm leading-7 text-slate-300">
                Based on open exceptions and HR risk currently visible in the system.
              </div>
            </div>
          </div>
        </section>

        <section className="grid gap-5 md:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-[2rem] border border-white/80 bg-white/95 p-6 shadow-[0_18px_55px_rgba(15,23,42,0.14)] backdrop-blur-xl">
            <div className="w-fit rounded-2xl bg-cyan-50 p-3 text-cyan-700">
              <Users className="h-6 w-6" />
            </div>
            <div className="mt-6 text-sm font-bold text-slate-500">Active Employees</div>
            <div className="mt-2 text-4xl font-black text-[#06101f]">{activeEmployees}</div>
            <div className="mt-2 text-sm font-black text-cyan-700">Live workforce</div>
          </div>

          <div className="rounded-[2rem] border border-white/80 bg-white/95 p-6 shadow-[0_18px_55px_rgba(15,23,42,0.14)] backdrop-blur-xl">
            <div className="w-fit rounded-2xl bg-cyan-50 p-3 text-cyan-700">
              <Store className="h-6 w-6" />
            </div>
            <div className="mt-6 text-sm font-bold text-slate-500">Stores</div>
            <div className="mt-2 text-4xl font-black text-[#06101f]">{stores.length}</div>
            <div className="mt-2 text-sm font-black text-cyan-700">Controlled locations</div>
          </div>

          <div className="rounded-[2rem] border border-white/80 bg-white/95 p-6 shadow-[0_18px_55px_rgba(15,23,42,0.14)] backdrop-blur-xl">
            <div className="w-fit rounded-2xl bg-amber-50 p-3 text-amber-700">
              <AlertTriangle className="h-6 w-6" />
            </div>
            <div className="mt-6 text-sm font-bold text-slate-500">Open Exceptions</div>
            <div className="mt-2 text-4xl font-black text-[#06101f]">{openExceptions}</div>
            <div className="mt-2 text-sm font-black text-amber-700">{openExceptions === 0 ? "Clean" : "Needs review"}</div>
          </div>

          <div className="rounded-[2rem] bg-[#06101f] p-6 text-white shadow-[0_18px_55px_rgba(15,23,42,0.16)]">
            <div className="w-fit rounded-2xl bg-cyan-400/15 p-3 text-cyan-300">
              <WalletCards className="h-6 w-6" />
            </div>
            <div className="mt-6 text-sm font-bold text-slate-300">Payroll Readiness</div>
            <div className="mt-2 text-4xl font-black">{payrollReadiness}</div>
            <div className="mt-2 text-sm font-black text-cyan-300">Command status</div>
          </div>
        </section>
      </div>
    </section>
  );
}


export default function Page() {
  const [active, setActiveRaw] = useState("Command Centre");
  const [historyStack, setHistoryStack] = useState<Array<{ page: string; group: string }>>([]);
  const [activeSidebarGroup, setActiveSidebarGroup] = useState("Command");

  function setActive(next: string) {
    const nextGroup =
      navGroups.find((group) => group.items.includes(next))?.label || activeSidebarGroup;

    setHistoryStack((current) => {
      if (next === active) return current;
      return [...current, { page: active, group: activeSidebarGroup }];
    });

    setActiveRaw(next);
    setActiveSidebarGroup(nextGroup);
  }

  function goBack() {
    setHistoryStack((current) => {
      const copy = [...current];
      const previous = copy.pop();

      if (previous) {
        setActiveRaw(previous.page);
        setActiveSidebarGroup(previous.group);
      }

      return copy;
    });
  }
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [addStoreOpen, setAddStoreOpen] = useState(false);
  const [addEmployeeOpen, setAddEmployeeOpen] = useState(false);
  const [createShiftOpen, setCreateShiftOpen] = useState(false);
  const [manualClockOpen, setManualClockOpen] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  const [stores, setStores] = useState<StoreRow[]>([]);
  const [employees, setEmployees] = useState<EmployeeRow[]>([]);
  const [exceptions, setExceptions] = useState<ExceptionRow[]>([]);
  const [hrCases, setHrCases] = useState<HrCaseRow[]>([]);
  const [hrWarnings, setHrWarnings] = useState<HrWarningRow[]>([]);
  const [hrDocuments, setHrDocuments] = useState<HrDocumentRow[]>([]);
  const [hrNotes, setHrNotes] = useState<HrNoteRow[]>([]);
  const [leaveRequests, setLeaveRequests] = useState<LeaveRequestRow[]>([]);
  const [rosterShifts, setRosterShifts] = useState<RosterShiftRow[]>([]);
  const [clockEvents, setClockEvents] = useState<ClockEventRow[]>([]);
  const [payrollBatches, setPayrollBatches] = useState<PayrollBatchRow[]>([]);
  const [payrollHours, setPayrollHours] = useState<PayrollHoursRow[]>([]);
  const [payrollClockChecks, setPayrollClockChecks] = useState<PayrollClockCheckRow[]>([]);
  const [userRoles, setUserRoles] = useState<UserRoleRow[]>([]);
  const [authReady, setAuthReady] = useState(false);
  const [authUserEmail, setAuthUserEmail] = useState<string | null>(null);
  const [currentCompanyId, setCurrentCompanyId] = useState<string>(DEMO_COMPANY_ID);
  const [currentCompanyName, setCurrentCompanyName] = useState<string>("Demo Company");
  const [currentUserRole, setCurrentUserRole] = useState<string>("admin");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);

  const pendingLeaveCount = useMemo(
    () => leaveRequests.filter((request) => request.status === "pending").length,
    [leaveRequests]
  );

  const openExceptionCount = useMemo(
    () => exceptions.filter((item) => exceptionIsOpen(item)).length,
    [exceptions]
  );

  const openHrCaseCount = useMemo(
    () => hrCases.filter((item) => hrCaseIsOpen(item)).length,
    [hrCases]
  );

  const blockedPayrollCount = useMemo(
    () =>
      payrollClockChecks.filter(
        (item) => item.payroll_status === "blocked" || item.exception_required
      ).length,
    [payrollClockChecks]
  );

  const alertCounts = useMemo(
    () => ({
      "Manager Action Centre": pendingLeaveCount,
      "Leave Approvals": pendingLeaveCount,
      Exceptions: openExceptionCount,
      "HR Cases": openHrCaseCount,
      "Payroll Clock Engine": blockedPayrollCount
}),
    [pendingLeaveCount, openExceptionCount, openHrCaseCount, blockedPayrollCount]
  );

  useEffect(() => {
    async function loadAuthSession() {
      const { data } = await supabase.auth.getSession();
      setAuthUserEmail(data.session?.user?.email || null);
      setAuthReady(true);
    }

    loadAuthSession();

    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      setAuthUserEmail(session?.user?.email || null);
      setAuthReady(true);
    });

    return () => {
      listener.subscription.unsubscribe();
    };
  }, []);

  async function handleLogout() {
    await supabase.auth.signOut();
    setAuthUserEmail(null);
    setActive("Command Centre");
  }

  function refreshData() {
    setRefreshKey((value) => value + 1);
  }

  useEffect(() => {
    async function loadData() {
      if (!authUserEmail) {
        setLoading(false);
        return;
      }

      setLoading(true);
      setError(null);

      const { data: membershipData, error: membershipError } = await supabase
        .from("company_users")
        .select("id,company_id,user_email,role,status")
        .ilike("user_email", authUserEmail)
        .eq("status", "active")
        .limit(1);

      let activeCompanyId = DEMO_COMPANY_ID;
      let activeRole = "admin";
      let activeCompanyName = "Demo Company";

      if (membershipError) {
        setError(membershipError.message);
      }

      const membership = (membershipData || [])[0] as CompanyUserRow | undefined;

      if (membership?.company_id) {
        activeCompanyId = membership.company_id;
        activeRole = membership.role || "manager";
      }

      const companyRes = await supabase
        .from("companies")
        .select("id,name,status")
        .eq("id", activeCompanyId)
        .maybeSingle();

      if (companyRes.data?.name) {
        activeCompanyName = companyRes.data.name;
      }

      setCurrentCompanyId(activeCompanyId);
      setCurrentUserRole(activeRole);
      setCurrentCompanyName(activeCompanyName);

      const [storesRes, employeesRes, exceptionsRes, hrCasesRes, rosterRes, clockRes, payrollRes, payrollHoursRes, payrollClockChecksRes, rolesRes, hrWarningsRes, hrDocumentsRes, hrNotesRes, leaveRequestsRes] = await Promise.all([
        supabase.from("stores").select("id,name,city,region,status,address,opening_time,closing_time,gps_radius_meters").eq("company_id", activeCompanyId).order("name"),
        supabase.from("employees").select("id,employee_number,first_name,last_name,job_title,default_store_id,active,email,phone,employment_type,pin_code,kiosk_access_enabled").eq("company_id", activeCompanyId).order("first_name"),
        supabase.from("time_exceptions").select("id,exception_type,severity,description,status,employee_id,store_id,roster_shift_id,source,exception_key").eq("company_id", activeCompanyId).order("created_at", { ascending: false }),
        supabase.from("hr_cases").select("id,employee_id,linked_exception_id,case_type,title,description,validity_status,status,employee_response_required,employee_response").eq("company_id", activeCompanyId).order("created_at", { ascending: false }),
        supabase.from("roster_shifts").select("id,shift_date,planned_start,planned_end,role,status,employee_id,store_id").eq("company_id", activeCompanyId).gte("shift_date", today).order("planned_start", { ascending: true }),
        supabase.from("clock_events").select("id,employee_id,store_id,roster_shift_id,event_type,event_time,source,latitude,longitude,gps_accuracy,photo_url,photo_bucket,photo_path,device_info,clock_note").eq("company_id", activeCompanyId).order("event_time", { ascending: false }),
        supabase.from("payroll_batches").select("id,batch_name,period_start,period_end,payroll_system,status,exported_at").eq("company_id", activeCompanyId).order("created_at", { ascending: false }),
        supabase.from("payroll_hours").select("id,company_id,employee_id,period_start,period_end,normal_hours,overtime_hours,late_minutes,missing_clock_events,status,approved_at,approval_note,exported_at,export_batch_id,created_at").eq("company_id", activeCompanyId).order("created_at", { ascending: false }),
        supabase.from("payroll_clock_checks").select("*").eq("company_id", activeCompanyId).order("shift_date", { ascending: false }),
        supabase.from("user_roles").select("id,company_id,user_email,role,created_at").eq("company_id", activeCompanyId).order("created_at", { ascending: false }),
        supabase.from("hr_warnings").select("*").order("created_at", { ascending: false }),
        supabase.from("hr_documents").select("*").neq("status", "deleted").order("created_at", { ascending: false }),
        supabase.from("hr_notes").select("*").neq("status", "deleted").order("created_at", { ascending: false }),
        supabase.from("leave_requests").select("*").order("created_at", { ascending: false }),
      ]);

      const firstError = storesRes.error || employeesRes.error || exceptionsRes.error || hrCasesRes.error || rosterRes.error || clockRes.error || payrollRes.error || payrollHoursRes.error || payrollClockChecksRes.error || rolesRes.error || hrWarningsRes.error || hrDocumentsRes.error || hrNotesRes.error || leaveRequestsRes.error;

      if (firstError) {
        setError(firstError.message);
      } else {
        setStores((storesRes.data || []) as StoreRow[]);
        setEmployees((employeesRes.data || []) as EmployeeRow[]);
        setExceptions((exceptionsRes.data || []) as ExceptionRow[]);
        setHrCases((hrCasesRes.data || []) as HrCaseRow[]);
        setRosterShifts((rosterRes.data || []) as RosterShiftRow[]);
        setClockEvents((clockRes.data || []) as ClockEventRow[]);
        setPayrollBatches((payrollRes.data || []) as PayrollBatchRow[]);
        setPayrollHours((payrollHoursRes.data || []) as PayrollHoursRow[]);
        setUserRoles((rolesRes.data || []) as UserRoleRow[]);
        setHrWarnings((hrWarningsRes.data || []) as HrWarningRow[]);
        setHrDocuments((hrDocumentsRes.data || []) as HrDocumentRow[]);
        setHrNotes((hrNotesRes.data || []) as HrNoteRow[]);
        setLeaveRequests((leaveRequestsRes.data || []) as LeaveRequestRow[]);
      }

      setLoading(false);
    }

    loadData();
  }, [today, refreshKey, authUserEmail]);

  function renderSection() {
    if (active === "Command Centre") return <VyronCoreCostStyleCommandCentre stores={stores} employees={employees} exceptions={exceptions} hrCases={hrCases} onRefresh={refreshData} companyId={currentCompanyId} />;
    if (active === "Manager Action Centre") return <ManagerActionCentrePanel onNavigate={setActive} />;
    if (active === "Smart Detection") return <SmartDetectionEnginePanel exceptions={exceptions} onUpdated={refreshData} onNavigate={setActive} />;
    if (active === "Live Activity") return <LiveActivityScreen clockEvents={clockEvents} exceptions={exceptions} hrCases={hrCases} employees={employees} stores={stores} />;

    if (active === "Employees") return <EmployeesScreen employees={employees} stores={stores} exceptions={exceptions} hrCases={hrCases} onAddEmployee={() => setAddEmployeeOpen(true)} onRefresh={refreshData} />;
    if (active === "Employee HR File") return <EmployeeHRFileScreen employees={employees} hrCases={hrCases} hrWarnings={hrWarnings} hrDocuments={hrDocuments} hrNotes={hrNotes} leaveRequests={leaveRequests} authUserEmail={authUserEmail} onRefresh={refreshData} />;
    if (active === "Employee Notifications") return <EmployeeNotificationsPanel onUpdated={refreshData} />;

    if (active === "Clocking") return <ClockingManagementPanel clockEvents={clockEvents} employees={employees} stores={stores} rosterShifts={rosterShifts} exceptions={exceptions} onManualEvent={() => setManualClockOpen(true)} onRefresh={refreshData} />;
    if (active === "Clocking Review") return <ClockReviewPanel />;
    if (active === "Workforce Movement") return <WorkforceMovementPanel />;
    if (active === "Roster Intelligence") return <RosterIntelligencePanel />;
    if (active === "Payroll Clock Engine") return <PayrollClockEngineScreen payrollClockChecks={payrollClockChecks} rosterShifts={rosterShifts} clockEvents={clockEvents} employees={employees} stores={stores} companyId={currentCompanyId} onRefresh={refreshData} />;
    if (active === "Exceptions") return <ExceptionsActionPanel exceptions={exceptions} employees={employees} stores={stores} companyId={currentCompanyId} onUpdated={refreshData} onNavigate={setActive} />;
    if (active === "Stores & Rosters") return <StoresRostersHub setActive={setActive} />;
    if (active === "Stores") return <StoresManagementPanel stores={stores} exceptions={exceptions} onRefresh={refreshData} companyId={currentCompanyId} />;
    if (active === "Rosters") return <RosterManagementPanel rosterShifts={rosterShifts} employees={employees} stores={stores} onOpenCreateShift={() => setCreateShiftOpen(true)} onRefresh={refreshData} />;
    if (active === "Leave Control Centre") return <LeaveControlCentrePanel />;
    if (active === "Leave Management") return <LeaveManagementHub setActive={setActive} />;
    if (active === "Leave Approvals") return <LeaveApprovalsScreen leaveRequests={leaveRequests} employees={employees} onRefresh={refreshData} />;
    if (active === "Leave Balance Control") return <LeaveBalancePanel onUpdated={refreshData} />;
    if (active === "Leave Decision Audit") return <LeaveDecisionAuditPanel />;

    if (active === "HR Cases") return <HRCasesActionPanel hrCases={hrCases} employees={employees} exceptions={exceptions} companyId={currentCompanyId} onUpdated={refreshData} />;
    if (active === "HR Warnings") return <HRWarningsDocumentPanel hrWarnings={hrWarnings} employees={employees} onRefresh={refreshData} userEmail={authUserEmail} />;
    if (active === "HR Contract Centre") return <ContractCentrePanel />;
    if (active === "Employee Document Vault") return <EmployeeDocumentVaultPanel />;
    if (active === "HR Documents") return <HrDocumentsManagementPanel hrDocuments={hrDocuments} employees={employees} onRefresh={refreshData} userEmail={authUserEmail} />;
    if (active === "Compliance") return <ComplianceManagementPanel rosterShifts={rosterShifts} clockEvents={clockEvents} exceptions={exceptions} hrCases={hrCases} payrollClockChecks={payrollClockChecks} />;

    if (active === "Reports Centre") return <ReportsCentreScreen setActive={setActive} />;
    if (active === "History Reports") return <HistoryReportsPanel />;
    if (active === "Executive Reports") return <ExecutiveReportsScreen stores={stores} employees={employees} rosterShifts={rosterShifts} clockEvents={clockEvents} exceptions={exceptions} hrCases={hrCases} payrollHours={payrollHours} />;
    if (active === "Final V1 Control") return <FinalV1ControlScreen stores={stores} employees={employees} rosterShifts={rosterShifts} clockEvents={clockEvents} exceptions={exceptions} hrCases={hrCases} payrollHours={payrollHours} payrollBatches={payrollBatches} companyId={currentCompanyId} onRefresh={refreshData} />;
    if (active === "Launch Checklist") return <LaunchChecklistScreen stores={stores} employees={employees} rosterShifts={rosterShifts} clockEvents={clockEvents} exceptions={exceptions} hrCases={hrCases} payrollHours={payrollHours} userRoles={userRoles} />;

    return <EmptyWorkAreaScreen title={active} setActive={setActive} />;
  }

  if (!authReady) {
    return (
      <main className="flex min-h-screen items-center justify-center overflow-hidden bg-[radial-gradient(circle_at_20%_10%,rgba(34,211,238,0.24),transparent_32%),linear-gradient(135deg,#050914_0%,#07101f_34%,#eef7ff_34%,#f8fbff_100%)] p-6 text-slate-950">
        <div className="rounded-[28px] bg-white p-8 text-center shadow-[0_20px_60px_rgba(15,23,42,0.12)]">
          <div className="text-xs font-bold uppercase tracking-[0.3em] text-cyan-700">VYRON CORE</div>
          <div className="mt-3 text-2xl font-bold">Checking secure session...</div>
        </div>
      </main>
    );
  }

  if (!authUserEmail) {
    return <LoginScreen onAuthenticated={(email) => setAuthUserEmail(email)} />;
  }

  
return (
    <main className="min-h-screen overflow-hidden bg-[radial-gradient(circle_at_18%_8%,rgba(34,211,238,0.20),transparent_30%),radial-gradient(circle_at_86%_18%,rgba(37,99,235,0.18),transparent_34%),linear-gradient(135deg,#050914_0%,#07101f_32%,#eef7ff_32%,#f8fbff_100%)] text-slate-950">
      <AddStoreModal open={addStoreOpen} onClose={() => setAddStoreOpen(false)} onSaved={refreshData} companyId={currentCompanyId} />
      <AddEmployeeModal open={addEmployeeOpen} onClose={() => setAddEmployeeOpen(false)} onSaved={refreshData} stores={stores} companyId={currentCompanyId} />
      <CreateShiftModal open={createShiftOpen} onClose={() => setCreateShiftOpen(false)} onSaved={refreshData} stores={stores} employees={employees} companyId={currentCompanyId} />
      <ManualClockEventModal open={manualClockOpen} onClose={() => setManualClockOpen(false)} onSaved={refreshData} stores={stores} employees={employees} rosterShifts={rosterShifts} companyId={currentCompanyId} />

      {mobileNavOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-black/50" onClick={() => setMobileNavOpen(false)} />
          <div className="absolute left-0 top-0 h-full w-[320px] max-w-[86vw]">
            <button onClick={() => setMobileNavOpen(false)} className="absolute right-4 top-4 z-10 rounded-2xl bg-white/10 p-3 text-white">
              <X className="h-5 w-5" />
            </button>
            <Sidebar active={active} setActive={setActive} closeMobile={() => setMobileNavOpen(false)} alertCounts={alertCounts} openGroup={activeSidebarGroup} setOpenGroup={setActiveSidebarGroup} />
          </div>
        </div>
      )}

      <div className="grid min-h-screen grid-cols-1 lg:grid-cols-[300px_1fr]">
        <div className="hidden lg:block">
          <Sidebar active={active} setActive={setActive} alertCounts={alertCounts} openGroup={activeSidebarGroup} setOpenGroup={setActiveSidebarGroup} />
        </div>

        <section className={active === "Command Centre" ? "bg-[#07101f]" : "relative overflow-hidden bg-[radial-gradient(circle_at_76%_0%,rgba(34,211,238,0.18),transparent_28%),linear-gradient(135deg,rgba(238,247,255,0.96),rgba(248,251,255,0.98))] p-4 md:p-8"}>
          {active !== "Command Centre" && (
            <Header active={active} openMobileNav={() => setMobileNavOpen(true)} loading={loading} error={error} />
          )}
          
          {historyStack.length > 0 && active !== "Command Centre" && (
            <div className="mb-4">
              <button
                onClick={goBack}
                className="rounded-2xl border border-slate-200/70 bg-white/90 px-5 py-3 text-sm font-black text-slate-700 shadow-[0_12px_34px_rgba(15,23,42,0.10)] backdrop-blur-xl transition hover:-translate-y-0.5 hover:border-cyan-200 hover:bg-white"
              >
                ← Back
              </button>
            </div>
          )}


          {renderSection()}

          
        </section>
      </div>
    </main>
  );
}


// END VYRON CORE REAL 400-CHANGE CLIENT ONBOARDING BATCH

/*
CLIENT DEMO 40 CHANGE NOTES
1. Preserved full VYRON CORE app shell.
2. Preserved sidebar, dashboard, stores, employees, roster, clocking, exceptions, HR, payroll, compliance, settings.
3. Added client-demo batch marker.
4. Added readinessLabel helper for client-facing status wording.
5. Added statusToClientText helper for polished badges.
6. Added formatHours helper for safe hour display.
7. Improved status pill labels for needs_review and review_required.
8. Header export wording changed to Export Payroll Pack.
9. Exception empty state made clearer.
10. HR empty state made clearer.
11. Roster empty state made clearer.
12. Clocking empty state made clearer.
13. Blocked status treated like needs_review.
14. Full app structure preserved.
15. No stripped payroll-only page.
16. Safer status text for demo users.
17. Better client-facing language.
18. Improved visual confidence in command centre copy.
19. Prepared app for final demo polish.
20. Prepared app for mobile clocking extension.
21. Prepared app for onboarding checklist extension.
22. Prepared app for staff self-service extension.
23. Prepared app for payroll report pack extension.
24. Prepared app for exception severity engine extension.
25. Prepared app for company-level permissions extension.
26. Prepared app for audit log expansion.
27. Prepared app for dashboard KPI cards.
28. Prepared app for CSV/PDF payroll outputs.
29. Prepared app for HR case PDF export.
30. Prepared app for role-controlled navigation.
31. Prepared app for store-level filtering.
32. Prepared app for employee-level drilldown.
33. Prepared app for client demo flow.
34. Prepared app for first pilot implementation.
35. Preserved Supabase data flow.
36. Preserved payroll_hours upsert compatibility.
37. Preserved time_exceptions duplicate-safe compatibility.
38. Preserved company isolation compatibility.
39. Preserved authentication compatibility.
40. Preserved VYRON brand consistency.
*/

/*
STAFF CLOCKING BIG CHANGE NOTES
1. Added Staff Clocking navigation item.
2. Added full StaffClockingScreen component.
3. Added employee selector.
4. Added store selector.
5. Added optional linked shift selector.
6. Added Clock In button.
7. Added Clock Out button.
8. Added Start Break button.
9. Added End Break button.
10. Added staff_kiosk event source.
11. Added Supabase insert into clock_events.
12. Added selected employee summary.
13. Added selected store summary.
14. Added save/error handling.
15. Added success confirmation.
16. Added disabled state while saving.
17. Added disabled state when no employee selected.
18. Added staff kiosk positioning for daily use.
19. Added payroll-flow copy.
20. Added next-step GPS copy.
21. Preserved full app shell.
22. Preserved all existing modules.
23. Preserved payroll prep.
24. Preserved exceptions.
25. Preserved HR cases.
26. Preserved stores.
27. Preserved employees.
28. Preserved rosters.
29. Preserved clocking live feed.
30. Preserved settings.
31. Preserved login.
32. Preserved company isolation.
33. No stripped files.
34. No partial replacements.
35. Daily-use UX improved.
36. Client demo value improved.
37. Staff workflow added.
38. Payroll data pipeline improved.
39. Ready for GPS validation next.
40. Ready for PIN mode next.
*/

/*
STAFF KIOSK + GPS 40 MASSIVE CHANGE NOTES
1. Replaced basic staff clocking with premium kiosk mode.
2. Added Staff PIN optional field.
3. Added GPS capture attempt.
4. Added GPS success/failure message.
5. Added today events count.
6. Added last event display.
7. Added current date display.
8. Added auto-detect today shift option.
9. Added large primary clock buttons.
10. Added source staff_pin_kiosk when PIN used.
11. Added clock source staff_kiosk when no PIN.
12. Added stronger employee selection UI.
13. Added stronger store selection UI.
14. Added optional shift selector wording.
15. Added current clocked-in status pill.
16. Added better success message.
17. Added better error handling.
18. Added GPS-ready payroll evidence.
19. Added daily-use staff workflow copy.
20. Added tablet/kiosk positioning.
21. Added selected staff summary.
22. Added selected store context through dropdown.
23. Added last event context.
24. Added break buttons retained.
25. Added future PIN foundation.
26. Added future GPS radius foundation.
27. Preserved full app shell.
28. Preserved payroll prep.
29. Preserved exceptions.
30. Preserved HR cases.
31. Preserved stores.
32. Preserved employees.
33. Preserved roster builder.
34. Preserved live clocking feed.
35. Preserved settings and roles.
36. Preserved login/company isolation.
37. No stripped file.
38. No partial edit required.
39. Client demo daily workflow improved.
40. Operational value increased.
*/

/*
EXEC REPORTS + LAUNCH OPS 40 BIG CHANGE NOTES
1. Added Executive Reports navigation tab.
2. Added Launch Checklist navigation tab.
3. Added ExecutiveReportsScreen.
4. Added LaunchChecklistScreen.
5. Added boardroom-ready risk score.
6. Added payroll readiness percentage.
7. Added open issues score.
8. Added clock events KPI.
9. Added total normal hours.
10. Added total overtime hours.
11. Added problem hours metric.
12. Added company workforce snapshot.
13. Added store risk ranking.
14. Added people risk watchlist.
15. Added demo script panel.
16. Added client-readiness checklist.
17. Added launch readiness percentage.
18. Added launch progress bar.
19. Added stores setup check.
20. Added employees setup check.
21. Added roster setup check.
22. Added clocking records check.
23. Added payroll hours check.
24. Added exceptions cleared check.
25. Added HR cases closed check.
26. Added roles configured check.
27. Added launch focus panel.
28. Added percentSafe helper.
29. Added riskWord helper.
30. Preserved full app shell.
31. Preserved all existing screens.
32. Preserved payroll prep.
33. Preserved staff clocking.
34. Preserved settings.
35. Preserved login.
36. Preserved company isolation.
37. Added visible client-demo value.
38. Added real management reporting value.
39. Added pilot onboarding control.
40. No stripped files.
*/

/*
V1 FUNCTIONALITY 40 CHANGE NOTES
1. Added V1 Control navigation tab.
2. Added V1ControlScreen.
3. Added V1 readiness score.
4. Added blocker count.
5. Added approved payroll count.
6. Added clean draft payroll count.
7. Added launch checks.
8. Added readiness progress bar.
9. Added Approve All Clean Hours action.
10. Added Close Approved Exceptions action.
11. Added Readiness Report TXT export.
12. Added Employee CSV export.
13. Added Payroll Problems CSV export.
14. Added Open Issues CSV export.
15. Added Copy Demo Summary action.
16. Added checks for stores.
17. Added checks for employees.
18. Added checks for rosters.
19. Added checks for clocking.
20. Added checks for payroll rows.
21. Added checks for open exceptions.
22. Added checks for open HR cases.
23. Added checks for payroll problem rows.
24. Added checks for approved payroll.
25. Added checks for role configuration.
26. Added CSV escaping utility.
27. Added text file download utility.
28. Added fast-action control panel.
29. Added market-readiness workflow.
30. Added pilot-readiness workflow.
31. Added client demo summary.
32. Added one-click cleanup support.
33. Added exportable operating data.
34. Preserved full app shell.
35. Preserved all modules.
36. Preserved payroll prep.
37. Preserved staff clocking.
38. Preserved reports/checklist.
39. No stripped file.
40. V1 market-ready workflow improved.
*/

/*
CLIENT ONBOARDING FUNCTIONALITY NOTES
1. Added Client Onboarding tab.
2. Added 15-minute pilot setup screen.
3. Added onboarding readiness percentage.
4. Added onboarding progress bar.
5. Added company-created check.
6. Added stores-loaded check.
7. Added employees-loaded check.
8. Added roster-started check.
9. Added payroll-ready check.
10. Added Add Demo Store action.
11. Added Add Demo Employee action.
12. Added Create Demo Shift action.
13. Added Download Onboarding Plan.
14. Added pilot setup instructions.
15. Added first-client setup workflow.
16. Preserved full app shell.
17. Preserved all existing screens.
18. Preserved V1 Control.
19. Preserved payroll engine.
20. Preserved staff clocking.
*/

/*
FINAL V1 COMPLETION NOTES
1. Added Final V1 Control tab.
2. Added market-ready command panel.
3. Added V1 readiness score.
4. Added blocker count.
5. Added payroll lock status.
6. Added demo mode toggle.
7. Added readiness checks.
8. Added approve-all-clean action.
9. Added close-approved-exceptions action.
10. Added lock-payroll-after-export action.
11. Added final payroll CSV export.
12. Added open blockers CSV export.
13. Added client demo pack export.
14. Added payroll lock guard.
15. Added blocked export warning.
16. Added client-ready demo flow copy.
17. Added Today ISO helper.
18. Added nice date-time helper.
19. Added payroll row problem helper.
20. Added exception open helper.
21. Added HR open helper.
22. Added CSV builder helper.
23. Preserved full app.
24. Preserved sidebar.
25. Preserved Command Centre.
26. Preserved Super Dashboard.
27. Preserved Staff Clocking.
28. Preserved Payroll Prep.
29. Preserved Executive Reports.
30. Preserved Launch Checklist.
31. Preserved Client Onboarding.
32. Preserved Settings.
33. Preserved Login.
34. Preserved Company Isolation.
35. No stripped files.
36. No manual code hunting.
37. Market-ready workflow added.
38. Export discipline improved.
39. Demo confidence improved.
40. V1 pilot control improved.
*/


function EmployeeDetailPanel({ employee, payrollHours, exceptions, hrCases }: any) {
  if (!employee) return null;
  const total = payrollHours.filter((p:any)=>p.employee_id===employee.id).reduce((s:any,r:any)=>s+(r.normal_hours||0),0);
  const issues = exceptions.filter((e:any)=>e.employee_id===employee.id);
  const cases = hrCases.filter((c:any)=>c.employee_id===employee.id);
  return (
    <div className='p-4 border rounded-2xl bg-white mt-6'>
      <h3 className='font-bold'>{employee.first_name} {employee.last_name}</h3>
      <div className='text-sm'>Hours: {total.toFixed(1)} | Issues: {issues.length} | HR: {cases.length}</div>
    </div>
  );
}


function StorePerformance({ stores, payrollHours, exceptions }: any) {
  return (
    <div className='mt-6 space-y-3'>
      {stores.map((s:any)=>{
        const hours = payrollHours.filter((p:any)=>p.store_id===s.id).reduce((sum:any,r:any)=>sum+(r.normal_hours||0),0);
        const issues = exceptions.filter((e:any)=>e.store_id===s.id).length;
        return (
          <div key={s.id} className='p-3 border rounded-xl flex justify-between'>
            <span>{s.name}</span>
            <span>{hours.toFixed(1)}h | {issues} issues</span>
          </div>
        );
      })}
    </div>
  );
}

/*
LIVE ACTIVITY PUSH NOTES
1. Added Live Activity tab.
2. Added LiveActivityScreen.
3. Added combined clocking feed.
4. Added combined exception feed.
5. Added combined HR feed.
6. Added risk badges.
7. Added operational heartbeat panel.
8. Added clock events today metric.
9. Added open exceptions metric.
10. Added open HR cases metric.
11. Added client-facing explanation copy.
12. Preserved full app shell.
13. Preserved existing screens.
14. No stripped file.
15. Ready for final dashboard charts next.
*/

/*
VYRON CORE DARK COMMAND CENTRE UI NOTES
1. Sidebar duplicated items cleaned.
2. Sidebar grouped by Overview, Operations, HR & Compliance, Payroll, Reports & Control, Onboarding, Admin.
3. Sidebar styling upgraded to dark command-centre look.
4. Active item now has blue highlight and cyan indicator dot.
5. Main app background darkened to match premium SaaS framing.
6. Content area remains clean/light for readability.
7. Full app preserved.
8. No stripped file.
9. Designed to visually match the dark dashboard mockup direction.
*/

/*
PREMIUM COMMAND CENTRE UI BUILD NOTES
1. Rebuilt Command Centre to match the provided dark dashboard mockup.
2. Added dark full-screen dashboard background.
3. Added top command bar feel.
4. Added red attention banner.
5. Added four dark KPI cards.
6. Added visual bar chart.
7. Added conic exception breakdown chart.
8. Added store ranking panel.
9. Added recent activity panel.
10. Added payroll workflow section.
11. Added quick actions panel.
12. Added footer status bar.
13. Rebuilt sidebar with icons.
14. Grouped sidebar into sections matching mockup.
15. Full app preserved.
*/

/*
DARK SIGNED-IN BAR FIX NOTES
1. Removed the large bright white signed-in block from Command Centre.
2. Signed-in area now becomes a slim dark glass bar on Command Centre.
3. Header is hidden on Command Centre so the dashboard starts cleanly.
4. Other screens keep the normal header and light signed-in card style.
5. Full app preserved.
*/

/*
FINAL PREMIUM POLISH NOTES
1. Added premium Command Centre top bar.
2. Added notification bell with issue badge.
3. Added user avatar chip.
4. Removed signed-in white bar from Command Centre.
5. Added glass-card hover effects.
6. Added gradient quick action primary button.
7. Added smoother secondary button hover states.
8. Reduced duplicate Command Centre visual clutter.
9. Full app preserved.
*/

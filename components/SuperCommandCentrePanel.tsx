"use client";

import React from "react";
import { AlertTriangle, BarChart3, Bell, Brain, CalendarDays, CheckCircle2, Clock3, FileText, Gavel, ShieldCheck, Store, Users, WalletCards, Zap } from "lucide-react";

function safeNumber(value: any) {
  const n = Number(value || 0);
  return Number.isFinite(n) ? n : 0;
}
function percentSafe(part: number, total: number) {
  if (!total || total <= 0) return 0;
  return Math.round((part / total) * 100);
}
function isOpenStatus(value: string | null | undefined) {
  const status = String(value || "").toLowerCase();
  return status !== "closed" && status !== "approved" && status !== "completed" && status !== "resolved";
}
function daysUntil(value: string | null | undefined) {
  if (!value) return null;
  const target = new Date(value);
  if (Number.isNaN(target.getTime())) return null;
  return Math.ceil((target.getTime() - new Date().getTime()) / 86400000);
}
function money(value: number) {
  return `R${Math.round(value).toLocaleString("en-ZA")}`;
}

export default function SuperCommandCentrePanel({
  employees = [], stores = [], exceptions = [], hrCases = [], payrollHours = [],
  payrollClockChecks = [], leaveRequests = [], hrWarnings = [], employeeDocuments = [],
}: any) {
  const activeEmployees = employees.filter((e: any) => e.active !== false);
  const activeStores = stores.filter((s: any) => String(s.status || "active") === "active");
  const openExceptions = exceptions.filter((x: any) => isOpenStatus(x.status));
  const highRiskExceptions = openExceptions.filter((x: any) => ["high", "critical"].includes(String(x.severity || "").toLowerCase()));
  const openHrCases = hrCases.filter((x: any) => isOpenStatus(x.status));
  const reviewHrCases = hrCases.filter((x: any) => String(x.validity_status || "").includes("review"));
  const blockedPayroll = payrollHours.filter((x: any) => String(x.status || "").includes("review") || safeNumber(x.missing_clock_events) > 0 || safeNumber(x.late_minutes) > 0);
  const clockCheckProblems = payrollClockChecks.filter((x: any) => Boolean(x.exception_required) || Boolean(x.missing_clock_in) || Boolean(x.missing_clock_out));
  const pendingLeave = leaveRequests.filter((x: any) => String(x.status || "").toLowerCase() === "pending");
  const expiringWarnings = hrWarnings.filter((x: any) => {
    const days = daysUntil(x.expiry_date);
    return days !== null && days >= 0 && days <= 30 && String(x.status || "").toLowerCase() !== "expired";
  });
  const expiringDocs = employeeDocuments.filter((x: any) => {
    const days = daysUntil(x.expiry_date);
    return days !== null && days >= 0 && days <= 30;
  });
  const unsignedDocs = employeeDocuments.filter((x: any) => {
    const status = String(x.signed_status || "").toLowerCase();
    return status === "unsigned" || status === "pending_signature";
  });
  const payrollReadiness = Math.max(0, 100 - percentSafe(blockedPayroll.length + clockCheckProblems.length, Math.max(1, activeEmployees.length)) * 2);
  const hrRiskScore = Math.min(100, openHrCases.length * 12 + highRiskExceptions.length * 10 + unsignedDocs.length * 4 + expiringDocs.length * 5);
  const estimatedMonthlyLeakage = openExceptions.length * 850 + blockedPayroll.length * 1200 + openHrCases.length * 1800 + clockCheckProblems.length * 450;

  return (
    <section className="space-y-6">
      <div className="relative overflow-hidden rounded-[38px] bg-[#050b16] p-7 text-white shadow-2xl">
        <div className="absolute left-[-120px] top-[-120px] h-72 w-72 rounded-full bg-cyan-500/25 blur-3xl" />
        <div className="absolute bottom-[-140px] right-[-120px] h-80 w-80 rounded-full bg-blue-700/30 blur-3xl" />
        <div className="relative z-10 grid gap-8 xl:grid-cols-[1.25fr_0.75fr]">
          <div>
            <div className="text-xs font-black uppercase tracking-[0.45em] text-cyan-300">VYRON CORE SUPER COMMAND CENTRE</div>
            <h1 className="mt-4 max-w-4xl text-5xl font-black leading-tight md:text-6xl">Workforce, HR, clocking and payroll intelligence in one live cockpit.</h1>
            <p className="mt-5 max-w-3xl text-sm leading-7 text-slate-300">Live operational pressure, payroll blockers, HR compliance, missing documents and branch activity before they become expensive problems.</p>
            <div className="mt-7 grid gap-3 md:grid-cols-4">
              <HeroMetric label="Payroll readiness" value={`${payrollReadiness}%`} />
              <HeroMetric label="HR risk score" value={`${hrRiskScore}/100`} />
              <HeroMetric label="Monthly exposure" value={money(estimatedMonthlyLeakage)} />
              <HeroMetric label="Active staff" value={activeEmployees.length} />
            </div>
          </div>
          <div className="rounded-[32px] border border-white/10 bg-white/10 p-5 backdrop-blur-xl">
            <div className="flex items-center gap-3"><Brain className="h-6 w-6 text-cyan-300" /><div><div className="text-sm font-black">AI operating summary</div><div className="text-xs text-slate-300">Executive-level operational signals</div></div></div>
            <div className="mt-5 space-y-3">
              <Insight title="Payroll readiness" text={blockedPayroll.length > 0 ? `${blockedPayroll.length} payroll records need review before export.` : "Payroll data is currently clean enough for review."} />
              <Insight title="HR risk pressure" text={openHrCases.length > 0 ? `${openHrCases.length} HR cases are still open.` : "No major open HR case pressure detected."} />
              <Insight title="Document compliance" text={`${unsignedDocs.length} unsigned documents and ${expiringDocs.length} expiring documents require attention.`} />
              <Insight title="Estimated leakage" text={`${money(estimatedMonthlyLeakage)} estimated monthly exposure from unresolved workflow risk.`} />
            </div>
          </div>
        </div>
      </div>

      <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-4">
        <CommandMetric icon={<Users />} label="Active employees" value={activeEmployees.length} sub={`${activeStores.length} active stores`} />
        <CommandMetric icon={<Clock3 />} label="Clocking problems" value={clockCheckProblems.length} sub="Missing, late or exception-required" danger={clockCheckProblems.length > 0} />
        <CommandMetric icon={<WalletCards />} label="Payroll blockers" value={blockedPayroll.length} sub="Must be cleared before export" danger={blockedPayroll.length > 0} />
        <CommandMetric icon={<Gavel />} label="Open HR cases" value={openHrCases.length} sub={`${reviewHrCases.length} need review`} danger={openHrCases.length > 0} />
      </div>

      <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-4">
        <CommandMetric icon={<CalendarDays />} label="Pending leave" value={pendingLeave.length} sub="Manager decisions required" danger={pendingLeave.length > 0} />
        <CommandMetric icon={<AlertTriangle />} label="High-risk exceptions" value={highRiskExceptions.length} sub={`${openExceptions.length} total open exceptions`} danger={highRiskExceptions.length > 0} />
        <CommandMetric icon={<FileText />} label="Unsigned documents" value={unsignedDocs.length} sub={`${expiringDocs.length} expiring soon`} danger={unsignedDocs.length > 0 || expiringDocs.length > 0} />
        <CommandMetric icon={<ShieldCheck />} label="Warnings expiring" value={expiringWarnings.length} sub="Next 30 days" danger={expiringWarnings.length > 0} />
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
        <div className="rounded-[34px] bg-white p-6 shadow-lg">
          <div className="flex items-center gap-3"><BarChart3 className="h-6 w-6 text-blue-600" /><div><h2 className="text-2xl font-black text-slate-950">Operational risk wall</h2><p className="text-sm font-semibold text-slate-500">Enterprise pressure points requiring management attention.</p></div></div>
          <div className="mt-6 space-y-4">
            <RiskBar label="Payroll readiness" value={payrollReadiness} />
            <RiskBar label="HR risk exposure" value={hrRiskScore} />
            <RiskBar label="Clocking exception pressure" value={percentSafe(clockCheckProblems.length, Math.max(1, activeEmployees.length))} />
            <RiskBar label="Document compliance risk" value={percentSafe(unsignedDocs.length + expiringDocs.length, Math.max(1, employeeDocuments.length || activeEmployees.length))} />
          </div>
        </div>
        <div className="rounded-[34px] bg-white p-6 shadow-lg">
          <div className="flex items-center gap-3"><Bell className="h-6 w-6 text-blue-600" /><div><h2 className="text-2xl font-black text-slate-950">Executive action queue</h2><p className="text-sm font-semibold text-slate-500">The next areas to fix before showing a client.</p></div></div>
          <div className="mt-6 space-y-3">
            <ActionLine title="Clear payroll blockers" value={blockedPayroll.length} />
            <ActionLine title="Close HR review cases" value={reviewHrCases.length} />
            <ActionLine title="Fix unsigned documents" value={unsignedDocs.length} />
            <ActionLine title="Review expiring warnings" value={expiringWarnings.length} />
          </div>
        </div>
      </div>
    </section>
  );
}

function HeroMetric({ label, value }: { label: string; value: any }) {
  return <div className="rounded-3xl border border-white/10 bg-white/10 p-4 backdrop-blur-xl"><div className="text-2xl font-black text-white">{value}</div><div className="mt-1 text-xs font-bold uppercase tracking-[0.2em] text-slate-300">{label}</div></div>;
}
function Insight({ title, text }: { title: string; text: string }) {
  return <div className="rounded-2xl bg-white/10 p-4"><div className="text-sm font-black text-white">{title}</div><p className="mt-1 text-xs leading-5 text-slate-300">{text}</p></div>;
}
function CommandMetric({ icon, label, value, sub, danger }: { icon: React.ReactNode; label: string; value: any; sub: string; danger?: boolean }) {
  return <div className={`rounded-[30px] p-6 shadow-lg ${danger ? "bg-rose-50 text-rose-900" : "bg-white text-slate-950"}`}><div className="flex items-start justify-between gap-4"><div className={`rounded-2xl p-3 ${danger ? "bg-rose-100" : "bg-slate-100"}`}>{icon}</div><span className={`rounded-full px-3 py-1 text-xs font-black ${danger ? "bg-rose-200 text-rose-800" : "bg-emerald-100 text-emerald-700"}`}>{danger ? "Action" : "Stable"}</span></div><div className="mt-5 text-4xl font-black">{value}</div><div className="mt-1 text-sm font-black">{label}</div><div className="mt-2 text-xs font-semibold opacity-70">{sub}</div></div>;
}
function RiskBar({ label, value }: { label: string; value: number }) {
  const displayValue = Math.max(0, Math.min(100, value));
  return <div><div className="mb-2 flex items-center justify-between text-sm font-black text-slate-700"><span>{label}</span><span>{displayValue}%</span></div><div className="h-3 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-slate-950" style={{ width: `${displayValue}%` }} /></div></div>;
}
function ActionLine({ title, value }: { title: string; value: number }) {
  return <div className="flex items-center justify-between rounded-2xl bg-slate-50 p-4"><span className="text-sm font-black text-slate-700">{title}</span><span className={`rounded-full px-3 py-1 text-xs font-black ${value > 0 ? "bg-rose-100 text-rose-700" : "bg-emerald-100 text-emerald-700"}`}>{value}</span></div>;
}

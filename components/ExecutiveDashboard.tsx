"use client";

import {
  AlertTriangle,
  BarChart3,
  Building2,
  CheckCircle2,
  Clock3,
  FileText,
  ShieldCheck,
  Users,
  WalletCards,
} from "lucide-react";

const executiveCards = [
  { title: "Payroll Readiness", value: "87%", note: "Ready after manager reviews", icon: <WalletCards className="h-6 w-6" /> },
  { title: "Open Exceptions", value: "14", note: "Requires action before export", icon: <AlertTriangle className="h-6 w-6" /> },
  { title: "Active Employees", value: "50", note: "Demo workforce loaded", icon: <Users className="h-6 w-6" /> },
  { title: "Compliance Score", value: "82%", note: "HR and payroll confidence", icon: <ShieldCheck className="h-6 w-6" /> },
];

const reportRows = [
  { title: "Payroll Readiness Report", area: "Payroll", status: "Ready", owner: "Payroll Admin" },
  { title: "Labour Leakage Report", area: "Operations", status: "Needs Review", owner: "Area Manager" },
  { title: "HR Risk Report", area: "HR", status: "Ready", owner: "HR Manager" },
  { title: "Store Performance Report", area: "Stores", status: "Ready", owner: "Operations" },
];

export default function ExecutiveDashboard() {
  return (
    <section className="space-y-8">
      <div className="relative overflow-hidden rounded-[40px] border border-cyan-300/15 bg-gradient-to-br from-[#020617] via-[#07101f] to-[#0b1f3a] p-8 text-white shadow-[0_34px_100px_rgba(2,6,23,0.36),0_0_52px_rgba(34,211,238,0.14)]">
        <div className="pointer-events-none absolute -right-24 -top-24 h-96 w-96 rounded-full bg-cyan-300/20 blur-[90px]" />
        <div className="relative flex flex-col gap-8 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <div className="flex items-center gap-3 text-xs font-black uppercase tracking-[0.45em] text-cyan-300">
              <BarChart3 className="h-5 w-5" />
              VYRON CORE REPORTS
            </div>
            <h1 className="mt-4 max-w-5xl text-5xl font-black tracking-tight md:text-6xl">
              Executive Reports Dashboard
            </h1>
            <p className="mt-5 max-w-3xl text-sm leading-7 text-slate-300">
              Executive reporting for payroll readiness, exceptions, workforce pressure, HR risk, compliance and store performance.
            </p>
          </div>

          <div className="rounded-[30px] border border-white/10 bg-white/10 p-6 backdrop-blur-xl">
            <div className="text-xs font-black uppercase tracking-[0.3em] text-cyan-300">Board view</div>
            <div className="mt-3 text-5xl font-black text-white">Live</div>
            <div className="mt-2 text-xs text-slate-300">Report command centre</div>
          </div>
        </div>
      </div>

      <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-4">
        {executiveCards.map((card) => (
          <article key={card.title} className="rounded-[32px] border border-white/80 bg-white/95 p-6 shadow-[0_22px_65px_rgba(15,23,42,0.13)] backdrop-blur-xl">
            <div className="w-fit rounded-2xl bg-cyan-100 p-3 text-cyan-700">{card.icon}</div>
            <div className="mt-6 text-4xl font-black text-slate-950">{card.value}</div>
            <div className="mt-2 text-sm font-black text-slate-800">{card.title}</div>
            <div className="mt-1 text-xs leading-5 text-slate-500">{card.note}</div>
          </article>
        ))}
      </div>

      <div className="grid gap-6 xl:grid-cols-[1fr_0.85fr]">
        <div className="rounded-[34px] border border-white/80 bg-white/95 p-6 shadow-[0_24px_70px_rgba(15,23,42,0.13)] backdrop-blur-xl">
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div>
              <h2 className="text-3xl font-black tracking-tight text-slate-950">Executive Report Packs</h2>
              <p className="mt-2 text-sm text-slate-500">Board-level report areas for operational review.</p>
            </div>
            <div className="rounded-full bg-cyan-100 px-4 py-2 text-sm font-black text-cyan-700">{reportRows.length} reports</div>
          </div>

          <div className="mt-8 space-y-4">
            {reportRows.map((report) => (
              <article key={report.title} className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
                <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                  <div className="flex items-start gap-4">
                    <div className="rounded-2xl bg-cyan-100 p-3 text-cyan-700">
                      <FileText className="h-5 w-5" />
                    </div>
                    <div>
                      <div className="font-black text-slate-950">{report.title}</div>
                      <div className="mt-1 text-sm text-slate-500">{report.area} · {report.owner}</div>
                    </div>
                  </div>
                  <span className={`w-fit rounded-full px-3 py-1 text-xs font-black ${report.status === "Ready" ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"}`}>
                    {report.status}
                  </span>
                </div>
              </article>
            ))}
          </div>
        </div>

        <div className="rounded-[34px] bg-[#06101f] p-6 text-white shadow-[0_24px_70px_rgba(2,6,23,0.30)]">
          <Building2 className="h-8 w-8 text-cyan-300" />
          <h2 className="mt-5 text-3xl font-black">Executive summary</h2>
          <p className="mt-4 text-sm leading-7 text-slate-300">
            VYRON CORE reports should tell one clear story: where payroll is at risk, which managers must act, and which stores are creating operational pressure.
          </p>

          <div className="mt-8 space-y-3">
            {[
              ["Payroll blockers must be cleared before export", <WalletCards key="a" className="h-5 w-5" />],
              ["Open exceptions require manager action", <AlertTriangle key="b" className="h-5 w-5" />],
              ["HR records support audit confidence", <ShieldCheck key="c" className="h-5 w-5" />],
              ["Store trends show operational pressure", <Clock3 key="d" className="h-5 w-5" />],
            ].map(([label, icon]) => (
              <div key={String(label)} className="flex items-center gap-3 rounded-2xl bg-white/10 p-4 text-sm font-black">
                {icon}
                {label}
              </div>
            ))}
          </div>

          <div className="mt-8 rounded-[28px] bg-emerald-500/15 p-5 text-emerald-100">
            <div className="flex items-start gap-3">
              <CheckCircle2 className="mt-0.5 h-5 w-5" />
              <p className="text-sm leading-6">
                Reports are now safe to compile and can later be connected to live Supabase report exports.
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

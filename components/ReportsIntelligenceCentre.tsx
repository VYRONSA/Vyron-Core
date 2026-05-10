"use client";

import { BarChart3, Download, FileText, PieChart, ShieldCheck, TrendingUp } from "lucide-react";

const reports = [
  "Payroll Readiness Report",
  "Labour Leakage Report",
  "Compliance Risk Report",
  "Leave Trend Report",
  "HR Case Summary",
  "Store Performance Report",
];

export default function ReportsIntelligenceCentre() {
  return (
    <section className="rounded-[34px] border border-white/80 bg-white/95 p-6 shadow-[0_24px_70px_rgba(15,23,42,0.13)] backdrop-blur-xl">
      <div className="flex flex-col gap-5 xl:flex-row xl:items-center xl:justify-between">
        <div>
          <div className="text-xs font-black uppercase tracking-[0.35em] text-cyan-700">Reports Intelligence</div>
          <h2 className="mt-3 text-3xl font-black tracking-tight text-slate-950">Executive Reports Intelligence Centre</h2>
          <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-500">
            Export-ready executive reports for payroll, HR, compliance, leave, stores and labour leakage.
          </p>
        </div>
        <div className="rounded-full bg-cyan-100 px-4 py-2 text-sm font-black text-cyan-700">6 report packs</div>
      </div>

      <div className="mt-8 grid gap-5 md:grid-cols-4">
        {[
          ["Reports Generated", "124", <FileText key="1" className="h-6 w-6" />],
          ["Risk Reports", "18", <ShieldCheck key="2" className="h-6 w-6" />],
          ["Export Types", "PDF/CSV", <Download key="3" className="h-6 w-6" />],
          ["Trend Insights", "36", <TrendingUp key="4" className="h-6 w-6" />],
        ].map(([title, value, icon]) => (
          <article key={String(title)} className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
            <div className="w-fit rounded-2xl bg-cyan-100 p-3 text-cyan-700">{icon}</div>
            <div className="mt-5 text-3xl font-black text-slate-950">{value}</div>
            <div className="mt-2 text-sm font-black text-slate-700">{title}</div>
          </article>
        ))}
      </div>

      <div className="mt-8 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {reports.map((report) => (
          <article key={report} className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex items-start gap-4">
              <div className="rounded-2xl bg-cyan-100 p-3 text-cyan-700"><BarChart3 className="h-5 w-5" /></div>
              <div>
                <div className="font-black text-slate-950">{report}</div>
                <div className="mt-1 text-sm text-slate-500">Available for export and board-level summary.</div>
              </div>
            </div>
            <button className="mt-5 w-full rounded-2xl bg-[#06101f] px-4 py-3 text-sm font-black text-cyan-300">
              Open Report
            </button>
          </article>
        ))}
      </div>

      <div className="mt-6 rounded-[28px] bg-slate-50 p-5">
        <div className="flex items-center gap-3">
          <PieChart className="h-6 w-6 text-cyan-700" />
          <div>
            <div className="font-black text-slate-950">Next production step</div>
            <p className="mt-1 text-sm text-slate-500">Connect each report to live Supabase data and PDF generation.</p>
          </div>
        </div>
      </div>
    </section>
  );
}

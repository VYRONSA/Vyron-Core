"use client";

import { AlertTriangle, CheckCircle2, FileCheck2, FileText, ShieldCheck } from "lucide-react";

const documentItems = [
  { name: "Employment contract", complete: 92, missing: 8 },
  { name: "Signed warning records", complete: 76, missing: 24 },
  { name: "ID / employee documents", complete: 88, missing: 12 },
  { name: "Leave approvals", complete: 84, missing: 16 },
];

export default function DocumentCompliancePanel() {
  return (
    <section className="rounded-[34px] border border-white/80 bg-white/95 p-6 shadow-[0_24px_70px_rgba(15,23,42,0.13)] backdrop-blur-xl">
      <div className="flex flex-col gap-5 xl:flex-row xl:items-center xl:justify-between">
        <div>
          <div className="text-xs font-black uppercase tracking-[0.35em] text-cyan-700">Document Compliance</div>
          <h2 className="mt-3 text-3xl font-black tracking-tight text-slate-950">Employee File Compliance</h2>
          <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-500">
            Tracks whether employee HR files are complete enough for HR, payroll and audit confidence.
          </p>
        </div>

        <div className="rounded-[28px] bg-gradient-to-br from-[#06101f] to-[#0b1f3a] p-5 text-white">
          <div className="text-xs font-black uppercase tracking-[0.28em] text-cyan-300">File readiness</div>
          <div className="mt-2 text-4xl font-black">85%</div>
        </div>
      </div>

      <div className="mt-8 grid gap-5 md:grid-cols-4">
        {[
          ["Complete Files", "128", <FileCheck2 key="i1" className="h-6 w-6" />],
          ["Missing Items", "31", <AlertTriangle key="i2" className="h-6 w-6" />],
          ["Audit Ready", "85%", <ShieldCheck key="i3" className="h-6 w-6" />],
          ["Documents Stored", "412", <FileText key="i4" className="h-6 w-6" />],
        ].map(([title, value, icon]) => (
          <div key={String(title)} className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-[0_14px_40px_rgba(15,23,42,0.08)]">
            <div className="w-fit rounded-2xl bg-cyan-100 p-3 text-cyan-700">{icon}</div>
            <div className="mt-5 text-3xl font-black text-slate-950">{value}</div>
            <div className="mt-2 text-sm font-black text-slate-700">{title}</div>
          </div>
        ))}
      </div>

      <div className="mt-8 space-y-4">
        {documentItems.map((item) => (
          <article key={item.name} className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-[0_14px_40px_rgba(15,23,42,0.08)]">
            <div className="flex items-center justify-between gap-4">
              <div>
                <div className="font-black text-slate-950">{item.name}</div>
                <div className="mt-1 text-sm text-slate-500">{item.missing}% missing or incomplete</div>
              </div>
              <span className="rounded-full bg-cyan-100 px-3 py-1 text-xs font-black text-cyan-700">
                {item.complete}% complete
              </span>
            </div>
            <div className="mt-4 h-3 overflow-hidden rounded-full bg-slate-100">
              <div className="h-full rounded-full bg-gradient-to-r from-blue-600 to-cyan-400" style={{ width: `${item.complete}%` }} />
            </div>
          </article>
        ))}
      </div>

      <div className="mt-6 rounded-[28px] bg-emerald-50 p-5 text-emerald-800">
        <div className="flex items-center gap-3">
          <CheckCircle2 className="h-6 w-6" />
          <div>
            <div className="font-black">Enterprise audit angle</div>
            <p className="mt-1 text-sm">This helps clients prove that HR records and payroll decisions are properly supported.</p>
          </div>
        </div>
      </div>
    </section>
  );
}

"use client";

import { Activity, AlertTriangle, Building2, ShieldCheck } from "lucide-react";

export default function ExecutiveOperationsWall() {
  return (
    <section className="grid gap-5 md:grid-cols-4">
      {[
        ["Active Employees", "1,842", "Across all stores", <Activity className="h-6 w-6" />],
        ["Payroll Risk", "R182k", "Potential leakage detected", <AlertTriangle className="h-6 w-6" />],
        ["Store Network", "28", "Connected locations", <Building2 className="h-6 w-6" />],
        ["Compliance", "91%", "Operational score", <ShieldCheck className="h-6 w-6" />],
      ].map(([title, value, subtitle, icon]) => (
        <article key={String(title)} className="rounded-[30px] border border-white/70 bg-white/95 p-6 shadow-[0_20px_55px_rgba(15,23,42,0.10)]">
          <div className="w-fit rounded-2xl bg-cyan-100 p-3 text-cyan-700">{icon}</div>
          <div className="mt-6 text-4xl font-black text-slate-950">{value}</div>
          <div className="mt-2 text-sm font-black text-slate-800">{title}</div>
          <div className="mt-1 text-xs text-slate-500">{subtitle}</div>
        </article>
      ))}
    </section>
  );
}

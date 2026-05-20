"use client";

import React, { useMemo, useState } from "react";
import { FileText, Search, ShieldCheck } from "lucide-react";

export default function ReportsIntelligenceCentre({
  auditLogs = [],
  exceptions = [],
  hrCases = [],
  payrollHours = [],
}: {
  auditLogs?: any[];
  exceptions?: any[];
  hrCases?: any[];
  payrollHours?: any[];
}) {
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return auditLogs;
    return auditLogs.filter((item) => [item.area, item.action, item.user_email, item.record_id].join(" ").toLowerCase().includes(term));
  }, [auditLogs, search]);

  return (
    <section className="space-y-6">
      <div className="rounded-[34px] bg-gradient-to-r from-[#07101f] to-[#0b1a33] p-7 text-white shadow-2xl">
        <div className="text-xs font-black uppercase tracking-[0.4em] text-cyan-300">REPORTING</div>
        <h1 className="mt-3 text-4xl font-black">Reports & Audit Intelligence</h1>
        <p className="mt-3 max-w-3xl text-sm leading-7 text-slate-300">
          Board-level visibility into HR, payroll, exceptions and user activity.
        </p>
      </div>

      <div className="grid gap-5 md:grid-cols-4">
        <Metric label="Audit logs" value={auditLogs.length} />
        <Metric label="Exceptions" value={exceptions.length} />
        <Metric label="HR cases" value={hrCases.length} />
        <Metric label="Payroll rows" value={payrollHours.length} />
      </div>

      <div className="rounded-[34px] bg-white p-6 shadow-lg">
        <div className="flex items-center gap-3 rounded-2xl bg-slate-50 px-4 py-3">
          <Search className="h-5 w-5 text-slate-400" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search audit logs..." className="w-full bg-transparent text-sm font-bold outline-none" />
        </div>

        <div className="mt-6 space-y-3">
          {filtered.length === 0 ? (
            <div className="rounded-3xl border border-dashed border-slate-200 p-8 text-center">
              <FileText className="mx-auto h-10 w-10 text-slate-300" />
              <div className="mt-3 font-black text-slate-500">No audit records yet</div>
            </div>
          ) : filtered.map((item) => (
            <div key={item.id} className="rounded-2xl bg-slate-50 p-4">
              <div className="flex items-center gap-3">
                <ShieldCheck className="h-5 w-5 text-slate-900" />
                <div className="font-black text-slate-950">{item.area} · {item.action}</div>
              </div>
              <div className="mt-2 text-sm font-semibold text-slate-500">{item.user_email || "system"} · {item.created_at}</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function Metric({ label, value }: { label: string; value: any }) {
  return <div className="rounded-[28px] bg-white p-6 shadow-lg"><div className="text-xs font-black uppercase tracking-[0.2em] text-slate-400">{label}</div><div className="mt-4 text-4xl font-black text-slate-950">{value}</div></div>;
}

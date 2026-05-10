"use client";

import { Activity, AlertTriangle, Database, Server, ShieldCheck, Wifi } from "lucide-react";

export default function SystemHealthCommandCentre() {
  return (
    <section className="rounded-[34px] border border-white/80 bg-white/95 p-6 shadow-[0_24px_70px_rgba(15,23,42,0.13)] backdrop-blur-xl">
      <div className="flex flex-col gap-5 xl:flex-row xl:items-center xl:justify-between">
        <div>
          <div className="text-xs font-black uppercase tracking-[0.35em] text-cyan-700">System Health</div>
          <h2 className="mt-3 text-3xl font-black tracking-tight text-slate-950">System Health Command Centre</h2>
          <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-500">
            Operational visibility for Supabase connection, data freshness, imports, exports and client system confidence.
          </p>
        </div>
        <div className="rounded-full bg-emerald-100 px-4 py-2 text-sm font-black text-emerald-700">Healthy</div>
      </div>

      <div className="mt-8 grid gap-5 md:grid-cols-4">
        {[
          ["Database", "Online", <Database key="1" className="h-6 w-6" />],
          ["Auth", "Active", <ShieldCheck key="2" className="h-6 w-6" />],
          ["Exports", "Ready", <Server key="3" className="h-6 w-6" />],
          ["Sync", "Live", <Wifi key="4" className="h-6 w-6" />],
        ].map(([title, value, icon]) => (
          <article key={String(title)} className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
            <div className="w-fit rounded-2xl bg-cyan-100 p-3 text-cyan-700">{icon}</div>
            <div className="mt-5 text-2xl font-black text-slate-950">{value}</div>
            <div className="mt-2 text-sm font-black text-slate-700">{title}</div>
          </article>
        ))}
      </div>

      <div className="mt-8 grid gap-4 md:grid-cols-2">
        <div className="rounded-[28px] bg-[#06101f] p-5 text-white">
          <Activity className="h-6 w-6 text-cyan-300" />
          <div className="mt-4 font-black">Live data confidence</div>
          <p className="mt-2 text-sm leading-6 text-slate-300">All major dashboards should show clear data status and refresh controls.</p>
        </div>
        <div className="rounded-[28px] bg-amber-50 p-5 text-amber-800">
          <AlertTriangle className="h-6 w-6" />
          <div className="mt-4 font-black">Production hardening</div>
          <p className="mt-2 text-sm leading-6">Add error logs and usage monitoring before serious client rollout.</p>
        </div>
      </div>
    </section>
  );
}

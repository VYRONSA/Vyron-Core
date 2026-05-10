"use client";

import { AlertTriangle, CheckCircle2, Database, Gauge, GitBranch, Server, ShieldCheck, Wifi } from "lucide-react";

const hardening = [
  ["Loading states", "Required", "All async data screens need clean skeleton/loading UI"],
  ["Error boundaries", "Required", "Prevent one module from crashing the full app"],
  ["Query optimisation", "Required", "Limit heavy lists and add pagination where needed"],
  ["Audit logging", "Important", "Record sensitive payroll/HR actions"],
  ["RLS review", "Critical", "Confirm tenant isolation before external pilots"],
  ["Production monitoring", "Important", "Track errors, usage and slow pages"],
];

export default function ProductionHardeningCentre() {
  return (
    <section className="space-y-8">
      <div className="rounded-[34px] border border-white/80 bg-white/95 p-6 shadow-[0_24px_70px_rgba(15,23,42,0.13)]">
        <div className="flex flex-col gap-5 xl:flex-row xl:items-center xl:justify-between">
          <div>
            <div className="text-xs font-black uppercase tracking-[0.35em] text-cyan-700">Production Hardening</div>
            <h2 className="mt-3 text-3xl font-black tracking-tight text-slate-950">Production Readiness Command Centre</h2>
            <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-500">
              Final layer before serious pilots: stability, performance, monitoring, security and release confidence.
            </p>
          </div>
          <div className="rounded-[28px] bg-gradient-to-br from-amber-500 to-orange-500 p-5 text-white">
            <div className="text-xs font-black uppercase tracking-[0.28em] text-amber-50">Readiness</div>
            <div className="mt-2 text-4xl font-black">74%</div>
          </div>
        </div>

        <div className="mt-8 grid gap-5 md:grid-cols-4">
          {[
            ["Database", "Review", <Database key="a" className="h-6 w-6" />],
            ["Security", "Critical", <ShieldCheck key="b" className="h-6 w-6" />],
            ["Performance", "Improve", <Gauge key="c" className="h-6 w-6" />],
            ["Deployment", "Pending", <Server key="d" className="h-6 w-6" />],
          ].map(([title, value, icon]) => (
            <article key={String(title)} className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
              <div className="w-fit rounded-2xl bg-cyan-100 p-3 text-cyan-700">{icon}</div>
              <div className="mt-5 text-2xl font-black text-slate-950">{value}</div>
              <div className="mt-2 text-sm font-black text-slate-700">{title}</div>
            </article>
          ))}
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-[1fr_0.8fr]">
        <div className="rounded-[34px] border border-white/80 bg-white/95 p-6 shadow-[0_24px_70px_rgba(15,23,42,0.13)]">
          <h3 className="text-2xl font-black text-slate-950">Hardening Checklist</h3>
          <div className="mt-6 space-y-4">
            {hardening.map(([title, status, detail]) => (
              <article key={title} className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
                <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                  <div>
                    <div className="font-black text-slate-950">{title}</div>
                    <div className="mt-1 text-sm text-slate-500">{detail}</div>
                  </div>
                  <span className={`w-fit rounded-full px-3 py-1 text-xs font-black ${
                    status === "Critical" ? "bg-rose-100 text-rose-700" : status === "Required" ? "bg-amber-100 text-amber-700" : "bg-cyan-100 text-cyan-700"
                  }`}>{status}</span>
                </div>
              </article>
            ))}
          </div>
        </div>

        <div className="rounded-[34px] bg-[#06101f] p-6 text-white">
          <GitBranch className="h-8 w-8 text-cyan-300" />
          <h3 className="mt-5 text-2xl font-black">Pilot release rule</h3>
          <p className="mt-4 text-sm leading-7 text-slate-300">
            Before onboarding serious external clients, freeze core features, fix known crashes, protect tenant data, and deploy a stable demo environment.
          </p>
          <div className="mt-8 space-y-3">
            <div className="flex items-center gap-3 rounded-2xl bg-white/10 p-4 text-sm font-black"><CheckCircle2 className="h-5 w-5 text-emerald-300" /> Feature scope locked</div>
            <div className="flex items-center gap-3 rounded-2xl bg-white/10 p-4 text-sm font-black"><AlertTriangle className="h-5 w-5 text-amber-300" /> RLS/security review required</div>
            <div className="flex items-center gap-3 rounded-2xl bg-white/10 p-4 text-sm font-black"><Wifi className="h-5 w-5 text-cyan-300" /> Monitoring setup pending</div>
          </div>
        </div>
      </div>
    </section>
  );
}

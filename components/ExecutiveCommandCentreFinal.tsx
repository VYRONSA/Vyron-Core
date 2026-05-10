"use client";

import { Activity, AlertTriangle, Crown, ShieldCheck, TrendingUp, Users, WalletCards, Zap } from "lucide-react";

const executiveMetrics = [
  ["Payroll Risk Prevented", "R182k", "Live leakage and blocker exposure", <WalletCards key="a" className="h-6 w-6" />],
  ["Workforce Health", "91%", "Attendance, roster and HR health", <Users key="b" className="h-6 w-6" />],
  ["Compliance Score", "88%", "HR, payroll and document confidence", <ShieldCheck key="c" className="h-6 w-6" />],
  ["Manager Actions", "36", "Open actions requiring review", <Activity key="d" className="h-6 w-6" />],
];

export default function ExecutiveCommandCentreFinal() {
  return (
    <section className="space-y-8">
      <div className="relative overflow-hidden rounded-[38px] border border-cyan-300/15 bg-gradient-to-br from-[#020617] via-[#07101f] to-[#0b1f3a] p-8 text-white shadow-[0_34px_100px_rgba(2,6,23,0.36),0_0_52px_rgba(34,211,238,0.14)]">
        <div className="pointer-events-none absolute -right-20 -top-24 h-80 w-80 rounded-full bg-cyan-300/20 blur-[80px]" />
        <div className="relative flex flex-col gap-8 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <div className="flex items-center gap-3 text-xs font-black uppercase tracking-[0.45em] text-cyan-300">
              <Crown className="h-5 w-5" /> Executive Layer
            </div>
            <h1 className="mt-4 max-w-5xl text-5xl font-black tracking-tight md:text-6xl">
              Board-Level Workforce Command Centre
            </h1>
            <p className="mt-5 max-w-3xl text-sm leading-7 text-slate-300">
              One executive layer for payroll exposure, labour leakage, HR risk, compliance, operations, and manager accountability.
            </p>
          </div>

          <div className="rounded-[28px] border border-white/10 bg-white/10 p-5 backdrop-blur-xl">
            <div className="text-xs font-black uppercase tracking-[0.3em] text-cyan-300">Estimated protected value</div>
            <div className="mt-3 text-4xl font-black text-white">R2.18m</div>
            <div className="mt-2 text-xs text-slate-300">Annualised operational value</div>
          </div>
        </div>
      </div>

      <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-4">
        {executiveMetrics.map(([title, value, subtitle, icon]) => (
          <article key={String(title)} className="rounded-[32px] border border-white/80 bg-white/95 p-6 shadow-[0_22px_65px_rgba(15,23,42,0.13)] backdrop-blur-xl transition hover:-translate-y-1">
            <div className="w-fit rounded-2xl bg-cyan-100 p-3 text-cyan-700">{icon}</div>
            <div className="mt-6 text-4xl font-black text-slate-950">{value}</div>
            <div className="mt-2 text-sm font-black text-slate-800">{title}</div>
            <div className="mt-1 text-xs leading-5 text-slate-500">{subtitle}</div>
          </article>
        ))}
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
        <div className="rounded-[34px] border border-white/80 bg-white/95 p-6 shadow-[0_24px_70px_rgba(15,23,42,0.13)]">
          <h2 className="text-3xl font-black tracking-tight text-slate-950">Executive Action Stack</h2>
          <p className="mt-2 text-sm text-slate-500">Highest-value actions to protect payroll and reduce risk this week.</p>
          <div className="mt-6 space-y-4">
            {[
              "Clear 14 payroll blockers before export",
              "Review Waterstone overtime spike",
              "Approve or decline 7 pending leave requests",
              "Complete 4 employee document files",
              "Escalate 3 unresolved HR cases",
            ].map((item) => (
              <div key={item} className="flex items-start gap-4 rounded-[26px] border border-slate-200 bg-white p-5 shadow-sm">
                <div className="rounded-2xl bg-amber-100 p-3 text-amber-700"><AlertTriangle className="h-5 w-5" /></div>
                <div>
                  <div className="font-black text-slate-950">{item}</div>
                  <div className="mt-1 text-sm text-slate-500">Recommended executive follow-up</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-[34px] bg-[#06101f] p-6 text-white shadow-[0_24px_70px_rgba(2,6,23,0.30)]">
          <Zap className="h-8 w-8 text-cyan-300" />
          <h2 className="mt-5 text-3xl font-black">Why this sells</h2>
          <p className="mt-4 text-sm leading-7 text-slate-300">
            This page gives a CEO or operations director the exact reason to buy VYRON CORE:
            it exposes payroll risk, quantifies preventable loss, and gives managers a clear action path.
          </p>
          <div className="mt-8 rounded-[28px] bg-white/10 p-5">
            <div className="text-xs font-black uppercase tracking-[0.28em] text-cyan-300">Demo line</div>
            <div className="mt-3 text-2xl font-black">“Here is the money leaking before payroll.”</div>
          </div>
        </div>
      </div>
    </section>
  );
}

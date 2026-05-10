"use client";

import {
  Building2,
  MonitorPlay,
  Rocket,
  Users,
  WalletCards,
} from "lucide-react";

const demoChecklist = [
  "Create one strong demo company",
  "Load 5 realistic stores",
  "Load 50 realistic employees",
  "Show clocking with missing events",
  "Show payroll blockers and leakage",
  "Show leave approval workflow",
  "Show HR document file",
  "Show executive dashboards",
  "Show owner-only dashboard separately",
];

export default function PilotDemoReadinessCentre() {
  return (
    <section className="rounded-[34px] border border-white/80 bg-white/95 p-6 shadow-[0_24px_70px_rgba(15,23,42,0.13)] backdrop-blur-xl">
      <div className="flex flex-col gap-5 xl:flex-row xl:items-center xl:justify-between">
        <div>
          <div className="text-xs font-black uppercase tracking-[0.35em] text-cyan-700">
            Pilot Demo
          </div>
          <h2 className="mt-3 text-3xl font-black tracking-tight text-slate-950">
            Pilot Demo Readiness Centre
          </h2>
          <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-500">
            The demo pack that makes VYRON CORE understandable to clients within the first 10 minutes.
          </p>
        </div>

        <div className="rounded-[28px] bg-gradient-to-br from-blue-600 to-cyan-400 p-5 text-white">
          <div className="text-xs font-black uppercase tracking-[0.28em] text-cyan-50">
            Demo readiness
          </div>
          <div className="mt-2 text-4xl font-black">64%</div>
        </div>
      </div>

      <div className="mt-8 grid gap-5 md:grid-cols-4">
        {[
          ["Demo Company", "1", <Building2 key="a" className="h-6 w-6" />],
          ["Demo Employees", "50", <Users key="b" className="h-6 w-6" />],
          ["Payroll Story", "Ready", <WalletCards key="c" className="h-6 w-6" />],
          ["Demo Script", "Next", <MonitorPlay key="d" className="h-6 w-6" />],
        ].map(([title, value, icon]) => (
          <article key={String(title)} className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
            <div className="w-fit rounded-2xl bg-cyan-100 p-3 text-cyan-700">{icon}</div>
            <div className="mt-5 text-2xl font-black text-slate-950">{value}</div>
            <div className="mt-2 text-sm font-black text-slate-700">{title}</div>
          </article>
        ))}
      </div>

      <div className="mt-8 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {demoChecklist.map((item, index) => (
          <article
            key={item}
            className="flex items-start gap-4 rounded-[26px] border border-slate-200 bg-white p-5 shadow-sm"
          >
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-cyan-100 text-sm font-black text-cyan-700">
              {index + 1}
            </div>
            <div>
              <div className="font-black text-slate-950">{item}</div>
              <div className="mt-1 text-xs text-slate-500">Demo readiness item</div>
            </div>
          </article>
        ))}
      </div>

      <div className="mt-6 rounded-[28px] bg-emerald-50 p-5 text-emerald-800">
        <div className="flex items-center gap-3">
          <Rocket className="h-6 w-6" />
          <div>
            <div className="font-black">Demo goal</div>
            <p className="mt-1 text-sm">
              Show the client how payroll leakage is found, reviewed, approved and prevented.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

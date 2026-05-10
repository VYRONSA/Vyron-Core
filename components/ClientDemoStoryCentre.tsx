"use client";

import {
  AlertTriangle,
  Building2,
  CheckCircle2,
  Clock3,
  FileText,
  MapPin,
  PlayCircle,
  ShieldCheck,
  Users,
  WalletCards,
} from "lucide-react";

const demoFlow = [
  {
    title: "Start with payroll leakage",
    detail: "Show the client how unresolved clocking and overtime issues become real money exposure.",
    proof: "R84,900 detected",
    icon: <WalletCards className="h-6 w-6" />,
  },
  {
    title: "Show store-level risk",
    detail: "Move from company-wide numbers into the store causing the biggest operational pressure.",
    proof: "Waterstone high risk",
    icon: <Building2 className="h-6 w-6" />,
  },
  {
    title: "Open employee proof",
    detail: "Show the employee HR file, clocking pattern, leave, notes and documents behind the decision.",
    proof: "Full audit trail",
    icon: <Users className="h-6 w-6" />,
  },
  {
    title: "Finish with payroll control",
    detail: "Show that payroll export stays blocked until managers review and approve the problem.",
    proof: "Export protected",
    icon: <ShieldCheck className="h-6 w-6" />,
  },
];

const demoData = [
  ["Demo company", "Bluewater Retail Group"],
  ["Stores", "5 branches"],
  ["Employees", "50 staff records"],
  ["Clock events", "420 monthly events"],
  ["Exceptions", "36 realistic issues"],
  ["Payroll blockers", "14 open items"],
  ["Leave requests", "11 pending or processed"],
  ["HR documents", "84 records"],
];

export default function ClientDemoStoryCentre() {
  return (
    <section className="space-y-8">
      <div className="relative overflow-hidden rounded-[38px] border border-cyan-300/15 bg-gradient-to-br from-[#020617] via-[#07101f] to-[#0b1f3a] p-8 text-white shadow-[0_34px_100px_rgba(2,6,23,0.36),0_0_52px_rgba(34,211,238,0.14)]">
        <div className="pointer-events-none absolute -right-20 -top-24 h-80 w-80 rounded-full bg-cyan-300/20 blur-[80px]" />
        <div className="relative flex flex-col gap-8 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <div className="flex items-center gap-3 text-xs font-black uppercase tracking-[0.45em] text-cyan-300">
              <PlayCircle className="h-5 w-5" />
              Demo Story
            </div>

            <h1 className="mt-4 max-w-5xl text-5xl font-black tracking-tight md:text-6xl">
              Client Demo Story Centre
            </h1>

            <p className="mt-5 max-w-3xl text-sm leading-7 text-slate-300">
              A clear demo flow that shows prospects the value of VYRON CORE in minutes:
              find payroll leakage, prove the problem, assign action and protect payroll.
            </p>
          </div>

          <div className="rounded-[28px] border border-white/10 bg-white/10 p-5 backdrop-blur-xl">
            <div className="text-xs font-black uppercase tracking-[0.3em] text-cyan-300">
              Demo goal
            </div>
            <div className="mt-3 text-4xl font-black text-white">10 min</div>
            <div className="mt-2 text-xs text-slate-300">Time to understand value</div>
          </div>
        </div>
      </div>

      <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-4">
        {[
          ["Leakage Found", "R84,900", <AlertTriangle key="a" className="h-6 w-6" />],
          ["Demo Stores", "5", <MapPin key="b" className="h-6 w-6" />],
          ["Staff Records", "50", <Users key="c" className="h-6 w-6" />],
          ["Payroll Blockers", "14", <Clock3 key="d" className="h-6 w-6" />],
        ].map(([title, value, icon]) => (
          <article
            key={String(title)}
            className="rounded-[32px] border border-white/80 bg-white/95 p-6 shadow-[0_22px_65px_rgba(15,23,42,0.13)] backdrop-blur-xl transition hover:-translate-y-1"
          >
            <div className="w-fit rounded-2xl bg-cyan-100 p-3 text-cyan-700">{icon}</div>
            <div className="mt-6 text-4xl font-black text-slate-950">{value}</div>
            <div className="mt-2 text-sm font-black text-slate-800">{title}</div>
            <div className="mt-1 text-xs leading-5 text-slate-500">Demo-ready proof point</div>
          </article>
        ))}
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.15fr_0.85fr]">
        <div className="rounded-[34px] border border-white/80 bg-white/95 p-6 shadow-[0_24px_70px_rgba(15,23,42,0.13)] backdrop-blur-xl">
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div>
              <h2 className="text-3xl font-black tracking-tight text-slate-950">Demo Flow</h2>
              <p className="mt-2 text-sm text-slate-500">
                Use this exact order when showing VYRON CORE to a prospect.
              </p>
            </div>
            <div className="rounded-full bg-cyan-100 px-4 py-2 text-sm font-black text-cyan-700">
              4-step value story
            </div>
          </div>

          <div className="mt-7 space-y-4">
            {demoFlow.map((step, index) => (
              <article
                key={step.title}
                className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-[0_14px_40px_rgba(15,23,42,0.08)]"
              >
                <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                  <div className="flex items-start gap-4">
                    <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-[#06101f] text-cyan-300">
                      {step.icon}
                    </div>
                    <div>
                      <div className="text-xs font-black uppercase tracking-[0.22em] text-slate-400">
                        Step {index + 1}
                      </div>
                      <div className="mt-2 text-lg font-black text-slate-950">{step.title}</div>
                      <p className="mt-2 text-sm leading-6 text-slate-500">{step.detail}</p>
                    </div>
                  </div>

                  <span className="w-fit rounded-full bg-emerald-100 px-3 py-1 text-xs font-black text-emerald-700">
                    {step.proof}
                  </span>
                </div>
              </article>
            ))}
          </div>
        </div>

        <div className="rounded-[34px] bg-[#06101f] p-6 text-white shadow-[0_24px_70px_rgba(2,6,23,0.30)]">
          <FileText className="h-8 w-8 text-cyan-300" />
          <h2 className="mt-5 text-3xl font-black">Demo Data Blueprint</h2>
          <p className="mt-4 text-sm leading-7 text-slate-300">
            The demo company should feel real. It must include enough issues to prove VYRON CORE saves money,
            but not so much that the demo becomes confusing.
          </p>

          <div className="mt-8 space-y-3">
            {demoData.map(([label, value]) => (
              <div
                key={label}
                className="flex items-center justify-between gap-4 rounded-2xl bg-white/10 p-4 text-sm"
              >
                <span className="font-semibold text-slate-300">{label}</span>
                <span className="font-black text-white">{value}</span>
              </div>
            ))}
          </div>

          <div className="mt-8 rounded-[28px] bg-emerald-500/15 p-5 text-emerald-100">
            <div className="flex items-start gap-3">
              <CheckCircle2 className="mt-0.5 h-5 w-5" />
              <p className="text-sm leading-6">
                Best demo story: “Here is money leaking before payroll. Here is the proof. Here is the action. Here is the protected export.”
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

"use client";

import {
  ArrowUpRight,
  BriefcaseBusiness,
  Building2,
  CheckCircle2,
  Crown,
  DollarSign,
  Globe2,
  Rocket,
  ShieldCheck,
  Users,
} from "lucide-react";

const launchMetrics = [
  ["Projected Saving", "R186,000/mo", <DollarSign key="1" className="h-6 w-6" />],
  ["Pilot Stores", "5", <Building2 key="2" className="h-6 w-6" />],
  ["Managers", "12", <Users key="3" className="h-6 w-6" />],
  ["Payroll Protected", "92%", <ShieldCheck key="4" className="h-6 w-6" />],
];

const launchSteps = [
  "Deploy stable Vercel production build",
  "Prepare realistic demo company",
  "Prepare onboarding presentation",
  "Create payroll leakage case studies",
  "Start first pilot customer outreach",
  "Run controlled live pilot",
];

export default function ExecutiveLaunchCentre() {
  return (
    <section className="space-y-8">
      <div className="relative overflow-hidden rounded-[40px] border border-cyan-300/15 bg-gradient-to-br from-[#020617] via-[#07101f] to-[#0b1f3a] p-8 text-white shadow-[0_34px_100px_rgba(2,6,23,0.36),0_0_52px_rgba(34,211,238,0.14)]">
        <div className="pointer-events-none absolute -right-24 -top-24 h-96 w-96 rounded-full bg-cyan-300/20 blur-[90px]" />

        <div className="relative flex flex-col gap-8 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <div className="flex items-center gap-3 text-xs font-black uppercase tracking-[0.45em] text-cyan-300">
              <Rocket className="h-5 w-5" />
              Executive Launch
            </div>

            <h1 className="mt-4 max-w-5xl text-5xl font-black tracking-tight md:text-6xl">
              Executive Launch Centre
            </h1>

            <p className="mt-5 max-w-3xl text-sm leading-7 text-slate-300">
              Final commercialisation layer for VYRON CORE before onboarding pilot customers.
            </p>
          </div>

          <div className="rounded-[30px] border border-white/10 bg-white/10 p-6 backdrop-blur-xl">
            <div className="text-xs font-black uppercase tracking-[0.3em] text-cyan-300">
              Launch readiness
            </div>
            <div className="mt-3 text-5xl font-black text-white">81%</div>
            <div className="mt-2 text-xs text-slate-300">
              Ready for controlled market pilots
            </div>
          </div>
        </div>
      </div>

      <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-4">
        {launchMetrics.map(([title, value, icon]) => (
          <article
            key={String(title)}
            className="rounded-[32px] border border-white/80 bg-white/95 p-6 shadow-[0_22px_65px_rgba(15,23,42,0.13)] backdrop-blur-xl"
          >
            <div className="w-fit rounded-2xl bg-cyan-100 p-3 text-cyan-700">
              {icon}
            </div>

            <div className="mt-6 text-4xl font-black text-slate-950">{value}</div>
            <div className="mt-2 text-sm font-black text-slate-800">{title}</div>
            <div className="mt-1 text-xs text-slate-500">Pilot launch metric</div>
          </article>
        ))}
      </div>

      <div className="grid gap-6 xl:grid-cols-[1fr_0.85fr]">
        <div className="rounded-[34px] border border-white/80 bg-white/95 p-6 shadow-[0_24px_70px_rgba(15,23,42,0.13)] backdrop-blur-xl">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h2 className="text-3xl font-black tracking-tight text-slate-950">
                Launch Execution Plan
              </h2>
              <p className="mt-2 text-sm text-slate-500">
                Controlled enterprise rollout strategy.
              </p>
            </div>

            <div className="rounded-full bg-cyan-100 px-4 py-2 text-sm font-black text-cyan-700">
              6 Steps
            </div>
          </div>

          <div className="mt-8 space-y-4">
            {launchSteps.map((step, index) => (
              <article
                key={step}
                className="flex items-start gap-4 rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm"
              >
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-[#06101f] text-cyan-300">
                  <ArrowUpRight className="h-5 w-5" />
                </div>

                <div className="flex-1">
                  <div className="text-xs font-black uppercase tracking-[0.2em] text-slate-400">
                    Phase {index + 1}
                  </div>

                  <div className="mt-2 text-lg font-black text-slate-950">
                    {step}
                  </div>
                </div>
              </article>
            ))}
          </div>
        </div>

        <div className="rounded-[34px] bg-[#06101f] p-6 text-white shadow-[0_24px_70px_rgba(2,6,23,0.30)]">
          <Crown className="h-8 w-8 text-cyan-300" />

          <h2 className="mt-5 text-3xl font-black">
            Founder Focus
          </h2>

          <p className="mt-4 text-sm leading-7 text-slate-300">
            The next stage is not feature chasing anymore. It is:
            positioning, trust, demos, pilots and enterprise confidence.
          </p>

          <div className="mt-8 space-y-3">
            {[
              ["Enterprise Positioning", <BriefcaseBusiness key="a" className="h-5 w-5" />],
              ["Pilot Client Outreach", <Globe2 key="b" className="h-5 w-5" />],
              ["Operational Trust", <ShieldCheck key="c" className="h-5 w-5" />],
              ["Payroll Savings Story", <DollarSign key="d" className="h-5 w-5" />],
            ].map(([label, icon]) => (
              <div
                key={String(label)}
                className="flex items-center gap-3 rounded-2xl bg-white/10 p-4 text-sm font-black"
              >
                {icon}
                {label}
              </div>
            ))}
          </div>

          <div className="mt-8 rounded-[28px] bg-emerald-500/15 p-5 text-emerald-100">
            <div className="flex items-start gap-3">
              <CheckCircle2 className="mt-0.5 h-5 w-5" />
              <p className="text-sm leading-6">
                VYRON CORE is now moving from software development into commercial enterprise rollout.
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

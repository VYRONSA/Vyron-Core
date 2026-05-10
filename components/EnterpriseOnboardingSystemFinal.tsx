"use client";

import {
  AlertTriangle,
  ArrowUpRight,
  BarChart3,
  Brain,
  Building2,
  CheckCircle2,
  ClipboardList,
  Database,
  FileSpreadsheet,
  LockKeyhole,
  Rocket,
  ShieldCheck,
  Sparkles,
  Upload,
  Users,
  WalletCards,
  Zap,
} from "lucide-react";

export default function EnterpriseOnboardingSystemFinal() {
  return (
    <section className="space-y-8">
      <div className="relative overflow-hidden rounded-[40px] border border-cyan-300/15 bg-gradient-to-br from-[#020617] via-[#07101f] to-[#0b1f3a] p-8 text-white shadow-[0_34px_100px_rgba(2,6,23,0.36),0_0_52px_rgba(34,211,238,0.14)]">
        <div className="pointer-events-none absolute -right-24 -top-24 h-96 w-96 rounded-full bg-cyan-300/20 blur-[90px]" />
        <div className="relative flex flex-col gap-8 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <div className="flex items-center gap-3 text-xs font-black uppercase tracking-[0.45em] text-cyan-300">
              <Sparkles className="h-5 w-5" />
              Batch 06
            </div>
            <h1 className="mt-4 max-w-5xl text-5xl font-black tracking-tight md:text-6xl">
              Enterprise Onboarding System
            </h1>
            <p className="mt-5 max-w-3xl text-sm leading-7 text-slate-300">
              Guided onboarding, Excel imports, setup wizard, validation checks and demo data generation for faster client rollout.
            </p>
          </div>

          <div className="rounded-[30px] border border-white/10 bg-white/10 p-6 backdrop-blur-xl">
            <div className="text-xs font-black uppercase tracking-[0.3em] text-cyan-300">Commercial value</div>
            <div className="mt-3 text-5xl font-black text-white">High</div>
            <div className="mt-2 text-xs text-slate-300">Enterprise SaaS priority</div>
          </div>
        </div>
      </div>

      <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-4">
          <article className="rounded-[30px] border border-white/80 bg-white/95 p-6 shadow-[0_20px_60px_rgba(15,23,42,0.12)] backdrop-blur-xl">
            <div className="w-fit rounded-2xl bg-cyan-100 p-3 text-cyan-700"><ClipboardList className="h-6 w-6" /></div>
            <div className="mt-6 text-3xl font-black text-slate-950">64%</div>
            <div className="mt-2 text-sm font-black text-slate-700">Setup Progress</div>
          </article>
          <article className="rounded-[30px] border border-white/80 bg-white/95 p-6 shadow-[0_20px_60px_rgba(15,23,42,0.12)] backdrop-blur-xl">
            <div className="w-fit rounded-2xl bg-cyan-100 p-3 text-cyan-700"><Upload className="h-6 w-6" /></div>
            <div className="mt-6 text-3xl font-black text-slate-950">6</div>
            <div className="mt-2 text-sm font-black text-slate-700">Import Types</div>
          </article>
          <article className="rounded-[30px] border border-white/80 bg-white/95 p-6 shadow-[0_20px_60px_rgba(15,23,42,0.12)] backdrop-blur-xl">
            <div className="w-fit rounded-2xl bg-cyan-100 p-3 text-cyan-700"><Building2 className="h-6 w-6" /></div>
            <div className="mt-6 text-3xl font-black text-slate-950">5</div>
            <div className="mt-2 text-sm font-black text-slate-700">Stores Ready</div>
          </article>
          <article className="rounded-[30px] border border-white/80 bg-white/95 p-6 shadow-[0_20px_60px_rgba(15,23,42,0.12)] backdrop-blur-xl">
            <div className="w-fit rounded-2xl bg-cyan-100 p-3 text-cyan-700"><Users className="h-6 w-6" /></div>
            <div className="mt-6 text-3xl font-black text-slate-950">50</div>
            <div className="mt-2 text-sm font-black text-slate-700">Employees Ready</div>
          </article>
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
        <div className="rounded-[34px] border border-white/80 bg-white/95 p-6 shadow-[0_24px_70px_rgba(15,23,42,0.13)] backdrop-blur-xl">
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div>
              <h2 className="text-3xl font-black tracking-tight text-slate-950">Execution Checklist</h2>
              <p className="mt-2 text-sm text-slate-500">Apply these items as the implementation direction for this module.</p>
            </div>
            <div className="rounded-full bg-cyan-100 px-4 py-2 text-sm font-black text-cyan-700">6 items</div>
          </div>

          <div className="mt-8 grid gap-4 md:grid-cols-2">
          <article className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex items-start gap-4">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-[#06101f] text-sm font-black text-cyan-300">1</div>
              <div>
                <div className="font-black text-slate-950">Create guided setup wizard for company, stores, employees and payroll.</div>
                <div className="mt-1 text-sm leading-6 text-slate-500">Enterprise execution item</div>
              </div>
            </div>
          </article>
          <article className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex items-start gap-4">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-[#06101f] text-sm font-black text-cyan-300">2</div>
              <div>
                <div className="font-black text-slate-950">Import employees, stores, rosters, departments and leave balances from Excel.</div>
                <div className="mt-1 text-sm leading-6 text-slate-500">Enterprise execution item</div>
              </div>
            </div>
          </article>
          <article className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex items-start gap-4">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-[#06101f] text-sm font-black text-cyan-300">3</div>
              <div>
                <div className="font-black text-slate-950">Validate duplicates, missing IDs and invalid payroll numbers.</div>
                <div className="mt-1 text-sm leading-6 text-slate-500">Enterprise execution item</div>
              </div>
            </div>
          </article>
          <article className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex items-start gap-4">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-[#06101f] text-sm font-black text-cyan-300">4</div>
              <div>
                <div className="font-black text-slate-950">Show onboarding progress and missing setup items.</div>
                <div className="mt-1 text-sm leading-6 text-slate-500">Enterprise execution item</div>
              </div>
            </div>
          </article>
          <article className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex items-start gap-4">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-[#06101f] text-sm font-black text-cyan-300">5</div>
              <div>
                <div className="font-black text-slate-950">Generate realistic demo data for sales and pilots.</div>
                <div className="mt-1 text-sm leading-6 text-slate-500">Enterprise execution item</div>
              </div>
            </div>
          </article>
          <article className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex items-start gap-4">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-[#06101f] text-sm font-black text-cyan-300">6</div>
              <div>
                <div className="font-black text-slate-950">Prepare go-live readiness checklist for new enterprise clients.</div>
                <div className="mt-1 text-sm leading-6 text-slate-500">Enterprise execution item</div>
              </div>
            </div>
          </article>
          </div>
        </div>

        <div className="rounded-[34px] bg-[#06101f] p-6 text-white shadow-[0_24px_70px_rgba(2,6,23,0.30)]">
          <Rocket className="h-8 w-8 text-cyan-300" />
          <h2 className="mt-5 text-3xl font-black">Why this matters</h2>
          <p className="mt-4 text-sm leading-7 text-slate-300">
            Fast onboarding reduces friction and makes enterprise rollout much easier to sell.
          </p>

          <div className="mt-8 space-y-3">
            {[
              "Protects payroll and HR trust.",
              "Improves client confidence.",
              "Makes VYRON CORE easier to sell.",
              "Moves the platform closer to enterprise readiness.",
            ].map((item) => (
              <div key={item} className="flex items-center gap-3 rounded-2xl bg-white/10 p-4 text-sm font-black">
                <CheckCircle2 className="h-5 w-5 text-cyan-300" />
                {item}
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

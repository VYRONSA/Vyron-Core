"use client";

import { AlertTriangle, Clock3, TrendingDown, TrendingUp, WalletCards } from "lucide-react";

const leakageItems = [
  {
    title: "Late arrivals",
    value: "R8,900",
    detail: "43 late arrivals detected this month",
  },
  {
    title: "Early departures",
    value: "R6,240",
    detail: "18 early departures require review",
  },
  {
    title: "Missing clock events",
    value: "R12,300",
    detail: "Payroll cannot be trusted until cleared",
  },
  {
    title: "Unapproved overtime",
    value: "R10,980",
    detail: "Overtime must be approved before payroll export",
  },
];

export default function LabourLeakageEngine() {
  return (
    <section className="rounded-[34px] border border-white/80 bg-white/95 p-6 shadow-[0_24px_70px_rgba(15,23,42,0.13)] backdrop-blur-xl">
      <div className="flex flex-col gap-5 xl:flex-row xl:items-center xl:justify-between">
        <div>
          <div className="text-xs font-black uppercase tracking-[0.35em] text-cyan-700">
            VYRON CORE
          </div>
          <h2 className="mt-3 text-3xl font-black tracking-tight text-slate-950">
            Labour Leakage Engine
          </h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-500">
            Converts attendance, clocking, roster and payroll problems into estimated rand-value loss.
          </p>
        </div>

        <div className="rounded-[28px] bg-gradient-to-br from-rose-600 to-orange-500 p-5 text-white shadow-[0_18px_45px_rgba(225,29,72,0.25)]">
          <div className="text-xs font-black uppercase tracking-[0.28em] text-rose-100">
            Estimated exposure
          </div>
          <div className="mt-2 text-4xl font-black">R38,420</div>
        </div>
      </div>

      <div className="mt-8 grid gap-5 md:grid-cols-2 xl:grid-cols-4">
        {leakageItems.map((item) => (
          <article key={item.title} className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-[0_14px_40px_rgba(15,23,42,0.08)]">
            <div className="flex items-start justify-between">
              <div className="rounded-2xl bg-rose-100 p-3 text-rose-600">
                <AlertTriangle className="h-5 w-5" />
              </div>
              <TrendingUp className="h-5 w-5 text-rose-500" />
            </div>

            <div className="mt-6 text-3xl font-black text-slate-950">{item.value}</div>
            <div className="mt-2 text-sm font-black text-slate-700">{item.title}</div>
            <div className="mt-2 text-xs leading-5 text-slate-500">{item.detail}</div>
          </article>
        ))}
      </div>

      <div className="mt-8 grid gap-5 xl:grid-cols-3">
        <div className="rounded-[28px] bg-[#06101f] p-5 text-white">
          <WalletCards className="h-7 w-7 text-cyan-300" />
          <div className="mt-5 text-xl font-black">Payroll Protection Rule</div>
          <p className="mt-3 text-sm leading-6 text-slate-300">
            Do not export payroll while unresolved blocker value is above the company risk threshold.
          </p>
        </div>

        <div className="rounded-[28px] bg-[#06101f] p-5 text-white">
          <Clock3 className="h-7 w-7 text-cyan-300" />
          <div className="mt-5 text-xl font-black">Manager Review SLA</div>
          <p className="mt-3 text-sm leading-6 text-slate-300">
            All missing clocks and overtime issues should be cleared before payroll close.
          </p>
        </div>

        <div className="rounded-[28px] bg-[#06101f] p-5 text-white">
          <TrendingDown className="h-7 w-7 text-cyan-300" />
          <div className="mt-5 text-xl font-black">Savings Target</div>
          <p className="mt-3 text-sm leading-6 text-slate-300">
            Target monthly leakage reduction: 35% within the first 60 days of client onboarding.
          </p>
        </div>
      </div>
    </section>
  );
}

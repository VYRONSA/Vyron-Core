"use client";

import { CalendarDays, LineChart, TrendingUp, WalletCards } from "lucide-react";

const forecast = [
  { label: "Current payroll estimate", value: "R482,300" },
  { label: "Overtime exposure", value: "R31,800" },
  { label: "Blocked payroll value", value: "R64,200" },
  { label: "Potential saving", value: "R42,600" },
];

export default function PayrollForecastEngine() {
  return (
    <section className="rounded-[34px] border border-white/80 bg-white/95 p-6 shadow-[0_24px_70px_rgba(15,23,42,0.13)] backdrop-blur-xl">
      <div className="flex flex-col gap-5 xl:flex-row xl:items-center xl:justify-between">
        <div>
          <div className="text-xs font-black uppercase tracking-[0.35em] text-cyan-700">Payroll Forecast</div>
          <h2 className="mt-3 text-3xl font-black tracking-tight text-slate-950">Payroll Forecast & Cost Projection</h2>
          <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-500">
            Predict payroll cost before payroll close using rostered hours, overtime, exceptions and blocker values.
          </p>
        </div>
        <div className="rounded-[28px] bg-gradient-to-br from-[#06101f] to-[#0b1f3a] p-5 text-white">
          <div className="text-xs font-black uppercase tracking-[0.28em] text-cyan-300">Month forecast</div>
          <div className="mt-2 text-4xl font-black">R482k</div>
        </div>
      </div>

      <div className="mt-8 grid gap-5 md:grid-cols-4">
        {forecast.map((item) => (
          <article key={item.label} className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-[0_14px_40px_rgba(15,23,42,0.08)]">
            <div className="w-fit rounded-2xl bg-cyan-100 p-3 text-cyan-700"><WalletCards className="h-5 w-5" /></div>
            <div className="mt-5 text-3xl font-black text-slate-950">{item.value}</div>
            <div className="mt-2 text-sm font-black text-slate-700">{item.label}</div>
          </article>
        ))}
      </div>

      <div className="mt-8 rounded-[30px] bg-[#06101f] p-6 text-white">
        <div className="grid gap-6 xl:grid-cols-3">
          <div><LineChart className="h-7 w-7 text-cyan-300" /><div className="mt-4 text-xl font-black">Forecast trend</div><p className="mt-2 text-sm leading-6 text-slate-300">Payroll cost is trending 7.8% above expected labour budget.</p></div>
          <div><TrendingUp className="h-7 w-7 text-cyan-300" /><div className="mt-4 text-xl font-black">Overtime driver</div><p className="mt-2 text-sm leading-6 text-slate-300">Waterstone and Somerset Mall are driving most overtime risk.</p></div>
          <div><CalendarDays className="h-7 w-7 text-cyan-300" /><div className="mt-4 text-xl font-black">Payroll close</div><p className="mt-2 text-sm leading-6 text-slate-300">Clear blockers 48 hours before payroll export to reduce rework.</p></div>
        </div>
      </div>
    </section>
  );
}

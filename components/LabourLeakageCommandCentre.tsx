"use client";

import { ArrowUpRight, DollarSign, Eye, TrendingDown } from "lucide-react";

const items = [
  ["Repeated overtime spikes", "R34,000", "Waterstone"],
  ["Clock mismatch patterns", "R18,500", "Somerset Mall"],
  ["Early clock-ins", "R9,800", "Canal Walk"],
  ["Roster over-allocation", "R22,600", "Operations"],
];

export default function LabourLeakageCommandCentre() {
  return (
    <section className="rounded-[34px] border border-white/80 bg-white/95 p-6 shadow-[0_24px_70px_rgba(15,23,42,0.13)]">
      <div className="flex items-center justify-between gap-4">
        <div>
          <div className="text-xs font-black uppercase tracking-[0.35em] text-cyan-700">Leakage Detection</div>
          <h2 className="mt-3 text-3xl font-black tracking-tight text-slate-950">
            Labour Leakage Command Centre
          </h2>
        </div>

        <div className="rounded-full bg-rose-100 px-4 py-2 text-sm font-black text-rose-700">
          R84,900 detected
        </div>
      </div>

      <div className="mt-8 space-y-4">
        {items.map(([title, value, area]) => (
          <article key={title} className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
              <div className="flex items-start gap-4">
                <div className="rounded-2xl bg-rose-100 p-3 text-rose-700">
                  <TrendingDown className="h-5 w-5" />
                </div>

                <div>
                  <div className="font-black text-slate-950">{title}</div>
                  <div className="mt-1 text-sm text-slate-500">{area}</div>
                </div>
              </div>

              <div className="flex items-center gap-3">
                <span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-black text-emerald-700">
                  {value}
                </span>

                <button className="flex items-center gap-2 rounded-2xl bg-[#06101f] px-4 py-2 text-xs font-black text-cyan-300">
                  Investigate <ArrowUpRight className="h-3 w-3" />
                </button>
              </div>
            </div>
          </article>
        ))}
      </div>

      <div className="mt-8 grid gap-5 md:grid-cols-3">
        {[
          ["Suspicious Events", "142", <Eye className="h-6 w-6" />],
          ["Potential Savings", "R182k", <DollarSign className="h-6 w-6" />],
          ["Trend", "-18%", <TrendingDown className="h-6 w-6" />],
        ].map(([title, value, icon]) => (
          <div key={String(title)} className="rounded-[28px] bg-[#06101f] p-5 text-white">
            <div className="text-cyan-300">{icon}</div>
            <div className="mt-4 text-3xl font-black">{value}</div>
            <div className="mt-1 text-sm text-slate-300">{title}</div>
          </div>
        ))}
      </div>
    </section>
  );
}

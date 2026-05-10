"use client";

import { Brain, CalendarDays, Clock3, Users } from "lucide-react";

export default function WorkforceForecastCommandCentre() {
  return (
    <section className="rounded-[34px] border border-white/80 bg-white/95 p-6 shadow-[0_24px_70px_rgba(15,23,42,0.13)]">
      <div className="flex items-center justify-between gap-4">
        <div>
          <div className="text-xs font-black uppercase tracking-[0.35em] text-cyan-700">Forecasting Engine</div>
          <h2 className="mt-3 text-3xl font-black tracking-tight text-slate-950">
            Workforce Forecast Command Centre
          </h2>
        </div>

        <div className="rounded-[28px] bg-gradient-to-br from-blue-600 to-cyan-400 p-5 text-white">
          <div className="text-xs font-black uppercase tracking-[0.28em] text-cyan-50">
            Forecast confidence
          </div>
          <div className="mt-2 text-4xl font-black">87%</div>
        </div>
      </div>

      <div className="mt-8 grid gap-5 md:grid-cols-4">
        {[
          ["Projected Staff Need", "1,920", <Users className="h-6 w-6" />],
          ["Forecast Overtime", "142 hrs", <Clock3 className="h-6 w-6" />],
          ["Peak Trading Days", "Fri + Sat", <CalendarDays className="h-6 w-6" />],
          ["AI Suggestions", "34", <Brain className="h-6 w-6" />],
        ].map(([title, value, icon]) => (
          <article key={String(title)} className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
            <div className="w-fit rounded-2xl bg-cyan-100 p-3 text-cyan-700">{icon}</div>
            <div className="mt-5 text-3xl font-black text-slate-950">{value}</div>
            <div className="mt-2 text-sm font-black text-slate-700">{title}</div>
          </article>
        ))}
      </div>

      <div className="mt-8 rounded-[28px] bg-[#06101f] p-6 text-white">
        <div className="text-xl font-black">Executive insight</div>

        <p className="mt-4 max-w-4xl text-sm leading-7 text-slate-300">
          Current labour forecasts suggest that Somerset Mall and Waterstone will require additional roster coverage over weekends.
          VYRON CORE recommends proactive roster balancing to reduce overtime exposure and payroll pressure before payroll close.
        </p>
      </div>
    </section>
  );
}

"use client";

import { AlertTriangle, Brain, CalendarDays, Clock3, Users, Zap } from "lucide-react";

const insights = [
  {
    title: "Overtime pressure",
    detail: "Waterstone roster has 18.5 forecast overtime hours this week.",
    action: "Move 1 employee from Constantia to Waterstone.",
    risk: "High",
  },
  {
    title: "Coverage gap",
    detail: "Friday evening has low coverage at Somerset Mall.",
    action: "Add one closing shift from 16:00 to 21:00.",
    risk: "Medium",
  },
  {
    title: "Fatigue warning",
    detail: "Jason Peters is scheduled 6 consecutive days.",
    action: "Insert rest day or swap Sunday shift.",
    risk: "Medium",
  },
];

export default function SmartRosterIntelligence() {
  return (
    <section className="rounded-[34px] border border-white/80 bg-white/95 p-6 shadow-[0_24px_70px_rgba(15,23,42,0.13)] backdrop-blur-xl">
      <div className="flex flex-col gap-5 xl:flex-row xl:items-center xl:justify-between">
        <div>
          <div className="flex items-center gap-3">
            <div className="rounded-2xl bg-[#06101f] p-3 text-cyan-300">
              <Brain className="h-6 w-6" />
            </div>
            <div>
              <div className="text-xs font-black uppercase tracking-[0.35em] text-cyan-700">
                Roster Intelligence
              </div>
              <h2 className="mt-2 text-3xl font-black tracking-tight text-slate-950">
                Smart Roster Optimisation
              </h2>
            </div>
          </div>

          <p className="mt-4 max-w-3xl text-sm leading-6 text-slate-500">
            AI-style roster guidance to reduce overtime, prevent fatigue, improve coverage and lower payroll leakage.
          </p>
        </div>

        <div className="rounded-[28px] bg-gradient-to-br from-blue-600 to-cyan-400 p-5 text-white shadow-[0_18px_45px_rgba(37,99,235,0.25)]">
          <div className="text-xs font-black uppercase tracking-[0.28em] text-cyan-50">
            Forecast saving
          </div>
          <div className="mt-2 text-4xl font-black">R21,600</div>
        </div>
      </div>

      <div className="mt-8 grid gap-5 md:grid-cols-4">
        {[
          ["Coverage Score", "91%", <Users className="h-6 w-6" />],
          ["Overtime Risk", "Medium", <Clock3 className="h-6 w-6" />],
          ["Fatigue Alerts", "3", <AlertTriangle className="h-6 w-6" />],
          ["Suggested Moves", "7", <Zap className="h-6 w-6" />],
        ].map(([title, value, icon]) => (
          <div key={String(title)} className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-[0_14px_40px_rgba(15,23,42,0.08)]">
            <div className="rounded-2xl bg-cyan-100 p-3 text-cyan-700 w-fit">{icon}</div>
            <div className="mt-5 text-3xl font-black text-slate-950">{value}</div>
            <div className="mt-2 text-sm font-black text-slate-700">{title}</div>
          </div>
        ))}
      </div>

      <div className="mt-8 space-y-4">
        {insights.map((item) => (
          <article key={item.title} className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-[0_14px_40px_rgba(15,23,42,0.08)]">
            <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
              <div className="flex items-start gap-4">
                <div className="rounded-2xl bg-amber-100 p-3 text-amber-700">
                  <CalendarDays className="h-5 w-5" />
                </div>
                <div>
                  <div className="text-lg font-black text-slate-950">{item.title}</div>
                  <p className="mt-2 text-sm text-slate-500">{item.detail}</p>
                  <p className="mt-3 text-sm font-black text-cyan-700">Recommended: {item.action}</p>
                </div>
              </div>

              <span className={`w-fit rounded-full px-3 py-1 text-xs font-black uppercase tracking-[0.18em] ${
                item.risk === "High" ? "bg-rose-100 text-rose-700" : "bg-amber-100 text-amber-700"
              }`}>
                {item.risk}
              </span>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

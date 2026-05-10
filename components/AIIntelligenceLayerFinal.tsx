"use client";

import { AlertTriangle, Bot, Brain, Lightbulb, Sparkles, TrendingUp, Zap } from "lucide-react";

const insights = [
  ["Predictive payroll blocker", "Waterstone likely to create overtime risk this week.", "Preventive action"],
  ["Repeated late pattern", "Amy Daniels has 4 late arrivals in 14 days.", "HR coaching recommended"],
  ["Store anomaly", "Somerset Mall clock mismatch rate is above normal.", "Manager review"],
  ["Roster optimisation", "Shift swap can reduce overtime by R4,800.", "Suggested move"],
];

export default function AIIntelligenceLayerFinal() {
  return (
    <section className="space-y-8">
      <div className="rounded-[34px] border border-white/80 bg-white/95 p-6 shadow-[0_24px_70px_rgba(15,23,42,0.13)]">
        <div className="flex flex-col gap-5 xl:flex-row xl:items-center xl:justify-between">
          <div>
            <div className="text-xs font-black uppercase tracking-[0.35em] text-cyan-700">AI Intelligence</div>
            <h2 className="mt-3 text-3xl font-black tracking-tight text-slate-950">Predictive Workforce Intelligence Layer</h2>
            <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-500">
              AI-style recommendations for payroll anomalies, labour leakage, repeated behaviour, roster optimisation and manager decisions.
            </p>
          </div>
          <div className="rounded-[28px] bg-gradient-to-br from-blue-600 to-cyan-400 p-5 text-white">
            <div className="text-xs font-black uppercase tracking-[0.28em] text-cyan-50">Insight confidence</div>
            <div className="mt-2 text-4xl font-black">86%</div>
          </div>
        </div>

        <div className="mt-8 grid gap-5 md:grid-cols-4">
          {[
            ["Predictions", "28", <Brain key="a" className="h-6 w-6" />],
            ["Anomalies", "11", <AlertTriangle key="b" className="h-6 w-6" />],
            ["Recommendations", "34", <Lightbulb key="c" className="h-6 w-6" />],
            ["Potential Saving", "R42k", <TrendingUp key="d" className="h-6 w-6" />],
          ].map(([title, value, icon]) => (
            <article key={String(title)} className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
              <div className="w-fit rounded-2xl bg-cyan-100 p-3 text-cyan-700">{icon}</div>
              <div className="mt-5 text-3xl font-black text-slate-950">{value}</div>
              <div className="mt-2 text-sm font-black text-slate-700">{title}</div>
            </article>
          ))}
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
        <div className="rounded-[34px] border border-white/80 bg-white/95 p-6 shadow-[0_24px_70px_rgba(15,23,42,0.13)]">
          <h3 className="text-2xl font-black text-slate-950">Recommended Actions</h3>
          <div className="mt-6 space-y-4">
            {insights.map(([title, detail, tag]) => (
              <article key={title} className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
                <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
                  <div className="flex items-start gap-4">
                    <div className="rounded-2xl bg-cyan-100 p-3 text-cyan-700"><Sparkles className="h-5 w-5" /></div>
                    <div>
                      <div className="font-black text-slate-950">{title}</div>
                      <div className="mt-1 text-sm text-slate-500">{detail}</div>
                    </div>
                  </div>
                  <span className="w-fit rounded-full bg-[#06101f] px-3 py-1 text-xs font-black text-cyan-300">{tag}</span>
                </div>
              </article>
            ))}
          </div>
        </div>

        <div className="rounded-[34px] bg-[#06101f] p-6 text-white">
          <Bot className="h-8 w-8 text-cyan-300" />
          <h3 className="mt-5 text-2xl font-black">Manager Co-Pilot Direction</h3>
          <p className="mt-4 text-sm leading-7 text-slate-300">
            Later, this should use safe server-side summaries from Supabase data to answer manager questions, explain payroll risk and recommend action steps.
          </p>
          <div className="mt-8 rounded-[28px] bg-white/10 p-5">
            <div className="text-xs font-black uppercase tracking-[0.25em] text-cyan-300">Example prompt</div>
            <div className="mt-3 text-xl font-black">“What must I fix before payroll?”</div>
          </div>
        </div>
      </div>
    </section>
  );
}

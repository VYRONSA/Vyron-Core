"use client";

import { BookOpenCheck, Brain, CheckCircle2, Gavel, ShieldAlert } from "lucide-react";

const policies = [
  { rule: "Late arrival warning", status: "Active", confidence: "High", action: "Suggest counselling after 3 incidents" },
  { rule: "Missing clock-out", status: "Active", confidence: "High", action: "Block payroll until manager review" },
  { rule: "Overtime approval", status: "Active", confidence: "Medium", action: "Flag overtime above rostered threshold" },
  { rule: "Leave balance check", status: "Active", confidence: "High", action: "Warn if leave exceeds available balance" },
];

export default function AIPolicyControlCentre() {
  return (
    <section className="rounded-[34px] border border-white/80 bg-white/95 p-6 shadow-[0_24px_70px_rgba(15,23,42,0.13)] backdrop-blur-xl">
      <div className="flex flex-col gap-5 xl:flex-row xl:items-center xl:justify-between">
        <div>
          <div className="text-xs font-black uppercase tracking-[0.35em] text-cyan-700">AI Policy Layer</div>
          <h2 className="mt-3 text-3xl font-black tracking-tight text-slate-950">Policy Intelligence Control Centre</h2>
          <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-500">
            Convert company HR, clocking and payroll rules into guided decision logic for managers.
          </p>
        </div>

        <div className="rounded-[28px] bg-gradient-to-br from-blue-600 to-cyan-400 p-5 text-white shadow-[0_18px_45px_rgba(37,99,235,0.25)]">
          <div className="text-xs font-black uppercase tracking-[0.28em] text-cyan-50">Policy coverage</div>
          <div className="mt-2 text-4xl font-black">74%</div>
        </div>
      </div>

      <div className="mt-8 grid gap-5 md:grid-cols-4">
        {[
          ["Active Rules", "28", <BookOpenCheck key="i1" className="h-6 w-6" />],
          ["Manager Guidance", "Live", <Brain key="i2" className="h-6 w-6" />],
          ["Risk Flags", "11", <ShieldAlert key="i3" className="h-6 w-6" />],
          ["HR Actions", "6", <Gavel key="i4" className="h-6 w-6" />],
        ].map(([title, value, icon]) => (
          <div key={String(title)} className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-[0_14px_40px_rgba(15,23,42,0.08)]">
            <div className="w-fit rounded-2xl bg-cyan-100 p-3 text-cyan-700">{icon}</div>
            <div className="mt-5 text-3xl font-black text-slate-950">{value}</div>
            <div className="mt-2 text-sm font-black text-slate-700">{title}</div>
          </div>
        ))}
      </div>

      <div className="mt-8 space-y-4">
        {policies.map((policy) => (
          <article key={policy.rule} className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-[0_14px_40px_rgba(15,23,42,0.08)]">
            <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
              <div className="flex items-start gap-4">
                <div className="rounded-2xl bg-cyan-100 p-3 text-cyan-700">
                  <CheckCircle2 className="h-5 w-5" />
                </div>
                <div>
                  <div className="font-black text-slate-950">{policy.rule}</div>
                  <div className="mt-1 text-sm text-slate-500">{policy.action}</div>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-black text-emerald-700">{policy.status}</span>
                <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-black text-slate-700">{policy.confidence} confidence</span>
              </div>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

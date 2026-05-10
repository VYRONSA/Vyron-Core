"use client";

import { AlertTriangle, ArrowRight, Bot, Clock3, ShieldCheck, Zap } from "lucide-react";

const queue = [
  { type: "Missing clock-out", employee: "Jason Peters", priority: "High", recommendation: "Request manager confirmation before payroll." },
  { type: "Late arrival", employee: "Amy Daniels", priority: "Medium", recommendation: "Log coaching note after repeated pattern." },
  { type: "GPS mismatch", employee: "John Smith", priority: "High", recommendation: "Verify clock photo and store radius." },
  { type: "Unapproved overtime", employee: "Mary Jacobs", priority: "Medium", recommendation: "Send overtime approval request." },
];

export default function ExceptionAutoTriage() {
  return (
    <section className="rounded-[34px] border border-white/80 bg-white/95 p-6 shadow-[0_24px_70px_rgba(15,23,42,0.13)] backdrop-blur-xl">
      <div className="flex flex-col gap-5 xl:flex-row xl:items-center xl:justify-between">
        <div>
          <div className="text-xs font-black uppercase tracking-[0.35em] text-cyan-700">Automation Engine</div>
          <h2 className="mt-3 text-3xl font-black tracking-tight text-slate-950">Exception Auto-Triage</h2>
          <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-500">
            Automatically classify clocking, roster and payroll exceptions into priority queues with recommended manager actions.
          </p>
        </div>
        <div className="rounded-full bg-rose-100 px-4 py-2 text-sm font-black text-rose-700">4 urgent items</div>
      </div>

      <div className="mt-8 grid gap-5 md:grid-cols-4">
        {[
          ["Open Exceptions", "39", <AlertTriangle key="i1" className="h-6 w-6" />],
          ["Auto-Classified", "31", <Bot key="i2" className="h-6 w-6" />],
          ["Payroll Blockers", "14", <ShieldCheck key="i3" className="h-6 w-6" />],
          ["Avg Resolution", "2.4h", <Clock3 key="i4" className="h-6 w-6" />],
        ].map(([title, value, icon]) => (
          <div key={String(title)} className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-[0_14px_40px_rgba(15,23,42,0.08)]">
            <div className="w-fit rounded-2xl bg-cyan-100 p-3 text-cyan-700">{icon}</div>
            <div className="mt-5 text-3xl font-black text-slate-950">{value}</div>
            <div className="mt-2 text-sm font-black text-slate-700">{title}</div>
          </div>
        ))}
      </div>

      <div className="mt-8 space-y-4">
        {queue.map((item) => (
          <article key={item.type + item.employee} className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-[0_14px_40px_rgba(15,23,42,0.08)]">
            <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
              <div className="flex items-start gap-4">
                <div className="rounded-2xl bg-amber-100 p-3 text-amber-700"><Zap className="h-5 w-5" /></div>
                <div>
                  <div className="font-black text-slate-950">{item.type}</div>
                  <div className="mt-1 text-sm text-slate-500">{item.employee}</div>
                  <div className="mt-2 text-sm font-black text-cyan-700">{item.recommendation}</div>
                </div>
              </div>
              <button className="flex items-center gap-2 rounded-2xl bg-[#06101f] px-4 py-2 text-xs font-black text-cyan-300">
                Apply recommendation <ArrowRight className="h-3 w-3" />
              </button>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

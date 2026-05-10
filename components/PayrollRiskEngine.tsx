"use client";

import {
  AlertTriangle,
  BarChart3,
  Clock3,
  ShieldAlert,
  ShieldCheck,
  TrendingUp,
  WalletCards,
} from "lucide-react";

const riskItems = [
  { title: "Missing clock-outs", value: "6", risk: "High", impact: "Blocks payroll export" },
  { title: "Unapproved overtime", value: "R18,500", risk: "High", impact: "Potential payroll leakage" },
  { title: "Late arrival pattern", value: "11", risk: "Medium", impact: "Manager review required" },
  { title: "Leave overlap warnings", value: "3", risk: "Medium", impact: "Schedule conflict risk" },
];

export default function PayrollRiskEngine() {
  return (
    <section className="space-y-8">
      <div className="rounded-[34px] border border-white/80 bg-white/95 p-6 shadow-[0_24px_70px_rgba(15,23,42,0.13)] backdrop-blur-xl">
        <div className="flex flex-col gap-5 xl:flex-row xl:items-center xl:justify-between">
          <div>
            <div className="text-xs font-black uppercase tracking-[0.35em] text-cyan-700">Payroll Risk</div>
            <h2 className="mt-3 text-3xl font-black tracking-tight text-slate-950">Payroll Risk Engine</h2>
            <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-500">
              Risk summary for payroll blockers, unresolved clocking issues, overtime exposure and manager review actions.
            </p>
          </div>

          <div className="rounded-[28px] bg-gradient-to-br from-rose-600 to-orange-500 p-5 text-white">
            <div className="text-xs font-black uppercase tracking-[0.28em] text-rose-100">Risk status</div>
            <div className="mt-2 text-4xl font-black">Review</div>
          </div>
        </div>

        <div className="mt-8 grid gap-5 md:grid-cols-4">
          {[
            ["Payroll Exposure", "R84,900", <WalletCards key="a" className="h-6 w-6" />],
            ["High Risk Items", "8", <ShieldAlert key="b" className="h-6 w-6" />],
            ["Manager Reviews", "14", <Clock3 key="c" className="h-6 w-6" />],
            ["Readiness", "87%", <ShieldCheck key="d" className="h-6 w-6" />],
          ].map(([title, value, icon]) => (
            <article key={String(title)} className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
              <div className="w-fit rounded-2xl bg-cyan-100 p-3 text-cyan-700">{icon}</div>
              <div className="mt-5 text-3xl font-black text-slate-950">{value}</div>
              <div className="mt-2 text-sm font-black text-slate-700">{title}</div>
            </article>
          ))}
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-[1fr_0.85fr]">
        <div className="rounded-[34px] border border-white/80 bg-white/95 p-6 shadow-[0_24px_70px_rgba(15,23,42,0.13)] backdrop-blur-xl">
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div>
              <h3 className="text-2xl font-black tracking-tight text-slate-950">Current Risk Items</h3>
              <p className="mt-2 text-sm text-slate-500">The items most likely to delay or distort payroll.</p>
            </div>
            <div className="rounded-full bg-rose-100 px-4 py-2 text-sm font-black text-rose-700">Action required</div>
          </div>

          <div className="mt-7 space-y-4">
            {riskItems.map((item) => (
              <article key={item.title} className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
                <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                  <div className="flex items-start gap-4">
                    <div className="rounded-2xl bg-amber-100 p-3 text-amber-700">
                      <AlertTriangle className="h-5 w-5" />
                    </div>
                    <div>
                      <div className="font-black text-slate-950">{item.title}</div>
                      <div className="mt-1 text-sm text-slate-500">{item.impact}</div>
                    </div>
                  </div>

                  <div className="text-right">
                    <div className="text-2xl font-black text-slate-950">{item.value}</div>
                    <span className={`mt-2 inline-flex rounded-full px-3 py-1 text-xs font-black ${item.risk === "High" ? "bg-rose-100 text-rose-700" : "bg-amber-100 text-amber-700"}`}>
                      {item.risk}
                    </span>
                  </div>
                </div>
              </article>
            ))}
          </div>
        </div>

        <div className="rounded-[34px] bg-[#06101f] p-6 text-white shadow-[0_24px_70px_rgba(2,6,23,0.30)]">
          <BarChart3 className="h-8 w-8 text-cyan-300" />
          <h3 className="mt-5 text-3xl font-black">Risk interpretation</h3>
          <p className="mt-4 text-sm leading-7 text-slate-300">
            Payroll should not be exported while high-risk clocking, overtime and approval problems are unresolved. This protects the company from leakage and disputes.
          </p>

          <div className="mt-8 rounded-[28px] bg-white/10 p-5">
            <div className="text-xs font-black uppercase tracking-[0.25em] text-cyan-300">Recommended action</div>
            <div className="mt-3 text-2xl font-black">Clear high-risk blockers first</div>
          </div>

          <div className="mt-8 flex items-center gap-3 rounded-[28px] bg-emerald-500/15 p-5 text-emerald-100">
            <TrendingUp className="h-6 w-6" />
            <p className="text-sm leading-6">Use this page during payroll review and executive reporting.</p>
          </div>
        </div>
      </div>
    </section>
  );
}

"use client";

import { AlertTriangle, ArrowRight, Building2, Clock3, ShieldAlert, UserRound } from "lucide-react";

const risks = [
  {
    title: "Payroll export blocked by unresolved clock events",
    owner: "Payroll Manager",
    area: "Payroll",
    severity: "Critical",
    due: "Before payroll close",
  },
  {
    title: "Repeated late arrival pattern at Waterstone",
    owner: "Store Manager",
    area: "Clocking",
    severity: "High",
    due: "Today",
  },
  {
    title: "Employee document file incomplete",
    owner: "HR Manager",
    area: "HR Documents",
    severity: "Medium",
    due: "This week",
  },
  {
    title: "Roster fatigue risk for two employees",
    owner: "Operations Manager",
    area: "Roster",
    severity: "Medium",
    due: "Next roster cycle",
  },
];

export default function RiskRegisterPanel() {
  return (
    <section className="rounded-[34px] border border-white/80 bg-white/95 p-6 shadow-[0_24px_70px_rgba(15,23,42,0.13)] backdrop-blur-xl">
      <div className="flex flex-col gap-5 xl:flex-row xl:items-center xl:justify-between">
        <div>
          <div className="text-xs font-black uppercase tracking-[0.35em] text-cyan-700">Risk Register</div>
          <h2 className="mt-3 text-3xl font-black tracking-tight text-slate-950">Operational Risk Register</h2>
          <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-500">
            Converts scattered operational problems into an accountable risk register with owner, severity and due date.
          </p>
        </div>

        <div className="rounded-full bg-rose-100 px-4 py-2 text-sm font-black text-rose-700">
          4 active risks
        </div>
      </div>

      <div className="mt-8 space-y-4">
        {risks.map((risk) => (
          <article key={risk.title} className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-[0_14px_40px_rgba(15,23,42,0.08)]">
            <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
              <div className="flex items-start gap-4">
                <div className={`rounded-2xl p-3 ${
                  risk.severity === "Critical" ? "bg-rose-100 text-rose-700" : risk.severity === "High" ? "bg-orange-100 text-orange-700" : "bg-amber-100 text-amber-700"
                }`}>
                  <ShieldAlert className="h-5 w-5" />
                </div>

                <div>
                  <div className="font-black text-slate-950">{risk.title}</div>
                  <div className="mt-2 flex flex-wrap gap-2 text-xs font-black uppercase tracking-[0.14em]">
                    <span className="rounded-full bg-slate-100 px-3 py-1 text-slate-600">{risk.area}</span>
                    <span className="rounded-full bg-cyan-100 px-3 py-1 text-cyan-700">{risk.owner}</span>
                    <span className="rounded-full bg-amber-100 px-3 py-1 text-amber-700">{risk.due}</span>
                  </div>
                </div>
              </div>

              <button className="flex w-fit items-center gap-2 rounded-2xl bg-[#06101f] px-4 py-2 text-xs font-black text-cyan-300">
                Open action <ArrowRight className="h-3 w-3" />
              </button>
            </div>
          </article>
        ))}
      </div>

      <div className="mt-8 grid gap-5 md:grid-cols-3">
        {[
          ["People risk", "HR + attendance", <UserRound key="p" className="h-6 w-6" />],
          ["Store risk", "Branch-level control", <Building2 key="s" className="h-6 w-6" />],
          ["Payroll risk", "Before export close", <Clock3 key="c" className="h-6 w-6" />],
        ].map(([title, subtitle, icon]) => (
          <div key={String(title)} className="rounded-[28px] bg-[#06101f] p-5 text-white">
            <div className="text-cyan-300">{icon}</div>
            <div className="mt-4 text-xl font-black">{title}</div>
            <div className="mt-2 text-sm text-slate-300">{subtitle}</div>
          </div>
        ))}
      </div>
    </section>
  );
}

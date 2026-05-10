"use client";

import { AlarmClock, ArrowUpRight, BellRing, Clock3, UserCheck } from "lucide-react";

const escalations = [
  { title: "Payroll blocker not reviewed", owner: "Payroll Manager", age: "18 hours", level: "Escalate today" },
  { title: "Leave approval waiting", owner: "Store Manager", age: "2 days", level: "Reminder" },
  { title: "HR case without response", owner: "HR Manager", age: "4 days", level: "Escalate" },
  { title: "Missing document follow-up", owner: "Admin", age: "7 days", level: "Critical" },
];

export default function SlaEscalationPanel() {
  return (
    <section className="rounded-[34px] border border-white/80 bg-white/95 p-6 shadow-[0_24px_70px_rgba(15,23,42,0.13)] backdrop-blur-xl">
      <div className="flex flex-col gap-5 xl:flex-row xl:items-center xl:justify-between">
        <div>
          <div className="text-xs font-black uppercase tracking-[0.35em] text-cyan-700">SLA Escalation</div>
          <h2 className="mt-3 text-3xl font-black tracking-tight text-slate-950">Manager Escalation Control</h2>
          <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-500">
            Keeps important payroll, HR, leave and document actions from going stale by tracking ownership and age.
          </p>
        </div>

        <div className="rounded-full bg-amber-100 px-4 py-2 text-sm font-black text-amber-700">
          4 escalations
        </div>
      </div>

      <div className="mt-8 grid gap-5 md:grid-cols-4">
        {[
          ["Open SLAs", "21", <AlarmClock key="i1" className="h-6 w-6" />],
          ["Overdue", "7", <BellRing key="i2" className="h-6 w-6" />],
          ["Managers", "9", <UserCheck key="i3" className="h-6 w-6" />],
          ["Avg Action", "5.2h", <Clock3 key="i4" className="h-6 w-6" />],
        ].map(([title, value, icon]) => (
          <div key={String(title)} className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-[0_14px_40px_rgba(15,23,42,0.08)]">
            <div className="w-fit rounded-2xl bg-cyan-100 p-3 text-cyan-700">{icon}</div>
            <div className="mt-5 text-3xl font-black text-slate-950">{value}</div>
            <div className="mt-2 text-sm font-black text-slate-700">{title}</div>
          </div>
        ))}
      </div>

      <div className="mt-8 space-y-4">
        {escalations.map((item) => (
          <article key={item.title} className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-[0_14px_40px_rgba(15,23,42,0.08)]">
            <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
              <div>
                <div className="font-black text-slate-950">{item.title}</div>
                <div className="mt-1 text-sm text-slate-500">{item.owner} · age {item.age}</div>
              </div>

              <button className="flex w-fit items-center gap-2 rounded-2xl bg-[#06101f] px-4 py-2 text-xs font-black text-cyan-300">
                {item.level} <ArrowUpRight className="h-3 w-3" />
              </button>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

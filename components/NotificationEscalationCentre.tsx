"use client";

import { AlertTriangle, BellRing, CalendarDays, Clock3, Mail, MessageSquare, WalletCards } from "lucide-react";

const actions = [
  { title: "Payroll blocker reminder", owner: "Payroll Manager", channel: "Email + app", urgency: "High" },
  { title: "Missing clock-out escalation", owner: "Store Manager", channel: "App notification", urgency: "High" },
  { title: "Leave approval reminder", owner: "Line Manager", channel: "App notification", urgency: "Medium" },
  { title: "HR document missing", owner: "HR Admin", channel: "Email", urgency: "Medium" },
];

export default function NotificationEscalationCentre() {
  return (
    <section className="rounded-[34px] border border-white/80 bg-white/95 p-6 shadow-[0_24px_70px_rgba(15,23,42,0.13)] backdrop-blur-xl">
      <div className="flex flex-col gap-5 xl:flex-row xl:items-center xl:justify-between">
        <div>
          <div className="text-xs font-black uppercase tracking-[0.35em] text-cyan-700">Notifications</div>
          <h2 className="mt-3 text-3xl font-black tracking-tight text-slate-950">Notification & Escalation Centre</h2>
          <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-500">
            Keeps managers accountable with payroll, leave, clocking, HR and document escalation workflows.
          </p>
        </div>
        <div className="rounded-full bg-rose-100 px-4 py-2 text-sm font-black text-rose-700">4 urgent reminders</div>
      </div>

      <div className="mt-8 grid gap-5 md:grid-cols-4">
        {[
          ["Open Notifications", "38", <BellRing key="1" className="h-6 w-6" />],
          ["Payroll Alerts", "14", <WalletCards key="2" className="h-6 w-6" />],
          ["Leave Reminders", "7", <CalendarDays key="3" className="h-6 w-6" />],
          ["Avg Response", "3.6h", <Clock3 key="4" className="h-6 w-6" />],
        ].map(([title, value, icon]) => (
          <article key={String(title)} className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
            <div className="w-fit rounded-2xl bg-cyan-100 p-3 text-cyan-700">{icon}</div>
            <div className="mt-5 text-3xl font-black text-slate-950">{value}</div>
            <div className="mt-2 text-sm font-black text-slate-700">{title}</div>
          </article>
        ))}
      </div>

      <div className="mt-8 space-y-4">
        {actions.map((action) => (
          <article key={action.title} className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
              <div className="flex items-start gap-4">
                <div className={`rounded-2xl p-3 ${action.urgency === "High" ? "bg-rose-100 text-rose-700" : "bg-amber-100 text-amber-700"}`}>
                  <AlertTriangle className="h-5 w-5" />
                </div>
                <div>
                  <div className="font-black text-slate-950">{action.title}</div>
                  <div className="mt-1 text-sm text-slate-500">{action.owner} · {action.channel}</div>
                </div>
              </div>
              <div className="flex gap-2">
                <button className="flex items-center gap-2 rounded-2xl bg-slate-100 px-4 py-2 text-xs font-black text-slate-700"><Mail className="h-3 w-3" /> Email</button>
                <button className="flex items-center gap-2 rounded-2xl bg-[#06101f] px-4 py-2 text-xs font-black text-cyan-300"><MessageSquare className="h-3 w-3" /> Notify</button>
              </div>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

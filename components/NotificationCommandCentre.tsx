"use client";

import { AlertTriangle, Bell, CalendarDays, CheckCircle2, Clock3, WalletCards } from "lucide-react";

const notifications = [
  {
    title: "Payroll blocker requires review",
    subtitle: "14 unresolved payroll checks before export.",
    type: "Payroll",
    urgency: "High",
    icon: <WalletCards className="h-5 w-5" />,
  },
  {
    title: "Leave approval waiting",
    subtitle: "3 leave applications have not been actioned.",
    type: "Leave",
    urgency: "Medium",
    icon: <CalendarDays className="h-5 w-5" />,
  },
  {
    title: "Missing clock-out detected",
    subtitle: "Jason Peters has no clock-out for yesterday.",
    type: "Clocking",
    urgency: "High",
    icon: <Clock3 className="h-5 w-5" />,
  },
  {
    title: "HR case nearing deadline",
    subtitle: "Manager action required before disciplinary deadline.",
    type: "HR",
    urgency: "Medium",
    icon: <AlertTriangle className="h-5 w-5" />,
  },
];

export default function NotificationCommandCentre() {
  return (
    <section className="rounded-[34px] border border-white/80 bg-white/95 p-6 shadow-[0_24px_70px_rgba(15,23,42,0.13)] backdrop-blur-xl">
      <div className="flex flex-col gap-5 xl:flex-row xl:items-center xl:justify-between">
        <div>
          <div className="flex items-center gap-3">
            <div className="rounded-2xl bg-[#06101f] p-3 text-cyan-300">
              <Bell className="h-6 w-6" />
            </div>
            <div>
              <div className="text-xs font-black uppercase tracking-[0.35em] text-cyan-700">
                Notification Engine
              </div>
              <h2 className="mt-2 text-3xl font-black tracking-tight text-slate-950">
                Manager Action Inbox
              </h2>
            </div>
          </div>

          <p className="mt-4 max-w-3xl text-sm leading-6 text-slate-500">
            A central inbox for payroll blockers, clocking errors, leave requests, HR risks and escalation reminders.
          </p>
        </div>

        <div className="rounded-full bg-rose-100 px-4 py-2 text-sm font-black text-rose-700">
          4 urgent actions
        </div>
      </div>

      <div className="mt-8 space-y-4">
        {notifications.map((notification) => (
          <article
            key={notification.title}
            className="flex flex-col gap-4 rounded-[28px] border border-slate-200 bg-white p-5 shadow-[0_14px_40px_rgba(15,23,42,0.08)] md:flex-row md:items-center md:justify-between"
          >
            <div className="flex items-start gap-4">
              <div className="rounded-2xl bg-cyan-100 p-3 text-cyan-700">
                {notification.icon}
              </div>

              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="font-black text-slate-950">{notification.title}</h3>
                  <span className="rounded-full bg-slate-100 px-3 py-1 text-[11px] font-black uppercase tracking-[0.18em] text-slate-500">
                    {notification.type}
                  </span>
                </div>
                <p className="mt-2 text-sm text-slate-500">{notification.subtitle}</p>
              </div>
            </div>

            <div className="flex gap-2">
              <button className="rounded-2xl bg-slate-100 px-4 py-2 text-xs font-black text-slate-700">
                Snooze
              </button>
              <button className="rounded-2xl bg-[#06101f] px-4 py-2 text-xs font-black text-cyan-300">
                Review
              </button>
            </div>
          </article>
        ))}
      </div>

      <div className="mt-6 rounded-[28px] bg-emerald-50 p-5 text-emerald-800">
        <div className="flex items-center gap-3">
          <CheckCircle2 className="h-6 w-6" />
          <div>
            <div className="font-black">Future upgrade</div>
            <p className="mt-1 text-sm">
              This engine can later connect to email, WhatsApp and push notifications.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

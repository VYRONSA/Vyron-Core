"use client";

import React from "react";
import { Bell, CalendarDays, Clock3, ShieldAlert, Users } from "lucide-react";

export default function MobileWorkforceShell() {
  const cards = [
    { title: "Clocking", icon: <Clock3 className="h-6 w-6" />, value: "Live" },
    { title: "Leave", icon: <CalendarDays className="h-6 w-6" />, value: "Managed" },
    { title: "HR Cases", icon: <ShieldAlert className="h-6 w-6" />, value: "Tracked" },
    { title: "Notifications", icon: <Bell className="h-6 w-6" />, value: "Realtime" },
  ];

  return (
    <section className="space-y-6">
      <div className="rounded-[34px] bg-gradient-to-r from-[#07101f] to-[#0b1a33] p-7 text-white shadow-2xl">
        <div className="text-xs font-black uppercase tracking-[0.4em] text-cyan-300">MOBILE EXPERIENCE</div>
        <h1 className="mt-3 text-4xl font-black">Workforce Mobile Shell</h1>
        <p className="mt-3 max-w-3xl text-sm leading-7 text-slate-300">
          Foundation for employee mobile self-service and workforce engagement.
        </p>
      </div>

      <div className="grid gap-5 md:grid-cols-4">
        {cards.map((card) => (
          <div key={card.title} className="rounded-[28px] bg-white p-6 shadow-lg">
            <div className="text-slate-900">{card.icon}</div>
            <div className="mt-4 text-2xl font-black text-slate-950">{card.value}</div>
            <div className="text-sm font-bold text-slate-500">{card.title}</div>
          </div>
        ))}
      </div>

      <div className="rounded-[34px] bg-white p-6 shadow-lg">
        <div className="flex items-center gap-3">
          <Users className="h-7 w-7 text-slate-900" />
          <h2 className="text-2xl font-black text-slate-950">Next mobile rollout</h2>
        </div>

        <div className="mt-6 grid gap-4 md:grid-cols-2">
          <div className="rounded-2xl bg-slate-50 p-5">
            <div className="font-black text-slate-950">Employee app</div>
            <p className="mt-2 text-sm leading-6 text-slate-600">
              Clocking, leave requests, HR communication and roster visibility.
            </p>
          </div>

          <div className="rounded-2xl bg-slate-50 p-5">
            <div className="font-black text-slate-950">Manager app</div>
            <p className="mt-2 text-sm leading-6 text-slate-600">
              Exception approval, HR escalation, payroll blockers and staffing control.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

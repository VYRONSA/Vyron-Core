"use client";

import { Bell, Camera, CheckCircle2, MapPin, MessageSquare, ShieldCheck, Smartphone, UserCheck } from "lucide-react";

const actions = [
  ["Approve leave", "3 pending requests", "Manager action"],
  ["Review missing clock-out", "5 events need review", "Clocking"],
  ["Approve overtime", "R8,450 exposure", "Payroll"],
  ["Acknowledge HR case", "2 overdue actions", "HR"],
];

export default function MobileManagerExperience() {
  return (
    <section className="space-y-8">
      <div className="rounded-[34px] border border-white/80 bg-white/95 p-6 shadow-[0_24px_70px_rgba(15,23,42,0.13)]">
        <div className="flex flex-col gap-5 xl:flex-row xl:items-center xl:justify-between">
          <div>
            <div className="text-xs font-black uppercase tracking-[0.35em] text-cyan-700">Mobile Manager</div>
            <h2 className="mt-3 text-3xl font-black tracking-tight text-slate-950">Manager Mobile Experience</h2>
            <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-500">
              A practical manager phone experience for approvals, clock review, HR actions, leave and notifications.
            </p>
          </div>
          <div className="rounded-[28px] bg-gradient-to-br from-blue-600 to-cyan-400 p-5 text-white">
            <div className="text-xs font-black uppercase tracking-[0.28em] text-cyan-50">Mobile readiness</div>
            <div className="mt-2 text-4xl font-black">78%</div>
          </div>
        </div>

        <div className="mt-8 grid gap-5 md:grid-cols-4">
          {[
            ["Photo Clocking", "Live", <Camera key="a" className="h-6 w-6" />],
            ["GPS Check", "Live", <MapPin key="b" className="h-6 w-6" />],
            ["Push UX", "Planned", <Bell key="c" className="h-6 w-6" />],
            ["Approvals", "Ready", <CheckCircle2 key="d" className="h-6 w-6" />],
          ].map(([title, value, icon]) => (
            <article key={String(title)} className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
              <div className="w-fit rounded-2xl bg-cyan-100 p-3 text-cyan-700">{icon}</div>
              <div className="mt-5 text-2xl font-black text-slate-950">{value}</div>
              <div className="mt-2 text-sm font-black text-slate-700">{title}</div>
            </article>
          ))}
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-[0.7fr_1.3fr]">
        <div className="rounded-[38px] bg-[#06101f] p-6 text-white shadow-[0_24px_70px_rgba(2,6,23,0.30)]">
          <Smartphone className="h-10 w-10 text-cyan-300" />
          <h3 className="mt-6 text-3xl font-black">Phone-first action cards</h3>
          <p className="mt-4 text-sm leading-7 text-slate-300">
            Managers should be able to clear payroll and HR blockers from their phone without opening a complicated desktop screen.
          </p>
          <div className="mt-8 rounded-[28px] bg-white/10 p-5">
            <div className="text-xs font-black uppercase tracking-[0.25em] text-cyan-300">Commercial result</div>
            <div className="mt-3 text-2xl font-black">Less admin. Faster payroll.</div>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          {actions.map(([title, detail, type]) => (
            <article key={title} className="rounded-[28px] border border-white/80 bg-white/95 p-5 shadow-sm">
              <div className="flex items-start gap-4">
                <div className="rounded-2xl bg-cyan-100 p-3 text-cyan-700"><UserCheck className="h-5 w-5" /></div>
                <div>
                  <div className="font-black text-slate-950">{title}</div>
                  <div className="mt-1 text-sm text-slate-500">{detail}</div>
                  <div className="mt-3 w-fit rounded-full bg-slate-100 px-3 py-1 text-xs font-black text-slate-600">{type}</div>
                </div>
              </div>
              <div className="mt-5 flex gap-2">
                <button className="flex-1 rounded-2xl bg-[#06101f] px-4 py-3 text-xs font-black text-cyan-300">Approve</button>
                <button className="flex-1 rounded-2xl bg-slate-100 px-4 py-3 text-xs font-black text-slate-700">Review</button>
              </div>
            </article>
          ))}
        </div>
      </div>

      <div className="rounded-[34px] border border-white/80 bg-white/95 p-6 shadow-[0_24px_70px_rgba(15,23,42,0.13)]">
        <div className="flex items-center gap-3">
          <ShieldCheck className="h-6 w-6 text-cyan-700" />
          <h3 className="text-2xl font-black text-slate-950">Mobile trust features</h3>
        </div>
        <div className="mt-6 grid gap-4 md:grid-cols-3">
          {["Offline clock queue", "Device identity", "Manager approval trail"].map((item) => (
            <div key={item} className="rounded-[24px] bg-slate-50 p-5 font-black text-slate-800">{item}</div>
          ))}
        </div>
      </div>
    </section>
  );
}

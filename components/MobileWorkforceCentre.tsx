"use client";

import { Camera, CheckCircle2, MapPin, MessageSquare, Smartphone, UserCheck } from "lucide-react";

const mobileFlows = [
  "Employee clock-in with photo and GPS",
  "Manager clock review from phone",
  "Leave request and approval",
  "Push notifications for roster changes",
  "HR document acknowledgement",
  "Offline clock queue for bad signal",
];

export default function MobileWorkforceCentre() {
  return (
    <section className="rounded-[34px] border border-white/80 bg-white/95 p-6 shadow-[0_24px_70px_rgba(15,23,42,0.13)] backdrop-blur-xl">
      <div className="flex flex-col gap-5 xl:flex-row xl:items-center xl:justify-between">
        <div>
          <div className="text-xs font-black uppercase tracking-[0.35em] text-cyan-700">Mobile Workforce</div>
          <h2 className="mt-3 text-3xl font-black tracking-tight text-slate-950">Mobile Workforce Control Centre</h2>
          <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-500">
            Roadmap and control layer for employee and manager mobile workflows.
          </p>
        </div>
        <div className="rounded-[28px] bg-gradient-to-br from-blue-600 to-cyan-400 p-5 text-white">
          <div className="text-xs font-black uppercase tracking-[0.28em] text-cyan-50">Mobile readiness</div>
          <div className="mt-2 text-4xl font-black">62%</div>
        </div>
      </div>

      <div className="mt-8 grid gap-5 md:grid-cols-4">
        {[
          ["Photo Clocking", "Ready", <Camera key="1" className="h-6 w-6" />],
          ["GPS", "Ready", <MapPin key="2" className="h-6 w-6" />],
          ["Manager App", "Next", <UserCheck key="3" className="h-6 w-6" />],
          ["Push Alerts", "Planned", <MessageSquare key="4" className="h-6 w-6" />],
        ].map(([title, value, icon]) => (
          <article key={String(title)} className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
            <div className="w-fit rounded-2xl bg-cyan-100 p-3 text-cyan-700">{icon}</div>
            <div className="mt-5 text-2xl font-black text-slate-950">{value}</div>
            <div className="mt-2 text-sm font-black text-slate-700">{title}</div>
          </article>
        ))}
      </div>

      <div className="mt-8 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {mobileFlows.map((flow) => (
          <article key={flow} className="flex items-start gap-4 rounded-[26px] border border-slate-200 bg-white p-5 shadow-sm">
            <div className="rounded-2xl bg-cyan-100 p-3 text-cyan-700"><Smartphone className="h-5 w-5" /></div>
            <div>
              <div className="font-black text-slate-950">{flow}</div>
              <div className="mt-1 text-sm text-slate-500">Mobile workflow module</div>
            </div>
          </article>
        ))}
      </div>

      <div className="mt-6 rounded-[28px] bg-emerald-50 p-5 text-emerald-800">
        <div className="flex items-center gap-3">
          <CheckCircle2 className="h-6 w-6" />
          <div>
            <div className="font-black">Commercial value</div>
            <p className="mt-1 text-sm">Mobile manager workflows make the product much easier to adopt across distributed teams.</p>
          </div>
        </div>
      </div>
    </section>
  );
}

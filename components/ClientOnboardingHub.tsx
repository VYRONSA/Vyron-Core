"use client";

import { CheckCircle2, ClipboardList, Store, Upload, Users, Wand2 } from "lucide-react";

const steps = [
  { title: "Company profile", status: "Complete", icon: <ClipboardList className="h-5 w-5" /> },
  { title: "Store setup", status: "Complete", icon: <Store className="h-5 w-5" /> },
  { title: "Employee import", status: "In Progress", icon: <Users className="h-5 w-5" /> },
  { title: "Roster templates", status: "Pending", icon: <Wand2 className="h-5 w-5" /> },
  { title: "Payroll rules", status: "Pending", icon: <CheckCircle2 className="h-5 w-5" /> },
  { title: "Document upload", status: "Pending", icon: <Upload className="h-5 w-5" /> },
];

export default function ClientOnboardingHub() {
  return (
    <section className="rounded-[34px] border border-white/80 bg-white/95 p-6 shadow-[0_24px_70px_rgba(15,23,42,0.13)] backdrop-blur-xl">
      <div className="flex flex-col gap-5 xl:flex-row xl:items-center xl:justify-between">
        <div>
          <div className="text-xs font-black uppercase tracking-[0.35em] text-cyan-700">Client Setup</div>
          <h2 className="mt-3 text-3xl font-black tracking-tight text-slate-950">Client Onboarding Hub</h2>
          <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-500">
            A guided setup hub for stores, employees, rosters, payroll rules and HR documents.
          </p>
        </div>
        <div className="rounded-[28px] bg-gradient-to-br from-blue-600 to-cyan-400 p-5 text-white">
          <div className="text-xs font-black uppercase tracking-[0.28em] text-cyan-50">Setup progress</div>
          <div className="mt-2 text-4xl font-black">33%</div>
        </div>
      </div>

      <div className="mt-8 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {steps.map((step, index) => (
          <article key={step.title} className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-start gap-4">
                <div className="rounded-2xl bg-cyan-100 p-3 text-cyan-700">{step.icon}</div>
                <div>
                  <div className="text-xs font-black uppercase tracking-[0.22em] text-slate-400">Step {index + 1}</div>
                  <div className="mt-2 text-lg font-black text-slate-950">{step.title}</div>
                </div>
              </div>
              <span className={`rounded-full px-3 py-1 text-xs font-black ${
                step.status === "Complete" ? "bg-emerald-100 text-emerald-700" : step.status === "In Progress" ? "bg-amber-100 text-amber-700" : "bg-slate-100 text-slate-600"
              }`}>{step.status}</span>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

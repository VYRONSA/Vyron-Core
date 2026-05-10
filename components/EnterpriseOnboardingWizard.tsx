"use client";

import { Building2, CheckCircle2, ClipboardList, Database, FileSpreadsheet, Store, Upload, Users } from "lucide-react";

const phases = [
  ["Company setup", "Complete", "Company profile and core rules"],
  ["Store import", "Complete", "Locations and GPS rules"],
  ["Employee import", "In progress", "Bulk employee CSV import"],
  ["Roster templates", "Pending", "Reusable weekly shift patterns"],
  ["Payroll mapping", "Pending", "Export fields and payroll periods"],
  ["Go-live review", "Pending", "Final readiness sign-off"],
];

export default function EnterpriseOnboardingWizard() {
  return (
    <section className="space-y-8">
      <div className="rounded-[34px] border border-white/80 bg-white/95 p-6 shadow-[0_24px_70px_rgba(15,23,42,0.13)]">
        <div className="flex flex-col gap-5 xl:flex-row xl:items-center xl:justify-between">
          <div>
            <div className="text-xs font-black uppercase tracking-[0.35em] text-cyan-700">Enterprise Onboarding</div>
            <h2 className="mt-3 text-3xl font-black tracking-tight text-slate-950">Enterprise Client Onboarding Wizard</h2>
            <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-500">
              A guided client setup process for companies, stores, staff, payroll rules, rosters, documents and go-live readiness.
            </p>
          </div>
          <div className="rounded-[28px] bg-gradient-to-br from-blue-600 to-cyan-400 p-5 text-white">
            <div className="text-xs font-black uppercase tracking-[0.28em] text-cyan-50">Go-live readiness</div>
            <div className="mt-2 text-4xl font-black">42%</div>
          </div>
        </div>

        <div className="mt-8 grid gap-5 md:grid-cols-4">
          {[
            ["Companies", "1", <Building2 key="a" className="h-6 w-6" />],
            ["Stores Ready", "8", <Store key="b" className="h-6 w-6" />],
            ["Employees Loaded", "142", <Users key="c" className="h-6 w-6" />],
            ["Imports", "3", <FileSpreadsheet key="d" className="h-6 w-6" />],
          ].map(([title, value, icon]) => (
            <article key={String(title)} className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
              <div className="w-fit rounded-2xl bg-cyan-100 p-3 text-cyan-700">{icon}</div>
              <div className="mt-5 text-3xl font-black text-slate-950">{value}</div>
              <div className="mt-2 text-sm font-black text-slate-700">{title}</div>
            </article>
          ))}
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-[1fr_0.8fr]">
        <div className="rounded-[34px] border border-white/80 bg-white/95 p-6 shadow-[0_24px_70px_rgba(15,23,42,0.13)]">
          <h3 className="text-2xl font-black text-slate-950">Onboarding Phases</h3>
          <div className="mt-6 space-y-4">
            {phases.map(([title, status, detail], index) => (
              <article key={title} className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
                <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                  <div className="flex items-start gap-4">
                    <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-cyan-100 text-sm font-black text-cyan-700">{index + 1}</div>
                    <div>
                      <div className="font-black text-slate-950">{title}</div>
                      <div className="mt-1 text-sm text-slate-500">{detail}</div>
                    </div>
                  </div>
                  <span className={`w-fit rounded-full px-3 py-1 text-xs font-black ${
                    status === "Complete" ? "bg-emerald-100 text-emerald-700" : status === "In progress" ? "bg-amber-100 text-amber-700" : "bg-slate-100 text-slate-700"
                  }`}>{status}</span>
                </div>
              </article>
            ))}
          </div>
        </div>

        <div className="rounded-[34px] bg-[#06101f] p-6 text-white">
          <Upload className="h-8 w-8 text-cyan-300" />
          <h3 className="mt-5 text-2xl font-black">Bulk setup tools</h3>
          <p className="mt-3 text-sm leading-7 text-slate-300">
            Enterprise clients need fast setup. The import tools must eventually support employees, stores, departments, roster templates and payroll mappings.
          </p>
          <div className="mt-8 space-y-3">
            {["Employee CSV import", "Store CSV import", "Roster template upload", "Document pack upload"].map((item) => (
              <div key={item} className="rounded-2xl bg-white/10 p-4 text-sm font-black text-slate-100">{item}</div>
            ))}
          </div>
        </div>
      </div>

      <div className="rounded-[34px] border border-white/80 bg-white/95 p-6 shadow-[0_24px_70px_rgba(15,23,42,0.13)]">
        <div className="flex items-center gap-3">
          <Database className="h-6 w-6 text-cyan-700" />
          <h3 className="text-2xl font-black text-slate-950">Future database tables</h3>
        </div>
        <p className="mt-3 text-sm text-slate-500">client_onboarding_steps, import_jobs, payroll_mappings, roster_templates, go_live_checklist.</p>
      </div>
    </section>
  );
}

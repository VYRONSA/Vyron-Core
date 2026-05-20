"use client";

import React from "react";
import { Building2, CheckCircle2, Database, Rocket, Users } from "lucide-react";

export default function ClientOnboardingHub() {
  const steps = [
    "Create company record",
    "Add stores and locations",
    "Import employees",
    "Configure clocking rules",
    "Load opening/closing times",
    "Set payroll export rules",
    "Train managers",
    "Run pilot week",
  ];

  return (
    <section className="space-y-6">
      <div className="rounded-[34px] bg-gradient-to-r from-[#07101f] to-[#0b1a33] p-7 text-white shadow-2xl">
        <div className="text-xs font-black uppercase tracking-[0.4em] text-cyan-300">CLIENT ONBOARDING</div>
        <h1 className="mt-3 text-4xl font-black">Enterprise Onboarding Hub</h1>
        <p className="mt-3 max-w-3xl text-sm leading-7 text-slate-300">
          A repeatable rollout workflow for every new VYRON CORE client.
        </p>
      </div>

      <div className="grid gap-5 md:grid-cols-4">
        <Metric icon={<Building2 />} label="Company" value="Setup" />
        <Metric icon={<Users />} label="People" value="Import" />
        <Metric icon={<Database />} label="Rules" value="Configure" />
        <Metric icon={<Rocket />} label="Pilot" value="Launch" />
      </div>

      <div className="rounded-[34px] bg-white p-6 shadow-lg">
        <h2 className="text-2xl font-black text-slate-950">Onboarding checklist</h2>
        <div className="mt-6 grid gap-3 md:grid-cols-2">
          {steps.map((step, index) => (
            <div key={step} className="rounded-2xl bg-slate-50 p-4">
              <div className="flex items-center gap-3">
                <CheckCircle2 className="h-5 w-5 text-emerald-600" />
                <div className="font-black text-slate-950">Step {index + 1}</div>
              </div>
              <div className="mt-2 text-sm font-semibold text-slate-600">{step}</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function Metric({ icon, label, value }: { icon: React.ReactNode; label: string; value: any }) {
  return <div className="rounded-[28px] bg-white p-6 shadow-lg"><div>{icon}</div><div className="mt-4 text-2xl font-black text-slate-950">{value}</div><div className="text-sm font-bold text-slate-500">{label}</div></div>;
}

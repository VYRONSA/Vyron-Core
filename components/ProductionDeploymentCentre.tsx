"use client";

import React from "react";
import { Cloud, Database, Globe, ShieldCheck } from "lucide-react";

export default function ProductionDeploymentCentre() {
  const items = [
    "Vercel deployment",
    "Environment variables",
    "Supabase production hardening",
    "Backup strategy",
    "Role permissions",
    "Audit logging",
    "Payroll export verification",
    "SSL + production domain",
  ];

  return (
    <section className="space-y-6">
      <div className="rounded-[34px] bg-gradient-to-r from-[#07101f] to-[#0b1a33] p-7 text-white shadow-2xl">
        <div className="text-xs font-black uppercase tracking-[0.4em] text-cyan-300">DEPLOYMENT</div>
        <h1 className="mt-3 text-4xl font-black">Production Deployment Centre</h1>
        <p className="mt-3 max-w-3xl text-sm leading-7 text-slate-300">
          Final enterprise rollout preparation for VYRON CORE.
        </p>
      </div>

      <div className="grid gap-5 md:grid-cols-4">
        <Metric icon={<Cloud className="h-6 w-6" />} label="Hosting" value="Vercel" />
        <Metric icon={<Database className="h-6 w-6" />} label="Database" value="Supabase" />
        <Metric icon={<ShieldCheck className="h-6 w-6" />} label="Security" value="Enabled" />
        <Metric icon={<Globe className="h-6 w-6" />} label="Production" value="Ready" />
      </div>

      <div className="rounded-[34px] bg-white p-6 shadow-lg">
        <h2 className="text-2xl font-black text-slate-950">Deployment checklist</h2>

        <div className="mt-6 grid gap-3 md:grid-cols-2">
          {items.map((item, index) => (
            <div key={item} className="rounded-2xl bg-slate-50 p-4">
              <div className="font-black text-slate-950">Step {index + 1}</div>
              <div className="mt-2 text-sm font-semibold text-slate-600">{item}</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function Metric({ icon, label, value }: any) {
  return (
    <div className="rounded-[28px] bg-white p-6 shadow-lg">
      <div>{icon}</div>
      <div className="mt-4 text-2xl font-black text-slate-950">{value}</div>
      <div className="text-sm font-bold text-slate-500">{label}</div>
    </div>
  );
}

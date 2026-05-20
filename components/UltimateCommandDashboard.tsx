"use client";

import React from "react";
import { AlertTriangle, Building2, DollarSign, Users } from "lucide-react";

export default function UltimateCommandDashboard({
  employees = [],
  exceptions = [],
  hrCases = [],
}: any) {
  const openExceptions = exceptions.filter((x:any)=>x.status !== "closed").length;
  const openHr = hrCases.filter((x:any)=>x.status !== "closed").length;
  const risk = openExceptions * 5 + openHr * 7;

  return (
    <section className="space-y-6">
      <div className="rounded-[40px] bg-gradient-to-r from-[#050b18] via-[#09152b] to-[#0d2242] p-8 text-white shadow-2xl">
        <div className="text-xs font-black uppercase tracking-[0.45em] text-cyan-300">VYRON COMMAND</div>
        <h1 className="mt-4 text-5xl font-black">Ultimate Workforce Dashboard</h1>
        <p className="mt-4 max-w-4xl text-sm leading-7 text-slate-300">
          Real-time workforce intelligence, payroll protection and HR visibility.
        </p>
      </div>

      <div className="grid gap-5 md:grid-cols-4">
        <Card icon={<Users className="h-7 w-7" />} label="Employees" value={employees.length} />
        <Card icon={<AlertTriangle className="h-7 w-7" />} label="Open Exceptions" value={openExceptions} />
        <Card icon={<Building2 className="h-7 w-7" />} label="Open HR Cases" value={openHr} />
        <Card icon={<DollarSign className="h-7 w-7" />} label="Risk Score" value={`${risk}%`} />
      </div>
    </section>
  );
}

function Card({ icon, label, value }: any) {
  return (
    <div className="rounded-[28px] bg-white p-6 shadow-lg">
      <div>{icon}</div>
      <div className="mt-4 text-4xl font-black text-slate-950">{value}</div>
      <div className="text-sm font-bold text-slate-500">{label}</div>
    </div>
  );
}

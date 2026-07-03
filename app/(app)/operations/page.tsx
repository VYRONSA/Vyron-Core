"use client";

import PayrollExportCommandCentre from "@/components/PayrollExportCommandCentre";
import SmartRosterIntelligence from "@/components/SmartRosterIntelligence";
import WorkforceHeatmap from "@/components/WorkforceHeatmap";

export default function OperationsPage() {
  return (
    <main className="min-h-screen overflow-hidden bg-[#07101f] p-5 md:p-8">
      <div className="pointer-events-none fixed inset-0 z-0">
        <div className="absolute left-[-180px] top-[-220px] h-[620px] w-[620px] rounded-full bg-cyan-400/20 blur-[140px]" />
        <div className="absolute right-[-180px] top-[80px] h-[760px] w-[760px] rounded-full bg-blue-500/20 blur-[160px]" />
        <div className="absolute inset-0 bg-[linear-gradient(135deg,rgba(2,6,23,0.98)_0%,rgba(7,16,31,0.96)_30%,rgba(238,246,255,0.94)_30%,rgba(248,251,255,0.96)_100%)]" />
      </div>

      <div className="relative z-10 mx-auto max-w-[1800px] space-y-8">
        <section className="rounded-[38px] border border-cyan-300/15 bg-gradient-to-br from-[#020617] via-[#07101f] to-[#0b1f3a] p-8 text-white shadow-[0_34px_100px_rgba(2,6,23,0.36),0_0_52px_rgba(34,211,238,0.14)]">
          <div className="text-xs font-black uppercase tracking-[0.45em] text-cyan-300">
            VYRON CORE OPERATIONS
          </div>
          <h1 className="mt-4 max-w-5xl text-5xl font-black tracking-tight md:text-6xl">
            Payroll, Roster & Workforce Operations Centre
          </h1>
          <p className="mt-5 max-w-3xl text-sm leading-7 text-slate-300">
            Enterprise control over payroll export readiness, roster optimisation, workforce coverage and store-level risk.
          </p>
        </section>

        <PayrollExportCommandCentre />
        <SmartRosterIntelligence />
        <WorkforceHeatmap />
      </div>
    </main>
  );
}

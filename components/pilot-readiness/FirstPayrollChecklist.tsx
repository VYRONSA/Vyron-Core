"use client";

import React from "react";
import { ArrowRight, WalletCards } from "lucide-react";
import type { PilotReadinessReport } from "@/lib/pilot-client-readiness";

type Props = {
  report: PilotReadinessReport;
  onNavigate: (route: string) => void;
};

const PAYROLL_ROUTES: Record<string, string> = {
  roster_started: "Rosters",
  clock_events: "Clocking",
  payroll_generated: "Payroll",
  exceptions_clear: "Exceptions",
};

export default function FirstPayrollChecklist({ report, onNavigate }: Props) {
  const payrollSteps = report.allSteps.filter((s) => s.phase === "payroll");

  return (
    <div className="space-y-6">
      <section className="rounded-[1.5rem] border border-white/80 bg-white p-6 shadow-sm">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <div className="flex items-center gap-2 text-xs font-black uppercase tracking-[0.35em] text-cyan-700">
              <WalletCards className="h-4 w-4" />
              First payroll checklist (~15 min)
            </div>
            <p className="mt-2 text-sm text-slate-500">
              Walk the client through roster → clocking → payroll prep → exception clearance before
              first export.
            </p>
          </div>
          <div className="rounded-2xl bg-slate-950 px-5 py-3 text-center text-white">
            <div className="text-xs font-black uppercase tracking-wider text-cyan-300">Payroll ready</div>
            <div className="text-3xl font-black">{report.payrollReadinessPercent}%</div>
          </div>
        </div>

        <div className="mt-5 h-3 rounded-full bg-slate-200">
          <div
            className="h-3 rounded-full bg-gradient-to-r from-violet-600 to-indigo-400"
            style={{ width: `${report.payrollReadinessPercent}%` }}
          />
        </div>

        <div className="mt-6 space-y-3">
          {payrollSteps.map((step, index) => {
            const route = PAYROLL_ROUTES[step.id];
            return (
              <div
                key={step.id}
                className="flex flex-col gap-3 rounded-2xl border border-slate-100 bg-slate-50 p-4 md:flex-row md:items-center md:justify-between"
              >
                <div className="flex items-start gap-3">
                  <div
                    className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-sm font-black ${
                      step.done ? "bg-emerald-100 text-emerald-800" : "bg-white text-slate-600"
                    }`}
                  >
                    {step.done ? "✓" : index + 1}
                  </div>
                  <div>
                    <div className="font-bold text-slate-950">{step.label}</div>
                    <div className="mt-0.5 text-sm text-slate-600">{step.detail}</div>
                  </div>
                </div>
                {route && !step.done && (
                  <button
                    type="button"
                    onClick={() => onNavigate(route)}
                    className="flex items-center gap-2 self-start rounded-xl bg-[#06101f] px-4 py-2 text-xs font-black text-cyan-300 md:self-center"
                  >
                    Go to {route}
                    <ArrowRight className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </section>

      {(report.openExceptions > 0 || report.openHrCases > 0) && (
        <section className="rounded-[1.5rem] border border-rose-200 bg-rose-50 p-5 text-sm text-rose-900">
          <strong>Blockers:</strong> {report.openExceptions} open exception(s) and{" "}
          {report.openHrCases} open HR case(s) must be cleared before payroll export.
          <button
            type="button"
            onClick={() => onNavigate("Exceptions")}
            className="ml-2 font-black underline"
          >
            Open Exceptions
          </button>
        </section>
      )}
    </div>
  );
}

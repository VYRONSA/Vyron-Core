"use client";

import React from "react";
import {
  AlertTriangle,
  BookOpen,
  CheckCircle2,
  Clock3,
  HeartPulse,
  WalletCards,
} from "lucide-react";
import type { PilotReadinessReport } from "@/lib/pilot-client-readiness";

type Props = {
  report: PilotReadinessReport;
};

export default function ClientHealthDashboard({ report }: Props) {
  const metrics = [
    {
      label: "Setup completion",
      value: `${report.setupCompletionPercent}%`,
      subtitle: `${report.completedSteps.length}/${report.allSteps.length} steps`,
      icon: <CheckCircle2 className="h-6 w-6" />,
      tone:
        report.setupCompletionPercent >= 80
          ? "from-emerald-500 to-teal-400"
          : "from-blue-600 to-cyan-400",
    },
    {
      label: "Payroll readiness",
      value: `${report.payrollReadinessPercent}%`,
      subtitle:
        report.openExceptions + report.openHrCases > 0
          ? `${report.openExceptions + report.openHrCases} blocker(s)`
          : "On track for first export",
      icon: <WalletCards className="h-6 w-6" />,
      tone:
        report.payrollReadinessPercent >= 80
          ? "from-emerald-500 to-teal-400"
          : "from-violet-600 to-indigo-400",
    },
    {
      label: "Training progress",
      value: `${report.trainingProgressPercent}%`,
      subtitle: "Guides completed",
      icon: <BookOpen className="h-6 w-6" />,
      tone: "from-cyan-600 to-sky-400",
    },
    {
      label: "Time to complete",
      value: report.missingSteps.length === 0 ? "Done" : `~${report.estimatedMinutesRemaining}m`,
      subtitle:
        report.missingSteps.length === 0
          ? "Pilot setup complete"
          : `${report.missingSteps.length} step(s) remaining`,
      icon: <Clock3 className="h-6 w-6" />,
      tone:
        report.estimatedMinutesRemaining <= 15
          ? "from-emerald-500 to-teal-400"
          : "from-amber-500 to-orange-400",
    },
  ];

  return (
    <div className="space-y-6">
      <section className="rounded-[2rem] border border-white/80 bg-gradient-to-r from-[#06101f] to-[#0b1a33] p-6 text-white shadow-xl">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
          <div>
            <div className="flex items-center gap-2 text-xs font-black uppercase tracking-[0.35em] text-cyan-300">
              <HeartPulse className="h-4 w-4" />
              Client Health
            </div>
            <h2 className="mt-2 text-3xl font-black tracking-tight">Pilot readiness score</h2>
            <p className="mt-2 max-w-2xl text-sm text-slate-300">
              Target: complete onboarding in under 30 minutes. Track setup, payroll path, and training
              in one place.
            </p>
          </div>
          <div className="rounded-[1.5rem] bg-white/10 px-6 py-4 text-center backdrop-blur">
            <div className="text-xs font-black uppercase tracking-wider text-cyan-200">Overall</div>
            <div className="mt-1 text-5xl font-black">{report.overallPercent}%</div>
          </div>
        </div>
        <div className="mt-5 h-3 rounded-full bg-white/10">
          <div
            className="h-3 rounded-full bg-gradient-to-r from-blue-500 to-cyan-300 transition-all"
            style={{ width: `${report.overallPercent}%` }}
          />
        </div>
      </section>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {metrics.map((metric) => (
          <article
            key={metric.label}
            className="rounded-[1.5rem] border border-slate-200 bg-white p-5 shadow-sm"
          >
            <div
              className={`w-fit rounded-2xl bg-gradient-to-br ${metric.tone} p-3 text-white`}
            >
              {metric.icon}
            </div>
            <div className="mt-4 text-3xl font-black text-slate-950">{metric.value}</div>
            <div className="mt-1 text-sm font-bold text-slate-700">{metric.label}</div>
            <div className="mt-1 text-xs text-slate-500">{metric.subtitle}</div>
          </article>
        ))}
      </div>

      {report.missingSteps.length > 0 ? (
        <section className="rounded-[1.5rem] border border-amber-200 bg-amber-50/80 p-5">
          <div className="flex items-center gap-2 text-sm font-black text-amber-900">
            <AlertTriangle className="h-4 w-4" />
            Missing steps ({report.missingSteps.length})
          </div>
          <ul className="mt-3 space-y-2">
            {report.missingSteps.map((step) => (
              <li
                key={step.id}
                className="flex items-start justify-between gap-3 rounded-xl bg-white/80 px-4 py-3 text-sm"
              >
                <div>
                  <div className="font-bold text-slate-900">{step.label}</div>
                  <div className="mt-0.5 text-slate-600">{step.detail}</div>
                </div>
                <span className="shrink-0 text-xs font-bold text-amber-800">~{step.estimatedMinutes}m</span>
              </li>
            ))}
          </ul>
        </section>
      ) : (
        <section className="rounded-[1.5rem] border border-emerald-200 bg-emerald-50 p-5 text-emerald-900">
          <div className="flex items-center gap-2 font-black">
            <CheckCircle2 className="h-5 w-5" />
            Pilot setup complete — client is ready for daily operations.
          </div>
        </section>
      )}
    </div>
  );
}

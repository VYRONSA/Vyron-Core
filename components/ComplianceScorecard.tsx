"use client";

import { AlertTriangle, CheckCircle2, FileWarning, ShieldCheck, TrendingUp } from "lucide-react";

type ComplianceScorecardProps = {
  openExceptions?: number;
  openHrCases?: number;
  payrollBlockers?: number;
  missingDocuments?: number;
};

export default function ComplianceScorecard({
  openExceptions = 12,
  openHrCases = 5,
  payrollBlockers = 8,
  missingDocuments = 4,
}: ComplianceScorecardProps) {
  const riskPoints = openExceptions * 2 + openHrCases * 4 + payrollBlockers * 5 + missingDocuments * 3;
  const score = Math.max(0, Math.min(100, 100 - riskPoints));

  const tone =
    score >= 85
      ? "bg-emerald-100 text-emerald-700"
      : score >= 65
      ? "bg-amber-100 text-amber-700"
      : "bg-rose-100 text-rose-700";

  return (
    <section className="rounded-[34px] border border-white/80 bg-white/95 p-6 shadow-[0_24px_70px_rgba(15,23,42,0.13)] backdrop-blur-xl">
      <div className="flex flex-col gap-5 xl:flex-row xl:items-center xl:justify-between">
        <div>
          <div className="text-xs font-black uppercase tracking-[0.35em] text-cyan-700">Compliance Intelligence</div>
          <h2 className="mt-3 text-3xl font-black tracking-tight text-slate-950">Compliance Scorecard</h2>
          <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-500">
            A live operational score based on unresolved exceptions, HR cases, payroll blockers and missing employee records.
          </p>
        </div>

        <div className={`rounded-[28px] p-5 shadow-[0_18px_45px_rgba(15,23,42,0.10)] ${tone}`}>
          <div className="text-xs font-black uppercase tracking-[0.28em] opacity-80">Compliance score</div>
          <div className="mt-2 text-5xl font-black">{score}%</div>
        </div>
      </div>

      <div className="mt-8 grid gap-5 md:grid-cols-4">
        {[
          ["Open Exceptions", String(openExceptions), <AlertTriangle key="i1" className="h-6 w-6" />, "Clocking, roster and payroll issues"],
          ["Open HR Cases", String(openHrCases), <FileWarning key="i2" className="h-6 w-6" />, "Requires HR manager review"],
          ["Payroll Blockers", String(payrollBlockers), <ShieldCheck key="i3" className="h-6 w-6" />, "Blocks clean payroll export"],
          ["Missing Documents", String(missingDocuments), <TrendingUp key="i4" className="h-6 w-6" />, "Incomplete employee files"],
        ].map(([title, value, icon, subtitle]) => (
          <article key={String(title)} className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-[0_14px_40px_rgba(15,23,42,0.08)]">
            <div className="w-fit rounded-2xl bg-cyan-100 p-3 text-cyan-700">{icon}</div>
            <div className="mt-5 text-3xl font-black text-slate-950">{value}</div>
            <div className="mt-2 text-sm font-black text-slate-700">{title}</div>
            <div className="mt-2 text-xs leading-5 text-slate-500">{subtitle}</div>
          </article>
        ))}
      </div>

      <div className="mt-8 rounded-[28px] bg-emerald-50 p-5 text-emerald-800">
        <div className="flex items-center gap-3">
          <CheckCircle2 className="h-6 w-6" />
          <div>
            <div className="font-black">Enterprise value</div>
            <p className="mt-1 text-sm">
              This is the type of executive score large clients understand immediately: lower risk, cleaner payroll, stronger control.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

"use client";

import { CheckCircle2, ShieldAlert } from "lucide-react";

const blockers = [
  {
    title: "Missing clock out",
    employee: "Jason Peters"
  },
  {
    title: "GPS mismatch",
    employee: "Amy Daniels"
  },
  {
    title: "Duplicate clocking",
    employee: "John Smith"
  }
];

export default function PayrollRiskEngine() {
  return (
    <section className="vyron-panel vyron-card rounded-[32px] p-6">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-xs font-black uppercase tracking-[0.35em] text-cyan-700">
            Payroll Intelligence
          </div>

          <h2 className="mt-3 text-3xl font-black tracking-tight text-slate-950">
            Payroll Risk Engine
          </h2>
        </div>

        <div className="rounded-full bg-rose-100 px-4 py-2 text-sm font-black text-rose-700">
          3 BLOCKERS
        </div>
      </div>

      <div className="mt-8 space-y-4">
        {blockers.map((blocker) => (
          <div
            key={blocker.title + blocker.employee}
            className="flex items-center justify-between rounded-2xl border border-slate-200 bg-white p-5"
          >
            <div className="flex items-center gap-4">
              <div className="rounded-2xl bg-rose-100 p-3 text-rose-600">
                <ShieldAlert className="h-5 w-5" />
              </div>

              <div>
                <div className="font-black text-slate-950">
                  {blocker.title}
                </div>

                <div className="mt-1 text-sm text-slate-500">
                  {blocker.employee}
                </div>
              </div>
            </div>

            <button className="rounded-xl bg-[#06101f] px-4 py-2 text-xs font-black text-cyan-300">
              Review
            </button>
          </div>
        ))}
      </div>

      <div className="mt-6 rounded-[28px] bg-gradient-to-r from-emerald-500 to-emerald-400 p-5 text-white shadow-xl">
        <div className="flex items-center gap-3">
          <CheckCircle2 className="h-6 w-6" />

          <div>
            <div className="font-black">Payroll Readiness Score</div>
            <div className="mt-1 text-sm text-emerald-50">
              Current payroll readiness: 87%
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
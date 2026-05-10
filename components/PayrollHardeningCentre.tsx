"use client";

import { CheckCircle2, Download, FileLock2, History, LockKeyhole, ShieldAlert, WalletCards } from "lucide-react";

const approvals = [
  ["Store Manager Review", "Complete", "42 employees reviewed"],
  ["HR Review", "In progress", "5 HR issues pending"],
  ["Payroll Review", "Blocked", "14 blockers remain"],
  ["Final Lock", "Waiting", "Unlocks after approvals"],
];

export default function PayrollHardeningCentre() {
  return (
    <section className="space-y-8">
      <div className="rounded-[34px] border border-white/80 bg-white/95 p-6 shadow-[0_24px_70px_rgba(15,23,42,0.13)]">
        <div className="flex flex-col gap-5 xl:flex-row xl:items-center xl:justify-between">
          <div>
            <div className="text-xs font-black uppercase tracking-[0.35em] text-cyan-700">Payroll Hardening</div>
            <h2 className="mt-3 text-3xl font-black tracking-tight text-slate-950">Payroll Lock & Export Hardening</h2>
            <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-500">
              Protect payroll exports with approval chains, lock periods, export history, rollback notes and blocker enforcement.
            </p>
          </div>
          <div className="rounded-[28px] bg-gradient-to-br from-rose-600 to-orange-500 p-5 text-white">
            <div className="text-xs font-black uppercase tracking-[0.28em] text-rose-100">Current state</div>
            <div className="mt-2 text-4xl font-black">Blocked</div>
          </div>
        </div>

        <div className="mt-8 grid gap-5 md:grid-cols-4">
          {[
            ["Current Period", "May 2026", <WalletCards key="a" className="h-6 w-6" />],
            ["Open Blockers", "14", <ShieldAlert key="b" className="h-6 w-6" />],
            ["Approval Steps", "4", <CheckCircle2 key="c" className="h-6 w-6" />],
            ["Export History", "12", <History key="d" className="h-6 w-6" />],
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
          <h3 className="text-2xl font-black text-slate-950">Approval Chain</h3>
          <div className="mt-6 space-y-4">
            {approvals.map(([step, status, detail]) => (
              <article key={step} className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
                <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                  <div>
                    <div className="font-black text-slate-950">{step}</div>
                    <div className="mt-1 text-sm text-slate-500">{detail}</div>
                  </div>
                  <span className={`w-fit rounded-full px-3 py-1 text-xs font-black ${
                    status === "Complete" ? "bg-emerald-100 text-emerald-700" : status === "Blocked" ? "bg-rose-100 text-rose-700" : "bg-amber-100 text-amber-700"
                  }`}>{status}</span>
                </div>
              </article>
            ))}
          </div>
        </div>

        <div className="rounded-[34px] bg-[#06101f] p-6 text-white">
          <FileLock2 className="h-8 w-8 text-cyan-300" />
          <h3 className="mt-5 text-2xl font-black">Payroll Lock Rules</h3>
          <ul className="mt-5 space-y-3 text-sm text-slate-300">
            <li>• Block export when missing clock events exist</li>
            <li>• Require manager approval for overtime</li>
            <li>• Require HR clearance for open HR cases</li>
            <li>• Store export history with timestamp</li>
            <li>• Record rollback reason before re-export</li>
          </ul>

          <div className="mt-8 grid gap-3">
            <button className="flex items-center justify-center gap-2 rounded-2xl bg-white px-5 py-3 text-sm font-black text-slate-950">
              <Download className="h-4 w-4" /> Export when clean
            </button>
            <button className="flex items-center justify-center gap-2 rounded-2xl bg-white/10 px-5 py-3 text-sm font-black text-cyan-300">
              <LockKeyhole className="h-4 w-4" /> Lock period
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}

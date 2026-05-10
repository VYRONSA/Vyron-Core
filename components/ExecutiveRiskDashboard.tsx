"use client";

import {
  AlertTriangle,
  Clock3,
  ShieldCheck,
  Users,
  WalletCards
} from "lucide-react";

function Card({
  title,
  value,
  subtitle,
  icon
}: any) {
  return (
    <div className="vyron-panel vyron-card rounded-[32px] p-6">
      <div className="flex items-start justify-between">
        <div className="rounded-2xl bg-[#06101f] p-3 text-cyan-300">
          {icon}
        </div>

        <span className="rounded-full bg-slate-100 px-3 py-1 text-[11px] font-black uppercase tracking-[0.25em] text-slate-500">
          Live
        </span>
      </div>

      <div className="mt-6 text-4xl font-black tracking-tight text-slate-950">
        {value}
      </div>

      <div className="mt-2 text-sm font-bold text-slate-700">
        {title}
      </div>

      <div className="mt-2 text-xs text-slate-500">
        {subtitle}
      </div>
    </div>
  );
}

export default function ExecutiveDashboard() {
  return (
    <div className="space-y-6">
      <section className="vyron-dark-panel rounded-[36px] p-8 text-white">
        <div className="flex flex-col gap-6 xl:flex-row xl:items-center xl:justify-between">
          <div>
            <div className="text-xs font-black uppercase tracking-[0.45em] text-cyan-300">
              VYRON CORE
            </div>

            <h1 className="mt-4 text-5xl font-black tracking-tight">
              Executive Command Centre
            </h1>

            <p className="mt-4 max-w-3xl text-sm leading-7 text-slate-300">
              Workforce intelligence, payroll risk monitoring,
              compliance visibility and labour leakage prevention.
            </p>
          </div>

          <button className="rounded-2xl bg-white px-5 py-3 text-sm font-black text-slate-950 shadow-xl">
            Export Executive Report
          </button>
        </div>
      </section>

      <section className="grid gap-5 md:grid-cols-2 xl:grid-cols-4">
        <Card
          title="Employees Online"
          value="182"
          subtitle="Live workforce visibility"
          icon={<Users className="h-6 w-6" />}
        />

        <Card
          title="Payroll Blockers"
          value="14"
          subtitle="Needs manager review"
          icon={<WalletCards className="h-6 w-6" />}
        />

        <Card
          title="Compliance Risk"
          value="Medium"
          subtitle="4 unresolved compliance issues"
          icon={<ShieldCheck className="h-6 w-6" />}
        />

        <Card
          title="Labour Leakage"
          value="R38,420"
          subtitle="Estimated monthly loss"
          icon={<AlertTriangle className="h-6 w-6" />}
        />
      </section>

      <section className="grid gap-6 xl:grid-cols-[1fr_0.7fr]">
        <div className="vyron-panel vyron-card rounded-[32px] p-6">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-2xl font-black tracking-tight text-slate-950">
                Payroll Readiness
              </h2>

              <p className="mt-2 text-sm text-slate-500">
                Real-time payroll processing readiness.
              </p>
            </div>

            <div className="rounded-full bg-emerald-100 px-4 py-2 text-sm font-black text-emerald-700">
              87% READY
            </div>
          </div>

          <div className="mt-8 space-y-4">
            {[
              "Missing clock events",
              "GPS mismatch",
              "Unapproved overtime",
              "Roster conflict"
            ].map((item) => (
              <div
                key={item}
                className="flex items-center justify-between rounded-2xl border border-slate-200 bg-white p-4"
              >
                <div className="flex items-center gap-3">
                  <div className="rounded-xl bg-rose-100 p-2 text-rose-600">
                    <AlertTriangle className="h-4 w-4" />
                  </div>

                  <div>
                    <div className="font-bold text-slate-900">{item}</div>
                    <div className="text-xs text-slate-500">
                      Requires review
                    </div>
                  </div>
                </div>

                <button className="rounded-xl bg-[#06101f] px-4 py-2 text-xs font-black text-cyan-300">
                  Review
                </button>
              </div>
            ))}
          </div>
        </div>

        <div className="vyron-panel vyron-card rounded-[32px] p-6">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-2xl font-black tracking-tight text-slate-950">
                Live Activity
              </h2>

              <p className="mt-2 text-sm text-slate-500">
                Workforce events happening now.
              </p>
            </div>
          </div>

          <div className="mt-8 space-y-4">
            {[
              "Jason clocked in at Canal Walk",
              "Leave request submitted",
              "Payroll export completed",
              "Late arrival exception created"
            ].map((item) => (
              <div
                key={item}
                className="flex items-start gap-3 rounded-2xl border border-slate-200 bg-white p-4"
              >
                <div className="rounded-xl bg-cyan-100 p-2 text-cyan-700">
                  <Clock3 className="h-4 w-4" />
                </div>

                <div>
                  <div className="font-bold text-slate-900">{item}</div>
                  <div className="mt-1 text-xs text-slate-500">
                    2 minutes ago
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
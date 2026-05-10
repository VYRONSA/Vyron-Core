"use client";

import {
  CheckCircle2,
  Database,
  FileSpreadsheet,
  Link2,
  PlugZap,
  ShieldCheck,
  WalletCards,
} from "lucide-react";

const integrations = [
  {
    name: "Sage Payroll",
    status: "Planned",
    description: "Payroll export mapping and CSV handoff for Sage payroll workflows.",
  },
  {
    name: "SimplePay",
    status: "Planned",
    description: "Payroll export preparation for SimplePay-ready uploads.",
  },
  {
    name: "Xero",
    status: "Future",
    description: "Accounting and payroll-adjacent finance visibility integration.",
  },
  {
    name: "Generic CSV",
    status: "Ready",
    description: "Fallback payroll export format for most payroll systems.",
  },
];

export default function IntegrationsPanel() {
  return (
    <section className="space-y-8">
      <div className="relative overflow-hidden rounded-[40px] border border-cyan-300/15 bg-gradient-to-br from-[#020617] via-[#07101f] to-[#0b1f3a] p-8 text-white shadow-[0_34px_100px_rgba(2,6,23,0.36),0_0_52px_rgba(34,211,238,0.14)]">
        <div className="pointer-events-none absolute -right-24 -top-24 h-96 w-96 rounded-full bg-cyan-300/20 blur-[90px]" />

        <div className="relative flex flex-col gap-8 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <div className="flex items-center gap-3 text-xs font-black uppercase tracking-[0.45em] text-cyan-300">
              <PlugZap className="h-5 w-5" />
              VYRON CORE INTEGRATIONS
            </div>

            <h1 className="mt-4 max-w-5xl text-5xl font-black tracking-tight md:text-6xl">
              Integrations Control Centre
            </h1>

            <p className="mt-5 max-w-3xl text-sm leading-7 text-slate-300">
              Payroll, finance and export integration readiness for enterprise clients.
              This page is now a valid React component and no longer contains SQL text.
            </p>
          </div>

          <div className="rounded-[30px] border border-white/10 bg-white/10 p-6 backdrop-blur-xl">
            <div className="text-xs font-black uppercase tracking-[0.3em] text-cyan-300">
              Integration status
            </div>
            <div className="mt-3 text-5xl font-black text-white">Build</div>
            <div className="mt-2 text-xs text-slate-300">Ready for staged rollout</div>
          </div>
        </div>
      </div>

      <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-4">
        {[
          ["Payroll Systems", "3", <WalletCards key="a" className="h-6 w-6" />],
          ["CSV Export", "Ready", <FileSpreadsheet key="b" className="h-6 w-6" />],
          ["Data Safety", "Required", <ShieldCheck key="c" className="h-6 w-6" />],
          ["Connection Layer", "Planned", <Database key="d" className="h-6 w-6" />],
        ].map(([title, value, icon]) => (
          <article
            key={String(title)}
            className="rounded-[32px] border border-white/80 bg-white/95 p-6 shadow-[0_22px_65px_rgba(15,23,42,0.13)] backdrop-blur-xl"
          >
            <div className="w-fit rounded-2xl bg-cyan-100 p-3 text-cyan-700">
              {icon}
            </div>
            <div className="mt-6 text-3xl font-black text-slate-950">{value}</div>
            <div className="mt-2 text-sm font-black text-slate-800">{title}</div>
          </article>
        ))}
      </div>

      <div className="rounded-[34px] border border-white/80 bg-white/95 p-6 shadow-[0_24px_70px_rgba(15,23,42,0.13)] backdrop-blur-xl">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 className="text-3xl font-black tracking-tight text-slate-950">
              Integration Roadmap
            </h2>
            <p className="mt-2 text-sm text-slate-500">
              Keep integrations practical: payroll exports first, live APIs later.
            </p>
          </div>

          <div className="rounded-full bg-cyan-100 px-4 py-2 text-sm font-black text-cyan-700">
            {integrations.length} integrations
          </div>
        </div>

        <div className="mt-8 grid gap-4 md:grid-cols-2">
          {integrations.map((integration) => (
            <article
              key={integration.name}
              className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm"
            >
              <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                <div className="flex items-start gap-4">
                  <div className="rounded-2xl bg-[#06101f] p-3 text-cyan-300">
                    <Link2 className="h-5 w-5" />
                  </div>

                  <div>
                    <div className="font-black text-slate-950">{integration.name}</div>
                    <p className="mt-2 text-sm leading-6 text-slate-500">
                      {integration.description}
                    </p>
                  </div>
                </div>

                <span
                  className={`w-fit rounded-full px-3 py-1 text-xs font-black ${
                    integration.status === "Ready"
                      ? "bg-emerald-100 text-emerald-700"
                      : integration.status === "Planned"
                      ? "bg-amber-100 text-amber-700"
                      : "bg-slate-100 text-slate-600"
                  }`}
                >
                  {integration.status}
                </span>
              </div>
            </article>
          ))}
        </div>

        <div className="mt-8 rounded-[28px] bg-emerald-50 p-5 text-emerald-800">
          <div className="flex items-start gap-3">
            <CheckCircle2 className="mt-0.5 h-5 w-5" />
            <p className="text-sm leading-6">
              Recommended rollout: keep Generic CSV working first, then add Sage and SimplePay templates,
              then live API integrations later.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

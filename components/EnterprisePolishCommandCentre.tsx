"use client";

import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Gauge,
  LayoutDashboard,
  ShieldCheck,
  Sparkles,
  Wand2,
} from "lucide-react";

const polishAreas = [
  {
    title: "Visual Consistency",
    score: "82%",
    status: "Strong",
    note: "Most major modules now follow the VYRON command-centre system.",
  },
  {
    title: "Workflow Clarity",
    score: "76%",
    status: "Improve",
    note: "Manager actions should be clearer on payroll, HR and leave screens.",
  },
  {
    title: "Enterprise Trust",
    score: "74%",
    status: "Improve",
    note: "Audit trails, permissions and loading/error states need final hardening.",
  },
  {
    title: "Launch Readiness",
    score: "68%",
    status: "Build",
    note: "Still needs demo data, deployment polish and sales-ready walkthroughs.",
  },
];

export default function EnterprisePolishCommandCentre() {
  return (
    <section className="space-y-8">
      <div className="relative overflow-hidden rounded-[38px] border border-cyan-300/15 bg-gradient-to-br from-[#020617] via-[#07101f] to-[#0b1f3a] p-8 text-white shadow-[0_34px_100px_rgba(2,6,23,0.36),0_0_52px_rgba(34,211,238,0.14)]">
        <div className="pointer-events-none absolute -right-20 -top-24 h-80 w-80 rounded-full bg-cyan-300/20 blur-[80px]" />
        <div className="relative flex flex-col gap-8 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <div className="flex items-center gap-3 text-xs font-black uppercase tracking-[0.45em] text-cyan-300">
              <Sparkles className="h-5 w-5" />
              Final Stage
            </div>

            <h1 className="mt-4 max-w-5xl text-5xl font-black tracking-tight md:text-6xl">
              Enterprise Polish Command Centre
            </h1>

            <p className="mt-5 max-w-3xl text-sm leading-7 text-slate-300">
              Final VYRON CORE launch-readiness layer for polish, workflow clarity,
              system trust, UI consistency and production confidence.
            </p>
          </div>

          <div className="rounded-[28px] border border-white/10 bg-white/10 p-5 backdrop-blur-xl">
            <div className="text-xs font-black uppercase tracking-[0.3em] text-cyan-300">
              Final stage readiness
            </div>
            <div className="mt-3 text-4xl font-black text-white">75%</div>
            <div className="mt-2 text-xs text-slate-300">
              Ready for controlled demo refinement
            </div>
          </div>
        </div>
      </div>

      <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-4">
        {[
          ["UI Standard", "82%", <LayoutDashboard key="a" className="h-6 w-6" />],
          ["System Stability", "78%", <ShieldCheck key="b" className="h-6 w-6" />],
          ["Workflow Quality", "76%", <Activity key="c" className="h-6 w-6" />],
          ["Launch Readiness", "68%", <Gauge key="d" className="h-6 w-6" />],
        ].map(([title, value, icon]) => (
          <article
            key={String(title)}
            className="rounded-[32px] border border-white/80 bg-white/95 p-6 shadow-[0_22px_65px_rgba(15,23,42,0.13)] backdrop-blur-xl transition hover:-translate-y-1"
          >
            <div className="w-fit rounded-2xl bg-cyan-100 p-3 text-cyan-700">{icon}</div>
            <div className="mt-6 text-4xl font-black text-slate-950">{value}</div>
            <div className="mt-2 text-sm font-black text-slate-800">{title}</div>
            <div className="mt-1 text-xs leading-5 text-slate-500">Enterprise readiness indicator</div>
          </article>
        ))}
      </div>

      <div className="grid gap-6 xl:grid-cols-[1fr_0.82fr]">
        <div className="rounded-[34px] border border-white/80 bg-white/95 p-6 shadow-[0_24px_70px_rgba(15,23,42,0.13)] backdrop-blur-xl">
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div>
              <h2 className="text-3xl font-black tracking-tight text-slate-950">
                Final Polish Areas
              </h2>
              <p className="mt-2 text-sm text-slate-500">
                Use this as the launch-readiness checklist while moving into client demos.
              </p>
            </div>

            <div className="rounded-full bg-cyan-100 px-4 py-2 text-sm font-black text-cyan-700">
              4 priority areas
            </div>
          </div>

          <div className="mt-7 space-y-4">
            {polishAreas.map((area) => (
              <article
                key={area.title}
                className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-[0_14px_40px_rgba(15,23,42,0.08)]"
              >
                <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                  <div>
                    <div className="text-lg font-black text-slate-950">{area.title}</div>
                    <p className="mt-2 text-sm leading-6 text-slate-500">{area.note}</p>
                  </div>

                  <div className="text-right">
                    <div className="text-2xl font-black text-slate-950">{area.score}</div>
                    <span
                      className={`mt-2 inline-flex rounded-full px-3 py-1 text-xs font-black ${
                        area.status === "Strong"
                          ? "bg-emerald-100 text-emerald-700"
                          : area.status === "Improve"
                          ? "bg-amber-100 text-amber-700"
                          : "bg-cyan-100 text-cyan-700"
                      }`}
                    >
                      {area.status}
                    </span>
                  </div>
                </div>

                <div className="mt-5 h-3 overflow-hidden rounded-full bg-slate-100">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-blue-600 to-cyan-400"
                    style={{ width: area.score }}
                  />
                </div>
              </article>
            ))}
          </div>
        </div>

        <div className="rounded-[34px] bg-[#06101f] p-6 text-white shadow-[0_24px_70px_rgba(2,6,23,0.30)]">
          <Wand2 className="h-8 w-8 text-cyan-300" />
          <h2 className="mt-5 text-3xl font-black">Final stage rule</h2>
          <p className="mt-4 text-sm leading-7 text-slate-300">
            From this point onward, stop adding random new modules unless they directly support payroll value,
            onboarding, enterprise trust or client demos.
          </p>

          <div className="mt-8 space-y-3">
            {[
              "Fix anything that crashes.",
              "Polish anything that looks unfinished.",
              "Connect anything that proves client value.",
              "Remove anything that creates confusion.",
            ].map((item) => (
              <div key={item} className="flex items-center gap-3 rounded-2xl bg-white/10 p-4 text-sm font-black">
                <CheckCircle2 className="h-5 w-5 text-cyan-300" />
                {item}
              </div>
            ))}
          </div>

          <div className="mt-8 rounded-[28px] bg-amber-500/15 p-5 text-amber-100">
            <div className="flex items-start gap-3">
              <AlertTriangle className="mt-0.5 h-5 w-5" />
              <p className="text-sm leading-6">
                The app is now large enough that every change must protect stability first.
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

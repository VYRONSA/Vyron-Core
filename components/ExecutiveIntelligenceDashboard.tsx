"use client";

import {
  AlertTriangle,
  BarChart3,
  Brain,
  Clock3,
  ShieldCheck,
  TrendingUp,
  Users,
  WalletCards,
} from "lucide-react";

type MetricCardProps = {
  title: string;
  value: string;
  subtitle: string;
  tone?: "blue" | "green" | "amber" | "rose";
  icon: React.ReactNode;
};

function MetricCard({ title, value, subtitle, tone = "blue", icon }: MetricCardProps) {
  const toneClass =
    tone === "green"
      ? "bg-emerald-100 text-emerald-700"
      : tone === "amber"
      ? "bg-amber-100 text-amber-700"
      : tone === "rose"
      ? "bg-rose-100 text-rose-700"
      : "bg-cyan-100 text-cyan-700";

  return (
    <div className="rounded-[32px] border border-white/80 bg-white/95 p-6 shadow-[0_18px_55px_rgba(15,23,42,0.12)] backdrop-blur-xl transition hover:-translate-y-1 hover:shadow-[0_28px_85px_rgba(37,99,235,0.18)]">
      <div className="flex items-start justify-between gap-4">
        <div className={`rounded-2xl p-3 ${toneClass}`}>{icon}</div>
        <span className="rounded-full bg-slate-100 px-3 py-1 text-[11px] font-black uppercase tracking-[0.25em] text-slate-500">
          Live
        </span>
      </div>

      <div className="mt-7 text-4xl font-black tracking-tight text-slate-950">{value}</div>
      <div className="mt-2 text-sm font-black text-slate-700">{title}</div>
      <div className="mt-3 text-xs leading-5 text-slate-500">{subtitle}</div>
    </div>
  );
}

export default function ExecutiveIntelligenceDashboard() {
  const alerts = [
    "Payroll export is blocked by 14 unresolved clocking checks.",
    "Estimated labour leakage is trending 18% higher than last month.",
    "3 stores show repeated late-arrival risk patterns.",
    "5 HR cases require manager action before payroll lock.",
  ];

  const storeRanking = [
    { store: "Canal Walk", score: 94, status: "Clean" },
    { store: "Constantia", score: 88, status: "Watch" },
    { store: "Waterstone", score: 74, status: "Risk" },
    { store: "Somerset Mall", score: 69, status: "High Risk" },
  ];

  return (
    <main className="min-h-screen overflow-hidden bg-[#07101f] p-5 text-slate-950 md:p-8">
      <div className="pointer-events-none fixed inset-0 z-0">
        <div className="absolute left-[-180px] top-[-220px] h-[620px] w-[620px] rounded-full bg-cyan-400/20 blur-[140px]" />
        <div className="absolute right-[-180px] top-[80px] h-[760px] w-[760px] rounded-full bg-blue-500/20 blur-[160px]" />
        <div className="absolute bottom-[-260px] left-[36%] h-[680px] w-[680px] rounded-full bg-sky-300/16 blur-[170px]" />
        <div className="absolute inset-0 bg-[linear-gradient(135deg,rgba(2,6,23,0.98)_0%,rgba(7,16,31,0.96)_32%,rgba(238,246,255,0.94)_32%,rgba(248,251,255,0.96)_100%)]" />
      </div>

      <div className="relative z-10 mx-auto max-w-[1800px] space-y-8">
        <section className="relative overflow-hidden rounded-[38px] border border-cyan-300/15 bg-gradient-to-br from-[#020617] via-[#07101f] to-[#0b1f3a] p-8 text-white shadow-[0_34px_100px_rgba(2,6,23,0.36),0_0_52px_rgba(34,211,238,0.14)]">
          <div className="pointer-events-none absolute -right-20 -top-24 h-80 w-80 rounded-full bg-cyan-300/20 blur-[80px]" />
          <div className="relative flex flex-col gap-8 xl:flex-row xl:items-end xl:justify-between">
            <div>
              <div className="text-xs font-black uppercase tracking-[0.45em] text-cyan-300">
                VYRON CORE INTELLIGENCE
              </div>
              <h1 className="mt-4 max-w-5xl text-5xl font-black tracking-tight md:text-6xl">
                Workforce Loss Prevention Command Centre
              </h1>
              <p className="mt-5 max-w-3xl text-sm leading-7 text-slate-300">
                Executive visibility over payroll blockers, labour leakage, compliance exposure,
                roster risk and store-level workforce performance.
              </p>
            </div>

            <div className="rounded-[28px] border border-white/10 bg-white/10 p-5 backdrop-blur-xl">
              <div className="text-xs font-black uppercase tracking-[0.3em] text-cyan-300">Estimated monthly saving</div>
              <div className="mt-3 text-4xl font-black text-white">R142,800</div>
              <div className="mt-2 text-xs text-slate-300">Projected if blockers are cleared before payroll lock</div>
            </div>
          </div>
        </section>

        <section className="grid gap-5 md:grid-cols-2 xl:grid-cols-4">
          <MetricCard
            title="Payroll Blockers"
            value="14"
            subtitle="Issues preventing clean payroll export"
            tone="rose"
            icon={<WalletCards className="h-6 w-6" />}
          />
          <MetricCard
            title="Labour Leakage"
            value="R38,420"
            subtitle="Estimated current month exposure"
            tone="amber"
            icon={<TrendingUp className="h-6 w-6" />}
          />
          <MetricCard
            title="Compliance Score"
            value="82%"
            subtitle="Risk-adjusted HR and payroll compliance score"
            tone="green"
            icon={<ShieldCheck className="h-6 w-6" />}
          />
          <MetricCard
            title="Roster Risk"
            value="Medium"
            subtitle="Overtime, fatigue and coverage risk indicator"
            tone="blue"
            icon={<Brain className="h-6 w-6" />}
          />
        </section>

        <section className="grid gap-6 xl:grid-cols-[1fr_0.75fr]">
          <div className="rounded-[34px] border border-white/80 bg-white/95 p-6 shadow-[0_24px_70px_rgba(15,23,42,0.13)] backdrop-blur-xl">
            <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
              <div>
                <h2 className="text-3xl font-black tracking-tight text-slate-950">Executive Risk Alerts</h2>
                <p className="mt-2 text-sm text-slate-500">
                  High-value management actions that protect payroll and reduce labour leakage.
                </p>
              </div>
              <span className="rounded-full bg-rose-100 px-4 py-2 text-sm font-black text-rose-700">
                4 urgent
              </span>
            </div>

            <div className="mt-7 space-y-4">
              {alerts.map((alert) => (
                <div
                  key={alert}
                  className="flex items-start gap-4 rounded-[26px] border border-slate-200 bg-white p-5 shadow-[0_12px_36px_rgba(15,23,42,0.08)]"
                >
                  <div className="rounded-2xl bg-rose-100 p-3 text-rose-600">
                    <AlertTriangle className="h-5 w-5" />
                  </div>
                  <div>
                    <div className="font-black text-slate-950">{alert}</div>
                    <div className="mt-2 text-sm text-slate-500">
                      Recommended action: assign manager review before payroll close.
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-[34px] border border-white/80 bg-white/95 p-6 shadow-[0_24px_70px_rgba(15,23,42,0.13)] backdrop-blur-xl">
            <h2 className="text-3xl font-black tracking-tight text-slate-950">Store Ranking</h2>
            <p className="mt-2 text-sm text-slate-500">
              Store-level workforce control and payroll risk ranking.
            </p>

            <div className="mt-7 space-y-4">
              {storeRanking.map((item, index) => (
                <div key={item.store} className="rounded-[26px] border border-slate-200 bg-white p-5">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-sm font-black text-slate-400">#{index + 1}</div>
                      <div className="mt-1 text-lg font-black text-slate-950">{item.store}</div>
                    </div>
                    <div className="text-right">
                      <div className="text-2xl font-black text-slate-950">{item.score}%</div>
                      <div className="mt-1 text-xs font-black uppercase tracking-[0.18em] text-cyan-700">{item.status}</div>
                    </div>
                  </div>
                  <div className="mt-4 h-3 overflow-hidden rounded-full bg-slate-100">
                    <div className="h-full rounded-full bg-gradient-to-r from-blue-600 to-cyan-400" style={{ width: `${item.score}%` }} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="grid gap-6 xl:grid-cols-3">
          <div className="rounded-[34px] border border-white/80 bg-white/95 p-6 shadow-[0_24px_70px_rgba(15,23,42,0.13)] backdrop-blur-xl">
            <BarChart3 className="h-8 w-8 text-cyan-700" />
            <h3 className="mt-5 text-2xl font-black text-slate-950">Payroll Protection</h3>
            <p className="mt-3 text-sm leading-6 text-slate-500">
              Blocks risky exports until clocking, overtime, GPS and manager approvals are clean.
            </p>
          </div>

          <div className="rounded-[34px] border border-white/80 bg-white/95 p-6 shadow-[0_24px_70px_rgba(15,23,42,0.13)] backdrop-blur-xl">
            <Users className="h-8 w-8 text-cyan-700" />
            <h3 className="mt-5 text-2xl font-black text-slate-950">Workforce Intelligence</h3>
            <p className="mt-3 text-sm leading-6 text-slate-500">
              Shows employee movement, absence patterns, late arrivals and high-risk behaviour trends.
            </p>
          </div>

          <div className="rounded-[34px] border border-white/80 bg-white/95 p-6 shadow-[0_24px_70px_rgba(15,23,42,0.13)] backdrop-blur-xl">
            <Clock3 className="h-8 w-8 text-cyan-700" />
            <h3 className="mt-5 text-2xl font-black text-slate-950">Roster Control</h3>
            <p className="mt-3 text-sm leading-6 text-slate-500">
              Prevents overtime abuse, understaffing, fatigue risk and unplanned labour costs.
            </p>
          </div>
        </section>
      </div>
    </main>
  );
}

"use client";

import { Activity, AlertTriangle, MapPin, Store, Users } from "lucide-react";

const stores = [
  { name: "Canal Walk", staff: 18, risk: 12, score: 94 },
  { name: "Constantia", staff: 11, risk: 22, score: 88 },
  { name: "Waterstone", staff: 14, risk: 48, score: 74 },
  { name: "Somerset Mall", staff: 9, risk: 62, score: 69 },
  { name: "Sea Point", staff: 7, risk: 34, score: 81 },
];

export default function WorkforceHeatmap() {
  return (
    <section className="rounded-[34px] border border-white/80 bg-white/95 p-6 shadow-[0_24px_70px_rgba(15,23,42,0.13)] backdrop-blur-xl">
      <div className="flex flex-col gap-5 xl:flex-row xl:items-center xl:justify-between">
        <div>
          <div className="flex items-center gap-3">
            <div className="rounded-2xl bg-[#06101f] p-3 text-cyan-300">
              <MapPin className="h-6 w-6" />
            </div>
            <div>
              <div className="text-xs font-black uppercase tracking-[0.35em] text-cyan-700">
                Workforce Heatmap
              </div>
              <h2 className="mt-2 text-3xl font-black tracking-tight text-slate-950">
                Store Risk & Coverage Map
              </h2>
            </div>
          </div>

          <p className="mt-4 max-w-3xl text-sm leading-6 text-slate-500">
            Live visual ranking of staff coverage, risk concentration and store-level workforce control.
          </p>
        </div>

        <div className="rounded-full bg-cyan-100 px-4 py-2 text-sm font-black text-cyan-700">
          5 stores monitored
        </div>
      </div>

      <div className="mt-8 grid gap-5 xl:grid-cols-[1fr_0.7fr]">
        <div className="relative min-h-[420px] overflow-hidden rounded-[32px] bg-[#06101f] p-6 text-white shadow-[0_24px_70px_rgba(2,6,23,0.25)]">
          <div className="pointer-events-none absolute left-[-80px] top-[-80px] h-72 w-72 rounded-full bg-cyan-400/20 blur-[80px]" />
          <div className="pointer-events-none absolute bottom-[-90px] right-[-90px] h-80 w-80 rounded-full bg-blue-500/20 blur-[90px]" />

          <div className="relative z-10 grid h-full gap-4 md:grid-cols-2">
            {stores.map((store) => (
              <div key={store.name} className="rounded-[28px] border border-white/10 bg-white/10 p-5 backdrop-blur-xl">
                <div className="flex items-start justify-between">
                  <div>
                    <div className="text-lg font-black">{store.name}</div>
                    <div className="mt-1 text-xs text-slate-300">{store.staff} staff active</div>
                  </div>
                  <Activity className="h-5 w-5 text-cyan-300" />
                </div>

                <div className="mt-5 h-3 overflow-hidden rounded-full bg-white/10">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-blue-500 to-cyan-300"
                    style={{ width: `${store.score}%` }}
                  />
                </div>

                <div className="mt-4 flex items-center justify-between text-xs font-black uppercase tracking-[0.16em]">
                  <span className="text-slate-300">Score</span>
                  <span className="text-cyan-300">{store.score}%</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="space-y-4">
          {stores.map((store) => (
            <article key={store.name} className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-[0_14px_40px_rgba(15,23,42,0.08)]">
              <div className="flex items-center justify-between">
                <div className="flex items-start gap-3">
                  <div className="rounded-2xl bg-cyan-100 p-3 text-cyan-700">
                    <Store className="h-5 w-5" />
                  </div>
                  <div>
                    <div className="font-black text-slate-950">{store.name}</div>
                    <div className="mt-1 text-xs text-slate-500">{store.staff} employees active</div>
                  </div>
                </div>

                <div className="text-right">
                  <div className="font-black text-slate-950">{store.risk}%</div>
                  <div className="text-xs text-slate-500">risk</div>
                </div>
              </div>
            </article>
          ))}
        </div>
      </div>

      <div className="mt-6 rounded-[28px] bg-amber-50 p-5 text-amber-800">
        <div className="flex items-center gap-3">
          <AlertTriangle className="h-6 w-6" />
          <div>
            <div className="font-black">Executive insight</div>
            <p className="mt-1 text-sm">
              Somerset Mall and Waterstone require manager review before the next payroll cycle.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

"use client";

import { Building2, Star, TrendingUp } from "lucide-react";

const stores = [
  ["Waterstone", "92%", "Excellent"],
  ["Canal Walk", "81%", "Stable"],
  ["Somerset Mall", "68%", "Needs attention"],
  ["Claremont", "89%", "Strong"],
];

export default function StorePerformanceIntelligence() {
  return (
    <section className="rounded-[34px] border border-white/80 bg-white/95 p-6 shadow-[0_24px_70px_rgba(15,23,42,0.13)]">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-xs font-black uppercase tracking-[0.35em] text-cyan-700">Store Intelligence</div>
          <h2 className="mt-3 text-3xl font-black tracking-tight text-slate-950">
            Store Performance Intelligence
          </h2>
        </div>

        <div className="rounded-full bg-cyan-100 px-4 py-2 text-sm font-black text-cyan-700">
          28 live stores
        </div>
      </div>

      <div className="mt-8 grid gap-5 md:grid-cols-2">
        {stores.map(([store, score, status]) => (
          <article key={store} className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div className="rounded-2xl bg-cyan-100 p-3 text-cyan-700">
                  <Building2 className="h-5 w-5" />
                </div>

                <div>
                  <div className="font-black text-slate-950">{store}</div>
                  <div className="mt-1 text-sm text-slate-500">{status}</div>
                </div>
              </div>

              <div className="text-right">
                <div className="text-3xl font-black text-slate-950">{score}</div>
                <div className="text-xs text-slate-500">Store score</div>
              </div>
            </div>

            <div className="mt-5 h-3 overflow-hidden rounded-full bg-slate-100">
              <div className="h-full rounded-full bg-gradient-to-r from-blue-600 to-cyan-400" style={{ width: score }} />
            </div>

            <div className="mt-5 flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm font-bold text-emerald-700">
                <TrendingUp className="h-4 w-4" />
                Performance trend positive
              </div>

              <div className="flex items-center gap-1 text-amber-500">
                <Star className="h-4 w-4 fill-current" />
                <Star className="h-4 w-4 fill-current" />
                <Star className="h-4 w-4 fill-current" />
                <Star className="h-4 w-4 fill-current" />
              </div>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

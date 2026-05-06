"use client";

import React from "react";

export default function ClientOnboardingPanel() {
  return (
    <div className="mt-8">
      <section className="rounded-[34px] bg-gradient-to-r from-[#07101f] to-[#0b1a33] p-6 text-white shadow-2xl shadow-slate-300">
        <div className="text-xs font-bold uppercase tracking-[0.4em] text-cyan-300">VYRON CORE</div>
        <h2 className="mt-3 text-4xl font-bold">Client Onboarding</h2>
        <p className="mt-4 max-w-3xl text-sm leading-7 text-slate-300">Step-by-step onboarding checklist for first paying clients.</p>
      </section>

      <section className="mt-6 rounded-[34px] border border-slate-200 bg-white p-6 shadow-[0_10px_30px_rgba(0,0,0,0.08)]">
        <h3 className="text-2xl font-bold text-slate-950">Final Completion Module</h3>
        <p className="mt-3 text-sm leading-7 text-slate-600">
          This is a full downloadable component file. Connect it into app/page.tsx when you reach this day.
        </p>
      </section>
    </div>
  );
}

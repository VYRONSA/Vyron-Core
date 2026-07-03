"use client";

import React from "react";
import Link from "next/link";
import { Clock3, CalendarDays } from "lucide-react";

export default function EmployeeKioskHomePage() {
  return (
    <main className="min-h-screen bg-[#07101f] px-4 py-5 text-white md:px-8">
      <div className="mx-auto max-w-5xl">
        <section className="rounded-[34px] border border-white/10 bg-white/[0.045] p-6 shadow-2xl shadow-black/20">
          <div className="text-xs font-black uppercase tracking-[0.35em] text-cyan-300">VYRON CORE</div>
          <h1 className="mt-3 text-5xl font-black tracking-tight">Employee Kiosk</h1>
          <p className="mt-4 max-w-2xl text-sm leading-7 text-slate-300">
            Employee-only screen. No manager tools appear here.
          </p>
          <div className="mt-8 grid gap-4 md:grid-cols-2">
            <Link href="/clock" className="rounded-[30px] border border-cyan-400/20 bg-cyan-500/10 p-6 hover:bg-cyan-500/20">
              <Clock3 className="h-12 w-12 text-cyan-300" />
              <div className="mt-5 text-3xl font-black">Clock In / Out</div>
            </Link>
            <Link href="/leave" className="rounded-[30px] border border-emerald-400/20 bg-emerald-500/10 p-6 hover:bg-emerald-500/20">
              <CalendarDays className="h-12 w-12 text-emerald-300" />
              <div className="mt-5 text-3xl font-black">Apply for Leave</div>
            </Link>
          </div>
        </section>
      </div>
    </main>
  );
}

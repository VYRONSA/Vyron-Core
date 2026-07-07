"use client";

import React, { useState } from "react";

export default function SmartAutoRosteringAI({
  onGenerate,
}: {
  onGenerate?: (payload: {
    startDate: string;
    endDate: string;
    startTime: string;
    endTime: string;
  }) => Promise<void> | void;
}) {
  const [startDate, setStartDate] = useState(new Date().toISOString().slice(0, 10));
  const [endDate, setEndDate] = useState(new Date().toISOString().slice(0, 10));
  const [startTime, setStartTime] = useState("08:00");
  const [endTime, setEndTime] = useState("17:00");

  return (
    <section className="rounded-[28px] border border-white/80 bg-white/95 p-6 shadow-[0_20px_60px_rgba(15,23,42,0.12)]">
      <div className="text-xs font-black uppercase tracking-[0.35em] text-cyan-700">Auto Rostering</div>
      <h3 className="mt-2 text-2xl font-black text-slate-950">AI-Assisted Shift Builder</h3>
      <p className="mt-2 text-sm text-slate-500">
        Generate a balanced draft using active staff and stores. Existing roster APIs and tables are reused.
      </p>

      <div className="mt-5 grid gap-3 md:grid-cols-4">
        <input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} className="rounded-xl border border-slate-200 px-3 py-2 text-sm font-semibold" />
        <input type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} className="rounded-xl border border-slate-200 px-3 py-2 text-sm font-semibold" />
        <input type="time" value={startTime} onChange={(event) => setStartTime(event.target.value)} className="rounded-xl border border-slate-200 px-3 py-2 text-sm font-semibold" />
        <input type="time" value={endTime} onChange={(event) => setEndTime(event.target.value)} className="rounded-xl border border-slate-200 px-3 py-2 text-sm font-semibold" />
      </div>

      <button
        onClick={() =>
          onGenerate?.({
            startDate,
            endDate,
            startTime,
            endTime,
          })
        }
        className="mt-4 rounded-xl bg-[#06101f] px-5 py-2.5 text-sm font-black text-cyan-300"
      >
        Generate Draft Roster
      </button>
    </section>
  );
}

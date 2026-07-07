"use client";

import React from "react";
import { shiftHours } from "@/lib/roster-enterprise";

type RosterShiftLite = {
  id: string;
  shift_date: string;
  planned_start: string;
  planned_end: string;
  employee_id: string;
  status: string;
};

export default function OvernightShiftLogic({
  rosterShifts,
}: {
  rosterShifts: RosterShiftLite[];
}) {
  const overnight = rosterShifts.filter((shift) => {
    const start = shift.planned_start.slice(11, 16);
    const end = shift.planned_end.slice(11, 16);
    return end < start;
  });

  const totalHours = overnight.reduce((sum, shift) => sum + shiftHours(shift.planned_start, shift.planned_end), 0);

  return (
    <section className="rounded-[28px] border border-white/80 bg-white/95 p-6 shadow-[0_20px_60px_rgba(15,23,42,0.12)]">
      <div className="text-xs font-black uppercase tracking-[0.35em] text-cyan-700">Overnight Control</div>
      <h3 className="mt-2 text-2xl font-black text-slate-950">Night Shift Compliance Monitor</h3>
      <p className="mt-2 text-sm text-slate-500">Tracks overnight shifts and highlights cost/compliance pressure before publication.</p>

      <div className="mt-4 grid gap-3 md:grid-cols-3">
        <div className="rounded-xl bg-slate-50 p-4">
          <div className="text-xs font-black uppercase tracking-[0.2em] text-slate-500">Overnight shifts</div>
          <div className="mt-2 text-3xl font-black text-slate-950">{overnight.length}</div>
        </div>
        <div className="rounded-xl bg-slate-50 p-4">
          <div className="text-xs font-black uppercase tracking-[0.2em] text-slate-500">Overnight hours</div>
          <div className="mt-2 text-3xl font-black text-slate-950">{totalHours.toFixed(1)}h</div>
        </div>
        <div className="rounded-xl bg-slate-50 p-4">
          <div className="text-xs font-black uppercase tracking-[0.2em] text-slate-500">Status mix</div>
          <div className="mt-2 text-sm font-bold text-slate-700">
            {Array.from(new Set(overnight.map((shift) => shift.status))).join(", ") || "No overnight statuses"}
          </div>
        </div>
      </div>
    </section>
  );
}

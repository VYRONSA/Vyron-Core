"use client";

import React, { useMemo, useState } from "react";

type RosterShiftLite = {
  id: string;
  shift_date: string;
  planned_start: string;
  planned_end: string;
  employee_id: string;
  store_id: string;
  role: string | null;
  status: string;
  published?: boolean;
  approved?: boolean;
};

type EmployeeLite = {
  id: string;
  first_name: string;
  last_name: string;
  active?: boolean;
};

type StoreLite = {
  id: string;
  name: string;
};

export default function DragDropRosterCalendar({
  rosterShifts,
  employees,
  stores,
  onMoveShift,
  onPublishDay,
}: {
  rosterShifts: RosterShiftLite[];
  employees: EmployeeLite[];
  stores: StoreLite[];
  onMoveShift?: (shiftId: string, nextDate: string) => Promise<void> | void;
  onPublishDay?: (shiftDate: string) => Promise<void> | void;
}) {
  const grouped = useMemo(() => {
    const map = new Map<string, RosterShiftLite[]>();
    rosterShifts.forEach((shift) => {
      if (!map.has(shift.shift_date)) map.set(shift.shift_date, []);
      map.get(shift.shift_date)!.push(shift);
    });
    return map;
  }, [rosterShifts]);

  const dates = useMemo(() => Array.from(grouped.keys()).sort(), [grouped]);

  const [selectedShiftId, setSelectedShiftId] = useState("");
  const [targetDate, setTargetDate] = useState("");
  const [busy, setBusy] = useState(false);

  function employeeName(employeeId: string) {
    const employee = employees.find((item) => item.id === employeeId);
    if (!employee) return "Unknown employee";
    return `${employee.first_name} ${employee.last_name}`;
  }

  function storeName(storeId: string) {
    const store = stores.find((item) => item.id === storeId);
    return store?.name || "Unknown store";
  }

  async function moveShift() {
    if (!selectedShiftId || !targetDate || !onMoveShift) return;
    setBusy(true);
    await onMoveShift(selectedShiftId, targetDate);
    setBusy(false);
    setSelectedShiftId("");
    setTargetDate("");
  }

  return (
    <section className="rounded-[28px] border border-white/80 bg-white/95 p-6 shadow-[0_20px_60px_rgba(15,23,42,0.12)]">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <div className="text-xs font-black uppercase tracking-[0.35em] text-cyan-700">Visual Planner</div>
          <h3 className="mt-2 text-2xl font-black text-slate-950">Drag and Move Weekly Roster</h3>
          <p className="mt-2 text-sm text-slate-500">
            Uses existing roster shifts and lets managers move shifts between days without creating duplicate planners.
          </p>
        </div>

        <div className="grid gap-3 md:grid-cols-[1fr_140px_auto]">
          <select
            value={selectedShiftId}
            onChange={(event) => setSelectedShiftId(event.target.value)}
            className="rounded-2xl border border-slate-200 px-4 py-3 text-sm font-semibold"
          >
            <option value="">Select shift</option>
            {rosterShifts.map((shift) => (
              <option key={shift.id} value={shift.id}>
                {shift.shift_date} - {employeeName(shift.employee_id)}
              </option>
            ))}
          </select>

          <input
            type="date"
            value={targetDate}
            onChange={(event) => setTargetDate(event.target.value)}
            className="rounded-2xl border border-slate-200 px-4 py-3 text-sm font-semibold"
          />

          <button
            onClick={moveShift}
            disabled={busy || !selectedShiftId || !targetDate || !onMoveShift}
            className="rounded-2xl bg-[#06101f] px-4 py-3 text-sm font-black text-cyan-300 disabled:opacity-60"
          >
            {busy ? "Moving..." : "Move Shift"}
          </button>
        </div>
      </div>

      <div className="mt-6 grid gap-4 xl:grid-cols-3">
        {dates.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-5 text-sm font-semibold text-slate-500">
            No shifts available yet.
          </div>
        ) : (
          dates.map((date) => (
            <article key={date} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <div className="flex items-center justify-between">
                <div className="text-sm font-black uppercase tracking-[0.2em] text-slate-500">{date}</div>
                <button
                  onClick={() => onPublishDay?.(date)}
                  className="rounded-xl bg-emerald-600 px-3 py-1.5 text-xs font-black text-white"
                >
                  Publish Day
                </button>
              </div>

              <div className="mt-3 space-y-2">
                {(grouped.get(date) || []).map((shift) => (
                  <div key={shift.id} className="rounded-xl bg-white p-3 text-sm shadow-sm">
                    <div className="font-black text-slate-900">{employeeName(shift.employee_id)}</div>
                    <div className="text-xs font-semibold text-slate-500">{storeName(shift.store_id)} · {shift.planned_start.slice(11, 16)} - {shift.planned_end.slice(11, 16)}</div>
                    <div className="mt-1 text-xs font-semibold text-slate-500">{shift.role || "No role"} · {shift.status}</div>
                  </div>
                ))}
              </div>
            </article>
          ))
        )}
      </div>
    </section>
  );
}

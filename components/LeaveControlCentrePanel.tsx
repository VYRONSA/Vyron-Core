"use client";

import React, { useMemo, useState } from "react";
import { CalendarDays, CheckCircle2, Clock3, Search, XCircle } from "lucide-react";
import { supabase } from "../lib/supabase";

type LeaveRequest = {
  id: string;
  employee_id: string | null;
  employee_name: string | null;
  leave_type: string | null;
  start_date: string;
  end_date: string;
  reason: string | null;
  status: string;
  manager_feedback: string | null;
  created_at: string;
};

export default function LeaveControlCentrePanel({
  leaveRequests = [],
  employees = [],
  onUpdated,
}: {
  leaveRequests?: LeaveRequest[];
  employees?: any[];
  onUpdated?: () => void | Promise<void>;
}) {
  const [search, setSearch] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [feedbackById, setFeedbackById] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);

  const pending = leaveRequests.filter((item) => item.status === "pending" || item.status === "requested");
  const approved = leaveRequests.filter((item) => item.status === "approved");
  const declined = leaveRequests.filter((item) => item.status === "declined");

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return leaveRequests;
    return leaveRequests.filter((item) =>
      [item.employee_name, item.leave_type, item.reason, item.status, item.manager_feedback]
        .join(" ")
        .toLowerCase()
        .includes(term)
    );
  }, [leaveRequests, search]);

  function employeeName(item: LeaveRequest) {
    if (item.employee_name) return item.employee_name;
    const emp = employees.find((x) => x.id === item.employee_id);
    return emp ? `${emp.first_name || ""} ${emp.last_name || ""}`.trim() : "Unknown employee";
  }

  async function decide(item: LeaveRequest, status: "approved" | "declined" | "amended") {
    setBusyId(item.id);
    setMessage(null);

    const feedback = feedbackById[item.id] || "";

    const { error } = await supabase
      .from("leave_requests")
      .update({
        status,
        manager_feedback: feedback.trim() || `Leave ${status} by manager.`,
      })
      .eq("id", item.id);

    if (error) {
      setMessage(error.message);
      setBusyId(null);
      return;
    }

    setMessage(`Leave ${status} for ${employeeName(item)}.`);
    setFeedbackById((current) => ({ ...current, [item.id]: "" }));
    if (onUpdated) await onUpdated();
    setBusyId(null);
  }

  return (
    <section className="space-y-6">
      <div className="rounded-[34px] bg-gradient-to-r from-[#07101f] to-[#0b1a33] p-7 text-white shadow-2xl">
        <div className="text-xs font-black uppercase tracking-[0.4em] text-cyan-300">LEAVE CONTROL</div>
        <h1 className="mt-3 text-4xl font-black">Leave Management Command Centre</h1>
        <p className="mt-3 max-w-3xl text-sm leading-7 text-slate-300">
          Approve, decline, amend and audit leave requests before they affect rosters and payroll.
        </p>
      </div>

      <div className="grid gap-5 md:grid-cols-4">
        <Metric icon={<CalendarDays />} label="Total requests" value={leaveRequests.length} />
        <Metric icon={<Clock3 />} label="Pending" value={pending.length} danger={pending.length > 0} />
        <Metric icon={<CheckCircle2 />} label="Approved" value={approved.length} />
        <Metric icon={<XCircle />} label="Declined" value={declined.length} />
      </div>

      {message && <div className="rounded-2xl bg-blue-50 p-4 text-sm font-bold text-blue-700">{message}</div>}

      <div className="rounded-[34px] bg-white p-6 shadow-lg">
        <div className="flex items-center gap-3 rounded-2xl bg-slate-50 px-4 py-3">
          <Search className="h-5 w-5 text-slate-400" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search leave requests..." className="w-full bg-transparent text-sm font-bold outline-none" />
        </div>

        <div className="mt-6 space-y-4">
          {filtered.length === 0 ? (
            <div className="rounded-3xl border border-dashed border-slate-200 p-8 text-center font-bold text-slate-500">No leave requests found.</div>
          ) : filtered.map((item) => (
            <div key={item.id} className="rounded-3xl border border-slate-200 bg-slate-50 p-5">
              <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                <div>
                  <div className="font-black text-slate-950">{employeeName(item)}</div>
                  <div className="mt-1 text-sm font-semibold text-slate-500">
                    {item.leave_type || "Leave"} · {item.start_date} to {item.end_date}
                  </div>
                  <p className="mt-3 text-sm leading-6 text-slate-600">{item.reason || "No reason captured."}</p>
                </div>
                <span className="rounded-full bg-slate-900 px-3 py-1 text-xs font-black uppercase text-white">{item.status}</span>
              </div>

              <textarea
                value={feedbackById[item.id] || ""}
                onChange={(e) => setFeedbackById((current) => ({ ...current, [item.id]: e.target.value }))}
                className="mt-4 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold outline-none"
                rows={3}
                placeholder="Manager feedback to employee..."
              />

              <div className="mt-4 grid gap-3 md:grid-cols-3">
                <button disabled={busyId === item.id} onClick={() => decide(item, "approved")} className="rounded-2xl bg-emerald-600 px-4 py-3 text-sm font-black text-white disabled:bg-slate-300">Approve</button>
                <button disabled={busyId === item.id} onClick={() => decide(item, "amended")} className="rounded-2xl bg-amber-500 px-4 py-3 text-sm font-black text-white disabled:bg-slate-300">Amend</button>
                <button disabled={busyId === item.id} onClick={() => decide(item, "declined")} className="rounded-2xl bg-rose-600 px-4 py-3 text-sm font-black text-white disabled:bg-slate-300">Decline</button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function Metric({ icon, label, value, danger }: { icon: React.ReactNode; label: string; value: number; danger?: boolean }) {
  return (
    <div className={`rounded-[28px] p-6 shadow-lg ${danger ? "bg-rose-50 text-rose-800" : "bg-white text-slate-950"}`}>
      <div>{icon}</div>
      <div className="mt-4 text-4xl font-black">{value}</div>
      <div className="text-sm font-bold opacity-70">{label}</div>
    </div>
  );
}

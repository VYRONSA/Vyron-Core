"use client";

import React, { useMemo, useState } from "react";
import { Bell, CalendarDays, FileText, ShieldCheck, UserRound } from "lucide-react";

export default function EmployeeNotificationsPanel({
  employees = [],
  leaveRequests = [],
  hrCases = [],
  notifications = [],
  onUpdated, // 👈 Added to the destructured arguments
}: {
  employees?: any[];
  leaveRequests?: any[];
  hrCases?: any[];
  notifications?: any[];
  onUpdated?: () => void; // 👈 Added to the TypeScript definition
}) {
  const [employeeId, setEmployeeId] = useState("");

  const employee = employees.find((item) => item.id === employeeId) || employees[0] || null;
  const currentEmployeeId = employee?.id || "";

  const myLeave = useMemo(() => leaveRequests.filter((x) => x.employee_id === currentEmployeeId), [leaveRequests, currentEmployeeId]);
  const myHrCases = useMemo(() => hrCases.filter((x) => x.employee_id === currentEmployeeId), [hrCases, currentEmployeeId]);
  const myNotifications = useMemo(() => notifications.filter((x) => !x.employee_id || x.employee_id === currentEmployeeId), [notifications, currentEmployeeId]);

  return (
    <section className="space-y-6">
      <div className="rounded-[34px] bg-gradient-to-r from-[#07101f] to-[#0b1a33] p-7 text-white shadow-2xl">
        <div className="text-xs font-black uppercase tracking-[0.4em] text-cyan-300">EMPLOYEE EXPERIENCE</div>
        <h1 className="mt-3 text-4xl font-black">Employee Self-Service Centre</h1>
        <p className="mt-3 max-w-3xl text-sm leading-7 text-slate-300">
          One employee-facing view for leave feedback, HR communication, documents and notifications.
        </p>
      </div>

      <div className="rounded-[34px] bg-white p-6 shadow-lg">
        <label className="text-sm font-black text-slate-800">
          Select employee
          <select value={currentEmployeeId} onChange={(e) => setEmployeeId(e.target.value)} className="mt-2 w-full rounded-2xl bg-slate-50 px-4 py-3 text-sm font-bold outline-none">
            {employees.map((item) => (
              <option key={item.id} value={item.id}>{item.first_name} {item.last_name} · {item.employee_number || "No code"}</option>
            ))}
          </select>
        </label>
      </div>

      <div className="grid gap-5 md:grid-cols-4">
        <Metric icon={<UserRound />} label="Employee" value={employee ? `${employee.first_name} ${employee.last_name}` : "None"} />
        <Metric icon={<CalendarDays />} label="Leave records" value={myLeave.length} />
        <Metric icon={<ShieldCheck />} label="HR cases" value={myHrCases.length} />
        <Metric icon={<Bell />} label="Notifications" value={myNotifications.length} />
      </div>

      <div className="grid gap-6 xl:grid-cols-3">
        <Panel title="Leave feedback" icon={<CalendarDays />}>
          {myLeave.length === 0 ? <Empty /> : myLeave.map((item) => <Card key={item.id} title={`${item.leave_type || "Leave"} · ${item.status}`} body={item.manager_feedback || item.reason || "No detail."} />)}
        </Panel>
        <Panel title="HR communication" icon={<ShieldCheck />}>
          {myHrCases.length === 0 ? <Empty /> : myHrCases.map((item) => <Card key={item.id} title={item.title} body={item.manager_feedback || item.employee_response || item.description} />)}
        </Panel>
        <Panel title="Documents & notices" icon={<FileText />}>
          {myNotifications.length === 0 ? <Empty /> : myNotifications.map((item) => <Card key={item.id} title={item.title} body={item.body || "No detail."} />)}
        </Panel>
      </div>
    </section>
  );
}

function Metric({ icon, label, value }: { icon: React.ReactNode; label: string; value: any }) {
  return <div className="rounded-[28px] bg-white p-6 shadow-lg"><div className="text-slate-900">{icon}</div><div className="mt-4 text-2xl font-black text-slate-950">{value}</div><div className="text-sm font-bold text-slate-500">{label}</div></div>;
}
function Panel({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return <div className="rounded-[34px] bg-white p-6 shadow-lg"><div className="flex items-center gap-3"><div className="text-slate-900">{icon}</div><h2 className="text-xl font-black text-slate-950">{title}</h2></div><div className="mt-5 space-y-3">{children}</div></div>;
}
function Card({ title, body }: { title: string; body: string }) {
  return <div className="rounded-2xl bg-slate-50 p-4"><div className="font-black text-slate-950">{title}</div><p className="mt-2 text-sm leading-6 text-slate-600">{body}</p></div>;
}
function Empty() {
  return <div className="rounded-2xl border border-dashed border-slate-200 p-6 text-center text-sm font-bold text-slate-400">No records yet.</div>;
}
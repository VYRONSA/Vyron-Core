"use client";

import React, { useMemo, useState } from "react";
import { LockKeyhole, ShieldCheck, UserPlus, Users } from "lucide-react";
import { supabase } from "../lib/supabase";

export default function RolesPermissionsEngineFinal({
  companyUsers = [],
  companyId,
  onUpdated,
}: {
  companyUsers?: any[];
  companyId?: string;
  onUpdated?: () => void | Promise<void>;
}) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("manager");
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const admins = useMemo(() => companyUsers.filter((x) => x.role === "admin").length, [companyUsers]);
  const managers = useMemo(() => companyUsers.filter((x) => x.role === "manager").length, [companyUsers]);

  async function addUser() {
    setSaving(true);
    setMessage(null);

    if (!email.trim()) {
      setMessage("Email is required.");
      setSaving(false);
      return;
    }

    const { error } = await supabase.from("company_users").insert({
      company_id: companyId,
      user_email: email.trim().toLowerCase(),
      role,
      status: "active",
    });

    if (error) {
      setMessage(error.message);
      setSaving(false);
      return;
    }

    setMessage("User access added.");
    setEmail("");
    if (onUpdated) await onUpdated();
    setSaving(false);
  }

  return (
    <section className="space-y-6">
      <div className="rounded-[34px] bg-gradient-to-r from-[#07101f] to-[#0b1a33] p-7 text-white shadow-2xl">
        <div className="text-xs font-black uppercase tracking-[0.4em] text-cyan-300">ACCESS CONTROL</div>
        <h1 className="mt-3 text-4xl font-black">Roles & Permissions Engine</h1>
        <p className="mt-3 max-w-3xl text-sm leading-7 text-slate-300">
          Control who can access payroll, HR, clocking, rosters and executive reports.
        </p>
      </div>

      <div className="grid gap-5 md:grid-cols-3">
        <Metric icon={<Users />} label="Total users" value={companyUsers.length} />
        <Metric icon={<ShieldCheck />} label="Admins" value={admins} />
        <Metric icon={<LockKeyhole />} label="Managers" value={managers} />
      </div>

      <div className="rounded-[34px] bg-white p-6 shadow-lg">
        <div className="flex items-center gap-3">
          <UserPlus className="h-7 w-7 text-slate-900" />
          <h2 className="text-2xl font-black text-slate-950">Add company user</h2>
        </div>

        <div className="mt-6 grid gap-3 md:grid-cols-[1fr_0.4fr_auto]">
          <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="manager@company.co.za" className="rounded-2xl bg-slate-50 px-4 py-3 text-sm font-bold outline-none" />
          <select value={role} onChange={(e) => setRole(e.target.value)} className="rounded-2xl bg-slate-50 px-4 py-3 text-sm font-bold outline-none">
            <option value="admin">Admin</option>
            <option value="manager">Manager</option>
            <option value="payroll">Payroll</option>
            <option value="hr">HR</option>
            <option value="viewer">Viewer</option>
          </select>
          <button onClick={addUser} disabled={saving} className="rounded-2xl bg-slate-950 px-5 py-3 text-sm font-black text-white disabled:bg-slate-300">Add user</button>
        </div>

        {message && <div className="mt-4 rounded-2xl bg-blue-50 p-4 text-sm font-bold text-blue-700">{message}</div>}

        <div className="mt-6 space-y-3">
          {companyUsers.map((item) => (
            <div key={item.id || item.user_email} className="rounded-2xl bg-slate-50 p-4">
              <div className="font-black text-slate-950">{item.user_email}</div>
              <div className="mt-1 text-sm font-bold uppercase text-slate-500">{item.role} · {item.status}</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
function Metric({ icon, label, value }: { icon: React.ReactNode; label: string; value: any }) {
  return <div className="rounded-[28px] bg-white p-6 shadow-lg"><div>{icon}</div><div className="mt-4 text-4xl font-black text-slate-950">{value}</div><div className="text-sm font-bold text-slate-500">{label}</div></div>;
}

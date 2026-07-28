"use client";

import React, { useEffect, useState } from "react";
import {
  Activity,
  AlertTriangle,
  Building2,
  CheckCircle2,
  Clock,
  ShieldAlert,
  Users,
  WalletCards,
} from "lucide-react";
import { platformFetch } from "@/lib/platform/platform-client";
import PlatformPanel from "./PlatformPanel";
import PlatformStatTile from "./PlatformStatTile";

type DashboardData = {
  totalCustomers: number;
  activeCustomers: number;
  trialCustomers: number;
  suspendedCustomers: number;
  expiredCustomers: number;
  cancelledCustomers: number;
  totalEmployees: number;
  totalActiveUsers: number;
  mrr: number;
  arr: number;
  licenceUtilisationPct: number | null;
  recentSignups: { id: string; name: string; status: string | null; createdAt: string | null }[];
  systemHealthScore: number;
};

export default function PlatformDashboard() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      const result = await platformFetch<DashboardData>("/api/platform/dashboard");
      if (cancelled) return;
      if (!result.ok) {
        setError(result.message);
      } else {
        setData(result.data);
        setError(null);
      }
      setLoading(false);
    }
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) {
    return <PlatformPanel className="text-center text-slate-500">Loading platform dashboard…</PlatformPanel>;
  }

  if (error || !data) {
    return (
      <PlatformPanel className="text-rose-700">
        Could not load the platform dashboard: {error || "Unknown error."}
      </PlatformPanel>
    );
  }

  const currencyFormatter = new Intl.NumberFormat("en-ZA", {
    style: "currency",
    currency: "ZAR",
    maximumFractionDigits: 0,
  });

  return (
    <div className="flex flex-col gap-6">
      <section className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
        <PlatformStatTile icon={Building2} label="Total Customers" value={data.totalCustomers} tone="slate" subtitle="All tenants" />
        <PlatformStatTile icon={CheckCircle2} label="Active Customers" value={data.activeCustomers} tone="emerald" subtitle="Billing normally" />
        <PlatformStatTile icon={Clock} label="Trial Customers" value={data.trialCustomers} tone="cyan" subtitle="In trial period" />
        <PlatformStatTile icon={AlertTriangle} label="Suspended Customers" value={data.suspendedCustomers} tone="amber" subtitle="Access blocked" />
        <PlatformStatTile icon={ShieldAlert} label="Expired / Cancelled" value={data.expiredCustomers + data.cancelledCustomers} tone="rose" subtitle="Churned" />
        <PlatformStatTile icon={Users} label="Total Employees" value={data.totalEmployees.toLocaleString("en-ZA")} tone="slate" subtitle="Across all tenants" />
        <PlatformStatTile icon={Users} label="Total Active Users" value={data.totalActiveUsers.toLocaleString("en-ZA")} tone="slate" subtitle="Signed-in seats" />
        <PlatformStatTile icon={WalletCards} label="MRR" value={currencyFormatter.format(data.mrr)} tone="emerald" subtitle="Monthly recurring revenue" />
        <PlatformStatTile icon={WalletCards} label="ARR" value={currencyFormatter.format(data.arr)} tone="emerald" subtitle="Annual recurring revenue" />
      </section>

      <section className="grid gap-6 lg:grid-cols-3">
        <PlatformPanel className="lg:col-span-1">
          <div className="text-xs font-black uppercase tracking-[0.25em] text-cyan-700">Licence Utilisation</div>
          <div className="mt-4 text-4xl font-black text-[#06101f]">
            {data.licenceUtilisationPct === null ? "—" : `${data.licenceUtilisationPct}%`}
          </div>
          <div className="mt-3 h-3 w-full overflow-hidden rounded-full bg-slate-100">
            <div
              className="h-full rounded-full bg-cyan-600"
              style={{ width: `${Math.min(100, data.licenceUtilisationPct || 0)}%` }}
            />
          </div>
          <p className="mt-3 text-sm text-slate-600">Employees provisioned vs. total licenced seats.</p>
        </PlatformPanel>

        <PlatformPanel className="lg:col-span-1">
          <div className="text-xs font-black uppercase tracking-[0.25em] text-emerald-700 flex items-center gap-2">
            <Activity className="h-4 w-4" /> System Health
          </div>
          <div className="mt-4 text-4xl font-black text-[#06101f]">{data.systemHealthScore}%</div>
          <p className="mt-3 text-sm text-slate-600">Share of non-trial customers currently active.</p>
        </PlatformPanel>

        <PlatformPanel className="lg:col-span-1">
          <div className="text-xs font-black uppercase tracking-[0.25em] text-slate-600">Recent Sign-ups</div>
          <ul className="mt-4 flex flex-col gap-3">
            {data.recentSignups.length === 0 ? (
              <li className="text-sm text-slate-500">No sign-ups yet.</li>
            ) : (
              data.recentSignups.map((entry) => (
                <li key={entry.id} className="flex items-center justify-between text-sm">
                  <span className="font-bold text-slate-900">{entry.name}</span>
                  <span className="text-xs font-bold uppercase tracking-wide text-slate-500">
                    {entry.status || "trial"}
                  </span>
                </li>
              ))
            )}
          </ul>
        </PlatformPanel>
      </section>
    </div>
  );
}

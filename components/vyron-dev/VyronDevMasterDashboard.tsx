"use client";

import React, { useMemo } from "react";
import {
  Activity,
  AlertTriangle,
  Building2,
  CheckCircle2,
  Headphones,
  Layers,
  Users,
  WalletCards,
} from "lucide-react";
import {
  VYRON_PRODUCT_CODES,
  computeMasterDashboardMetrics,
  mapDirectoryEntryToDevClient,
  type VyronDevDirectorySourceEntry,
  type VyronDevPlatformState,
} from "@/lib/vyron-dev-platform";

type Props = {
  clientDirectory: VyronDevDirectorySourceEntry[];
  platformState: VyronDevPlatformState;
  setActive: (value: string) => void;
};

function productStatusTone(
  breakdown: { enabled: number; trial: number; suspended: number; disabled: number }
): string {
  if (breakdown.enabled > 0) return "border-emerald-200 bg-emerald-50/90";
  if (breakdown.trial > 0) return "border-cyan-200 bg-cyan-50/90";
  if (breakdown.suspended > 0) return "border-amber-200 bg-amber-50/90";
  return "border-white/80 bg-white/95";
}

export default function VyronDevMasterDashboard({
  clientDirectory,
  platformState,
  setActive,
}: Props) {
  const metrics = useMemo(() => {
    const clients = clientDirectory.map((entry) =>
      mapDirectoryEntryToDevClient(entry, platformState)
    );
    return computeMasterDashboardMetrics(clients, platformState);
  }, [clientDirectory, platformState]);

  return (
    <>
      <section className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
        <button
          type="button"
          onClick={() => setActive("Client Directory")}
          className="rounded-[2rem] border border-white/80 bg-white/95 p-6 text-left shadow-[0_18px_55px_rgba(15,23,42,0.14)] backdrop-blur-xl transition hover:-translate-y-1"
        >
          <div className="w-fit rounded-2xl bg-cyan-50 p-3 text-cyan-700">
            <Building2 className="h-6 w-6" />
          </div>
          <div className="mt-6 text-sm font-bold text-slate-500">Total Clients</div>
          <div className="mt-2 text-4xl font-black text-[#06101f]">{metrics.totalClients}</div>
          <div className="mt-2 text-sm font-black text-cyan-700">Managed workspaces</div>
        </button>

        <div className="rounded-[2rem] border border-emerald-200/80 bg-emerald-50/90 p-6 text-left shadow-[0_18px_55px_rgba(16,185,129,0.12)]">
          <div className="w-fit rounded-2xl bg-white p-3 text-emerald-700">
            <CheckCircle2 className="h-6 w-6" />
          </div>
          <div className="mt-6 text-sm font-bold text-emerald-900">Active Clients</div>
          <div className="mt-2 text-4xl font-black text-emerald-950">{metrics.activeClients}</div>
          <div className="mt-2 text-sm font-black text-emerald-700">Active + trial tier</div>
        </div>

        <div className="rounded-[2rem] border border-white/80 bg-white/95 p-6 text-left shadow-[0_18px_55px_rgba(15,23,42,0.14)] backdrop-blur-xl">
          <div className="w-fit rounded-2xl bg-blue-50 p-3 text-blue-700">
            <Users className="h-6 w-6" />
          </div>
          <div className="mt-6 text-sm font-bold text-slate-500">Total Active Users</div>
          <div className="mt-2 text-4xl font-black text-[#06101f]">{metrics.totalActiveUsers}</div>
          <div className="mt-2 text-sm font-black text-blue-700">Across client portfolio</div>
        </div>

        <button
          type="button"
          onClick={() => setActive("Workspace Provisioning")}
          className="rounded-[2rem] border border-violet-200/80 bg-violet-50/90 p-6 text-left shadow-[0_18px_55px_rgba(139,92,246,0.12)] transition hover:-translate-y-1"
        >
          <div className="w-fit rounded-2xl bg-white p-3 text-violet-700">
            <Layers className="h-6 w-6" />
          </div>
          <div className="mt-6 text-sm font-bold text-violet-800">Total Workspaces</div>
          <div className="mt-2 text-4xl font-black text-violet-950">{metrics.totalWorkspaces}</div>
          <div className="mt-2 text-sm font-black text-violet-700">Provisioned records</div>
        </button>

        <div className="rounded-[2rem] border border-violet-200/80 bg-violet-50/90 p-6 text-left shadow-[0_18px_55px_rgba(139,92,246,0.12)]">
          <div className="w-fit rounded-2xl bg-white p-3 text-violet-700">
            <Activity className="h-6 w-6" />
          </div>
          <div className="mt-6 text-sm font-bold text-violet-800">Products Enabled</div>
          <div className="mt-2 text-4xl font-black text-violet-950">{metrics.productsEnabled}</div>
          <div className="mt-2 text-sm font-black text-violet-700">Active + trial products</div>
        </div>

        <button
          type="button"
          onClick={() => setActive("Login As Client")}
          className="rounded-[2rem] border border-amber-200/80 bg-amber-50/90 p-6 text-left shadow-[0_18px_55px_rgba(245,158,11,0.14)] transition hover:-translate-y-1"
        >
          <div className="w-fit rounded-2xl bg-white p-3 text-amber-700">
            <Headphones className="h-6 w-6" />
          </div>
          <div className="mt-6 text-sm font-bold text-amber-900">Active Support Sessions</div>
          <div className="mt-2 text-4xl font-black text-amber-950">{metrics.activeSupportSessions}</div>
          <div className="mt-2 text-sm font-black text-amber-800">Operator viewing context</div>
        </button>

        <div className="rounded-[2rem] border border-white/80 bg-white/95 p-6 text-left shadow-[0_18px_55px_rgba(15,23,42,0.14)] backdrop-blur-xl">
          <div className="w-fit rounded-2xl bg-emerald-50 p-3 text-emerald-700">
            <WalletCards className="h-6 w-6" />
          </div>
          <div className="mt-6 text-sm font-bold text-slate-500">MRR</div>
          <div className="mt-2 text-4xl font-black text-[#06101f]">
            R {metrics.mrr.toLocaleString("en-ZA")}
          </div>
          <div className="mt-2 text-sm font-black text-emerald-700">Core + product packages</div>
        </div>

        <div className="rounded-[2rem] border border-cyan-200/80 bg-cyan-50/90 p-6 text-left shadow-[0_18px_55px_rgba(6,182,212,0.12)]">
          <div className="w-fit rounded-2xl bg-white p-3 text-cyan-700">
            <CheckCircle2 className="h-6 w-6" />
          </div>
          <div className="mt-6 text-sm font-bold text-cyan-900">Trial Clients</div>
          <div className="mt-2 text-4xl font-black text-cyan-950">{metrics.trialClients}</div>
          <div className="mt-2 text-sm font-black text-cyan-700">Demo / trial tier</div>
        </div>

        <div className="rounded-[2rem] border border-amber-200/80 bg-amber-50/90 p-6 text-left shadow-[0_18px_55px_rgba(245,158,11,0.14)]">
          <div className="w-fit rounded-2xl bg-white p-3 text-amber-700">
            <AlertTriangle className="h-6 w-6" />
          </div>
          <div className="mt-6 text-sm font-bold text-amber-900">Suspended Clients</div>
          <div className="mt-2 text-4xl font-black text-amber-950">{metrics.suspendedClients}</div>
          <div className="mt-2 text-sm font-black text-amber-800">Access restricted</div>
        </div>
      </section>

      <section className="rounded-[2.2rem] border border-white/70 bg-white/95 p-7 shadow-[0_22px_70px_rgba(15,23,42,0.16)] backdrop-blur-xl">
        <div className="inline-flex rounded-full bg-cyan-100 px-4 py-2 text-xs font-black uppercase tracking-[0.25em] text-cyan-700">
          Product Portfolio
        </div>
        <h2 className="mt-5 text-3xl font-black tracking-tight text-[#06101f]">Product breakdown</h2>
        <p className="mt-3 max-w-3xl text-sm leading-7 text-slate-600">
          Enabled client count per product, plus trial, suspended, and disabled workspace counts.
        </p>

        <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {VYRON_PRODUCT_CODES.map((code) => {
            const breakdown = metrics.productBreakdown[code];
            const enabledClients = metrics.productEnabledClientCounts[code];
            return (
              <div
                key={code}
                className={`rounded-[1.5rem] border p-5 shadow-sm ${productStatusTone(breakdown)}`}
              >
                <div className="text-xs font-black uppercase tracking-[0.28em] text-slate-500">
                  {code}
                </div>
                <div className="mt-2 text-2xl font-black text-slate-950">{enabledClients}</div>
                <div className="text-xs font-bold text-emerald-800">enabled clients</div>
                <div className="mt-3 grid grid-cols-2 gap-2 text-xs font-bold">
                  <div className="rounded-xl bg-white/80 px-3 py-2 text-emerald-800">
                    Enabled: {breakdown.enabled}
                  </div>
                  <div className="rounded-xl bg-white/80 px-3 py-2 text-cyan-800">
                    Trial: {breakdown.trial}
                  </div>
                  <div className="rounded-xl bg-white/80 px-3 py-2 text-amber-800">
                    Suspended: {breakdown.suspended}
                  </div>
                  <div className="rounded-xl bg-white/80 px-3 py-2 text-slate-600">
                    Disabled: {breakdown.disabled}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </section>
    </>
  );
}

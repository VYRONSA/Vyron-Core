"use client";

import React, { useMemo } from "react";
import { WalletCards } from "lucide-react";
import {
  VYRON_PRODUCT_CODES,
  computeClientBillingSummary,
  computeMasterDashboardMetrics,
  computeProductRevenueBreakdown,
  mapDirectoryEntryToDevClient,
  type VyronDevDirectorySourceEntry,
  type VyronDevPlatformState,
} from "@/lib/vyron-dev-platform";
import VyronDevPanel from "./VyronDevPanel";

type Props = {
  entries: VyronDevDirectorySourceEntry[];
  platformState: VyronDevPlatformState;
};

export default function VyronDevBillingPanel({ entries, platformState }: Props) {
  const clients = useMemo(
    () => entries.map((e) => mapDirectoryEntryToDevClient(e, platformState)),
    [entries, platformState]
  );

  const portfolio = useMemo(
    () => computeMasterDashboardMetrics(clients, platformState),
    [clients, platformState]
  );

  const productRevenue = useMemo(
    () => computeProductRevenueBreakdown(clients, platformState),
    [clients, platformState]
  );

  const rows = useMemo(
    () =>
      clients
        .filter((c) => c.status !== "archived")
        .map((client) => ({
          client,
          billing: computeClientBillingSummary(client, platformState),
        })),
    [clients, platformState]
  );

  return (
    <div className="space-y-6">
      <VyronDevPanel>
        <div className="text-xs font-bold uppercase tracking-[0.35em] text-cyan-700">Billing Phase 2</div>
        <h2 className="mt-2 text-2xl font-bold tracking-tight">Portfolio revenue</h2>
        <p className="mt-2 text-sm text-slate-500">
          Subscription status, products enabled, MRR, package value, and trial/suspended product counts.
        </p>

        <div className="mt-6 rounded-[2rem] border border-emerald-200 bg-gradient-to-r from-emerald-50 via-white to-cyan-50 px-6 py-5 shadow-[0_12px_40px_rgba(16,185,129,0.12)]">
          <div className="flex items-center gap-3">
            <div className="rounded-2xl bg-white p-3 text-emerald-700">
              <WalletCards className="h-6 w-6" />
            </div>
            <div>
              <div className="text-[11px] font-black uppercase tracking-[0.28em] text-emerald-800">
                Total MRR
              </div>
              <div className="mt-1 text-3xl font-black text-slate-950">
                R {portfolio.mrr.toLocaleString("en-ZA")}
              </div>
            </div>
          </div>
        </div>
      </VyronDevPanel>

      <VyronDevPanel>
        <h3 className="text-lg font-bold">Product revenue breakdown</h3>
        <p className="mt-2 text-sm text-slate-500">MRR and client counts across all 8 product lines.</p>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {productRevenue.map((row) => (
            <div
              key={row.productCode}
              className="rounded-2xl border border-white/80 bg-white/95 p-4 shadow-sm"
            >
              <div className="text-xs font-black uppercase tracking-[0.28em] text-slate-500">
                {row.productCode}
              </div>
              <div className="mt-2 text-lg font-black text-emerald-800">
                R {row.mrr.toLocaleString("en-ZA")}
              </div>
              <div className="mt-2 space-y-1 text-xs font-semibold text-slate-600">
                <div>Enabled clients: {row.enabledClients}</div>
                <div>Trial: {row.trialClients}</div>
                <div>Suspended: {row.suspendedClients}</div>
              </div>
            </div>
          ))}
        </div>
      </VyronDevPanel>

      <VyronDevPanel>
        <h3 className="text-lg font-bold">Per-client billing</h3>
        <div className="mt-6 overflow-x-auto">
          <table className="w-full min-w-[1000px] text-left text-sm">
            <thead>
              <tr className="text-xs font-black uppercase tracking-[0.2em] text-slate-500">
                <th className="px-4 py-3">Client</th>
                <th className="px-4 py-3">Subscription</th>
                <th className="px-4 py-3">Products Enabled</th>
                <th className="px-4 py-3">Trial Products</th>
                <th className="px-4 py-3">Suspended Products</th>
                <th className="px-4 py-3">Package Value</th>
                <th className="px-4 py-3">Monthly Revenue</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ client, billing }) => (
                <tr key={client.id} className="rounded-2xl bg-white/90 shadow-sm">
                  <td className="px-4 py-4 font-bold text-slate-950">{client.companyName}</td>
                  <td className="px-4 py-4 font-semibold text-slate-700">{billing.subscriptionStatus}</td>
                  <td className="px-4 py-4">{billing.productsEnabled}</td>
                  <td className="px-4 py-4 text-cyan-800">{billing.productsTrial}</td>
                  <td className="px-4 py-4 text-amber-800">{billing.productsSuspended}</td>
                  <td className="px-4 py-4 font-semibold">
                    R {billing.packageValue.toLocaleString("en-ZA")}
                  </td>
                  <td className="px-4 py-4 font-black text-emerald-800">
                    R {billing.monthlyRevenue.toLocaleString("en-ZA")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </VyronDevPanel>

      <VyronDevPanel>
        <h3 className="text-lg font-bold">Product line summary</h3>
        <div className="mt-4 grid gap-2 sm:grid-cols-2 md:grid-cols-4">
          {VYRON_PRODUCT_CODES.map((code) => {
            const count = portfolio.productEnabledClientCounts[code];
            return (
              <div key={code} className="rounded-xl bg-slate-50 px-4 py-3 text-sm">
                <span className="font-black text-slate-950">{code}</span>
                <span className="text-slate-600"> — {count} enabled clients</span>
              </div>
            );
          })}
        </div>
      </VyronDevPanel>
    </div>
  );
}

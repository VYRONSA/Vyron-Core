"use client";

import React, { useMemo, useState } from "react";
import { CheckCircle2, Clock3, Sparkles } from "lucide-react";
import {
  VYRON_INTEGRATION_STATUSES,
  VYRON_PRODUCT_CODES,
  getOrCreateClientIntegration,
  mapDirectoryEntryToDevClient,
  upsertClientIntegration,
  type VyronDevDirectorySourceEntry,
  type VyronDevPlatformState,
  type VyronIntegrationReadiness,
  type VyronProductCode,
} from "@/lib/vyron-dev-platform";
import VyronDevPanel from "./VyronDevPanel";

type Props = {
  entries: VyronDevDirectorySourceEntry[];
  platformState: VyronDevPlatformState;
  onPlatformStateChange: (next: VyronDevPlatformState) => void;
};

function readinessIcon(readiness: VyronIntegrationReadiness) {
  if (readiness === "ready") return <CheckCircle2 className="h-5 w-5 text-emerald-600" />;
  if (readiness === "in_progress") return <Clock3 className="h-5 w-5 text-amber-600" />;
  return <Sparkles className="h-5 w-5 text-slate-500" />;
}

function readinessLabel(readiness: VyronIntegrationReadiness): string {
  if (readiness === "ready") return "Ready";
  if (readiness === "in_progress") return "In Progress";
  return "Planned";
}

function readinessClass(readiness: VyronIntegrationReadiness): string {
  if (readiness === "ready") return "bg-emerald-100 text-emerald-800";
  if (readiness === "in_progress") return "bg-amber-100 text-amber-900";
  return "bg-slate-200 text-slate-700";
}

export default function VyronDevIntegrationsPanel({
  entries,
  platformState,
  onPlatformStateChange,
}: Props) {
  const [clientFilter, setClientFilter] = useState("");
  const [productFilter, setProductFilter] = useState<VyronProductCode | "">("");

  const clients = useMemo(
    () =>
      entries
        .filter((e) => (e.companyStatus || "").toLowerCase() !== "archived")
        .map((e) => mapDirectoryEntryToDevClient(e, platformState)),
    [entries, platformState]
  );

  const rows = useMemo(() => {
    const term = clientFilter.trim().toLowerCase();
    const result: {
      clientId: string;
      clientName: string;
      productCode: VyronProductCode;
      xero: VyronIntegrationReadiness;
      accounting: VyronIntegrationReadiness;
      payroll: VyronIntegrationReadiness;
      property: VyronIntegrationReadiness;
      lastSync: string | null;
      notes: string;
    }[] = [];

    for (const client of clients) {
      if (term && !client.companyName.toLowerCase().includes(term)) continue;
      for (const code of VYRON_PRODUCT_CODES) {
        if (productFilter && code !== productFilter) continue;
        const integration = getOrCreateClientIntegration(platformState, client.id, code);
        result.push({
          clientId: client.id,
          clientName: client.companyName,
          productCode: code,
          xero: integration.xeroReadiness,
          accounting: integration.accountingReadiness,
          payroll: integration.payrollReadiness,
          property: integration.propertyReadiness,
          lastSync: integration.lastSyncAt,
          notes: integration.notes,
        });
      }
    }

    return result.slice(0, 48);
  }, [clients, clientFilter, productFilter, platformState]);

  function handleNotesChange(clientId: string, productCode: VyronProductCode, notes: string) {
    const integration = getOrCreateClientIntegration(platformState, clientId, productCode);
    onPlatformStateChange(
      upsertClientIntegration(platformState, { ...integration, notes })
    );
  }

  return (
    <div className="space-y-6">
      <VyronDevPanel>
        <div className="text-xs font-bold uppercase tracking-[0.35em] text-cyan-700">Integrations</div>
        <h2 className="mt-2 text-2xl font-bold tracking-tight">Integrations readiness</h2>
        <p className="mt-2 text-sm text-slate-500">
          Per client/product: Xero, accounting, payroll, property connectors with last sync and notes. COST and
          PAY show Xero readiness prominently.
        </p>

        <div className="mt-4 grid gap-4 md:grid-cols-2">
          {VYRON_INTEGRATION_STATUSES.map((integration) => (
            <div
              key={integration.id}
              className="rounded-[1.5rem] border border-slate-200 bg-slate-50/90 p-4 shadow-sm"
            >
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="font-black text-slate-950">{integration.name}</div>
                  <div className="mt-1 text-xs font-black uppercase tracking-wider text-slate-500">
                    Platform: {readinessLabel(integration.readiness)}
                  </div>
                </div>
                {readinessIcon(integration.readiness)}
              </div>
              <p className="mt-2 text-xs leading-5 text-slate-600">{integration.notes}</p>
            </div>
          ))}
        </div>
      </VyronDevPanel>

      <VyronDevPanel>
        <div className="flex flex-col gap-4 md:flex-row md:items-end">
          <label className="block text-sm font-bold text-slate-700">
            Filter client
            <input
              value={clientFilter}
              onChange={(e) => setClientFilter(e.target.value)}
              placeholder="Client name…"
              className="mt-2 w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm font-semibold md:w-64"
            />
          </label>
          <label className="block text-sm font-bold text-slate-700">
            Filter product
            <select
              value={productFilter}
              onChange={(e) => setProductFilter(e.target.value as VyronProductCode | "")}
              className="mt-2 w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm font-black text-slate-800 md:w-48"
            >
              <option value="">All products</option>
              {VYRON_PRODUCT_CODES.map((code) => (
                <option key={code} value={code}>
                  {code}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="mt-6 overflow-x-auto">
          <table className="w-full min-w-[1100px] text-left text-sm">
            <thead>
              <tr className="text-xs font-black uppercase tracking-[0.2em] text-slate-500">
                <th className="px-4 py-3">Client</th>
                <th className="px-4 py-3">Product</th>
                <th className="px-4 py-3">Xero</th>
                <th className="px-4 py-3">Accounting</th>
                <th className="px-4 py-3">Payroll</th>
                <th className="px-4 py-3">Property</th>
                <th className="px-4 py-3">Last Sync</th>
                <th className="px-4 py-3">Notes</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const isXeroProduct = row.productCode === "COST" || row.productCode === "PAY";
                return (
                  <tr
                    key={`${row.clientId}-${row.productCode}`}
                    className={`rounded-2xl shadow-sm ${isXeroProduct ? "bg-cyan-50/80" : "bg-white/90"}`}
                  >
                    <td className="px-4 py-4 font-bold text-slate-950">{row.clientName}</td>
                    <td className="px-4 py-4 font-black">
                      {row.productCode}
                      {isXeroProduct && (
                        <span className="ml-2 rounded-full bg-cyan-200 px-2 py-0.5 text-[10px] font-black text-cyan-900">
                          XERO
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-4">
                      <span
                        className={`inline-flex rounded-full px-2 py-1 text-xs font-black ${readinessClass(row.xero)}`}
                      >
                        {readinessLabel(row.xero)}
                      </span>
                    </td>
                    <td className="px-4 py-4">
                      <span
                        className={`inline-flex rounded-full px-2 py-1 text-xs font-black ${readinessClass(row.accounting)}`}
                      >
                        {readinessLabel(row.accounting)}
                      </span>
                    </td>
                    <td className="px-4 py-4">
                      <span
                        className={`inline-flex rounded-full px-2 py-1 text-xs font-black ${readinessClass(row.payroll)}`}
                      >
                        {readinessLabel(row.payroll)}
                      </span>
                    </td>
                    <td className="px-4 py-4">
                      <span
                        className={`inline-flex rounded-full px-2 py-1 text-xs font-black ${readinessClass(row.property)}`}
                      >
                        {readinessLabel(row.property)}
                      </span>
                    </td>
                    <td className="px-4 py-4 text-slate-600">
                      {row.lastSync ? new Date(row.lastSync).toLocaleString("en-ZA") : "—"}
                    </td>
                    <td className="px-4 py-4">
                      <input
                        value={row.notes}
                        onChange={(e) =>
                          handleNotesChange(row.clientId, row.productCode, e.target.value)
                        }
                        placeholder="Notes…"
                        className="w-full min-w-[120px] rounded-xl border border-slate-200 px-2 py-1 text-xs"
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </VyronDevPanel>
    </div>
  );
}

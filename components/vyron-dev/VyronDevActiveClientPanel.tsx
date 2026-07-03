"use client";

import React, { useMemo, useState } from "react";
import { Building2, Headphones, LogIn } from "lucide-react";
import {
  VYRON_PRODUCT_CODES,
  getClientProductStatus,
  mapDirectoryEntryToDevClient,
  productOpenLabel,
  startSupportSession,
  type VyronDevDirectorySourceEntry,
  type VyronDevPlatformState,
  type VyronProductCode,
  type VyronSupportSessionContext,
} from "@/lib/vyron-dev-platform";
import VyronDevPanel from "./VyronDevPanel";

type Props = {
  entries: VyronDevDirectorySourceEntry[];
  platformState: VyronDevPlatformState;
  operatorEmail: string;
  supportSession: VyronSupportSessionContext | null;
  onPlatformStateChange: (next: VyronDevPlatformState) => void;
  onStartSupportSession: (session: VyronSupportSessionContext) => void;
  onEndSupportSession: () => void;
  onOpenProduct: (productCode: VyronProductCode) => void;
};

export default function VyronDevActiveClientPanel({
  entries,
  platformState,
  operatorEmail,
  supportSession,
  onPlatformStateChange,
  onStartSupportSession,
  onEndSupportSession,
  onOpenProduct,
}: Props) {
  const [selectedClientId, setSelectedClientId] = useState<string>("");
  const [selectedProduct, setSelectedProduct] = useState<VyronProductCode>("CORE");

  const liveClients = useMemo(
    () =>
      entries
        .filter((e) => (e.companyStatus || "").toLowerCase() !== "archived")
        .map((e) => mapDirectoryEntryToDevClient(e, platformState)),
    [entries, platformState]
  );

  const selectedClient = liveClients.find((c) => c.id === selectedClientId);

  function handleStartSession() {
    if (!selectedClient) return;
    const { state, session } = startSupportSession(platformState, {
      operator: operatorEmail || "master-operator",
      clientId: selectedClient.id,
      clientName: selectedClient.companyName,
      productCode: selectedProduct,
    });
    onPlatformStateChange(state);
    onStartSupportSession(session);
  }

  return (
    <div className="space-y-6">
      <VyronDevPanel>
        <div className="text-xs font-bold uppercase tracking-[0.35em] text-cyan-700">
          Support Session / Login As Client
        </div>
        <h2 className="mt-2 text-2xl font-bold tracking-tight">Start support session</h2>
        <p className="mt-2 text-sm text-slate-500">
          No auth impersonation — select client and product, then start a support session. Active context
          stored in localStorage with session record in vyron_support_sessions.
        </p>

        <div className="mt-6 grid gap-4 md:grid-cols-2">
          <label className="block text-sm font-bold text-slate-700">
            Select Client
            <select
              value={selectedClientId}
              onChange={(e) => setSelectedClientId(e.target.value)}
              className="mt-2 w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm font-black text-slate-800"
            >
              <option value="">Choose client…</option>
              {liveClients.map((client) => (
                <option key={client.id} value={client.id}>
                  {client.companyName} ({client.clientRef})
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm font-bold text-slate-700">
            Select Product
            <select
              value={selectedProduct}
              onChange={(e) => setSelectedProduct(e.target.value as VyronProductCode)}
              className="mt-2 w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm font-black text-slate-800"
            >
              {VYRON_PRODUCT_CODES.map((code) => (
                <option key={code} value={code}>
                  {code}
                </option>
              ))}
            </select>
          </label>
        </div>

        <button
          type="button"
          disabled={!selectedClientId}
          onClick={handleStartSession}
          className="mt-6 inline-flex items-center gap-2 rounded-2xl bg-[#06101f] px-6 py-3 text-sm font-black text-cyan-300 shadow-lg disabled:opacity-50"
        >
          <Headphones className="h-4 w-4" />
          Start Support Session
        </button>
      </VyronDevPanel>

      {supportSession && (
        <VyronDevPanel dark>
          <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
            <div>
              <div className="text-xs font-bold uppercase tracking-[0.4em] text-amber-300">
                Support Mode: Viewing {supportSession.companyName} / {supportSession.productCode}
              </div>
              <h3 className="mt-3 text-2xl font-black">{supportSession.companyName}</h3>
              <p className="mt-2 text-sm text-slate-300">
                Operator: {supportSession.operator} · Session {supportSession.sessionId}
              </p>
              <p className="mt-2 text-xs text-slate-400">
                Started {new Date(supportSession.startedAt).toLocaleString("en-ZA")}
              </p>
            </div>
            <button
              type="button"
              onClick={onEndSupportSession}
              className="rounded-2xl bg-white/10 px-4 py-3 text-sm font-black text-white hover:bg-white/20"
            >
              End Session
            </button>
          </div>

          <div className="mt-6">
            <button
              type="button"
              onClick={() => onOpenProduct(supportSession.productCode)}
              className="rounded-2xl bg-cyan-500 px-6 py-3 text-sm font-black text-slate-950 hover:bg-cyan-400"
            >
              {productOpenLabel(supportSession.productCode)}
            </button>
          </div>
        </VyronDevPanel>
      )}

      <VyronDevPanel>
        <div className="text-xs font-bold uppercase tracking-[0.35em] text-cyan-700">Quick select</div>
        <h3 className="mt-2 text-lg font-bold">Client cards</h3>
        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {liveClients.map((client) => (
            <button
              key={client.id}
              type="button"
              onClick={() => setSelectedClientId(client.id)}
              className={`rounded-[1.5rem] border p-5 text-left transition hover:-translate-y-0.5 ${
                selectedClientId === client.id
                  ? "border-cyan-300 bg-cyan-50 shadow-lg shadow-cyan-500/10"
                  : "border-white/80 bg-white/95 shadow-sm"
              }`}
            >
              <div className="flex items-center gap-3">
                <div className="rounded-2xl bg-cyan-50 p-2 text-cyan-700">
                  <Building2 className="h-5 w-5" />
                </div>
                <div>
                  <div className="font-black text-slate-950">{client.companyName}</div>
                  <div className="text-xs font-semibold text-slate-500">
                    {client.clientRef} · {client.tradingName}
                  </div>
                </div>
              </div>
              <div className="mt-3 inline-flex items-center gap-1 text-xs font-black text-cyan-800">
                <LogIn className="h-3.5 w-3.5" />
                Select for session
              </div>
            </button>
          ))}
        </div>
      </VyronDevPanel>

      {platformState.supportSessions.length > 0 && (
        <VyronDevPanel>
          <h3 className="text-lg font-bold">Session history</h3>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[700px] text-left text-sm">
              <thead>
                <tr className="text-xs font-black uppercase tracking-[0.2em] text-slate-500">
                  <th className="px-4 py-3">Session ID</th>
                  <th className="px-4 py-3">Operator</th>
                  <th className="px-4 py-3">Client</th>
                  <th className="px-4 py-3">Product</th>
                  <th className="px-4 py-3">Started</th>
                  <th className="px-4 py-3">Ended</th>
                  <th className="px-4 py-3">Status</th>
                </tr>
              </thead>
              <tbody>
                {[...platformState.supportSessions].reverse().slice(0, 10).map((s) => (
                  <tr key={s.sessionId} className="rounded-2xl bg-white/90 shadow-sm">
                    <td className="px-4 py-4 font-mono text-xs">{s.sessionId.slice(-12)}</td>
                    <td className="px-4 py-4">{s.operator}</td>
                    <td className="px-4 py-4 font-bold">{s.clientName}</td>
                    <td className="px-4 py-4">{s.productCode}</td>
                    <td className="px-4 py-4 text-slate-600">
                      {new Date(s.startedAt).toLocaleString("en-ZA")}
                    </td>
                    <td className="px-4 py-4 text-slate-600">
                      {s.endedAt ? new Date(s.endedAt).toLocaleString("en-ZA") : "—"}
                    </td>
                    <td className="px-4 py-4 capitalize">{s.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </VyronDevPanel>
      )}
    </div>
  );
}

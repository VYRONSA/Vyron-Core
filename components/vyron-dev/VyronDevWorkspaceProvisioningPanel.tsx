"use client";

import React, { useMemo, useState } from "react";
import {
  createProductWorkspace,
  mapDirectoryEntryToDevClient,
  openProductWorkspace,
  rebuildProductWorkspace,
  suspendProductWorkspace,
  type VyronDevDirectorySourceEntry,
  type VyronDevPlatformState,
  type VyronProductCode,
} from "@/lib/vyron-dev-platform";
import VyronDevPanel from "./VyronDevPanel";

type Props = {
  entries: VyronDevDirectorySourceEntry[];
  platformState: VyronDevPlatformState;
  onPlatformStateChange: (next: VyronDevPlatformState) => void;
  onOpenWorkspace?: (clientId: string, productCode: VyronProductCode) => void;
};

function workspaceStatusClass(status: string): string {
  if (status === "active") return "bg-emerald-100 text-emerald-800";
  if (status === "trial") return "bg-cyan-100 text-cyan-800";
  if (status === "provisioning" || status === "rebuilding") return "bg-violet-100 text-violet-900";
  return "bg-amber-100 text-amber-900";
}

export default function VyronDevWorkspaceProvisioningPanel({
  entries,
  platformState,
  onPlatformStateChange,
  onOpenWorkspace,
}: Props) {
  const [clientFilter, setClientFilter] = useState("");

  const clients = useMemo(
    () => entries.map((e) => mapDirectoryEntryToDevClient(e, platformState)),
    [entries, platformState]
  );

  const rows = useMemo(() => {
    const term = clientFilter.trim().toLowerCase();
    const workspaces = platformState.productWorkspaces
      .map((ws) => {
        const client = clients.find((c) => c.id === ws.clientId);
        if (!client) return null;
        if (term && !client.companyName.toLowerCase().includes(term)) return null;
        return { ws, client };
      })
      .filter(Boolean) as { ws: (typeof platformState.productWorkspaces)[0]; client: (typeof clients)[0] }[];

    return workspaces.sort(
      (a, b) => new Date(b.ws.updatedAt).getTime() - new Date(a.ws.updatedAt).getTime()
    );
  }, [platformState.productWorkspaces, clients, clientFilter]);

  function handleCreate(clientId: string, productCode: VyronProductCode) {
    onPlatformStateChange(createProductWorkspace(platformState, clientId, productCode));
  }

  function handleRebuild(clientId: string, productCode: VyronProductCode) {
    onPlatformStateChange(rebuildProductWorkspace(platformState, clientId, productCode));
  }

  function handleSuspend(clientId: string, productCode: VyronProductCode) {
    onPlatformStateChange(suspendProductWorkspace(platformState, clientId, productCode));
  }

  function handleOpen(clientId: string, productCode: VyronProductCode) {
    onPlatformStateChange(openProductWorkspace(platformState, clientId, productCode));
    onOpenWorkspace?.(clientId, productCode);
  }

  return (
    <VyronDevPanel>
      <div className="text-xs font-bold uppercase tracking-[0.35em] text-cyan-700">
        Workspace Provisioning
      </div>
      <h2 className="mt-2 text-2xl font-bold tracking-tight">Product workspaces</h2>
      <p className="mt-2 text-sm text-slate-500">
        vyron_product_workspaces — create, rebuild, suspend, and open tenant workspaces per client product.
      </p>

      <input
        value={clientFilter}
        onChange={(e) => setClientFilter(e.target.value)}
        placeholder="Filter by client…"
        className="mt-6 w-full rounded-2xl border border-white/80 bg-white/80 px-4 py-3 text-sm font-semibold shadow-sm backdrop-blur-xl outline-none focus:border-cyan-400 md:max-w-md"
      />

      <div className="mt-6 overflow-x-auto">
        <table className="w-full min-w-[1100px] text-left text-sm">
          <thead>
            <tr className="text-xs font-black uppercase tracking-[0.2em] text-slate-500">
              <th className="px-4 py-3">Client</th>
              <th className="px-4 py-3">Product</th>
              <th className="px-4 py-3">Workspace ID</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Package</th>
              <th className="px-4 py-3">Created Date</th>
              <th className="px-4 py-3">Last Opened</th>
              <th className="px-4 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={8} className="rounded-2xl bg-slate-50 px-4 py-8 text-center font-semibold text-slate-500">
                  No workspace records yet. Enable a product for a client to create one.
                </td>
              </tr>
            ) : (
              rows.map(({ ws, client }) => (
                <tr key={ws.id} className="rounded-2xl bg-white/90 shadow-sm">
                  <td className="px-4 py-4 font-bold text-slate-950">{client.companyName}</td>
                  <td className="px-4 py-4 font-black text-slate-800">{ws.productCode}</td>
                  <td className="px-4 py-4 font-mono text-xs text-slate-600">{ws.workspaceId}</td>
                  <td className="px-4 py-4">
                    <span
                      className={`inline-flex rounded-full px-3 py-1 text-xs font-black uppercase tracking-wider ${workspaceStatusClass(ws.workspaceStatus)}`}
                    >
                      {ws.workspaceStatus}
                    </span>
                  </td>
                  <td className="px-4 py-4 text-slate-700">{ws.packageName ?? "—"}</td>
                  <td className="px-4 py-4 text-slate-600">
                    {new Date(ws.createdAt).toLocaleDateString("en-ZA")}
                  </td>
                  <td className="px-4 py-4 text-slate-600">
                    {ws.lastOpenedAt
                      ? new Date(ws.lastOpenedAt).toLocaleString("en-ZA")
                      : "—"}
                  </td>
                  <td className="px-4 py-4 text-right">
                    <div className="flex flex-wrap justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => handleCreate(client.id, ws.productCode)}
                        className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-black text-emerald-900"
                      >
                        Create
                      </button>
                      <button
                        type="button"
                        onClick={() => handleRebuild(client.id, ws.productCode)}
                        className="rounded-xl border border-violet-200 bg-violet-50 px-3 py-2 text-xs font-black text-violet-900"
                      >
                        Rebuild
                      </button>
                      <button
                        type="button"
                        onClick={() => handleSuspend(client.id, ws.productCode)}
                        className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-black text-amber-900"
                      >
                        Suspend
                      </button>
                      <button
                        type="button"
                        onClick={() => handleOpen(client.id, ws.productCode)}
                        className="rounded-xl border border-cyan-200 bg-cyan-50 px-3 py-2 text-xs font-black text-cyan-900"
                      >
                        Open Workspace
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </VyronDevPanel>
  );
}

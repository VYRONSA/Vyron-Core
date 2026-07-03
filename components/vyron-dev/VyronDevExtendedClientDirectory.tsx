"use client";

import React, { useMemo, useState } from "react";
import { Copy, Plus, Trash2 } from "lucide-react";
import {
  mapDirectoryEntryToDevClient,
  upsertClientProfile,
  type VyronDevDirectorySourceEntry,
  type VyronDevPlatformState,
} from "@/lib/vyron-dev-platform";
import VyronDevPanel from "./VyronDevPanel";
import VyronDevClientWorkspacePanel from "./VyronDevClientWorkspacePanel";
import type { VyronProductCode } from "@/lib/vyron-dev-platform";

type Props = {
  entries: VyronDevDirectorySourceEntry[];
  platformState: VyronDevPlatformState;
  onPlatformStateChange: (next: VyronDevPlatformState) => void;
  onCreateClient?: () => void;
  onEditClient?: (entry: VyronDevDirectorySourceEntry) => void;
  onSuspendClient?: (entry: VyronDevDirectorySourceEntry) => void | Promise<void>;
  onDeleteClient?: (entry: VyronDevDirectorySourceEntry) => void | Promise<void>;
  onCloneDemoClient?: (entry: VyronDevDirectorySourceEntry) => void | Promise<void>;
  onOpenClientDetail?: (entry: VyronDevDirectorySourceEntry) => void;
  onOpenProduct: (clientId: string, productCode: VyronProductCode) => void;
};

function statusClass(status: string): string {
  if (status === "archived") return "bg-slate-200 text-slate-700";
  if (status === "suspended") return "bg-amber-100 text-amber-900";
  if (status === "trial") return "bg-cyan-100 text-cyan-900";
  return "bg-emerald-100 text-emerald-900";
}

export default function VyronDevExtendedClientDirectory({
  entries,
  platformState,
  onPlatformStateChange,
  onCreateClient,
  onEditClient,
  onSuspendClient,
  onDeleteClient,
  onCloneDemoClient,
  onOpenClientDetail,
  onOpenProduct,
}: Props) {
  const [search, setSearch] = useState("");
  const [expandedClientId, setExpandedClientId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<{
    clientId: string;
    tradingName: string;
    industry: string;
  } | null>(null);

  const clients = useMemo(
    () => entries.map((e) => mapDirectoryEntryToDevClient(e, platformState)),
    [entries, platformState]
  );

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return clients;
    return clients.filter((c) =>
      [c.companyName, c.tradingName, c.email, c.industry, c.primaryContact, c.phone]
        .join(" ")
        .toLowerCase()
        .includes(term)
    );
  }, [clients, search]);

  async function runAction(
    id: string,
    action: (entry: VyronDevDirectorySourceEntry) => void | Promise<void>
  ) {
    const entry = entries.find((e) => e.id === id);
    if (!entry) return;
    setBusyId(id);
    try {
      await action(entry);
    } finally {
      setBusyId(null);
    }
  }

  function handleInlineEditSave() {
    if (!editDraft) return;
    const profile = platformState.clientProfiles[editDraft.clientId];
    const next = upsertClientProfile(platformState, {
      clientId: editDraft.clientId,
      tradingName: editDraft.tradingName.trim(),
      industry: editDraft.industry.trim() || "General",
      status: profile?.status ?? "active",
      activeUserCount: profile?.activeUserCount ?? 1,
      updatedAt: new Date().toISOString(),
    });
    onPlatformStateChange(next);
    setEditDraft(null);
  }

  return (
    <div className="space-y-6">
      <VyronDevPanel>
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div>
            <div className="text-xs font-bold uppercase tracking-[0.35em] text-cyan-700">Platform Control</div>
            <h2 className="mt-2 text-2xl font-bold tracking-tight">Client Directory</h2>
            <p className="mt-2 text-sm text-slate-500">
              Company register with trading names, contacts, product workspaces, and master actions.
            </p>
          </div>
          {onCreateClient && (
            <button
              type="button"
              onClick={onCreateClient}
              className="inline-flex items-center gap-2 rounded-2xl bg-[#06101f] px-5 py-3 text-sm font-black text-cyan-300 shadow-lg"
            >
              <Plus className="h-4 w-4" />
              Create Client
            </button>
          )}
        </div>

        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search clients…"
          className="mt-6 w-full rounded-2xl border border-white/80 bg-white/80 px-4 py-3 text-sm font-semibold shadow-sm backdrop-blur-xl outline-none focus:border-cyan-400 md:max-w-md"
        />

        <div className="mt-6 overflow-x-auto">
          <table className="w-full min-w-[1200px] text-left text-sm">
            <thead>
              <tr className="text-xs font-black uppercase tracking-[0.2em] text-slate-500">
                <th className="px-4 py-3">Company Name</th>
                <th className="px-4 py-3">Trading Name</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Industry</th>
                <th className="px-4 py-3">Primary Contact</th>
                <th className="px-4 py-3">Email</th>
                <th className="px-4 py-3">Phone</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={8} className="rounded-2xl bg-slate-50 px-4 py-8 text-center font-semibold text-slate-500">
                    No clients match your search.
                  </td>
                </tr>
              ) : (
                filtered.map((client) => (
                  <React.Fragment key={client.id}>
                    <tr className="rounded-2xl bg-white/90 shadow-sm">
                      <td
                        className={`px-4 py-4 font-bold text-slate-950 ${onOpenClientDetail ? "cursor-pointer hover:bg-slate-50/80" : ""}`}
                        onClick={() => onOpenClientDetail?.(entries.find((e) => e.id === client.id)!)}
                      >
                        {client.companyName}
                      </td>
                      <td className="px-4 py-4 text-slate-700">{client.tradingName}</td>
                      <td className="px-4 py-4">
                        <span
                          className={`inline-flex rounded-full px-3 py-1 text-xs font-black uppercase tracking-wider ${statusClass(client.status)}`}
                        >
                          {client.status}
                        </span>
                      </td>
                      <td className="px-4 py-4 text-slate-700">{client.industry}</td>
                      <td className="px-4 py-4 text-slate-700">{client.primaryContact}</td>
                      <td className="px-4 py-4 text-slate-700">{client.email}</td>
                      <td className="px-4 py-4 text-slate-700">{client.phone}</td>
                      <td className="px-4 py-4 text-right">
                        <div className="flex flex-wrap justify-end gap-2">
                          <button
                            type="button"
                            onClick={() =>
                              setExpandedClientId((cur) => (cur === client.id ? null : client.id))
                            }
                            className="rounded-xl border border-violet-200 bg-violet-50 px-3 py-2 text-xs font-black text-violet-900"
                          >
                            {expandedClientId === client.id ? "Hide Products" : "Products"}
                          </button>
                          {onOpenClientDetail && (
                            <button
                              type="button"
                              onClick={() => onOpenClientDetail(entries.find((e) => e.id === client.id)!)}
                              className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-black text-slate-800"
                            >
                              Open Detail
                            </button>
                          )}
                          {onEditClient && (
                            <button
                              type="button"
                              onClick={() => {
                                setEditDraft({
                                  clientId: client.id,
                                  tradingName: client.tradingName,
                                  industry: client.industry,
                                });
                                onEditClient(entries.find((e) => e.id === client.id)!);
                              }}
                              className="rounded-xl border border-cyan-200 bg-cyan-50 px-3 py-2 text-xs font-black text-cyan-900"
                            >
                              Edit
                            </button>
                          )}
                          {onSuspendClient && client.status !== "archived" && (
                            <button
                              type="button"
                              disabled={busyId === client.id}
                              onClick={() => void runAction(client.id, onSuspendClient)}
                              className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-black text-amber-900 disabled:opacity-50"
                            >
                              {busyId === client.id ? "…" : "Suspend"}
                            </button>
                          )}
                          {onCloneDemoClient && (
                            <button
                              type="button"
                              disabled={busyId === client.id}
                              onClick={() => void runAction(client.id, onCloneDemoClient)}
                              className="inline-flex items-center gap-1 rounded-xl border border-cyan-200 bg-white px-3 py-2 text-xs font-black text-cyan-900 disabled:opacity-50"
                            >
                              <Copy className="h-3.5 w-3.5" />
                              Clone Demo
                            </button>
                          )}
                          {onDeleteClient && (
                            <button
                              type="button"
                              disabled={busyId === client.id}
                              onClick={() => void runAction(client.id, onDeleteClient)}
                              className="inline-flex items-center gap-1 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-black text-rose-900 disabled:opacity-50"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                              Delete
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                    {expandedClientId === client.id && (
                      <tr>
                        <td colSpan={8} className="px-4 pb-6">
                          <VyronDevClientWorkspacePanel
                            client={client}
                            platformState={platformState}
                            onPlatformStateChange={onPlatformStateChange}
                            onOpenProduct={(code) => onOpenProduct(client.id, code)}
                          />
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                ))
              )}
            </tbody>
          </table>
        </div>
      </VyronDevPanel>

      {editDraft && (
        <VyronDevPanel>
          <div className="text-xs font-bold uppercase tracking-[0.35em] text-cyan-700">Quick Edit</div>
          <h3 className="mt-2 text-lg font-bold">Trading name &amp; industry</h3>
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <label className="block text-sm font-bold text-slate-700">
              Trading Name
              <input
                value={editDraft.tradingName}
                onChange={(e) => setEditDraft({ ...editDraft, tradingName: e.target.value })}
                className="mt-2 w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm font-semibold"
              />
            </label>
            <label className="block text-sm font-bold text-slate-700">
              Industry
              <input
                value={editDraft.industry}
                onChange={(e) => setEditDraft({ ...editDraft, industry: e.target.value })}
                className="mt-2 w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm font-semibold"
              />
            </label>
          </div>
          <div className="mt-4 flex gap-3">
            <button
              type="button"
              onClick={handleInlineEditSave}
              className="rounded-2xl bg-emerald-600 px-5 py-3 text-sm font-black text-white"
            >
              Save Profile
            </button>
            <button
              type="button"
              onClick={() => setEditDraft(null)}
              className="rounded-2xl border border-slate-200 bg-white px-5 py-3 text-sm font-black text-slate-700"
            >
              Cancel
            </button>
          </div>
        </VyronDevPanel>
      )}
    </div>
  );
}

"use client";

import React, { useEffect, useState } from "react";
import { Cloud, CloudOff, RefreshCcw } from "lucide-react";
import {
  flushOfflineQueue,
  getOfflineQueueStatus,
  readLastSyncTime,
  type OfflineQueueStatus,
} from "@/lib/mobile-workforce-offline";
import { supabase } from "@/lib/supabase";

type Props = {
  onSynced?: () => void;
};

function formatSyncTime(iso: string | null): string {
  if (!iso) return "Never";
  try {
    return new Date(iso).toLocaleString("en-ZA", {
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

export default function MobileOfflineSyncBar({ onSynced }: Props) {
  const [status, setStatus] = useState<OfflineQueueStatus>(() => getOfflineQueueStatus());
  const [syncing, setSyncing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  function refreshStatus() {
    setStatus(getOfflineQueueStatus());
  }

  useEffect(() => {
    refreshStatus();
    function onOnline() {
      void handleSync();
    }
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, []);

  async function handleSync() {
    setSyncing(true);
    setMessage(null);
    const result = await flushOfflineQueue(supabase);
    refreshStatus();
    setSyncing(false);
    if (result.synced > 0) {
      setMessage(`Synced ${result.synced} action(s).`);
      onSynced?.();
    } else if (result.failed > 0) {
      setMessage(`${result.failed} item(s) still pending.`);
    } else if (status.pending === 0) {
      setMessage("All caught up.");
    }
  }

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          {status.online ? (
            <Cloud className="h-5 w-5 text-emerald-600" />
          ) : (
            <CloudOff className="h-5 w-5 text-amber-600" />
          )}
          <div>
            <div className="text-xs font-black uppercase tracking-wider text-slate-500">
              Sync Status
            </div>
            <div className="text-sm font-bold text-slate-900">
              {status.online ? "Online" : "Offline"} · Pending: {status.pending}
            </div>
            <div className="text-xs font-semibold text-slate-500">
              Last sync: {formatSyncTime(readLastSyncTime())}
            </div>
          </div>
        </div>
        <button
          type="button"
          disabled={syncing || !status.online}
          onClick={() => void handleSync()}
          className="inline-flex items-center gap-2 rounded-xl bg-[#06101f] px-4 py-2 text-xs font-black text-cyan-300 disabled:opacity-50"
        >
          <RefreshCcw className={`h-3.5 w-3.5 ${syncing ? "animate-spin" : ""}`} />
          {syncing ? "Syncing…" : "Sync now"}
        </button>
      </div>
      {message ? (
        <p className="mt-3 text-xs font-semibold text-cyan-800">{message}</p>
      ) : null}
    </div>
  );
}

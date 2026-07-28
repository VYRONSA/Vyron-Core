"use client";

import React from "react";
import {
  Building2,
  History,
  PauseCircle,
  Rocket,
  ShieldCheck,
  UserCog,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import { platformFetch } from "@/lib/platform/platform-client";
import PlatformPanel from "./PlatformPanel";

type ActivityItem = {
  key: string;
  label: string;
  available: boolean;
  at: string | null;
  operator: string | null;
  detail: string | null;
};

const ICONS: Record<string, LucideIcon> = {
  lastPlatformLogin: ShieldCheck,
  lastCustomerCreated: Building2,
  lastSuspension: PauseCircle,
  lastImpersonation: UserCog,
  lastRelease: Rocket,
  lastMaintenanceWindow: Wrench,
};

/** Compact relative time — "4m ago", "3h ago", "2d ago". */
function relativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

export default function PlatformRecentActivity() {
  const [items, setItems] = React.useState<ActivityItem[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    async function load() {
      const result = await platformFetch<{ activity: ActivityItem[] }>("/api/platform/activity");
      if (cancelled) return;
      if (result.ok) setItems(result.data.activity || []);
      else setError(result.message);
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <PlatformPanel>
      <div className="flex items-center gap-2">
        <History className="h-5 w-5 text-cyan-700" />
        <h3 className="text-lg font-black text-[#06101f]">Recent Platform Activity</h3>
      </div>

      {error ? (
        <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-bold text-amber-800">
          {error}
        </div>
      ) : !items ? (
        <div className="mt-4 text-sm font-bold text-slate-500">Loading activity…</div>
      ) : (
        <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {items.map((item) => {
            const Icon = ICONS[item.key] || History;
            return (
              <div
                key={item.key}
                className="rounded-2xl border border-slate-200 bg-white/70 p-4 shadow-[0_10px_30px_rgba(15,23,42,0.05)]"
              >
                <div className="flex items-center gap-2">
                  <span className="rounded-xl bg-slate-100 p-2 text-slate-600">
                    <Icon className="h-4 w-4" />
                  </span>
                  <span className="text-[11px] font-black uppercase tracking-wider text-slate-500">
                    {item.label}
                  </span>
                </div>

                {!item.available ? (
                  <div className="mt-3 text-sm font-bold text-amber-700">Audit log unavailable</div>
                ) : item.at ? (
                  <>
                    <div className="mt-3 text-lg font-black text-[#06101f]">{relativeTime(item.at)}</div>
                    <div className="mt-1 truncate text-xs font-bold text-slate-500" title={item.operator || ""}>
                      {item.detail || item.operator || "—"}
                    </div>
                    <div className="mt-0.5 text-[11px] font-medium text-slate-400">
                      {new Date(item.at).toLocaleString()}
                    </div>
                  </>
                ) : (
                  // Genuinely never happened — distinct from "audit log unavailable".
                  <div className="mt-3 text-sm font-bold text-slate-400">No record yet</div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </PlatformPanel>
  );
}

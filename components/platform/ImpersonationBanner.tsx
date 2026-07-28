"use client";

import React, { useEffect, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { platformFetch } from "@/lib/platform/platform-client";

type ActiveImpersonation = {
  sessionToken: string;
  companyId: string;
  companyName: string;
  operatorEmail: string;
  startedAt: string;
};

export default function ImpersonationBanner() {
  const [session, setSession] = useState<ActiveImpersonation | null>(null);
  const [ending, setEnding] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const result = await platformFetch<{ impersonating: ActiveImpersonation | null }>(
        "/api/platform/support/impersonate"
      );
      if (!cancelled && result.ok) setSession(result.data.impersonating);
    }
    load();
    const interval = setInterval(load, 30_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  async function handleEnd() {
    if (!session) return;
    setEnding(true);
    const result = await platformFetch(
      `/api/platform/support/impersonate?sessionToken=${session.sessionToken}`,
      { method: "DELETE" }
    );
    setEnding(false);
    if (result.ok) setSession(null);
  }

  if (!session) return null;

  return (
    <div className="sticky top-0 z-50 flex flex-wrap items-center justify-between gap-3 bg-amber-500 px-4 py-2 text-sm font-bold text-[#3a2500]">
      <span className="flex items-center gap-2">
        <AlertTriangle className="h-4 w-4" />
        Viewing as <strong>{session.companyName}</strong> — operator {session.operatorEmail}, started{" "}
        {new Date(session.startedAt).toLocaleTimeString()}
      </span>
      <button
        type="button"
        onClick={handleEnd}
        disabled={ending}
        className="rounded-full bg-[#3a2500] px-4 py-1.5 text-xs font-black text-white disabled:opacity-60"
      >
        {ending ? "Ending…" : "End Impersonation"}
      </button>
    </div>
  );
}

"use client";

import React from "react";
import { Headphones, X } from "lucide-react";
import { productOpenLabel, type VyronSupportSessionContext } from "@/lib/vyron-dev-platform";

type Props = {
  session: VyronSupportSessionContext;
  onEndSession: () => void;
  onReturnToVyronDev: () => void;
  onOpenProduct: () => void;
};

export default function VyronDevSupportSessionBanner({
  session,
  onEndSession,
  onReturnToVyronDev,
  onOpenProduct,
}: Props) {
  return (
    <div className="mb-4 rounded-2xl border border-amber-300 bg-gradient-to-r from-amber-50 via-orange-50 to-amber-50 px-5 py-4 shadow-[0_8px_30px_rgba(245,158,11,0.15)]">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="flex items-start gap-3">
          <div className="rounded-xl bg-amber-200/80 p-2 text-amber-900">
            <Headphones className="h-5 w-5" />
          </div>
          <div>
            <div className="text-xs font-black uppercase tracking-[0.28em] text-amber-800">
              Support Mode
            </div>
            <div className="mt-1 text-sm font-black text-slate-950">
              Viewing {session.companyName} / {session.productCode}
            </div>
            <div className="mt-1 text-xs font-semibold text-slate-600">
              Operator: {session.operator} · Session {session.sessionId.slice(-8)}
            </div>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={onOpenProduct}
            className="rounded-xl bg-cyan-600 px-4 py-2 text-xs font-black text-white hover:bg-cyan-500"
          >
            {productOpenLabel(session.productCode)}
          </button>
          <button
            type="button"
            onClick={onReturnToVyronDev}
            className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-xs font-black text-slate-800 hover:bg-slate-50"
          >
            Return to VYRON DEV
          </button>
          <button
            type="button"
            onClick={onEndSession}
            className="inline-flex items-center gap-1 rounded-xl border border-amber-300 bg-white px-4 py-2 text-xs font-black text-amber-900 hover:bg-amber-50"
          >
            <X className="h-3.5 w-3.5" />
            Exit Client Mode
          </button>
        </div>
      </div>
    </div>
  );
}

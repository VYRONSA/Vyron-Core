"use client";

import { useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { UmoraMark } from "@/components/brand/UmoraBrand";
import { productBrand } from "@/lib/brand";

export default function InvitePage() {
  const params = useSearchParams();

  useEffect(() => {
    const query = params.toString();
    const hash = typeof window !== "undefined" ? window.location.hash : "";
    const next = query ? `/signup?${query}${hash}` : `/signup${hash}`;
    window.location.replace(next);
  }, [params]);

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#f6f8fb] p-6 text-slate-950">
      <div className="flex flex-col items-center rounded-[22px] bg-white p-8 text-center shadow-[0_20px_60px_rgba(16,42,76,0.1)]">
        <UmoraMark size={40} />
        <div className="umora-sans mt-3 text-xs font-bold uppercase tracking-[0.3em] text-emerald-700">{productBrand.mark}</div>
        <div className="mt-3 text-lg font-bold">Opening your invitation...</div>
      </div>
    </main>
  );
}

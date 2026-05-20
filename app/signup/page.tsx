"use client";

import { useEffect } from "react";
import { useSearchParams } from "next/navigation";

/** Corporate invite entry — forwards to root auth with the same query params. */
export default function SignupInvitePage() {
  const searchParams = useSearchParams();

  useEffect(() => {
    const query = searchParams.toString();
    const base = query ? `/?${query}` : "/";
    // Preserve #access_token / #refresh_token from Supabase email confirmation — searchParams omits the hash.
    const hash = typeof window !== "undefined" ? window.location.hash : "";
    window.location.replace(`${base}${hash}`);
  }, [searchParams]);

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#f6f8fb] p-6 text-slate-950">
      <div className="rounded-[28px] bg-white p-8 text-center shadow-[0_20px_60px_rgba(15,23,42,0.12)]">
        <div className="text-xs font-bold uppercase tracking-[0.3em] text-cyan-700">VYRON CORE</div>
        <div className="mt-3 text-lg font-bold">Opening your invitation...</div>
      </div>
    </main>
  );
}

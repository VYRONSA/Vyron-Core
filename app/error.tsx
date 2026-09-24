"use client";

import { productBrand } from "@/lib/brand";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="min-h-screen bg-[linear-gradient(135deg,#03161a_0%,#04201b_55%,#073a30_100%)] p-6 text-white">
      <div className="mx-auto flex min-h-[70vh] max-w-5xl items-center justify-center">
        <div className="rounded-[22px] border border-rose-300/20 bg-white/10 p-8 text-center shadow-2xl backdrop-blur-xl">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-3xl bg-rose-500/20 text-2xl">!</div>
          <h1 className="mt-6 text-3xl font-black tracking-tight">Something went wrong</h1>
          <p className="mt-3 max-w-2xl text-sm text-slate-300">
            {productBrand.name} caught this safely instead of crashing the whole browser view.
          </p>
          <p className="mt-4 rounded-2xl bg-black/20 p-4 text-left text-xs text-slate-300">
            {error.message}
          </p>
          <button
            onClick={reset}
            className="mt-6 rounded-xl bg-gradient-to-b from-[#fad66a] to-[#eaa93b] px-5 py-3 text-sm font-bold text-[#2a1d05]"
          >
            Try again
          </button>
        </div>
      </div>
    </main>
  );
}

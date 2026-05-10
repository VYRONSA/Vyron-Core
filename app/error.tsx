"use client";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="min-h-screen bg-[#07101f] p-6 text-white">
      <div className="mx-auto flex min-h-[70vh] max-w-5xl items-center justify-center">
        <div className="rounded-[34px] border border-rose-300/20 bg-white/10 p-8 text-center shadow-2xl backdrop-blur-xl">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-3xl bg-rose-500/20 text-2xl">!</div>
          <h1 className="mt-6 text-3xl font-black tracking-tight">Something went wrong</h1>
          <p className="mt-3 max-w-2xl text-sm text-slate-300">
            VYRON CORE caught this safely instead of crashing the whole browser view.
          </p>
          <p className="mt-4 rounded-2xl bg-black/20 p-4 text-left text-xs text-slate-300">
            {error.message}
          </p>
          <button
            onClick={reset}
            className="mt-6 rounded-2xl bg-white px-5 py-3 text-sm font-black text-slate-950"
          >
            Try again
          </button>
        </div>
      </div>
    </main>
  );
}

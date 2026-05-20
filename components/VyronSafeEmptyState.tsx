"use client";

export default function VyronSafeEmptyState({
  title,
  message,
}: {
  title: string;
  message: string;
}) {
  return (
    <div className="vyron-empty-state">
      <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-[#06101f] text-cyan-300 shadow-lg shadow-cyan-950/15 ring-1 ring-white/10">
        <span className="text-lg font-black">—</span>
      </div>
      <div className="mt-4 text-lg font-black tracking-tight text-slate-950">{title}</div>
      <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-slate-500">{message}</p>
    </div>
  );
}

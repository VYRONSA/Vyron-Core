export default function Loading() {
  return (
    <main className="min-h-screen bg-[linear-gradient(135deg,#03161a_0%,#04201b_55%,#073a30_100%)] p-6 text-white">
      <div className="mx-auto flex min-h-[70vh] max-w-5xl items-center justify-center">
        <div className="rounded-[22px] border border-emerald-300/15 bg-white/10 p-8 text-center shadow-2xl backdrop-blur-xl">
          <div className="mx-auto h-12 w-12 animate-spin rounded-full border-4 border-emerald-300/25 border-t-[#4fe3a1]" />
          <h1 className="mt-6 text-2xl font-black tracking-tight">Loading UMORA</h1>
          <p className="mt-3 text-sm text-slate-300">Preparing your workforce command centre…</p>
        </div>
      </div>
    </main>
  );
}

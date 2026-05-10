export default function Loading() {
  return (
    <main className="min-h-screen bg-[#07101f] p-6 text-white">
      <div className="mx-auto flex min-h-[70vh] max-w-5xl items-center justify-center">
        <div className="rounded-[34px] border border-cyan-300/15 bg-white/10 p-8 text-center shadow-2xl backdrop-blur-xl">
          <div className="mx-auto h-12 w-12 animate-spin rounded-full border-4 border-cyan-300/30 border-t-cyan-300" />
          <h1 className="mt-6 text-2xl font-black tracking-tight">Loading VYRON CORE</h1>
          <p className="mt-3 text-sm text-slate-300">Preparing your workforce command centre...</p>
        </div>
      </div>
    </main>
  );
}

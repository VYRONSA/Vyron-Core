export default function NotFound() {
  return (
    <main className="min-h-screen bg-[#07101f] p-6 text-white">
      <div className="mx-auto flex min-h-[70vh] max-w-5xl items-center justify-center">
        <div className="rounded-[34px] border border-cyan-300/15 bg-white/10 p-8 text-center shadow-2xl backdrop-blur-xl">
          <h1 className="text-4xl font-black tracking-tight">Page not found</h1>
          <p className="mt-3 text-sm text-slate-300">This VYRON CORE route does not exist yet.</p>
        </div>
      </div>
    </main>
  );
}

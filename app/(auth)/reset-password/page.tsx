import Link from "next/link";

export default function ResetPasswordPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-[#f6f8fb] p-6 text-slate-950">
      <div className="w-full max-w-xl rounded-[28px] bg-white p-8 shadow-[0_20px_60px_rgba(15,23,42,0.12)]">
        <div className="text-xs font-bold uppercase tracking-[0.3em] text-cyan-700">VYRON CORE</div>
        <h1 className="mt-3 text-3xl font-black tracking-tight">Set a new password</h1>
        <p className="mt-3 text-sm leading-6 text-slate-600">
          Continue from your secure recovery link, then return to login and access your workspace.
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          <Link href="/login" className="rounded-2xl bg-[#06101f] px-5 py-3 text-sm font-black text-cyan-300">
            Return to Login
          </Link>
          <Link href="/forgot-password" className="rounded-2xl bg-slate-100 px-5 py-3 text-sm font-bold text-slate-700">
            Recovery help
          </Link>
        </div>
      </div>
    </main>
  );
}

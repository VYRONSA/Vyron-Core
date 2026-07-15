"use client";

import { useState } from "react";
import Link from "next/link";
import { getSupabaseBrowserClient } from "@/lib/supabase";

/** Generic copy regardless of outcome — never reveals whether an email is registered. */
const GENERIC_SENT_MESSAGE =
  "If that email is registered with VYRON CORE, a password reset link is on its way. Check your inbox (and spam folder) — the link expires after a short time.";

function isRateLimitMessage(message: string): boolean {
  const m = message.toLowerCase();
  return m.includes("rate") || m.includes("too many") || m.includes("429");
}

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);

    const trimmedEmail = email.trim().toLowerCase();
    if (!trimmedEmail || !trimmedEmail.includes("@")) {
      setError("Enter a valid email address.");
      return;
    }

    setLoading(true);
    try {
      const supabase = getSupabaseBrowserClient();
      const origin = typeof window !== "undefined" ? window.location.origin : "";
      const { error: resetError } = await supabase.auth.resetPasswordForEmail(trimmedEmail, {
        redirectTo: `${origin}/reset-password`,
      });

      // Supabase's resetPasswordForEmail does not indicate whether the email exists —
      // show the same generic confirmation on success or "not found"-style responses so
      // this page can't be used to enumerate registered accounts. Only surface a real
      // problem (rate limiting, network/config failure).
      if (resetError && isRateLimitMessage(resetError.message)) {
        setError("Too many reset attempts. Wait a few minutes and try again.");
        setLoading(false);
        return;
      }

      setSent(true);
      setLoading(false);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Could not send the reset email.";
      setError(message);
      setLoading(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#f6f8fb] p-6 text-slate-950">
      <div className="w-full max-w-xl rounded-[28px] bg-white p-8 shadow-[0_20px_60px_rgba(15,23,42,0.12)]">
        <div className="text-xs font-bold uppercase tracking-[0.3em] text-cyan-700">VYRON CORE</div>
        <h1 className="mt-3 text-3xl font-black tracking-tight">Reset your password</h1>

        {sent ? (
          <>
            <p className="mt-3 text-sm leading-6 text-slate-600">{GENERIC_SENT_MESSAGE}</p>
            <div className="mt-6 flex flex-wrap gap-3">
              <Link href="/login" className="rounded-2xl bg-[#06101f] px-5 py-3 text-sm font-black text-cyan-300">
                Back to Login
              </Link>
            </div>
          </>
        ) : (
          <>
            <p className="mt-3 text-sm leading-6 text-slate-600">
              Enter the email address on your VYRON CORE account. We&apos;ll send a secure link to reset your
              password.
            </p>

            <form onSubmit={handleSubmit} className="mt-6 space-y-4">
              <div>
                <label className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-slate-500">
                  Email address
                </label>
                <input
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="admin@company.co.za"
                  autoComplete="email"
                  className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm text-slate-950 outline-none focus:border-cyan-500"
                />
              </div>

              {error && (
                <div className="rounded-2xl border-2 border-rose-600 bg-rose-50 p-4 text-sm font-semibold text-rose-800">
                  {error}
                </div>
              )}

              <button
                type="submit"
                disabled={loading}
                className="mt-2 w-full rounded-2xl bg-[#06101f] px-5 py-4 text-sm font-black text-cyan-300 shadow-lg shadow-cyan-950/15 disabled:opacity-60"
              >
                {loading ? "Sending..." : "Send reset link"}
              </button>
            </form>

            <div className="mt-6 flex flex-wrap gap-3">
              <Link href="/login" className="rounded-2xl bg-slate-100 px-5 py-3 text-sm font-bold text-slate-700">
                Back to Login
              </Link>
              <Link href="/contact" className="rounded-2xl bg-slate-100 px-5 py-3 text-sm font-bold text-slate-700">
                Contact Support
              </Link>
            </div>
          </>
        )}
      </div>
    </main>
  );
}

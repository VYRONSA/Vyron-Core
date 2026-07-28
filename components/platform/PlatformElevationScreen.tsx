"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { KeyRound, Lock, ScrollText, ShieldCheck } from "lucide-react";
import type { ElevationReason } from "@/lib/platform/elevation";

type Props = {
  configured: boolean;
  configurationMessage: string | null;
  /** Why elevation is being asked for — lets a returning operator know their
   * session ended rather than silently re-prompting. */
  reason: ElevationReason;
  ttlMinutes: number;
  operatorEmail: string;
};

const REASON_NOTICE: Partial<Record<ElevationReason, string>> = {
  expired: "Your previous Platform Mode session expired. Verify again to continue.",
  wrong_operator: "That Platform Mode session belonged to a different operator.",
  bad_signature: "Your Platform Mode session was not valid and has been cleared.",
  malformed: "Your Platform Mode session was not valid and has been cleared.",
  revoked: "Your Platform Mode session was terminated by a platform operator.",
};

const ASSURANCES = [
  { icon: Lock, text: "Privileged actions stay sealed until you verify" },
  { icon: ScrollText, text: "Every verification attempt is recorded in the audit log" },
  { icon: KeyRound, text: "This password is separate from your login credentials" },
];

export default function PlatformElevationScreen({
  configured,
  configurationMessage,
  reason,
  ttlMinutes,
  operatorEmail,
}: Props) {
  const router = useRouter();
  const [password, setPassword] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  /** Set when the server reports the login session itself is gone (401). The password
   * form is then replaced entirely — offering it would invite the user to type a
   * secret into a screen that cannot possibly succeed. */
  const [sessionExpired, setSessionExpired] = React.useState(false);
  const notice = REASON_NOTICE[reason];

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (submitting || !password) return;

    setSubmitting(true);
    setError(null);

    try {
      const response = await fetch("/api/platform/elevation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const data = await response.json().catch(() => null);

      if (response.status === 401 && data?.code !== "invalid_password") {
        // The login session died between render and submit. Surface it as an expired
        // session with a way back, never as an ambiguous "Sign in required".
        setPassword("");
        setSessionExpired(true);
        return;
      }

      if (!response.ok || !data?.ok) {
        setError(data?.message || "Verification failed.");
        setPassword("");
        return;
      }

      setPassword("");
      // The gate lives in the server layout, so a refresh is what reveals the console.
      router.refresh();
    } catch {
      setError("Could not reach the server. Check your connection and try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[#050b16] px-4 py-12">
      {/* Secure-control-room backdrop: cyan glow plus a faint grid. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_0%,rgba(34,211,238,0.16),transparent_55%)]"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-[0.18] [background-image:linear-gradient(rgba(148,163,184,0.14)_1px,transparent_1px),linear-gradient(90deg,rgba(148,163,184,0.14)_1px,transparent_1px)] [background-size:52px_52px]"
      />

      <div className="relative w-full max-w-lg">
        <div className="rounded-[28px] border border-cyan-400/20 bg-white/[0.04] p-8 shadow-[0_30px_120px_rgba(8,47,73,0.55)] backdrop-blur-xl sm:p-10">
          <div className="flex items-center gap-3">
            <div className="relative h-11 w-11 rounded-2xl bg-gradient-to-br from-blue-600 to-cyan-400 shadow-lg shadow-blue-500/30">
              <div className="absolute left-[12px] top-[9px] h-7 w-2.5 rotate-[-28deg] rounded-sm bg-white" />
              <div className="absolute right-[12px] top-[9px] h-7 w-2.5 rotate-[28deg] rounded-sm bg-slate-950/80" />
            </div>
            <div>
              <div className="text-xl font-black tracking-[0.3em] text-white">VYRON</div>
              <div className="mt-[-2px] text-[10px] font-bold tracking-[0.5em] text-cyan-300">CORE</div>
            </div>
          </div>

          <div className="mt-8 flex flex-col items-center text-center">
            <div className="relative">
              <div
                aria-hidden
                className="absolute inset-0 animate-pulse rounded-3xl bg-cyan-400/20 blur-2xl"
              />
              <div className="relative rounded-3xl border border-cyan-400/30 bg-cyan-400/10 p-5">
                <ShieldCheck className="h-11 w-11 text-cyan-300" strokeWidth={1.6} />
              </div>
            </div>

            <div className="mt-6 text-xs font-black uppercase tracking-[0.3em] text-cyan-400">
              VYRON Platform Console
            </div>
            <h1 className="mt-3 text-3xl font-black tracking-tight text-white">
              Supervisor Verification Required
            </h1>
            <p className="mt-4 text-sm font-medium leading-relaxed text-slate-300">
              This area contains privileged platform controls that affect every customer
              workspace — provisioning, subscriptions, impersonation and system
              configuration. Access is granted for a limited window and fully audited.
              Please enter the Platform Supervisor Password to continue.
            </p>
          </div>

          <ul className="mt-7 flex flex-col gap-2.5 rounded-2xl border border-white/[0.07] bg-white/[0.02] p-4">
            {ASSURANCES.map(({ icon: Icon, text }) => (
              <li key={text} className="flex items-center gap-3 text-[11px] font-bold text-slate-400">
                <Icon className="h-3.5 w-3.5 shrink-0 text-cyan-400/80" />
                {text}
              </li>
            ))}
          </ul>

          {notice && (
            <div className="mt-6 rounded-2xl border border-amber-400/25 bg-amber-400/10 px-4 py-3 text-xs font-bold text-amber-200">
              {notice}
            </div>
          )}

          {sessionExpired ? (
            <div className="mt-8">
              <div className="rounded-2xl border border-amber-400/25 bg-amber-400/10 px-4 py-4 text-sm font-bold text-amber-200">
                Your session has expired. Please sign in again.
              </div>
              <a
                href="/login?next=%2Fplatform"
                className="mt-5 block w-full rounded-2xl bg-gradient-to-r from-blue-600 to-cyan-500 px-5 py-3.5 text-center text-sm font-black uppercase tracking-wider text-white shadow-lg shadow-cyan-500/25 transition hover:from-blue-500 hover:to-cyan-400"
              >
                Sign In
              </a>
            </div>
          ) : !configured ? (
            <div className="mt-6 rounded-2xl border border-rose-400/30 bg-rose-500/10 px-4 py-4 text-sm font-bold text-rose-200">
              {configurationMessage || "Platform Mode is not configured on this server."}
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="mt-8 flex flex-col gap-4">
              <label className="flex flex-col gap-2">
                <span className="text-[11px] font-black uppercase tracking-[0.2em] text-slate-400">
                  Supervisor Password
                </span>
                <input
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  autoFocus
                  autoComplete="off"
                  disabled={submitting}
                  placeholder="Enter the Platform Supervisor Password"
                  className="w-full rounded-2xl border border-white/10 bg-[#040a14] px-4 py-3.5 text-sm font-bold text-white outline-none transition placeholder:text-slate-600 focus:border-cyan-400/60 focus:shadow-[0_0_0_4px_rgba(34,211,238,0.12)] disabled:opacity-60"
                />
              </label>

              <p className="text-[11px] font-medium leading-relaxed text-slate-500">
                This is not your login password. Signed in as{" "}
                <span className="font-bold text-slate-400">{operatorEmail}</span>. Platform Mode
                lasts {ttlMinutes} minutes, then verification is required again.
              </p>

              {error && (
                <div
                  role="alert"
                  className="rounded-2xl border border-rose-400/30 bg-rose-500/10 px-4 py-3 text-xs font-bold text-rose-200"
                >
                  {error}
                </div>
              )}

              <button
                type="submit"
                disabled={submitting || !password}
                className="mt-1 w-full rounded-2xl bg-gradient-to-r from-blue-600 to-cyan-500 px-5 py-3.5 text-sm font-black uppercase tracking-wider text-white shadow-lg shadow-cyan-500/25 transition hover:from-blue-500 hover:to-cyan-400 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {submitting ? "Verifying..." : "Enter Platform Mode"}
              </button>
            </form>
          )}

          <div className="mt-8 border-t border-white/10 pt-5">
            <a
              href="/dashboard"
              className="text-xs font-bold text-slate-400 transition hover:text-white"
            >
              Return to workspace
            </a>
          </div>
        </div>

        <p className="mt-5 flex items-center justify-center gap-2 text-center text-[11px] font-medium text-slate-600">
          <ShieldCheck className="h-3.5 w-3.5" />
          VYRON CORE Platform Security
        </p>
      </div>
    </div>
  );
}

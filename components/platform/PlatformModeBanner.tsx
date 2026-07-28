"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { ShieldCheck, TimerReset } from "lucide-react";

type Props = {
  /** ISO timestamp when the elevated session expires (absolute, server-issued). */
  expiresAt: string;
  /** Minutes of no interaction after which Platform Mode auto-locks. */
  idleTimeoutMinutes: number;
  /** Operator this elevated session belongs to. */
  operatorEmail: string;
};

const ACTIVITY_EVENTS = ["pointerdown", "keydown", "wheel", "touchstart"] as const;
/** How long before expiry the warning modal appears. */
const WARNING_THRESHOLD_SECONDS = 5 * 60;

function formatCountdown(totalSeconds: number): string {
  const safe = Math.max(0, totalSeconds);
  const minutes = Math.floor(safe / 60);
  const seconds = safe % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

export default function PlatformModeBanner({ expiresAt, idleTimeoutMinutes, operatorEmail }: Props) {
  const router = useRouter();
  const expiryMs = React.useMemo(() => new Date(expiresAt).getTime(), [expiresAt]);
  const [secondsRemaining, setSecondsRemaining] = React.useState(() =>
    Math.max(0, Math.round((expiryMs - Date.now()) / 1000))
  );
  const [exiting, setExiting] = React.useState(false);
  const [extendOpen, setExtendOpen] = React.useState(false);
  const [password, setPassword] = React.useState("");
  const [extendError, setExtendError] = React.useState<string | null>(null);
  const [extending, setExtending] = React.useState(false);
  /** Set once the operator dismisses the warning, so it does not reappear every tick. */
  const [warningDismissed, setWarningDismissed] = React.useState(false);

  const lastActivityRef = React.useRef(Date.now());
  const endedRef = React.useRef(false);

  const endSession = React.useCallback(
    async (reason: "manual" | "idle" | "expired") => {
      if (endedRef.current) return;
      endedRef.current = true;
      setExiting(true);
      try {
        await fetch("/api/platform/elevation", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ reason }),
        });
      } catch {
        // The cookie is a browser-session cookie and the server enforces the absolute
        // expiry regardless, so a failed exit call still cannot extend Platform Mode.
      }
      router.refresh();
    },
    [router]
  );

  // Absolute expiry countdown.
  React.useEffect(() => {
    const timer = window.setInterval(() => {
      const remaining = Math.max(0, Math.round((expiryMs - Date.now()) / 1000));
      setSecondsRemaining(remaining);
      if (remaining <= 0) void endSession("expired");
    }, 1000);
    return () => window.clearInterval(timer);
  }, [expiryMs, endSession]);

  // Idle auto-lock. The server owns the absolute ceiling; this drops elevation early
  // when the operator walks away from an open console.
  React.useEffect(() => {
    if (idleTimeoutMinutes <= 0) return;
    const idleMs = idleTimeoutMinutes * 60 * 1000;

    function markActive() {
      lastActivityRef.current = Date.now();
    }
    for (const event of ACTIVITY_EVENTS) {
      window.addEventListener(event, markActive, { passive: true });
    }
    const timer = window.setInterval(() => {
      if (Date.now() - lastActivityRef.current >= idleMs) void endSession("idle");
    }, 15_000);

    return () => {
      for (const event of ACTIVITY_EVENTS) window.removeEventListener(event, markActive);
      window.clearInterval(timer);
    };
  }, [idleTimeoutMinutes, endSession]);

  /**
   * Extending re-verifies the supervisor password and issues a brand-new session.
   * There is deliberately no silent renewal: re-proving the secret is the whole point
   * of a time-boxed elevation, so an unattended console can never extend itself.
   */
  async function handleExtend(event: React.FormEvent) {
    event.preventDefault();
    if (extending || !password) return;
    setExtending(true);
    setExtendError(null);
    try {
      const response = await fetch("/api/platform/elevation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const data = await response.json().catch(() => null);
      if (response.status === 401 && data?.code !== "invalid_password") {
        // Login session gone, not a wrong password — send them to sign in rather than
        // letting them retype a secret that cannot succeed.
        setPassword("");
        window.location.href = "/login?next=%2Fplatform";
        return;
      }
      if (!response.ok || !data?.ok) {
        setExtendError(data?.message || "Verification failed.");
        setPassword("");
        return;
      }
      setPassword("");
      setExtendOpen(false);
      setWarningDismissed(false);
      router.refresh();
    } catch {
      setExtendError("Could not reach the server. Check your connection and try again.");
    } finally {
      setExtending(false);
    }
  }

  const expiringSoon = secondsRemaining <= WARNING_THRESHOLD_SECONDS;
  const critical = secondsRemaining <= 120;
  const showWarning = expiringSoon && secondsRemaining > 0 && !warningDismissed && !exiting;

  return (
    <>
      <div
        className={`flex flex-wrap items-center justify-between gap-3 rounded-3xl border px-5 py-3.5 transition ${
          critical
            ? "border-amber-400/40 bg-amber-400/10"
            : "border-cyan-400/25 bg-cyan-400/[0.07]"
        }`}
      >
        <div className="flex items-center gap-3">
          <div
            className={`rounded-2xl border p-2 ${
              critical
                ? "border-amber-400/40 bg-amber-400/10 text-amber-300"
                : "border-cyan-400/30 bg-cyan-400/10 text-cyan-300"
            }`}
          >
            <ShieldCheck className="h-5 w-5" strokeWidth={1.8} />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="relative flex h-2 w-2">
                <span
                  className={`absolute inline-flex h-full w-full animate-ping rounded-full opacity-60 ${
                    critical ? "bg-amber-300" : "bg-cyan-300"
                  }`}
                />
                <span
                  className={`relative inline-flex h-2 w-2 rounded-full ${
                    critical ? "bg-amber-300" : "bg-cyan-300"
                  }`}
                />
              </span>
              <span
                className={`text-xs font-black uppercase tracking-[0.22em] ${
                  critical ? "text-amber-200" : "text-cyan-200"
                }`}
              >
                Platform Mode Active
              </span>
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] font-bold text-slate-400">
              <span>
                Remaining time:{" "}
                <span
                  className={`font-mono tabular-nums ${critical ? "text-amber-200" : "text-white"}`}
                >
                  {formatCountdown(secondsRemaining)}
                </span>
              </span>
              <span aria-hidden className="text-slate-600">
                •
              </span>
              <span className="text-slate-400">{operatorEmail}</span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => {
              setExtendError(null);
              setExtendOpen(true);
            }}
            className="rounded-full border border-cyan-400/30 bg-cyan-400/10 px-4 py-2 text-xs font-black uppercase tracking-wider text-cyan-200 transition hover:bg-cyan-400/20"
          >
            Extend
          </button>
          <button
            type="button"
            onClick={() => void endSession("manual")}
            disabled={exiting}
            className="rounded-full border border-white/15 bg-white/5 px-4 py-2 text-xs font-black uppercase tracking-wider text-white transition hover:bg-white/15 disabled:opacity-50"
          >
            {exiting ? "Exiting..." : "Exit Platform Mode"}
          </button>
        </div>
      </div>

      {(showWarning || extendOpen) && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-[#03070f]/80 px-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-[28px] border border-amber-400/25 bg-[#070f1c] p-8 shadow-[0_30px_120px_rgba(8,47,73,0.6)]">
            <div className="flex items-center gap-3">
              <div className="rounded-2xl border border-amber-400/30 bg-amber-400/10 p-3 text-amber-300">
                <TimerReset className="h-6 w-6" strokeWidth={1.8} />
              </div>
              <div>
                <div className="text-xs font-black uppercase tracking-[0.24em] text-amber-300">
                  Platform Mode
                </div>
                <h2 className="mt-1 text-xl font-black text-white">
                  {extendOpen ? "Extend Platform Mode" : "Session expiring soon"}
                </h2>
              </div>
            </div>

            <p className="mt-5 text-sm font-medium leading-relaxed text-slate-300">
              {extendOpen ? (
                <>
                  Re-enter the Platform Supervisor Password to start a new elevated
                  session. Platform Mode is never extended automatically.
                </>
              ) : (
                <>
                  Your elevated session ends in{" "}
                  <span className="font-mono font-black tabular-nums text-amber-200">
                    {formatCountdown(secondsRemaining)}
                  </span>
                  . Unsaved privileged work should be completed now.
                </>
              )}
            </p>

            {extendOpen ? (
              <form onSubmit={handleExtend} className="mt-6 flex flex-col gap-3">
                <input
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  autoFocus
                  autoComplete="off"
                  disabled={extending}
                  placeholder="Platform Supervisor Password"
                  className="w-full rounded-2xl border border-white/10 bg-[#040a14] px-4 py-3.5 text-sm font-bold text-white outline-none transition placeholder:text-slate-600 focus:border-cyan-400/60 focus:shadow-[0_0_0_4px_rgba(34,211,238,0.12)] disabled:opacity-60"
                />
                {extendError && (
                  <div
                    role="alert"
                    className="rounded-2xl border border-rose-400/30 bg-rose-500/10 px-4 py-3 text-xs font-bold text-rose-200"
                  >
                    {extendError}
                  </div>
                )}
                <div className="mt-1 flex flex-col gap-2 sm:flex-row">
                  <button
                    type="submit"
                    disabled={extending || !password}
                    className="flex-1 rounded-2xl bg-gradient-to-r from-blue-600 to-cyan-500 px-5 py-3 text-sm font-black uppercase tracking-wider text-white shadow-lg shadow-cyan-500/25 transition hover:from-blue-500 hover:to-cyan-400 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {extending ? "Verifying..." : "Extend Platform Mode"}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setExtendOpen(false);
                      setPassword("");
                      setExtendError(null);
                    }}
                    className="rounded-2xl border border-white/15 bg-white/5 px-5 py-3 text-sm font-black uppercase tracking-wider text-white transition hover:bg-white/15"
                  >
                    Cancel
                  </button>
                </div>
              </form>
            ) : (
              <div className="mt-7 flex flex-col gap-2 sm:flex-row">
                <button
                  type="button"
                  onClick={() => {
                    setExtendError(null);
                    setExtendOpen(true);
                  }}
                  className="flex-1 rounded-2xl bg-gradient-to-r from-blue-600 to-cyan-500 px-5 py-3 text-sm font-black uppercase tracking-wider text-white shadow-lg shadow-cyan-500/25 transition hover:from-blue-500 hover:to-cyan-400"
                >
                  Extend Platform Mode
                </button>
                <button
                  type="button"
                  onClick={() => void endSession("manual")}
                  disabled={exiting}
                  className="rounded-2xl border border-white/15 bg-white/5 px-5 py-3 text-sm font-black uppercase tracking-wider text-white transition hover:bg-white/15 disabled:opacity-50"
                >
                  Exit Platform Mode
                </button>
              </div>
            )}

            {!extendOpen && (
              <button
                type="button"
                onClick={() => setWarningDismissed(true)}
                className="mt-4 w-full text-center text-[11px] font-bold text-slate-500 transition hover:text-slate-300"
              >
                Continue working
              </button>
            )}
          </div>
        </div>
      )}
    </>
  );
}

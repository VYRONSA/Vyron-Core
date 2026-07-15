"use client";

import { AlertTriangle } from "lucide-react";
import type { SessionTimeoutWarningState } from "@/lib/hooks/use-session-timeout-guard";

type Props = {
  warning: SessionTimeoutWarningState | null;
  onStayLoggedIn: () => void;
  onLogoutNow: () => void;
};

function formatSeconds(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = Math.max(0, totalSeconds % 60);
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

export default function SessionTimeoutWarning({ warning, onStayLoggedIn, onLogoutNow }: Props) {
  if (!warning) return null;

  const message =
    warning.reason === "absolute"
      ? "Your session has reached its maximum lifetime and will end soon for security. Sign in again to continue."
      : "You've been inactive for a while. For your security, you'll be signed out soon.";

  return (
    <div className="fixed inset-0 z-[999] flex items-center justify-center bg-slate-950/60 p-4">
      <div className="w-full max-w-sm rounded-[1.5rem] bg-white p-6 text-center shadow-[0_20px_60px_rgba(15,23,42,0.25)]">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-amber-50">
          <AlertTriangle className="h-6 w-6 text-amber-600" />
        </div>
        <h3 className="mt-4 text-lg font-black text-slate-950">Session ending soon</h3>
        <p className="mt-2 text-sm text-slate-600">{message}</p>
        <p className="mt-3 text-2xl font-black tabular-nums text-slate-950">
          {formatSeconds(warning.secondsRemaining)}
        </p>
        <div className="mt-6 flex flex-col gap-2">
          {warning.reason === "idle" ? (
            <button
              type="button"
              onClick={onStayLoggedIn}
              className="rounded-full bg-[#292524] px-5 py-2.5 text-sm font-semibold text-white shadow-md shadow-black/20 transition hover:-translate-y-0.5 hover:bg-cyan-600"
            >
              Stay signed in
            </button>
          ) : null}
          <button
            type="button"
            onClick={onLogoutNow}
            className="rounded-full border border-slate-200 px-5 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
          >
            Log out now
          </button>
        </div>
      </div>
    </div>
  );
}

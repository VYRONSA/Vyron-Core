"use client";

import React from "react";
import { useRouter } from "next/navigation";
import {
  Activity,
  Ban,
  Monitor,
  ScrollText,
  ShieldAlert,
  ShieldCheck,
  UserCog,
} from "lucide-react";
import { platformFetch } from "@/lib/platform/platform-client";
import PlatformPanel from "./PlatformPanel";
import PlatformStatTile from "./PlatformStatTile";

type SecurityMetrics = {
  failedElevations: number | null;
  lockouts: number | null;
  impersonationsToday: number | null;
  auditEventsToday: number | null;
  activeSessions: number | null;
  sessionRegistryAvailable: boolean;
  sessionRegistryMessage: string | null;
};

type PlatformSession = {
  jti: string;
  operatorEmail: string;
  ip: string | null;
  userAgent: string | null;
  issuedAt: string;
  expiresAt: string;
  secondsRemaining: number;
  isCurrent: boolean;
};

/** Turns a raw UA string into something readable in a table cell. */
function describeBrowser(userAgent: string | null): string {
  if (!userAgent) return "Unknown";
  const ua = userAgent;
  const browser = /Edg\//.test(ua)
    ? "Edge"
    : /Chrome\//.test(ua)
      ? "Chrome"
      : /Safari\//.test(ua) && !/Chrome/.test(ua)
        ? "Safari"
        : /Firefox\//.test(ua)
          ? "Firefox"
          : "Unknown browser";
  const os = /Windows/.test(ua)
    ? "Windows"
    : /Macintosh|Mac OS/.test(ua)
      ? "macOS"
      : /Android/.test(ua)
        ? "Android"
        : /iPhone|iPad/.test(ua)
          ? "iOS"
          : /Linux/.test(ua)
            ? "Linux"
            : "";
  return os ? `${browser} · ${os}` : browser;
}

function formatRemaining(seconds: number): string {
  const safe = Math.max(0, seconds);
  return `${String(Math.floor(safe / 60)).padStart(2, "0")}:${String(safe % 60).padStart(2, "0")}`;
}

function metric(value: number | null): React.ReactNode {
  return value === null ? "—" : value;
}

export default function PlatformSecurityPanel() {
  const router = useRouter();
  const [metrics, setMetrics] = React.useState<SecurityMetrics | null>(null);
  const [sessions, setSessions] = React.useState<PlatformSession[]>([]);
  const [registryMessage, setRegistryMessage] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [lockdownOpen, setLockdownOpen] = React.useState(false);

  const load = React.useCallback(async () => {
    const [metricsResult, sessionsResult] = await Promise.all([
      platformFetch<SecurityMetrics>("/api/platform/security"),
      platformFetch<{ sessions: PlatformSession[] }>("/api/platform/elevation/sessions"),
    ]);

    if (metricsResult.ok) setMetrics(metricsResult.data);
    else setError(metricsResult.message);

    if (sessionsResult.ok) {
      setSessions(sessionsResult.data.sessions || []);
      setRegistryMessage(null);
    } else {
      setSessions([]);
      // 503 here means sql/067 is not installed — surfaced rather than shown as
      // "no active sessions", which would wrongly imply nobody is elevated.
      setRegistryMessage(sessionsResult.message);
    }
    setLoading(false);
  }, []);

  React.useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), 30_000);
    return () => window.clearInterval(timer);
  }, [load]);

  async function terminate(session: PlatformSession) {
    setBusy(session.jti);
    setNotice(null);
    setError(null);
    const result = await platformFetch(
      `/api/platform/elevation/sessions?jti=${encodeURIComponent(session.jti)}`,
      { method: "DELETE" }
    );
    setBusy(null);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    setNotice(`Terminated the elevated session for ${session.operatorEmail}.`);
    if (session.isCurrent) {
      // Revoked our own privilege — bounce back to the verification screen.
      router.refresh();
      return;
    }
    void load();
  }

  async function lockdown() {
    setBusy("lockdown");
    setNotice(null);
    setError(null);
    const result = await platformFetch<{ revokedCount: number; message: string }>(
      "/api/platform/elevation/lockdown",
      { method: "POST", body: JSON.stringify({ reason: "manual_emergency_lockdown" }) }
    );
    setBusy(null);
    setLockdownOpen(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    // Lockdown revokes the initiator too, so the console drops to verification.
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-6">
      <PlatformPanel dark>
        <div className="flex items-center gap-3">
          <div className="rounded-2xl border border-cyan-400/30 bg-cyan-400/10 p-2.5 text-cyan-300">
            <ShieldCheck className="h-6 w-6" strokeWidth={1.8} />
          </div>
          <div>
            <div className="text-xs font-black uppercase tracking-[0.28em] text-cyan-400">
              Platform Security
            </div>
            <h2 className="mt-1 text-2xl font-black text-white">Elevation & Session Control</h2>
          </div>
        </div>
        <p className="mt-4 max-w-3xl text-sm font-medium leading-relaxed text-slate-300">
          Live view of privileged access: who is currently elevated, failed verification
          attempts, and the emergency control to revoke every Platform Mode session at once.
        </p>
      </PlatformPanel>

      {error && (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-bold text-rose-700">
          {error}
        </div>
      )}
      {notice && (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-bold text-emerald-700">
          {notice}
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <PlatformStatTile
          icon={ShieldAlert}
          label="Failed Elevations"
          value={metric(metrics?.failedElevations ?? null)}
          subtitle="Today"
          tone={metrics?.failedElevations ? "rose" : "slate"}
        />
        <PlatformStatTile
          icon={Ban}
          label="Lockouts"
          value={metric(metrics?.lockouts ?? null)}
          subtitle="Today"
          tone={metrics?.lockouts ? "amber" : "slate"}
        />
        <PlatformStatTile
          icon={ShieldCheck}
          label="Active Platform Sessions"
          value={metric(metrics?.activeSessions ?? null)}
          subtitle="Currently elevated"
          tone="cyan"
        />
        <PlatformStatTile
          icon={UserCog}
          label="Impersonations Today"
          value={metric(metrics?.impersonationsToday ?? null)}
          subtitle="Login as client"
          tone={metrics?.impersonationsToday ? "violet" : "slate"}
        />
        <PlatformStatTile
          icon={ScrollText}
          label="Audit Events Today"
          value={metric(metrics?.auditEventsToday ?? null)}
          subtitle="All platform activity"
          tone="slate"
        />
      </div>

      <PlatformPanel>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Monitor className="h-5 w-5 text-cyan-700" />
            <h3 className="text-lg font-black text-[#06101f]">Active Platform Sessions</h3>
          </div>
          <button
            type="button"
            onClick={() => setLockdownOpen(true)}
            disabled={busy !== null}
            className="rounded-full bg-rose-600 px-5 py-2.5 text-xs font-black uppercase tracking-wider text-white shadow-lg shadow-rose-600/25 transition hover:bg-rose-500 disabled:opacity-50"
          >
            Emergency Lockdown
          </button>
        </div>

        {registryMessage ? (
          <div className="mt-5 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-4 text-sm font-bold text-amber-800">
            {registryMessage}
          </div>
        ) : loading ? (
          <div className="mt-5 text-sm font-bold text-slate-500">Loading sessions…</div>
        ) : sessions.length === 0 ? (
          <div className="mt-5 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-6 text-center text-sm font-bold text-slate-500">
            No operators are currently in Platform Mode.
          </div>
        ) : (
          <div className="mt-5 overflow-x-auto">
            <table className="w-full min-w-[760px] border-collapse text-left">
              <thead>
                <tr className="border-b border-slate-200 text-[11px] font-black uppercase tracking-wider text-slate-500">
                  <th className="pb-3 pr-4">Operator</th>
                  <th className="pb-3 pr-4">Browser</th>
                  <th className="pb-3 pr-4">IP</th>
                  <th className="pb-3 pr-4">Started</th>
                  <th className="pb-3 pr-4">Remaining</th>
                  <th className="pb-3" />
                </tr>
              </thead>
              <tbody>
                {sessions.map((session) => (
                  <tr key={session.jti} className="border-b border-slate-100 text-sm font-bold text-slate-700">
                    <td className="py-3 pr-4">
                      {session.operatorEmail}
                      {session.isCurrent && (
                        <span className="ml-2 rounded-full bg-cyan-100 px-2 py-0.5 text-[10px] font-black uppercase text-cyan-800">
                          This device
                        </span>
                      )}
                    </td>
                    <td className="py-3 pr-4 text-slate-500">{describeBrowser(session.userAgent)}</td>
                    <td className="py-3 pr-4 font-mono text-xs text-slate-500">{session.ip || "—"}</td>
                    <td className="py-3 pr-4 text-slate-500">
                      {new Date(session.issuedAt).toLocaleTimeString()}
                    </td>
                    <td className="py-3 pr-4 font-mono tabular-nums text-slate-700">
                      {formatRemaining(session.secondsRemaining)}
                    </td>
                    <td className="py-3 text-right">
                      <button
                        type="button"
                        onClick={() => void terminate(session)}
                        disabled={busy !== null}
                        className="rounded-full border border-rose-200 bg-rose-50 px-4 py-1.5 text-xs font-black uppercase tracking-wider text-rose-700 transition hover:bg-rose-100 disabled:opacity-50"
                      >
                        {busy === session.jti ? "Ending…" : "Terminate"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </PlatformPanel>

      {lockdownOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-[#03070f]/80 px-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-[28px] border border-rose-400/30 bg-[#070f1c] p-8 shadow-[0_30px_120px_rgba(76,5,25,0.5)]">
            <div className="flex items-center gap-3">
              <div className="rounded-2xl border border-rose-400/30 bg-rose-500/10 p-3 text-rose-300">
                <ShieldAlert className="h-6 w-6" strokeWidth={1.8} />
              </div>
              <h2 className="text-xl font-black text-white">Emergency Lockdown</h2>
            </div>

            <p className="mt-5 text-sm font-medium leading-relaxed text-slate-300">
              This immediately revokes <strong className="text-white">every</strong> active
              Platform Mode session, including your own. Operators must re-enter the
              Platform Supervisor Password before any privileged action.
            </p>
            <p className="mt-3 rounded-2xl border border-cyan-400/20 bg-cyan-400/[0.07] px-4 py-3 text-xs font-bold text-cyan-200">
              Normal application logins are not affected. Operators and customer users stay
              signed in and keep working.
            </p>

            <div className="mt-7 flex flex-col gap-2 sm:flex-row">
              <button
                type="button"
                onClick={() => void lockdown()}
                disabled={busy !== null}
                className="flex-1 rounded-2xl bg-rose-600 px-5 py-3 text-sm font-black uppercase tracking-wider text-white shadow-lg shadow-rose-600/25 transition hover:bg-rose-500 disabled:opacity-50"
              >
                {busy === "lockdown" ? "Revoking…" : "Revoke All Sessions"}
              </button>
              <button
                type="button"
                onClick={() => setLockdownOpen(false)}
                className="rounded-2xl border border-white/15 bg-white/5 px-5 py-3 text-sm font-black uppercase tracking-wider text-white transition hover:bg-white/15"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      <PlatformPanel>
        <div className="flex items-center gap-2">
          <Activity className="h-5 w-5 text-cyan-700" />
          <h3 className="text-lg font-black text-[#06101f]">How Platform Mode works</h3>
        </div>
        <ul className="mt-4 flex flex-col gap-2 text-sm font-medium text-slate-600">
          <li>• Elevation is separate from login and expires automatically.</li>
          <li>• Every privileged platform endpoint requires it — including reads.</li>
          <li>• Grants, failures, lockouts, terminations and lockdowns are all audited.</li>
        </ul>
      </PlatformPanel>
    </div>
  );
}

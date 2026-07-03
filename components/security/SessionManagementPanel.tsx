"use client";

import React, { useCallback, useEffect, useState } from "react";
import { LogOut, RefreshCcw, Shield } from "lucide-react";
import {
  fetchActiveSessionsForCompany,
  revokeUserSession,
  type UserSessionRow,
} from "@/lib/session-management";
import { writeAuditLog } from "@/lib/audit-log";
import { supabase } from "@/lib/supabase";

type Props = {
  companyId: string;
  operatorEmail: string;
};

function formatWhen(value: string | null | undefined): string {
  if (!value) return "—";
  try {
    return new Date(value).toLocaleString("en-ZA", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return value;
  }
}

export default function SessionManagementPanel({ companyId, operatorEmail }: Props) {
  const [sessions, setSessions] = useState<UserSessionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyToken, setBusyToken] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!companyId) return;
    setLoading(true);
    const result = await fetchActiveSessionsForCompany(supabase, companyId);
    setSessions(result.rows);
    setLoading(false);
  }, [companyId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleForceLogout(session: UserSessionRow) {
    const confirmed = window.confirm(`Force logout for ${session.user_email}?`);
    if (!confirmed) return;

    setBusyToken(session.session_token);
    setMessage(null);
    const result = await revokeUserSession(supabase, session.session_token);
    if (result.error) {
      setMessage(result.error);
      setBusyToken(null);
      return;
    }

    await writeAuditLog(supabase, {
      companyId,
      userEmail: operatorEmail,
      action: "force_logout",
      entityType: "user_session",
      entityId: session.id,
      metadata: { targetEmail: session.user_email },
    });

    setMessage(`Session revoked for ${session.user_email}.`);
    setBusyToken(null);
    await load();
  }

  return (
    <div className="rounded-[2rem] border border-slate-200/80 bg-white p-6 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Shield className="h-5 w-5 text-cyan-700" />
          <h3 className="text-xl font-black text-slate-950">Active Sessions</h3>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          className="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-xs font-black text-slate-700"
        >
          <RefreshCcw className="h-3.5 w-3.5" />
          Refresh
        </button>
      </div>
      <p className="mt-2 text-sm text-slate-500">
        Last login and active sessions for this workspace. Sessions expire after 14 days unless revoked.
      </p>

      {message ? (
        <p className="mt-4 rounded-xl border border-cyan-200 bg-cyan-50 px-4 py-3 text-sm font-semibold text-cyan-900">
          {message}
        </p>
      ) : null}

      <div className="mt-6 overflow-x-auto rounded-2xl border border-slate-200">
        <table className="min-w-full text-left text-sm">
          <thead className="bg-slate-50 text-xs font-black uppercase tracking-wider text-slate-500">
            <tr>
              <th className="px-4 py-3">User</th>
              <th className="px-4 py-3">Last seen</th>
              <th className="px-4 py-3">Expires</th>
              <th className="px-4 py-3">Agent</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {loading ? (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-slate-500">
                  Loading sessions…
                </td>
              </tr>
            ) : sessions.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-slate-500">
                  No active sessions recorded yet. Run sql/030-multi-tenant-security.sql to enable session
                  tracking.
                </td>
              </tr>
            ) : (
              sessions.map((session) => (
                <tr key={session.id}>
                  <td className="px-4 py-3 font-semibold text-slate-800">{session.user_email}</td>
                  <td className="px-4 py-3 text-slate-600">{formatWhen(session.last_seen_at)}</td>
                  <td className="px-4 py-3 text-slate-600">{formatWhen(session.expires_at)}</td>
                  <td className="px-4 py-3 text-xs text-slate-500">
                    {(session.user_agent || "Unknown device").slice(0, 48)}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      type="button"
                      disabled={busyToken === session.session_token}
                      onClick={() => void handleForceLogout(session)}
                      className="inline-flex items-center gap-1 rounded-lg border border-rose-200 bg-rose-50 px-3 py-1.5 text-xs font-black text-rose-800 disabled:opacity-50"
                    >
                      <LogOut className="h-3.5 w-3.5" />
                      Force logout
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

"use client";

import React, { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ClipboardList,
  Loader2,
  MessageSquare,
  RefreshCcw,
  Send,
  ShieldCheck,
} from "lucide-react";
import {
  WHATSAPP_EXAMPLE_COMMANDS,
  loadWhatsAppCommandDashboard,
  type WhatsAppCommandDashboard,
} from "@/lib/whatsapp-workforce-command";
import { supabase } from "@/lib/supabase";

type Props = {
  companyId: string;
  userEmail?: string | null;
};

export default function WhatsAppCommandCentrePanel({ companyId, userEmail }: Props) {
  const [loading, setLoading] = useState(true);
  const [dashboard, setDashboard] = useState<WhatsAppCommandDashboard | null>(null);
  const [testPhone, setTestPhone] = useState("27000000000");
  const [testMessage, setTestMessage] = useState("Who is late today?");
  const [testBusy, setTestBusy] = useState(false);
  const [testReply, setTestReply] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!companyId) return;
    setLoading(true);
    setLoadError(null);
    const data = await loadWhatsAppCommandDashboard(supabase, companyId);
    setDashboard(data);
    setLoading(false);
  }, [companyId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  async function runMockCommand() {
    setTestBusy(true);
    setTestReply(null);
    try {
      const { data: session } = await supabase.auth.getSession();
      const token = session.session?.access_token;
      const response = await fetch("/api/whatsapp/workforce-command", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          companyId,
          phone: testPhone,
          message: testMessage,
          mock: true,
          sendReply: false,
        }),
      });
      const data = await response.json();
      setTestReply(data?.result?.reply || data?.error || "No response.");
      await reload();
    } catch (err) {
      setTestReply(err instanceof Error ? err.message : "Test command failed.");
    }
    setTestBusy(false);
  }

  return (
    <div className="space-y-6">
      <section className="rounded-[2rem] border border-white/80 bg-white/95 p-6 shadow-[0_18px_55px_rgba(15,23,42,0.12)]">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div>
            <div className="text-xs font-bold uppercase tracking-[0.35em] text-cyan-700">
              WhatsApp Workforce Command
            </div>
            <h2 className="mt-2 text-3xl font-black tracking-tight text-slate-950">
              WhatsApp Command Centre
            </h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-500">
              Managers can query workforce data and approve prepared actions via WhatsApp. Commands
              are logged; approvals require an existing queue item.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void reload()}
            className="inline-flex items-center gap-2 rounded-2xl border border-cyan-100 bg-cyan-50 px-4 py-3 text-sm font-black text-cyan-900"
          >
            <RefreshCcw className="h-4 w-4" />
            Refresh
          </button>
        </div>

        {dashboard?.mockMode && (
          <p className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-950">
            Mock/test mode active — WhatsApp provider not connected or{" "}
            <code className="rounded bg-white px-1">WHATSAPP_WORKFORCE_MOCK_MODE=true</code>.
            Use the simulator below to test commands.
          </p>
        )}
        {!loading && dashboard && !dashboard.tablesAvailable && (
          <p className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-950">
            Run <code className="rounded bg-white px-1">sql/023-whatsapp-workforce-command.sql</code>{" "}
            in Supabase, then refresh.
          </p>
        )}
        {loadError && (
          <p className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-900">
            {loadError}
          </p>
        )}
      </section>

      <section className="rounded-[2rem] border border-slate-900/10 bg-[#06101f] p-6 text-white shadow-xl">
        <div className="flex items-center gap-2">
          <Send className="h-5 w-5 text-cyan-300" />
          <h3 className="text-lg font-black">Command simulator (mock mode)</h3>
        </div>
        <p className="mt-2 text-sm text-slate-400">
          Signed in as {userEmail || "workspace user"}. Examples:{" "}
          {WHATSAPP_EXAMPLE_COMMANDS.map((e) => `“${e}”`).join(" · ")}
        </p>
        <div className="mt-4 grid gap-3 md:grid-cols-[1fr_2fr_auto]">
          <input
            value={testPhone}
            onChange={(e) => setTestPhone(e.target.value)}
            placeholder="Manager phone"
            className="rounded-xl border border-white/10 bg-white/10 px-3 py-2 text-sm font-semibold"
          />
          <input
            value={testMessage}
            onChange={(e) => setTestMessage(e.target.value)}
            placeholder="Who is late today?"
            className="rounded-xl border border-white/10 bg-white/10 px-3 py-2 text-sm font-semibold"
          />
          <button
            type="button"
            disabled={testBusy}
            onClick={() => void runMockCommand()}
            className="rounded-xl bg-cyan-500 px-4 py-2 text-sm font-black text-slate-950 disabled:opacity-50"
          >
            {testBusy ? "Running…" : "Simulate"}
          </button>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          {WHATSAPP_EXAMPLE_COMMANDS.map((ex) => (
            <button
              key={ex}
              type="button"
              onClick={() => setTestMessage(ex)}
              className="rounded-lg bg-white/10 px-2 py-1 text-xs font-semibold text-slate-200"
            >
              {ex}
            </button>
          ))}
        </div>
        {testReply && (
          <pre className="mt-4 max-h-40 overflow-auto rounded-xl bg-slate-900 p-4 text-xs text-cyan-100">
            {testReply}
          </pre>
        )}
      </section>

      <Section
        title="Command Sessions"
        icon={ClipboardList}
        loading={loading}
        empty="No WhatsApp command sessions yet."
        rows={(dashboard?.sessions || []).map((s) => ({
          title: String(s.manager_name || s.manager_phone || "Session"),
          detail: `${s.manager_email || "no email"} · ${s.status} · mock=${String(s.mock_mode)}`,
          meta: s.last_message_at ? new Date(String(s.last_message_at)).toLocaleString() : "",
        }))}
      />

      <Section
        title="Recent Messages"
        icon={MessageSquare}
        loading={loading}
        empty="No messages logged."
        rows={(dashboard?.recentMessages || []).slice(0, 20).map((m) => ({
          title: `${m.direction}: ${String(m.message_body).slice(0, 80)}`,
          detail: m.response_body ? String(m.response_body).slice(0, 120) : String(m.status),
          meta: `${m.command_intent || "—"} · ${new Date(String(m.created_at)).toLocaleString()}`,
          failed: m.status === "failed",
        }))}
      />

      <Section
        title="Pending WhatsApp Approvals"
        icon={ShieldCheck}
        loading={loading}
        empty="No pending WhatsApp or automation approvals."
        rows={(dashboard?.pendingApprovals || []).map((a) => ({
          title: `${a.action_ref || a.id}: ${a.command_type || a.action_type}`,
          detail: String(a.reason || a.status || ""),
          meta: a.manager_phone ? String(a.manager_phone) : "",
        }))}
      />

      <Section
        title="Completed WhatsApp Actions"
        icon={CheckCircle2}
        loading={loading}
        empty="No completed WhatsApp actions."
        rows={(dashboard?.completedActions || []).map((a) => ({
          title: `${a.action_ref}: ${a.command_type}`,
          detail: String(a.status),
          meta: a.completed_at ? new Date(String(a.completed_at)).toLocaleString() : "",
        }))}
      />

      <Section
        title="Failed Commands"
        icon={AlertTriangle}
        loading={loading}
        empty="No failed commands."
        rows={(dashboard?.failedCommands || []).map((m) => ({
          title: String(m.message_body).slice(0, 80),
          detail: String(m.error_message || m.response_body || "Unknown error"),
          meta: new Date(String(m.created_at)).toLocaleString(),
          failed: true,
        }))}
      />

      <Section
        title="Audit Log"
        icon={ClipboardList}
        loading={loading}
        empty="No audit entries."
        rows={(dashboard?.auditLog || []).slice(0, 25).map((e) => ({
          title: String(e.event_type),
          detail: String(e.message),
          meta: `${e.manager_email || e.manager_phone || "—"} · ${new Date(String(e.created_at)).toLocaleString()}`,
        }))}
      />
    </div>
  );
}

function Section({
  title,
  icon: Icon,
  loading,
  empty,
  rows,
}: {
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  loading: boolean;
  empty: string;
  rows: { title: string; detail: string; meta?: string; failed?: boolean }[];
}) {
  return (
    <section className="rounded-[2rem] border border-white/80 bg-white/95 p-6 shadow-sm">
      <div className="flex items-center gap-2">
        <Icon className="h-5 w-5 text-cyan-700" />
        <h3 className="text-lg font-black text-slate-950">{title}</h3>
      </div>
      <div className="mt-4 space-y-3">
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-slate-500">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading…
          </div>
        ) : rows.length === 0 ? (
          <p className="text-sm font-semibold text-slate-500">{empty}</p>
        ) : (
          rows.map((row, idx) => (
            <div
              key={`${row.title}-${idx}`}
              className={`rounded-2xl border px-4 py-3 ${
                row.failed
                  ? "border-rose-200 bg-rose-50"
                  : "border-slate-100 bg-slate-50/80"
              }`}
            >
              <div className="font-bold text-slate-950">{row.title}</div>
              <div className="mt-1 text-sm text-slate-700">{row.detail}</div>
              {row.meta && (
                <div className="mt-1 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                  {row.meta}
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </section>
  );
}

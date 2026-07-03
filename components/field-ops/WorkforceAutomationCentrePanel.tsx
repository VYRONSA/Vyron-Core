"use client";

import React, { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ClipboardList,
  Loader2,
  RefreshCcw,
  RotateCcw,
  ShieldCheck,
  XCircle,
} from "lucide-react";
import {
  approveAutomationAction,
  automationStatusClass,
  loadWorkforceAutomationDashboard,
  rejectAutomationAction,
  retryFailedAutomationAction,
  submitAutomationToQueue,
  type WorkforceAutomationAction,
} from "@/lib/workforce-automation-engine";
import { supabase } from "@/lib/supabase";

type Props = {
  companyId: string;
  userEmail?: string | null;
};

export default function WorkforceAutomationCentrePanel({ companyId, userEmail }: Props) {
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [dashboard, setDashboard] = useState<
    Awaited<ReturnType<typeof loadWorkforceAutomationDashboard>>["dashboard"] | null
  >(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const actorEmail = userEmail || "manager@workspace";

  const reload = useCallback(async () => {
    if (!companyId) return;
    setLoading(true);
    setLoadError(null);
    const result = await loadWorkforceAutomationDashboard(supabase, companyId);
    setDashboard(result.dashboard);
    if (result.error) setLoadError(result.error);
    setLoading(false);
  }, [companyId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  async function handleApprove(action: WorkforceAutomationAction) {
    setBusyId(action.id);
    setNote(null);
    const result = await approveAutomationAction(supabase, {
      actionId: action.id,
      companyId,
      approverEmail: actorEmail,
    });
    setNote(
      result.ok
        ? result.message || "Action completed."
        : `Failed: ${result.error || result.message}`
    );
    setBusyId(null);
    await reload();
  }

  async function handleReject(action: WorkforceAutomationAction) {
    const notes = window.prompt("Reason for rejection (optional):") ?? "";
    setBusyId(action.id);
    setNote(null);
    const result = await rejectAutomationAction(supabase, {
      actionId: action.id,
      companyId,
      approverEmail: actorEmail,
      notes,
    });
    setNote(result.ok ? "Action rejected." : `Reject failed: ${result.error}`);
    setBusyId(null);
    await reload();
  }

  async function handleSubmitDraft(action: WorkforceAutomationAction) {
    setBusyId(action.id);
    const result = await submitAutomationToQueue(
      supabase,
      action.id,
      companyId,
      actorEmail
    );
    setNote(result.ok ? "Sent to approval queue." : `Submit failed: ${result.error}`);
    setBusyId(null);
    await reload();
  }

  async function handleRetry(action: WorkforceAutomationAction) {
    setBusyId(action.id);
    setNote(null);
    const result = await retryFailedAutomationAction(supabase, {
      actionId: action.id,
      companyId,
      actorEmail,
    });
    setNote(
      result.ok
        ? result.message || "Retry succeeded."
        : `Retry failed: ${result.error || result.message}`
    );
    setBusyId(null);
    await reload();
  }

  return (
    <div className="space-y-6">
      <section className="rounded-[2rem] border border-white/80 bg-white/95 p-6 shadow-[0_18px_55px_rgba(15,23,42,0.12)]">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div>
            <div className="text-xs font-bold uppercase tracking-[0.35em] text-cyan-700">
              Automation Centre
            </div>
            <h2 className="mt-2 text-3xl font-black tracking-tight text-slate-950">
              Workforce Automation Engine
            </h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-500">
              AI may prepare workforce actions — managers must approve before anything is committed.
              Every approval and failure is logged.
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

        {note && (
          <p className="mt-4 rounded-2xl border border-cyan-200 bg-cyan-50 px-4 py-3 text-sm font-semibold text-cyan-950">
            {note}
          </p>
        )}
        {loadError && (
          <p className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-900">
            {loadError}
          </p>
        )}
        {!loading && dashboard && !dashboard.tablesAvailable && (
          <p className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-950">
            Run{" "}
            <code className="rounded bg-white px-1">sql/022-workforce-automation-engine.sql</code> in
            Supabase, then refresh.
          </p>
        )}
      </section>

      <ActionSection
        title="Pending AI Actions"
        subtitle="Actions prepared by Copilot — not yet submitted for approval."
        icon={ClipboardList}
        loading={loading}
        empty="No draft actions from AI Copilot."
        actions={dashboard?.pendingAiActions || []}
        renderActions={(action) => (
          <button
            type="button"
            disabled={busyId === action.id}
            onClick={() => void handleSubmitDraft(action)}
            className="rounded-xl bg-[#06101f] px-3 py-2 text-xs font-black text-cyan-300 disabled:opacity-50"
          >
            Send to approval queue
          </button>
        )}
      />

      <ActionSection
        title="Approval Queue"
        subtitle="Manager approval required before execution."
        icon={ShieldCheck}
        loading={loading}
        empty="No actions awaiting approval."
        actions={dashboard?.approvalQueue || []}
        renderActions={(action) => (
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busyId === action.id}
              onClick={() => void handleApprove(action)}
              className="rounded-xl bg-emerald-700 px-3 py-2 text-xs font-black text-white disabled:opacity-50"
            >
              Approve & execute
            </button>
            <button
              type="button"
              disabled={busyId === action.id}
              onClick={() => void handleReject(action)}
              className="rounded-xl bg-slate-200 px-3 py-2 text-xs font-black text-slate-800 disabled:opacity-50"
            >
              Reject
            </button>
          </div>
        )}
      />

      <ActionSection
        title="Completed Actions"
        subtitle="Audit trail of successfully executed actions."
        icon={CheckCircle2}
        loading={loading}
        empty="No completed actions yet."
        actions={(dashboard?.completedActions || []).slice(0, 15)}
      />

      <ActionSection
        title="Failed Actions"
        subtitle="Execution errors — review reason and retry."
        icon={AlertTriangle}
        loading={loading}
        empty="No failed actions."
        actions={dashboard?.failedActions || []}
        showError
        renderActions={(action) => (
          <button
            type="button"
            disabled={busyId === action.id}
            onClick={() => void handleRetry(action)}
            className="inline-flex items-center gap-1 rounded-xl bg-rose-700 px-3 py-2 text-xs font-black text-white disabled:opacity-50"
          >
            <RotateCcw className="h-3 w-3" />
            Retry
          </button>
        )}
      />
    </div>
  );
}

function ActionSection({
  title,
  subtitle,
  icon: Icon,
  loading,
  empty,
  actions,
  renderActions,
  showError,
}: {
  title: string;
  subtitle: string;
  icon: React.ComponentType<{ className?: string }>;
  loading: boolean;
  empty: string;
  actions: WorkforceAutomationAction[];
  renderActions?: (action: WorkforceAutomationAction) => React.ReactNode;
  showError?: boolean;
}) {
  return (
    <section className="rounded-[2rem] border border-white/80 bg-white/95 p-6 shadow-sm">
      <div className="flex items-center gap-2">
        <Icon className="h-5 w-5 text-cyan-700" />
        <div>
          <h3 className="text-lg font-black text-slate-950">{title}</h3>
          <p className="text-xs font-semibold text-slate-500">{subtitle}</p>
        </div>
      </div>

      <div className="mt-4 space-y-3">
        {loading ? (
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-500">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading…
          </div>
        ) : actions.length === 0 ? (
          <p className="text-sm font-semibold text-slate-500">{empty}</p>
        ) : (
          actions.map((action) => (
            <div
              key={action.id}
              className="rounded-2xl border border-slate-100 bg-slate-50/80 px-4 py-3"
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <div className="font-bold text-slate-950">{action.action_type}</div>
                  <div className="mt-1 text-xs text-slate-600">{action.reason}</div>
                </div>
                <span
                  className={`rounded-full border px-2.5 py-1 text-[10px] font-black uppercase ${automationStatusClass(action.status)}`}
                >
                  {action.status}
                </span>
              </div>
              <div className="mt-2 flex flex-wrap gap-3 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                <span>Source: {action.source_module}</span>
                {action.employee_id && <span>Employee: {action.employee_id}</span>}
                {action.prepared_by && <span>Prepared: {action.prepared_by}</span>}
                <span>{new Date(action.created_at).toLocaleString()}</span>
              </div>
              {showError && action.error_message && (
                <div className="mt-2 flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-900">
                  <XCircle className="mt-0.5 h-4 w-4 shrink-0" />
                  {action.error_message}
                </div>
              )}
              {renderActions && <div className="mt-3">{renderActions(action)}</div>}
            </div>
          ))
        )}
      </div>
    </section>
  );
}

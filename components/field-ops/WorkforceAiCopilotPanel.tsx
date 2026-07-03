"use client";

import React, { useCallback, useEffect, useState } from "react";
import {
  Bot,
  CheckCircle2,
  FileText,
  Loader2,
  Send,
  ShieldAlert,
  Sparkles,
  Terminal,
} from "lucide-react";
import {
  COPILOT_ACTION_PROMPTS,
  COPILOT_SKILLS,
  COPILOT_SUGGESTED_PROMPTS,
  fetchCopilotContext,
  runCopilotQuery,
  type CopilotActionProposal,
  type CopilotQueryResult,
  type CopilotResponseCard,
} from "@/lib/workforce-ai-copilot";
import {
  prepareAutomationAction,
  prepareFromCopilotProposal,
  submitAutomationToQueue,
  type AutomationActionType,
} from "@/lib/workforce-automation-engine";
import { riskBandClass } from "@/lib/workforce-risk-intelligence";
import { supabase } from "@/lib/supabase";

type Props = {
  companyId: string;
  userEmail?: string | null;
  onOpenAutomation?: () => void;
};

function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

const QUICK_PREPARE_ACTIONS: { label: string; type: AutomationActionType; template: string }[] = [
  { label: "Prepare Warning", type: "Create Warning", template: "Create warning for [employee]" },
  { label: "Prepare HR Case", type: "Create HR Case", template: "Create HR case for [employee]" },
  {
    label: "Prepare Leave Decision",
    type: "Approve Leave",
    template: "Approve leave for [employee]",
  },
  {
    label: "Prepare Roster Move",
    type: "Create Roster Change",
    template: "Move employee [name] to store [store]",
  },
  {
    label: "Prepare Field Job",
    type: "Create Field Job",
    template: "Assign employee [name] to job [ref]",
  },
];

export default function WorkforceAiCopilotPanel({
  companyId,
  userEmail,
  onOpenAutomation,
}: Props) {
  const [command, setCommand] = useState("");
  const [loading, setLoading] = useState(false);
  const [contextReady, setContextReady] = useState(false);
  const [history, setHistory] = useState<CopilotQueryResult[]>([]);
  const [lastDraftId, setLastDraftId] = useState<string | null>(null);
  const [actionBusy, setActionBusy] = useState(false);
  const [actionNote, setActionNote] = useState<string | null>(null);
  const [contextError, setContextError] = useState<string | null>(null);

  const actorEmail = userEmail || "copilot@vyron";

  const loadContext = useCallback(async () => {
    if (!companyId) return null;
    setContextError(null);
    return fetchCopilotContext(supabase, companyId, todayIsoDate());
  }, [companyId]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setContextReady(false);
      const ctx = await loadContext();
      if (!cancelled) {
        setContextReady(Boolean(ctx));
        if (!ctx && companyId) setContextError("Unable to load workforce context.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [companyId, loadContext]);

  async function submitCommand(text: string) {
    const trimmed = text.trim();
    if (!trimmed || !companyId) return;
    setLoading(true);
    setActionNote(null);
    const ctx = await loadContext();
    if (!ctx) {
      setContextError("Unable to run query — no company context.");
      setLoading(false);
      return;
    }
    const result = runCopilotQuery(ctx, trimmed);
    setHistory((prev) => [result, ...prev].slice(0, 12));
    setCommand("");
    setLoading(false);
  }

  async function prepareProposal(proposal: CopilotActionProposal, submitToQueue: boolean) {
    if (!companyId) return;
    setActionBusy(true);
    setActionNote(null);
    const result = await prepareFromCopilotProposal(supabase, {
      companyId,
      proposal,
      preparedByEmail: actorEmail,
      reason: proposal.description,
      submitToQueue,
    });
    if (result.error || !result.action) {
      setActionNote(`Prepare failed: ${result.error || "Unknown error"}`);
    } else {
      setLastDraftId(result.action.id);
      setActionNote(
        submitToQueue
          ? `Sent to approval queue (${result.action.action_type}). Open Automation Centre to approve.`
          : `Prepared draft: ${result.action.action_type}. Use “Send To Approval Queue” or open Automation Centre.`
      );
    }
    setActionBusy(false);
  }

  async function sendLastDraftToQueue() {
    if (!lastDraftId || !companyId) {
      setActionNote("No draft action to submit. Prepare an action first.");
      return;
    }
    setActionBusy(true);
    const result = await submitAutomationToQueue(
      supabase,
      lastDraftId,
      companyId,
      actorEmail
    );
    setActionNote(
      result.ok
        ? "Draft sent to approval queue."
        : `Submit failed: ${result.error}`
    );
    setActionBusy(false);
  }

  async function quickPrepare(type: AutomationActionType, template: string) {
    setCommand(template);
    if (type === "Create Field Job") {
      if (!companyId) return;
      setActionBusy(true);
      const result = await prepareAutomationAction(supabase, {
        companyId,
        actionType: type,
        preparedByEmail: actorEmail,
        reason: "Field job prepared from AI Copilot quick action.",
        payload: {
          title: "Copilot scheduled visit",
          site_type: "customer_address",
          description: "Prepared via Workforce AI Copilot",
        },
      });
      if (result.action) setLastDraftId(result.action.id);
      setActionNote(
        result.error
          ? `Prepare failed: ${result.error}`
          : "Field job draft prepared. Complete details in Automation Centre."
      );
      setActionBusy(false);
      return;
    }
    void submitCommand(template);
  }

  return (
    <div className="space-y-6">
      <section className="rounded-[2rem] border border-white/80 bg-white/95 p-6 shadow-[0_18px_55px_rgba(15,23,42,0.12)]">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div>
            <div className="text-xs font-bold uppercase tracking-[0.35em] text-cyan-700">
              AI Command Centre
            </div>
            <h2 className="mt-2 text-3xl font-black tracking-tight text-slate-950">
              Workforce AI Copilot
            </h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-500">
              Natural-language workforce queries and report generation. Actions are prepared only —
              managers approve in Automation Centre before commit.
            </p>
          </div>
          <div className="flex flex-col gap-2">
            <div className="rounded-full bg-cyan-100 px-4 py-2 text-center text-xs font-black uppercase tracking-wider text-cyan-800">
              {COPILOT_SKILLS.length} AI skills
            </div>
            {onOpenAutomation && (
              <button
                type="button"
                onClick={onOpenAutomation}
                className="rounded-2xl border border-slate-200 bg-white px-4 py-2 text-xs font-black text-slate-700"
              >
                Open Automation Centre
              </button>
            )}
          </div>
        </div>
        {contextError && (
          <p className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-950">
            {contextError}
          </p>
        )}
      </section>

      <section className="rounded-[1.5rem] border border-white/80 bg-white/95 p-4 shadow-sm">
        <div className="text-[10px] font-black uppercase tracking-wider text-slate-500">
          Quick prepare (draft → approval queue)
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          {QUICK_PREPARE_ACTIONS.map((item) => (
            <button
              key={item.label}
              type="button"
              disabled={actionBusy || !contextReady}
              onClick={() => void quickPrepare(item.type, item.template)}
              className="rounded-xl bg-slate-100 px-3 py-2 text-xs font-black text-slate-800 hover:bg-slate-200 disabled:opacity-50"
            >
              {item.label}
            </button>
          ))}
          <button
            type="button"
            disabled={actionBusy || !lastDraftId}
            onClick={() => void sendLastDraftToQueue()}
            className="rounded-xl bg-[#06101f] px-3 py-2 text-xs font-black text-cyan-300 disabled:opacity-50"
          >
            Send To Approval Queue
          </button>
        </div>
      </section>

      <section className="grid gap-6 xl:grid-cols-[0.9fr_1.1fr]">
        <div className="rounded-[2rem] border border-slate-900/10 bg-[#06101f] p-6 text-white shadow-xl">
          <div className="flex items-center gap-3">
            <Bot className="h-7 w-7 text-cyan-300" />
            <div>
              <div className="text-xs font-black uppercase tracking-[0.35em] text-cyan-300">
                Command input
              </div>
              <div className="text-lg font-black">Ask VYRON CORE</div>
            </div>
          </div>

          <form
            className="mt-5 flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void submitCommand(command);
            }}
          >
            <input
              value={command}
              onChange={(e) => setCommand(e.target.value)}
              placeholder="Who is late today?"
              className="flex-1 rounded-2xl border border-white/10 bg-white/10 px-4 py-3 text-sm font-semibold text-white placeholder:text-slate-400"
              disabled={loading || !contextReady}
            />
            <button
              type="submit"
              disabled={loading || !command.trim() || !contextReady}
              className="inline-flex items-center gap-2 rounded-2xl bg-cyan-500 px-4 py-3 text-sm font-black text-slate-950 disabled:opacity-50"
            >
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              Run
            </button>
          </form>

          <div className="mt-6">
            <div className="text-[10px] font-black uppercase tracking-wider text-slate-400">
              Suggested prompts
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {COPILOT_SUGGESTED_PROMPTS.map((prompt) => (
                <button
                  key={prompt}
                  type="button"
                  onClick={() => void submitCommand(prompt)}
                  className="rounded-xl bg-white/10 px-3 py-2 text-left text-xs font-semibold text-slate-200 hover:bg-white/15"
                >
                  {prompt}
                </button>
              ))}
            </div>
          </div>

          <div className="mt-6 border-t border-white/10 pt-5">
            <div className="text-[10px] font-black uppercase tracking-wider text-slate-400">
              Action commands (prepare only)
            </div>
            <div className="mt-3 space-y-2">
              {COPILOT_ACTION_PROMPTS.map((prompt) => (
                <button
                  key={prompt}
                  type="button"
                  onClick={() => setCommand(prompt)}
                  className="block w-full rounded-xl bg-white/5 px-3 py-2 text-left text-xs font-semibold text-slate-300 hover:bg-white/10"
                >
                  {prompt}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="space-y-4">
          <div className="rounded-[2rem] border border-white/80 bg-white/95 p-5 shadow-sm">
            <div className="flex items-center gap-2">
              <Terminal className="h-5 w-5 text-cyan-700" />
              <h3 className="text-lg font-black text-slate-950">Workforce query engine</h3>
            </div>
            <p className="mt-2 text-sm text-slate-500">
              Parses commands and routes to clocking, leave, HR, field ops, travel, cost, and risk
              modules. {!contextReady && "Loading context…"}
            </p>
          </div>

          {actionNote && (
            <div className="rounded-2xl border border-cyan-200 bg-cyan-50 px-4 py-3 text-sm font-semibold text-cyan-950">
              {actionNote}
            </div>
          )}

          {loading && (
            <div className="rounded-[2rem] border border-white/80 bg-white/95 p-6 text-sm font-semibold text-slate-500">
              Running workforce query…
            </div>
          )}

          {!loading && history.length === 0 && (
            <div className="rounded-[2rem] border border-dashed border-slate-200 bg-white/80 p-8 text-center">
              <Sparkles className="mx-auto h-8 w-8 text-cyan-600" />
              <p className="mt-3 text-sm font-semibold text-slate-500">
                Submit a command or pick a suggested prompt to generate AI response cards.
              </p>
            </div>
          )}

          {history.map((result) => (
            <div key={result.id} className="space-y-3">
              <div className="text-xs font-black uppercase tracking-wider text-slate-400">
                &gt; {result.command}
              </div>
              {result.cards.map((c) => (
                <ResponseCard
                  key={c.id}
                  card={c}
                  onPrepare={(action, queue) => void prepareProposal(action, queue)}
                />
              ))}
            </div>
          ))}
        </div>
      </section>

    </div>
  );
}

function ResponseCard({
  card,
  onPrepare,
}: {
  card: CopilotResponseCard;
  onPrepare: (action: CopilotActionProposal, submitToQueue: boolean) => void;
}) {
  const bandClass = card.band ? riskBandClass(card.band) : "border-slate-200 bg-white";

  return (
    <div className={`rounded-[1.5rem] border p-5 shadow-sm ${bandClass}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          {card.type === "report" ? (
            <FileText className="h-5 w-5 text-violet-600" />
          ) : card.type === "action" ? (
            <ShieldAlert className="h-5 w-5 text-amber-600" />
          ) : (
            <CheckCircle2 className="h-5 w-5 text-cyan-700" />
          )}
          <div className="font-black text-slate-950">{card.title}</div>
        </div>
        {card.skillId && (
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold uppercase text-slate-500">
            {card.skillId.replace(/_/g, " ")}
          </span>
        )}
      </div>
      <p className="mt-2 text-sm font-semibold text-slate-700">{card.summary}</p>

      {card.rows && card.rows.length > 0 && (
        <div className="mt-4 space-y-2">
          {card.rows.map((row, idx) => (
            <div
              key={`${row.label}-${idx}`}
              className="flex flex-wrap items-baseline justify-between gap-2 rounded-xl bg-white/60 px-3 py-2 text-xs"
            >
              <span className="font-bold text-slate-900">{row.label}</span>
              <span className="font-semibold text-slate-700">{row.value}</span>
              {row.meta && <span className="w-full text-slate-500">{row.meta}</span>}
            </div>
          ))}
        </div>
      )}

      {card.reportText && (
        <pre className="mt-4 max-h-48 overflow-auto rounded-xl bg-slate-900 p-4 text-xs leading-relaxed text-cyan-100">
          {card.reportText}
        </pre>
      )}

      {card.action && (
        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => onPrepare(card.action!, false)}
            className="rounded-2xl bg-cyan-100 px-4 py-2.5 text-xs font-black text-cyan-900"
          >
            Prepare {card.action.title}
          </button>
          <button
            type="button"
            onClick={() => onPrepare(card.action!, true)}
            className="rounded-2xl bg-[#06101f] px-4 py-2.5 text-xs font-black text-cyan-300"
          >
            Send To Approval Queue
          </button>
        </div>
      )}
    </div>
  );
}

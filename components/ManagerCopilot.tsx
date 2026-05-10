"use client";

import { Bot, CheckCircle2, MessageSquare, Send, Sparkles } from "lucide-react";

const prompts = [
  "Which employees need manager review before payroll?",
  "Which stores have the highest labour leakage this month?",
  "Who has repeated late arrival patterns?",
  "What must be cleared before payroll export?",
];

export default function ManagerCopilot() {
  return (
    <section className="rounded-[34px] border border-white/80 bg-white/95 p-6 shadow-[0_24px_70px_rgba(15,23,42,0.13)] backdrop-blur-xl">
      <div className="flex flex-col gap-5 xl:flex-row xl:items-center xl:justify-between">
        <div>
          <div className="text-xs font-black uppercase tracking-[0.35em] text-cyan-700">Manager Co-Pilot</div>
          <h2 className="mt-3 text-3xl font-black tracking-tight text-slate-950">AI Manager Action Assistant</h2>
          <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-500">
            A future AI assistant layer that helps managers ask operational questions and receive action-focused answers.
          </p>
        </div>
        <div className="rounded-full bg-cyan-100 px-4 py-2 text-sm font-black text-cyan-700">Co-pilot concept</div>
      </div>

      <div className="mt-8 grid gap-6 xl:grid-cols-[0.8fr_1.2fr]">
        <div className="rounded-[30px] bg-[#06101f] p-6 text-white">
          <Bot className="h-8 w-8 text-cyan-300" />
          <h3 className="mt-5 text-2xl font-black">Ask VYRON CORE</h3>
          <p className="mt-3 text-sm leading-6 text-slate-300">
            The co-pilot can later read payroll checks, exceptions, leave, rosters and HR cases to recommend next actions.
          </p>
          <div className="mt-6 space-y-3">
            {prompts.map((prompt) => (
              <button key={prompt} className="w-full rounded-2xl bg-white/10 px-4 py-3 text-left text-sm font-semibold text-slate-200 hover:bg-white/15">
                {prompt}
              </button>
            ))}
          </div>
        </div>

        <div className="rounded-[30px] border border-slate-200 bg-white p-6">
          <div className="flex items-center gap-3">
            <div className="rounded-2xl bg-cyan-100 p-3 text-cyan-700"><Sparkles className="h-5 w-5" /></div>
            <div>
              <div className="font-black text-slate-950">Suggested answer preview</div>
              <div className="text-sm text-slate-500">Generated management summary</div>
            </div>
          </div>

          <div className="mt-6 rounded-[26px] bg-slate-50 p-5 text-sm leading-7 text-slate-700">
            Payroll cannot be exported cleanly yet. There are 14 blockers, mainly missing clock-outs and GPS mismatches.
            The highest risk stores are Waterstone and Somerset Mall. Recommended action: clear missing clocks first,
            then approve or reject overtime exceptions before payroll lock.
          </div>

          <div className="mt-6 flex flex-col gap-3 md:flex-row">
            <button className="flex items-center justify-center gap-2 rounded-2xl bg-[#06101f] px-5 py-3 text-sm font-black text-cyan-300">
              <Send className="h-4 w-4" /> Send to manager
            </button>
            <button className="flex items-center justify-center gap-2 rounded-2xl bg-slate-100 px-5 py-3 text-sm font-black text-slate-700">
              <MessageSquare className="h-4 w-4" /> Save summary
            </button>
          </div>
        </div>
      </div>

      <div className="mt-6 rounded-[28px] bg-emerald-50 p-5 text-emerald-800">
        <div className="flex items-center gap-3">
          <CheckCircle2 className="h-6 w-6" />
          <div>
            <div className="font-black">Implementation note</div>
            <p className="mt-1 text-sm">This can later connect to your Supabase data with safe server-side summaries.</p>
          </div>
        </div>
      </div>
    </section>
  );
}

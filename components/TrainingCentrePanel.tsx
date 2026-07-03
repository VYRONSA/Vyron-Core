"use client";

import React, { useEffect, useMemo, useState } from "react";
import { BookOpen, CheckCircle2, ChevronRight } from "lucide-react";
import {
  computeTrainingProgressPercent,
  markTrainingArticleComplete,
  readTrainingProgress,
} from "@/lib/pilot-client-readiness";
import { TRAINING_SECTIONS } from "@/lib/training-centre-content";

type Props = {
  companyId?: string;
  onProgressChange?: (completedIds: string[]) => void;
};

export default function TrainingCentrePanel({ companyId = "", onProgressChange }: Props) {
  const [activeSection, setActiveSection] = useState<string>(TRAINING_SECTIONS[0].id);
  const [completedIds, setCompletedIds] = useState<string[]>([]);

  useEffect(() => {
    if (!companyId) {
      setCompletedIds([]);
      return;
    }
    const ids = readTrainingProgress(companyId);
    setCompletedIds(ids);
    onProgressChange?.(ids);
  }, [companyId, onProgressChange]);

  const section = TRAINING_SECTIONS.find((s) => s.id === activeSection) || TRAINING_SECTIONS[0];
  const progressPercent = useMemo(
    () => computeTrainingProgressPercent(completedIds),
    [completedIds]
  );

  function toggleArticle(articleId: string) {
    if (!companyId) return;
    const next = markTrainingArticleComplete(companyId, articleId);
    setCompletedIds(next);
    onProgressChange?.(next);
  }

  return (
    <div className="space-y-6">
      <section className="rounded-[2rem] border border-white/80 bg-white/95 p-6 shadow-sm">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <div className="text-xs font-bold uppercase tracking-[0.35em] text-cyan-700">
              Training Centre
            </div>
            <h2 className="mt-2 text-2xl font-black text-slate-950">VYRON CORE guides</h2>
            <p className="mt-2 text-sm text-slate-500">
              Mark guides complete as you walk through pilot onboarding. Progress is saved per
              workspace.
            </p>
          </div>
          <div className="rounded-2xl bg-slate-950 px-5 py-3 text-center text-white">
            <div className="text-xs font-black uppercase tracking-wider text-cyan-300">Progress</div>
            <div className="text-3xl font-black">{progressPercent}%</div>
          </div>
        </div>
        <div className="mt-4 h-2 rounded-full bg-slate-200">
          <div
            className="h-2 rounded-full bg-gradient-to-r from-blue-600 to-cyan-400 transition-all"
            style={{ width: `${progressPercent}%` }}
          />
        </div>
      </section>

      <div className="grid gap-6 lg:grid-cols-[280px_1fr]">
        <nav className="space-y-1 rounded-[1.5rem] border border-slate-200 bg-white p-3">
          {TRAINING_SECTIONS.map((item) => {
            const sectionDone = item.articles.every((a) => completedIds.includes(a.id));
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setActiveSection(item.id)}
                className={`flex w-full items-center justify-between rounded-xl px-4 py-3 text-left text-sm font-bold ${
                  activeSection === item.id
                    ? "bg-[#06101f] text-cyan-300"
                    : "text-slate-700 hover:bg-slate-50"
                }`}
              >
                <span className="flex items-center gap-2">
                  {sectionDone && <CheckCircle2 className="h-4 w-4 text-emerald-400" />}
                  {item.title}
                </span>
                <ChevronRight className="h-4 w-4 opacity-60" />
              </button>
            );
          })}
        </nav>

        <section className="rounded-[1.5rem] border border-white/80 bg-white/95 p-6 shadow-sm">
          <div className="flex items-center gap-2 text-sm font-black uppercase tracking-wider text-slate-500">
            <BookOpen className="h-4 w-4" />
            {section.title}
          </div>
          <div className="mt-6 space-y-6">
            {section.articles.map((article) => {
              const done = completedIds.includes(article.id);
              return (
                <article
                  key={article.id}
                  className={`rounded-2xl border p-5 ${
                    done ? "border-emerald-200 bg-emerald-50/60" : "border-slate-100 bg-slate-50/80"
                  }`}
                >
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <h3 className="text-lg font-black text-slate-950">{article.title}</h3>
                      <p className="mt-2 text-sm leading-6 text-slate-600">{article.body}</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => toggleArticle(article.id)}
                      disabled={!companyId}
                      className={`shrink-0 rounded-xl px-4 py-2 text-xs font-black ${
                        done
                          ? "bg-emerald-600 text-white"
                          : "bg-[#06101f] text-cyan-300 disabled:opacity-50"
                      }`}
                    >
                      {done ? "Completed" : "Mark complete"}
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      </div>
    </div>
  );
}

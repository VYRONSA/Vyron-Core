"use client";

import React from "react";

/**
 * Road & Recovery shared UI primitives.
 *
 * These exist so the vertical stops looking like a bolt-on. Every token here is lifted
 * from the VYRON CORE shell (app/_app-shell.tsx and app/globals.css) rather than invented:
 * the dark hero is the same `from-[#07101f] to-[#0b1a33]` gradient the CORE Header uses,
 * cards are the same `rounded-[28px] border border-slate-200 bg-white` surface, and the
 * eyebrow/label idiom is the same `font-black uppercase tracking-[0.25em]` CORE uses.
 *
 * Nothing here fetches, derives or fabricates data. Empty states describe what the screen
 * WILL show and what produces it, so an unconfigured tenant reads as "not started yet"
 * rather than "broken".
 */

/* ------------------------------------------------------------------ page header ----- */

export function RRPageHeader({
  eyebrow = "Road & Recovery",
  title,
  description,
  actions,
  meta,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  actions?: React.ReactNode;
  meta?: React.ReactNode;
}) {
  return (
    <header className="rounded-[34px] bg-gradient-to-r from-[#07101f] to-[#0b1a33] p-6 text-white shadow-2xl shadow-slate-300 md:p-7">
      <div className="flex flex-col gap-6 xl:flex-row xl:items-start xl:justify-between">
        <div className="min-w-0">
          <div className="text-xs font-bold uppercase tracking-[0.4em] text-cyan-300">
            {eyebrow}
          </div>
          <h1 className="mt-2 text-3xl font-bold tracking-tight md:text-4xl">{title}</h1>
          {description ? (
            <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-300">{description}</p>
          ) : null}
          {meta ? <div className="mt-4 flex flex-wrap items-center gap-3">{meta}</div> : null}
        </div>
        {actions ? (
          <div className="flex flex-wrap items-center gap-2 xl:justify-end">{actions}</div>
        ) : null}
      </div>
    </header>
  );
}

/* ------------------------------------------------------------------------ surface ---- */

export function RRCard({
  children,
  className = "",
  padded = true,
}: {
  children: React.ReactNode;
  className?: string;
  padded?: boolean;
}) {
  return (
    <section
      className={`rounded-[28px] border border-slate-200 bg-white shadow-[0_14px_40px_rgba(15,23,42,0.08)] ${
        padded ? "p-5 md:p-6" : ""
      } ${className}`}
    >
      {children}
    </section>
  );
}

export function RRSectionTitle({
  children,
  hint,
  actions,
}: {
  children: React.ReactNode;
  hint?: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <h2 className="text-xs font-black uppercase tracking-[0.25em] text-slate-500">
          {children}
        </h2>
        {hint ? <p className="mt-1 text-sm text-slate-500">{hint}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

/* -------------------------------------------------------------------- empty state ---- */

/**
 * An empty state that reads as an operational status, not a gap.
 *
 * `title` says what is true right now. `description` says what will populate it. `hint`
 * carries the one action that changes it, when there is one. No illustration, because a
 * control room does not need a cartoon — it needs to know whether the board is quiet or
 * broken.
 */
export function RREmptyState({
  title,
  description,
  hint,
  tone = "quiet",
  action,
}: {
  title: string;
  description?: string;
  hint?: string;
  tone?: "quiet" | "ready" | "attention";
  action?: React.ReactNode;
}) {
  const ring =
    tone === "attention"
      ? "border-amber-200 bg-amber-50/60"
      : tone === "ready"
        ? "border-cyan-200 bg-cyan-50/50"
        : "border-slate-200 bg-slate-50/70";
  const dot =
    tone === "attention" ? "bg-amber-500" : tone === "ready" ? "bg-cyan-500" : "bg-slate-400";

  return (
    <div className={`rounded-[22px] border border-dashed px-5 py-8 text-center ${ring}`}>
      <div className="mx-auto flex max-w-md flex-col items-center gap-3">
        <span className={`h-2.5 w-2.5 rounded-full ${dot}`} aria-hidden="true" />
        <p className="text-sm font-black uppercase tracking-[0.18em] text-slate-700">{title}</p>
        {description ? (
          <p className="text-sm leading-6 text-slate-600">{description}</p>
        ) : null}
        {hint ? (
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">
            {hint}
          </p>
        ) : null}
        {action ? <div className="mt-1">{action}</div> : null}
      </div>
    </div>
  );
}

/**
 * Compact empty state for a board lane.
 *
 * A full RREmptyState card per lane would dominate a three-column board where most lanes
 * are legitimately empty most of the time. This keeps the lane readable while still saying
 * what would appear there, so an empty column reads as "quiet" rather than "not built".
 */
export function RRLaneEmpty({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50/70 px-3 py-5 text-center">
      <p className="text-xs leading-5 text-slate-500">{children}</p>
    </div>
  );
}

/* --------------------------------------------------------------------------- bits ---- */

export function RRBadge({
  children,
  tone = "neutral",
}: {
  children: React.ReactNode;
  tone?: "neutral" | "live" | "warn" | "danger" | "good";
}) {
  const map: Record<string, string> = {
    neutral: "bg-slate-100 text-slate-700 ring-slate-200",
    live: "bg-cyan-50 text-cyan-800 ring-cyan-200",
    warn: "bg-amber-50 text-amber-900 ring-amber-200",
    danger: "bg-rose-50 text-rose-800 ring-rose-200",
    good: "bg-emerald-50 text-emerald-800 ring-emerald-200",
  };
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-black uppercase tracking-[0.12em] ring-1 ${map[tone]}`}
    >
      {children}
    </span>
  );
}

export function RRStat({
  label,
  value,
  hint,
}: {
  label: string;
  value: React.ReactNode;
  hint?: string;
}) {
  return (
    <div className="rounded-[22px] border border-slate-200 bg-white px-4 py-4 shadow-sm">
      <div className="text-[11px] font-black uppercase tracking-[0.2em] text-slate-500">
        {label}
      </div>
      <div className="mt-1 text-2xl font-black tabular-nums text-slate-900">{value}</div>
      {hint ? <div className="mt-1 text-xs text-slate-500">{hint}</div> : null}
    </div>
  );
}

/* ---------------------------------------------------------------- loading / error ---- */

export function RRLoading({ label = "Loading workspace" }: { label?: string }) {
  return (
    <RRCard>
      <div className="flex items-center gap-3">
        <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-cyan-500" aria-hidden="true" />
        <p className="text-sm font-bold text-slate-600">{label}…</p>
      </div>
      <div className="mt-4 space-y-2" aria-hidden="true">
        <div className="h-3 w-2/3 animate-pulse rounded-full bg-slate-100" />
        <div className="h-3 w-1/2 animate-pulse rounded-full bg-slate-100" />
        <div className="h-3 w-5/6 animate-pulse rounded-full bg-slate-100" />
      </div>
    </RRCard>
  );
}

export function RRError({ message }: { message: string }) {
  return (
    <div
      role="alert"
      className="rounded-[28px] border border-rose-200 bg-rose-50 px-5 py-4 shadow-sm"
    >
      <p className="text-xs font-black uppercase tracking-[0.25em] text-rose-700">
        Workspace unavailable
      </p>
      <p className="mt-2 text-sm leading-6 text-rose-900">{message}</p>
    </div>
  );
}

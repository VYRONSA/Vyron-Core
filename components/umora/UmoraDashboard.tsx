"use client";

// Presentational building blocks for the UMORA Command Centre, drawn to the
// approved UMORA software dashboard reference. They render only what the
// caller passes in — every figure comes from the active company's live
// workspace data computed in app/_app-shell.tsx. Nothing here fetches data or
// invents numbers; there are no illustrative deltas.

import NextImage from "next/image";
import type { ReactNode } from "react";
import { ArrowRight, Check, ChevronRight, CircleDashed, RefreshCw } from "lucide-react";
import { UmoraPillars, UmoraSignature } from "@/components/brand/UmoraBrand";
import { heroPerson } from "@/lib/marketing/umora-media";
import { productBrand } from "@/lib/brand";

type Tone = "green" | "blue" | "amber" | "purple" | "red" | "teal";

const toneTile: Record<Tone, string> = {
  green: "bg-emerald-50 text-emerald-700 ring-emerald-100",
  blue: "bg-blue-50 text-blue-600 ring-blue-100",
  amber: "bg-amber-50 text-amber-600 ring-amber-100",
  purple: "bg-violet-50 text-violet-600 ring-violet-100",
  red: "bg-rose-50 text-rose-600 ring-rose-100",
  teal: "bg-teal-50 text-teal-700 ring-teal-100",
};

const toneCard: Record<Tone, string> = {
  green: "border-emerald-100 bg-gradient-to-br from-emerald-50/80 to-white hover:border-emerald-200",
  blue: "border-blue-100 bg-gradient-to-br from-blue-50/80 to-white hover:border-blue-200",
  amber: "border-amber-100 bg-gradient-to-br from-amber-50/80 to-white hover:border-amber-200",
  purple: "border-violet-100 bg-gradient-to-br from-violet-50/80 to-white hover:border-violet-200",
  red: "border-rose-100 bg-gradient-to-br from-rose-50/80 to-white hover:border-rose-200",
  teal: "border-teal-100 bg-gradient-to-br from-teal-50/80 to-white hover:border-teal-200",
};

const toneRing: Record<Tone, string> = {
  green: "border-emerald-300 text-emerald-700",
  blue: "border-blue-300 text-blue-600",
  amber: "border-amber-300 text-amber-600",
  purple: "border-violet-300 text-violet-600",
  red: "border-rose-300 text-rose-600",
  teal: "border-teal-300 text-teal-700",
};

/* ------------------------------------------------------------------ card */

export function UmoraCard({
  title,
  action,
  children,
  className = "",
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`flex min-w-0 flex-col rounded-[20px] border border-slate-200/70 bg-white p-5 shadow-[0_1px_2px_rgba(16,42,76,0.04),0_10px_28px_rgba(16,42,76,0.06)] ${className}`}>
      <div className="mb-4 flex items-center justify-between gap-3">
        <h3 className="umora-sans text-[1.05rem] font-bold text-[#0f1d33]">{title}</h3>
        {action}
      </div>
      <div className="min-h-0 flex-1">{children}</div>
    </div>
  );
}

export function UmoraCardLink({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex shrink-0 items-center gap-1 text-xs font-bold text-emerald-700 transition hover:text-emerald-900"
    >
      {label}
      <ArrowRight className="h-3.5 w-3.5" />
    </button>
  );
}

/* ------------------------------------------------------------------ hero */

export function UmoraDashboardHero({
  onRefresh,
  footnote,
}: {
  onRefresh: () => void;
  footnote?: string;
}) {
  return (
    <section className="umora-hero relative isolate overflow-hidden rounded-[22px] text-white shadow-[0_18px_50px_rgba(4,32,27,0.28)]">
      <div className="absolute inset-y-0 right-0 -z-10 w-full md:w-[62%]">
        {heroPerson.src && (
          <NextImage
            src={heroPerson.src}
            alt=""
            fill
            priority
            sizes="(max-width: 768px) 100vw, 62vw"
            className="object-cover"
            style={{ objectPosition: heroPerson.position }}
          />
        )}
        <div className="umora-hero-photo-fade absolute inset-0" />
      </div>

      <UmoraSignature className="absolute right-6 top-8 hidden text-[2.6rem] xl:block 2xl:right-12 2xl:text-[3rem]" />

      <div className="relative max-w-2xl px-7 py-9 md:px-10 md:py-11">
        <div className="umora-sans text-[0.7rem] font-semibold uppercase tracking-[0.4em] text-white/85">
          Welcome to {productBrand.mark}
        </div>
        <h1 className="umora-sans mt-4 text-[2.35rem] font-extrabold leading-[1.02] tracking-tight md:text-[3.1rem]">
          Your people power
          <span className="block text-[#4fe3a1]">what&apos;s next.</span>
        </h1>
        <p className="mt-4 max-w-xl text-[0.98rem] leading-7 text-white/85 md:text-base">
          Turn everyday workforce data into clearer decisions, healthier teams and a stronger, more resilient business.
        </p>
        <div className="mt-6 flex flex-wrap items-center gap-x-6 gap-y-4">
          <UmoraPillars rule className="text-white/80" />
        </div>
        <div className="mt-6 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={onRefresh}
            className="inline-flex items-center gap-2 rounded-xl border border-white/20 bg-white/10 px-4 py-2 text-xs font-semibold text-white backdrop-blur transition hover:bg-white/20"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Refresh live data
          </button>
          {footnote && <span className="text-xs text-white/60">{footnote}</span>}
        </div>
      </div>
    </section>
  );
}

/* --------------------------------------------------------- quick actions */

export function UmoraQuickAction({
  icon,
  title,
  subtitle,
  tone,
  onClick,
}: {
  icon: ReactNode;
  title: string;
  subtitle: string;
  tone: Tone;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`group flex min-w-0 items-center gap-3 rounded-[18px] border px-4 py-4 text-left shadow-[0_1px_2px_rgba(16,42,76,0.04)] transition hover:-translate-y-0.5 hover:shadow-[0_12px_28px_rgba(16,42,76,0.08)] ${toneCard[tone]}`}
    >
      <span className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl ring-1 ${toneTile[tone]}`}>{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="umora-sans block text-[0.95rem] font-bold leading-tight text-[#0f1d33]">{title}</span>
        <span className="mt-0.5 block truncate text-xs text-slate-500">{subtitle}</span>
      </span>
      <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-2 bg-white/70 transition group-hover:translate-x-0.5 ${toneRing[tone]}`}>
        <ArrowRight className="h-4 w-4" />
      </span>
    </button>
  );
}

/* ------------------------------------------------------------------ KPIs */

export function UmoraKpiCard({
  icon,
  value,
  label,
  caption,
  captionTone = "muted",
  tone,
  onClick,
}: {
  icon: ReactNode;
  value: string | number;
  label: string;
  caption: string;
  captionTone?: "good" | "warn" | "muted";
  tone: Tone;
  onClick: () => void;
}) {
  const captionClass =
    captionTone === "good" ? "text-emerald-700" : captionTone === "warn" ? "text-rose-600" : "text-slate-500";
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex min-w-0 items-center gap-4 rounded-[20px] border border-slate-200/70 bg-white p-5 text-left shadow-[0_1px_2px_rgba(16,42,76,0.04),0_10px_28px_rgba(16,42,76,0.06)] transition hover:-translate-y-0.5 hover:shadow-[0_2px_4px_rgba(16,42,76,0.05),0_18px_40px_rgba(16,42,76,0.1)]"
    >
      <span className={`flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl ring-1 ${toneTile[tone]}`}>{icon}</span>
      <span className="min-w-0">
        <span className="umora-sans vyron-tabular block truncate text-[1.75rem] font-extrabold leading-tight text-[#0f1d33]">{value}</span>
        <span className="block text-[0.95rem] text-slate-600">{label}</span>
        <span className={`mt-1 block truncate text-xs font-semibold ${captionClass}`}>{caption}</span>
      </span>
    </button>
  );
}

/* ------------------------------------------------------ attendance trend */

export type UmoraTrendDay = { key: string; label: string; value: number; detail: string };

/**
 * Single-series column chart: distinct employees who clocked in each day.
 * One series, so no legend box — the card title names it. Each column carries
 * a native tooltip and the numbers are also exposed as a screen-reader table.
 */
export function UmoraTrendChart({ days, emptyText }: { days: UmoraTrendDay[]; emptyText: string }) {
  const max = Math.max(1, ...days.map((day) => day.value));
  const hasData = days.some((day) => day.value > 0);
  const ticks = [max, Math.round(max / 2), 0];

  return (
    <div>
      <div className="relative flex h-44 gap-3">
        <div className="flex w-8 shrink-0 flex-col justify-between pb-6 text-right text-[11px] text-slate-400 vyron-tabular">
          {ticks.map((tick, index) => (
            <span key={`${tick}-${index}`}>{tick}</span>
          ))}
        </div>
        <div className="relative flex min-w-0 flex-1 items-end gap-2 pb-6 sm:gap-3">
          <div className="pointer-events-none absolute inset-x-0 top-0 border-t border-dashed border-slate-200" />
          <div className="pointer-events-none absolute inset-x-0 top-1/2 border-t border-dashed border-slate-200" />
          <div className="pointer-events-none absolute inset-x-0 bottom-6 border-t border-slate-200" />
          {days.map((day) => (
            <div key={day.key} className="group relative flex h-full min-w-0 flex-1 flex-col items-center justify-end">
              <div
                className="w-full max-w-[34px] rounded-t-[4px] bg-gradient-to-t from-emerald-600 to-emerald-400 transition group-hover:from-emerald-700 group-hover:to-emerald-500"
                style={{ height: `${Math.max(day.value > 0 ? 4 : 0, (day.value / max) * 100)}%` }}
                title={`${day.label}: ${day.detail}`}
              />
              <span className="pointer-events-none absolute -top-7 z-10 hidden whitespace-nowrap rounded-lg bg-[#0f1d33] px-2 py-1 text-[11px] font-semibold text-white shadow-lg group-hover:block">
                {day.detail}
              </span>
              <span className="absolute -bottom-6 text-[11px] text-slate-500">{day.label}</span>
            </div>
          ))}
          {!hasData && (
            <div className="absolute inset-0 flex items-center justify-center pb-6 text-center text-sm text-slate-400">{emptyText}</div>
          )}
        </div>
      </div>
      <table className="sr-only">
        <caption>Employees clocked in per day</caption>
        <tbody>
          {days.map((day) => (
            <tr key={day.key}>
              <th scope="row">{day.label}</th>
              <td>{day.value}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ---------------------------------------------------------- site mix donut */

// Categorical order is fixed (validated with the dataviz palette checker on the
// white card surface). Colour follows the slice position after sorting by
// headcount; the final grey slot is reserved for "Other"/"Unassigned".
export const UMORA_SITE_COLORS = ["#2f6fe4", "#1e9e67", "#e59a1a", "#8b5cf6", "#d9467a"] as const;
export const UMORA_OTHER_COLOR = "#94a3b8";

export type UmoraSlice = { name: string; value: number; color: string };

export function UmoraDonut({ slices, total, centerLabel }: { slices: UmoraSlice[]; total: number; centerLabel: string }) {
  const radius = 40;
  const circumference = 2 * Math.PI * radius;
  const gap = slices.length > 1 ? 1.6 : 0;
  let offset = 0;

  return (
    <div className="flex flex-col items-center gap-5 sm:flex-row sm:items-center">
      <div className="relative h-40 w-40 shrink-0">
        <svg viewBox="0 0 100 100" className="h-full w-full -rotate-90" role="img" aria-label={`${total} ${centerLabel} by site`}>
          <circle cx="50" cy="50" r={radius} fill="none" stroke="#eef2f5" strokeWidth="13" />
          {total > 0 &&
            slices.map((slice) => {
              const length = (slice.value / total) * circumference;
              const dash = Math.max(0, length - gap);
              const element = (
                <circle
                  key={slice.name}
                  cx="50"
                  cy="50"
                  r={radius}
                  fill="none"
                  stroke={slice.color}
                  strokeWidth="13"
                  strokeDasharray={`${dash} ${circumference - dash}`}
                  strokeDashoffset={-offset}
                  className="transition-opacity hover:opacity-80"
                >
                  <title>{`${slice.name}: ${slice.value} (${Math.round((slice.value / total) * 100)}%)`}</title>
                </circle>
              );
              offset += length;
              return element;
            })}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="umora-sans vyron-tabular text-2xl font-extrabold text-[#0f1d33]">{total.toLocaleString()}</span>
          <span className="text-xs text-slate-500">{centerLabel}</span>
        </div>
      </div>
      <ul className="w-full min-w-0 space-y-2.5">
        {slices.map((slice) => (
          <li key={slice.name} className="flex items-center gap-2.5 text-sm">
            <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: slice.color }} aria-hidden="true" />
            <span className="min-w-0 flex-1 truncate text-slate-600">{slice.name}</span>
            <span className="vyron-tabular font-semibold text-[#0f1d33]">
              {total > 0 ? `${Math.round((slice.value / total) * 100)}%` : "0%"}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* -------------------------------------------------------- list rows */

export function UmoraStatRow({
  icon,
  tone,
  label,
  value,
  onClick,
}: {
  icon: ReactNode;
  tone: Tone;
  label: string;
  value: string | number;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-3 border-b border-slate-100 py-2.5 text-left last:border-b-0 hover:bg-slate-50/70"
    >
      <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ring-1 ${toneTile[tone]}`}>{icon}</span>
      <span className="min-w-0 flex-1 truncate text-sm text-slate-600">{label}</span>
      <span className="vyron-tabular text-sm font-bold text-[#0f1d33]">{value}</span>
      <ChevronRight className="h-4 w-4 shrink-0 text-slate-300" />
    </button>
  );
}

export function UmoraActionRow({
  icon,
  tone,
  count,
  label,
  onReview,
}: {
  icon: ReactNode;
  tone: Tone;
  count: number;
  label: string;
  onReview: () => void;
}) {
  return (
    <div className="flex items-center gap-3 border-b border-slate-100 py-2.5 last:border-b-0">
      <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full ring-1 ${toneTile[tone]}`}>{icon}</span>
      <span className="vyron-tabular w-8 shrink-0 text-sm font-bold text-[#0f1d33]">{count}</span>
      <span className="min-w-0 flex-1 truncate text-sm text-slate-600">{label}</span>
      <button
        type="button"
        onClick={onReview}
        className="shrink-0 rounded-lg border border-blue-200 bg-blue-50/60 px-3 py-1 text-xs font-semibold text-blue-700 transition hover:bg-blue-100"
      >
        Review
      </button>
    </div>
  );
}

/* ---------------------------------------------------- payroll readiness */

export type UmoraCheck = { label: string; done: boolean };

export function UmoraReadinessRing({
  percent,
  status,
  caption,
  checks,
}: {
  percent: number;
  status: string;
  caption: string;
  checks: UmoraCheck[];
}) {
  const radius = 42;
  const circumference = 2 * Math.PI * radius;
  const ready = status.toLowerCase().includes("ready");
  return (
    <div className="flex flex-col gap-5 sm:flex-row sm:items-center">
      <div className="flex shrink-0 flex-col items-center text-center">
        <div className="relative h-32 w-32">
          <svg viewBox="0 0 100 100" className="h-full w-full -rotate-90" role="img" aria-label={`${percent}% of payroll checks complete`}>
            <circle cx="50" cy="50" r={radius} fill="none" stroke="#e7f5ee" strokeWidth="10" />
            <circle
              cx="50"
              cy="50"
              r={radius}
              fill="none"
              stroke="url(#umora-readiness)"
              strokeWidth="10"
              strokeLinecap="round"
              strokeDasharray={`${(percent / 100) * circumference} ${circumference}`}
            />
            <defs>
              <linearGradient id="umora-readiness" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0" stopColor="#1fb28a" />
                <stop offset="1" stopColor="#148a57" />
              </linearGradient>
            </defs>
          </svg>
          <span className="umora-sans vyron-tabular absolute inset-0 flex items-center justify-center text-2xl font-extrabold text-[#0f1d33]">
            {percent}%
          </span>
        </div>
        <div className={`umora-sans mt-2 text-base font-bold ${ready ? "text-emerald-700" : "text-amber-600"}`}>{status}</div>
        <div className="max-w-[10rem] text-[11px] leading-4 text-slate-500">{caption}</div>
      </div>
      <ul className="min-w-0 flex-1 space-y-2.5">
        {checks.map((check) => (
          <li key={check.label} className="flex items-center gap-2.5 text-sm text-slate-600">
            {check.done ? (
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-500 text-white">
                <Check className="h-3 w-3" strokeWidth={3} />
                <span className="sr-only">Complete:</span>
              </span>
            ) : (
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-400">
                <CircleDashed className="h-3.5 w-3.5" />
                <span className="sr-only">Outstanding:</span>
              </span>
            )}
            <span className="min-w-0 truncate">{check.label}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ------------------------------------------------------ latest activity */

export type UmoraActivity = { id: string; icon: ReactNode; tone: Tone; text: string; when: string };

export function UmoraActivityList({ items, emptyText }: { items: UmoraActivity[]; emptyText: string }) {
  if (items.length === 0) {
    return <div className="flex h-full min-h-32 items-center justify-center text-center text-sm text-slate-400">{emptyText}</div>;
  }
  return (
    <ul>
      {items.map((item) => (
        <li key={item.id} className="flex items-center gap-3 border-b border-slate-100 py-2.5 last:border-b-0">
          <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full ring-1 ${toneTile[item.tone]}`}>{item.icon}</span>
          <span className="min-w-0 flex-1 truncate text-sm text-slate-600">{item.text}</span>
          <span className="shrink-0 text-xs text-slate-400">{item.when}</span>
        </li>
      ))}
    </ul>
  );
}

/** "5 mins ago" style relative time for activity rows. */
export function umoraRelativeTime(iso: string, now = Date.now()): string {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return "";
  const minutes = Math.max(0, Math.round((now - then) / 60000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days} day${days === 1 ? "" : "s"} ago`;
  return new Date(iso).toLocaleDateString("en-ZA", { day: "numeric", month: "short" });
}

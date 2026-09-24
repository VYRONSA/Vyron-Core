"use client";

// Application chrome for the authenticated UMORA software, drawn to the
// approved UMORA dashboard reference: the top bar (back, search, workspace,
// notifications, Command Centre, logout), the per-screen page header and the
// sidebar line art. Behaviour is supplied by the caller — these components
// hold no data or permission logic of their own.

import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Bell, Building2, Home, LogOut, Search } from "lucide-react";
import { productBrand } from "@/lib/brand";

export type UmoraSearchTarget = { label: string; target: string; group: string };

export function UmoraTopBar({
  canGoBack,
  onBack,
  searchTargets,
  onNavigate,
  workspaceName,
  workspaceCaption,
  notificationCount,
  onOpenNotifications,
  onOpenCommandCentre,
  onLogout,
}: {
  canGoBack: boolean;
  onBack: () => void;
  /** Screens the signed-in user can already open from the sidebar (RBAC-filtered by the caller). */
  searchTargets: UmoraSearchTarget[];
  onNavigate: (target: string) => void;
  workspaceName: string;
  workspaceCaption: string;
  notificationCount: number;
  onOpenNotifications: () => void;
  onOpenCommandCentre: () => void;
  onLogout: () => void | Promise<void>;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const seen = new Set<string>();
    return searchTargets
      .filter(
        (item) =>
          item.label.toLowerCase().includes(q) ||
          item.target.toLowerCase().includes(q) ||
          item.group.toLowerCase().includes(q)
      )
      .filter((item) => (seen.has(item.target) ? false : (seen.add(item.target), true)))
      .slice(0, 8);
  }, [query, searchTargets]);

  // ⌘K / Ctrl+K focuses search, as the shortcut hint in the field promises.
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        inputRef.current?.focus();
        setOpen(true);
      }
    }
    function onPointer(event: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(event.target as Node)) setOpen(false);
    }
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onPointer);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onPointer);
    };
  }, []);

  function choose(target: string) {
    onNavigate(target);
    setQuery("");
    setOpen(false);
    inputRef.current?.blur();
  }

  return (
    <div className="mb-6 flex flex-wrap items-center gap-3">
      <button
        type="button"
        onClick={onBack}
        disabled={!canGoBack}
        className="inline-flex h-11 items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50 disabled:cursor-default disabled:opacity-45 disabled:hover:bg-white"
      >
        <ArrowLeft className="h-4 w-4" />
        Back
      </button>

      <div ref={boxRef} className="relative min-w-[14rem] flex-1">
        <label className="sr-only" htmlFor="umora-global-search">
          Search screens
        </label>
        <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        <input
          id="umora-global-search"
          ref={inputRef}
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setHighlight(0);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown") {
              event.preventDefault();
              setHighlight((value) => Math.min(value + 1, Math.max(results.length - 1, 0)));
            } else if (event.key === "ArrowUp") {
              event.preventDefault();
              setHighlight((value) => Math.max(value - 1, 0));
            } else if (event.key === "Enter" && results[highlight]) {
              event.preventDefault();
              choose(results[highlight].target);
            } else if (event.key === "Escape") {
              setOpen(false);
            }
          }}
          placeholder="Search employees, clocking, rosters, reports…"
          autoComplete="off"
          role="combobox"
          aria-expanded={open && results.length > 0}
          aria-controls="umora-global-search-results"
          className="h-11 w-full rounded-xl border border-slate-200 bg-white pl-10 pr-14 text-sm text-slate-800 shadow-sm placeholder:text-slate-400"
        />
        <kbd className="pointer-events-none absolute right-3 top-1/2 hidden -translate-y-1/2 rounded-md border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[10px] font-semibold text-slate-500 sm:block">
          ⌘K
        </kbd>
        {open && query.trim() && (
          <div
            id="umora-global-search-results"
            role="listbox"
            className="absolute inset-x-0 top-[calc(100%+6px)] z-40 overflow-hidden rounded-xl border border-slate-200 bg-white py-1 shadow-[0_18px_40px_rgba(16,42,76,0.14)]"
          >
            {results.length === 0 ? (
              <div className="px-4 py-3 text-sm text-slate-500">No matching screens.</div>
            ) : (
              results.map((item, index) => (
                <button
                  key={`${item.group}-${item.target}`}
                  type="button"
                  role="option"
                  aria-selected={index === highlight}
                  onMouseEnter={() => setHighlight(index)}
                  onClick={() => choose(item.target)}
                  className={`flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left text-sm ${
                    index === highlight ? "bg-emerald-50 text-emerald-900" : "text-slate-700"
                  }`}
                >
                  <span className="truncate font-semibold">{item.label}</span>
                  <span className="shrink-0 text-xs text-slate-400">{item.group}</span>
                </button>
              ))
            )}
          </div>
        )}
      </div>

      <div className="flex h-11 min-w-0 items-center gap-3 rounded-xl border border-slate-200 bg-white px-3.5 shadow-sm">
        <Building2 className="h-5 w-5 shrink-0 text-slate-600" />
        <div className="min-w-0 leading-tight">
          <div className="max-w-[12rem] truncate text-sm font-semibold text-[#0f1d33]">{workspaceName}</div>
          <div className="truncate text-[11px] text-slate-500">{workspaceCaption}</div>
        </div>
      </div>

      <button
        type="button"
        onClick={onOpenNotifications}
        aria-label={notificationCount > 0 ? `Notifications (${notificationCount})` : "Notifications"}
        className="relative inline-flex h-11 w-11 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-700 shadow-sm transition hover:bg-slate-50"
      >
        <Bell className="h-5 w-5" />
        {notificationCount > 0 && (
          <span className="absolute right-2 top-2 h-2.5 w-2.5 rounded-full bg-rose-500 ring-2 ring-white" aria-hidden="true" />
        )}
      </button>

      <button
        type="button"
        onClick={onOpenCommandCentre}
        className="umora-gold inline-flex h-11 items-center gap-2 rounded-xl px-4 text-sm font-bold transition"
      >
        <Home className="h-4 w-4" />
        Command Centre
      </button>

      <button
        type="button"
        onClick={() => void onLogout()}
        className="inline-flex h-11 items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-800 shadow-sm transition hover:border-red-200 hover:bg-red-50 hover:text-red-700"
      >
        <LogOut className="h-4 w-4" />
        Logout / Exit Workspace
      </button>
    </div>
  );
}

/** Per-screen title band used on every screen except the Command Centre. */
export function UmoraPageHeader({
  title,
  status,
  badge,
}: {
  title: string;
  status?: React.ReactNode;
  badge?: React.ReactNode;
}) {
  return (
    <div className="umora-hero relative mb-6 overflow-hidden rounded-[22px] px-7 py-7 text-white shadow-[0_18px_50px_rgba(4,32,27,0.22)] md:px-9">
      <div className="pointer-events-none absolute -right-16 -top-24 h-64 w-64 rounded-full bg-[#4fe3a1]/15 blur-3xl" />
      <div className="relative">
        <div className="umora-sans text-[0.68rem] font-semibold uppercase tracking-[0.36em] text-white/70">
          {productBrand.mark} <span className="text-white/35">/</span> <span className="text-[#8af0c4]">{title}</span>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <h1 className="umora-sans text-3xl font-extrabold tracking-tight md:text-[2.4rem]">{title}</h1>
          {badge}
        </div>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-white/75">{productBrand.appTagline}</p>
        {status && <div className="mt-3 text-xs font-semibold">{status}</div>}
      </div>
    </div>
  );
}

/** Flowing line art from the reference sidebar. Decorative only. */
export function UmoraSidebarLines() {
  return (
    <svg className="umora-sidebar-lines" viewBox="0 0 300 500" preserveAspectRatio="none" aria-hidden="true">
      {[0, 1, 2, 3, 4, 5].map((index) => (
        <path
          key={index}
          d={`M-20 ${420 - index * 26} C 80 ${300 - index * 30}, 170 ${470 - index * 18}, 320 ${250 - index * 34}`}
          fill="none"
          stroke="rgba(126,238,192,0.16)"
          strokeWidth="1"
        />
      ))}
      <path d="M-10 480 C 90 360, 200 520, 320 330" fill="none" stroke="rgba(79,227,161,0.32)" strokeWidth="1.4" />
    </svg>
  );
}

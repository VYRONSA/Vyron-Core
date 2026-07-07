"use client";

import React from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ChevronDown, X } from "lucide-react";

export type MobileShellAction = {
  key: string;
  label: string;
  description: string;
  icon: React.ReactNode;
  badge?: string | number;
  onPress: () => void;
  tone?: "default" | "gold" | "danger";
};

export type MobileShellActionSection = {
  key: string;
  title: string;
  actions: MobileShellAction[];
};

export type MobileShellNavItem = {
  key: string;
  label: string;
  icon: React.ReactNode;
  badge?: string | number;
  active?: boolean;
  onPress: () => void;
  prominent?: boolean;
};

export type MobileLauncherTile = {
  key: string;
  title: string;
  description: string;
  icon: React.ReactNode;
  badge?: string | number;
  onPress: () => void;
};

function toneClasses(tone: MobileShellAction["tone"]) {
  if (tone === "gold") {
    return "border-[#d6b25e]/45 bg-[#f7f1df] text-[#7a5612] shadow-[0_18px_40px_rgba(214,178,94,0.16)]";
  }
  if (tone === "danger") {
    return "border-rose-200 bg-rose-50 text-rose-700 shadow-[0_18px_40px_rgba(244,63,94,0.12)]";
  }
  return "border-slate-200/80 bg-white text-slate-700 shadow-[0_18px_40px_rgba(15,23,42,0.08)]";
}

function Sheet({
  open,
  onClose,
  title,
  subtitle,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <AnimatePresence>
      {open ? (
        <>
          <motion.button
            type="button"
            aria-label="Close sheet"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            onClick={onClose}
            className="fixed inset-0 z-40 bg-slate-950/42 backdrop-blur-[2px]"
          />
          <motion.section
            initial={{ opacity: 0, y: 36 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
            transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
            className="fixed inset-x-0 bottom-0 z-50 rounded-t-[32px] border border-slate-200/80 bg-[#f8f9fb] px-5 pb-8 pt-4 shadow-[0_-24px_70px_rgba(15,23,42,0.2)]"
          >
            <div className="mx-auto h-1.5 w-14 rounded-full bg-slate-300" />
            <div className="mt-5 flex items-start justify-between gap-4">
              <div>
                <div className="text-xs font-black uppercase tracking-[0.28em] text-slate-400">VYRON</div>
                <h2 className="mt-2 text-2xl font-black tracking-tight text-slate-950">{title}</h2>
                <p className="mt-2 max-w-xl text-sm leading-6 text-slate-500">{subtitle}</p>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="rounded-full border border-slate-200 bg-white p-3 text-slate-500 shadow-sm"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="mt-6 max-h-[68vh] overflow-y-auto pb-6">{children}</div>
          </motion.section>
        </>
      ) : null}
    </AnimatePresence>
  );
}

function ActionGrid({ sections }: { sections: MobileShellActionSection[] }) {
  return (
    <div className="space-y-6">
      {sections.map((section) => (
        <div key={section.key}>
          <div className="mb-3 text-xs font-black uppercase tracking-[0.28em] text-slate-400">
            {section.title}
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {section.actions.map((action) => (
              <motion.button
                key={action.key}
                type="button"
                whileTap={{ scale: 0.985 }}
                onClick={action.onPress}
                className={`flex items-start gap-4 rounded-[24px] border p-4 text-left transition ${toneClasses(action.tone)}`}
              >
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-slate-950 text-white">
                  {action.icon}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <div className="truncate text-base font-black text-slate-950">{action.label}</div>
                    {action.badge != null ? (
                      <span className="rounded-full bg-slate-950 px-2 py-1 text-[10px] font-black uppercase tracking-[0.18em] text-white">
                        {action.badge}
                      </span>
                    ) : null}
                  </div>
                  <div className="mt-1 text-sm leading-6 text-slate-500">{action.description}</div>
                </div>
              </motion.button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

export function MobileHomeLauncher({
  title,
  subtitle,
  tiles,
}: {
  title: string;
  subtitle: string;
  tiles: MobileLauncherTile[];
}) {
  return (
    <section className="space-y-5">
      <div className="rounded-[30px] bg-[#0b1320] px-5 py-6 text-white shadow-[0_24px_70px_rgba(2,6,23,0.22)] sm:px-6">
        <div className="text-xs font-black uppercase tracking-[0.36em] text-[#cdb06c]">Launcher</div>
        <h2 className="mt-3 text-3xl font-black tracking-tight sm:text-[2.4rem]">{title}</h2>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-300">{subtitle}</p>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {tiles.map((tile, index) => (
          <motion.button
            key={tile.key}
            type="button"
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.24, delay: index * 0.025 }}
            whileTap={{ scale: 0.985 }}
            onClick={tile.onPress}
            className="rounded-[28px] border border-slate-200/80 bg-white p-4 text-left shadow-[0_18px_45px_rgba(15,23,42,0.08)] transition hover:-translate-y-0.5 sm:p-5"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[#0b1320] text-white shadow-[0_14px_30px_rgba(15,23,42,0.2)] sm:h-14 sm:w-14">
                {tile.icon}
              </div>
              {tile.badge != null ? (
                <span className="rounded-full bg-[#f3ead3] px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.18em] text-[#7a5612]">
                  {tile.badge}
                </span>
              ) : null}
            </div>
            <div className="mt-5 text-base font-black tracking-tight text-slate-950 sm:text-lg">{tile.title}</div>
            <div className="mt-2 text-sm leading-6 text-slate-500">{tile.description}</div>
          </motion.button>
        ))}
      </div>
    </section>
  );
}

export default function MobileAppShell({
  title,
  workspaceName,
  profileLabel,
  notificationCount,
  onOpenWorkspace,
  onOpenNotifications,
  onOpenProfile,
  navItems,
  createOpen,
  onCreateOpenChange,
  createSections,
  moreOpen,
  onMoreOpenChange,
  moreSections,
  children,
}: {
  title: string;
  workspaceName: string;
  profileLabel: string;
  notificationCount: number;
  onOpenWorkspace: () => void;
  onOpenNotifications: () => void;
  onOpenProfile: () => void;
  navItems: MobileShellNavItem[];
  createOpen: boolean;
  onCreateOpenChange: (open: boolean) => void;
  createSections: MobileShellActionSection[];
  moreOpen: boolean;
  onMoreOpenChange: (open: boolean) => void;
  moreSections: MobileShellActionSection[];
  children: React.ReactNode;
}) {
  const hasNotifications = notificationCount > 0;

  return (
    <div className="min-h-screen bg-[#eef2f7] text-slate-950">
      <div className="sticky top-0 z-30 border-b border-white/80 bg-[#eef2f7]/95 px-4 pb-5 pt-4 backdrop-blur-xl sm:px-6">
        <div className="flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={onOpenWorkspace}
            className="flex min-w-0 items-center gap-3 rounded-full border border-slate-200/80 bg-white px-3 py-2 shadow-sm"
          >
            <div className="h-10 w-10 rounded-2xl bg-[#0b1320]" />
            <div className="min-w-0 text-left">
              <div className="text-[10px] font-black uppercase tracking-[0.24em] text-slate-400">Workspace</div>
              <div className="truncate text-sm font-black text-slate-950">{workspaceName}</div>
            </div>
            <ChevronDown className="h-4 w-4 shrink-0 text-slate-400" />
          </button>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onOpenNotifications}
              className="relative rounded-full border border-slate-200/80 bg-white p-3 text-slate-700 shadow-sm"
            >
              <div className="h-5 w-5">{navItems.find((item) => item.key === "notifications")?.icon}</div>
              {hasNotifications ? (
                <span className="absolute right-1.5 top-1.5 h-2.5 w-2.5 rounded-full bg-rose-500" />
              ) : null}
            </button>
            <button
              type="button"
              onClick={onOpenProfile}
              className="flex h-11 min-w-11 items-center justify-center rounded-full bg-[#0b1320] px-3 text-sm font-black uppercase tracking-[0.16em] text-white shadow-[0_14px_34px_rgba(15,23,42,0.18)]"
            >
              {profileLabel}
            </button>
          </div>
        </div>

        <div className="mt-5">
          <div className="text-xs font-black uppercase tracking-[0.34em] text-slate-400">VYRON COST</div>
          <h1 className="mt-3 text-[2rem] font-black tracking-tight text-slate-950 sm:text-[2.4rem]">{title}</h1>
        </div>
      </div>

      <div className="px-4 pb-32 pt-4 sm:px-6">{children}</div>

      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-white/80 bg-[#f8f9fb]/96 px-3 pb-[max(env(safe-area-inset-bottom),12px)] pt-3 backdrop-blur-xl">
        <div className="mx-auto flex max-w-xl items-end justify-between gap-2">
          {navItems.map((item) => {
            const isProminent = Boolean(item.prominent);
            const activeClasses = item.active
              ? isProminent
                ? "bg-[#c7a55a] text-[#101724] shadow-[0_18px_45px_rgba(199,165,90,0.34)]"
                : "text-slate-950"
              : isProminent
                ? "bg-[#b99648] text-[#101724] shadow-[0_18px_45px_rgba(185,150,72,0.28)]"
                : "text-slate-400";

            return (
              <button
                key={item.key}
                type="button"
                onClick={item.onPress}
                className={`relative flex min-w-0 flex-1 flex-col items-center justify-end gap-2 rounded-[24px] px-2 pb-2 pt-3 text-center transition ${activeClasses}`}
              >
                <div
                  className={`flex items-center justify-center ${
                    isProminent
                      ? "h-16 w-16 -translate-y-5 rounded-full"
                      : "h-11 w-11 rounded-2xl"
                  } ${
                    isProminent
                      ? activeClasses
                      : item.active
                        ? "bg-white shadow-[0_12px_30px_rgba(15,23,42,0.1)]"
                        : "bg-transparent"
                  }`}
                >
                  {item.icon}
                </div>
                <span className={`text-[11px] font-black tracking-[0.14em] ${isProminent ? "uppercase" : ""}`}>
                  {item.label}
                </span>
                {item.badge != null ? (
                  <span className="absolute right-4 top-1 inline-flex min-w-5 items-center justify-center rounded-full bg-rose-500 px-1.5 py-1 text-[10px] font-black leading-none text-white">
                    {item.badge}
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
      </div>

      <Sheet
        open={createOpen}
        onClose={() => onCreateOpenChange(false)}
        title="Quick Create"
        subtitle="Open the existing workflows that create operational records without changing any business logic from the mobile shell."
      >
        <ActionGrid sections={createSections} />
      </Sheet>

      <Sheet
        open={moreOpen}
        onClose={() => onMoreOpenChange(false)}
        title="More"
        subtitle="Browse the live VYRON workspace using the same modules and permissions already available in the desktop application."
      >
        <ActionGrid sections={moreSections} />
      </Sheet>
    </div>
  );
}
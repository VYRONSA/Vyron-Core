"use client";

import React from "react";
import type { LucideIcon } from "lucide-react";

const TONE_CLASSES: Record<string, { border: string; iconBg: string; iconText: string; label: string }> = {
  slate: { border: "border-white/80 bg-white/95", iconBg: "bg-slate-100", iconText: "text-slate-700", label: "text-slate-500" },
  emerald: { border: "border-emerald-200/80 bg-emerald-50/90", iconBg: "bg-white", iconText: "text-emerald-700", label: "text-emerald-900" },
  cyan: { border: "border-cyan-200/80 bg-cyan-50/90", iconBg: "bg-white", iconText: "text-cyan-700", label: "text-cyan-900" },
  amber: { border: "border-amber-200/80 bg-amber-50/90", iconBg: "bg-white", iconText: "text-amber-700", label: "text-amber-900" },
  violet: { border: "border-violet-200/80 bg-violet-50/90", iconBg: "bg-white", iconText: "text-violet-700", label: "text-violet-800" },
  rose: { border: "border-rose-200/80 bg-rose-50/90", iconBg: "bg-white", iconText: "text-rose-700", label: "text-rose-900" },
};

export type PlatformStatTileTone = keyof typeof TONE_CLASSES;

export default function PlatformStatTile({
  icon: Icon,
  label,
  value,
  subtitle,
  tone = "slate",
  onClick,
}: {
  icon: LucideIcon;
  label: string;
  value: React.ReactNode;
  subtitle?: string;
  tone?: PlatformStatTileTone;
  onClick?: () => void;
}) {
  const palette = TONE_CLASSES[tone] || TONE_CLASSES.slate;
  const Wrapper = onClick ? "button" : "div";

  return (
    <Wrapper
      type={onClick ? "button" : undefined}
      onClick={onClick}
      className={`rounded-[2rem] border ${palette.border} p-6 text-left shadow-[0_18px_55px_rgba(15,23,42,0.10)] backdrop-blur-xl ${
        onClick ? "transition hover:-translate-y-1" : ""
      }`}
    >
      <div className={`w-fit rounded-2xl ${palette.iconBg} p-3 ${palette.iconText}`}>
        <Icon className="h-6 w-6" />
      </div>
      <div className={`mt-6 text-sm font-bold ${palette.label}`}>{label}</div>
      <div className="mt-2 text-4xl font-black text-[#06101f]">{value}</div>
      {subtitle ? <div className={`mt-2 text-sm font-black ${palette.iconText}`}>{subtitle}</div> : null}
    </Wrapper>
  );
}

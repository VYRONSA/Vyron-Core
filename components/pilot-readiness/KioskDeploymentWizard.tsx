"use client";

import React, { useState } from "react";
import { Check, Copy, ExternalLink, Monitor, Smartphone } from "lucide-react";
import type { PilotReadinessReport } from "@/lib/pilot-client-readiness";

type Props = {
  report: PilotReadinessReport;
  employeeCount: number;
};

async function copyText(value: string, onDone: () => void) {
  try {
    await navigator.clipboard.writeText(value);
    onDone();
  } catch {
    // fallback ignored for pilot
  }
}

export default function KioskDeploymentWizard({ report, employeeCount }: Props) {
  const [copied, setCopied] = useState<"clock" | "leave" | null>(null);

  function handleCopy(kind: "clock" | "leave", url: string) {
    void copyText(url, () => {
      setCopied(kind);
      window.setTimeout(() => setCopied(null), 2000);
    });
  }

  const checklist = [
    {
      label: "Employees loaded",
      done: employeeCount > 0,
      detail: `${employeeCount} on file`,
    },
    {
      label: "Kiosk PINs configured",
      done: report.employeesWithKiosk > 0,
      detail: `${report.employeesWithKiosk} with PINs`,
    },
    {
      label: "Clock kiosk URL copied to tablet",
      done: report.allSteps.find((s) => s.id === "kiosk_urls")?.done ?? false,
      detail: "Bookmark or home-screen the link",
    },
    {
      label: "Test clock-in completed",
      done: report.allSteps.find((s) => s.id === "clock_events")?.done ?? false,
      detail: "Verify one event in Clocking",
    },
  ];

  return (
    <div className="space-y-6">
      <section className="rounded-[1.5rem] border border-white/80 bg-white p-6 shadow-sm">
        <div className="flex items-center gap-2 text-xs font-black uppercase tracking-[0.35em] text-cyan-700">
          <Monitor className="h-4 w-4" />
          Kiosk deployment (~8 min)
        </div>
        <p className="mt-2 text-sm text-slate-500">
          Deploy shared tablet links per site. Staff select their name and enter their PIN — no login
          required.
        </p>

        <div className="mt-6 space-y-4">
          {[
            { kind: "clock" as const, label: "Clock kiosk", url: report.kioskClockUrl },
            { kind: "leave" as const, label: "Leave kiosk", url: report.kioskLeaveUrl },
          ].map((item) => (
            <div
              key={item.kind}
              className="rounded-2xl border border-slate-200 bg-slate-50 p-4"
            >
              <div className="text-sm font-black text-slate-950">{item.label}</div>
              <code className="mt-2 block break-all rounded-xl bg-white px-3 py-2 text-xs text-slate-700">
                {item.url}
              </code>
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => handleCopy(item.kind, item.url)}
                  className="flex items-center gap-2 rounded-xl bg-[#06101f] px-4 py-2 text-xs font-black text-cyan-300"
                >
                  {copied === item.kind ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                  {copied === item.kind ? "Copied" : "Copy URL"}
                </button>
                <a
                  href={item.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2 text-xs font-black text-slate-800"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                  Open
                </a>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-[1.5rem] border border-white/80 bg-white p-6 shadow-sm">
        <div className="flex items-center gap-2 text-xs font-black uppercase tracking-[0.35em] text-cyan-700">
          <Smartphone className="h-4 w-4" />
          Deployment checklist
        </div>
        <ul className="mt-4 space-y-3">
          {checklist.map((item) => (
            <li
              key={item.label}
              className="flex items-center justify-between rounded-xl border border-slate-100 bg-slate-50 px-4 py-3"
            >
              <div>
                <div className="font-bold text-slate-900">{item.label}</div>
                <div className="text-xs text-slate-500">{item.detail}</div>
              </div>
              <span
                className={`rounded-full px-3 py-1 text-xs font-black ${
                  item.done ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"
                }`}
              >
                {item.done ? "Done" : "Pending"}
              </span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

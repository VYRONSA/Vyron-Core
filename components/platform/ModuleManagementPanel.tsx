"use client";

import React, { useEffect, useState } from "react";
import { platformFetch } from "@/lib/platform/platform-client";
import PlatformPanel from "./PlatformPanel";

type ModuleRow = {
  module_code: string;
  name: string;
  description: string | null;
  status: string;
  requires_enterprise: boolean;
  requires_ai_credits: boolean;
  employee_limit: number | null;
  user_limit: number | null;
  version: string;
};

const STATUS_OPTIONS = ["enabled", "hidden", "preview", "beta", "deprecated"];

export default function ModuleManagementPanel() {
  const [modules, setModules] = useState<ModuleRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const result = await platformFetch<{ modules: ModuleRow[] }>("/api/platform/modules");
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setModules(result.data.modules);
    })();
  }, []);

  async function patchModule(moduleCode: string, updates: Partial<ModuleRow>) {
    const result = await platformFetch("/api/platform/modules", {
      method: "PATCH",
      body: JSON.stringify({ moduleCode, ...updates }),
    });
    if (!result.ok) {
      setError(result.message);
      return;
    }
    setModules((prev) => (prev || []).map((m) => (m.module_code === moduleCode ? { ...m, ...updates } : m)));
  }

  if (error) return <PlatformPanel className="text-rose-700">{error}</PlatformPanel>;
  if (!modules) return <PlatformPanel className="text-center text-slate-500">Loading modules…</PlatformPanel>;

  return (
    <PlatformPanel>
      <h2 className="text-xl font-black text-[#06101f]">Module Management</h2>
      <div className="mt-5 overflow-x-auto">
        <table className="w-full min-w-[900px] text-left text-sm">
          <thead>
            <tr className="text-xs font-black uppercase tracking-wide text-slate-500">
              <th className="px-3 py-2">Module</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2">Requires Enterprise</th>
              <th className="px-3 py-2">Requires AI Credits</th>
              <th className="px-3 py-2">Employee Limit</th>
              <th className="px-3 py-2">Version</th>
            </tr>
          </thead>
          <tbody>
            {modules.map((module) => (
              <tr key={module.module_code} className="border-b border-slate-100">
                <td className="px-3 py-3 font-bold text-slate-900">{module.name}</td>
                <td className="px-3 py-3">
                  <select
                    value={module.status}
                    onChange={(e) => patchModule(module.module_code, { status: e.target.value })}
                    className="rounded-xl border border-slate-200 bg-white px-2 py-1 text-xs"
                  >
                    {STATUS_OPTIONS.map((option) => (
                      <option key={option} value={option}>{option}</option>
                    ))}
                  </select>
                </td>
                <td className="px-3 py-3">
                  <input
                    type="checkbox"
                    checked={module.requires_enterprise}
                    onChange={(e) => patchModule(module.module_code, { requires_enterprise: e.target.checked })}
                  />
                </td>
                <td className="px-3 py-3">
                  <input
                    type="checkbox"
                    checked={module.requires_ai_credits}
                    onChange={(e) => patchModule(module.module_code, { requires_ai_credits: e.target.checked })}
                  />
                </td>
                <td className="px-3 py-3 text-slate-600">{module.employee_limit ?? "Unlimited"}</td>
                <td className="px-3 py-3 text-slate-600">{module.version}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </PlatformPanel>
  );
}

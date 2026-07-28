"use client";

import React, { useEffect, useState } from "react";
import { platformFetch } from "@/lib/platform/platform-client";
import { MODULE_CATALOG } from "@/lib/platform/module-catalog";
import PlatformPanel from "./PlatformPanel";

type PlatformModule = { module_code: string; name: string; status: string };

export default function ModuleToggleGrid({
  companyId,
  enabledModules,
  onSaved,
}: {
  companyId: string;
  enabledModules: string[];
  onSaved?: (modules: string[]) => void;
}) {
  const [modules, setModules] = useState<PlatformModule[]>(
    MODULE_CATALOG.map((m) => ({ module_code: m.code, name: m.label, status: "enabled" }))
  );
  const [selected, setSelected] = useState<Set<string>>(new Set(enabledModules));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const result = await platformFetch<{ modules: PlatformModule[] }>("/api/platform/modules");
      if (result.ok) setModules(result.data.modules.filter((m) => m.status !== "hidden"));
    })();
  }, []);

  function toggle(code: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });
  }

  async function handleSave() {
    setSaving(true);
    setError(null);
    const modulesSelected = Array.from(selected);
    const result = await platformFetch(`/api/platform/customers/${companyId}/modules`, {
      method: "PATCH",
      body: JSON.stringify({ modules: modulesSelected }),
    });
    setSaving(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    onSaved?.(modulesSelected);
  }

  return (
    <PlatformPanel>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-lg font-black text-[#06101f]">Module Management</h3>
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="rounded-full bg-[#06101f] px-5 py-2 text-xs font-black text-white disabled:opacity-60"
        >
          {saving ? "Saving…" : "Save Modules"}
        </button>
      </div>

      {error ? <p className="mt-3 text-sm text-rose-700">{error}</p> : null}

      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {modules.map((module) => (
          <label
            key={module.module_code}
            className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-bold text-slate-800"
          >
            <input
              type="checkbox"
              checked={selected.has(module.module_code)}
              onChange={() => toggle(module.module_code)}
            />
            {module.name}
            {module.status !== "enabled" ? (
              <span className="rounded-full bg-violet-100 px-2 py-0.5 text-[10px] font-black uppercase text-violet-700">
                {module.status}
              </span>
            ) : null}
          </label>
        ))}
      </div>
    </PlatformPanel>
  );
}

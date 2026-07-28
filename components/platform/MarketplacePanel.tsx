"use client";

import React, { useEffect, useState } from "react";
import { Store } from "lucide-react";
import { platformFetch } from "@/lib/platform/platform-client";
import PlatformPanel from "./PlatformPanel";

type TemplateRow = {
  id: string;
  code: string;
  name: string;
  description: string | null;
  default_modules: string[] | null;
  default_permissions: string[] | null;
  default_workflows: string[] | null;
  dashboard_widgets: string[] | null;
  suggested_ai_assistants: string[] | null;
  is_active: boolean;
};

function TagList({ items, tone }: { items: string[] | null; tone: string }) {
  if (!items || items.length === 0) return <span className="text-xs text-slate-400">None configured</span>;
  return (
    <div className="flex flex-wrap gap-1">
      {items.map((item) => (
        <span key={item} className={`rounded-full px-2 py-1 text-xs font-bold ${tone}`}>
          {item}
        </span>
      ))}
    </div>
  );
}

/**
 * Marketplace: industry Solution Templates. Selecting one at customer creation
 * auto-configures modules, permissions, workflows, dashboard widgets, and suggested
 * AI assistants — new industries can be added here without any schema change
 * (all configuration lives in jsonb columns on solution_templates).
 */
export default function MarketplacePanel() {
  const [templates, setTemplates] = useState<TemplateRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const result = await platformFetch<{ templates: TemplateRow[] }>("/api/platform/templates");
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setTemplates(result.data.templates);
    })();
  }, []);

  async function toggleActive(template: TemplateRow) {
    const result = await platformFetch("/api/platform/templates", {
      method: "PATCH",
      body: JSON.stringify({ id: template.id, is_active: !template.is_active }),
    });
    if (!result.ok) {
      setError(result.message);
      return;
    }
    setTemplates((prev) =>
      (prev || []).map((entry) => (entry.id === template.id ? { ...entry, is_active: !entry.is_active } : entry))
    );
  }

  if (error) return <PlatformPanel className="text-rose-700">{error}</PlatformPanel>;
  if (!templates) return <PlatformPanel className="text-center text-slate-500">Loading marketplace…</PlatformPanel>;

  return (
    <div className="flex flex-col gap-6">
      <PlatformPanel>
        <div className="flex items-center gap-3">
          <Store className="h-6 w-6 text-cyan-700" />
          <div>
            <h2 className="text-xl font-black text-[#06101f]">Industry Templates</h2>
            <p className="text-sm text-slate-600">
              Each template auto-configures modules, permissions, workflows, dashboard widgets, and suggested AI
              assistants for fast onboarding. Add new industries any time — no schema changes required.
            </p>
          </div>
        </div>
      </PlatformPanel>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {templates.map((template) => (
          <PlatformPanel key={template.id}>
            <div className="flex items-start justify-between gap-3">
              <h3 className="text-lg font-black text-[#06101f]">{template.name}</h3>
              <span
                className={`rounded-full px-3 py-1 text-xs font-black uppercase ${
                  template.is_active ? "bg-emerald-100 text-emerald-800" : "bg-slate-100 text-slate-500"
                }`}
              >
                {template.is_active ? "Active" : "Inactive"}
              </span>
            </div>
            {template.description ? <p className="mt-2 text-sm text-slate-600">{template.description}</p> : null}

            <div className="mt-4 flex flex-col gap-3 text-sm">
              <div>
                <div className="text-xs font-black uppercase text-slate-500">Modules</div>
                <div className="mt-1"><TagList items={template.default_modules} tone="bg-cyan-50 text-cyan-800" /></div>
              </div>
              <div>
                <div className="text-xs font-black uppercase text-slate-500">Permissions</div>
                <div className="mt-1"><TagList items={template.default_permissions} tone="bg-violet-50 text-violet-800" /></div>
              </div>
              <div>
                <div className="text-xs font-black uppercase text-slate-500">Workflows</div>
                <div className="mt-1"><TagList items={template.default_workflows} tone="bg-amber-50 text-amber-800" /></div>
              </div>
              <div>
                <div className="text-xs font-black uppercase text-slate-500">Dashboard Widgets</div>
                <div className="mt-1"><TagList items={template.dashboard_widgets} tone="bg-emerald-50 text-emerald-800" /></div>
              </div>
              <div>
                <div className="text-xs font-black uppercase text-slate-500">Suggested AI Assistants</div>
                <div className="mt-1"><TagList items={template.suggested_ai_assistants} tone="bg-rose-50 text-rose-800" /></div>
              </div>
            </div>

            <button
              type="button"
              onClick={() => toggleActive(template)}
              className="mt-4 rounded-full border border-slate-200 px-4 py-2 text-xs font-black text-slate-700 hover:bg-slate-50"
            >
              {template.is_active ? "Deactivate" : "Activate"}
            </button>
          </PlatformPanel>
        ))}
      </div>
    </div>
  );
}

"use client";

import React, { useEffect, useState } from "react";
import { platformFetch } from "@/lib/platform/platform-client";
import PlatformPanel from "./PlatformPanel";

type PlanRow = {
  id: string;
  code: string;
  name: string;
  monthly_price: number;
  annual_price: number;
  trial_period_days: number;
  employee_limit: number | null;
  storage_limit_gb: number | null;
  ai_credit_limit: number | null;
  api_request_limit: number | null;
};

export default function PlanEditor() {
  const [plans, setPlans] = useState<PlanRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const result = await platformFetch<{ plans: PlanRow[] }>("/api/platform/plans");
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setPlans(result.data.plans);
    })();
  }, []);

  function updateField(id: string, field: keyof PlanRow, value: number | null) {
    setPlans((prev) => (prev || []).map((plan) => (plan.id === id ? { ...plan, [field]: value } : plan)));
  }

  async function handleSave(plan: PlanRow) {
    setSavingId(plan.id);
    const result = await platformFetch("/api/platform/plans", {
      method: "PATCH",
      body: JSON.stringify({
        id: plan.id,
        monthly_price: plan.monthly_price,
        annual_price: plan.annual_price,
        trial_period_days: plan.trial_period_days,
        employee_limit: plan.employee_limit,
        storage_limit_gb: plan.storage_limit_gb,
        ai_credit_limit: plan.ai_credit_limit,
        api_request_limit: plan.api_request_limit,
      }),
    });
    setSavingId(null);
    if (!result.ok) setError(result.message);
  }

  if (error) return <PlatformPanel className="text-rose-700">{error}</PlatformPanel>;
  if (!plans) return <PlatformPanel className="text-center text-slate-500">Loading plans…</PlatformPanel>;

  const inputClass = "w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm";
  const labelClass = "text-xs font-black uppercase tracking-wide text-slate-500";

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      {plans.map((plan) => (
        <PlatformPanel key={plan.id}>
          <h3 className="text-xl font-black text-[#06101f]">{plan.name}</h3>
          <div className="mt-4 flex flex-col gap-3">
            <label className="flex flex-col gap-1">
              <span className={labelClass}>Monthly Price</span>
              <input
                type="number"
                className={inputClass}
                value={plan.monthly_price}
                onChange={(e) => updateField(plan.id, "monthly_price", Number(e.target.value))}
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className={labelClass}>Annual Price</span>
              <input
                type="number"
                className={inputClass}
                value={plan.annual_price}
                onChange={(e) => updateField(plan.id, "annual_price", Number(e.target.value))}
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className={labelClass}>Trial Period (days)</span>
              <input
                type="number"
                className={inputClass}
                value={plan.trial_period_days}
                onChange={(e) => updateField(plan.id, "trial_period_days", Number(e.target.value))}
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className={labelClass}>Employee Limit (blank = unlimited)</span>
              <input
                type="number"
                className={inputClass}
                value={plan.employee_limit ?? ""}
                onChange={(e) => updateField(plan.id, "employee_limit", e.target.value === "" ? null : Number(e.target.value))}
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className={labelClass}>Storage Limit (GB)</span>
              <input
                type="number"
                className={inputClass}
                value={plan.storage_limit_gb ?? ""}
                onChange={(e) => updateField(plan.id, "storage_limit_gb", e.target.value === "" ? null : Number(e.target.value))}
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className={labelClass}>AI Credits</span>
              <input
                type="number"
                className={inputClass}
                value={plan.ai_credit_limit ?? ""}
                onChange={(e) => updateField(plan.id, "ai_credit_limit", e.target.value === "" ? null : Number(e.target.value))}
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className={labelClass}>API Requests</span>
              <input
                type="number"
                className={inputClass}
                value={plan.api_request_limit ?? ""}
                onChange={(e) => updateField(plan.id, "api_request_limit", e.target.value === "" ? null : Number(e.target.value))}
              />
            </label>
          </div>
          <button
            type="button"
            onClick={() => handleSave(plan)}
            disabled={savingId === plan.id}
            className="mt-4 w-full rounded-full bg-[#06101f] px-5 py-3 text-sm font-black text-white disabled:opacity-60"
          >
            {savingId === plan.id ? "Saving…" : "Save Plan"}
          </button>
        </PlatformPanel>
      ))}
    </div>
  );
}

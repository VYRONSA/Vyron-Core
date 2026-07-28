"use client";

import React, { useState } from "react";
import { platformFetch } from "@/lib/platform/platform-client";
import PlatformPanel from "./PlatformPanel";

type CompanyLicence = {
  id: string;
  customer_status: string | null;
  employee_limit: number | null;
  user_limit: number | null;
  storage_limit_gb: number | null;
  ai_credit_limit: number | null;
  api_request_limit: number | null;
  licence_expires_at: string | null;
  billing_frequency: string | null;
  renewal_date: string | null;
  invoice_reference: string | null;
  payment_status: string | null;
  billing_contact: string | null;
  purchase_order: string | null;
  automatic_billing_ready: boolean;
  grace_period_ends_at: string | null;
};

const STATUS_OPTIONS = ["trial", "active", "grace_period", "suspended", "cancelled", "expired"];

export default function LicenceBillingPanel({ company }: { company: CompanyLicence }) {
  const [form, setForm] = useState({
    employee_limit: company.employee_limit ?? "",
    user_limit: company.user_limit ?? "",
    storage_limit_gb: company.storage_limit_gb ?? "",
    ai_credit_limit: company.ai_credit_limit ?? "",
    api_request_limit: company.api_request_limit ?? "",
    licence_expires_at: company.licence_expires_at ? company.licence_expires_at.slice(0, 10) : "",
    billing_frequency: company.billing_frequency || "monthly",
    renewal_date: company.renewal_date || "",
    invoice_reference: company.invoice_reference || "",
    payment_status: company.payment_status || "current",
    billing_contact: company.billing_contact || "",
    purchase_order: company.purchase_order || "",
    automatic_billing_ready: company.automatic_billing_ready || false,
    grace_period_ends_at: company.grace_period_ends_at ? company.grace_period_ends_at.slice(0, 10) : "",
  });
  const [status, setStatus] = useState(company.customer_status || "trial");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const inputClass = "w-full rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm outline-none focus:border-cyan-500";
  const labelClass = "text-xs font-black uppercase tracking-wide text-slate-500";

  function update<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSaveLicence() {
    setSaving(true);
    setError(null);
    setMessage(null);

    const result = await platformFetch(`/api/platform/customers/${company.id}`, {
      method: "PATCH",
      body: JSON.stringify({
        employee_limit: form.employee_limit === "" ? null : Number(form.employee_limit),
        user_limit: form.user_limit === "" ? null : Number(form.user_limit),
        storage_limit_gb: form.storage_limit_gb === "" ? null : Number(form.storage_limit_gb),
        ai_credit_limit: form.ai_credit_limit === "" ? null : Number(form.ai_credit_limit),
        api_request_limit: form.api_request_limit === "" ? null : Number(form.api_request_limit),
        licence_expires_at: form.licence_expires_at || null,
        billing_frequency: form.billing_frequency,
        renewal_date: form.renewal_date || null,
        invoice_reference: form.invoice_reference || null,
        payment_status: form.payment_status,
        billing_contact: form.billing_contact || null,
        purchase_order: form.purchase_order || null,
        automatic_billing_ready: form.automatic_billing_ready,
        grace_period_ends_at: form.grace_period_ends_at || null,
      }),
    });

    setSaving(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    setMessage("Licence and billing details saved.");
  }

  async function handleStatusChange(nextStatus: string) {
    if (nextStatus === "suspended") {
      const confirmed = window.confirm(
        "Suspend this customer? They will immediately lose the ability to sign in."
      );
      if (!confirmed) return;
    }

    setSaving(true);
    setError(null);
    setMessage(null);

    const result = await platformFetch(`/api/platform/customers/${company.id}/status`, {
      method: "POST",
      body: JSON.stringify({ status: nextStatus }),
    });

    setSaving(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    setStatus(nextStatus);
    setMessage(`Customer status set to ${nextStatus}.`);
  }

  return (
    <PlatformPanel>
      <h3 className="text-lg font-black text-[#06101f]">Licence & Billing</h3>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <span className={labelClass}>Customer Status</span>
        <select
          value={status}
          onChange={(event) => handleStatusChange(event.target.value)}
          disabled={saving}
          className={`${inputClass} w-40`}
        >
          {STATUS_OPTIONS.map((option) => (
            <option key={option} value={option}>{option}</option>
          ))}
        </select>
      </div>

      <div className="mt-5 grid gap-4 md:grid-cols-3">
        <label className="flex flex-col gap-2">
          <span className={labelClass}>Max Employees</span>
          <input className={inputClass} type="number" value={form.employee_limit} onChange={(e) => update("employee_limit", e.target.value)} placeholder="Unlimited" />
        </label>
        <label className="flex flex-col gap-2">
          <span className={labelClass}>Max Users</span>
          <input className={inputClass} type="number" value={form.user_limit} onChange={(e) => update("user_limit", e.target.value)} placeholder="Unlimited" />
        </label>
        <label className="flex flex-col gap-2">
          <span className={labelClass}>Max Storage (GB)</span>
          <input className={inputClass} type="number" value={form.storage_limit_gb} onChange={(e) => update("storage_limit_gb", e.target.value)} />
        </label>
        <label className="flex flex-col gap-2">
          <span className={labelClass}>AI Credit Allocation</span>
          <input className={inputClass} type="number" value={form.ai_credit_limit} onChange={(e) => update("ai_credit_limit", e.target.value)} />
        </label>
        <label className="flex flex-col gap-2">
          <span className={labelClass}>API Requests</span>
          <input className={inputClass} type="number" value={form.api_request_limit} onChange={(e) => update("api_request_limit", e.target.value)} />
        </label>
        <label className="flex flex-col gap-2">
          <span className={labelClass}>Licence Expiry</span>
          <input className={inputClass} type="date" value={form.licence_expires_at} onChange={(e) => update("licence_expires_at", e.target.value)} />
        </label>
        <label className="flex flex-col gap-2">
          <span className={labelClass}>Billing Frequency</span>
          <select className={inputClass} value={form.billing_frequency} onChange={(e) => update("billing_frequency", e.target.value)}>
            <option value="monthly">Monthly</option>
            <option value="annual">Annual</option>
          </select>
        </label>
        <label className="flex flex-col gap-2">
          <span className={labelClass}>Renewal Date</span>
          <input className={inputClass} type="date" value={form.renewal_date} onChange={(e) => update("renewal_date", e.target.value)} />
        </label>
        <label className="flex flex-col gap-2">
          <span className={labelClass}>Invoice Reference</span>
          <input className={inputClass} value={form.invoice_reference} onChange={(e) => update("invoice_reference", e.target.value)} />
        </label>
        <label className="flex flex-col gap-2">
          <span className={labelClass}>Payment Status</span>
          <select className={inputClass} value={form.payment_status} onChange={(e) => update("payment_status", e.target.value)}>
            <option value="current">Current</option>
            <option value="overdue">Overdue</option>
            <option value="failed">Failed</option>
          </select>
        </label>
        <label className="flex flex-col gap-2">
          <span className={labelClass}>Billing Contact</span>
          <input className={inputClass} value={form.billing_contact} onChange={(e) => update("billing_contact", e.target.value)} />
        </label>
        <label className="flex flex-col gap-2">
          <span className={labelClass}>Purchase Order</span>
          <input className={inputClass} value={form.purchase_order} onChange={(e) => update("purchase_order", e.target.value)} />
        </label>
        <label className="flex flex-col gap-2">
          <span className={labelClass}>Grace Period Ends</span>
          <input className={inputClass} type="date" value={form.grace_period_ends_at} onChange={(e) => update("grace_period_ends_at", e.target.value)} />
        </label>
        <label className="flex items-center gap-2 pt-6">
          <input
            type="checkbox"
            checked={form.automatic_billing_ready}
            onChange={(e) => update("automatic_billing_ready", e.target.checked)}
          />
          <span className="text-sm font-bold text-slate-700">Automatic billing ready</span>
        </label>
      </div>
      <p className="mt-2 text-xs text-slate-500">
        &ldquo;Automatic billing ready&rdquo; is a readiness flag only — no live payment processor is wired up yet.
      </p>

      {error ? <p className="mt-3 text-sm font-bold text-rose-700">{error}</p> : null}
      {message ? <p className="mt-3 text-sm font-bold text-emerald-700">{message}</p> : null}

      <button
        type="button"
        onClick={handleSaveLicence}
        disabled={saving}
        className="mt-4 rounded-full bg-[#06101f] px-6 py-3 text-sm font-black text-white disabled:opacity-60"
      >
        {saving ? "Saving…" : "Save Licence & Billing"}
      </button>
    </PlatformPanel>
  );
}

"use client";

import React, { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { platformFetch } from "@/lib/platform/platform-client";
import { moduleLabel } from "@/lib/platform/module-catalog";
import PlatformPanel from "./PlatformPanel";
import ModuleToggleGrid from "./ModuleToggleGrid";
import LicenceBillingPanel from "./LicenceBillingPanel";

const HEALTH_TONE: Record<string, string> = {
  green: "bg-emerald-100 text-emerald-800",
  amber: "bg-amber-100 text-amber-800",
  red: "bg-rose-100 text-rose-800",
};

type CompanyDetail = {
  id: string;
  name: string;
  trading_name: string | null;
  registration_number: string | null;
  vat_number: string | null;
  industry: string | null;
  company_size: string | null;
  country: string | null;
  currency: string | null;
  enabled_modules: string[] | null;
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

type CompanyUserRow = {
  id: string;
  user_email: string;
  role: string;
  status: string;
  last_login_at: string | null;
};

type AuditLogRow = {
  id: string;
  user_email: string;
  action: string;
  entity_type: string;
  created_at: string;
};

type TimelineEntry = { timestamp: string; label: string; detail: string | null; tone: string };

type HealthResult = { score: number; band: "green" | "amber" | "red"; factors: string[] };

type OverviewData = {
  company: CompanyDetail;
  users: CompanyUserRow[];
  employeeCount: number;
  auditLog: AuditLogRow[];
  health: HealthResult;
  timeline: TimelineEntry[];
};

const TIMELINE_TONE: Record<string, string> = {
  positive: "bg-emerald-500",
  warning: "bg-amber-500",
  critical: "bg-rose-500",
  neutral: "bg-slate-400",
};

function UsageGauge({ label, used, limit }: { label: string; used: number; limit: number | null }) {
  const pct = limit ? Math.min(100, Math.round((used / limit) * 100)) : 0;
  return (
    <div>
      <div className="flex items-center justify-between text-xs font-bold text-slate-600">
        <span>{label}</span>
        <span>{used} / {limit ?? "∞"}</span>
      </div>
      <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-slate-100">
        <div
          className={`h-full rounded-full ${pct > 90 ? "bg-rose-500" : pct > 70 ? "bg-amber-500" : "bg-cyan-600"}`}
          style={{ width: limit ? `${pct}%` : "6%" }}
        />
      </div>
    </div>
  );
}

export default function CustomerOverview({ companyId }: { companyId: string }) {
  const router = useRouter();
  const [data, setData] = useState<OverviewData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async () => {
    const result = await platformFetch<OverviewData>(`/api/platform/customers/${companyId}`);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    setData(result.data);
    setError(null);
  }, [companyId]);

  useEffect(() => {
    (async () => {
      await load();
    })();
  }, [load]);

  if (error) {
    return <PlatformPanel className="text-rose-700">Could not load this customer: {error}</PlatformPanel>;
  }

  if (!data) {
    return <PlatformPanel className="text-center text-slate-500">Loading customer…</PlatformPanel>;
  }

  const { company, users, employeeCount, auditLog, health, timeline } = data;
  const activeUserCount = users.filter((u) => u.status === "active").length;
  const recentLogins = [...users]
    .filter((u) => u.last_login_at)
    .sort((a, b) => (b.last_login_at || "").localeCompare(a.last_login_at || ""))
    .slice(0, 8);
  const labelClass = "text-xs font-black uppercase tracking-wide text-slate-500";

  async function handleDelete() {
    const confirmed = window.confirm(
      `Soft-delete "${company.name}"?\n\nThis removes it from the default customer directory but does not destroy any data — it can be restored.`
    );
    if (!confirmed) return;
    setDeleting(true);
    const result = await platformFetch(`/api/platform/customers/${company.id}`, { method: "DELETE" });
    setDeleting(false);
    if (result.ok) router.push("/platform/customers");
  }

  return (
    <div className="flex flex-col gap-6">
      <PlatformPanel>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-2xl font-black text-[#06101f]">{company.name}</h2>
            {company.trading_name ? <p className="text-sm text-slate-500">t/a {company.trading_name}</p> : null}
          </div>
          <div className="flex items-center gap-3">
            <span
              className={`rounded-full px-4 py-2 text-xs font-black uppercase tracking-wide ${HEALTH_TONE[health.band]}`}
              title={health.factors.join("; ") || "No health concerns detected"}
            >
              Health {health.score}
            </span>
            <span className="rounded-full bg-slate-100 px-4 py-2 text-xs font-black uppercase tracking-wide text-slate-700">
              {company.customer_status || "trial"}
            </span>
            <button
              type="button"
              onClick={handleDelete}
              disabled={deleting}
              className="rounded-full border border-rose-200 px-4 py-2 text-xs font-black text-rose-700 hover:bg-rose-50 disabled:opacity-60"
            >
              {deleting ? "Deleting…" : "Delete"}
            </button>
          </div>
        </div>
        {health.factors.length > 0 ? (
          <p className="mt-2 text-xs text-slate-500">Health factors: {health.factors.join(", ")}</p>
        ) : null}

        <div className="mt-5 grid gap-4 text-sm md:grid-cols-3">
          <div><div className={labelClass}>Registration Number</div><div className="mt-1 font-bold text-slate-800">{company.registration_number || "—"}</div></div>
          <div><div className={labelClass}>VAT Number</div><div className="mt-1 font-bold text-slate-800">{company.vat_number || "—"}</div></div>
          <div><div className={labelClass}>Industry</div><div className="mt-1 font-bold text-slate-800">{company.industry || "—"}</div></div>
          <div><div className={labelClass}>Company Size</div><div className="mt-1 font-bold text-slate-800">{company.company_size || "—"}</div></div>
          <div><div className={labelClass}>Country</div><div className="mt-1 font-bold text-slate-800">{company.country || "—"}</div></div>
          <div><div className={labelClass}>Currency</div><div className="mt-1 font-bold text-slate-800">{company.currency || "—"}</div></div>
        </div>
      </PlatformPanel>

      <PlatformPanel>
        <h3 className="text-lg font-black text-[#06101f]">Usage</h3>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <UsageGauge label="Employees" used={employeeCount} limit={company.employee_limit} />
          <UsageGauge label="Active Users" used={activeUserCount} limit={company.user_limit} />
        </div>
        <p className="mt-4 text-xs text-slate-500">
          Storage allocation: {company.storage_limit_gb ?? "unlimited"} GB · AI credit allocation:{" "}
          {company.ai_credit_limit ?? "unlimited"} · API request allocation: {company.api_request_limit ?? "unlimited"}.
          Actual consumption against these allocations is not yet instrumented — only the licensed capacity is shown.
        </p>
      </PlatformPanel>

      <PlatformPanel>
        <h3 className="text-lg font-black text-[#06101f]">Modules Enabled</h3>
        <div className="mt-3 flex flex-wrap gap-2">
          {(company.enabled_modules || []).length === 0 ? (
            <span className="text-sm text-slate-500">No modules enabled.</span>
          ) : (
            (company.enabled_modules || []).map((code) => (
              <span key={code} className="rounded-full bg-cyan-50 px-3 py-1 text-xs font-bold text-cyan-800">
                {moduleLabel(code)}
              </span>
            ))
          )}
        </div>
      </PlatformPanel>

      <ModuleToggleGrid companyId={company.id} enabledModules={company.enabled_modules || []} onSaved={load} />

      <LicenceBillingPanel company={company} />

      <PlatformPanel>
        <h3 className="text-lg font-black text-[#06101f]">Users & Login Activity</h3>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[520px] text-left text-sm">
            <thead>
              <tr className="text-xs font-black uppercase tracking-wide text-slate-500">
                <th className="px-3 py-2">Email</th>
                <th className="px-3 py-2">Role</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Last Login</th>
              </tr>
            </thead>
            <tbody>
              {users.map((user) => (
                <tr key={user.id}>
                  <td className="px-3 py-2 font-bold text-slate-900">{user.user_email}</td>
                  <td className="px-3 py-2 capitalize text-slate-600">{user.role}</td>
                  <td className="px-3 py-2 capitalize text-slate-600">{user.status}</td>
                  <td className="px-3 py-2 text-slate-600">{user.last_login_at?.slice(0, 10) || "Never"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </PlatformPanel>

      <section className="grid gap-6 lg:grid-cols-2">
        <PlatformPanel>
          <h3 className="text-lg font-black text-[#06101f]">Recent Logins</h3>
          <ul className="mt-4 flex flex-col gap-2 text-sm">
            {recentLogins.length === 0 ? (
              <li className="text-slate-500">No logins recorded yet.</li>
            ) : (
              recentLogins.map((user) => (
                <li key={user.id} className="flex items-center justify-between border-b border-slate-100 pb-2">
                  <span className="font-bold text-slate-800">{user.user_email}</span>
                  <span className="text-xs text-slate-500">{user.last_login_at?.slice(0, 16).replace("T", " ")}</span>
                </li>
              ))
            )}
          </ul>
        </PlatformPanel>

        <PlatformPanel>
          <h3 className="text-lg font-black text-[#06101f]">Recent Errors</h3>
          <p className="mt-4 text-sm text-slate-500">
            No application error/API/AI failure telemetry exists yet — nothing to show.
          </p>
        </PlatformPanel>
      </section>

      <PlatformPanel>
        <h3 className="text-lg font-black text-[#06101f]">Timeline</h3>
        <ul className="mt-4 flex flex-col gap-3 text-sm">
          {timeline.length === 0 ? (
            <li className="text-slate-500">No timeline events yet.</li>
          ) : (
            timeline.map((entry, index) => (
              <li key={index} className="flex items-start gap-3">
                <span className={`mt-1.5 h-2 w-2 flex-shrink-0 rounded-full ${TIMELINE_TONE[entry.tone] || "bg-slate-400"}`} />
                <div>
                  <div className="font-bold text-slate-800">{entry.label}</div>
                  <div className="text-xs text-slate-500">
                    {entry.detail ? `${entry.detail} · ` : ""}
                    {new Date(entry.timestamp).toLocaleString()}
                  </div>
                </div>
              </li>
            ))
          )}
        </ul>
      </PlatformPanel>

      <PlatformPanel>
        <h3 className="text-lg font-black text-[#06101f]">Audit Trail</h3>
        <ul className="mt-4 flex flex-col gap-2 text-sm">
          {auditLog.length === 0 ? (
            <li className="text-slate-500">No activity recorded yet.</li>
          ) : (
            auditLog.map((entry) => (
              <li key={entry.id} className="flex items-center justify-between border-b border-slate-100 pb-2">
                <span className="text-slate-700">
                  <span className="font-bold">{entry.user_email}</span> {entry.action} · {entry.entity_type}
                </span>
                <span className="text-xs text-slate-400">{entry.created_at?.slice(0, 19).replace("T", " ")}</span>
              </li>
            ))
          )}
        </ul>
      </PlatformPanel>
    </div>
  );
}

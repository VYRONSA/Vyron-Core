"use client";

/**
 * Road & Recovery Billing Intelligence (Phase 5).
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS SCREEN IS, AND IS NOT
 * ---------------------------------------------------------------------------
 *
 * It shows what is billable, how much, why, and whether it is ready. It is NOT an
 * invoicing screen: there is no "Create Invoice" button anywhere, no invoice number and
 * no payment. VYRON FINANCE issues the invoice, and the banner says so in as many words
 * so nobody using this screen can be in any doubt.
 *
 * Built from the same primitives as every other Road & Recovery screen — the shell, the
 * poll hook, the card and table styling — so it reads as part of VYRON CORE rather than a
 * separate billing application.
 */

import React, { useCallback, useMemo, useState } from "react";
import { RR_POLL_INTERVALS, rrFetchJson, useRrPoll } from "@/lib/road-recovery/use-rr-poll";

type ReportColumn = { key: string; label: string; numeric?: boolean };

type BillingReport = {
  key: string;
  label: string;
  generatedAt: string;
  disclaimer: string;
  columns: ReportColumn[];
  rows: Record<string, unknown>[];
  summary: Record<string, unknown>;
};

/** Section order is operational: what is ready, then what is blocked, then the detail. */
const SECTIONS: { key: string; label: string; blurb: string }[] = [
  { key: "billing_readiness", label: "Billing Readiness", blurb: "Every job, and whether its billing information is complete." },
  { key: "awaiting_finance", label: "Ready for Finance", blurb: "Complete billing information, ready for VYRON FINANCE to invoice. No invoice exists here." },
  { key: "invoice_information", label: "Invoice Information", blurb: "Every expected charge line, with the rule and reason behind it." },
  { key: "bystand_billing", label: "BYSTAND Billing", blurb: "Standing time only. A bystand attendance moves nothing and stores nothing." },
  { key: "storage_billing", label: "Storage Billing", blurb: "Read from the sealed accrual. Durations are never recalculated at billing time." },
  { key: "tow_distance", label: "Distance", blurb: "The driver's odometer is the commercial source; GPS is supporting evidence." },
  { key: "disputed_distance", label: "Disputes", blurb: "The driver's original reading is never overwritten." },
  { key: "authorisation_vs_actual", label: "Authorisation vs Actual", blurb: "Expected charge against the authorised ceiling." },
  { key: "counterparty_summary", label: "Counterparties", blurb: "Where billing information is complete, and where it is outstanding." },
  { key: "profitability", label: "Profitability", blurb: "Expected revenue against operational cost, where cost data exists." },
  { key: "outstanding_information", label: "Outstanding", blurb: "What is missing, grouped by blocking reason." },
  { key: "billing_exceptions", label: "Exceptions", blurb: "Escalations route through the existing Action Intelligence pipeline." },
];

function formatCell(value: unknown, numeric?: boolean): string {
  if (value === null || value === undefined || value === "") return "—";
  if (Array.isArray(value)) return value.length === 0 ? "—" : value.join(" · ");
  if (numeric && typeof value === "number") {
    return value.toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}T/.test(value)) {
    return new Date(value).toLocaleString("en-ZA");
  }
  return String(value);
}

function statusTone(value: unknown): string {
  const text = String(value ?? "").toUpperCase();
  if (text === "READY") return "bg-emerald-100 text-emerald-900";
  if (text === "BLOCKED" || text === "OVER" || text === "QUERIED") return "bg-rose-100 text-rose-900";
  if (text === "CRITICAL" || text === "HIGH") return "bg-rose-200 text-rose-900";
  if (text === "MEDIUM") return "bg-amber-100 text-amber-900";
  return "bg-slate-100 text-slate-700";
}

const STATUS_KEYS = new Set(["readiness", "status", "severity", "actionStatus", "factStatus"]);

export default function BillingIntelligence({ companyId }: { companyId: string }) {
  const [section, setSection] = useState(SECTIONS[0].key);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [serviceCode, setServiceCode] = useState("");
  const [page, setPage] = useState(0);
  const pageSize = 25;

  const query = useMemo(() => {
    const params = new URLSearchParams({ companyId });
    if (from) params.set("from", from);
    if (to) params.set("to", to);
    if (serviceCode) params.set("serviceCode", serviceCode);
    return params.toString();
  }, [companyId, from, to, serviceCode]);

  const fetcher = useCallback(
    () =>
      rrFetchJson<{ report: BillingReport }>(
        `/api/road-recovery/billing/reports/${section}?${query}`
      ),
    [section, query]
  );

  const poll = useRrPoll<{ report: BillingReport }>(fetcher, RR_POLL_INTERVALS.driverIdle, {
    enabled: Boolean(companyId),
    key: `${section}|${query}`,
  });

  const report = poll.data?.report ?? null;
  const rows = report?.rows ?? [];
  const pageCount = Math.max(1, Math.ceil(rows.length / pageSize));
  const visible = rows.slice(page * pageSize, page * pageSize + pageSize);
  const active = SECTIONS.find((entry) => entry.key === section);

  const exportCsv = useCallback(() => {
    // A plain navigation, so the browser handles the download and the request still
    // carries the session cookie the API gate requires.
    window.location.href = `/api/road-recovery/billing/reports/${section}?${query}&format=csv`;
  }, [section, query]);

  return (
    <div className="space-y-4">
      {/* The boundary, stated where nobody can miss it. */}
      <section className="rounded-2xl border border-cyan-200 bg-cyan-50 p-4">
        <h2 className="text-lg font-black text-slate-900">Billing Intelligence</h2>
        <p className="mt-1 text-sm font-semibold text-slate-700">
          VYRON CORE determines what is billable, how much, and why — and stops there.
          It does not create invoices, record payments or keep accounts.
          <span className="font-black"> Invoicing belongs to VYRON FINANCE.</span>
        </p>
      </section>

      <nav className="flex flex-wrap gap-2">
        {SECTIONS.map((entry) => (
          <button
            key={entry.key}
            type="button"
            onClick={() => {
              setSection(entry.key);
              setPage(0);
            }}
            className={`rounded-xl px-3 py-1.5 text-xs font-bold ${
              section === entry.key
                ? "bg-slate-900 text-cyan-300"
                : "bg-white text-slate-700 hover:bg-slate-100"
            }`}
          >
            {entry.label}
          </button>
        ))}
      </nav>

      <section className="rounded-2xl border border-slate-200 bg-white p-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="min-w-0">
            <h3 className="text-sm font-black text-slate-900">{active?.label}</h3>
            <p className="text-xs font-semibold text-slate-500">{active?.blurb}</p>
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <label className="text-xs font-bold text-slate-600">
              From
              <input
                type="date"
                value={from}
                onChange={(event) => {
                  setFrom(event.target.value);
                  setPage(0);
                }}
                className="mt-1 block rounded-xl border border-slate-300 px-3 py-1.5 text-sm font-semibold"
              />
            </label>
            <label className="text-xs font-bold text-slate-600">
              To
              <input
                type="date"
                value={to}
                onChange={(event) => {
                  setTo(event.target.value);
                  setPage(0);
                }}
                className="mt-1 block rounded-xl border border-slate-300 px-3 py-1.5 text-sm font-semibold"
              />
            </label>
            <label className="text-xs font-bold text-slate-600">
              Service
              <select
                value={serviceCode}
                onChange={(event) => {
                  setServiceCode(event.target.value);
                  setPage(0);
                }}
                className="mt-1 block rounded-xl border border-slate-300 px-3 py-1.5 text-sm font-semibold"
              >
                <option value="">All services</option>
                {["accident_recovery", "tow_in", "jump_start", "roadside_assistance", "bystand", "heavy_recovery", "vehicle_movement", "storage"].map((code) => (
                  <option key={code} value={code}>
                    {code.replace(/_/g, " ")}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              onClick={poll.refresh}
              className="rounded-xl bg-slate-100 px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-200"
            >
              Refresh
            </button>
            <button
              type="button"
              onClick={exportCsv}
              className="rounded-xl bg-slate-900 px-3 py-2 text-xs font-bold text-cyan-300 hover:bg-slate-800"
            >
              Export CSV
            </button>
          </div>
        </div>
      </section>

      {poll.initialLoading ? (
        <p className="text-sm font-semibold text-slate-500">Loading {active?.label}…</p>
      ) : poll.error ? (
        <p role="alert" className="rounded-[22px] border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-900">
          {poll.error}
        </p>
      ) : !report ? null : (
        <>
          {Object.keys(report.summary).length > 0 ? (
            <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {Object.entries(report.summary)
                .filter(([, value]) => typeof value === "number")
                .map(([key, value]) => (
                  <div key={key} className="rounded-2xl border border-slate-200 bg-white p-4">
                    <p className="text-xs font-bold uppercase tracking-wide text-slate-500">
                      {key.replace(/([A-Z])/g, " $1").replace(/^./, (char) => char.toUpperCase())}
                    </p>
                    <p className="text-2xl font-black tabular-nums text-slate-900">
                      {(value as number).toLocaleString("en-ZA")}
                    </p>
                  </div>
                ))}
            </section>
          ) : null}

          {typeof report.summary.note === "string" ? (
            <p className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-xs font-semibold text-slate-600">
              {report.summary.note}
            </p>
          ) : null}

          <section className="rounded-2xl border border-slate-200 bg-white">
            {rows.length === 0 ? (
              <p className="p-6 text-center text-sm font-semibold text-slate-500">
                Nothing to show for this period.
              </p>
            ) : (
              <>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[900px] text-left text-xs">
                    <thead className="border-b border-slate-200 text-slate-500">
                      <tr>
                        {report.columns.map((column) => (
                          <th
                            key={column.key}
                            className={`px-3 py-2 font-bold ${column.numeric ? "text-right" : ""}`}
                          >
                            {column.label}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="font-semibold text-slate-800">
                      {visible.map((row, index) => (
                        <tr key={index} className="border-b border-slate-100 last:border-0">
                          {report.columns.map((column) => (
                            <td
                              key={column.key}
                              className={`px-3 py-2 ${column.numeric ? "text-right tabular-nums" : ""}`}
                            >
                              {STATUS_KEYS.has(column.key) && row[column.key] ? (
                                <span
                                  className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${statusTone(row[column.key])}`}
                                >
                                  {String(row[column.key])}
                                </span>
                              ) : (
                                formatCell(row[column.key], column.numeric)
                              )}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {pageCount > 1 ? (
                  <div className="flex items-center justify-between border-t border-slate-200 px-4 py-3">
                    <p className="text-xs font-semibold text-slate-500">
                      {page * pageSize + 1}–{Math.min((page + 1) * pageSize, rows.length)} of{" "}
                      {rows.length}
                    </p>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        disabled={page === 0}
                        onClick={() => setPage((current) => Math.max(0, current - 1))}
                        className="rounded-xl bg-slate-100 px-3 py-1.5 text-xs font-bold text-slate-700 disabled:opacity-40"
                      >
                        Previous
                      </button>
                      <button
                        type="button"
                        disabled={page >= pageCount - 1}
                        onClick={() => setPage((current) => Math.min(pageCount - 1, current + 1))}
                        className="rounded-xl bg-slate-100 px-3 py-1.5 text-xs font-bold text-slate-700 disabled:opacity-40"
                      >
                        Next
                      </button>
                    </div>
                  </div>
                ) : null}
              </>
            )}
          </section>

          <p className="text-xs font-medium text-slate-400">{report.disclaimer}</p>
        </>
      )}
    </div>
  );
}

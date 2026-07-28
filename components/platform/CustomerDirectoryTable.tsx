"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { Plus, Search } from "lucide-react";
import { platformFetch } from "@/lib/platform/platform-client";
import PlatformPanel from "./PlatformPanel";

type CustomerRow = {
  id: string;
  name: string;
  trading_name: string | null;
  industry: string | null;
  customer_status: string | null;
  employee_limit: number | null;
  billing_frequency: string | null;
  renewal_date: string | null;
  licence_expires_at: string | null;
  created_at: string | null;
  healthScore: number;
  healthBand: "green" | "amber" | "red";
};

const STATUS_TONE: Record<string, string> = {
  trial: "bg-cyan-100 text-cyan-800",
  active: "bg-emerald-100 text-emerald-800",
  grace_period: "bg-orange-100 text-orange-800",
  suspended: "bg-amber-100 text-amber-800",
  cancelled: "bg-slate-200 text-slate-700",
  expired: "bg-rose-100 text-rose-800",
};

const HEALTH_TONE: Record<string, string> = {
  green: "bg-emerald-500",
  amber: "bg-amber-500",
  red: "bg-rose-500",
};

const PAGE_SIZE = 25;

export default function CustomerDirectoryTable() {
  const [customers, setCustomers] = useState<CustomerRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const [prevFilters, setPrevFilters] = useState({ search, status });

  if (prevFilters.search !== search || prevFilters.status !== status) {
    setPrevFilters({ search, status });
    setPage(1);
  }

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const params = new URLSearchParams();
      if (search.trim()) params.set("search", search.trim());
      if (status) params.set("status", status);
      params.set("page", String(page));
      params.set("pageSize", String(PAGE_SIZE));
      const result = await platformFetch<{ customers: CustomerRow[]; pagination: { totalCount: number } }>(
        `/api/platform/customers?${params.toString()}`
      );
      if (cancelled) return;
      if (!result.ok) {
        setError(result.message);
      } else {
        setCustomers(result.data.customers);
        setTotalCount(result.data.pagination.totalCount);
        setError(null);
      }
    }
    const timeout = setTimeout(load, 250);
    return () => {
      cancelled = true;
      clearTimeout(timeout);
    };
  }, [search, status, page]);

  return (
    <PlatformPanel>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h2 className="text-2xl font-black tracking-tight text-[#06101f]">Customers</h2>
        <Link
          href="/platform/customers/new"
          className="inline-flex items-center gap-2 rounded-full bg-[#06101f] px-5 py-3 text-sm font-black text-white transition hover:bg-slate-800"
        >
          <Plus className="h-4 w-4" /> New Customer
        </Link>
      </div>

      <div className="mt-5 flex flex-wrap gap-3">
        <div className="flex items-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-2">
          <Search className="h-4 w-4 text-slate-400" />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search company name…"
            className="w-56 bg-transparent text-sm outline-none"
          />
        </div>
        <select
          value={status}
          onChange={(event) => setStatus(event.target.value)}
          className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm"
        >
          <option value="">All statuses</option>
          <option value="trial">Trial</option>
          <option value="active">Active</option>
          <option value="grace_period">Grace Period</option>
          <option value="suspended">Suspended</option>
          <option value="cancelled">Cancelled</option>
          <option value="expired">Expired</option>
        </select>
      </div>

      {error ? <p className="mt-4 text-sm text-rose-700">{error}</p> : null}

      <div className="mt-5 overflow-x-auto">
        <table className="w-full min-w-[720px] text-left text-sm">
          <thead>
            <tr className="text-xs font-black uppercase tracking-wide text-slate-500">
              <th className="px-3 py-2">Company</th>
              <th className="px-3 py-2">Industry</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2">Health</th>
              <th className="px-3 py-2">Employee Limit</th>
              <th className="px-3 py-2">Billing</th>
              <th className="px-3 py-2">Renewal</th>
            </tr>
          </thead>
          <tbody>
            {customers === null ? (
              <tr>
                <td colSpan={7} className="px-3 py-6 text-center text-slate-500">
                  Loading customers…
                </td>
              </tr>
            ) : customers.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-3 py-6 text-center text-slate-500">
                  No customers match this filter.
                </td>
              </tr>
            ) : (
              customers.map((customer) => (
                <tr key={customer.id} className="rounded-2xl bg-white/60 hover:bg-slate-50">
                  <td className="px-3 py-3">
                    <Link href={`/platform/customers/${customer.id}`} className="font-bold text-slate-900 hover:underline">
                      {customer.name}
                    </Link>
                    {customer.trading_name ? (
                      <div className="text-xs text-slate-500">t/a {customer.trading_name}</div>
                    ) : null}
                  </td>
                  <td className="px-3 py-3 text-slate-600">{customer.industry || "—"}</td>
                  <td className="px-3 py-3">
                    <span
                      className={`rounded-full px-3 py-1 text-xs font-black uppercase tracking-wide ${
                        STATUS_TONE[customer.customer_status || "trial"] || "bg-slate-100 text-slate-700"
                      }`}
                    >
                      {customer.customer_status || "trial"}
                    </span>
                  </td>
                  <td className="px-3 py-3">
                    <span className="inline-flex items-center gap-2">
                      <span className={`h-2.5 w-2.5 rounded-full ${HEALTH_TONE[customer.healthBand]}`} />
                      <span className="text-xs font-bold text-slate-600">{customer.healthScore}</span>
                    </span>
                  </td>
                  <td className="px-3 py-3 text-slate-600">{customer.employee_limit ?? "Unlimited"}</td>
                  <td className="px-3 py-3 text-slate-600 capitalize">{customer.billing_frequency || "monthly"}</td>
                  <td className="px-3 py-3 text-slate-600">
                    {customer.renewal_date || customer.licence_expires_at?.slice(0, 10) || "—"}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="mt-4 flex items-center justify-between text-xs font-bold text-slate-500">
        <span>
          {totalCount === 0 ? "0 customers" : `Showing ${(page - 1) * PAGE_SIZE + 1}–${Math.min(page * PAGE_SIZE, totalCount)} of ${totalCount}`}
        </span>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page <= 1}
            className="rounded-full border border-slate-200 px-3 py-1.5 disabled:opacity-40"
          >
            Previous
          </button>
          <button
            type="button"
            onClick={() => setPage((p) => (p * PAGE_SIZE < totalCount ? p + 1 : p))}
            disabled={page * PAGE_SIZE >= totalCount}
            className="rounded-full border border-slate-200 px-3 py-1.5 disabled:opacity-40"
          >
            Next
          </button>
        </div>
      </div>
    </PlatformPanel>
  );
}

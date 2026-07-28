"use client";

import React, { useEffect, useState } from "react";
import { platformFetch } from "@/lib/platform/platform-client";
import { moduleLabel } from "@/lib/platform/module-catalog";
import PlatformPanel from "./PlatformPanel";

type IntelligenceData = {
  newCustomersByMonth: { month: string; count: number }[];
  revenueByMonth: { month: string; revenue: number }[];
  industryDistribution: { industry: string; count: number }[];
  churnRatePct: number;
  mrr: number;
  averageRevenuePerCustomer: number;
  moduleUsage: { moduleCode: string; customerCount: number }[];
  mostPopularModules: { moduleCode: string; customerCount: number }[];
  totalEmployeeLimit: number;
  totalStorageLimitGb: number;
  totalAiCreditLimit: number;
  totalCustomers: number;
};

export default function PlatformIntelligence() {
  const [data, setData] = useState<IntelligenceData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const result = await platformFetch<IntelligenceData>("/api/platform/intelligence");
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setData(result.data);
    })();
  }, []);

  if (error) return <PlatformPanel className="text-rose-700">{error}</PlatformPanel>;
  if (!data) return <PlatformPanel className="text-center text-slate-500">Loading platform intelligence…</PlatformPanel>;

  const maxModuleCount = Math.max(1, ...data.moduleUsage.map((entry) => entry.customerCount));
  const maxMonthCount = Math.max(1, ...data.newCustomersByMonth.map((entry) => entry.count));
  const maxRevenue = Math.max(1, ...data.revenueByMonth.map((entry) => entry.revenue));
  const maxIndustryCount = Math.max(1, ...data.industryDistribution.map((entry) => entry.count));
  const currencyFormatter = new Intl.NumberFormat("en-ZA", { style: "currency", currency: "ZAR", maximumFractionDigits: 0 });

  return (
    <div className="flex flex-col gap-6">
      <section className="grid gap-5 md:grid-cols-3">
        <PlatformPanel>
          <div className="text-xs font-black uppercase tracking-wide text-slate-500">MRR</div>
          <div className="mt-2 text-4xl font-black text-[#06101f]">{currencyFormatter.format(data.mrr)}</div>
          <p className="mt-2 text-sm text-slate-600">Avg. revenue/customer: {currencyFormatter.format(data.averageRevenuePerCustomer)}</p>
        </PlatformPanel>
        <PlatformPanel>
          <div className="text-xs font-black uppercase tracking-wide text-slate-500">Churn Rate</div>
          <div className="mt-2 text-4xl font-black text-[#06101f]">{data.churnRatePct}%</div>
          <p className="mt-2 text-sm text-slate-600">Cancelled + expired ÷ total customers.</p>
        </PlatformPanel>
        <PlatformPanel>
          <div className="text-xs font-black uppercase tracking-wide text-slate-500">AI Credit Capacity</div>
          <div className="mt-2 text-4xl font-black text-[#06101f]">{data.totalAiCreditLimit.toLocaleString("en-ZA")}</div>
          <p className="mt-2 text-sm text-slate-600">Allocated across all customers.</p>
        </PlatformPanel>
      </section>

      <section className="grid gap-6 lg:grid-cols-2">
        <PlatformPanel>
          <h3 className="text-lg font-black text-[#06101f]">Revenue Growth</h3>
          <div className="mt-4 flex items-end gap-3 overflow-x-auto pb-2">
            {data.revenueByMonth.map((entry) => (
              <div key={entry.month} className="flex flex-col items-center gap-2">
                <div
                  className="w-8 rounded-t-lg bg-emerald-600"
                  style={{ height: `${Math.max(6, (entry.revenue / maxRevenue) * 120)}px` }}
                />
                <span className="text-xs font-bold text-slate-500">{entry.month}</span>
              </div>
            ))}
          </div>
        </PlatformPanel>

        <PlatformPanel>
          <h3 className="text-lg font-black text-[#06101f]">New Customers per Month</h3>
          <div className="mt-4 flex items-end gap-3 overflow-x-auto pb-2">
            {data.newCustomersByMonth.map((entry) => (
              <div key={entry.month} className="flex flex-col items-center gap-2">
                <div
                  className="w-8 rounded-t-lg bg-cyan-600"
                  style={{ height: `${Math.max(6, (entry.count / maxMonthCount) * 120)}px` }}
                />
                <span className="text-xs font-bold text-slate-500">{entry.month}</span>
                <span className="text-xs font-black text-slate-700">{entry.count}</span>
              </div>
            ))}
          </div>
        </PlatformPanel>
      </section>

      <section className="grid gap-6 lg:grid-cols-2">
        <PlatformPanel>
          <h3 className="text-lg font-black text-[#06101f]">Industry Distribution</h3>
          <div className="mt-4 flex flex-col gap-3">
            {data.industryDistribution.map((entry) => (
              <div key={entry.industry}>
                <div className="flex items-center justify-between text-sm font-bold text-slate-700">
                  <span>{entry.industry}</span>
                  <span>{entry.count}</span>
                </div>
                <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-slate-100">
                  <div className="h-full rounded-full bg-cyan-600" style={{ width: `${(entry.count / maxIndustryCount) * 100}%` }} />
                </div>
              </div>
            ))}
          </div>
        </PlatformPanel>

        <PlatformPanel>
          <h3 className="text-lg font-black text-[#06101f]">Most Popular Modules</h3>
          <div className="mt-4 flex flex-col gap-3">
            {data.mostPopularModules.map((entry) => (
              <div key={entry.moduleCode}>
                <div className="flex items-center justify-between text-sm font-bold text-slate-700">
                  <span>{moduleLabel(entry.moduleCode)}</span>
                  <span>{entry.customerCount}</span>
                </div>
                <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-slate-100">
                  <div
                    className="h-full rounded-full bg-violet-600"
                    style={{ width: `${(entry.customerCount / maxModuleCount) * 100}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </PlatformPanel>
      </section>
    </div>
  );
}

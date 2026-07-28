import { NextRequest, NextResponse } from "next/server";
import { requirePlatformOperator } from "@/app/api/platform/_shared";
import {
  computeAverageRevenuePerCustomer,
  computeCapacityTotals,
  computeChurnRatePct,
  computeIndustryDistribution,
  computeModuleUsage,
  computeMrr,
  computeNewCustomersByMonth,
  computeRevenueByMonth,
  type MetricsCompanyRow,
  type MetricsPlanRow,
} from "@/lib/platform/metrics";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const auth = await requirePlatformOperator(request);
  if (!auth.ok) return auth.response;
  const { supabase } = auth.context;

  const { data, error } = await supabase
    .from("companies")
    .select(
      "id,customer_status,enabled_modules,employee_limit,storage_limit_gb,ai_credit_limit,created_at,industry,plan_id,billing_frequency"
    )
    .is("deleted_at", null)
    .order("created_at", { ascending: true });

  if (error) return NextResponse.json({ ok: false, message: error.message }, { status: 500 });

  const companies = (data || []) as MetricsCompanyRow[];
  const planIds = Array.from(new Set(companies.map((c) => c.plan_id).filter(Boolean))) as string[];
  const { data: plansData } = planIds.length
    ? await supabase.from("subscription_plans").select("id,monthly_price,annual_price").in("id", planIds)
    : { data: [] as MetricsPlanRow[] };
  const plansById = new Map(((plansData || []) as MetricsPlanRow[]).map((plan) => [plan.id, plan]));

  const mrr = computeMrr(companies, plansById);
  const moduleUsageSorted = computeModuleUsage(companies);
  const { totalEmployeeLimit, totalStorageLimitGb, totalAiCreditLimit } = computeCapacityTotals(companies);

  return NextResponse.json({
    ok: true,
    newCustomersByMonth: computeNewCustomersByMonth(companies),
    revenueByMonth: computeRevenueByMonth(companies, plansById),
    industryDistribution: computeIndustryDistribution(companies),
    churnRatePct: computeChurnRatePct(companies),
    mrr,
    averageRevenuePerCustomer: computeAverageRevenuePerCustomer(mrr, companies),
    moduleUsage: moduleUsageSorted,
    mostPopularModules: moduleUsageSorted.slice(0, 5),
    totalEmployeeLimit,
    totalStorageLimitGb,
    totalAiCreditLimit,
    totalCustomers: companies.length,
  });
}

import { NextRequest, NextResponse } from "next/server";
import { requirePlatformOperator } from "@/app/api/platform/_shared";
import {
  computeArr,
  computeCapacityTotals,
  computeCustomerStatusCounts,
  computeLicenceUtilisationPct,
  computeMrr,
  computeSystemHealthScore,
  type MetricsCompanyRow,
  type MetricsPlanRow,
} from "@/lib/platform/metrics";

export const runtime = "nodejs";

type CompanyRow = MetricsCompanyRow & { name: string };

export async function GET(request: NextRequest) {
  const auth = await requirePlatformOperator(request);
  if (!auth.ok) return auth.response;
  const { supabase } = auth.context;

  const [companiesRes, plansRes, employeesRes, activeUsersRes] = await Promise.all([
    supabase
      .from("companies")
      .select(
        "id,name,customer_status,employee_limit,storage_limit_gb,ai_credit_limit,enabled_modules,plan_id,billing_frequency,created_at"
      )
      .is("deleted_at", null)
      .order("created_at", { ascending: false }),
    supabase.from("subscription_plans").select("id,monthly_price,annual_price"),
    supabase.from("employees").select("id", { count: "exact", head: true }),
    supabase.from("company_users").select("id", { count: "exact", head: true }).eq("status", "active"),
  ]);

  if (companiesRes.error) {
    return NextResponse.json({ ok: false, message: companiesRes.error.message }, { status: 500 });
  }

  const companies = (companiesRes.data || []) as CompanyRow[];
  const plansById = new Map(((plansRes.data || []) as MetricsPlanRow[]).map((plan) => [plan.id, plan]));

  const statusCounts = computeCustomerStatusCounts(companies);
  const mrr = computeMrr(companies, plansById);
  const arr = computeArr(mrr);
  const { totalEmployeeLimit, unlimitedEmployeePlanCount } = computeCapacityTotals(companies);
  const totalEmployees = employeesRes.count || 0;
  const licenceUtilisationPct = computeLicenceUtilisationPct(totalEmployees, totalEmployeeLimit);
  const systemHealthScore = computeSystemHealthScore(statusCounts);

  return NextResponse.json({
    ok: true,
    totalCustomers: companies.length,
    activeCustomers: statusCounts.active,
    trialCustomers: statusCounts.trial,
    suspendedCustomers: statusCounts.suspended,
    cancelledCustomers: statusCounts.cancelled,
    expiredCustomers: statusCounts.expired,
    totalEmployees,
    totalActiveUsers: activeUsersRes.count || 0,
    mrr,
    arr,
    licenceUtilisationPct,
    unlimitedPlanCustomers: unlimitedEmployeePlanCount,
    recentSignups: companies.slice(0, 10).map((company) => ({
      id: company.id,
      name: company.name,
      status: company.customer_status,
      createdAt: company.created_at,
    })),
    systemHealthScore,
  });
}

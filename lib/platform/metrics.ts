/**
 * Reusable, pure Platform Metrics providers. app/api/platform/dashboard and
 * app/api/platform/intelligence both call into these instead of calculating
 * values inline — one source of truth for revenue/growth/health math.
 */

export type MetricsCompanyRow = {
  id: string;
  customer_status: string | null;
  plan_id: string | null;
  billing_frequency: string | null;
  employee_limit: number | null;
  storage_limit_gb: number | null;
  ai_credit_limit: number | null;
  enabled_modules: string[] | null;
  industry?: string | null;
  created_at: string | null;
};

export type MetricsPlanRow = {
  id: string;
  monthly_price: number | null;
  annual_price: number | null;
};

export const CUSTOMER_STATUSES = ["trial", "active", "grace_period", "suspended", "cancelled", "expired"] as const;
export type CustomerStatus = (typeof CUSTOMER_STATUSES)[number];

/** Statuses counted as "still paying/entitled" for revenue and licence-capacity math. */
const REVENUE_COUNTED_STATUSES = new Set(["trial", "active", "grace_period"]);
const CHURNED_STATUSES = new Set(["cancelled", "expired"]);

export function monthKey(iso: string | null): string {
  if (!iso) return "unknown";
  return iso.slice(0, 7); // YYYY-MM
}

export function computeCustomerStatusCounts(companies: MetricsCompanyRow[]): Record<CustomerStatus, number> {
  const counts = Object.fromEntries(CUSTOMER_STATUSES.map((s) => [s, 0])) as Record<CustomerStatus, number>;
  for (const company of companies) {
    const status = (company.customer_status || "trial") as CustomerStatus;
    if (status in counts) counts[status] += 1;
  }
  return counts;
}

export function computeChurnRatePct(companies: MetricsCompanyRow[]): number {
  if (companies.length === 0) return 0;
  const churned = companies.filter((c) => CHURNED_STATUSES.has(c.customer_status || "")).length;
  return Math.round((churned / companies.length) * 10000) / 100;
}

function monthlyValueForCompany(company: MetricsCompanyRow, plansById: Map<string, MetricsPlanRow>): number {
  if (!REVENUE_COUNTED_STATUSES.has(company.customer_status || "trial")) return 0;
  const plan = company.plan_id ? plansById.get(company.plan_id) : null;
  if (!plan) return 0;
  return company.billing_frequency === "annual" ? (plan.annual_price || 0) / 12 : plan.monthly_price || 0;
}

export function computeMrr(companies: MetricsCompanyRow[], plansById: Map<string, MetricsPlanRow>): number {
  const total = companies.reduce((sum, company) => sum + monthlyValueForCompany(company, plansById), 0);
  return Math.round(total * 100) / 100;
}

export function computeArr(mrr: number): number {
  return Math.round(mrr * 12 * 100) / 100;
}

export function computeAverageRevenuePerCustomer(mrr: number, companies: MetricsCompanyRow[]): number {
  const activeCount = companies.filter((c) => REVENUE_COUNTED_STATUSES.has(c.customer_status || "trial")).length;
  return activeCount > 0 ? Math.round((mrr / activeCount) * 100) / 100 : 0;
}

export function computeRevenueByMonth(
  companies: MetricsCompanyRow[],
  plansById: Map<string, MetricsPlanRow>
): { month: string; revenue: number }[] {
  const byMonth = new Map<string, number>();
  for (const company of companies) {
    const value = monthlyValueForCompany(company, plansById);
    if (value <= 0) continue;
    const month = monthKey(company.created_at);
    byMonth.set(month, (byMonth.get(month) || 0) + value);
  }
  return Array.from(byMonth.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, revenue]) => ({ month, revenue: Math.round(revenue * 100) / 100 }));
}

export function computeNewCustomersByMonth(companies: MetricsCompanyRow[]): { month: string; count: number }[] {
  const byMonth = new Map<string, number>();
  for (const company of companies) {
    const month = monthKey(company.created_at);
    byMonth.set(month, (byMonth.get(month) || 0) + 1);
  }
  return Array.from(byMonth.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, count]) => ({ month, count }));
}

export function computeLicenceUtilisationPct(totalEmployees: number, totalEmployeeLimit: number): number | null {
  return totalEmployeeLimit > 0 ? Math.round((totalEmployees / totalEmployeeLimit) * 100) : null;
}

export function computeModuleUsage(companies: MetricsCompanyRow[]): { moduleCode: string; customerCount: number }[] {
  const usage = new Map<string, number>();
  for (const company of companies) {
    for (const moduleCode of company.enabled_modules || []) {
      usage.set(moduleCode, (usage.get(moduleCode) || 0) + 1);
    }
  }
  return Array.from(usage.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([moduleCode, customerCount]) => ({ moduleCode, customerCount }));
}

export function computeIndustryDistribution(companies: MetricsCompanyRow[]): { industry: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const company of companies) {
    const industry = company.industry || "Unspecified";
    counts.set(industry, (counts.get(industry) || 0) + 1);
  }
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([industry, count]) => ({ industry, count }));
}

export function computeCapacityTotals(companies: MetricsCompanyRow[]): {
  totalEmployeeLimit: number;
  totalStorageLimitGb: number;
  totalAiCreditLimit: number;
  unlimitedEmployeePlanCount: number;
} {
  let totalEmployeeLimit = 0;
  let totalStorageLimitGb = 0;
  let totalAiCreditLimit = 0;
  let unlimitedEmployeePlanCount = 0;

  for (const company of companies) {
    if (company.employee_limit === null) unlimitedEmployeePlanCount += 1;
    else totalEmployeeLimit += company.employee_limit;
    if (company.storage_limit_gb) totalStorageLimitGb += company.storage_limit_gb;
    if (company.ai_credit_limit) totalAiCreditLimit += company.ai_credit_limit;
  }

  return { totalEmployeeLimit, totalStorageLimitGb, totalAiCreditLimit, unlimitedEmployeePlanCount };
}

export function computeSystemHealthScore(statusCounts: Record<CustomerStatus, number>): number {
  const nonTrialCount =
    statusCounts.active + statusCounts.suspended + statusCounts.cancelled + statusCounts.expired;
  return nonTrialCount > 0 ? Math.round((statusCounts.active / nonTrialCount) * 100) : 100;
}

/**
 * VYRON CORE Batch 14 — Client Billing & Job Profitability Intelligence.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { isSupabaseMissingTableError } from "@/lib/company-access";
import {
  buildWorkforceCostDashboard,
  DEFAULT_FIELD_COST_RATE,
  fetchFieldCostRates,
  formatCurrency,
  loadWorkforceCostDashboard,
  resolveJobBillableValue,
  resolveSiteLabel,
  type FieldJobCost,
} from "@/lib/field-cost-intelligence";
import {
  fetchFieldOperationsSnapshot,
  type FieldJob,
  type FieldOperationsSnapshot,
} from "@/lib/field-operations";
export const CLIENT_BILLING_STATUSES = ["active", "suspended", "inactive"] as const;
export type ClientBillingStatus = (typeof CLIENT_BILLING_STATUSES)[number];

export const REVENUE_MODELS = [
  "fixed_fee",
  "hourly",
  "contract",
  "callout_labour",
  "callout_labour_travel",
] as const;

export type RevenueModel = (typeof REVENUE_MODELS)[number];

export const PROFITABILITY_ALERT_TYPES = [
  "low_margin_job",
  "negative_margin_job",
  "client_below_margin_target",
  "excessive_travel_cost",
  "vehicle_cost_too_high",
  "labour_cost_exceeds_revenue",
] as const;

export type ProfitabilityAlertType = (typeof PROFITABILITY_ALERT_TYPES)[number];

export const PROFITABILITY_THRESHOLDS = {
  lowMarginPct: 15,
  clientMarginTargetPct: 20,
  excessiveTravelCostZar: 650,
  vehicleCostHighZar: 500,
} as const;

export type ClientBillingProfile = {
  id: string;
  companyId: string;
  clientName: string;
  industry: string | null;
  billingModel: RevenueModel;
  hourlyRate: number;
  calloutRate: number;
  travelRate: number;
  contractValue: number | null;
  status: ClientBillingStatus;
  notes: string | null;
};

export type JobRevenueRow = {
  id: string;
  jobId: string;
  clientId: string | null;
  revenueModel: RevenueModel;
  fixedFee: number | null;
  hourlyRate: number | null;
  calloutRate: number | null;
  labourHours: number | null;
  travelAmount: number | null;
  computedRevenue: number;
  revenueDate: string;
};

export type JobProfitabilityRow = {
  jobId: string;
  jobRef: string;
  jobTitle: string;
  clientId: string | null;
  clientName: string | null;
  employeeId: string | null;
  siteKey: string | null;
  siteLabel: string;
  revenue: number;
  labourCost: number;
  travelCost: number;
  vehicleCost: number;
  assetCost: number;
  overtimeCost: number;
  totalCost: number;
  profit: number;
  marginPct: number;
};

export type ClientProfitabilityRow = {
  clientId: string;
  clientName: string;
  jobsCompleted: number;
  revenue: number;
  labourCost: number;
  travelCost: number;
  vehicleCost: number;
  assetCost: number;
  profit: number;
  marginPct: number;
};

export type TechnicianProfitabilityRow = {
  employeeId: string;
  revenueGenerated: number;
  labourCost: number;
  travelCost: number;
  profitContribution: number;
  productivityPct: number;
  jobsCompleted: number;
};

export type SiteProfitabilityRow = {
  siteKey: string;
  siteLabel: string;
  revenue: number;
  totalCost: number;
  marginPct: number;
  jobsCount: number;
  travelSeconds: number;
  labourSeconds: number;
};

export type ProfitabilityAlert = {
  id: string;
  alertType: ProfitabilityAlertType;
  severity: "info" | "warning" | "critical";
  clientId: string | null;
  jobId: string | null;
  employeeId: string | null;
  message: string;
  amountZar: number | null;
  detectedAt: string;
};

export type ProfitabilityLeaderboards = {
  topClients: { id: string; label: string; profit: number; marginPct: number }[];
  topTechnicians: { id: string; label: string; profit: number; productivityPct: number }[];
  topSites: { id: string; label: string; marginPct: number; revenue: number }[];
  highestMarginJobs: JobProfitabilityRow[];
  lowestMarginJobs: JobProfitabilityRow[];
};

export type ProfitabilityReports = {
  jobProfitability: JobProfitabilityRow[];
  clientProfitability: ClientProfitabilityRow[];
  technicianProfitability: TechnicianProfitabilityRow[];
  siteProfitability: SiteProfitabilityRow[];
  travelCostAnalysis: { jobRef: string; travelCost: number; revenue: number; pct: number }[];
  labourCostAnalysis: { jobRef: string; labourCost: number; revenue: number; pct: number }[];
};

export type ProfitabilityDashboard = {
  focusDate: string;
  monthStart: string;
  monthEnd: string;
  revenueToday: number;
  revenueThisMonth: number;
  grossMargin: number;
  grossMarginPct: number;
  mostProfitableClient: { name: string; profit: number } | null;
  leastProfitableClient: { name: string; profit: number } | null;
  mostProfitableTechnician: { name: string; profit: number } | null;
  jobsLosingMoney: number;
  estimatedLeakage: number;
  clients: ClientBillingProfile[];
  jobProfitability: JobProfitabilityRow[];
  clientProfitability: ClientProfitabilityRow[];
  technicianProfitability: TechnicianProfitabilityRow[];
  siteProfitability: SiteProfitabilityRow[];
  alerts: ProfitabilityAlert[];
  leaderboards: ProfitabilityLeaderboards;
  reports: ProfitabilityReports;
  currency: string;
  tablesAvailable: boolean;
  error: string | null;
};

const PROFIT_TABLES = [
  "client_billing_profiles",
  "job_revenue",
  "job_profitability",
  "profitability_alerts",
] as const;

function isProfitMissingTableError(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  return PROFIT_TABLES.some((table) => isSupabaseMissingTableError(error, table));
}

function num(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

function roundPct(value: number): number {
  return Math.round(value * 10) / 10;
}

function monthBounds(dateIso: string): { start: string; end: string } {
  const [year, month] = dateIso.split("-");
  const lastDay = new Date(Number(year), Number(month), 0).getDate();
  return {
    start: `${year}-${month}-01`,
    end: `${year}-${month}-${String(lastDay).padStart(2, "0")}`,
  };
}

function rowToClient(row: Record<string, unknown>): ClientBillingProfile {
  return {
    id: String(row.id),
    companyId: String(row.company_id),
    clientName: String(row.client_name),
    industry: row.industry ? String(row.industry) : null,
    billingModel: (row.billing_model as RevenueModel) || "hourly",
    hourlyRate: num(row.hourly_rate) ?? 185,
    calloutRate: num(row.callout_rate) ?? 450,
    travelRate: num(row.travel_rate) ?? 4.5,
    contractValue: num(row.contract_value),
    status: (row.status as ClientBillingStatus) || "active",
    notes: row.notes ? String(row.notes) : null,
  };
}

function rowToJobRevenue(row: Record<string, unknown>): JobRevenueRow {
  return {
    id: String(row.id),
    jobId: String(row.job_id),
    clientId: row.client_id ? String(row.client_id) : null,
    revenueModel: (row.revenue_model as RevenueModel) || "fixed_fee",
    fixedFee: num(row.fixed_fee),
    hourlyRate: num(row.hourly_rate),
    calloutRate: num(row.callout_rate),
    labourHours: num(row.labour_hours),
    travelAmount: num(row.travel_amount),
    computedRevenue: num(row.computed_revenue) ?? 0,
    revenueDate: String(row.revenue_date).slice(0, 10),
  };
}

function resolveClientForJob(
  job: FieldJob & { clientId?: string | null },
  clients: ClientBillingProfile[]
): ClientBillingProfile | null {
  const clientId = (job as { clientId?: string | null }).clientId;
  if (clientId) return clients.find((c) => c.id === clientId) || null;
  if (!job.customerName) return null;
  const normalized = job.customerName.trim().toLowerCase();
  return clients.find((c) => c.clientName.trim().toLowerCase() === normalized) || null;
}

export function computeJobRevenueAmount(input: {
  job: FieldJob & { billableValue?: number | null };
  jobCost: FieldJobCost;
  client: ClientBillingProfile | null;
  stored?: JobRevenueRow | null;
}): number {
  if (input.stored && input.stored.computedRevenue > 0) return input.stored.computedRevenue;

  const model = input.stored?.revenueModel || input.client?.billingModel || "fixed_fee";
  const labourHours = input.jobCost.labourSeconds / 3600;
  const travelKm =
    input.jobCost.travelCost > 0
      ? input.jobCost.travelCost / (input.client?.travelRate || DEFAULT_FIELD_COST_RATE.travelRatePerKm)
      : 0;

  switch (model) {
    case "fixed_fee":
      return roundMoney(input.stored?.fixedFee ?? resolveJobBillableValue(input.job));
    case "hourly": {
      const rate = input.stored?.hourlyRate ?? input.client?.hourlyRate ?? 185;
      return roundMoney(labourHours * rate);
    }
    case "contract": {
      const contract = input.client?.contractValue ?? resolveJobBillableValue(input.job);
      return roundMoney(contract / 30);
    }
    case "callout_labour": {
      const callout = input.stored?.calloutRate ?? input.client?.calloutRate ?? 450;
      const hourly = input.stored?.hourlyRate ?? input.client?.hourlyRate ?? 185;
      return roundMoney(callout + labourHours * hourly);
    }
    case "callout_labour_travel": {
      const callout = input.stored?.calloutRate ?? input.client?.calloutRate ?? 450;
      const hourly = input.stored?.hourlyRate ?? input.client?.hourlyRate ?? 185;
      const travelRate = input.client?.travelRate ?? DEFAULT_FIELD_COST_RATE.travelRatePerKm;
      const travel =
        input.stored?.travelAmount ?? roundMoney(travelKm * travelRate);
      return roundMoney(callout + labourHours * hourly + travel);
    }
    default:
      return roundMoney(resolveJobBillableValue(input.job));
  }
}

export function computeJobProfitability(input: {
  job: FieldJob & { billableValue?: number | null; clientId?: string | null };
  jobCost: FieldJobCost;
  client: ClientBillingProfile | null;
  storedRevenue?: JobRevenueRow | null;
  vehicleCostShare?: number;
  assetCostShare?: number;
}): JobProfitabilityRow {
  const revenue = computeJobRevenueAmount({
    job: input.job,
    jobCost: input.jobCost,
    client: input.client,
    stored: input.storedRevenue,
  });
  const vehicleCost = roundMoney(input.vehicleCostShare ?? input.jobCost.travelCost * 0.35);
  const assetCost = roundMoney(input.assetCostShare ?? (input.job.assetId ? 650 : 0));
  const labourCost = input.jobCost.labourCost;
  const travelCost = input.jobCost.travelCost;
  const overtimeCost = input.jobCost.overtimeCost;
  const totalCost = roundMoney(
    labourCost + travelCost + vehicleCost + assetCost + overtimeCost
  );
  const profit = roundMoney(revenue - totalCost);
  const marginPct = revenue > 0 ? roundPct((profit / revenue) * 100) : 0;

  return {
    jobId: input.job.id,
    jobRef: input.job.jobRef,
    jobTitle: input.job.title,
    clientId: input.client?.id ?? null,
    clientName: input.client?.clientName ?? input.job.customerName,
    employeeId: input.jobCost.employeeId,
    siteKey: input.jobCost.siteKey,
    siteLabel: resolveSiteLabel(input.job),
    revenue,
    labourCost,
    travelCost,
    vehicleCost,
    assetCost,
    overtimeCost,
    totalCost,
    profit,
    marginPct,
  };
}

export function buildClientProfitability(
  rows: JobProfitabilityRow[],
  clients: ClientBillingProfile[]
): ClientProfitabilityRow[] {
  const map = new Map<string, ClientProfitabilityRow>();

  for (const row of rows) {
    const clientId = row.clientId || `name:${(row.clientName || "Unknown").toLowerCase()}`;
    const clientName =
      row.clientName ||
      clients.find((c) => c.id === row.clientId)?.clientName ||
      "Unassigned Client";
    const existing = map.get(clientId) || {
      clientId: row.clientId || clientId,
      clientName,
      jobsCompleted: 0,
      revenue: 0,
      labourCost: 0,
      travelCost: 0,
      vehicleCost: 0,
      assetCost: 0,
      profit: 0,
      marginPct: 0,
    };
    existing.jobsCompleted += 1;
    existing.revenue = roundMoney(existing.revenue + row.revenue);
    existing.labourCost = roundMoney(existing.labourCost + row.labourCost);
    existing.travelCost = roundMoney(existing.travelCost + row.travelCost);
    existing.vehicleCost = roundMoney(existing.vehicleCost + row.vehicleCost);
    existing.assetCost = roundMoney(existing.assetCost + row.assetCost);
    existing.profit = roundMoney(existing.profit + row.profit);
    map.set(clientId, existing);
  }

  return [...map.values()].map((row) => ({
    ...row,
    marginPct: row.revenue > 0 ? roundPct((row.profit / row.revenue) * 100) : 0,
  }));
}

export function buildTechnicianProfitability(rows: JobProfitabilityRow[]): TechnicianProfitabilityRow[] {
  const map = new Map<string, TechnicianProfitabilityRow>();

  for (const row of rows) {
    if (!row.employeeId) continue;
    const existing = map.get(row.employeeId) || {
      employeeId: row.employeeId,
      revenueGenerated: 0,
      labourCost: 0,
      travelCost: 0,
      profitContribution: 0,
      productivityPct: 0,
      jobsCompleted: 0,
    };
    existing.jobsCompleted += 1;
    existing.revenueGenerated = roundMoney(existing.revenueGenerated + row.revenue);
    existing.labourCost = roundMoney(existing.labourCost + row.labourCost);
    existing.travelCost = roundMoney(existing.travelCost + row.travelCost);
    existing.profitContribution = roundMoney(existing.profitContribution + row.profit);
    map.set(row.employeeId, existing);
  }

  return [...map.values()].map((row) => ({
    ...row,
    productivityPct:
      row.revenueGenerated > 0
        ? roundPct((row.profitContribution / row.revenueGenerated) * 100)
        : 0,
  }));
}

export function buildSiteProfitability(
  rows: JobProfitabilityRow[],
  jobCosts: FieldJobCost[]
): SiteProfitabilityRow[] {
  const map = new Map<string, SiteProfitabilityRow>();

  for (const row of rows) {
    const siteKey = row.siteKey || `job:${row.jobId}`;
    const jobCost = jobCosts.find((j) => j.jobId === row.jobId);
    const existing = map.get(siteKey) || {
      siteKey,
      siteLabel: row.siteLabel,
      revenue: 0,
      totalCost: 0,
      marginPct: 0,
      jobsCount: 0,
      travelSeconds: 0,
      labourSeconds: 0,
    };
    existing.jobsCount += 1;
    existing.revenue = roundMoney(existing.revenue + row.revenue);
    existing.totalCost = roundMoney(existing.totalCost + row.totalCost);
    existing.travelSeconds += jobCost?.travelSeconds ?? 0;
    existing.labourSeconds += jobCost?.labourSeconds ?? 0;
    map.set(siteKey, existing);
  }

  return [...map.values()].map((row) => ({
    ...row,
    marginPct:
      row.revenue > 0 ? roundPct(((row.revenue - row.totalCost) / row.revenue) * 100) : 0,
  }));
}

export function detectProfitabilityAlerts(input: {
  jobRows: JobProfitabilityRow[];
  clientRows: ClientProfitabilityRow[];
}): Omit<ProfitabilityAlert, "id" | "detectedAt">[] {
  const alerts: Omit<ProfitabilityAlert, "id" | "detectedAt">[] = [];

  for (const job of input.jobRows) {
    if (job.profit < 0) {
      alerts.push({
        alertType: "negative_margin_job",
        severity: "critical",
        clientId: job.clientId,
        jobId: job.jobId,
        employeeId: job.employeeId,
        message: `${job.jobRef} loses ${formatCurrency(Math.abs(job.profit))} (margin ${job.marginPct}%).`,
        amountZar: Math.abs(job.profit),
      });
    } else if (job.marginPct < PROFITABILITY_THRESHOLDS.lowMarginPct && job.revenue > 0) {
      alerts.push({
        alertType: "low_margin_job",
        severity: "warning",
        clientId: job.clientId,
        jobId: job.jobId,
        employeeId: job.employeeId,
        message: `${job.jobRef} margin ${job.marginPct}% below ${PROFITABILITY_THRESHOLDS.lowMarginPct}% target.`,
        amountZar: null,
      });
    }

    if (job.labourCost > job.revenue && job.revenue > 0) {
      alerts.push({
        alertType: "labour_cost_exceeds_revenue",
        severity: "critical",
        clientId: job.clientId,
        jobId: job.jobId,
        employeeId: job.employeeId,
        message: `${job.jobRef}: labour ${formatCurrency(job.labourCost)} exceeds revenue ${formatCurrency(job.revenue)}.`,
        amountZar: roundMoney(job.labourCost - job.revenue),
      });
    }

    if (job.travelCost >= PROFITABILITY_THRESHOLDS.excessiveTravelCostZar) {
      alerts.push({
        alertType: "excessive_travel_cost",
        severity: "warning",
        clientId: job.clientId,
        jobId: job.jobId,
        employeeId: job.employeeId,
        message: `${job.jobRef} travel cost ${formatCurrency(job.travelCost)} is excessive.`,
        amountZar: job.travelCost,
      });
    }

    if (job.vehicleCost >= PROFITABILITY_THRESHOLDS.vehicleCostHighZar) {
      alerts.push({
        alertType: "vehicle_cost_too_high",
        severity: "warning",
        clientId: job.clientId,
        jobId: job.jobId,
        employeeId: job.employeeId,
        message: `${job.jobRef} vehicle cost ${formatCurrency(job.vehicleCost)} is elevated.`,
        amountZar: job.vehicleCost,
      });
    }
  }

  for (const client of input.clientRows) {
    if (
      client.revenue > 0 &&
      client.marginPct < PROFITABILITY_THRESHOLDS.clientMarginTargetPct
    ) {
      alerts.push({
        alertType: "client_below_margin_target",
        severity: "warning",
        clientId: client.clientId.startsWith("name:") ? null : client.clientId,
        jobId: null,
        employeeId: null,
        message: `${client.clientName} margin ${client.marginPct}% below client target.`,
        amountZar: null,
      });
    }
  }

  return alerts;
}

export function buildProfitabilityLeaderboards(input: {
  clientRows: ClientProfitabilityRow[];
  technicianRows: TechnicianProfitabilityRow[];
  siteRows: SiteProfitabilityRow[];
  jobRows: JobProfitabilityRow[];
}): ProfitabilityLeaderboards {
  const topClients = [...input.clientRows]
    .sort((a, b) => b.profit - a.profit)
    .slice(0, 5)
    .map((c) => ({
      id: c.clientId,
      label: c.clientName,
      profit: c.profit,
      marginPct: c.marginPct,
    }));

  const topTechnicians = [...input.technicianRows]
    .sort((a, b) => b.profitContribution - a.profitContribution)
    .slice(0, 5)
    .map((t) => ({
      id: t.employeeId,
      label: t.employeeId,
      profit: t.profitContribution,
      productivityPct: t.productivityPct,
    }));

  const topSites = [...input.siteRows]
    .sort((a, b) => b.marginPct - a.marginPct)
    .slice(0, 5)
    .map((s) => ({
      id: s.siteKey,
      label: s.siteLabel,
      marginPct: s.marginPct,
      revenue: s.revenue,
    }));

  const sortedJobs = [...input.jobRows].sort((a, b) => b.marginPct - a.marginPct);

  return {
    topClients,
    topTechnicians,
    topSites,
    highestMarginJobs: sortedJobs.slice(0, 5),
    lowestMarginJobs: [...sortedJobs].reverse().slice(0, 5),
  };
}

function buildReports(input: {
  jobRows: JobProfitabilityRow[];
  clientRows: ClientProfitabilityRow[];
  technicianRows: TechnicianProfitabilityRow[];
  siteRows: SiteProfitabilityRow[];
}): ProfitabilityReports {
  return {
    jobProfitability: input.jobRows,
    clientProfitability: input.clientRows,
    technicianProfitability: input.technicianRows,
    siteProfitability: input.siteRows,
    travelCostAnalysis: input.jobRows.map((j) => ({
      jobRef: j.jobRef,
      travelCost: j.travelCost,
      revenue: j.revenue,
      pct: j.revenue > 0 ? roundPct((j.travelCost / j.revenue) * 100) : 0,
    })),
    labourCostAnalysis: input.jobRows.map((j) => ({
      jobRef: j.jobRef,
      labourCost: j.labourCost,
      revenue: j.revenue,
      pct: j.revenue > 0 ? roundPct((j.labourCost / j.revenue) * 100) : 0,
    })),
  };
}

async function fetchJobsWithClient(
  supabase: SupabaseClient,
  companyId: string
): Promise<Array<FieldJob & { billableValue?: number | null; clientId?: string | null }>> {
  const { data, error } = await supabase
    .from("field_jobs")
    .select(
      "id, company_id, job_ref, title, description, status, site_type, store_id, customer_name, customer_address, client_id, asset_id, vehicle_id, trailer_id, latitude, longitude, scheduled_start, scheduled_end, priority, notes, created_at, updated_at, billable_value, estimated_labour_minutes"
    )
    .eq("company_id", companyId);

  if (error || !data) return [];

  return data.map((row) => {
    const base = row as Record<string, unknown>;
    return {
      id: String(base.id),
      companyId: String(base.company_id),
      jobRef: String(base.job_ref),
      title: String(base.title),
      description: base.description ? String(base.description) : null,
      status: base.status as FieldJob["status"],
      siteType: base.site_type as FieldJob["siteType"],
      storeId: base.store_id ? String(base.store_id) : null,
      customerName: base.customer_name ? String(base.customer_name) : null,
      customerAddress: base.customer_address ? String(base.customer_address) : null,
      clientId: base.client_id ? String(base.client_id) : null,
      assetId: base.asset_id ? String(base.asset_id) : null,
      vehicleId: base.vehicle_id ? String(base.vehicle_id) : null,
      trailerId: base.trailer_id ? String(base.trailer_id) : null,
      latitude: base.latitude != null ? Number(base.latitude) : null,
      longitude: base.longitude != null ? Number(base.longitude) : null,
      scheduledStart: base.scheduled_start ? String(base.scheduled_start) : null,
      scheduledEnd: base.scheduled_end ? String(base.scheduled_end) : null,
      priority: String(base.priority || "normal"),
      notes: base.notes ? String(base.notes) : null,
      createdAt: String(base.created_at),
      updatedAt: String(base.updated_at),
      billableValue: num(base.billable_value),
    };
  });
}

export async function createClientBillingProfile(
  supabase: SupabaseClient,
  input: {
    companyId: string;
    clientName: string;
    industry?: string | null;
    billingModel?: RevenueModel;
    hourlyRate?: number;
    calloutRate?: number;
    travelRate?: number;
    contractValue?: number | null;
    status?: ClientBillingStatus;
  }
): Promise<{ client: ClientBillingProfile | null; error: string | null }> {
  const { data, error } = await supabase
    .from("client_billing_profiles")
    .insert({
      company_id: input.companyId,
      client_name: input.clientName.trim(),
      industry: input.industry?.trim() || null,
      billing_model: input.billingModel || "hourly",
      hourly_rate: input.hourlyRate ?? 185,
      callout_rate: input.calloutRate ?? 450,
      travel_rate: input.travelRate ?? 4.5,
      contract_value: input.contractValue ?? null,
      status: input.status || "active",
      updated_at: new Date().toISOString(),
    })
    .select("*")
    .single();

  if (error || !data) return { client: null, error: error?.message || "Failed to create client." };
  return { client: rowToClient(data as Record<string, unknown>), error: null };
}

export async function loadProfitabilityDashboard(
  supabase: SupabaseClient,
  companyId: string,
  focusDate = new Date().toISOString().slice(0, 10)
): Promise<ProfitabilityDashboard> {
  const { start: monthStart, end: monthEnd } = monthBounds(focusDate);
  const empty: ProfitabilityDashboard = {
    focusDate,
    monthStart,
    monthEnd,
    revenueToday: 0,
    revenueThisMonth: 0,
    grossMargin: 0,
    grossMarginPct: 0,
    mostProfitableClient: null,
    leastProfitableClient: null,
    mostProfitableTechnician: null,
    jobsLosingMoney: 0,
    estimatedLeakage: 0,
    clients: [],
    jobProfitability: [],
    clientProfitability: [],
    technicianProfitability: [],
    siteProfitability: [],
    alerts: [],
    leaderboards: {
      topClients: [],
      topTechnicians: [],
      topSites: [],
      highestMarginJobs: [],
      lowestMarginJobs: [],
    },
    reports: {
      jobProfitability: [],
      clientProfitability: [],
      technicianProfitability: [],
      siteProfitability: [],
      travelCostAnalysis: [],
      labourCostAnalysis: [],
    },
    currency: "ZAR",
    tablesAvailable: false,
    error: null,
  };

  if (!companyId) return empty;

  const [clientsRes, revenueRes, alertsRes] = await Promise.all([
    supabase.from("client_billing_profiles").select("*").eq("company_id", companyId).order("client_name"),
    supabase.from("job_revenue").select("*").eq("company_id", companyId),
    supabase
      .from("profitability_alerts")
      .select("*")
      .eq("company_id", companyId)
      .is("resolved_at", null)
      .order("detected_at", { ascending: false })
      .limit(40),
  ]);

  if (clientsRes.error && isProfitMissingTableError(clientsRes.error)) {
    return empty;
  }

  const clients = (clientsRes.data || []).map((r) => rowToClient(r as Record<string, unknown>));
  const revenueRows = (revenueRes.data || []).map((r) => rowToJobRevenue(r as Record<string, unknown>));

  const costToday = await loadWorkforceCostDashboard(supabase, companyId, focusDate);
  const jobs = await fetchJobsWithClient(supabase, companyId);
  const snapshot = await fetchFieldOperationsSnapshot(supabase, companyId);
  const { rates } = await fetchFieldCostRates(supabase, companyId);

  const todayDashboard = costToday.dashboard;
  const jobCostsToday = todayDashboard?.jobCosts || [];

  const jobProfitToday: JobProfitabilityRow[] = [];
  for (const jobCost of jobCostsToday) {
    const job = jobs.find((j) => j.id === jobCost.jobId);
    if (!job) continue;
    const client = resolveClientForJob(job, clients);
    const stored = revenueRows.find(
      (r) => r.jobId === job.id && r.revenueDate === focusDate
    );
    jobProfitToday.push(
      computeJobProfitability({
        job,
        jobCost,
        client,
        storedRevenue: stored,
        vehicleCostShare: job.vehicleId ? jobCost.travelCost * 0.4 : 0,
        assetCostShare: job.assetId ? 650 : 0,
      })
    );
  }

  const monthJobProfit: JobProfitabilityRow[] = [];
  const datesInMonth: string[] = [];
  for (let d = 1; d <= Number(monthEnd.split("-")[2]); d += 1) {
    const day = String(d).padStart(2, "0");
    datesInMonth.push(`${monthStart.slice(0, 8)}${day}`);
  }

  for (const date of datesInMonth) {
    if (date > focusDate) continue;
    const dayCost = buildWorkforceCostDashboard({
      snapshot,
      costDate: date,
      companyId,
      rates,
      jobsWithBilling: jobs,
    });
    for (const jobCost of dayCost.jobCosts) {
      const job = jobs.find((j) => j.id === jobCost.jobId);
      if (!job) continue;
      const client = resolveClientForJob(job, clients);
      const stored = revenueRows.find((r) => r.jobId === job.id && r.revenueDate === date);
      monthJobProfit.push(
        computeJobProfitability({
          job,
          jobCost,
          client,
          storedRevenue: stored,
          vehicleCostShare: job.vehicleId ? jobCost.travelCost * 0.4 : 0,
          assetCostShare: job.assetId ? 650 : 0,
        })
      );
    }
  }

  const clientProfitability = buildClientProfitability(monthJobProfit, clients);
  const technicianProfitability = buildTechnicianProfitability(monthJobProfit);
  const siteProfitability = buildSiteProfitability(monthJobProfit, jobCostsToday);
  const detectedAlerts = detectProfitabilityAlerts({
    jobRows: jobProfitToday,
    clientRows: clientProfitability,
  });

  const storedAlerts: ProfitabilityAlert[] = (alertsRes.data || []).map((row) => ({
    id: String((row as Record<string, unknown>).id),
    alertType: (row as Record<string, unknown>).alert_type as ProfitabilityAlertType,
    severity:
      (row as Record<string, unknown>).severity === "critical"
        ? "critical"
        : (row as Record<string, unknown>).severity === "info"
          ? "info"
          : "warning",
    clientId: (row as Record<string, unknown>).client_id
      ? String((row as Record<string, unknown>).client_id)
      : null,
    jobId: (row as Record<string, unknown>).job_id
      ? String((row as Record<string, unknown>).job_id)
      : null,
    employeeId: (row as Record<string, unknown>).employee_id
      ? String((row as Record<string, unknown>).employee_id)
      : null,
    message: String((row as Record<string, unknown>).message),
    amountZar: num((row as Record<string, unknown>).amount_zar),
    detectedAt: String((row as Record<string, unknown>).detected_at),
  }));

  const alerts: ProfitabilityAlert[] =
    storedAlerts.length > 0
      ? storedAlerts
      : detectedAlerts.map((a, i) => ({
          ...a,
          id: `detected-${i}`,
          detectedAt: new Date().toISOString(),
        }));

  const revenueToday = roundMoney(jobProfitToday.reduce((s, j) => s + j.revenue, 0));
  const revenueThisMonth = roundMoney(monthJobProfit.reduce((s, j) => s + j.revenue, 0));
  const monthProfit = roundMoney(monthJobProfit.reduce((s, j) => s + j.profit, 0));
  const grossMarginPct =
    revenueThisMonth > 0 ? roundPct((monthProfit / revenueThisMonth) * 100) : 0;

  const sortedClients = [...clientProfitability].sort((a, b) => b.profit - a.profit);
  const sortedTechs = [...technicianProfitability].sort(
    (a, b) => b.profitContribution - a.profitContribution
  );

  const leaderboards = buildProfitabilityLeaderboards({
    clientRows: clientProfitability,
    technicianRows: technicianProfitability,
    siteRows: siteProfitability,
    jobRows: monthJobProfit,
  });

  const reports = buildReports({
    jobRows: monthJobProfit,
    clientRows: clientProfitability,
    technicianRows: technicianProfitability,
    siteRows: siteProfitability,
  });

  return {
    focusDate,
    monthStart,
    monthEnd,
    revenueToday,
    revenueThisMonth,
    grossMargin: monthProfit,
    grossMarginPct,
    mostProfitableClient: sortedClients[0]
      ? { name: sortedClients[0].clientName, profit: sortedClients[0].profit }
      : null,
    leastProfitableClient: sortedClients.length
      ? {
          name: sortedClients[sortedClients.length - 1].clientName,
          profit: sortedClients[sortedClients.length - 1].profit,
        }
      : null,
    mostProfitableTechnician: sortedTechs[0]
      ? { name: sortedTechs[0].employeeId, profit: sortedTechs[0].profitContribution }
      : null,
    jobsLosingMoney: monthJobProfit.filter((j) => j.profit < 0).length,
    estimatedLeakage: todayDashboard?.estimatedLeakage ?? 0,
    clients,
    jobProfitability: jobProfitToday,
    clientProfitability,
    technicianProfitability,
    siteProfitability,
    alerts,
    leaderboards,
    reports,
    currency: todayDashboard?.currency || "ZAR",
    tablesAvailable: !clientsRes.error || !isProfitMissingTableError(clientsRes.error),
    error: costToday.error || snapshot.error,
  };
}

export function formatRevenueModel(model: RevenueModel): string {
  return model
    .replaceAll("_", " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export function formatClientStatus(status: ClientBillingStatus): string {
  return status.charAt(0).toUpperCase() + status.slice(1);
}

export { formatCurrency };

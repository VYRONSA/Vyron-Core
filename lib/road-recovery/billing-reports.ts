/**
 * VYRON CORE — Road & Recovery operational billing reports (Phase 5).
 *
 * ---------------------------------------------------------------------------
 * THESE ARE OPERATIONAL REPORTS, NOT ACCOUNTING REPORTS
 * ---------------------------------------------------------------------------
 *
 * They answer questions a controller or billing administrator asks about WORK:
 * what is ready to be invoiced, what is blocked and why, what distance was captured,
 * what is disputed, what a counterparty owes us information for.
 *
 * They are not a debtors age analysis, a VAT return, a statement or a ledger. Nothing
 * here reads or writes an invoice, a payment or an accounting document, because VYRON
 * CORE does not have any — those belong to VYRON FINANCE.
 *
 * ---------------------------------------------------------------------------
 * READ-ONLY, TENANT-SCOPED
 * ---------------------------------------------------------------------------
 *
 * Every query filters on company_id AND runs under the caller's own RLS context, so a
 * report can never reach another tenant's data even if a filter were forgotten. Nothing
 * in this file writes.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { RrServiceResult } from "@/lib/road-recovery/job-service";
import { RR_DISTANCE_TOLERANCE_PERCENT } from "@/lib/road-recovery/billing-service";

type Row = Record<string, unknown>;

function asText(value: unknown): string {
  return String(value ?? "").trim();
}

function asNumber(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function asNumberOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function fail(message: string, status = 400): { ok: false; status: number; message: string } {
  return { ok: false, status, message };
}

export const RR_BILLING_REPORTS = [
  "billing_readiness",
  "awaiting_finance",
  "invoice_information",
  "bystand_billing",
  "storage_billing",
  "tow_distance",
  "disputed_distance",
  "authorisation_vs_actual",
  "counterparty_summary",
  "profitability",
  "outstanding_information",
  "billing_exceptions",
] as const;
export type RrBillingReportKey = (typeof RR_BILLING_REPORTS)[number];

export const RR_BILLING_REPORT_LABELS: Record<RrBillingReportKey, string> = {
  billing_readiness: "Billing Readiness",
  awaiting_finance: "Ready for Finance",
  invoice_information: "Invoice Information",
  bystand_billing: "BYSTAND Billing",
  storage_billing: "Storage Billing",
  tow_distance: "Tow Distance",
  disputed_distance: "Disputed Distance",
  authorisation_vs_actual: "Authorisation vs Actual",
  counterparty_summary: "Counterparty Summary",
  profitability: "Profitability",
  outstanding_information: "Outstanding Billing Information",
  billing_exceptions: "Billing Exceptions",
};

export type ReportFilters = {
  companyId: string;
  from?: string | null;
  to?: string | null;
  counterpartyId?: string | null;
  serviceCode?: string | null;
  limit?: number;
};

export type BillingReport = {
  key: RrBillingReportKey;
  label: string;
  generatedAt: string;
  /** Stated on every report so no reader mistakes it for an accounting document. */
  disclaimer: string;
  columns: { key: string; label: string; numeric?: boolean }[];
  rows: Record<string, unknown>[];
  summary: Record<string, unknown>;
};

const DISCLAIMER =
  "Operational billing information from UMORA. Not an invoice, statement or accounting record — invoicing, VAT, debtors and payments belong to VYRON FINANCE.";

// ---------------------------------------------------------------------------
// Shared loading
// ---------------------------------------------------------------------------

/**
 * The job spine every report starts from, with the pieces they all need.
 *
 * Loaded once and joined in memory rather than as one enormous SQL join: the transport is
 * the Supabase query builder in production, and a readable set of scoped reads is easier
 * to keep tenant-safe than a hand-built join.
 */
async function loadBillingSpine(
  supabase: SupabaseClient,
  filters: ReportFilters
): Promise<{
  jobs: Row[];
  serviceByType: Map<string, string>;
  counterparties: Map<string, Row>;
  fieldJobs: Map<string, Row>;
  calculations: Map<string, Row>;
  snapshots: Map<string, Row>;
  authorisations: Map<string, Row>;
  exceptions: Row[];
  error: string | null;
}> {
  const limit = Math.min(filters.limit ?? 500, 2000);

  let jobQuery = supabase
    .from("rr_service_jobs")
    .select(
      "id,field_job_id,service_type_id,workflow_key,service_state,counterparty_id,created_at,incident_at,origin_label,destination_label,vehicle_registration,vehicle_make,vehicle_model,customer_name"
    )
    .eq("company_id", filters.companyId)
    .eq("record_status", "active")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (filters.counterpartyId) jobQuery = jobQuery.eq("counterparty_id", filters.counterpartyId);

  const [jobsRes, typesRes, counterpartiesRes] = await Promise.all([
    jobQuery,
    supabase.from("rr_service_types").select("id,service_code").eq("company_id", filters.companyId),
    supabase
      .from("rr_counterparties")
      .select("id,legal_name,trading_name,vat_number")
      .eq("company_id", filters.companyId),
  ]);

  if (jobsRes.error) {
    return {
      jobs: [], serviceByType: new Map(), counterparties: new Map(), fieldJobs: new Map(),
      calculations: new Map(), snapshots: new Map(), authorisations: new Map(), exceptions: [],
      error: "Could not load Road & Recovery jobs.",
    };
  }

  const serviceByType = new Map(
    ((typesRes.data || []) as Row[]).map((row) => [asText(row.id), asText(row.service_code)])
  );

  let jobs = (jobsRes.data || []) as Row[];

  // Date and service filters are applied here rather than in SQL so every report shares
  // one definition of "in period" — the job's creation instant.
  if (filters.from) {
    const from = new Date(filters.from).getTime();
    jobs = jobs.filter((job) => new Date(asText(job.created_at)).getTime() >= from);
  }
  if (filters.to) {
    const to = new Date(filters.to).getTime();
    jobs = jobs.filter((job) => new Date(asText(job.created_at)).getTime() <= to);
  }
  if (filters.serviceCode) {
    jobs = jobs.filter(
      (job) => serviceByType.get(asText(job.service_type_id)) === filters.serviceCode
    );
  }

  const jobIds = jobs.map((job) => asText(job.id));
  const fieldJobIds = jobs.map((job) => asText(job.field_job_id)).filter(Boolean);

  if (jobIds.length === 0) {
    return {
      jobs: [], serviceByType, counterparties: new Map(), fieldJobs: new Map(),
      calculations: new Map(), snapshots: new Map(), authorisations: new Map(), exceptions: [],
      error: null,
    };
  }

  const [fieldJobsRes, calcRes, snapshotRes, authRes, exceptionRes] = await Promise.all([
    supabase.from("field_jobs").select("id,job_ref,title,status").eq("company_id", filters.companyId).in("id", fieldJobIds),
    supabase
      .from("rr_charge_calculations")
      .select("id,service_job_id,status,subtotal_ex_vat,vat_amount,total_incl_vat,currency,missing_facts,unrated_facts,rate_policy_key,rate_version,calculated_at,after_hours,public_holiday,engine_version")
      .eq("company_id", filters.companyId)
      .in("service_job_id", jobIds)
      .order("calculated_at", { ascending: false }),
    supabase
      .from("rr_job_rate_snapshot")
      .select("service_job_id,policy_key,policy_version,currency,vat_rate,resolved_at")
      .eq("company_id", filters.companyId)
      .in("service_job_id", jobIds),
    supabase
      .from("rr_authorisations")
      .select("service_job_id,authorisation_number,claim_reference,po_number,authorised_amount,currency,status,expires_at")
      .eq("company_id", filters.companyId)
      .in("service_job_id", jobIds)
      .eq("status", "active"),
    supabase
      .from("rr_billing_exceptions")
      .select("id,service_job_id,exception_code,severity,detail,detected_by,detected_at,resolution_status,resolved_by,resolved_at,automation_action_id")
      .eq("company_id", filters.companyId)
      .in("service_job_id", jobIds),
  ]);

  // The LATEST calculation per job. Rows arrive newest-first, so the first wins.
  const calculations = new Map<string, Row>();
  for (const row of (calcRes.data || []) as Row[]) {
    const key = asText(row.service_job_id);
    if (!calculations.has(key)) calculations.set(key, row);
  }

  return {
    jobs,
    serviceByType,
    counterparties: new Map(
      ((counterpartiesRes.data || []) as Row[]).map((row) => [asText(row.id), row])
    ),
    fieldJobs: new Map(((fieldJobsRes.data || []) as Row[]).map((row) => [asText(row.id), row])),
    calculations,
    snapshots: new Map(
      ((snapshotRes.data || []) as Row[]).map((row) => [asText(row.service_job_id), row])
    ),
    authorisations: new Map(
      ((authRes.data || []) as Row[]).map((row) => [asText(row.service_job_id), row])
    ),
    exceptions: (exceptionRes.data || []) as Row[],
    error: null,
  };
}

function report(
  key: RrBillingReportKey,
  columns: BillingReport["columns"],
  rows: Record<string, unknown>[],
  summary: Record<string, unknown>,
  at: string
): BillingReport {
  return {
    key,
    label: RR_BILLING_REPORT_LABELS[key],
    generatedAt: at,
    disclaimer: DISCLAIMER,
    columns,
    rows,
    summary,
  };
}

/**
 * Why a job is not ready, derived WITHOUT re-running the full readiness engine per job.
 *
 * The per-job engine is authoritative and is what the Billing Pack uses; a list of 500
 * jobs cannot afford 500 round trips, so the report derives the same gates from data it
 * has already loaded and says so.
 */
function blockingReasonsFor(
  job: Row,
  calculation: Row | undefined,
  snapshot: Row | undefined,
  authorisation: Row | undefined,
  openExceptions: Row[],
  at: string
): string[] {
  const reasons: string[] = [];
  const terminal = [
    "evidence_complete", "invoice_ready", "invoiced", "closed",
    "released", "disposed", "report_submitted",
  ];

  if (!terminal.includes(asText(job.service_state))) {
    reasons.push(`Work is not finished (${asText(job.service_state).replace(/_/g, " ")}).`);
  }
  if (!snapshot) reasons.push("No rate card has been resolved and frozen.");
  if (!calculation) {
    reasons.push("No charge calculation has been sealed.");
  } else if (asText(calculation.status) !== "calculated") {
    const gaps = [
      ...(Array.isArray(calculation.missing_facts) ? calculation.missing_facts : []),
      ...(Array.isArray(calculation.unrated_facts) ? calculation.unrated_facts : []),
    ];
    reasons.push(
      asText(calculation.status) === "not_chargeable"
        ? "The rate card has no rates set, so nothing could be priced."
        : `The calculation is incomplete: ${gaps.join(", ").replace(/_/g, " ")}.`
    );
  }
  if (asText(job.counterparty_id)) {
    if (!authorisation) {
      reasons.push("No active authorisation is on file.");
    } else {
      const expires = asText(authorisation.expires_at);
      if (expires && new Date(expires).getTime() < new Date(at).getTime()) {
        reasons.push("The authorisation has expired.");
      }
    }
  } else if (!asText(job.customer_name)) {
    reasons.push("Neither a counterparty nor a customer is recorded.");
  }
  if (openExceptions.length > 0) {
    reasons.push(
      `Open billing exception: ${openExceptions
        .map((row) => asText(row.exception_code).replace(/_/g, " "))
        .join(", ")}.`
    );
  }
  return reasons;
}

// ---------------------------------------------------------------------------
// 1. Billing Readiness
// ---------------------------------------------------------------------------

export async function billingReadinessReport(
  supabase: SupabaseClient,
  filters: ReportFilters,
  at = new Date().toISOString()
): Promise<RrServiceResult<BillingReport>> {
  const spine = await loadBillingSpine(supabase, filters);
  if (spine.error) return fail(spine.error, 500);

  const rows = spine.jobs.map((job) => {
    const jobId = asText(job.id);
    const calculation = spine.calculations.get(jobId);
    const snapshot = spine.snapshots.get(jobId);
    const authorisation = spine.authorisations.get(jobId);
    const open = spine.exceptions.filter(
      (row) =>
        asText(row.service_job_id) === jobId &&
        ["open", "acknowledged"].includes(asText(row.resolution_status))
    );
    const reasons = blockingReasonsFor(job, calculation, snapshot, authorisation, open, at);
    const counterparty = spine.counterparties.get(asText(job.counterparty_id));

    return {
      jobRef: asText(spine.fieldJobs.get(asText(job.field_job_id))?.job_ref) || null,
      serviceJobId: jobId,
      service: spine.serviceByType.get(asText(job.service_type_id)) || null,
      billTo: counterparty ? asText(counterparty.legal_name) : asText(job.customer_name) || null,
      vehicle: asText(job.vehicle_registration) || null,
      authorisation: authorisation ? asText(authorisation.authorisation_number) : null,
      claimReference: authorisation ? asText(authorisation.claim_reference) : null,
      state: asText(job.service_state),
      readiness: reasons.length === 0 ? "READY" : "BLOCKED",
      blockingReasons: reasons,
      expectedTotal: calculation ? asNumber(calculation.total_incl_vat) : null,
      currency: calculation ? asText(calculation.currency) : null,
      openExceptions: open.length,
    };
  });

  const ready = rows.filter((row) => row.readiness === "READY");

  return {
    ok: true,
    data: report(
      "billing_readiness",
      [
        { key: "jobRef", label: "Job" },
        { key: "service", label: "Service" },
        { key: "billTo", label: "Bill to" },
        { key: "vehicle", label: "Vehicle" },
        { key: "authorisation", label: "Authorisation" },
        { key: "state", label: "State" },
        { key: "readiness", label: "Readiness" },
        { key: "expectedTotal", label: "Expected total", numeric: true },
        { key: "openExceptions", label: "Exceptions", numeric: true },
      ],
      rows,
      {
        jobs: rows.length,
        ready: ready.length,
        blocked: rows.length - ready.length,
        expectedReadyValue:
          Math.round(ready.reduce((total, row) => total + (row.expectedTotal ?? 0), 0) * 100) / 100,
      },
      at
    ),
  };
}

// ---------------------------------------------------------------------------
// 2. Completed Jobs Awaiting Invoice — "Ready for Finance"
// ---------------------------------------------------------------------------

/**
 * Jobs whose billing information is complete and which VYRON FINANCE could invoice.
 *
 * "Awaiting invoice" NEVER means an invoice exists here. VYRON CORE creates none; this is
 * a queue of information ready to hand over.
 */
export async function awaitingFinanceReport(
  supabase: SupabaseClient,
  filters: ReportFilters,
  at = new Date().toISOString()
): Promise<RrServiceResult<BillingReport>> {
  const readiness = await billingReadinessReport(supabase, filters, at);
  if (!readiness.ok) return readiness;

  const rows = readiness.data.rows.filter((row) => row.readiness === "READY");

  return {
    ok: true,
    data: report(
      "awaiting_finance",
      [
        { key: "jobRef", label: "Job" },
        { key: "service", label: "Service" },
        { key: "billTo", label: "Bill to" },
        { key: "claimReference", label: "Claim" },
        { key: "vehicle", label: "Vehicle" },
        { key: "expectedTotal", label: "Expected total", numeric: true },
        { key: "currency", label: "Currency" },
      ],
      rows,
      {
        readyForFinance: rows.length,
        expectedValue:
          Math.round(
            rows.reduce((total, row) => total + ((row.expectedTotal as number | null) ?? 0), 0) * 100
          ) / 100,
        note: "Ready for VYRON FINANCE to invoice. No invoice exists in UMORA.",
      },
      at
    ),
  };
}

// ---------------------------------------------------------------------------
// 3. Invoice Information
// ---------------------------------------------------------------------------

export async function invoiceInformationReport(
  supabase: SupabaseClient,
  filters: ReportFilters,
  at = new Date().toISOString()
): Promise<RrServiceResult<BillingReport>> {
  const spine = await loadBillingSpine(supabase, filters);
  if (spine.error) return fail(spine.error, 500);

  const jobIds = spine.jobs.map((job) => asText(job.id));
  const lines =
    jobIds.length > 0
      ? ((
          await supabase
            .from("rr_charge_lines")
            .select("calculation_id,service_job_id,charge_code,label,chargeable_quantity,unit,rate_amount,subtotal_ex_vat,vat_amount,total_incl_vat,reason")
            .eq("company_id", filters.companyId)
            .in("service_job_id", jobIds)
        ).data || []) as Row[]
      : [];

  const rows = spine.jobs.flatMap((job) => {
    const jobId = asText(job.id);
    const calculation = spine.calculations.get(jobId);
    if (!calculation) return [];
    const snapshot = spine.snapshots.get(jobId);
    const authorisation = spine.authorisations.get(jobId);
    const counterparty = spine.counterparties.get(asText(job.counterparty_id));
    const calcId = asText(calculation.id);

    return lines
      .filter((line) => asText(line.calculation_id) === calcId)
      .map((line) => ({
        jobRef: asText(spine.fieldJobs.get(asText(job.field_job_id))?.job_ref) || null,
        serviceJobId: jobId,
        service: spine.serviceByType.get(asText(job.service_type_id)) || null,
        billTo: counterparty ? asText(counterparty.legal_name) : asText(job.customer_name) || null,
        vatNumber: counterparty ? asText(counterparty.vat_number) || null : null,
        claimReference: authorisation ? asText(authorisation.claim_reference) : null,
        vehicle: asText(job.vehicle_registration) || null,
        rateCard: snapshot ? `${asText(snapshot.policy_key)} v${asNumber(snapshot.policy_version)}` : null,
        chargeCode: asText(line.charge_code),
        description: asText(line.label),
        quantity: asNumber(line.chargeable_quantity),
        unit: asText(line.unit),
        rate: asNumber(line.rate_amount),
        subtotalExVat: asNumber(line.subtotal_ex_vat),
        vatAmount: asNumber(line.vat_amount),
        totalInclVat: asNumber(line.total_incl_vat),
        reason: asText(line.reason),
      }));
  });

  return {
    ok: true,
    data: report(
      "invoice_information",
      [
        { key: "jobRef", label: "Job" },
        { key: "billTo", label: "Bill to" },
        { key: "claimReference", label: "Claim" },
        { key: "chargeCode", label: "Charge" },
        { key: "description", label: "Description" },
        { key: "quantity", label: "Qty", numeric: true },
        { key: "unit", label: "Unit" },
        { key: "rate", label: "Rate", numeric: true },
        { key: "subtotalExVat", label: "Excl VAT", numeric: true },
        { key: "vatAmount", label: "VAT", numeric: true },
        { key: "totalInclVat", label: "Incl VAT", numeric: true },
        { key: "reason", label: "Why" },
      ],
      rows,
      {
        lines: rows.length,
        subtotalExVat: Math.round(rows.reduce((t, r) => t + r.subtotalExVat, 0) * 100) / 100,
        vatAmount: Math.round(rows.reduce((t, r) => t + r.vatAmount, 0) * 100) / 100,
        totalInclVat: Math.round(rows.reduce((t, r) => t + r.totalInclVat, 0) * 100) / 100,
      },
      at
    ),
  };
}

// ---------------------------------------------------------------------------
// 4. BYSTAND Billing
// ---------------------------------------------------------------------------

/**
 * BYSTAND jobs only, and standing charges only.
 *
 * A recovery charge appearing here would mean the separation failed somewhere, so the
 * report reports it as a violation rather than displaying it as a normal line.
 */
export async function bystandBillingReport(
  supabase: SupabaseClient,
  filters: ReportFilters,
  at = new Date().toISOString()
): Promise<RrServiceResult<BillingReport>> {
  const spine = await loadBillingSpine(supabase, { ...filters, serviceCode: null });
  if (spine.error) return fail(spine.error, 500);

  const bystandJobs = spine.jobs.filter((job) => asText(job.workflow_key) === "bystand");
  const jobIds = bystandJobs.map((job) => asText(job.id));
  if (jobIds.length === 0) {
    return {
      ok: true,
      data: report("bystand_billing", bystandColumns(), [], { jobs: 0, separationViolations: 0 }, at),
    };
  }

  const [factsRes, linesRes] = await Promise.all([
    supabase
      .from("rr_billable_facts")
      .select("service_job_id,fact_code,quantity,unit,status,source,calculation_version")
      .eq("company_id", filters.companyId)
      .in("service_job_id", jobIds),
    supabase
      .from("rr_charge_lines")
      .select("service_job_id,charge_code,chargeable_quantity,rate_amount,subtotal_ex_vat,total_incl_vat")
      .eq("company_id", filters.companyId)
      .in("service_job_id", jobIds),
  ]);

  const facts = (factsRes.data || []) as Row[];
  const lines = (linesRes.data || []) as Row[];

  const FORBIDDEN = [
    "tow_distance", "loading", "unloading", "delivery",
    "storage_days", "custody_handling", "recovery_hours", "release_fee",
  ];

  let violations = 0;

  const rows = bystandJobs.map((job) => {
    const jobId = asText(job.id);
    const jobFacts = facts.filter(
      (row) => asText(row.service_job_id) === jobId && asText(row.status) !== "superseded"
    );
    const jobLines = lines.filter((row) => asText(row.service_job_id) === jobId);
    const calculation = spine.calculations.get(jobId);
    const authorisation = spine.authorisations.get(jobId);
    const counterparty = spine.counterparties.get(asText(job.counterparty_id));

    const standing = jobFacts.find((row) => asText(row.fact_code) === "standing_time");
    const paused = jobFacts.find((row) => asText(row.fact_code) === "paused_time");
    const standingLine = jobLines.find((row) => asText(row.charge_code) === "standing_time");

    const offending = jobLines
      .map((row) => asText(row.charge_code))
      .filter((code) => FORBIDDEN.includes(code));
    if (offending.length > 0) violations += 1;

    const open = spine.exceptions.filter(
      (row) =>
        asText(row.service_job_id) === jobId &&
        ["open", "acknowledged"].includes(asText(row.resolution_status))
    );

    return {
      jobRef: asText(spine.fieldJobs.get(asText(job.field_job_id))?.job_ref) || null,
      serviceJobId: jobId,
      billTo: counterparty ? asText(counterparty.legal_name) : asText(job.customer_name) || null,
      vehicle: asText(job.vehicle_registration) || null,
      authorisation: authorisation ? asText(authorisation.authorisation_number) : null,
      standingHours: standing ? asNumber(standing.quantity) : null,
      pausedHours: paused ? asNumber(paused.quantity) : null,
      billableHours: standingLine ? asNumber(standingLine.chargeable_quantity) : null,
      rate: standingLine ? asNumber(standingLine.rate_amount) : null,
      expectedCharge: calculation ? asNumber(calculation.total_incl_vat) : null,
      sealedBy: standing ? asText(standing.calculation_version) || null : null,
      readiness: calculation && asText(calculation.status) === "calculated" && open.length === 0 ? "READY" : "BLOCKED",
      // Always empty in a correct system. Present so a failure is visible, not hidden.
      separationViolations: offending,
    };
  });

  return {
    ok: true,
    data: report(
      "bystand_billing",
      bystandColumns(),
      rows,
      {
        jobs: rows.length,
        billableHours:
          Math.round(rows.reduce((t, r) => t + (r.billableHours ?? 0), 0) * 1000) / 1000,
        expectedValue:
          Math.round(rows.reduce((t, r) => t + (r.expectedCharge ?? 0), 0) * 100) / 100,
        separationViolations: violations,
        note: "BYSTAND bills standing time only. Any tow, storage or custody charge here is a separation failure.",
      },
      at
    ),
  };
}

function bystandColumns(): BillingReport["columns"] {
  return [
    { key: "jobRef", label: "Job" },
    { key: "billTo", label: "Bill to" },
    { key: "vehicle", label: "Vehicle" },
    { key: "authorisation", label: "Authorisation" },
    { key: "standingHours", label: "Standing hrs", numeric: true },
    { key: "pausedHours", label: "Paused hrs", numeric: true },
    { key: "billableHours", label: "Billable hrs", numeric: true },
    { key: "rate", label: "Rate", numeric: true },
    { key: "expectedCharge", label: "Expected", numeric: true },
    { key: "sealedBy", label: "Calculator" },
    { key: "readiness", label: "Readiness" },
  ];
}

// ---------------------------------------------------------------------------
// 5. Storage Billing
// ---------------------------------------------------------------------------

/**
 * Storage billing, read from the SEALED accrual.
 *
 * Duration is never recomputed here — the sealed row and its calculator version are shown
 * exactly as Phase 4 wrote them.
 */
export async function storageBillingReport(
  supabase: SupabaseClient,
  filters: ReportFilters,
  at = new Date().toISOString()
): Promise<RrServiceResult<BillingReport>> {
  const spine = await loadBillingSpine(supabase, { ...filters, serviceCode: null });
  if (spine.error) return fail(spine.error, 500);

  const jobIds = spine.jobs.map((job) => asText(job.id));
  const columns: BillingReport["columns"] = [
    { key: "jobRef", label: "Job" },
    { key: "vehicle", label: "Vehicle" },
    { key: "yard", label: "Yard" },
    { key: "bay", label: "Bay" },
    { key: "checkedInAt", label: "Checked in" },
    { key: "checkedOutAt", label: "Checked out" },
    { key: "elapsedDays", label: "Elapsed days", numeric: true },
    { key: "chargeableDays", label: "Chargeable days", numeric: true },
    { key: "calculatorVersion", label: "Calculator" },
    { key: "rate", label: "Rate", numeric: true },
    { key: "expectedCharge", label: "Expected", numeric: true },
    { key: "readiness", label: "Readiness" },
  ];

  if (jobIds.length === 0) {
    return { ok: true, data: report("storage_billing", columns, [], { bookings: 0 }, at) };
  }

  const [bookingsRes, accrualsRes, yardsRes, linesRes] = await Promise.all([
    supabase
      .from("rr_storage_bookings")
      .select("id,service_job_id,yard_id,bay_reference,status,checked_in_at,checked_out_at,rate_basis,rate_amount,currency")
      .eq("company_id", filters.companyId)
      .in("service_job_id", jobIds),
    supabase
      .from("rr_storage_accrual")
      .select("booking_id,service_job_id,elapsed_days,chargeable_days,free_days_applied,billable_units,rate_amount,amount,currency,calculator_version,sealed_at")
      .eq("company_id", filters.companyId)
      .in("service_job_id", jobIds)
      .order("sealed_at", { ascending: false }),
    supabase.from("rr_custody_yards").select("id,name").eq("company_id", filters.companyId),
    supabase
      .from("rr_charge_lines")
      .select("service_job_id,charge_code,chargeable_quantity,rate_amount,total_incl_vat")
      .eq("company_id", filters.companyId)
      .in("service_job_id", jobIds),
  ]);

  const yards = new Map(((yardsRes.data || []) as Row[]).map((row) => [asText(row.id), asText(row.name)]));
  const accrualByBooking = new Map<string, Row>();
  for (const row of (accrualsRes.data || []) as Row[]) {
    const key = asText(row.booking_id);
    if (!accrualByBooking.has(key)) accrualByBooking.set(key, row);
  }
  const storageLines = ((linesRes.data || []) as Row[]).filter(
    (row) => asText(row.charge_code) === "storage_days"
  );

  const rows = ((bookingsRes.data || []) as Row[]).map((booking) => {
    const jobId = asText(booking.service_job_id);
    const job = spine.jobs.find((entry) => asText(entry.id) === jobId);
    const accrual = accrualByBooking.get(asText(booking.id));
    const line = storageLines.find((row) => asText(row.service_job_id) === jobId);
    const calculation = spine.calculations.get(jobId);

    return {
      jobRef: job ? asText(spine.fieldJobs.get(asText(job.field_job_id))?.job_ref) || null : null,
      serviceJobId: jobId,
      vehicle: job ? asText(job.vehicle_registration) || null : null,
      yard: yards.get(asText(booking.yard_id)) || null,
      bay: asText(booking.bay_reference) || null,
      status: asText(booking.status),
      checkedInAt: asText(booking.checked_in_at),
      checkedOutAt: booking.checked_out_at ? asText(booking.checked_out_at) : null,
      // READ from the sealed accrual. Never recomputed.
      elapsedDays: accrual ? asNumber(accrual.elapsed_days) : null,
      chargeableDays: line ? asNumber(line.chargeable_quantity) : accrual ? asNumber(accrual.chargeable_days) : null,
      freeDaysApplied: accrual ? asNumber(accrual.free_days_applied) : null,
      calculatorVersion: accrual ? asText(accrual.calculator_version) : null,
      sealedAt: accrual ? asText(accrual.sealed_at) : null,
      rate: line ? asNumber(line.rate_amount) : asNumberOrNull(booking.rate_amount),
      expectedCharge: line ? asNumber(line.total_incl_vat) : null,
      readiness: calculation && asText(calculation.status) === "calculated" ? "READY" : "BLOCKED",
    };
  });

  return {
    ok: true,
    data: report(
      "storage_billing",
      columns,
      rows,
      {
        bookings: rows.length,
        sealed: rows.filter((row) => row.calculatorVersion !== null).length,
        chargeableDays: rows.reduce((t, r) => t + (r.chargeableDays ?? 0), 0),
        expectedValue: Math.round(rows.reduce((t, r) => t + (r.expectedCharge ?? 0), 0) * 100) / 100,
        note: "Durations are read from the sealed accrual and are never recalculated at billing time.",
      },
      at
    ),
  };
}

// ---------------------------------------------------------------------------
// 6. Tow Distance
// ---------------------------------------------------------------------------

export async function towDistanceReport(
  supabase: SupabaseClient,
  filters: ReportFilters,
  at = new Date().toISOString()
): Promise<RrServiceResult<BillingReport>> {
  const spine = await loadBillingSpine(supabase, filters);
  if (spine.error) return fail(spine.error, 500);

  const jobIds = spine.jobs.map((job) => asText(job.id));
  const columns: BillingReport["columns"] = [
    { key: "jobRef", label: "Job" },
    { key: "vehicle", label: "Vehicle" },
    { key: "odometerStart", label: "Odometer start", numeric: true },
    { key: "odometerEnd", label: "Odometer end", numeric: true },
    { key: "capturedKm", label: "Captured km", numeric: true },
    { key: "dispatchEstimateKm", label: "Dispatch est.", numeric: true },
    { key: "variancePercent", label: "Variance %", numeric: true },
    { key: "tolerancePercent", label: "Tolerance %", numeric: true },
    { key: "status", label: "Status" },
    { key: "gpsEvidence", label: "GPS" },
    { key: "recordedBy", label: "Captured by" },
  ];

  if (jobIds.length === 0) {
    return { ok: true, data: report("tow_distance", columns, [], { captures: 0 }, at) };
  }

  const [factsRes, disputesRes] = await Promise.all([
    supabase
      .from("rr_billable_facts")
      .select("id,service_job_id,quantity,status,source,source_detail,evidence_id,recorded_by,occurred_at")
      .eq("company_id", filters.companyId)
      .in("service_job_id", jobIds)
      .eq("fact_code", "tow_distance"),
    supabase
      .from("rr_billing_disputes")
      .select("fact_id,status")
      .eq("company_id", filters.companyId)
      .in("service_job_id", jobIds)
      .eq("dispute_type", "distance"),
  ]);

  const disputes = new Map(
    ((disputesRes.data || []) as Row[]).map((row) => [asText(row.fact_id), asText(row.status)])
  );

  const rows = ((factsRes.data || []) as Row[]).map((fact) => {
    const jobId = asText(fact.service_job_id);
    const job = spine.jobs.find((entry) => asText(entry.id) === jobId);
    const detail = (fact.source_detail ?? {}) as Record<string, unknown>;
    const variance = asNumberOrNull(detail.variance_percent);
    const tolerance = asNumber(detail.tolerance_percent, RR_DISTANCE_TOLERANCE_PERCENT);

    return {
      jobRef: job ? asText(spine.fieldJobs.get(asText(job.field_job_id))?.job_ref) || null : null,
      serviceJobId: jobId,
      vehicle: job ? asText(job.vehicle_registration) || null : null,
      odometerStart: asNumberOrNull(detail.odometer_start_km),
      odometerEnd: asNumberOrNull(detail.odometer_end_km),
      capturedKm: asNumber(fact.quantity),
      dispatchEstimateKm: asNumberOrNull(detail.dispatch_estimate_km),
      variancePercent: variance,
      tolerancePercent: tolerance,
      source: asText(fact.source),
      factStatus: asText(fact.status),
      status:
        asText(fact.status) === "superseded"
          ? "superseded"
          : variance !== null && variance > tolerance
            ? "QUERIED"
            : "accepted",
      disputeStatus: disputes.get(asText(fact.id)) || null,
      gpsEvidence:
        detail.latitude !== null && detail.latitude !== undefined
          ? `${detail.latitude}, ${detail.longitude}`
          : null,
      evidenceId: asText(fact.evidence_id) || null,
      recordedBy: asText(fact.recorded_by),
      capturedAt: asText(fact.occurred_at),
    };
  });

  return {
    ok: true,
    data: report(
      "tow_distance",
      columns,
      rows,
      {
        captures: rows.length,
        queried: rows.filter((row) => row.status === "QUERIED").length,
        totalKm: Math.round(rows.filter((r) => r.factStatus !== "superseded").reduce((t, r) => t + r.capturedKm, 0) * 1000) / 1000,
        note: "The driver's odometer is the commercial source. GPS is supporting evidence; the dispatch estimate is only a comparison baseline.",
      },
      at
    ),
  };
}

// ---------------------------------------------------------------------------
// 7. Disputed Distance
// ---------------------------------------------------------------------------

/**
 * Every distance dispute, showing the ORIGINAL driver reading alongside the review.
 *
 * The original is never overwritten, so both values are always available — which is the
 * entire point of the append-only design.
 */
export async function disputedDistanceReport(
  supabase: SupabaseClient,
  filters: ReportFilters,
  at = new Date().toISOString()
): Promise<RrServiceResult<BillingReport>> {
  const spine = await loadBillingSpine(supabase, filters);
  if (spine.error) return fail(spine.error, 500);

  const jobIds = spine.jobs.map((job) => asText(job.id));
  const columns: BillingReport["columns"] = [
    { key: "jobRef", label: "Job" },
    { key: "vehicle", label: "Vehicle" },
    { key: "originalKm", label: "Driver km", numeric: true },
    { key: "disputedKm", label: "Disputed km", numeric: true },
    { key: "reviewedKm", label: "Reviewed km", numeric: true },
    { key: "finalKm", label: "Final km", numeric: true },
    { key: "raisedBy", label: "Raised by" },
    { key: "reason", label: "Reason" },
    { key: "reviewedBy", label: "Reviewer" },
    { key: "decision", label: "Decision" },
    { key: "status", label: "Status" },
  ];

  if (jobIds.length === 0) {
    return { ok: true, data: report("disputed_distance", columns, [], { disputes: 0 }, at) };
  }

  const [disputesRes, factsRes] = await Promise.all([
    supabase
      .from("rr_billing_disputes")
      .select("id,service_job_id,fact_id,replacement_fact_id,original_quantity,disputed_quantity,reviewed_quantity,unit,raised_by,raised_by_party,reason,evidence_id,raised_at,status,decision,review_notes,reviewed_by,reviewed_at")
      .eq("company_id", filters.companyId)
      .in("service_job_id", jobIds)
      .eq("dispute_type", "distance"),
    supabase
      .from("rr_billable_facts")
      .select("id,service_job_id,quantity,status")
      .eq("company_id", filters.companyId)
      .in("service_job_id", jobIds)
      .eq("fact_code", "tow_distance"),
  ]);

  const facts = (factsRes.data || []) as Row[];

  const rows = ((disputesRes.data || []) as Row[]).map((dispute) => {
    const jobId = asText(dispute.service_job_id);
    const job = spine.jobs.find((entry) => asText(entry.id) === jobId);
    const active = facts.find(
      (row) => asText(row.service_job_id) === jobId && asText(row.status) !== "superseded"
    );

    return {
      jobRef: job ? asText(spine.fieldJobs.get(asText(job.field_job_id))?.job_ref) || null : null,
      serviceJobId: jobId,
      vehicle: job ? asText(job.vehicle_registration) || null : null,
      // The driver's ORIGINAL reading, preserved forever.
      originalKm: asNumberOrNull(dispute.original_quantity),
      disputedKm: asNumberOrNull(dispute.disputed_quantity),
      reviewedKm: asNumberOrNull(dispute.reviewed_quantity),
      finalKm: active ? asNumber(active.quantity) : null,
      raisedBy: asText(dispute.raised_by),
      raisedByParty: asText(dispute.raised_by_party),
      reason: asText(dispute.reason),
      evidenceId: asText(dispute.evidence_id) || null,
      raisedAt: asText(dispute.raised_at),
      reviewedBy: asText(dispute.reviewed_by) || null,
      reviewedAt: asText(dispute.reviewed_at) || null,
      decision: asText(dispute.decision) || null,
      reviewNotes: asText(dispute.review_notes) || null,
      status: asText(dispute.status),
    };
  });

  return {
    ok: true,
    data: report(
      "disputed_distance",
      columns,
      rows,
      {
        disputes: rows.length,
        open: rows.filter((row) => ["open", "under_review"].includes(row.status)).length,
        note: "The driver's original reading is never overwritten. A correction is a new fact that supersedes it.",
      },
      at
    ),
  };
}

// ---------------------------------------------------------------------------
// 8. Authorisation vs Actual Charge
// ---------------------------------------------------------------------------

export async function authorisationVsActualReport(
  supabase: SupabaseClient,
  filters: ReportFilters,
  at = new Date().toISOString()
): Promise<RrServiceResult<BillingReport>> {
  const spine = await loadBillingSpine(supabase, filters);
  if (spine.error) return fail(spine.error, 500);

  const rows = spine.jobs
    .map((job) => {
      const jobId = asText(job.id);
      const authorisation = spine.authorisations.get(jobId);
      const calculation = spine.calculations.get(jobId);
      if (!authorisation || !calculation) return null;

      const authorised = asNumberOrNull(authorisation.authorised_amount);
      const expected = asNumber(calculation.total_incl_vat);
      const variance = authorised === null ? null : Math.round((expected - authorised) * 100) / 100;
      const variancePct =
        authorised === null || authorised === 0
          ? null
          : Math.round(((expected - authorised) / authorised) * 10000) / 100;

      const counterparty = spine.counterparties.get(asText(job.counterparty_id));

      return {
        jobRef: asText(spine.fieldJobs.get(asText(job.field_job_id))?.job_ref) || null,
        serviceJobId: jobId,
        billTo: counterparty ? asText(counterparty.legal_name) : null,
        authorisation: asText(authorisation.authorisation_number),
        claimReference: asText(authorisation.claim_reference) || null,
        authorisedAmount: authorised,
        expectedAmount: expected,
        currency: asText(calculation.currency),
        variance,
        variancePercent: variancePct,
        status:
          authorised === null
            ? "no ceiling"
            : variance !== null && variance > 0
              ? "OVER"
              : "within",
      };
    })
    .filter((row): row is NonNullable<typeof row> => row !== null);

  const over = rows.filter((row) => row.status === "OVER");

  return {
    ok: true,
    data: report(
      "authorisation_vs_actual",
      [
        { key: "jobRef", label: "Job" },
        { key: "billTo", label: "Counterparty" },
        { key: "authorisation", label: "Authorisation" },
        { key: "claimReference", label: "Claim" },
        { key: "authorisedAmount", label: "Authorised", numeric: true },
        { key: "expectedAmount", label: "Expected", numeric: true },
        { key: "variance", label: "Variance", numeric: true },
        { key: "variancePercent", label: "Variance %", numeric: true },
        { key: "status", label: "Status" },
      ],
      rows,
      {
        jobs: rows.length,
        over: over.length,
        totalOverBy: Math.round(over.reduce((t, r) => t + (r.variance ?? 0), 0) * 100) / 100,
        note: "The authorised amount is a ceiling to compare against, not a limit UMORA enforces.",
      },
      at
    ),
  };
}

// ---------------------------------------------------------------------------
// 9. Counterparty Billing Summary
// ---------------------------------------------------------------------------

export async function counterpartySummaryReport(
  supabase: SupabaseClient,
  filters: ReportFilters,
  at = new Date().toISOString()
): Promise<RrServiceResult<BillingReport>> {
  const readiness = await billingReadinessReport(supabase, filters, at);
  if (!readiness.ok) return readiness;

  const spine = await loadBillingSpine(supabase, filters);
  if (spine.error) return fail(spine.error, 500);

  const disputesRes = await supabase
    .from("rr_billing_disputes")
    .select("service_job_id,status")
    .eq("company_id", filters.companyId)
    .in("status", ["open", "under_review"]);

  const disputedJobs = new Set(
    ((disputesRes.data || []) as Row[]).map((row) => asText(row.service_job_id))
  );

  const byCounterparty = new Map<string, Record<string, unknown>>();

  for (const job of spine.jobs) {
    const jobId = asText(job.id);
    const counterpartyId = asText(job.counterparty_id) || "__direct__";
    const counterparty = spine.counterparties.get(counterpartyId);
    const readinessRow = readiness.data.rows.find((row) => row.serviceJobId === jobId);
    const calculation = spine.calculations.get(jobId);

    const entry =
      byCounterparty.get(counterpartyId) ??
      {
        counterparty: counterparty ? asText(counterparty.legal_name) : "Direct customers",
        vatNumber: counterparty ? asText(counterparty.vat_number) || null : null,
        jobs: 0,
        ready: 0,
        blocked: 0,
        disputed: 0,
        expectedValue: 0,
        outstandingInformation: 0,
      };

    entry.jobs = (entry.jobs as number) + 1;
    if (readinessRow?.readiness === "READY") entry.ready = (entry.ready as number) + 1;
    else {
      entry.blocked = (entry.blocked as number) + 1;
      entry.outstandingInformation = (entry.outstandingInformation as number) + 1;
    }
    if (disputedJobs.has(jobId)) entry.disputed = (entry.disputed as number) + 1;
    if (calculation) {
      entry.expectedValue =
        Math.round(((entry.expectedValue as number) + asNumber(calculation.total_incl_vat)) * 100) / 100;
    }

    byCounterparty.set(counterpartyId, entry);
  }

  const rows = [...byCounterparty.values()].sort(
    (a, b) => (b.expectedValue as number) - (a.expectedValue as number)
  );

  return {
    ok: true,
    data: report(
      "counterparty_summary",
      [
        { key: "counterparty", label: "Counterparty" },
        { key: "vatNumber", label: "VAT number" },
        { key: "jobs", label: "Jobs", numeric: true },
        { key: "ready", label: "Ready", numeric: true },
        { key: "blocked", label: "Blocked", numeric: true },
        { key: "disputed", label: "Disputed", numeric: true },
        { key: "expectedValue", label: "Expected value", numeric: true },
        { key: "outstandingInformation", label: "Outstanding", numeric: true },
      ],
      rows,
      {
        counterparties: rows.length,
        expectedValue:
          Math.round(rows.reduce((t, r) => t + (r.expectedValue as number), 0) * 100) / 100,
      },
      at
    ),
  };
}

// ---------------------------------------------------------------------------
// 10. Road & Recovery Profitability
// ---------------------------------------------------------------------------

/**
 * Operations intelligence from the margin view.
 *
 * Cost comes from the EXISTING field cost intelligence. Where no cost data exists the
 * margin reads as unknown rather than as pure profit — no cost is ever invented.
 */
export async function profitabilityReport(
  supabase: SupabaseClient,
  filters: ReportFilters,
  at = new Date().toISOString()
): Promise<RrServiceResult<BillingReport>> {
  let query = supabase
    .from("rr_job_margin")
    .select(
      "service_job_id,field_job_id,service_code,workflow_key,counterparty_id,calculation_status,expected_revenue_ex_vat,expected_revenue_incl_vat,currency,direct_cost,labour_cost,travel_cost,gross_margin,margin_pct,has_cost_data,billable_distance_km,billable_standing_hours,billable_storage_days,calculated_at"
    )
    .eq("company_id", filters.companyId)
    .limit(Math.min(filters.limit ?? 500, 2000));

  if (filters.counterpartyId) query = query.eq("counterparty_id", filters.counterpartyId);
  if (filters.serviceCode) query = query.eq("service_code", filters.serviceCode);

  const { data, error } = await query;
  if (error) return fail("Could not load Road & Recovery profitability.", 500);

  const spine = await loadBillingSpine(supabase, filters);

  const rows = ((data || []) as Row[])
    .filter((row) => asNumber(row.expected_revenue_ex_vat) > 0)
    .map((row) => {
      const counterparty = spine.counterparties.get(asText(row.counterparty_id));
      // sql/081 states this outright. Inferring it from direct_cost > 0 also treated a
      // genuine zero-cost job as having no cost data at all.
      const hasCost = row.has_cost_data === true;
      const km = asNumberOrNull(row.billable_distance_km);
      const revenue = asNumber(row.expected_revenue_ex_vat);

      return {
        jobRef: asText(spine.fieldJobs.get(asText(row.field_job_id))?.job_ref) || null,
        serviceJobId: asText(row.service_job_id),
        service: asText(row.service_code) || null,
        counterparty: counterparty ? asText(counterparty.legal_name) : "Direct",
        expectedRevenue: revenue,
        directCost: hasCost ? asNumber(row.direct_cost) : null,
        grossMargin: hasCost ? asNumber(row.gross_margin) : null,
        marginPct: hasCost ? asNumberOrNull(row.margin_pct) : null,
        distanceKm: km,
        revenuePerKm: km && km > 0 ? Math.round((revenue / km) * 100) / 100 : null,
        standingHours: asNumberOrNull(row.billable_standing_hours),
        storageDays: asNumberOrNull(row.billable_storage_days),
        currency: asText(row.currency) || "ZAR",
      };
    });

  const withCost = rows.filter((row) => row.directCost !== null);

  return {
    ok: true,
    data: report(
      "profitability",
      [
        { key: "jobRef", label: "Job" },
        { key: "service", label: "Service" },
        { key: "counterparty", label: "Counterparty" },
        { key: "expectedRevenue", label: "Expected revenue", numeric: true },
        { key: "directCost", label: "Direct cost", numeric: true },
        { key: "grossMargin", label: "Gross margin", numeric: true },
        { key: "marginPct", label: "Margin %", numeric: true },
        { key: "distanceKm", label: "Km", numeric: true },
        { key: "revenuePerKm", label: "Revenue / km", numeric: true },
      ],
      rows,
      {
        jobs: rows.length,
        jobsWithCostData: withCost.length,
        expectedRevenue: Math.round(rows.reduce((t, r) => t + r.expectedRevenue, 0) * 100) / 100,
        directCost: Math.round(withCost.reduce((t, r) => t + (r.directCost ?? 0), 0) * 100) / 100,
        grossMargin: Math.round(withCost.reduce((t, r) => t + (r.grossMargin ?? 0), 0) * 100) / 100,
        note:
          withCost.length < rows.length
            ? `${rows.length - withCost.length} job(s) have no operational cost data, so their margin is unknown rather than zero.`
            : "Cost data is present for every job shown.",
      },
      at
    ),
  };
}

// ---------------------------------------------------------------------------
// 11. Outstanding Billing Information
// ---------------------------------------------------------------------------

export async function outstandingInformationReport(
  supabase: SupabaseClient,
  filters: ReportFilters,
  at = new Date().toISOString()
): Promise<RrServiceResult<BillingReport>> {
  const readiness = await billingReadinessReport(supabase, filters, at);
  if (!readiness.ok) return readiness;

  const blocked = readiness.data.rows.filter((row) => row.readiness === "BLOCKED");

  // Grouped by the FIRST blocking reason, which is what a controller acts on first.
  const grouped = new Map<string, Record<string, unknown>[]>();
  for (const row of blocked) {
    const reasons = (row.blockingReasons as string[]) ?? [];
    const key = reasons[0] ?? "Unknown";
    const bucket = grouped.get(key) ?? [];
    bucket.push(row);
    grouped.set(key, bucket);
  }

  const rows = [...grouped.entries()]
    .map(([reason, jobs]) => ({
      blockingReason: reason,
      jobs: jobs.length,
      jobRefs: jobs.map((job) => job.jobRef).filter(Boolean).join(", "),
      expectedValueAtRisk:
        Math.round(
          jobs.reduce((total, job) => total + ((job.expectedTotal as number | null) ?? 0), 0) * 100
        ) / 100,
    }))
    .sort((a, b) => b.jobs - a.jobs);

  return {
    ok: true,
    data: report(
      "outstanding_information",
      [
        { key: "blockingReason", label: "Blocking reason" },
        { key: "jobs", label: "Jobs", numeric: true },
        { key: "expectedValueAtRisk", label: "Value at risk", numeric: true },
        { key: "jobRefs", label: "Jobs affected" },
      ],
      rows,
      {
        blockedJobs: blocked.length,
        distinctReasons: rows.length,
        valueAtRisk:
          Math.round(rows.reduce((t, r) => t + r.expectedValueAtRisk, 0) * 100) / 100,
      },
      at
    ),
  };
}

// ---------------------------------------------------------------------------
// 12. Billing Exceptions
// ---------------------------------------------------------------------------

export async function billingExceptionsReport(
  supabase: SupabaseClient,
  filters: ReportFilters,
  at = new Date().toISOString()
): Promise<RrServiceResult<BillingReport>> {
  const spine = await loadBillingSpine(supabase, filters);
  if (spine.error) return fail(spine.error, 500);

  const actionIds = spine.exceptions
    .map((row) => asText(row.automation_action_id))
    .filter(Boolean);

  // Approval status comes from the EXISTING Action Intelligence pipeline.
  const actions =
    actionIds.length > 0
      ? new Map(
          (
            ((
              await supabase
                .from("workforce_automation_actions")
                .select("id,status,action_type")
                .eq("company_id", filters.companyId)
                .in("id", actionIds)
            ).data || []) as Row[]
          ).map((row) => [asText(row.id), row])
        )
      : new Map<string, Row>();

  const SEVERITY_ORDER: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };

  const rows = spine.exceptions
    .map((exception) => {
      const jobId = asText(exception.service_job_id);
      const job = spine.jobs.find((entry) => asText(entry.id) === jobId);
      const action = actions.get(asText(exception.automation_action_id));

      return {
        jobRef: job ? asText(spine.fieldJobs.get(asText(job.field_job_id))?.job_ref) || null : null,
        serviceJobId: jobId,
        exceptionCode: asText(exception.exception_code),
        severity: asText(exception.severity),
        detail: asText(exception.detail) || null,
        detectedBy: asText(exception.detected_by),
        detectedAt: asText(exception.detected_at),
        status: asText(exception.resolution_status),
        resolvedBy: asText(exception.resolved_by) || null,
        resolvedAt: asText(exception.resolved_at) || null,
        actionStatus: action ? asText(action.status) : null,
        actionId: asText(exception.automation_action_id) || null,
      };
    })
    .sort((a, b) => {
      const bySeverity = (SEVERITY_ORDER[a.severity] ?? 9) - (SEVERITY_ORDER[b.severity] ?? 9);
      if (bySeverity !== 0) return bySeverity;
      return new Date(b.detectedAt).getTime() - new Date(a.detectedAt).getTime();
    });

  const open = rows.filter((row) => ["open", "acknowledged"].includes(row.status));

  return {
    ok: true,
    data: report(
      "billing_exceptions",
      [
        { key: "jobRef", label: "Job" },
        { key: "exceptionCode", label: "Exception" },
        { key: "severity", label: "Severity" },
        { key: "detail", label: "Detail" },
        { key: "detectedBy", label: "Detected by" },
        { key: "detectedAt", label: "Detected" },
        { key: "status", label: "Status" },
        { key: "actionStatus", label: "Approval" },
      ],
      rows,
      {
        exceptions: rows.length,
        open: open.length,
        critical: open.filter((row) => row.severity === "critical").length,
        escalated: rows.filter((row) => row.actionId !== null).length,
        note: "Escalations use the existing Action Intelligence pipeline; Road & Recovery adds no second action system.",
      },
      at
    ),
  };
}

// ---------------------------------------------------------------------------
// Dispatch and export
// ---------------------------------------------------------------------------

const REPORTS: Record<
  RrBillingReportKey,
  (supabase: SupabaseClient, filters: ReportFilters, at?: string) => Promise<RrServiceResult<BillingReport>>
> = {
  billing_readiness: billingReadinessReport,
  awaiting_finance: awaitingFinanceReport,
  invoice_information: invoiceInformationReport,
  bystand_billing: bystandBillingReport,
  storage_billing: storageBillingReport,
  tow_distance: towDistanceReport,
  disputed_distance: disputedDistanceReport,
  authorisation_vs_actual: authorisationVsActualReport,
  counterparty_summary: counterpartySummaryReport,
  profitability: profitabilityReport,
  outstanding_information: outstandingInformationReport,
  billing_exceptions: billingExceptionsReport,
};

export async function runBillingReport(
  supabase: SupabaseClient,
  key: RrBillingReportKey,
  filters: ReportFilters,
  at = new Date().toISOString()
): Promise<RrServiceResult<BillingReport>> {
  const runner = REPORTS[key];
  if (!runner) return fail(`"${key}" is not a recognised Road & Recovery billing report.`, 400);
  return runner(supabase, filters, at);
}

function csvCell(value: unknown): string {
  const text =
    value === null || value === undefined
      ? ""
      : Array.isArray(value)
        ? value.join("; ")
        : String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** A report as CSV, opening cleanly in Excel. */
export function billingReportToCsv(reportData: BillingReport): string {
  const lines: string[] = [
    csvCell(`UMORA — ${reportData.label}`),
    csvCell(reportData.disclaimer),
    csvCell(`Generated ${reportData.generatedAt}`),
    "",
    reportData.columns.map((column) => csvCell(column.label)).join(","),
  ];

  for (const row of reportData.rows) {
    lines.push(reportData.columns.map((column) => csvCell(row[column.key])).join(","));
  }

  lines.push("");
  for (const [key, value] of Object.entries(reportData.summary)) {
    lines.push([csvCell(key), csvCell(value)].join(","));
  }

  return lines.join("\n");
}

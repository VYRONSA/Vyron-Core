/**
 * VYRON CORE — Road & Recovery Invoice Information Pack (Phase 5).
 *
 * ---------------------------------------------------------------------------
 * THIS IS NOT AN INVOICE
 * ---------------------------------------------------------------------------
 *
 * It is a sealed, versioned INFORMATION DATASET containing everything a human invoice
 * administrator — or, later, VYRON FINANCE — needs in order to create an invoice.
 *
 * VYRON CORE never assigns an invoice number, never records a payment, never issues a
 * credit note, and never posts to a ledger. The pack deliberately carries no invoice
 * number and no document status for exactly that reason.
 *
 * ---------------------------------------------------------------------------
 * THE EXPORT CONTRACT
 * ---------------------------------------------------------------------------
 *
 * RR_BILLING_PACK_CONTRACT_VERSION is the seam to VYRON FINANCE. It is a promise about
 * SHAPE: a consumer written against version 1 keeps working while this file grows, and
 * the version changes only when the shape does. That is what lets the integration be
 * built later without redesigning the Road & Recovery commercial engine.
 *
 * When a customer licenses only VYRON CORE they receive the pack as a report or an
 * export, and no invoice exists anywhere. When they also license VYRON FINANCE, the same
 * pack becomes the transfer payload. Neither case changes what CORE computes.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { RrServiceResult } from "@/lib/road-recovery/job-service";
import { evaluateBillingReadiness, type BillingReadiness } from "@/lib/road-recovery/billing-service";

export const RR_BILLING_PACK_CONTRACT_VERSION = "rr-billing-pack-1.0.0";

type Row = Record<string, unknown>;

function asText(value: unknown): string {
  return String(value ?? "").trim();
}

function asNumber(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function fail(message: string, status = 400): { ok: false; status: number; message: string } {
  return { ok: false, status, message };
}

// ---------------------------------------------------------------------------
// The contract
// ---------------------------------------------------------------------------

export type BillingPackBillTo = {
  /** 'counterparty' when an insurer or assistance company pays; 'customer' for a motorist. */
  kind: "counterparty" | "customer" | "unknown";
  name: string | null;
  tradingName: string | null;
  branch: string | null;
  registrationNumber: string | null;
  vatNumber: string | null;
  contact: string | null;
  counterpartyId: string | null;
};

export type BillingPackAuthorisation = {
  authorisationNumber: string | null;
  claimReference: string | null;
  poNumber: string | null;
  authorisedAmount: number | null;
  currency: string | null;
  authorisedBy: string | null;
  authorisedAt: string | null;
  expiresAt: string | null;
  status: string | null;
  /** Expected total minus authorised amount, when both are known. */
  varianceToAuthorised: number | null;
};

export type BillingPackVehicle = {
  registration: string | null;
  make: string | null;
  model: string | null;
  vin: string | null;
  engineNumber: string | null;
  colour: string | null;
};

export type BillingPackFact = {
  factCode: string;
  quantity: number;
  unit: string;
  source: string;
  sourceRef: string | null;
  calculationVersion: string | null;
  status: string;
  occurredAt: string;
  recordedBy: string;
  evidenceId: string | null;
  sourceDetail: Record<string, unknown>;
};

export type BillingPackChargeLine = {
  chargeCode: string;
  label: string;
  ruleId: string;
  basis: string;
  unit: string;
  quantity: number;
  chargeableQuantity: number;
  rateAmount: number;
  subtotalExVat: number;
  minimumApplied: boolean;
  vatTreatment: string;
  vatRate: number;
  vatAmount: number;
  totalInclVat: number;
  reason: string;
  factCode: string | null;
};

export type BillingPack = {
  contractVersion: string;
  generatedAt: string;
  generatedBy: string;

  job: {
    serviceJobId: string;
    fieldJobId: string;
    jobRef: string | null;
    serviceCode: string;
    workflowKey: string;
    serviceState: string;
    title: string | null;
    incidentAt: string | null;
    createdAt: string;
    completedAt: string | null;
    originLabel: string | null;
    destinationLabel: string | null;
  };

  billTo: BillingPackBillTo;
  authorisation: BillingPackAuthorisation;
  vehicle: BillingPackVehicle;

  crew: { employeeId: string | null; employeeName: string | null; vehicleRegistration: string | null }[];

  rateCard: {
    policyKey: string | null;
    version: number | null;
    resolvedAt: string | null;
    resolutionReason: string | null;
    currency: string;
    vatRate: number;
  };

  facts: BillingPackFact[];

  charges: {
    calculationId: string | null;
    status: string | null;
    lines: BillingPackChargeLine[];
    subtotalExVat: number;
    vatAmount: number;
    totalInclVat: number;
    currency: string;
    /** VAT-RELEVANT information only. The definitive treatment belongs to VYRON FINANCE. */
    vatRate: number;
    engineVersion: string | null;
    calculatedAt: string | null;
    afterHours: boolean;
    publicHoliday: boolean;
  };

  evidence: { evidenceId: string; requirementCode: string; verificationStatus: string }[];

  exceptions: {
    exceptionCode: string;
    severity: string;
    detail: string | null;
    resolutionStatus: string;
  }[];

  disputes: {
    disputeType: string;
    originalQuantity: number | null;
    disputedQuantity: number | null;
    reviewedQuantity: number | null;
    status: string;
    decision: string | null;
    reason: string;
    raisedBy: string;
    reviewedBy: string | null;
  }[];

  readiness: BillingReadiness;

  approval: {
    /** From the EXISTING workforce_automation_actions pipeline. */
    status: string | null;
    actionId: string | null;
    decidedBy: string | null;
    decidedAt: string | null;
  };

  margin: {
    expectedRevenueExVat: number | null;
    directCost: number | null;
    grossMargin: number | null;
    marginPct: number | null;
    /** False when no cost was captured. Margin above is then null, not zero. */
    hasCostData: boolean;
    billableDistanceKm: number | null;
    billableStandingHours: number | null;
    billableStorageDays: number | null;
  } | null;

  /** Stated explicitly so no consumer can mistake this for an accounting document. */
  disclaimer: string;
};

const DISCLAIMER =
  "This is Road & Recovery billing INFORMATION produced by UMORA. It is not a tax invoice and creates no accounting entry. Expected charges and VAT-relevant amounts are calculated for operational review; the definitive tax treatment, the invoice itself, debtors and payments belong to VYRON FINANCE.";

// ---------------------------------------------------------------------------
// Assembly
// ---------------------------------------------------------------------------

/**
 * Builds the pack for one job.
 *
 * Assembled entirely from records that ALREADY exist across Phases 0-5 — counterparty,
 * authorisation, vehicle, evidence links, sealed standby and storage, frozen rate card,
 * sealed charges. No new customer registry was needed, which is why dropping the
 * invoicing core cost nothing.
 */
export async function buildBillingPack(
  supabase: SupabaseClient,
  input: { companyId: string; actorEmail: string; serviceJobId: string; at?: string }
): Promise<RrServiceResult<BillingPack>> {
  const at = input.at ?? new Date().toISOString();
  const { companyId, serviceJobId } = input;

  const { data: jobRow, error: jobError } = await supabase
    .from("rr_service_jobs")
    .select(
      "id,field_job_id,service_type_id,workflow_key,service_state,counterparty_id,incident_at,created_at,origin_label,destination_label,vehicle_registration,vehicle_make,vehicle_model,vehicle_vin,vehicle_engine_number,vehicle_colour,customer_name,customer_contact"
    )
    .eq("company_id", companyId)
    .eq("id", serviceJobId)
    .maybeSingle();

  if (jobError) return fail(jobError.message, 500);
  if (!jobRow) return fail("Service job not found in this company.", 404);
  const job = jobRow as Row;

  const [
    typeRes,
    fieldJobRes,
    counterpartyRes,
    authRes,
    snapshotRes,
    factsRes,
    calcRes,
    evidenceRes,
    exceptionsRes,
    disputesRes,
    assignmentsRes,
    marginRes,
  ] = await Promise.all([
    supabase.from("rr_service_types").select("service_code").eq("company_id", companyId).eq("id", asText(job.service_type_id)).maybeSingle(),
    supabase.from("field_jobs").select("job_ref,title").eq("company_id", companyId).eq("id", asText(job.field_job_id)).maybeSingle(),
    job.counterparty_id
      ? supabase.from("rr_counterparties").select("id,legal_name,trading_name,branch_label,registration_number,vat_number").eq("company_id", companyId).eq("id", asText(job.counterparty_id)).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    supabase.from("rr_authorisations").select("authorisation_number,claim_reference,po_number,authorised_amount,currency,authorised_by_name,authorised_at,expires_at,status").eq("company_id", companyId).eq("service_job_id", serviceJobId).eq("status", "active").order("authorised_at", { ascending: false }).limit(1),
    supabase.from("rr_job_rate_snapshot").select("policy_key,policy_version,resolved_at,resolution_reason,currency,vat_rate").eq("company_id", companyId).eq("service_job_id", serviceJobId).maybeSingle(),
    supabase.from("rr_billable_facts").select("fact_code,quantity,unit,source,source_ref,calculation_version,status,occurred_at,recorded_by,evidence_id,source_detail").eq("company_id", companyId).eq("service_job_id", serviceJobId),
    supabase.from("rr_charge_calculations").select("id,status,subtotal_ex_vat,vat_amount,total_incl_vat,currency,vat_rate,engine_version,calculated_at,after_hours,public_holiday").eq("company_id", companyId).eq("service_job_id", serviceJobId).order("calculated_at", { ascending: false }).limit(1),
    supabase.from("rr_evidence_links").select("evidence_id,requirement_code,verification_status").eq("company_id", companyId).eq("service_job_id", serviceJobId),
    supabase.from("rr_billing_exceptions").select("exception_code,severity,detail,resolution_status").eq("company_id", companyId).eq("service_job_id", serviceJobId),
    supabase.from("rr_billing_disputes").select("dispute_type,original_quantity,disputed_quantity,reviewed_quantity,status,decision,reason,raised_by,reviewed_by").eq("company_id", companyId).eq("service_job_id", serviceJobId),
    supabase.from("field_job_assignments").select("employee_id,role,status").eq("company_id", companyId).eq("job_id", asText(job.field_job_id)),
    supabase.from("rr_job_margin").select("expected_revenue_ex_vat,direct_cost,gross_margin,margin_pct,has_cost_data,billable_distance_km,billable_standing_hours,billable_storage_days").eq("company_id", companyId).eq("service_job_id", serviceJobId).maybeSingle(),
  ]);

  const readiness = await evaluateBillingReadiness(supabase, { companyId, serviceJobId, at });
  if (!readiness.ok) return readiness;

  const counterparty = (counterpartyRes.data as Row | null) ?? null;
  const auth = ((authRes.data || []) as Row[])[0] ?? null;
  const snapshot = (snapshotRes.data as Row | null) ?? null;
  const calculation = ((calcRes.data || []) as Row[])[0] ?? null;
  const fieldJob = (fieldJobRes.data as Row | null) ?? null;
  const margin = (marginRes.data as Row | null) ?? null;

  // Charge lines belong to the LATEST sealed calculation only.
  let lines: BillingPackChargeLine[] = [];
  if (calculation) {
    const { data: lineRows } = await supabase
      .from("rr_charge_lines")
      .select("charge_code,label,rule_id,basis,unit,quantity,chargeable_quantity,rate_amount,subtotal_ex_vat,minimum_applied,vat_treatment,vat_rate,vat_amount,total_incl_vat,reason,fact_code,sort_order")
      .eq("company_id", companyId)
      .eq("calculation_id", asText(calculation.id))
      .order("sort_order", { ascending: true });

    lines = ((lineRows || []) as Row[]).map((row) => ({
      chargeCode: asText(row.charge_code),
      label: asText(row.label),
      ruleId: asText(row.rule_id),
      basis: asText(row.basis),
      unit: asText(row.unit),
      quantity: asNumber(row.quantity),
      chargeableQuantity: asNumber(row.chargeable_quantity),
      rateAmount: asNumber(row.rate_amount),
      subtotalExVat: asNumber(row.subtotal_ex_vat),
      minimumApplied: row.minimum_applied === true,
      vatTreatment: asText(row.vat_treatment),
      vatRate: asNumber(row.vat_rate),
      vatAmount: asNumber(row.vat_amount),
      totalInclVat: asNumber(row.total_incl_vat),
      reason: asText(row.reason),
      factCode: asText(row.fact_code) || null,
    }));
  }

  const expectedTotal = calculation ? asNumber(calculation.total_incl_vat) : null;
  const authorisedAmount = auth ? (auth.authorised_amount === null ? null : asNumber(auth.authorised_amount)) : null;

  const billTo: BillingPackBillTo = counterparty
    ? {
        kind: "counterparty",
        name: asText(counterparty.legal_name) || null,
        tradingName: asText(counterparty.trading_name) || null,
        branch: asText(counterparty.branch_label) || null,
        registrationNumber: asText(counterparty.registration_number) || null,
        vatNumber: asText(counterparty.vat_number) || null,
        contact: null,
        counterpartyId: asText(counterparty.id),
      }
    : asText(job.customer_name)
      ? {
          kind: "customer",
          name: asText(job.customer_name),
          tradingName: null,
          branch: null,
          registrationNumber: null,
          vatNumber: null,
          contact: asText(job.customer_contact) || null,
          counterpartyId: null,
        }
      : {
          kind: "unknown",
          name: null,
          tradingName: null,
          branch: null,
          registrationNumber: null,
          vatNumber: null,
          contact: null,
          counterpartyId: null,
        };

  // Approval status comes from the EXISTING pipeline, not a Phase 5 table.
  const { data: actionRows } = await supabase
    .from("workforce_automation_actions")
    .select("id,status,payload_json")
    .eq("company_id", companyId)
    .eq("source_module", "Road & Recovery Billing")
    .order("created_at", { ascending: false })
    .limit(20);

  const action = ((actionRows || []) as Row[]).find((row) => {
    const payload = row.payload_json as Record<string, unknown> | null;
    return payload && asText(payload.service_job_id) === serviceJobId;
  });

  return {
    ok: true,
    data: {
      contractVersion: RR_BILLING_PACK_CONTRACT_VERSION,
      generatedAt: at,
      generatedBy: input.actorEmail,

      job: {
        serviceJobId: asText(job.id),
        fieldJobId: asText(job.field_job_id),
        jobRef: fieldJob ? asText(fieldJob.job_ref) || null : null,
        serviceCode: asText((typeRes.data as Row | null)?.service_code),
        workflowKey: asText(job.workflow_key),
        serviceState: asText(job.service_state),
        title: fieldJob ? asText(fieldJob.title) || null : null,
        incidentAt: job.incident_at ? asText(job.incident_at) : null,
        createdAt: asText(job.created_at),
        completedAt: null,
        originLabel: asText(job.origin_label) || null,
        destinationLabel: asText(job.destination_label) || null,
      },

      billTo,

      authorisation: {
        authorisationNumber: auth ? asText(auth.authorisation_number) || null : null,
        claimReference: auth ? asText(auth.claim_reference) || null : null,
        poNumber: auth ? asText(auth.po_number) || null : null,
        authorisedAmount,
        currency: auth ? asText(auth.currency) || null : null,
        authorisedBy: auth ? asText(auth.authorised_by_name) || null : null,
        authorisedAt: auth ? asText(auth.authorised_at) || null : null,
        expiresAt: auth && auth.expires_at ? asText(auth.expires_at) : null,
        status: auth ? asText(auth.status) : null,
        varianceToAuthorised:
          authorisedAmount !== null && expectedTotal !== null
            ? Math.round((expectedTotal - authorisedAmount) * 100) / 100
            : null,
      },

      vehicle: {
        registration: asText(job.vehicle_registration) || null,
        make: asText(job.vehicle_make) || null,
        model: asText(job.vehicle_model) || null,
        vin: asText(job.vehicle_vin) || null,
        engineNumber: asText(job.vehicle_engine_number) || null,
        colour: asText(job.vehicle_colour) || null,
      },

      crew: ((assignmentsRes.data || []) as Row[]).map((row) => ({
        employeeId: asText(row.employee_id) || null,
        employeeName: null,
        vehicleRegistration: null,
      })),

      rateCard: {
        policyKey: snapshot ? asText(snapshot.policy_key) : null,
        version: snapshot ? asNumber(snapshot.policy_version) : null,
        resolvedAt: snapshot ? asText(snapshot.resolved_at) : null,
        resolutionReason: snapshot ? asText(snapshot.resolution_reason) || null : null,
        currency: snapshot ? asText(snapshot.currency) || "ZAR" : "ZAR",
        vatRate: snapshot ? asNumber(snapshot.vat_rate) : 0,
      },

      facts: ((factsRes.data || []) as Row[]).map((row) => ({
        factCode: asText(row.fact_code),
        quantity: asNumber(row.quantity),
        unit: asText(row.unit),
        source: asText(row.source),
        sourceRef: asText(row.source_ref) || null,
        calculationVersion: asText(row.calculation_version) || null,
        status: asText(row.status),
        occurredAt: asText(row.occurred_at),
        recordedBy: asText(row.recorded_by),
        evidenceId: asText(row.evidence_id) || null,
        sourceDetail: (row.source_detail ?? {}) as Record<string, unknown>,
      })),

      charges: {
        calculationId: calculation ? asText(calculation.id) : null,
        status: calculation ? asText(calculation.status) : null,
        lines,
        subtotalExVat: calculation ? asNumber(calculation.subtotal_ex_vat) : 0,
        vatAmount: calculation ? asNumber(calculation.vat_amount) : 0,
        totalInclVat: calculation ? asNumber(calculation.total_incl_vat) : 0,
        currency: calculation ? asText(calculation.currency) || "ZAR" : "ZAR",
        vatRate: calculation ? asNumber(calculation.vat_rate) : 0,
        engineVersion: calculation ? asText(calculation.engine_version) : null,
        calculatedAt: calculation ? asText(calculation.calculated_at) : null,
        afterHours: calculation ? calculation.after_hours === true : false,
        publicHoliday: calculation ? calculation.public_holiday === true : false,
      },

      evidence: ((evidenceRes.data || []) as Row[]).map((row) => ({
        evidenceId: asText(row.evidence_id),
        requirementCode: asText(row.requirement_code),
        verificationStatus: asText(row.verification_status),
      })),

      exceptions: ((exceptionsRes.data || []) as Row[]).map((row) => ({
        exceptionCode: asText(row.exception_code),
        severity: asText(row.severity),
        detail: asText(row.detail) || null,
        resolutionStatus: asText(row.resolution_status),
      })),

      disputes: ((disputesRes.data || []) as Row[]).map((row) => ({
        disputeType: asText(row.dispute_type),
        originalQuantity: row.original_quantity === null ? null : asNumber(row.original_quantity),
        disputedQuantity: row.disputed_quantity === null ? null : asNumber(row.disputed_quantity),
        reviewedQuantity: row.reviewed_quantity === null ? null : asNumber(row.reviewed_quantity),
        status: asText(row.status),
        decision: asText(row.decision) || null,
        reason: asText(row.reason),
        raisedBy: asText(row.raised_by),
        reviewedBy: asText(row.reviewed_by) || null,
      })),

      readiness: readiness.data,

      approval: {
        status: action ? asText(action.status) : null,
        actionId: action ? asText(action.id) : null,
        decidedBy: null,
        decidedAt: null,
      },

      margin: margin
        ? {
            expectedRevenueExVat: asNumber(margin.expected_revenue_ex_vat),
            // Cost and margin are NULL when nothing was captured (sql/081). Coercing them
            // to zero here would hand VYRON FINANCE a fabricated 100% margin on a job
            // whose cost simply was not recorded.
            directCost: margin.direct_cost === null ? null : asNumber(margin.direct_cost),
            grossMargin: margin.gross_margin === null ? null : asNumber(margin.gross_margin),
            marginPct: margin.margin_pct === null ? null : asNumber(margin.margin_pct),
            hasCostData: margin.has_cost_data === true,
            billableDistanceKm: margin.billable_distance_km === null ? null : asNumber(margin.billable_distance_km),
            billableStandingHours: margin.billable_standing_hours === null ? null : asNumber(margin.billable_standing_hours),
            billableStorageDays: margin.billable_storage_days === null ? null : asNumber(margin.billable_storage_days),
          }
        : null,

      disclaimer: DISCLAIMER,
    },
  };
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

function csvCell(value: unknown): string {
  const text = value === null || value === undefined ? "" : String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/**
 * The pack as CSV, for a human invoice administrator or a spreadsheet.
 *
 * A header block of key/value rows followed by the charge lines — the shape an
 * administrator can paste straight into whatever they invoice from today.
 */
export function billingPackToCsv(pack: BillingPack): string {
  const rows: string[][] = [
    ["UMORA — Road & Recovery Invoice Information Pack"],
    ["NOT A TAX INVOICE", pack.disclaimer],
    ["Contract version", pack.contractVersion],
    ["Generated at", pack.generatedAt],
    ["Generated by", pack.generatedBy],
    [],
    ["Job reference", pack.job.jobRef ?? ""],
    ["Service", pack.job.serviceCode],
    ["State", pack.job.serviceState],
    ["Origin", pack.job.originLabel ?? ""],
    ["Destination", pack.job.destinationLabel ?? ""],
    [],
    ["Bill to", pack.billTo.name ?? ""],
    ["Bill-to type", pack.billTo.kind],
    ["VAT number", pack.billTo.vatNumber ?? ""],
    ["Registration number", pack.billTo.registrationNumber ?? ""],
    [],
    ["Authorisation", pack.authorisation.authorisationNumber ?? ""],
    ["Claim reference", pack.authorisation.claimReference ?? ""],
    ["PO number", pack.authorisation.poNumber ?? ""],
    ["Authorised amount", pack.authorisation.authorisedAmount?.toFixed(2) ?? ""],
    ["Variance to authorised", pack.authorisation.varianceToAuthorised?.toFixed(2) ?? ""],
    [],
    ["Vehicle", pack.vehicle.registration ?? ""],
    ["Make / model", [pack.vehicle.make, pack.vehicle.model].filter(Boolean).join(" ")],
    ["VIN", pack.vehicle.vin ?? ""],
    ["Engine number", pack.vehicle.engineNumber ?? ""],
    [],
    ["Rate card", `${pack.rateCard.policyKey ?? ""} v${pack.rateCard.version ?? ""}`],
    ["Charge engine", pack.charges.engineVersion ?? ""],
    ["Billing readiness", pack.readiness.ready ? "READY" : "BLOCKED"],
    [],
    ["Charge code", "Description", "Quantity", "Unit", "Rate", "Subtotal excl VAT", "VAT", "Total incl VAT", "Reason"],
  ];

  for (const line of pack.charges.lines) {
    rows.push([
      line.chargeCode,
      line.label,
      String(line.chargeableQuantity),
      line.unit,
      line.rateAmount.toFixed(2),
      line.subtotalExVat.toFixed(2),
      line.vatAmount.toFixed(2),
      line.totalInclVat.toFixed(2),
      line.reason,
    ]);
  }

  rows.push([]);
  rows.push(["", "", "", "", "Subtotal excl VAT", pack.charges.subtotalExVat.toFixed(2)]);
  rows.push(["", "", "", "", "VAT", pack.charges.vatAmount.toFixed(2)]);
  rows.push(["", "", "", "", "Expected total incl VAT", pack.charges.totalInclVat.toFixed(2)]);

  if (!pack.readiness.ready) {
    rows.push([]);
    rows.push(["BLOCKED — this job is not ready to be invoiced"]);
    for (const reason of pack.readiness.blockingReasons) rows.push(["", reason]);
  }

  return rows.map((row) => row.map(csvCell).join(",")).join("\n");
}

/**
 * The pack as the JSON transfer payload.
 *
 * Identical in shape to the on-screen pack, by design: what a human reads and what VYRON
 * FINANCE would later consume must never diverge.
 */
export function billingPackToJson(pack: BillingPack): string {
  return JSON.stringify(pack, null, 2);
}

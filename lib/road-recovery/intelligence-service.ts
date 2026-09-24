/**
 * VYRON CORE — Road & Recovery intelligence service (Phase 6).
 *
 * The I/O layer. Every calculation lives in lib/road-recovery/intelligence/*, which is
 * pure; this file loads facts, hands them to those engines, and returns the result.
 *
 * PERFORMANCE. Nothing here loads unbounded history. Every query is tenant-scoped, bounded
 * by an explicit date window and capped by a row limit, and when a cap is reached the
 * result SAYS SO. Intelligence that silently truncates is worse than no intelligence: a
 * dashboard reporting "3 open exceptions" when it stopped counting at the cap tells a
 * manager the operation is fine when it is not.
 *
 * TENANT SAFETY. companyId is always applied as a filter AND the query runs under the
 * caller's RLS context. The filter is not the security boundary — RLS is — but a forgotten
 * filter should never be the only thing standing between two customers.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { RrServiceResult } from "@/lib/road-recovery/job-service";
import { RR_METRIC_CATALOGUE } from "@/lib/road-recovery/intelligence/metric-catalogue";
import type { RrThreshold } from "@/lib/road-recovery/intelligence/thresholds";
import {
  RR_DOMAIN_LABELS,
  type RrDomainResult,
  type RrIntelligenceWindow,
  type RrMetricResult,
  type RrSeverity,
  type RrTruncationNotice,
} from "@/lib/road-recovery/intelligence/types";
import type { RrJobTimingFact } from "@/lib/road-recovery/intelligence/timing";
import type { RrAssignmentFact } from "@/lib/road-recovery/intelligence/dispatch";
import { isBystandWorkflow } from "@/lib/road-recovery/intelligence/bystand";
import type { RrExceptionFact } from "@/lib/road-recovery/intelligence/exceptions";
import { buildDomains, type RrIntelligenceFacts } from "@/lib/road-recovery/intelligence/domains";
import { buildOperationalFindings } from "@/lib/road-recovery/intelligence/operational";

/**
 * The two operational facts the structural findings need, which the metric
 * pipeline does not already carry.
 *
 * Kept to two aggregate queries rather than one per job: a control room with
 * two hundred live jobs must not produce four hundred round trips to draw one
 * dashboard.
 */
async function loadOperationalExtras(
  supabase: SupabaseClient,
  companyId: string
): Promise<{
  outstandingEvidence: { serviceJobId: string; jobRef: string | null; serviceState: string; outstandingLabels: string[] }[];
  unverifiedArrivals: { serviceJobId: string; reason: string | null }[];
}> {
  const [requirementRows, linkRows, jobRows, arrivalRows] = await Promise.all([
    supabase
      .from("rr_evidence_requirements")
      .select("service_job_id,requirement_code,label,mandatory")
      .eq("company_id", companyId)
      .eq("mandatory", true),
    supabase
      .from("rr_evidence_links")
      .select("service_job_id,requirement_code")
      .eq("company_id", companyId),
    // job_ref lives on the field_jobs spine, not on the service job.
    supabase
      .from("rr_service_jobs")
      .select("id,service_state,field_jobs(job_ref)")
      .eq("company_id", companyId)
      .eq("record_status", "active"),
    supabase
      .from("rr_service_state_events")
      .select("service_job_id,reason,latitude,to_state")
      .eq("company_id", companyId)
      .in("to_state", ["on_scene", "arrived_on_scene"]),
  ]);

  const satisfied = new Map<string, Set<string>>();
  for (const row of (linkRows.data || []) as { service_job_id: string; requirement_code: string }[]) {
    const set = satisfied.get(String(row.service_job_id)) ?? new Set<string>();
    set.add(String(row.requirement_code));
    satisfied.set(String(row.service_job_id), set);
  }

  const jobMeta = new Map<string, { jobRef: string | null; serviceState: string }>();
  for (const row of (jobRows.data || []) as {
    id: string;
    service_state: string;
    field_jobs?: { job_ref?: string | null } | { job_ref?: string | null }[] | null;
  }[]) {
    const parent = Array.isArray(row.field_jobs) ? row.field_jobs[0] : row.field_jobs;
    jobMeta.set(String(row.id), {
      jobRef: parent?.job_ref ?? null,
      serviceState: String(row.service_state),
    });
  }

  const arrivals = (arrivalRows.data || []) as {
    service_job_id: string;
    reason: string | null;
    latitude: number | null;
  }[];

  /**
   * Only jobs somebody has actually driven to.
   *
   * Nagging that a job "is missing mandatory evidence" before anyone has
   * reached the scene is noise, and noise is how an action list gets ignored.
   * Evidence becomes outstanding once there is a scene to photograph.
   */
  const arrivedJobIds = new Set(arrivals.map((row) => String(row.service_job_id)));

  const outstandingByJob = new Map<string, string[]>();
  for (const row of (requirementRows.data || []) as {
    service_job_id: string;
    requirement_code: string;
    label: string | null;
  }[]) {
    const jobId = String(row.service_job_id);
    if (!arrivedJobIds.has(jobId)) continue;
    if ((satisfied.get(jobId) ?? new Set()).has(String(row.requirement_code))) continue;
    const list = outstandingByJob.get(jobId) ?? [];
    list.push(row.label || String(row.requirement_code));
    outstandingByJob.set(jobId, list);
  }

  const outstandingEvidence = [...outstandingByJob.entries()].map(([serviceJobId, outstandingLabels]) => ({
    serviceJobId,
    jobRef: jobMeta.get(serviceJobId)?.jobRef ?? null,
    serviceState: jobMeta.get(serviceJobId)?.serviceState ?? "unknown",
    outstandingLabels,
  }));

  // An arrival with no latitude is the stated-reason exception being used.
  const unverifiedArrivals = arrivals
    .filter((row) => row.latitude === null)
    .map((row) => ({ serviceJobId: String(row.service_job_id), reason: row.reason }));

  return { outstandingEvidence, unverifiedArrivals };
}
import { computeRoadRecoveryHealth, type RrHealthResult } from "@/lib/road-recovery/intelligence/health";
import {
  buildRecommendations,
  type RrRecommendation,
} from "@/lib/road-recovery/intelligence/recommendations";

/**
 * The default row cap for a single fact query.
 *
 * Chosen to comfortably cover a busy month for a large operator while keeping any single
 * response bounded. When it is hit the domain reports the truncation rather than quietly
 * analysing a slice.
 */
export const RR_INTELLIGENCE_ROW_LIMIT = 5000;

/** Default analysis window when the caller does not supply one. */
export const RR_INTELLIGENCE_DEFAULT_WINDOW_DAYS = 30;

/** How many rows any per-domain detail list returns. */
const DETAIL_LIMIT = 10;

const MS_PER_DAY = 86_400_000;

export type RrIntelligenceOptions = {
  companyId: string;
  fromIso?: string | null;
  toIso?: string | null;
  /** The instant thresholds and ageing are resolved against. Defaults to the window end. */
  asOfIso?: string | null;
  serviceCode?: string | null;
  counterpartyId?: string | null;
  rowLimit?: number | null;
};

export type RrIntelligenceResult = {
  companyId: string;
  window: RrIntelligenceWindow;
  filters: { serviceCode: string | null; counterpartyId: string | null };
  domains: RrDomainResult[];
  metrics: RrMetricResult[];
  health: RrHealthResult;
  recommendations: RrRecommendation[];
  /** How many operational targets the tenant has configured. Zero is a real answer. */
  thresholdsConfigured: number;
  truncations: RrTruncationNotice[];
  /** False when the module is not installed for this company. */
  provisioned: boolean;
  jobCount: number;
  bystandCount: number;
  generatedAtIso: string;
};

function text(value: unknown): string {
  return String(value ?? "").trim();
}

function num(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function numOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function isMissingRelation(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  if (error.code === "42P01") return true;
  return /does not exist|schema cache|Could not find the table/i.test(error.message ?? "");
}

type Row = Record<string, unknown>;

/**
 * Runs one bounded query and reports whether it hit the cap.
 *
 * A missing table is not an error: Road & Recovery has optional dependencies (Field Cost
 * Intelligence among them), and a customer without one should get intelligence with that
 * domain reported as unavailable, not a 500.
 */
async function boundedSelect(
  builder: PromiseLike<{ data: unknown; error: { code?: string; message?: string } | null }>,
  source: string,
  limit: number,
  truncations: RrTruncationNotice[]
): Promise<Row[]> {
  const { data, error } = await builder;
  if (error) {
    if (isMissingRelation(error)) return [];
    throw new Error(`${source}: ${error.message ?? "query failed"}`);
  }
  const rows = (data as Row[] | null) ?? [];
  if (rows.length >= limit) {
    truncations.push({
      source,
      limit,
      returned: rows.length,
      message: `${source} returned the maximum of ${limit} rows. Narrow the date window or filter by service code to see the complete picture — the figures below cover only the rows that were read.`,
    });
  }
  return rows;
}

function resolveWindow(options: RrIntelligenceOptions): RrIntelligenceWindow {
  const now = Date.now();
  const parsedTo = options.toIso ? Date.parse(options.toIso) : NaN;
  const to = Number.isFinite(parsedTo) ? parsedTo : now;

  const parsedFrom = options.fromIso ? Date.parse(options.fromIso) : NaN;
  const from = Number.isFinite(parsedFrom)
    ? parsedFrom
    : to - RR_INTELLIGENCE_DEFAULT_WINDOW_DAYS * MS_PER_DAY;

  const parsedAsOf = options.asOfIso ? Date.parse(options.asOfIso) : NaN;
  const asOf = Number.isFinite(parsedAsOf) ? parsedAsOf : to;

  return {
    fromIso: new Date(Math.min(from, to)).toISOString(),
    toIso: new Date(Math.max(from, to)).toISOString(),
    asOfIso: new Date(asOf).toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Thresholds
// ---------------------------------------------------------------------------

export async function loadThresholds(
  supabase: SupabaseClient,
  companyId: string
): Promise<RrThreshold[]> {
  const { data, error } = await supabase
    .from("rr_intelligence_thresholds")
    .select(
      "id,metric_key,service_code,counterparty_id,target_value,warning_value,critical_value,unit,severity,effective_from,effective_to,active,version,notes,created_by,retired_by,retired_at"
    )
    .eq("company_id", companyId)
    .limit(1000);

  if (error) {
    if (isMissingRelation(error)) return [];
    throw new Error(`rr_intelligence_thresholds: ${error.message}`);
  }

  return ((data as Row[] | null) ?? []).map((row) => ({
    id: text(row.id),
    metricKey: text(row.metric_key),
    serviceCode: row.service_code === null ? null : text(row.service_code) || null,
    counterpartyId: row.counterparty_id === null ? null : text(row.counterparty_id) || null,
    targetValue: num(row.target_value),
    warningValue: numOrNull(row.warning_value),
    criticalValue: numOrNull(row.critical_value),
    unit: text(row.unit),
    severity: (text(row.severity) || "medium") as RrThreshold["severity"],
    effectiveFrom: text(row.effective_from),
    effectiveTo: row.effective_to === null ? null : text(row.effective_to) || null,
    active: row.active === true,
    version: num(row.version) || 1,
    notes: row.notes === null ? null : text(row.notes) || null,
    createdBy: row.created_by === null ? null : text(row.created_by) || null,
    retiredBy: row.retired_by === null ? null : text(row.retired_by) || null,
    retiredAt: row.retired_at === null ? null : text(row.retired_at) || null,
  }));
}

export async function listThresholds(
  supabase: SupabaseClient,
  input: { companyId: string }
): Promise<RrServiceResult<{ thresholds: RrThreshold[]; catalogue: typeof RR_METRIC_CATALOGUE }>> {
  try {
    const thresholds = await loadThresholds(supabase, input.companyId);
    return { ok: true, data: { thresholds, catalogue: RR_METRIC_CATALOGUE } };
  } catch (error: unknown) {
    return { ok: false, status: 500, message: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * Publishes a new version of an operational target.
 *
 * Retire-then-insert, never edit. The partial unique index permits exactly one active
 * version per scope, so the retirement must land first; a trigger then refuses any change
 * to what the retired version actually said. The result is that a breach recorded last
 * March can always be replayed against March's target.
 */
export async function publishThreshold(
  supabase: SupabaseClient,
  input: {
    companyId: string;
    actorEmail: string;
    metricKey: string;
    serviceCode?: string | null;
    counterpartyId?: string | null;
    targetValue: number;
    warningValue?: number | null;
    criticalValue?: number | null;
    unit: string;
    severity?: RrSeverity;
    effectiveFromIso?: string | null;
    notes?: string | null;
  }
): Promise<RrServiceResult<{ thresholdId: string; version: number; retiredVersion: number | null }>> {
  const definition = RR_METRIC_CATALOGUE.find((entry) => entry.key === input.metricKey);
  if (!definition) {
    return {
      ok: false,
      status: 400,
      message: `"${input.metricKey}" is not a Road & Recovery metric. A target can only be set for a metric the system actually measures.`,
    };
  }

  const serviceCode = input.serviceCode ? text(input.serviceCode) : null;
  const counterpartyId = input.counterpartyId ? text(input.counterpartyId) : null;

  if (serviceCode && !definition.scopes.serviceCode) {
    return {
      ok: false,
      status: 400,
      message: `${definition.label} cannot be scoped to a service code.`,
    };
  }
  if (counterpartyId && !definition.scopes.counterparty) {
    return {
      ok: false,
      status: 400,
      message: `${definition.label} cannot be scoped to a counterparty.`,
    };
  }
  if (!Number.isFinite(input.targetValue)) {
    return { ok: false, status: 400, message: "A target value is required." };
  }

  const now = new Date().toISOString();
  const effectiveFrom = input.effectiveFromIso ? text(input.effectiveFromIso) : now;

  /**
   * EVERY version ever published for this metric, not only the live one.
   *
   * `uq_rr_thresholds_version` is unique on
   * (company_id, metric_key, service_code, counterparty_id, version) across the WHOLE
   * table — retired rows included, because retiring keeps them so a past breach can still
   * be replayed against the target that applied then.
   *
   * Numbering from the ACTIVE row alone therefore had a hole with real consequences: once
   * an administrator retired a target, there was no active row, the next publish computed
   * version 1 again, and it collided with the retired version 1. The metric could never be
   * given a target again — the failure looked like a database error and the only way back
   * was to delete the history the versioning exists to protect.
   *
   * The next version is max(version) + 1 over the scope, so numbering keeps climbing past
   * anything retired.
   */
  const history = await supabase
    .from("rr_intelligence_thresholds")
    .select("id,version,service_code,counterparty_id,active")
    .eq("company_id", input.companyId)
    .eq("metric_key", input.metricKey)
    .limit(500);

  if (history.error && !isMissingRelation(history.error)) {
    return { ok: false, status: 500, message: history.error.message };
  }

  let retiredVersion: number | null = null;
  let nextVersion = 1;

  if (!history.error) {
    // The unique index treats NULL scope as a wildcard bucket, so the rows that matter are
    // the ones with the SAME scope, matched here in application code.
    const rows = ((history.data as Row[] | null) ?? []).filter(
      (row) =>
        (row.service_code === null ? null : text(row.service_code) || null) === serviceCode &&
        (row.counterparty_id === null ? null : text(row.counterparty_id) || null) === counterpartyId
    );

    nextVersion = rows.reduce((highest, row) => Math.max(highest, num(row.version) || 0), 0) + 1;

    const current = rows.find((row) => row.active === true);
    if (current) {
      retiredVersion = num(current.version);
      const retire = await supabase
        .from("rr_intelligence_thresholds")
        .update({
          active: false,
          effective_to: effectiveFrom,
          retired_by: input.actorEmail,
          retired_at: now,
        })
        .eq("company_id", input.companyId)
        .eq("id", text(current.id));
      if (retire.error) {
        return { ok: false, status: 500, message: `Could not retire the current target: ${retire.error.message}` };
      }
    }
  }

  const inserted = await supabase
    .from("rr_intelligence_thresholds")
    .insert({
      company_id: input.companyId,
      metric_key: input.metricKey,
      service_code: serviceCode,
      counterparty_id: counterpartyId,
      target_value: input.targetValue,
      warning_value: input.warningValue ?? null,
      critical_value: input.criticalValue ?? null,
      unit: text(input.unit) || definition.unit,
      severity: input.severity ?? "medium",
      effective_from: effectiveFrom,
      active: true,
      version: nextVersion,
      notes: input.notes ?? null,
      created_by: input.actorEmail,
    })
    .select("id,version")
    .single();

  if (inserted.error || !inserted.data) {
    return {
      ok: false,
      status: 500,
      message: inserted.error?.message ?? "Could not publish the operational target.",
    };
  }

  return {
    ok: true,
    data: {
      thresholdId: text((inserted.data as Row).id),
      version: num((inserted.data as Row).version),
      retiredVersion,
    },
  };
}

export async function retireThreshold(
  supabase: SupabaseClient,
  input: { companyId: string; actorEmail: string; thresholdId: string; effectiveToIso?: string | null }
): Promise<RrServiceResult<{ retired: boolean }>> {
  const now = new Date().toISOString();
  const { error, data } = await supabase
    .from("rr_intelligence_thresholds")
    .update({
      active: false,
      effective_to: input.effectiveToIso ? text(input.effectiveToIso) : now,
      retired_by: input.actorEmail,
      retired_at: now,
    })
    .eq("company_id", input.companyId)
    .eq("id", input.thresholdId)
    .eq("active", true)
    .select("id");

  if (error) return { ok: false, status: 500, message: error.message };
  const rows = (data as Row[] | null) ?? [];
  if (rows.length === 0) {
    return {
      ok: false,
      status: 404,
      message: "No active target with that id. It may already have been retired.",
    };
  }
  return { ok: true, data: { retired: true } };
}

// ---------------------------------------------------------------------------
// The main computation
// ---------------------------------------------------------------------------

type LoadedFacts = RrIntelligenceFacts;


async function loadFacts(
  supabase: SupabaseClient,
  companyId: string,
  window: RrIntelligenceWindow,
  filters: { serviceCode: string | null; counterpartyId: string | null },
  limit: number,
  truncations: RrTruncationNotice[]
): Promise<LoadedFacts> {
  // --- Jobs, from the timing view so milestone resolution happens once in the database.
  let jobQuery = supabase
    .from("rr_job_timing")
    .select(
      "service_job_id,workflow_key,workflow_version,service_state,service_code,counterparty_id,created_at,is_bystand,terminal_state,finished_at"
    )
    .eq("company_id", companyId)
    .gte("created_at", window.fromIso)
    .lte("created_at", window.toIso)
    .limit(limit);
  if (filters.serviceCode) jobQuery = jobQuery.eq("service_code", filters.serviceCode);
  if (filters.counterpartyId) jobQuery = jobQuery.eq("counterparty_id", filters.counterpartyId);

  const jobRows = await boundedSelect(jobQuery, "rr_job_timing", limit, truncations);

  const jobs: RrJobTimingFact[] = jobRows.map((row) => ({
    serviceJobId: text(row.service_job_id),
    workflowKey: text(row.workflow_key),
    workflowVersion: numOrNull(row.workflow_version),
    serviceCode: text(row.service_code),
    counterpartyId: row.counterparty_id === null ? null : text(row.counterparty_id) || null,
    createdAt: text(row.created_at),
    serviceState: text(row.service_state),
  }));

  // BYSTAND is separated HERE, once, at the boundary. Every tow calculation downstream
  // receives towJobs and asserts the separation held.
  const bystandJobs = jobs.filter((job) => isBystandWorkflow(job.workflowKey));
  const towJobs = jobs.filter((job) => !isBystandWorkflow(job.workflowKey));
  const jobIds = jobs.map((job) => job.serviceJobId);

  if (jobIds.length === 0) {
    return {
      jobs, towJobs, bystandJobs,
      events: [], assignments: [], standbySummaries: [], bystandDetails: [],
      bookings: [], accruals: [], authorities: [], trucks: [], certifications: [],
      authorisations: [], calculations: [], distanceFacts: [], distanceEstimates: [],
      disputes: [], exceptions: [], margins: [], authJobs: [],
    };
  }

  const [
    eventRows, assignmentRows, standbyRows, bystandRows,
    bookingRows, accrualRows, authorityRows,
    truckRows, certRows,
    authorisationRows, calculationRows, factRows, candidateRows, disputeRows,
    jobExceptionRows, billingExceptionRows, marginRows, serviceTypeRows,
  ] = await Promise.all([
    boundedSelect(
      supabase.from("rr_service_state_events")
        .select("service_job_id,workflow_key,workflow_version,from_state,to_state,occurred_at,seconds_in_previous_state")
        .eq("company_id", companyId)
        .in("service_job_id", jobIds)
        .limit(limit),
      "rr_service_state_events", limit, truncations),
    boundedSelect(
      supabase.from("rr_dispatch_assignments")
        .select("id,service_job_id,employee_id,field_vehicle_id,assignment_status,sequence_number,offered_at,responded_at,decline_reason")
        .eq("company_id", companyId)
        .in("service_job_id", jobIds)
        .limit(limit),
      "rr_dispatch_assignments", limit, truncations),
    boundedSelect(
      supabase.from("rr_standby_summary")
        .select("service_job_id,sealed_reason,sealed_at,total_billable_seconds,total_paused_seconds,standing_interval_count,paused_interval_count,time_to_scene_seconds,stand_down_response_seconds,calculator_version,anomalies")
        .eq("company_id", companyId)
        .in("service_job_id", jobIds)
        .limit(limit),
      "rr_standby_summary", limit, truncations),
    boundedSelect(
      supabase.from("rr_bystand_details")
        .select("service_job_id,reason_code_id,requesting_authority,converted_service_job_id,converted_at,conversion_reason,report_submitted_at")
        .eq("company_id", companyId)
        .in("service_job_id", jobIds)
        .limit(limit),
      "rr_bystand_details", limit, truncations),
    boundedSelect(
      supabase.from("rr_storage_position")
        .select("booking_id,service_job_id,yard_id,yard_name,status,checked_in_at,checked_out_at,free_days,rate_amount,currency,vehicle_registration,sealed_elapsed_days,sealed_chargeable_days,sealed_free_days_applied,sealed_amount,calculator_version")
        .eq("company_id", companyId).limit(limit),
      "rr_storage_position", limit, truncations),
    boundedSelect(
      supabase.from("rr_storage_accrual")
        .select("service_job_id,booking_id,sealed_reason,period_start,period_end,chargeable_days,free_days_applied,elapsed_days,billable_units,amount,currency,calculator_version,sealed_at")
        .eq("company_id", companyId)
        .gte("sealed_at", window.fromIso).lte("sealed_at", window.toIso).limit(limit),
      "rr_storage_accrual", limit, truncations),
    boundedSelect(
      supabase.from("rr_release_authorisations")
        .select("id,service_job_id,authority_type,status,issued_at,valid_from,expires_at,verified_at")
        .eq("company_id", companyId).limit(limit),
      "rr_release_authorisations", limit, truncations),
    boundedSelect(
      supabase.from("rr_tow_truck_profiles")
        .select("id,field_vehicle_id,tow_class,availability_status,operational_status,base_label,location_updated_at")
        .eq("company_id", companyId).limit(limit),
      "rr_tow_truck_profiles", limit, truncations),
    boundedSelect(
      supabase.from("rr_driver_certifications")
        .select("id,employee_id,certification_type,status,expires_at,blocks_dispatch")
        .eq("company_id", companyId).limit(limit),
      "rr_driver_certifications", limit, truncations),
    boundedSelect(
      supabase.from("rr_authorisations")
        .select("id,service_job_id,counterparty_id,authorised_amount,authorised_at,expires_at,status")
        .eq("company_id", companyId)
        .in("service_job_id", jobIds)
        .limit(limit),
      "rr_authorisations", limit, truncations),
    boundedSelect(
      supabase.from("rr_charge_calculations")
        .select("service_job_id,status,total_incl_vat,subtotal_ex_vat,missing_facts,unrated_facts,calculated_at")
        .eq("company_id", companyId)
        .in("service_job_id", jobIds)
        .limit(limit),
      "rr_charge_calculations", limit, truncations),
    boundedSelect(
      supabase.from("rr_billable_facts")
        .select("service_job_id,quantity,source,status,source_detail")
        .eq("company_id", companyId).eq("fact_code", "tow_distance")
        .in("service_job_id", jobIds)
        .limit(limit),
      "rr_billable_facts", limit, truncations),
    boundedSelect(
      supabase.from("rr_dispatch_candidates")
        .select("service_job_id,distance_km,recommended,rank")
        .eq("company_id", companyId)
        .in("service_job_id", jobIds)
        .limit(limit),
      "rr_dispatch_candidates", limit, truncations),
    boundedSelect(
      supabase.from("rr_billing_disputes")
        .select("service_job_id,dispute_type,status")
        .eq("company_id", companyId)
        .in("service_job_id", jobIds)
        .limit(limit),
      "rr_billing_disputes", limit, truncations),
    boundedSelect(
      supabase.from("rr_job_exceptions")
        .select("id,service_job_id,exception_code,severity,detail,detected_by,resolution_status,created_at,resolved_at,automation_action_id")
        .eq("company_id", companyId)
        .in("service_job_id", jobIds)
        .limit(limit),
      "rr_job_exceptions", limit, truncations),
    boundedSelect(
      supabase.from("rr_billing_exceptions")
        .select("id,service_job_id,exception_code,severity,detail,detected_by,resolution_status,created_at,resolved_at,automation_action_id")
        .eq("company_id", companyId)
        .in("service_job_id", jobIds)
        .limit(limit),
      "rr_billing_exceptions", limit, truncations),
    boundedSelect(
      supabase.from("rr_job_margin")
        .select("service_job_id,service_code,expected_revenue_ex_vat,direct_cost,gross_margin,margin_pct,has_cost_data,calculation_status")
        .eq("company_id", companyId)
        .in("service_job_id", jobIds)
        .limit(limit),
      "rr_job_margin", limit, truncations),
    boundedSelect(
      supabase.from("rr_service_types")
        .select("service_code,requires_authorisation").eq("company_id", companyId).limit(200),
      "rr_service_types", 200, truncations),
  ]);

  const requiresAuthorisation = new Map(
    serviceTypeRows.map((row) => [text(row.service_code), row.requires_authorisation === true])
  );

  // Best dispatch estimate per job: the recommended candidate, else the top-ranked one.
  const estimateByJob = new Map<string, { distanceKm: number; rank: number; recommended: boolean }>();
  for (const row of candidateRows) {
    const jobId = text(row.service_job_id);
    const distance = numOrNull(row.distance_km);
    if (distance === null) continue;
    const candidate = { distanceKm: distance, rank: num(row.rank), recommended: row.recommended === true };
    const existing = estimateByJob.get(jobId);
    if (
      !existing ||
      (candidate.recommended && !existing.recommended) ||
      (candidate.recommended === existing.recommended && candidate.rank < existing.rank)
    ) {
      estimateByJob.set(jobId, candidate);
    }
  }

  const counterpartyNames = new Map<string, string>();
  const counterpartyIds = [...new Set(authorisationRows.map((row) => text(row.counterparty_id)).filter(Boolean))];
  if (counterpartyIds.length > 0) {
    const { data } = await supabase
      .from("rr_counterparties")
      .select("id,legal_name,trading_name")
      .eq("company_id", companyId)
      .in("id", counterpartyIds)
      .limit(500);
    for (const row of ((data as Row[] | null) ?? [])) {
      counterpartyNames.set(text(row.id), text(row.trading_name) || text(row.legal_name));
    }
  }

  const toException = (row: Row, origin: "job" | "billing"): RrExceptionFact => ({
    id: text(row.id),
    origin,
    serviceJobId: text(row.service_job_id),
    exceptionCode: text(row.exception_code),
    severity: (text(row.severity) || "medium") as RrSeverity,
    detail: row.detail === null ? null : text(row.detail) || null,
    detectedBy: text(row.detected_by),
    resolutionStatus: text(row.resolution_status),
    createdAt: text(row.created_at),
    resolvedAt: row.resolved_at === null ? null : text(row.resolved_at) || null,
    automationActionId: row.automation_action_id === null ? null : text(row.automation_action_id) || null,
  });

  const bystandJobIds = new Set(bystandJobs.map((job) => job.serviceJobId));

  return {
    jobs,
    towJobs,
    bystandJobs,
    events: eventRows.map((row) => ({
      serviceJobId: text(row.service_job_id),
      workflowKey: text(row.workflow_key),
      workflowVersion: numOrNull(row.workflow_version),
      fromState: row.from_state === null ? null : text(row.from_state) || null,
      toState: text(row.to_state),
      occurredAt: text(row.occurred_at),
      secondsInPreviousState: numOrNull(row.seconds_in_previous_state),
    })),
    assignments: assignmentRows.map((row) => ({
      id: text(row.id),
      serviceJobId: text(row.service_job_id),
      employeeId: row.employee_id === null ? null : text(row.employee_id) || null,
      fieldVehicleId: row.field_vehicle_id === null ? null : text(row.field_vehicle_id) || null,
      assignmentStatus: text(row.assignment_status) as RrAssignmentFact["assignmentStatus"],
      sequenceNumber: num(row.sequence_number) || 1,
      offeredAt: row.offered_at === null ? null : text(row.offered_at) || null,
      respondedAt: row.responded_at === null ? null : text(row.responded_at) || null,
      declineReason: row.decline_reason === null ? null : text(row.decline_reason) || null,
    })),
    // Sealed BYSTAND facts, restricted to BYSTAND jobs so nothing else can reach them.
    standbySummaries: standbyRows
      .filter((row) => bystandJobIds.has(text(row.service_job_id)))
      .map((row) => ({
        serviceJobId: text(row.service_job_id),
        sealedReason: text(row.sealed_reason),
        sealedAt: text(row.sealed_at),
        totalBillableSeconds: num(row.total_billable_seconds),
        totalPausedSeconds: num(row.total_paused_seconds),
        standingIntervalCount: num(row.standing_interval_count),
        pausedIntervalCount: num(row.paused_interval_count),
        timeToSceneSeconds: numOrNull(row.time_to_scene_seconds),
        standDownResponseSeconds: numOrNull(row.stand_down_response_seconds),
        calculatorVersion: text(row.calculator_version),
        anomalies: row.anomalies,
      })),
    bystandDetails: bystandRows.map((row) => ({
      serviceJobId: text(row.service_job_id),
      reasonCodeId: row.reason_code_id === null ? null : text(row.reason_code_id) || null,
      reasonCode: null,
      reasonLabel: null,
      requestingAuthority: row.requesting_authority === null ? null : text(row.requesting_authority) || null,
      convertedServiceJobId:
        row.converted_service_job_id === null ? null : text(row.converted_service_job_id) || null,
      convertedAt: row.converted_at === null ? null : text(row.converted_at) || null,
      conversionReason: row.conversion_reason === null ? null : text(row.conversion_reason) || null,
      reportSubmittedAt: row.report_submitted_at === null ? null : text(row.report_submitted_at) || null,
    })),
    bookings: bookingRows.map((row) => ({
      id: text(row.booking_id),
      serviceJobId: text(row.service_job_id),
      yardId: row.yard_id === null ? null : text(row.yard_id) || null,
      yardName: row.yard_name === null ? null : text(row.yard_name) || null,
      status: text(row.status),
      checkedInAt: row.checked_in_at === null ? null : text(row.checked_in_at) || null,
      checkedOutAt: row.checked_out_at === null ? null : text(row.checked_out_at) || null,
      freeDays: numOrNull(row.free_days),
      rateAmount: numOrNull(row.rate_amount),
      currency: row.currency === null ? null : text(row.currency) || null,
      vehicleRegistration:
        row.vehicle_registration === null ? null : text(row.vehicle_registration) || null,
    })),
    accruals: accrualRows.map((row) => ({
      serviceJobId: text(row.service_job_id),
      bookingId: text(row.booking_id),
      sealedReason: text(row.sealed_reason),
      periodStart: text(row.period_start),
      periodEnd: text(row.period_end),
      chargeableDays: num(row.chargeable_days),
      freeDaysApplied: num(row.free_days_applied),
      elapsedDays: num(row.elapsed_days),
      billableUnits: num(row.billable_units),
      amount: num(row.amount),
      currency: text(row.currency),
      calculatorVersion: text(row.calculator_version),
      sealedAt: text(row.sealed_at),
    })),
    authorities: authorityRows.map((row) => ({
      id: text(row.id),
      serviceJobId: text(row.service_job_id),
      authorityType: text(row.authority_type) as "release" | "disposal",
      status: text(row.status),
      issuedAt: row.issued_at === null ? null : text(row.issued_at) || null,
      validFrom: row.valid_from === null ? null : text(row.valid_from) || null,
      expiresAt: row.expires_at === null ? null : text(row.expires_at) || null,
      verifiedAt: row.verified_at === null ? null : text(row.verified_at) || null,
    })),
    trucks: truckRows.map((row) => ({
      id: text(row.id),
      fieldVehicleId: text(row.field_vehicle_id),
      registration: null,
      towClass: text(row.tow_class),
      availabilityStatus: text(row.availability_status),
      operationalStatus: text(row.operational_status),
      baseLabel: row.base_label === null ? null : text(row.base_label) || null,
      locationUpdatedAt: row.location_updated_at === null ? null : text(row.location_updated_at) || null,
    })),
    certifications: certRows.map((row) => ({
      id: text(row.id),
      employeeId: text(row.employee_id),
      employeeName: null,
      certificationType: text(row.certification_type),
      status: text(row.status),
      expiresAt: row.expires_at === null ? null : text(row.expires_at) || null,
      blocksDispatch: row.blocks_dispatch === true,
    })),
    authorisations: authorisationRows.map((row) => ({
      id: text(row.id),
      serviceJobId: text(row.service_job_id),
      counterpartyId: text(row.counterparty_id),
      counterpartyName: counterpartyNames.get(text(row.counterparty_id)) ?? null,
      authorisedAmount: numOrNull(row.authorised_amount),
      authorisedAt: row.authorised_at === null ? null : text(row.authorised_at) || null,
      expiresAt: row.expires_at === null ? null : text(row.expires_at) || null,
      status: text(row.status),
    })),
    calculations: calculationRows.map((row) => ({
      serviceJobId: text(row.service_job_id),
      status: text(row.status),
      totalInclVat: num(row.total_incl_vat),
      subtotalExVat: num(row.subtotal_ex_vat),
      missingFacts: Array.isArray(row.missing_facts) ? (row.missing_facts as string[]) : null,
      unratedFacts: Array.isArray(row.unrated_facts) ? (row.unrated_facts as string[]) : null,
      calculatedAt: text(row.calculated_at),
    })),
    distanceFacts: factRows.map((row) => {
      const detail = (row.source_detail ?? {}) as Record<string, unknown>;
      return {
        serviceJobId: text(row.service_job_id),
        quantity: num(row.quantity),
        source: text(row.source),
        status: text(row.status),
        odometerStartKm: numOrNull(detail.odometer_start_km),
        odometerEndKm: numOrNull(detail.odometer_end_km),
      };
    }),
    distanceEstimates: [...estimateByJob.entries()].map(([serviceJobId, entry]) => ({
      serviceJobId,
      distanceKm: entry.distanceKm,
    })),
    disputes: disputeRows.map((row) => ({
      serviceJobId: text(row.service_job_id),
      disputeType: text(row.dispute_type),
    })),
    exceptions: [
      ...jobExceptionRows.map((row) => toException(row, "job")),
      ...billingExceptionRows.map((row) => toException(row, "billing")),
    ],
    margins: marginRows.map((row) => ({
      serviceJobId: text(row.service_job_id),
      serviceCode: text(row.service_code),
      expectedRevenueZAR: numOrNull(row.expected_revenue_ex_vat),
      // has_cost_data is authoritative (sql/081). Missing cost is NULL, never zero.
      costZAR: row.has_cost_data === true ? numOrNull(row.direct_cost) : null,
      marginZAR: row.has_cost_data === true ? numOrNull(row.gross_margin) : null,
      marginPct: row.has_cost_data === true ? numOrNull(row.margin_pct) : null,
    })),
    authJobs: jobs.map((job) => ({
      serviceJobId: job.serviceJobId,
      serviceCode: job.serviceCode,
      requiresAuthorisation: requiresAuthorisation.get(job.serviceCode) === true,
      createdAt: job.createdAt,
      counterpartyId: job.counterpartyId,
    })),
  };
}

// ---------------------------------------------------------------------------
// The main computation
// ---------------------------------------------------------------------------

/**
 * Computes Road & Recovery intelligence for one tenant over one window.
 *
 * Load, then compute. Every calculation below this point happens in a pure engine, so the
 * arithmetic is unit-tested without a database and produces the same answer every time it
 * is run over the same facts.
 */
export async function computeRoadRecoveryIntelligence(
  supabase: SupabaseClient,
  options: RrIntelligenceOptions
): Promise<RrServiceResult<RrIntelligenceResult>> {
  const companyId = text(options.companyId);
  if (!companyId) return { ok: false, status: 400, message: "companyId is required." };

  const window = resolveWindow(options);
  const filters = {
    serviceCode: options.serviceCode ? text(options.serviceCode) : null,
    counterpartyId: options.counterpartyId ? text(options.counterpartyId) : null,
  };
  const limit = Math.max(
    100,
    Math.min(options.rowLimit ?? RR_INTELLIGENCE_ROW_LIMIT, RR_INTELLIGENCE_ROW_LIMIT)
  );
  const truncations: RrTruncationNotice[] = [];

  try {
    const [thresholds, facts] = await Promise.all([
      loadThresholds(supabase, companyId),
      loadFacts(supabase, companyId, window, filters, limit, truncations),
    ]);

    const operationalExtras = await loadOperationalExtras(supabase, companyId);

    const built = buildDomains(facts, {
      thresholds,
      window,
      filters,
      detailLimit: DETAIL_LIMIT,
    });

    const health = computeRoadRecoveryHealth(built.metrics);

    /**
     * Structural findings, merged with the threshold-driven ones.
     *
     * A workspace that has not configured a single SLA still needs to be told
     * that a job is unassigned or that evidence is blocking billing. These are
     * counted from rows rather than compared against a target, so they appear
     * from day one; see intelligence/operational.ts.
     */
    const operationalFindings = buildOperationalFindings({
      asOfIso: window.asOfIso,
      jobs: facts.towJobs,
      events: facts.events,
      assignments: facts.assignments,
      outstandingEvidence: operationalExtras.outstandingEvidence,
      unverifiedArrivals: operationalExtras.unverifiedArrivals,
    });

    const allFindings = [...built.findings, ...operationalFindings];

    const recommendations = buildRecommendations(allFindings, {
      asOfIso: window.asOfIso,
      limit: 25,
    });

    // Domain 14: Executive Road & Recovery Health. Not a second score — the health engine
    // produced it, and this presents it as a domain alongside the others.
    const executiveDomain: RrDomainResult = {
      domain: "executive_health",
      label: RR_DOMAIN_LABELS.executive_health,
      metrics: [],
      findings: [],
      detail: {
        score: health.score,
        band: health.band,
        narrative: health.narrative,
        components: health.components,
        domainScores: health.domains,
        configuredCoveragePct: health.configuredCoveragePct,
        metricsWithoutTargets: health.metricsWithoutTargets,
        metricsWithoutData: health.metricsWithoutData,
        engineVersion: health.engineVersion,
      },
      empty: health.score === null,
      truncated: null,
    };

    // Domain 15: Recommended Actions. Ready to enter the EXISTING action pipeline. Nothing
    // is written here — preparing an action is a deliberate act by a person, through
    // prepareRoadRecoveryAction().
    const actionsDomain: RrDomainResult = {
      domain: "recommended_actions",
      label: RR_DOMAIN_LABELS.recommended_actions,
      metrics: [],
      findings: allFindings,
      detail: {
        recommendations,
        totalFindings: allFindings.length,
        withRootCause: allFindings.filter((finding) => finding.rootCause !== null).length,
        withoutRootCause: allFindings.filter((finding) => finding.rootCause === null).length,
        quantifiedImpact: recommendations.filter((entry) => entry.financialImpactKnown).length,
        pipelineNote:
          "Recommendations enter the EXISTING UMORA action pipeline: workforce_automation_actions, the existing approval queue, and the existing outcome columns. There is no separate Road & Recovery action system.",
      },
      empty: recommendations.length === 0,
      truncated: null,
    };

    const domains = [...built.domains, executiveDomain, actionsDomain];

    // Truncation is attached to the domains it affects and repeated at the top level, so a
    // partial figure is never presented as a complete one.
    if (truncations.length > 0) {
      for (const domain of domains) {
        if (domain.metrics.length === 0 && domain.findings.length === 0) continue;
        domain.truncated = truncations[0];
      }
    }

    return {
      ok: true,
      data: {
        companyId,
        window,
        filters,
        domains,
        metrics: built.metrics,
        health,
        recommendations,
        thresholdsConfigured: thresholds.filter((entry) => entry.active).length,
        truncations,
        provisioned: true,
        jobCount: facts.jobs.length,
        bystandCount: facts.bystandJobs.length,
        generatedAtIso: new Date().toISOString(),
      },
    };
  } catch (error: unknown) {
    return {
      ok: false,
      status: 500,
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

// ---------------------------------------------------------------------------
// Action integration — the EXISTING pipeline
// ---------------------------------------------------------------------------

/**
 * Prepares one Road & Recovery recommendation as an action.
 *
 * It calls prepareAutomationAction(), which is the same function every workforce
 * recommendation has always used. That function orchestrates through the existing workflow
 * engine, writes to workforce_automation_actions, captures the BEFORE metrics into
 * outcome_before_json, sets the approval chain, and writes the audit entry.
 *
 * Nothing about this path is new. Phase 6 supplies operational facts; the pipeline that
 * already runs the business does the rest.
 */
export async function prepareRoadRecoveryAction(
  supabase: SupabaseClient,
  input: {
    companyId: string;
    actorEmail: string;
    findingKey: string;
    submitToQueue?: boolean;
    options?: RrIntelligenceOptions;
  }
): Promise<RrServiceResult<{ actionId: string; trigger: string; owner: string; dueDate: string }>> {
  const intelligence = await computeRoadRecoveryIntelligence(supabase, {
    ...(input.options ?? { companyId: input.companyId }),
    companyId: input.companyId,
  });
  if (!intelligence.ok) return intelligence;

  const recommendation = intelligence.data.recommendations.find(
    (entry) => entry.key === input.findingKey
  );
  if (!recommendation) {
    return {
      ok: false,
      status: 404,
      message: `No current recommendation with key "${input.findingKey}". It may have been resolved since the dashboard was loaded.`,
    };
  }

  const { prepareAutomationAction } = await import("@/lib/workforce-automation-engine");
  const { toActionPayload } = await import("@/lib/road-recovery/intelligence/recommendations");

  const payload = toActionPayload(recommendation, {
    windowFromIso: intelligence.data.window.fromIso,
    windowToIso: intelligence.data.window.toIso,
    asOfIso: intelligence.data.window.asOfIso,
  });

  const prepared = await prepareAutomationAction(supabase, {
    companyId: input.companyId,
    actionType: recommendation.actionType as never,
    employeeId: null,
    managerId: null,
    preparedByEmail: input.actorEmail,
    sourceModule: "Road & Recovery Intelligence",
    reason: recommendation.recommendation,
    payload: {
      ...payload,
      // The orchestration engine reads these to build the workflow. Financial impact is
      // supplied ONLY when it was genuinely calculated.
      department: recommendation.domainLabel,
      subject: recommendation.domainLabel,
      condition: recommendation.symptom,
      affectedCount: recommendation.affectedCount,
      measuredValue: recommendation.measuredValue ?? 0,
      targetValue: recommendation.targetValue ?? 0,
      openCriticalExceptions: recommendation.beforeMetrics.openCriticalExceptions ?? 0,
      rootCause: recommendation.rootCause ?? "",
      confidence: recommendation.rootCauseConfidence ?? "",
      expectedOutcome: recommendation.expectedOutcome,
      consequenceIfIgnored: recommendation.consequenceIfIgnored,
      ...(recommendation.financialImpactKnown
        ? { financialImpactZAR: recommendation.financialImpactZAR }
        : {}),
    },
    submitToQueue: input.submitToQueue !== false,
    triggerType: recommendation.trigger,
    createdBy: input.actorEmail,
  });

  if (prepared.error || !prepared.action) {
    return { ok: false, status: 500, message: prepared.error ?? "Could not prepare the action." };
  }

  return {
    ok: true,
    data: {
      actionId: prepared.action.id,
      trigger: recommendation.trigger,
      owner: prepared.action.workflow_owner ?? recommendation.ownerRole,
      dueDate: recommendation.dueDateIso,
    },
  };
}

/**
 * Re-measures a metric after an action completed, and records the result.
 *
 * This is the DID IT IMPROVE question, and it is answered against the SAME metric that
 * raised the finding. `outcome_before_json` was captured when the action was prepared, so
 * the comparison is like for like rather than against a target that has since changed.
 *
 * The outcome columns are the ones sql/048 already added. No outcome table is created.
 */
export async function measureRoadRecoveryOutcome(
  supabase: SupabaseClient,
  input: { companyId: string; actionId: string; actorEmail: string }
): Promise<
  RrServiceResult<{
    metricKey: string | null;
    before: number | null;
    after: number | null;
    improved: boolean | null;
    summary: string;
  }>
> {
  const { data, error } = await supabase
    .from("workforce_automation_actions")
    .select("id,payload_json,outcome_before_json,trigger_type,status")
    .eq("company_id", input.companyId)
    .eq("id", input.actionId)
    .maybeSingle();

  if (error) return { ok: false, status: 500, message: error.message };
  if (!data) return { ok: false, status: 404, message: "No such action for this company." };

  const row = data as Row;
  const payload = (row.payload_json ?? {}) as Record<string, unknown>;
  const before = (row.outcome_before_json ?? {}) as Record<string, unknown>;
  const metricKey = payload.metric_key === null ? null : text(payload.metric_key) || null;

  if (!metricKey) {
    return {
      ok: false,
      status: 400,
      message:
        "This action was not raised from a measurable metric, so improvement cannot be measured against one.",
    };
  }

  // Re-measure over a window of the same LENGTH, ending now, so the two figures are
  // comparable. Comparing a month against a week would make any operation look transformed.
  const windowFrom = text(payload.window_from);
  const windowTo = text(payload.window_to);
  const parsedTo = Date.parse(windowTo);
  const parsedFrom = Date.parse(windowFrom);
  const spanMs =
    Number.isFinite(parsedTo) && Number.isFinite(parsedFrom) && parsedTo > parsedFrom
      ? parsedTo - parsedFrom
      : RR_INTELLIGENCE_DEFAULT_WINDOW_DAYS * MS_PER_DAY;

  const nowIso = new Date().toISOString();
  const fromIso = new Date(Date.now() - spanMs).toISOString();

  const after = await computeRoadRecoveryIntelligence(supabase, {
    companyId: input.companyId,
    fromIso,
    toIso: nowIso,
    asOfIso: nowIso,
  });
  if (!after.ok) return after;

  const metric = after.data.metrics.find((entry) => entry.key === metricKey) ?? null;
  const beforeValue = numOrNull(before.measuredValue);
  const afterValue = metric?.value ?? null;

  // Improvement is claimed only when BOTH values exist. A missing after-value means the
  // outcome is unknown, not that nothing improved.
  let improved: boolean | null = null;
  if (beforeValue !== null && afterValue !== null && metric) {
    improved =
      metric.direction === "higher_is_better" ? afterValue > beforeValue : afterValue < beforeValue;
  }

  const summary =
    beforeValue === null || afterValue === null
      ? `Outcome for ${metricKey} could not be measured: ${
          beforeValue === null
            ? "no before value was captured"
            : "there is no data in the comparison window"
        }. Recorded as unmeasured rather than as no improvement.`
      : `${metricKey} moved from ${beforeValue} to ${afterValue} over a comparable window. ${
          improved ? "This is an improvement." : "This is not an improvement."
        }${metric?.band === "ok" ? " The metric is now within its configured target." : ""}`;

  const update = await supabase
    .from("workforce_automation_actions")
    .update({
      outcome_after_json: {
        metric_key: metricKey,
        measured_value: afterValue,
        target_value: metric?.target ?? null,
        band: metric?.band ?? null,
        threshold_version: metric?.thresholdVersion ?? null,
        sample_size: metric?.sampleSize ?? 0,
        window_from: fromIso,
        window_to: nowIso,
        measured_by: input.actorEmail,
        measured_at: nowIso,
        improved,
      },
      outcome_summary: summary,
      updated_at: nowIso,
    })
    .eq("company_id", input.companyId)
    .eq("id", input.actionId);

  if (update.error) return { ok: false, status: 500, message: update.error.message };

  return {
    ok: true,
    data: { metricKey, before: beforeValue, after: afterValue, improved, summary },
  };
}

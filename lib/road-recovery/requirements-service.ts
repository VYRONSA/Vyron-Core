/**
 * VYRON CORE — Road & Recovery requirements & compliance service layer (Phase 3).
 *
 * The I/O half. Every decision is delegated to the pure engine in
 * lib/road-recovery/requirements.ts:
 *
 *   which policy governs a job -> resolveRequirementPolicy()   (pure)
 *   which requirements apply   -> evaluateCondition()          (pure)
 *   whether the job complies   -> evaluateCompliance()         (pure)
 *
 * ---------------------------------------------------------------------------
 * THE GUARD
 * ---------------------------------------------------------------------------
 *
 * evaluateJobCompliance() is what finally answers Phase 0's `evidence_complete` guard.
 * It is computed HERE, from the database, and is never accepted from a caller — exactly
 * as `authorisation_valid` already is. A client that posts `evidence_complete: true`
 * changes nothing.
 *
 * ---------------------------------------------------------------------------
 * REUSE
 * ---------------------------------------------------------------------------
 *
 *   public.mobile_workforce_evidence  the ONE evidence repository. Never modified here;
 *       Phase 3 only links to it. The requirement code carries the semantics, because a
 *       single photograph may satisfy several requirements at once.
 *   public.rr_authorisations          satisfies authorisation-kind requirements
 *   public.mobile_gps_validations     satisfies GPS-kind requirements
 *   public.vyron_audit_log            audit trail for waivers and evaluations
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { writeAuditLog } from "@/lib/audit-log";
import type { RrServiceResult } from "@/lib/road-recovery/job-service";
import { RR_EVIDENCE_BUCKET } from "@/lib/road-recovery/bystand-service";
import {
  evaluateCompliance,
  RR_COMPLIANCE_ENGINE_VERSION,
  resolveRequirementPolicy,
  type RrBlockingScope,
  type RrComplianceResult,
  type RrCondition,
  type RrEvidenceKind,
  type RrJobFacts,
  type RrRequirementDefinition,
  type RrRequirementPolicy,
  type RrWaiverRecord,
} from "@/lib/road-recovery/requirements";

type Row = Record<string, unknown>;

function asText(value: unknown): string {
  return String(value ?? "").trim();
}

function fail(message: string, status = 400): { ok: false; status: number; message: string } {
  return { ok: false, status, message };
}

// ---------------------------------------------------------------------------
// Job facts
// ---------------------------------------------------------------------------

/**
 * The facts conditional requirements are evaluated against.
 *
 * Derived entirely from stored job data — never from the caller — so a client cannot
 * make a conditional requirement inapplicable by asserting a fact.
 */
export function buildJobFacts(job: Row, serviceCode: string, extras: Row = {}): RrJobFacts {
  const thirdParties = Array.isArray(job.third_party_details) ? job.third_party_details : [];
  return {
    service_code: serviceCode,
    counterparty_present: Boolean(asText(job.counterparty_id)),
    third_party_involved: thirdParties.length > 0,
    casualty_flag: job.casualty_flag === true,
    police_involved: Boolean(asText(job.police_reference)),
    has_destination: Boolean(
      asText(job.destination_label) || asText(job.destination_address) || asText(job.destination_type)
    ),
    converted_to_recovery: Boolean(extras.converted_to_recovery),
    resolved_on_scene: Boolean(extras.resolved_on_scene),
    went_to_storage: Boolean(extras.went_to_storage),
  };
}

// ---------------------------------------------------------------------------
// Policy resolution + snapshot
// ---------------------------------------------------------------------------

function rowToPolicy(policyRow: Row, itemRows: Row[]): RrRequirementPolicy {
  return {
    policyKey: asText(policyRow.policy_key),
    counterpartyId: asText(policyRow.counterparty_id) || null,
    serviceCode: asText(policyRow.service_code) || null,
    version: Number(policyRow.version) || 1,
    active: policyRow.active !== false,
    effectiveFrom: policyRow.effective_from ? asText(policyRow.effective_from) : null,
    effectiveTo: policyRow.effective_to ? asText(policyRow.effective_to) : null,
    requirements: itemRows
      .filter((item) => asText(item.policy_id) === asText(policyRow.id))
      .map((item) => ({
        requirementCode: asText(item.requirement_code),
        label: asText(item.label),
        evidenceKind: asText(item.evidence_kind) as RrEvidenceKind,
        mandatory: item.mandatory !== false,
        condition: (item.condition ?? { always: true }) as RrCondition,
        minCount: Number(item.min_count) || 1,
        blockingScopes: (Array.isArray(item.blocking_scopes)
          ? item.blocking_scopes
          : []) as RrBlockingScope[],
        guidance: item.guidance ? asText(item.guidance) : undefined,
        sortOrder: Number(item.sort_order) || 100,
      })),
  };
}

/** Loads every candidate policy for a company. */
async function loadPolicies(
  supabase: SupabaseClient,
  companyId: string
): Promise<{ policies: RrRequirementPolicy[]; byKey: Map<string, Row>; error: string | null }> {
  const [policiesRes, itemsRes] = await Promise.all([
    supabase
      .from("rr_requirement_policies")
      .select("id,policy_key,counterparty_id,service_code,version,active,effective_from,effective_to")
      .eq("company_id", companyId),
    supabase
      .from("rr_requirement_items")
      .select(
        "id,policy_id,requirement_code,label,evidence_kind,mandatory,condition,min_count,blocking_scopes,guidance,sort_order"
      )
      .eq("company_id", companyId),
  ]);

  if (policiesRes.error) return { policies: [], byKey: new Map(), error: policiesRes.error.message };
  if (itemsRes.error) return { policies: [], byKey: new Map(), error: itemsRes.error.message };

  const policyRows = (policiesRes.data || []) as Row[];
  const itemRows = (itemsRes.data || []) as Row[];
  const byKey = new Map<string, Row>();
  for (const row of policyRows) byKey.set(asText(row.policy_key) + "@" + Number(row.version), row);

  return {
    policies: policyRows.map((row) => rowToPolicy(row, itemRows)),
    byKey,
    error: null,
  };
}

export type RequirementSnapshotResult = {
  policyKey: string | null;
  policyVersion: number | null;
  requirementCount: number;
  reason: string;
};

/**
 * Resolves the governing policy and writes the job's IMMUTABLE requirement snapshot.
 *
 * Called once, at job creation. A later policy edit cannot alter this snapshot — the
 * table refuses UPDATE — so a job can never become retroactively non-compliant because
 * someone tightened a rule after it was invoiced.
 *
 * A job with no applicable policy is NOT an error: it simply has no requirements, and
 * its compliance evaluates as compliant. Refusing to create the job would make requirement
 * configuration a precondition for operating, which is the wrong failure mode for a
 * control room at 2am.
 */
export async function createRequirementSnapshot(
  supabase: SupabaseClient,
  input: {
    companyId: string;
    serviceJobId: string;
    serviceCode: string;
    counterpartyId: string | null;
    at: string;
  }
): Promise<RrServiceResult<RequirementSnapshotResult>> {
  const { policies, byKey, error } = await loadPolicies(supabase, input.companyId);
  if (error) return fail(error, 500);

  const resolution = resolveRequirementPolicy(policies, {
    counterpartyId: input.counterpartyId,
    serviceCode: input.serviceCode,
    at: input.at,
  });

  if (!resolution.policy) {
    return {
      ok: true,
      data: {
        policyKey: null,
        policyVersion: null,
        requirementCount: 0,
        reason: resolution.reason,
      },
    };
  }

  const policy = resolution.policy;
  const policyRow = byKey.get(policy.policyKey + "@" + policy.version);

  const rows = policy.requirements.map((requirement) => ({
    company_id: input.companyId,
    service_job_id: input.serviceJobId,
    policy_id: policyRow ? asText(policyRow.id) : null,
    policy_key: policy.policyKey,
    policy_version: policy.version,
    resolved_at: input.at,
    requirement_code: requirement.requirementCode,
    label: requirement.label,
    evidence_kind: requirement.evidenceKind,
    mandatory: requirement.mandatory,
    condition: requirement.condition,
    min_count: requirement.minCount,
    blocking_scopes: requirement.blockingScopes,
    guidance: requirement.guidance ?? null,
    sort_order: requirement.sortOrder,
  }));

  if (rows.length > 0) {
    const { error: insertError } = await supabase.from("rr_evidence_requirements").insert(rows);
    if (insertError) return fail(insertError.message, 500);
  }

  return {
    ok: true,
    data: {
      policyKey: policy.policyKey,
      policyVersion: policy.version,
      requirementCount: rows.length,
      reason: resolution.reason,
    },
  };
}

// ---------------------------------------------------------------------------
// Loading a job's requirements and evidence
// ---------------------------------------------------------------------------

export type JobRequirementRow = RrRequirementDefinition & {
  id: string;
  policyKey: string | null;
  policyVersion: number | null;
};

async function loadJobRequirements(
  supabase: SupabaseClient,
  companyId: string,
  serviceJobId: string
): Promise<{ requirements: JobRequirementRow[]; error: string | null }> {
  const { data, error } = await supabase
    .from("rr_evidence_requirements")
    .select(
      "id,policy_key,policy_version,requirement_code,label,evidence_kind,mandatory,condition,min_count,blocking_scopes,guidance,sort_order"
    )
    .eq("company_id", companyId)
    .eq("service_job_id", serviceJobId)
    .order("sort_order", { ascending: true });

  if (error) return { requirements: [], error: error.message };

  return {
    requirements: ((data || []) as Row[]).map((row) => ({
      id: asText(row.id),
      policyKey: row.policy_key ? asText(row.policy_key) : null,
      policyVersion: row.policy_version === null ? null : Number(row.policy_version),
      requirementCode: asText(row.requirement_code),
      label: asText(row.label),
      evidenceKind: asText(row.evidence_kind) as RrEvidenceKind,
      mandatory: row.mandatory !== false,
      condition: (row.condition ?? { always: true }) as RrCondition,
      minCount: Number(row.min_count) || 1,
      blockingScopes: (Array.isArray(row.blocking_scopes)
        ? row.blocking_scopes
        : []) as RrBlockingScope[],
      guidance: row.guidance ? asText(row.guidance) : undefined,
      sortOrder: Number(row.sort_order) || 100,
    })),
    error: null,
  };
}

/**
 * Counts ACCEPTED evidence per requirement.
 *
 * Rejected links do not count: a photograph a controller has rejected has not satisfied
 * anything. Authorisation- and GPS-kind requirements are additionally satisfied by the
 * records that already exist in rr_authorisations and mobile_gps_validations, so a
 * controller never has to re-attach evidence VYRON already holds.
 */
async function countEvidence(
  supabase: SupabaseClient,
  companyId: string,
  serviceJobId: string,
  fieldJobId: string,
  requirements: JobRequirementRow[],
  /** The instant the evaluation is taken at, so a time-limited authority is judged at it. */
  at: string
): Promise<{ counts: Record<string, number>; error: string | null }> {
  const counts: Record<string, number> = {};

  const { data: links, error: linksError } = await supabase
    .from("rr_evidence_links")
    .select("requirement_code,verification_status")
    .eq("company_id", companyId)
    .eq("service_job_id", serviceJobId);

  if (linksError) return { counts, error: linksError.message };

  for (const row of (links || []) as Row[]) {
    if (asText(row.verification_status) === "rejected") continue;
    const code = asText(row.requirement_code);
    counts[code] = (counts[code] ?? 0) + 1;
  }

  const needsAuthorisation = requirements.some((entry) => entry.evidenceKind === "authorisation");
  const needsGps = requirements.some((entry) => entry.evidenceKind === "gps");

  if (needsAuthorisation) {
    const { data: auths } = await supabase
      .from("rr_authorisations")
      .select("id,status")
      .eq("company_id", companyId)
      .eq("service_job_id", serviceJobId)
      .eq("status", "active");
    const active = ((auths || []) as Row[]).length;

    // A RELEASE authorisation is a different record from the job-level authorisation to
    // proceed, and answers a different question: not "may we tow this", but "may this
    // vehicle leave". Phase 3 left it unsatisfiable on purpose; Phase 4 supplies the
    // record, and it is counted only when a verified authority is actually IN FORCE —
    // decided by the same pure function the workflow guard uses, so the checklist and the
    // guard can never disagree.
    const needsReleaseAuthority = requirements.some(
      (entry) => entry.requirementCode === "release_authorisation"
    );
    let releaseAuthorityInForce = 0;
    if (needsReleaseAuthority) {
      const { decideAuthority } = await import("@/lib/road-recovery/release-authority");
      const { data: releaseRows } = await supabase
        .from("rr_release_authorisations")
        .select("id,authority_type,status,valid_from,expires_at,verified_at,verified_by")
        .eq("company_id", companyId)
        .eq("service_job_id", serviceJobId)
        .eq("authority_type", "release");

      const decision = decideAuthority(
        ((releaseRows || []) as Row[]).map((row) => ({
          id: asText(row.id),
          authorityType: "release" as const,
          status: asText(row.status),
          validFrom: row.valid_from ? asText(row.valid_from) : null,
          expiresAt: row.expires_at ? asText(row.expires_at) : null,
          verifiedAt: row.verified_at ? asText(row.verified_at) : null,
          verifiedBy: row.verified_by ? asText(row.verified_by) : null,
        })),
        "release",
        at
      );
      releaseAuthorityInForce = decision.authorised ? 1 : 0;
    }

    for (const entry of requirements) {
      if (entry.evidenceKind !== "authorisation") continue;
      if (entry.requirementCode === "release_authorisation") {
        counts[entry.requirementCode] =
          (counts[entry.requirementCode] ?? 0) + releaseAuthorityInForce;
        continue;
      }
      counts[entry.requirementCode] = (counts[entry.requirementCode] ?? 0) + active;
    }
  }

  if (needsGps && fieldJobId) {
    const { data: validations } = await supabase
      .from("mobile_gps_validations")
      .select("id,inside_radius,reference_type")
      .eq("company_id", companyId)
      .eq("job_id", fieldJobId);
    const rows = (validations || []) as Row[];
    const verifiedArrivals = rows.filter((row) => row.inside_radius === true).length;
    for (const entry of requirements) {
      if (entry.evidenceKind !== "gps") continue;
      if (entry.requirementCode === "gps_arrival") {
        counts[entry.requirementCode] = (counts[entry.requirementCode] ?? 0) + verifiedArrivals;
      }
    }
  }

  return { counts, error: null };
}

async function loadWaivers(
  supabase: SupabaseClient,
  companyId: string,
  serviceJobId: string
): Promise<{ waivers: RrWaiverRecord[]; error: string | null }> {
  const { data, error } = await supabase
    .from("rr_requirement_waivers")
    .select("requirement_code,reason_code,reason_detail,waived_by,approved_at")
    .eq("company_id", companyId)
    .eq("service_job_id", serviceJobId);

  if (error) return { waivers: [], error: error.message };

  return {
    waivers: ((data || []) as Row[]).map((row) => ({
      requirementCode: asText(row.requirement_code),
      reasonCode: asText(row.reason_code),
      reasonDetail: row.reason_detail ? asText(row.reason_detail) : null,
      waivedBy: asText(row.waived_by),
      approvedAt: asText(row.approved_at),
    })),
    error: null,
  };
}

// ---------------------------------------------------------------------------
// The compliance evaluation
// ---------------------------------------------------------------------------

export type JobComplianceOutcome = {
  compliance: RrComplianceResult;
  requirements: JobRequirementRow[];
  facts: RrJobFacts;
};

/**
 * Evaluates a job's compliance. Read-only.
 *
 * THIS IS WHAT ANSWERS THE `evidence_complete` GUARD. Deterministic and server-side:
 * counted evidence, recorded waivers and declared conditions in, verdict out.
 */
export async function evaluateJobCompliance(
  supabase: SupabaseClient,
  input: {
    companyId: string;
    serviceJobId: string;
    scope?: RrBlockingScope;
    at?: string;
  }
): Promise<RrServiceResult<JobComplianceOutcome>> {
  const at = input.at ?? new Date().toISOString();

  const { data: jobRow, error: jobError } = await supabase
    .from("rr_service_jobs")
    .select(
      "id,field_job_id,service_type_id,service_state,counterparty_id,casualty_flag,police_reference,destination_label,destination_address,destination_type,third_party_details"
    )
    .eq("company_id", input.companyId)
    .eq("id", input.serviceJobId)
    .maybeSingle();

  if (jobError) return fail(jobError.message, 500);
  if (!jobRow) return fail("Service job not found in this company.", 404);

  const job = jobRow as Row;

  const { data: typeRow } = await supabase
    .from("rr_service_types")
    .select("service_code")
    .eq("company_id", input.companyId)
    .eq("id", asText(job.service_type_id))
    .maybeSingle();

  const serviceCode = asText((typeRow as Row | null)?.service_code);

  const { requirements, error: reqError } = await loadJobRequirements(
    supabase,
    input.companyId,
    input.serviceJobId
  );
  if (reqError) return fail(reqError, 500);

  const { counts, error: countError } = await countEvidence(
    supabase,
    input.companyId,
    input.serviceJobId,
    asText(job.field_job_id),
    requirements,
    at
  );
  if (countError) return fail(countError, 500);

  const { waivers, error: waiverError } = await loadWaivers(
    supabase,
    input.companyId,
    input.serviceJobId
  );
  if (waiverError) return fail(waiverError, 500);

  // A converted BYSTAND has a conversion reason requirement; detect it from the job row.
  const converted = asText(job.service_state) === "converted_to_recovery";
  const facts = buildJobFacts(job, serviceCode, { converted_to_recovery: converted });

  const compliance = evaluateCompliance({
    requirements,
    evidenceCounts: counts,
    waivers,
    facts,
    scope: input.scope ?? "invoice",
    evaluatedAt: at,
    policyKey: requirements[0]?.policyKey ?? null,
    policyVersion: requirements[0]?.policyVersion ?? null,
  });

  return { ok: true, data: { compliance, requirements, facts } };
}

/** Evaluates AND persists the verdict as an immutable record. */
export async function recordComplianceEvaluation(
  supabase: SupabaseClient,
  input: {
    companyId: string;
    serviceJobId: string;
    actorEmail: string;
    scope?: RrBlockingScope;
  }
): Promise<RrServiceResult<{ evaluationId: string; compliance: RrComplianceResult }>> {
  const evaluated = await evaluateJobCompliance(supabase, {
    companyId: input.companyId,
    serviceJobId: input.serviceJobId,
    scope: input.scope,
  });
  if (!evaluated.ok) return evaluated;

  const { compliance } = evaluated.data;

  const { data: jobRow } = await supabase
    .from("rr_service_jobs")
    .select("service_state")
    .eq("company_id", input.companyId)
    .eq("id", input.serviceJobId)
    .maybeSingle();

  const { data, error } = await supabase
    .from("rr_compliance_evaluations")
    .insert({
      company_id: input.companyId,
      service_job_id: input.serviceJobId,
      status: compliance.status,
      evidence_complete: compliance.evidenceComplete,
      scope: compliance.scope,
      results: compliance.results,
      missing_codes: compliance.missing,
      waived_codes: compliance.waived,
      blocking_codes: compliance.blocking,
      satisfied_count: compliance.satisfiedCount,
      applicable_count: compliance.applicableCount,
      completeness_percent: compliance.completenessPercent,
      policy_key: compliance.policyKey,
      policy_version: compliance.policyVersion,
      engine_version: RR_COMPLIANCE_ENGINE_VERSION,
      job_state: asText((jobRow as Row | null)?.service_state) || null,
      evaluated_by: input.actorEmail,
      evaluated_at: compliance.evaluatedAt,
    })
    .select("id")
    .single();

  if (error || !data) return fail(error?.message || "Could not record the evaluation.", 500);

  return {
    ok: true,
    data: { evaluationId: asText((data as Row).id), compliance },
  };
}

// ---------------------------------------------------------------------------
// Evidence capture
// ---------------------------------------------------------------------------

/**
 * The capture CONTEXTS Road & Recovery writes. Not a second requirement vocabulary — the
 * requirement a item satisfies is rr_evidence_links.requirement_code (sql/086 explains why).
 */
export const RR_CAPTURE_EVIDENCE_TYPES = ["rr_requirement", "rr_custody"] as const;
export type RrCaptureEvidenceType = (typeof RR_CAPTURE_EVIDENCE_TYPES)[number];

/**
 * Records a captured evidence item against a job and links it to the requirements it
 * satisfies, in that order, as ONE operation.
 *
 * This is the way in that Road & Recovery never had. sql/072 built the repository, the
 * `rr-evidence` bucket and the link table, and sql/073 built the requirement snapshot the
 * link points at — but only BYSTAND ever had an endpoint that wrote to any of it, so a tow
 * job's requirements could be waived and never satisfied.
 *
 * It creates NO new storage of its own:
 *   - the bytes are already in the `rr-evidence` bucket, uploaded by the browser under the
 *     caller's own session and the tenant-path policy from sql/072. Only the PATH arrives
 *     here, which is why a forged path cannot reach another tenant's folder — the upload
 *     itself was refused long before this function ran.
 *   - the row goes to public.mobile_workforce_evidence, the existing repository
 *   - the requirement satisfaction goes to public.rr_evidence_links, the existing
 *     append-only link the compliance engine already counts
 *
 * Linking is best-effort by design and its outcome is REPORTED rather than thrown away: a
 * captured photograph is a fact, and refusing to record it because a requirement code was
 * mistyped would lose the evidence to protect the index. `skipped` names any code that is
 * not on this job's snapshot so the caller can say so.
 */
export async function captureJobEvidence(
  supabase: SupabaseClient,
  input: {
    companyId: string;
    actorEmail: string;
    employeeId: string;
    serviceJobId: string;
    fieldJobId: string;
    evidenceType: RrCaptureEvidenceType;
    capturedByRole: string;
    requirementCodes?: readonly string[];
    storagePath?: string | null;
    latitude?: number | null;
    longitude?: number | null;
    accuracy?: number | null;
    notes?: string | null;
    metadata?: Record<string, unknown>;
  }
): Promise<
  RrServiceResult<{ evidenceId: string; linked: string[]; skipped: string[]; linkError: string | null }>
> {
  if (!RR_CAPTURE_EVIDENCE_TYPES.includes(input.evidenceType)) {
    return fail(
      `"${input.evidenceType}" is not a Road & Recovery capture type. Use one of: ${RR_CAPTURE_EVIDENCE_TYPES.join(", ")}.`,
      400
    );
  }

  const codes = [...new Set((input.requirementCodes || []).map((code) => asText(code)).filter(Boolean))];

  // Nothing to hold and nothing to point at is not evidence, it is an empty row. A
  // recorded DETAIL (an engine number, a distance) legitimately has no file, so a note
  // counts — but at least one of the three has to be present.
  if (!input.storagePath && !input.notes && codes.length === 0) {
    return fail(
      "Evidence needs at least a stored file, a note, or the requirement it satisfies.",
      400
    );
  }

  const { data, error } = await supabase
    .from("mobile_workforce_evidence")
    .insert({
      company_id: input.companyId,
      employee_id: input.employeeId,
      job_id: input.fieldJobId,
      service_job_id: input.serviceJobId,
      evidence_type: input.evidenceType,
      storage_bucket: input.storagePath ? RR_EVIDENCE_BUCKET : null,
      storage_path: input.storagePath || null,
      latitude: input.latitude ?? null,
      longitude: input.longitude ?? null,
      gps_accuracy: input.accuracy ?? null,
      captured_by_role: input.capturedByRole,
      notes: input.notes || null,
      // The requirement codes are recorded here as well as in the link table. The link is
      // what compliance counts; this is what survives if a link is ever rejected, so the
      // row still says what the capture was FOR.
      metadata: { ...(input.metadata || {}), requirementCodes: codes },
      captured_at: new Date().toISOString(),
    })
    .select("id")
    .single();

  if (error || !data) return fail(error?.message || "Could not record the evidence.", 500);
  const evidenceId = asText((data as Row).id);

  let linked: string[] = [];
  let skipped: string[] = [];
  let linkError: string | null = null;

  if (codes.length > 0) {
    const link = await linkEvidenceToRequirements(supabase, {
      companyId: input.companyId,
      actorEmail: input.actorEmail,
      serviceJobId: input.serviceJobId,
      evidenceId,
      requirementCodes: codes,
    });
    if (link.ok) {
      linked = link.data.linked;
      skipped = link.data.skipped;
    } else {
      linkError = link.message;
      skipped = codes;
    }
  }

  await writeAuditLog(supabase, {
    companyId: input.companyId,
    userEmail: input.actorEmail,
    action: "create",
    entityType: "rr_evidence",
    entityId: evidenceId,
    metadata: {
      serviceJobId: input.serviceJobId,
      evidenceType: input.evidenceType,
      storagePath: input.storagePath || null,
      linked,
      skipped,
    },
  });

  return { ok: true, data: { evidenceId, linked, skipped, linkError } };
}

// ---------------------------------------------------------------------------
// Evidence linking
// ---------------------------------------------------------------------------

/**
 * Links a captured evidence item to one or more requirements.
 *
 * Many-to-many by design: a single plate photograph may satisfy both the registration
 * requirement and part of a condition set.
 */
export async function linkEvidenceToRequirements(
  supabase: SupabaseClient,
  input: {
    companyId: string;
    actorEmail: string;
    serviceJobId: string;
    evidenceId: string;
    requirementCodes: readonly string[];
  }
): Promise<RrServiceResult<{ linked: string[]; skipped: string[] }>> {
  if (input.requirementCodes.length === 0) {
    return fail("At least one requirement code is required.", 400);
  }

  const { requirements, error } = await loadJobRequirements(
    supabase,
    input.companyId,
    input.serviceJobId
  );
  if (error) return fail(error, 500);

  const byCode = new Map(requirements.map((entry) => [entry.requirementCode, entry]));
  const linked: string[] = [];
  const skipped: string[] = [];
  const rows: Row[] = [];

  for (const code of input.requirementCodes) {
    const requirement = byCode.get(code);
    if (!requirement) {
      skipped.push(code);
      continue;
    }
    linked.push(code);
    rows.push({
      company_id: input.companyId,
      service_job_id: input.serviceJobId,
      evidence_id: input.evidenceId,
      requirement_id: requirement.id,
      requirement_code: code,
      verification_status: "accepted",
      linked_by: input.actorEmail,
    });
  }

  if (rows.length === 0) {
    return fail(
      `None of the supplied requirement codes exist on this job: ${input.requirementCodes.join(", ")}.`,
      400
    );
  }

  const { error: insertError } = await supabase.from("rr_evidence_links").insert(rows);
  if (insertError) return fail(insertError.message, 400);

  return { ok: true, data: { linked, skipped } };
}

// ---------------------------------------------------------------------------
// Waivers
// ---------------------------------------------------------------------------

/**
 * Waives a requirement, with a reason and a named authoriser.
 *
 * The waiver satisfies the requirement so the job can proceed, and is simultaneously
 * reported in every compliance result — never silently.
 */
export async function waiveRequirement(
  supabase: SupabaseClient,
  input: {
    companyId: string;
    actorEmail: string;
    serviceJobId: string;
    requirementCode: string;
    reasonCode: string;
    reasonDetail?: string | null;
    exceptionId?: string | null;
  }
): Promise<RrServiceResult<{ waiverId: string }>> {
  const { requirements, error } = await loadJobRequirements(
    supabase,
    input.companyId,
    input.serviceJobId
  );
  if (error) return fail(error, 500);

  const requirement = requirements.find(
    (entry) => entry.requirementCode === input.requirementCode
  );
  if (!requirement) {
    return fail(`Requirement "${input.requirementCode}" does not exist on this job.`, 404);
  }

  const { data, error: insertError } = await supabase
    .from("rr_requirement_waivers")
    .insert({
      company_id: input.companyId,
      service_job_id: input.serviceJobId,
      requirement_id: requirement.id,
      requirement_code: input.requirementCode,
      reason_code: input.reasonCode,
      reason_detail: input.reasonDetail || null,
      waived_by: input.actorEmail,
      exception_id: input.exceptionId || null,
    })
    .select("id")
    .single();

  if (insertError || !data) {
    return fail(insertError?.message || "Could not record the waiver.", 400);
  }

  const waiverId = asText((data as Row).id);

  await writeAuditLog(supabase, {
    companyId: input.companyId,
    userEmail: input.actorEmail,
    action: "approve",
    entityType: "rr_requirement_waiver",
    entityId: waiverId,
    metadata: {
      serviceJobId: input.serviceJobId,
      requirementCode: input.requirementCode,
      reasonCode: input.reasonCode,
    },
  });

  return { ok: true, data: { waiverId } };
}

// ---------------------------------------------------------------------------
// Exceptions
// ---------------------------------------------------------------------------

export async function raiseJobException(
  supabase: SupabaseClient,
  input: {
    companyId: string;
    actorEmail: string;
    serviceJobId: string;
    exceptionCode: string;
    severity?: string;
    detail?: string | null;
    detectedBy?: string;
    requirementCode?: string | null;
  }
): Promise<RrServiceResult<{ exceptionId: string }>> {
  const { data: job } = await supabase
    .from("rr_service_jobs")
    .select("service_state")
    .eq("company_id", input.companyId)
    .eq("id", input.serviceJobId)
    .maybeSingle();

  if (!job) return fail("Service job not found in this company.", 404);

  const severity = input.severity || "medium";

  const { data, error } = await supabase
    .from("rr_job_exceptions")
    .insert({
      company_id: input.companyId,
      service_job_id: input.serviceJobId,
      exception_code: input.exceptionCode,
      severity,
      detail: input.detail || null,
      detected_by: input.detectedBy || "controller",
      detected_by_actor: input.actorEmail,
      state_at_detection: asText((job as Row).service_state) || null,
      requirement_code: input.requirementCode || null,
    })
    .select("id")
    .single();

  if (error || !data) return fail(error?.message || "Could not raise the exception.", 400);

  const exceptionId = asText((data as Row).id);

  // A serious exception is routed into the EXISTING approval queue rather than a new one.
  // public.workforce_automation_actions already carries the 'Escalate Exception' action
  // type, the Pending Approval lifecycle and the approval UI, so a controller reviews a
  // Road & Recovery escalation in the same place as every other prepared action. Building
  // a second action system would fragment the approval trail.
  if (severity === "high" || severity === "critical") {
    const { data: actionRow, error: actionError } = await supabase
      .from("workforce_automation_actions")
      .insert({
        company_id: input.companyId,
        action_type: "Escalate Exception",
        status: "Pending Approval",
        prepared_by: input.actorEmail,
        source_module: "Road & Recovery",
        reason: input.detail || `Road & Recovery exception: ${input.exceptionCode}`,
        payload_json: {
          exception_id: exceptionId,
          service_job_id: input.serviceJobId,
          exception_code: input.exceptionCode,
          severity,
          requirement_code: input.requirementCode || null,
          state_at_detection: asText((job as Row).service_state) || null,
        },
      })
      .select("id")
      .single();

    // Escalation is a notification concern. If the action queue rejects the row the
    // exception itself still stands — it is already recorded and already blocking.
    if (!actionError && actionRow) {
      await supabase
        .from("rr_job_exceptions")
        .update({ automation_action_id: asText((actionRow as Row).id) })
        .eq("company_id", input.companyId)
        .eq("id", exceptionId);
    }
  }

  await writeAuditLog(supabase, {
    companyId: input.companyId,
    userEmail: input.actorEmail,
    action: "create",
    entityType: "rr_job_exception",
    entityId: exceptionId,
    metadata: {
      serviceJobId: input.serviceJobId,
      exceptionCode: input.exceptionCode,
      severity,
      escalated: severity === "high" || severity === "critical",
    },
  });

  return { ok: true, data: { exceptionId } };
}

export async function resolveJobException(
  supabase: SupabaseClient,
  input: {
    companyId: string;
    actorEmail: string;
    exceptionId: string;
    resolutionStatus: "acknowledged" | "resolved" | "waived" | "cancelled";
    resolutionAction?: string | null;
    resolutionNotes?: string | null;
    waiverId?: string | null;
  }
): Promise<RrServiceResult<{ resolved: true }>> {
  const terminal = ["resolved", "waived"].includes(input.resolutionStatus);

  const { error } = await supabase
    .from("rr_job_exceptions")
    .update({
      resolution_status: input.resolutionStatus,
      resolution_action: input.resolutionAction || null,
      resolution_notes: input.resolutionNotes || null,
      resolved_by: terminal ? input.actorEmail : null,
      resolved_at: terminal ? new Date().toISOString() : null,
      waiver_id: input.waiverId || null,
      updated_at: new Date().toISOString(),
    })
    .eq("company_id", input.companyId)
    .eq("id", input.exceptionId);

  if (error) return fail(error.message, 400);

  await writeAuditLog(supabase, {
    companyId: input.companyId,
    userEmail: input.actorEmail,
    action: "update",
    entityType: "rr_job_exception",
    entityId: input.exceptionId,
    metadata: { resolutionStatus: input.resolutionStatus },
  });

  return { ok: true, data: { resolved: true } };
}

// ---------------------------------------------------------------------------
// Policy authoring
// ---------------------------------------------------------------------------

export type PolicyItemInput = {
  requirementCode: string;
  label: string;
  evidenceKind: string;
  mandatory?: boolean;
  condition?: RrCondition;
  minCount?: number;
  blockingScopes?: readonly string[];
  guidance?: string | null;
  sortOrder?: number;
};

/**
 * Publishes a NEW VERSION of a requirement policy.
 *
 * A policy is never edited in place. Editing one would silently change what past jobs
 * were measured against, and a compliance verdict already shown to an insurer would stop
 * reconciling with the rule that produced it. Instead the previous active version is
 * closed (active = false, effective_to = now) and a new version is opened. Jobs already
 * created keep their frozen snapshot and are unaffected either way.
 */
export async function publishRequirementPolicy(
  supabase: SupabaseClient,
  input: {
    companyId: string;
    actorEmail: string;
    policyKey: string;
    label?: string | null;
    notes?: string | null;
    counterpartyId?: string | null;
    serviceCode?: string | null;
    effectiveFrom?: string | null;
    items: readonly PolicyItemInput[];
  }
): Promise<RrServiceResult<{ policyId: string; policyKey: string; version: number; itemCount: number }>> {
  if (!/^[a-z0-9_]+$/.test(input.policyKey)) {
    return fail("A policy key may contain only lowercase letters, digits and underscores.", 400);
  }
  if (input.items.length === 0) {
    return fail("A policy must contain at least one requirement.", 400);
  }

  const seen = new Set<string>();
  for (const item of input.items) {
    const code = asText(item.requirementCode);
    if (!code) return fail("Every requirement needs a requirement code.", 400);
    if (seen.has(code)) return fail(`Requirement "${code}" is listed twice.`, 400);
    seen.add(code);
    if (!asText(item.label)) return fail(`Requirement "${code}" needs a label.`, 400);
  }

  const effectiveFrom = input.effectiveFrom || new Date().toISOString();

  // The highest version already published for this key, so versions never collide.
  const { data: existing, error: existingError } = await supabase
    .from("rr_requirement_policies")
    .select("id,version,active")
    .eq("company_id", input.companyId)
    .eq("policy_key", input.policyKey)
    .order("version", { ascending: false });

  if (existingError) return fail(existingError.message, 500);

  const rows = (existing || []) as Row[];
  const nextVersion = rows.length === 0 ? 1 : Number(rows[0].version) + 1;

  // Close the current version FIRST: a partial unique index permits only one active
  // version per key, so publishing before closing would be rejected.
  const activeRow = rows.find((row) => row.active === true);
  if (activeRow) {
    const { error: closeError } = await supabase
      .from("rr_requirement_policies")
      .update({ active: false, effective_to: effectiveFrom, updated_at: new Date().toISOString() })
      .eq("company_id", input.companyId)
      .eq("id", asText(activeRow.id));
    if (closeError) return fail(closeError.message, 500);
  }

  const { data: created, error: createError } = await supabase
    .from("rr_requirement_policies")
    .insert({
      company_id: input.companyId,
      policy_key: input.policyKey,
      counterparty_id: input.counterpartyId || null,
      service_code: input.serviceCode || null,
      version: nextVersion,
      active: true,
      effective_from: effectiveFrom,
      effective_to: null,
      label: input.label || null,
      notes: input.notes || null,
      created_by: input.actorEmail,
    })
    .select("id")
    .single();

  if (createError || !created) {
    return fail(createError?.message || "Could not publish the policy.", 400);
  }

  const policyId = asText((created as Row).id);

  const itemRows = input.items.map((item, index) => ({
    company_id: input.companyId,
    policy_id: policyId,
    requirement_code: asText(item.requirementCode),
    label: asText(item.label),
    evidence_kind: item.evidenceKind,
    mandatory: item.mandatory !== false,
    condition: item.condition ?? { always: true },
    min_count: Math.max(1, Number(item.minCount) || 1),
    blocking_scopes: item.blockingScopes && item.blockingScopes.length > 0
      ? item.blockingScopes
      : ["invoice"],
    guidance: item.guidance || null,
    sort_order: Number.isFinite(Number(item.sortOrder)) ? Number(item.sortOrder) : (index + 1) * 10,
  }));

  const { error: itemsError } = await supabase.from("rr_requirement_items").insert(itemRows);
  if (itemsError) {
    // Roll the empty policy back rather than leaving a version with no requirements,
    // which would resolve as "nothing is required" for every job it governs.
    await supabase
      .from("rr_requirement_policies")
      .delete()
      .eq("company_id", input.companyId)
      .eq("id", policyId);
    return fail(itemsError.message, 400);
  }

  await writeAuditLog(supabase, {
    companyId: input.companyId,
    userEmail: input.actorEmail,
    action: "create",
    entityType: "rr_requirement_policy",
    entityId: policyId,
    metadata: {
      policyKey: input.policyKey,
      version: nextVersion,
      counterpartyId: input.counterpartyId || null,
      serviceCode: input.serviceCode || null,
      itemCount: itemRows.length,
      supersededVersion: activeRow ? Number(activeRow.version) : null,
    },
  });

  return {
    ok: true,
    data: {
      policyId,
      policyKey: input.policyKey,
      version: nextVersion,
      itemCount: itemRows.length,
    },
  };
}

/**
 * Every policy version in the company, with its requirements. For the editor.
 *
 * Superseded versions are included deliberately: an auditor asking why a job from March
 * was measured a certain way needs to read the version that governed it, not only the
 * one active today.
 */
export async function listRequirementPolicies(
  supabase: SupabaseClient,
  companyId: string
): Promise<RrServiceResult<{ policies: RrRequirementPolicy[] }>> {
  const { policies, error } = await loadPolicies(supabase, companyId);
  if (error) return fail(error, 500);
  return { ok: true, data: { policies } };
}

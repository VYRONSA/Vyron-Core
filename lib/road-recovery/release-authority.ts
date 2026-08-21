/**
 * VYRON CORE — Road & Recovery release and disposal authority (Phase 4, Step 1).
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS RESOLVES
 * ---------------------------------------------------------------------------
 *
 * Two workflow guards that have been declared since Phase 0 and never answered:
 *
 *     release_authorisation_pending -> release_authorised   guards: release_authorised
 *     disposal_notice_issued        -> disposal_authorised  guards: disposal_authorised
 *
 * Guards fail closed, so both transitions were unreachable through the service layer —
 * the same defect Phase 3 closed for `evidence_complete`.
 *
 * ---------------------------------------------------------------------------
 * WHAT "AUTHORISED" MEANS
 * ---------------------------------------------------------------------------
 *
 * All four of these, or FALSE:
 *
 *   EXISTS      a rr_release_authorisations row for THIS job
 *   APPLICABLE  of the right authority_type — a release authority never satisfies
 *               disposal, and disposal never satisfies release
 *   VALID       status 'active', and the evaluation instant inside [valid_from, expires_at]
 *   VERIFIED    verified_at / verified_by set by a controller who checked it
 *
 * Recorded is not verified, and unexpired is not verified. An authority captured from a
 * phone call but never confirmed does not open a gate.
 *
 * The pure predicate below reads no clock and performs no I/O: the instant is passed in,
 * so a decision is reproducible from the stored row and the timestamp it was taken at.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

export const RR_AUTHORITY_TYPES = ["release", "disposal"] as const;
export type RrAuthorityType = (typeof RR_AUTHORITY_TYPES)[number];

export const RR_AUTHORITY_PARTIES = [
  "insurer",
  "owner",
  "finance_house",
  "fleet_operator",
  "saps",
  "court",
  "municipality",
] as const;
export type RrAuthorityParty = (typeof RR_AUTHORITY_PARTIES)[number];

/** The subset of an authority row the decision depends on. */
export type RrAuthorityRecord = {
  id: string;
  authorityType: RrAuthorityType;
  status: string;
  validFrom: string | null;
  expiresAt: string | null;
  verifiedAt: string | null;
  verifiedBy: string | null;
};

export type RrAuthorityDecision = {
  authorised: boolean;
  /** The row that carried the decision, when one did. */
  authorityId: string | null;
  /** Why, in words a controller can act on. */
  reason: string;
};

function withinWindow(record: RrAuthorityRecord, at: string): boolean {
  const instant = new Date(at).getTime();
  if (!Number.isFinite(instant)) return false;

  if (record.validFrom) {
    const from = new Date(record.validFrom).getTime();
    if (Number.isFinite(from) && instant < from) return false;
  }
  if (record.expiresAt) {
    const until = new Date(record.expiresAt).getTime();
    if (Number.isFinite(until) && instant > until) return false;
  }
  return true;
}

/**
 * PURE. Decides whether an authority of `type` is in force at `at`.
 *
 * Fails closed on every uncertainty: an empty list, an unparseable date, a status that is
 * not exactly 'active', or a row that was never verified all produce `authorised: false`.
 */
export function decideAuthority(
  records: readonly RrAuthorityRecord[],
  type: RrAuthorityType,
  at: string
): RrAuthorityDecision {
  const ofType = records.filter((record) => record.authorityType === type);

  if (ofType.length === 0) {
    return {
      authorised: false,
      authorityId: null,
      reason: `No ${type} authority has been recorded for this job.`,
    };
  }

  const active = ofType.filter((record) => record.status === "active");
  if (active.length === 0) {
    return {
      authorised: false,
      authorityId: null,
      reason: `Every ${type} authority on this job has been voided, expired or superseded.`,
    };
  }

  const inWindow = active.filter((record) => withinWindow(record, at));
  if (inWindow.length === 0) {
    return {
      authorised: false,
      authorityId: null,
      reason: `The ${type} authority on this job is not valid at this time.`,
    };
  }

  const verified = inWindow.find((record) => Boolean(record.verifiedAt && record.verifiedBy));
  if (!verified) {
    return {
      authorised: false,
      authorityId: null,
      reason: `The ${type} authority on this job has not been verified. Recording an authority is not the same as confirming it.`,
    };
  }

  return {
    authorised: true,
    authorityId: verified.id,
    reason: `A verified ${type} authority is in force.`,
  };
}

type Row = Record<string, unknown>;

function asText(value: unknown): string {
  return String(value ?? "").trim();
}

/**
 * Loads a job's authorities and decides. The I/O half.
 *
 * A read failure returns `authorised: false` rather than throwing, so a database problem
 * closes the gate instead of opening it.
 */
export async function resolveAuthorityGuard(
  supabase: SupabaseClient,
  input: {
    companyId: string;
    serviceJobId: string;
    authorityType: RrAuthorityType;
    at?: string;
  }
): Promise<RrAuthorityDecision> {
  const at = input.at ?? new Date().toISOString();

  const { data, error } = await supabase
    .from("rr_release_authorisations")
    .select("id,authority_type,status,valid_from,expires_at,verified_at,verified_by")
    .eq("company_id", input.companyId)
    .eq("service_job_id", input.serviceJobId)
    .eq("authority_type", input.authorityType);

  if (error) {
    return {
      authorised: false,
      authorityId: null,
      reason: `The ${input.authorityType} authority could not be read, so the action is refused.`,
    };
  }

  const records: RrAuthorityRecord[] = ((data || []) as Row[]).map((row) => ({
    id: asText(row.id),
    authorityType: asText(row.authority_type) as RrAuthorityType,
    status: asText(row.status),
    validFrom: row.valid_from ? asText(row.valid_from) : null,
    expiresAt: row.expires_at ? asText(row.expires_at) : null,
    verifiedAt: row.verified_at ? asText(row.verified_at) : null,
    verifiedBy: row.verified_by ? asText(row.verified_by) : null,
  }));

  return decideAuthority(records, input.authorityType, at);
}

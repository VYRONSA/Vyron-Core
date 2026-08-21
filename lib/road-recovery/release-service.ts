/**
 * VYRON CORE — Road & Recovery release and disposal authority service layer (Phase 4).
 *
 * The I/O half. The decision itself lives in lib/road-recovery/release-authority.ts and
 * is pure, so what opens a gate can be reasoned about without a database.
 *
 * ---------------------------------------------------------------------------
 * RECORDED IS NOT VERIFIED
 * ---------------------------------------------------------------------------
 *
 * An authority is created UNVERIFIED and opens nothing. Someone must positively check it
 * and say how — a phone call back to the insurer, a court order in hand, an ID matched
 * against the collector named on the authority. Only then do the guards see it.
 *
 * The verifier and the voider are taken from the SESSION, never from the request, so the
 * record always names a real person who accepted responsibility.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { writeAuditLog } from "@/lib/audit-log";
import type { RrServiceResult } from "@/lib/road-recovery/job-service";
import {
  RR_AUTHORITY_PARTIES,
  RR_AUTHORITY_TYPES,
  type RrAuthorityParty,
  type RrAuthorityType,
} from "@/lib/road-recovery/release-authority";

type Row = Record<string, unknown>;

function asText(value: unknown): string {
  return String(value ?? "").trim();
}

function fail(message: string, status = 400): { ok: false; status: number; message: string } {
  return { ok: false, status, message };
}

export type RecordAuthorityInput = {
  companyId: string;
  actorEmail: string;
  serviceJobId: string;
  authorityType: RrAuthorityType;
  authorityParty: RrAuthorityParty;
  authorityPartyName: string;
  authorityReference: string;
  counterpartyId?: string | null;
  authorityContact?: string | null;
  validFrom?: string | null;
  expiresAt?: string | null;
  /** Release only. */
  collectorName?: string | null;
  collectorIdNumber?: string | null;
  collectorCapacity?: string | null;
  collectorContact?: string | null;
  /** Disposal only. */
  disposalNoticeReference?: string | null;
  disposalNoticeServedAt?: string | null;
  disposalMethod?: string | null;
  evidenceId?: string | null;
  notes?: string | null;
};

/**
 * Records an authority, deliberately UNVERIFIED.
 *
 * Release and disposal are validated separately here as well as by CHECK constraints:
 * a release must name who is collecting, and a disposal must carry the notice that
 * preceded it. Disposal without a served notice is not an authority, it is a liability.
 */
export async function recordReleaseAuthority(
  supabase: SupabaseClient,
  input: RecordAuthorityInput
): Promise<RrServiceResult<{ authorityId: string }>> {
  if (!(RR_AUTHORITY_TYPES as readonly string[]).includes(input.authorityType)) {
    return fail(`"${input.authorityType}" is not a recognised authority type.`, 400);
  }
  if (!(RR_AUTHORITY_PARTIES as readonly string[]).includes(input.authorityParty)) {
    return fail(`"${input.authorityParty}" is not a recognised authorising party.`, 400);
  }
  if (!asText(input.authorityPartyName) || !asText(input.authorityReference)) {
    return fail("An authority must name who gave it and carry their reference.", 400);
  }
  if (input.authorityType === "release") {
    if (!asText(input.collectorName) || !asText(input.collectorCapacity)) {
      return fail(
        "A release authority must name the person collecting the vehicle and their capacity.",
        400
      );
    }
  }
  if (input.authorityType === "disposal") {
    if (!asText(input.disposalNoticeReference) || !asText(input.disposalNoticeServedAt)) {
      return fail(
        "A disposal authority must carry the notice reference and the date it was served.",
        400
      );
    }
  }

  const { data, error } = await supabase
    .from("rr_release_authorisations")
    .insert({
      company_id: input.companyId,
      service_job_id: input.serviceJobId,
      authority_type: input.authorityType,
      counterparty_id: input.counterpartyId || null,
      authority_party: input.authorityParty,
      authority_party_name: asText(input.authorityPartyName),
      authority_reference: asText(input.authorityReference),
      authority_contact: input.authorityContact || null,
      valid_from: input.validFrom || null,
      expires_at: input.expiresAt || null,
      status: "active",
      collector_name: input.collectorName || null,
      collector_id_number: input.collectorIdNumber || null,
      collector_capacity: input.collectorCapacity || null,
      collector_contact: input.collectorContact || null,
      disposal_notice_reference: input.disposalNoticeReference || null,
      disposal_notice_served_at: input.disposalNoticeServedAt || null,
      disposal_method: input.disposalMethod || null,
      evidence_id: input.evidenceId || null,
      notes: input.notes || null,
      created_by: input.actorEmail,
    })
    .select("id")
    .single();

  if (error || !data) return fail(error?.message || "Could not record the authority.", 400);

  const authorityId = asText((data as Row).id);

  await writeAuditLog(supabase, {
    companyId: input.companyId,
    userEmail: input.actorEmail,
    action: "create",
    entityType: "rr_release_authorisation",
    entityId: authorityId,
    metadata: {
      serviceJobId: input.serviceJobId,
      authorityType: input.authorityType,
      authorityParty: input.authorityParty,
      reference: input.authorityReference,
      verified: false,
    },
  });

  return { ok: true, data: { authorityId } };
}

/** Verifies an authority. This is the act that actually opens a gate. */
export async function verifyReleaseAuthority(
  supabase: SupabaseClient,
  input: {
    companyId: string;
    actorEmail: string;
    authorityId: string;
    verificationMethod: string;
  }
): Promise<RrServiceResult<{ verified: true }>> {
  if (!asText(input.verificationMethod)) {
    return fail("Verifying an authority must record how it was verified.", 400);
  }

  const { data, error } = await supabase
    .from("rr_release_authorisations")
    .update({
      verified_by: input.actorEmail,
      verified_at: new Date().toISOString(),
      verification_method: asText(input.verificationMethod),
      updated_at: new Date().toISOString(),
    })
    .eq("company_id", input.companyId)
    .eq("id", input.authorityId)
    .eq("status", "active")
    .select("id");

  if (error) return fail(error.message, 400);
  if (!data || (data as Row[]).length === 0) {
    return fail("That authority does not exist, or is no longer active.", 404);
  }

  await writeAuditLog(supabase, {
    companyId: input.companyId,
    userEmail: input.actorEmail,
    action: "approve",
    entityType: "rr_release_authorisation",
    entityId: input.authorityId,
    metadata: { verificationMethod: input.verificationMethod },
  });

  return { ok: true, data: { verified: true } };
}

/** Voids an authority. Never deleted — what was once authorised stays on the record. */
export async function voidReleaseAuthority(
  supabase: SupabaseClient,
  input: {
    companyId: string;
    actorEmail: string;
    authorityId: string;
    voidReason: string;
  }
): Promise<RrServiceResult<{ voided: true }>> {
  if (!asText(input.voidReason)) return fail("Voiding an authority requires a reason.", 400);

  const { error } = await supabase
    .from("rr_release_authorisations")
    .update({
      status: "void",
      void_reason: asText(input.voidReason),
      voided_at: new Date().toISOString(),
      voided_by: input.actorEmail,
      updated_at: new Date().toISOString(),
    })
    .eq("company_id", input.companyId)
    .eq("id", input.authorityId);

  if (error) return fail(error.message, 400);

  await writeAuditLog(supabase, {
    companyId: input.companyId,
    userEmail: input.actorEmail,
    action: "update",
    entityType: "rr_release_authorisation",
    entityId: input.authorityId,
    metadata: { voided: true, reason: input.voidReason },
  });

  return { ok: true, data: { voided: true } };
}

/** Every authority on a job, for the release panel. */
export async function listReleaseAuthorities(
  supabase: SupabaseClient,
  companyId: string,
  serviceJobId: string
): Promise<RrServiceResult<{ authorities: Row[] }>> {
  const { data, error } = await supabase
    .from("rr_release_authorisations")
    .select(
      "id,authority_type,authority_party,authority_party_name,authority_reference,issued_at,valid_from,expires_at,status,verified_by,verified_at,verification_method,collector_name,collector_capacity,collector_id_number,disposal_notice_reference,disposal_notice_served_at,disposal_method,void_reason,voided_at"
    )
    .eq("company_id", companyId)
    .eq("service_job_id", serviceJobId)
    .order("issued_at", { ascending: false });

  if (error) return fail("Could not load release authorities.", 500);
  return { ok: true, data: { authorities: (data || []) as Row[] } };
}

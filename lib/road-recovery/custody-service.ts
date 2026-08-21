/**
 * VYRON CORE — Road & Recovery chain of custody service layer (Phase 4, Step 2).
 *
 * ---------------------------------------------------------------------------
 * THE ONE RULE
 * ---------------------------------------------------------------------------
 *
 * rr_custody_events is the record. Everything else — the holdings projection, the items
 * list, a screen — is a convenience derived from it. Nothing here ever edits an event:
 * a correction is a new event, and the log keeps both.
 *
 * ---------------------------------------------------------------------------
 * WHO MAY TAKE CUSTODY
 * ---------------------------------------------------------------------------
 *
 * Read from the service type's `requires_custody` capability flag, which Phase 0 already
 * carries and already forces to false for BYSTAND. The check is therefore generic — no
 * function here asks "is this a bystand job", and a future service that must not take
 * custody is protected the moment its flag says so.
 *
 * Timestamps are SERVER-stamped. A custody timestamp a client can set is a custody
 * timestamp a client can move.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { writeAuditLog } from "@/lib/audit-log";
import type { RrServiceResult } from "@/lib/road-recovery/job-service";

type Row = Record<string, unknown>;

function asText(value: unknown): string {
  return String(value ?? "").trim();
}

function fail(message: string, status = 400): { ok: false; status: number; message: string } {
  return { ok: false, status, message };
}

export const RR_CUSTODY_EVENT_TYPES = ["taken", "transferred", "released", "disputed"] as const;
export type RrCustodyEventType = (typeof RR_CUSTODY_EVENT_TYPES)[number];

export const RR_CUSTODY_HOLDER_TYPES = [
  "operator",
  "yard",
  "owner",
  "insurer",
  "finance_house",
  "fleet_operator",
  "saps",
  "third_party",
  "disposal_agent",
] as const;
export type RrCustodyHolderType = (typeof RR_CUSTODY_HOLDER_TYPES)[number];

export const RR_CUSTODY_ITEM_TYPES = [
  "key",
  "document",
  "belonging",
  "accessory",
  "tools",
  "number_plate",
] as const;

// ---------------------------------------------------------------------------
// Capability
// ---------------------------------------------------------------------------

export type JobCustodyCapability = {
  serviceCode: string;
  workflowKey: string;
  requiresCustody: boolean;
  requiresStorage: boolean;
};

/**
 * Reads what this job's SERVICE TYPE is allowed to do.
 *
 * Generic by construction: the answer comes from the capability flags on
 * rr_service_types, never from the service code. BYSTAND is protected because Phase 0
 * pinned its flags to false and a CHECK constraint keeps them there.
 */
export async function loadJobCapability(
  supabase: SupabaseClient,
  companyId: string,
  serviceJobId: string
): Promise<RrServiceResult<JobCustodyCapability>> {
  const { data: job, error } = await supabase
    .from("rr_service_jobs")
    .select("id, service_type_id, workflow_key")
    .eq("company_id", companyId)
    .eq("id", serviceJobId)
    .maybeSingle();

  if (error) return fail(error.message, 500);
  if (!job) return fail("Service job not found in this company.", 404);

  const { data: type, error: typeError } = await supabase
    .from("rr_service_types")
    .select("service_code, requires_custody, requires_storage")
    .eq("company_id", companyId)
    .eq("id", asText((job as Row).service_type_id))
    .maybeSingle();

  if (typeError) return fail(typeError.message, 500);
  if (!type) return fail("The service type for this job could not be resolved.", 500);

  return {
    ok: true,
    data: {
      serviceCode: asText((type as Row).service_code),
      workflowKey: asText((job as Row).workflow_key),
      requiresCustody: (type as Row).requires_custody === true,
      requiresStorage: (type as Row).requires_storage === true,
    },
  };
}

function custodyRefusal(capability: JobCustodyCapability): { ok: false; status: number; message: string } {
  return fail(
    `The ${capability.serviceCode.replace(/_/g, " ")} service does not take custody of a vehicle, so no custody record can be created for this job.`,
    409
  );
}

// ---------------------------------------------------------------------------
// Yards
// ---------------------------------------------------------------------------

export async function listCustodyYards(
  supabase: SupabaseClient,
  companyId: string,
  options: { activeOnly?: boolean } = {}
): Promise<RrServiceResult<{ yards: Row[] }>> {
  let query = supabase
    .from("rr_custody_yards")
    .select(
      "id,yard_code,name,address,latitude,longitude,security_level,covered,capacity,operating_hours,contact_name,contact_number,active"
    )
    .eq("company_id", companyId)
    .order("name");

  if (options.activeOnly !== false) query = query.eq("active", true);

  const { data, error } = await query;
  if (error) return fail("Could not load storage yards.", 500);
  return { ok: true, data: { yards: (data || []) as Row[] } };
}

export async function createCustodyYard(
  supabase: SupabaseClient,
  input: {
    companyId: string;
    actorEmail: string;
    yardCode: string;
    name: string;
    address?: string | null;
    latitude?: number | null;
    longitude?: number | null;
    securityLevel?: string;
    covered?: boolean;
    capacity?: number | null;
    operatingHours?: string | null;
    contactName?: string | null;
    contactNumber?: string | null;
  }
): Promise<RrServiceResult<{ yardId: string }>> {
  if (!/^[A-Za-z0-9_-]+$/.test(input.yardCode)) {
    return fail("A yard code may contain only letters, digits, hyphens and underscores.", 400);
  }
  if (!input.name.trim()) return fail("A yard needs a name.", 400);

  const { data, error } = await supabase
    .from("rr_custody_yards")
    .insert({
      company_id: input.companyId,
      yard_code: input.yardCode,
      name: input.name.trim(),
      address: input.address || null,
      latitude: input.latitude ?? null,
      longitude: input.longitude ?? null,
      security_level: input.securityLevel || "secure",
      covered: input.covered === true,
      capacity: input.capacity ?? null,
      operating_hours: input.operatingHours || null,
      contact_name: input.contactName || null,
      contact_number: input.contactNumber || null,
      created_by: input.actorEmail,
    })
    .select("id")
    .single();

  if (error || !data) {
    // A yard code collides with an existing one far more often than anything else here,
    // and the operator was being shown the raw PostgreSQL text —
    // 'duplicate key value violates unique constraint "rr_custody_yards_code_unique"' —
    // which names an internal object and does not say what to do about it.
    if (error && (error.code === "23505" || /duplicate key value/i.test(error.message))) {
      return fail(`Yard code "${input.yardCode}" is already in use in this workspace.`, 409);
    }
    return fail(error?.message || "Could not create the yard.", 400);
  }

  const yardId = asText((data as Row).id);
  await writeAuditLog(supabase, {
    companyId: input.companyId,
    userEmail: input.actorEmail,
    action: "create",
    entityType: "rr_custody_yard",
    entityId: yardId,
    metadata: { yardCode: input.yardCode, name: input.name },
  });

  return { ok: true, data: { yardId } };
}

// ---------------------------------------------------------------------------
// Custody events
// ---------------------------------------------------------------------------

export type RecordCustodyEventInput = {
  companyId: string;
  actorEmail: string;
  serviceJobId: string;
  eventType: RrCustodyEventType;
  holderType: RrCustodyHolderType;
  holderName: string;
  yardId?: string | null;
  actorEmployeeId?: string | null;
  actorRole?: string;
  receivingPartyName?: string | null;
  receivingPartyCapacity?: string | null;
  receivingPartyIdNumber?: string | null;
  receivingPartyContact?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  locationLabel?: string | null;
  authorityId?: string | null;
  evidenceId?: string | null;
  reason?: string | null;
  notes?: string | null;
};

/**
 * Appends one custody event and lets the trigger re-project the current holding.
 *
 * A `released` event ends the chain, so it is refused unless the receiving party is
 * named with a stated capacity — the database enforces the same rule, and both layers
 * are deliberate: the message here is useful, the constraint there is unavoidable.
 */
export async function recordCustodyEvent(
  supabase: SupabaseClient,
  input: RecordCustodyEventInput
): Promise<RrServiceResult<{ eventId: string; holderType: string; holderName: string }>> {
  const capability = await loadJobCapability(supabase, input.companyId, input.serviceJobId);
  if (!capability.ok) return capability;
  if (!capability.data.requiresCustody) return custodyRefusal(capability.data);

  if (!(RR_CUSTODY_EVENT_TYPES as readonly string[]).includes(input.eventType)) {
    return fail(`"${input.eventType}" is not a recognised custody event.`, 400);
  }
  if (!(RR_CUSTODY_HOLDER_TYPES as readonly string[]).includes(input.holderType)) {
    return fail(`"${input.holderType}" is not a recognised custody holder.`, 400);
  }
  if (!asText(input.holderName)) {
    return fail("A custody event must name who holds the vehicle.", 400);
  }
  if (input.holderType === "yard" && !asText(input.yardId)) {
    return fail("Custody resting at a yard must say which yard.", 400);
  }
  if (input.eventType === "released") {
    if (!asText(input.receivingPartyName) || !asText(input.receivingPartyCapacity)) {
      return fail(
        "A release must name the person receiving the vehicle and the capacity they receive it in.",
        400
      );
    }
  }
  if (input.eventType === "disputed" && !asText(input.reason)) {
    return fail("A disputed custody event must record what is disputed.", 400);
  }

  const { data, error } = await supabase
    .from("rr_custody_events")
    .insert({
      company_id: input.companyId,
      service_job_id: input.serviceJobId,
      event_type: input.eventType,
      // occurred_at is left to the database default: server-stamped, never supplied.
      actor_email: input.actorEmail,
      actor_employee_id: input.actorEmployeeId || null,
      actor_role: input.actorRole || "controller",
      holder_type: input.holderType,
      holder_name: asText(input.holderName),
      yard_id: input.yardId || null,
      receiving_party_name: input.receivingPartyName || null,
      receiving_party_capacity: input.receivingPartyCapacity || null,
      receiving_party_id_number: input.receivingPartyIdNumber || null,
      receiving_party_contact: input.receivingPartyContact || null,
      latitude: input.latitude ?? null,
      longitude: input.longitude ?? null,
      location_label: input.locationLabel || null,
      authority_id: input.authorityId || null,
      evidence_id: input.evidenceId || null,
      reason: input.reason || null,
      notes: input.notes || null,
    })
    .select("id")
    .single();

  if (error || !data) return fail(error?.message || "Could not record the custody event.", 400);

  const eventId = asText((data as Row).id);

  await writeAuditLog(supabase, {
    companyId: input.companyId,
    userEmail: input.actorEmail,
    action: "create",
    entityType: "rr_custody_event",
    entityId: eventId,
    metadata: {
      serviceJobId: input.serviceJobId,
      eventType: input.eventType,
      holderType: input.holderType,
      receivingParty: input.receivingPartyName || null,
    },
  });

  return {
    ok: true,
    data: { eventId, holderType: input.holderType, holderName: asText(input.holderName) },
  };
}

/** The full chain plus the current holding. The chain is what matters; the rest is derived. */
export async function getCustodyChain(
  supabase: SupabaseClient,
  companyId: string,
  serviceJobId: string
): Promise<RrServiceResult<{ events: Row[]; holding: Row | null; items: Row[] }>> {
  const [eventsRes, holdingRes, itemsRes] = await Promise.all([
    supabase
      .from("rr_custody_events")
      .select(
        "id,event_type,occurred_at,actor_email,actor_role,holder_type,holder_name,yard_id,receiving_party_name,receiving_party_capacity,receiving_party_id_number,latitude,longitude,location_label,authority_id,evidence_id,reason,notes"
      )
      .eq("company_id", companyId)
      .eq("service_job_id", serviceJobId)
      .order("occurred_at", { ascending: true }),
    supabase
      .from("rr_custody_holdings")
      .select("holder_type,holder_name,yard_id,released,since,event_count")
      .eq("company_id", companyId)
      .eq("service_job_id", serviceJobId)
      .maybeSingle(),
    supabase
      .from("rr_custody_items")
      .select(
        "id,item_type,description,quantity,item_condition,received_at,handed_over_at,handed_over_to_name,handed_over_to_capacity,notes"
      )
      .eq("company_id", companyId)
      .eq("service_job_id", serviceJobId)
      .order("item_type"),
  ]);

  if (eventsRes.error) return fail("Could not load the custody chain.", 500);

  return {
    ok: true,
    data: {
      events: (eventsRes.data || []) as Row[],
      holding: (holdingRes.data as Row | null) ?? null,
      items: (itemsRes.data || []) as Row[],
    },
  };
}

// ---------------------------------------------------------------------------
// Keys, documents, belongings
// ---------------------------------------------------------------------------

export async function recordCustodyItem(
  supabase: SupabaseClient,
  input: {
    companyId: string;
    actorEmail: string;
    serviceJobId: string;
    itemType: string;
    description: string;
    quantity?: number;
    itemCondition?: string | null;
    receivedEventId?: string | null;
    evidenceId?: string | null;
    notes?: string | null;
  }
): Promise<RrServiceResult<{ itemId: string }>> {
  const capability = await loadJobCapability(supabase, input.companyId, input.serviceJobId);
  if (!capability.ok) return capability;
  if (!capability.data.requiresCustody) return custodyRefusal(capability.data);

  if (!(RR_CUSTODY_ITEM_TYPES as readonly string[]).includes(input.itemType)) {
    return fail(`"${input.itemType}" is not a recognised custody item type.`, 400);
  }
  if (!asText(input.description)) return fail("A custody item needs a description.", 400);

  const { data, error } = await supabase
    .from("rr_custody_items")
    .insert({
      company_id: input.companyId,
      service_job_id: input.serviceJobId,
      item_type: input.itemType,
      description: asText(input.description),
      quantity: Math.max(1, Number(input.quantity) || 1),
      item_condition: input.itemCondition || null,
      received_event_id: input.receivedEventId || null,
      evidence_id: input.evidenceId || null,
      notes: input.notes || null,
      created_by: input.actorEmail,
    })
    .select("id")
    .single();

  if (error || !data) return fail(error?.message || "Could not record the item.", 400);
  return { ok: true, data: { itemId: asText((data as Row).id) } };
}

/**
 * Records that an item left with someone.
 *
 * The recipient and the moment are captured together, because "did we return the spare
 * key" is only answerable if both are on the row.
 */
export async function handOverCustodyItem(
  supabase: SupabaseClient,
  input: {
    companyId: string;
    actorEmail: string;
    itemId: string;
    handedOverEventId?: string | null;
    handedOverToName: string;
    handedOverToCapacity: string;
  }
): Promise<RrServiceResult<{ handedOver: true }>> {
  if (!asText(input.handedOverToName) || !asText(input.handedOverToCapacity)) {
    return fail("Handing over an item must name who took it and in what capacity.", 400);
  }

  const { error } = await supabase
    .from("rr_custody_items")
    .update({
      handed_over_event_id: input.handedOverEventId || null,
      handed_over_at: new Date().toISOString(),
      handed_over_to_name: asText(input.handedOverToName),
      handed_over_to_capacity: asText(input.handedOverToCapacity),
      updated_at: new Date().toISOString(),
    })
    .eq("company_id", input.companyId)
    .eq("id", input.itemId);

  if (error) return fail(error.message, 400);

  await writeAuditLog(supabase, {
    companyId: input.companyId,
    userEmail: input.actorEmail,
    action: "update",
    entityType: "rr_custody_item",
    entityId: input.itemId,
    metadata: { handedOverTo: input.handedOverToName, capacity: input.handedOverToCapacity },
  });

  return { ok: true, data: { handedOver: true } };
}

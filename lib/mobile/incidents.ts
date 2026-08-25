/**
 * Employee incident reporting.
 *
 * HOW THIS IS EXACTLY-ONCE WITHOUT A SECOND RECEIPT SYSTEM
 *
 *   Road & Recovery mutations claim a row in rr_operation_receipts, keyed by a
 *   client-generated operation id (sql/095). That machinery exists because a
 *   transition has no natural key — "move job X to en_route" looks identical
 *   whether it is the first attempt or the fifth.
 *
 *   An incident does have a natural key: the incident itself. So the outbox's
 *   operationId becomes the incident's PRIMARY KEY, and the insert is
 *   ON CONFLICT (id) DO NOTHING. A retry carrying the same id cannot create a
 *   second incident, because the primary key will not permit it — the same
 *   principle as the receipt table (client-generated id, database-arbitrated
 *   uniqueness) using the row that already exists rather than a parallel one.
 *
 *   This is deliberately NOT a second idempotency mechanism. It is the same
 *   contract, honoured by the table the data lives in.
 *
 * TWO CLOCKS
 *
 *   `occurred_at` is what the employee says. `created_at` is when the server
 *   received it. An incident written up in a dead zone and synced two hours
 *   later must not read as having happened when the signal returned, and a
 *   client must never be able to move the server's own record of receipt.
 *   See the column comments in sql/096.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

export const RR_INCIDENT_CATEGORIES = [
  "accident",
  "injury",
  "near_miss",
  "vehicle",
  "equipment_damage",
  "unsafe_condition",
  "security",
  "environmental",
  "customer",
  "other",
] as const;

export const RR_INCIDENT_SEVERITIES = ["low", "medium", "high", "critical"] as const;

export type RrIncidentCategory = (typeof RR_INCIDENT_CATEGORIES)[number];
export type RrIncidentSeverity = (typeof RR_INCIDENT_SEVERITIES)[number];

/** What an employee is shown, in their words rather than the database's. */
export const RR_INCIDENT_CATEGORY_LABELS: Record<RrIncidentCategory, string> = {
  accident: "Accident",
  injury: "Injury",
  near_miss: "Near miss",
  vehicle: "Vehicle incident",
  equipment_damage: "Equipment damage",
  unsafe_condition: "Unsafe condition",
  security: "Security incident",
  environmental: "Environmental incident",
  customer: "Customer incident",
  other: "Something else",
};

export const RR_INCIDENT_SEVERITY_LABELS: Record<RrIncidentSeverity, string> = {
  low: "Minor",
  medium: "Moderate",
  high: "Serious",
  critical: "Critical",
};

export type RrIncidentInput = {
  /** The outbox operation id, reused as the incident's primary key. */
  incidentId: string;
  companyId: string;
  employeeId: string;
  title: string;
  description: string;
  category: string | null;
  severity: string | null;
  latitude: number | null;
  longitude: number | null;
  gpsAccuracy: number | null;
  /** The employee's assertion of when it happened. */
  occurredAt: string | null;
  peopleInvolved: string | null;
  immediateDanger: boolean;
  emergencyRequired: boolean;
  metadata: Record<string, unknown>;
};

export type RrIncidentResult =
  | { ok: true; incidentId: string; created: boolean }
  | { ok: false; error: string; status: number };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function categoryOrNull(value: string | null): RrIncidentCategory | null {
  const text = String(value || "").trim().toLowerCase();
  return (RR_INCIDENT_CATEGORIES as readonly string[]).includes(text)
    ? (text as RrIncidentCategory)
    : null;
}

function severityOrNull(value: string | null): RrIncidentSeverity | null {
  const text = String(value || "").trim().toLowerCase();
  return (RR_INCIDENT_SEVERITIES as readonly string[]).includes(text)
    ? (text as RrIncidentSeverity)
    : null;
}

/**
 * A position is either real or absent.
 *
 * The same rule the Road & Recovery arrival path enforces: never fabricate
 * coordinates, and never report accuracy 0 to mean "we do not know", because 0
 * reads as a perfect fix.
 */
function positionOrNull(latitude: number | null, longitude: number | null) {
  const hasBoth =
    typeof latitude === "number" && Number.isFinite(latitude) &&
    typeof longitude === "number" && Number.isFinite(longitude);
  return hasBoth ? { latitude, longitude } : { latitude: null, longitude: null };
}

/**
 * Files an incident. Safe to call repeatedly with the same incidentId.
 *
 * `companyId` and `employeeId` come from the already-verified session; nothing
 * here is taken from a client's claim about who it is.
 */
export async function reportIncident(
  supabase: SupabaseClient,
  input: RrIncidentInput
): Promise<RrIncidentResult> {
  if (!UUID_RE.test(input.incidentId)) {
    return { ok: false, error: "A valid incident reference is required.", status: 400 };
  }

  const description = String(input.description || "").trim();
  if (!description) {
    return { ok: false, error: "Please describe what happened.", status: 400 };
  }

  const position = positionOrNull(input.latitude, input.longitude);
  const accuracy =
    position.latitude !== null &&
    typeof input.gpsAccuracy === "number" &&
    Number.isFinite(input.gpsAccuracy) &&
    input.gpsAccuracy >= 0
      ? input.gpsAccuracy
      : null;

  const category = categoryOrNull(input.category);

  /**
   * The list a control room reads. A title is generated when the employee did
   * not type one, because forcing a headline out of somebody standing next to
   * an injured colleague is the wrong trade.
   */
  const title =
    String(input.title || "").trim() ||
    `${category ? RR_INCIDENT_CATEGORY_LABELS[category] : "Incident"} reported`;

  const { data, error } = await supabase
    .from("mobile_workforce_incidents")
    .insert({
      id: input.incidentId,
      company_id: input.companyId,
      employee_id: input.employeeId,
      title: title.slice(0, 200),
      description,
      category,
      severity: severityOrNull(input.severity),
      latitude: position.latitude,
      longitude: position.longitude,
      gps_accuracy: accuracy,
      occurred_at: input.occurredAt,
      people_involved: String(input.peopleInvolved || "").trim() || null,
      immediate_danger: input.immediateDanger === true,
      emergency_required: input.emergencyRequired === true,
      metadata: input.metadata || {},
      status: "submitted",
    })
    .select("id")
    .maybeSingle();

  if (error) {
    /**
     * A duplicate primary key means this exact incident is already filed — the
     * retry succeeded the first time and the response was lost. That is the
     * happy path for a queued report, not a failure.
     */
    const code = (error as { code?: string }).code;
    if (code === "23505") {
      return { ok: true, incidentId: input.incidentId, created: false };
    }
    return { ok: false, error: "Could not file this report. It is still saved on your device.", status: 503 };
  }

  return {
    ok: true,
    incidentId: data ? String((data as { id: string }).id) : input.incidentId,
    created: true,
  };
}

/**
 * How urgent this is, for ordering a control room's list.
 *
 * Deterministic and explainable — an operator can always be told why something
 * is at the top. Danger and emergency outrank severity, because somebody still
 * being at risk outranks how bad the outcome already was.
 */
export function incidentPriority(input: {
  immediateDanger: boolean;
  emergencyRequired: boolean;
  severity: string | null;
}): number {
  let score = 0;
  if (input.emergencyRequired) score += 100;
  if (input.immediateDanger) score += 60;
  score += { critical: 40, high: 25, medium: 10, low: 0 }[String(input.severity || "")] ?? 0;
  return score;
}

/** One line telling an operator why this incident is where it is in the list. */
export function incidentUrgencyReason(input: {
  immediateDanger: boolean;
  emergencyRequired: boolean;
  severity: string | null;
}): string {
  if (input.emergencyRequired) return "Emergency services requested.";
  if (input.immediateDanger) return "Somebody may still be in danger.";
  const severity = severityOrNull(input.severity);
  if (severity === "critical" || severity === "high") {
    return `Reported as ${RR_INCIDENT_SEVERITY_LABELS[severity].toLowerCase()}.`;
  }
  return "Reported for review.";
}

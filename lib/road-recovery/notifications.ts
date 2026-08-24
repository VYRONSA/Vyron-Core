/**
 * Road & Recovery operational notifications.
 *
 * NOT a new notification system. Every row lands in `mobile_workforce_notifications`
 * (sql/031) — the tenant-scoped table the mobile workforce module already uses. Its RLS
 * policy is `company_id IN vyron_user_company_ids()`, and `authenticated` holds
 * SELECT/INSERT/UPDATE, so these writes go through the CALLER'S own client under RLS.
 * No service-role client, no second table, no external provider.
 *
 * Two audiences, distinguished by a column the table already has:
 *
 *   employee_id = <uuid>   one driver's inbox
 *   employee_id = NULL     the control room — dispatchers are not always employees, and
 *                          a null recipient is the table's own "everyone in this tenant"
 *
 * `metadata` carries the deep link. A notification that says "New job assigned" and then
 * makes the driver hunt for the job has failed; `href` takes them straight to it.
 *
 * FAIL-SOFT BY DESIGN. A notification is a side effect of an operational write, never a
 * precondition for it. If the insert fails, the dispatch still happened and the driver
 * still sees the job on their board at the next poll — so these helpers report failure to
 * the caller and never throw.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * The operational events worth telling someone about.
 *
 * Kept as a closed vocabulary so the UI can style and route each one, and so a typo
 * cannot silently create an unroutable notification type.
 */
export const RR_NOTIFICATION_TYPES = [
  "rr_assignment_offered",
  "rr_assignment_reassigned",
  "rr_assignment_cancelled",
  "rr_assignment_accepted",
  "rr_assignment_declined",
  "rr_priority_changed",
  "rr_location_changed",
  "rr_authorisation_received",
  "rr_bystand_requested",
  "rr_driver_en_route",
  "rr_driver_arrived",
  "rr_job_waiting",
  "rr_job_escalated",
  "rr_control_room_message",
  "rr_evidence_requested",
  "rr_job_completed",
  "rr_job_returned_for_review",
] as const;

export type RrNotificationType = (typeof RR_NOTIFICATION_TYPES)[number];

/**
 * `mobile_workforce_notifications.notification_type` is CONSTRAINED.
 *
 * sql/031 pins it to a seven-value vocabulary, so an `rr_*` value is rejected by
 * `mobile_workforce_notifications_type_check` — verified against both the local QA
 * database and production. Widening that CHECK would be a schema change, and this phase
 * is explicitly schema-frozen.
 *
 * So the stored type is the closest ALLOWED value, and the precise Road & Recovery event
 * travels in `metadata.rrEvent`, with `metadata.module` marking the row as ours. The
 * jsonb column carries no constraint, the UI reads `rrEvent`, and the mobile workforce
 * module keeps seeing a vocabulary it understands.
 *
 * If the three-gate migration is ever approved, adding the rr_* values to the CHECK lets
 * this mapping collapse to the identity function without touching any call site.
 */
const ALLOWED_BASE_TYPES = [
  "new_job", "leave_decision", "roster_change", "hr_notice", "urgent_task",
  "incident_alert", "general",
] as const;

export type RrNotificationBaseType = (typeof ALLOWED_BASE_TYPES)[number];

/** Marker so an R&R query can find its own rows among the module's other traffic. */
export const RR_NOTIFICATION_MODULE = "road_recovery";

export function rrNotificationBaseType(event: RrNotificationType): RrNotificationBaseType {
  switch (event) {
    case "rr_assignment_offered":
    case "rr_assignment_reassigned":
      return "new_job";
    case "rr_assignment_declined":
    case "rr_assignment_cancelled":
    case "rr_job_escalated":
    case "rr_bystand_requested":
    case "rr_evidence_requested":
    case "rr_job_returned_for_review":
      return "urgent_task";
    case "rr_priority_changed":
    case "rr_location_changed":
      return "incident_alert";
    default:
      return "general";
  }
}

/** Deep-link payload stored in `metadata`, so every notification is actionable. */
export type RrNotificationMetadata = {
  serviceJobId?: string | null;
  assignmentId?: string | null;
  jobRef?: string | null;
  /** Where tapping the notification should take the recipient. */
  href?: string | null;
  /** Free-form extras (priority, decline reason, elapsed minutes …). */
  [key: string]: unknown;
};

export type RrNotificationInput = {
  companyId: string;
  /** The driver's employees.id, or null to address the control room. */
  employeeId?: string | null;
  type: RrNotificationType;
  title: string;
  body?: string | null;
  metadata?: RrNotificationMetadata;
};

export type RrNotificationResult = { ok: true; inserted: number } | { ok: false; error: string };

/** The route a recipient should land on for a given job, by audience. */
export function rrNotificationHref(
  audience: "driver" | "control-room",
  serviceJobId?: string | null
): string {
  if (audience === "driver") {
    return serviceJobId ? `/road-recovery/driver?job=${serviceJobId}` : "/road-recovery/driver";
  }
  return serviceJobId ? `/road-recovery/dispatch?job=${serviceJobId}` : "/road-recovery/dispatch";
}

function toRow(input: RrNotificationInput) {
  return {
    company_id: input.companyId,
    employee_id: input.employeeId || null,
    // The constrained column takes the mapped base type; the real event goes to metadata.
    notification_type: rrNotificationBaseType(input.type),
    title: input.title,
    body: input.body || null,
    metadata: {
      ...(input.metadata || {}),
      module: RR_NOTIFICATION_MODULE,
      rrEvent: input.type,
    } as Record<string, unknown>,
  };
}

/**
 * Writes notifications through the caller's RLS-scoped client.
 *
 * Returns rather than throws: see the fail-soft note above. The caller decides whether a
 * failure is worth surfacing, and for every current call site it is not — the operational
 * write already succeeded.
 */
export async function emitRrNotifications(
  supabase: SupabaseClient,
  inputs: RrNotificationInput[]
): Promise<RrNotificationResult> {
  const rows = inputs.filter((input) => input.companyId && input.title).map(toRow);
  if (rows.length === 0) return { ok: true, inserted: 0 };

  try {
    const { error } = await supabase.from("mobile_workforce_notifications").insert(rows);
    if (error) return { ok: false, error: error.message };
    return { ok: true, inserted: rows.length };
  } catch (caught: unknown) {
    return { ok: false, error: caught instanceof Error ? caught.message : "Notification failed." };
  }
}

export async function emitRrNotification(
  supabase: SupabaseClient,
  input: RrNotificationInput
): Promise<RrNotificationResult> {
  return emitRrNotifications(supabase, [input]);
}

/* ────────────────────────────────────────────────────────────────────────────
   Composers.

   The wording lives here rather than at each call site so the same event always
   reads the same way, and so a dispatcher and a driver are told the same story.
   ──────────────────────────────────────────────────────────────────────────── */

export type RrJobSummary = {
  serviceJobId: string;
  jobRef?: string | null;
  serviceTypeName?: string | null;
  originLabel?: string | null;
  priority?: string | null;
  vehicleRegistration?: string | null;
};

function jobLine(job: RrJobSummary): string {
  return [job.jobRef, job.serviceTypeName].filter(Boolean).join(" · ") || "Road & Recovery job";
}

function whereLine(job: RrJobSummary): string {
  const parts = [job.originLabel, job.vehicleRegistration].filter(Boolean);
  return parts.length ? parts.join(" · ") : "Location on the job card";
}

/**
 * Reads the handful of job fields a notification needs, through the caller's client.
 *
 * The job reference and priority live on the parent `field_jobs` row, and the service
 * type name on `rr_service_types`, so this joins what the message needs and nothing more.
 * Returns null rather than throwing — a notification that cannot be composed is skipped,
 * not escalated into an operational failure.
 */
export async function loadRrJobSummary(
  supabase: SupabaseClient,
  companyId: string,
  serviceJobId: string
): Promise<RrJobSummary | null> {
  try {
    const { data, error } = await supabase
      .from("rr_service_jobs")
      .select(
        "id,origin_label,vehicle_registration,field_job_id,service_type_id"
      )
      .eq("company_id", companyId)
      .eq("id", serviceJobId)
      .maybeSingle();
    if (error || !data) return null;

    const job = data as {
      id: string;
      origin_label: string | null;
      vehicle_registration: string | null;
      field_job_id: string | null;
      service_type_id: string | null;
    };

    const [fieldJob, serviceType] = await Promise.all([
      job.field_job_id
        ? supabase
            .from("field_jobs")
            .select("job_ref,priority")
            .eq("company_id", companyId)
            .eq("id", job.field_job_id)
            .maybeSingle()
        : Promise.resolve({ data: null }),
      job.service_type_id
        ? supabase
            .from("rr_service_types")
            .select("name")
            .eq("company_id", companyId)
            .eq("id", job.service_type_id)
            .maybeSingle()
        : Promise.resolve({ data: null }),
    ]);

    const parent = (fieldJob.data || null) as { job_ref?: string; priority?: string } | null;
    const type = (serviceType.data || null) as { name?: string } | null;

    return {
      serviceJobId: job.id,
      jobRef: parent?.job_ref ?? null,
      serviceTypeName: type?.name ?? null,
      originLabel: job.origin_label,
      priority: parent?.priority ?? null,
      vehicleRegistration: job.vehicle_registration,
    };
  } catch {
    return null;
  }
}

/** Office → driver: a job has been offered. */
export function composeAssignmentOffered(
  companyId: string,
  employeeId: string,
  job: RrJobSummary,
  assignmentId: string
): RrNotificationInput {
  const priority = (job.priority || "").trim();
  return {
    companyId,
    employeeId,
    type: "rr_assignment_offered",
    title: priority ? `New job · ${priority.toUpperCase()} priority` : "New job assigned",
    body: `${jobLine(job)} — ${whereLine(job)}. Accept or decline.`,
    metadata: {
      serviceJobId: job.serviceJobId,
      assignmentId,
      jobRef: job.jobRef ?? null,
      priority: priority || null,
      href: rrNotificationHref("driver", job.serviceJobId),
    },
  };
}

/** Office → driver: their assignment was withdrawn. */
export function composeAssignmentCancelled(
  companyId: string,
  employeeId: string,
  job: RrJobSummary,
  reason?: string | null
): RrNotificationInput {
  return {
    companyId,
    employeeId,
    type: "rr_assignment_cancelled",
    title: "Job withdrawn",
    body: `${jobLine(job)} is no longer assigned to you.${reason ? ` ${reason}` : ""}`,
    metadata: {
      serviceJobId: job.serviceJobId,
      jobRef: job.jobRef ?? null,
      href: rrNotificationHref("driver", job.serviceJobId),
    },
  };
}

/**
 * Driver responded — tell the control room, from an assignment id alone.
 *
 * Both the accept and decline routes need the same three lookups (assignment → job →
 * driver name), so they live here once rather than being copied into each handler. Every
 * read is tenant-filtered and runs on the caller's own client under RLS.
 *
 * Never throws. The operational write has already committed by the time this is called.
 */
export async function notifyDriverResponse(
  supabase: SupabaseClient,
  input: {
    companyId: string;
    assignmentId: string;
    event: "accepted" | "declined" | "en_route" | "arrived";
    actorEmail: string;
    detail?: string | null;
  }
): Promise<RrNotificationResult> {
  try {
    const { data: assignmentRow } = await supabase
      .from("rr_dispatch_assignments")
      .select("service_job_id,employee_id")
      .eq("company_id", input.companyId)
      .eq("id", input.assignmentId)
      .maybeSingle();

    const assignment = assignmentRow as {
      service_job_id?: string;
      employee_id?: string;
    } | null;
    if (!assignment?.service_job_id) return { ok: true, inserted: 0 };

    const [job, driver] = await Promise.all([
      loadRrJobSummary(supabase, input.companyId, assignment.service_job_id),
      assignment.employee_id
        ? supabase
            .from("employees")
            .select("first_name,last_name")
            .eq("company_id", input.companyId)
            .eq("id", assignment.employee_id)
            .maybeSingle()
        : Promise.resolve({ data: null }),
    ]);
    if (!job) return { ok: true, inserted: 0 };

    const person = (driver.data || null) as { first_name?: string; last_name?: string } | null;
    const driverName =
      [person?.first_name, person?.last_name].filter(Boolean).join(" ").trim() ||
      input.actorEmail;

    return emitRrNotification(
      supabase,
      composeDriverResponse(input.companyId, job, input.event, driverName, input.detail)
    );
  } catch (caught: unknown) {
    return { ok: false, error: caught instanceof Error ? caught.message : "Notification failed." };
  }
}

/** Driver → control room: accepted, declined, en route, arrived. */
export function composeDriverResponse(
  companyId: string,
  job: RrJobSummary,
  event: "accepted" | "declined" | "en_route" | "arrived",
  driverName: string,
  detail?: string | null
): RrNotificationInput {
  const map = {
    accepted: { type: "rr_assignment_accepted" as const, title: `${driverName} accepted` },
    declined: { type: "rr_assignment_declined" as const, title: `${driverName} declined` },
    en_route: { type: "rr_driver_en_route" as const, title: `${driverName} is en route` },
    arrived: { type: "rr_driver_arrived" as const, title: `${driverName} has arrived` },
  };
  const chosen = map[event];
  return {
    companyId,
    employeeId: null,
    type: chosen.type,
    title: chosen.title,
    body: `${jobLine(job)} — ${whereLine(job)}.${detail ? ` ${detail}` : ""}`,
    metadata: {
      serviceJobId: job.serviceJobId,
      jobRef: job.jobRef ?? null,
      driverName,
      reason: detail || null,
      href: rrNotificationHref("control-room", job.serviceJobId),
    },
  };
}

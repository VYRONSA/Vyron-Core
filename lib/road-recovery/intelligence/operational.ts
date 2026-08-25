/**
 * Operational findings that do not wait for an SLA to be configured.
 *
 * THE PROBLEM THIS SOLVES
 *
 *   Every other finding in this engine is produced by comparing a measured
 *   metric against a configured target. That is correct for anything where
 *   "too slow" is a judgement — response time, authorisation delay, margin.
 *   But a control room does not need a configured threshold to know that a job
 *   is sitting unassigned, that nobody has accepted an offer, that a finished
 *   recovery is missing mandatory photographs, or that three drivers in a row
 *   refused the same job. Those are not slow, they are STUCK, and a workspace
 *   that has not yet set its targets was being told nothing at all.
 *
 *   So these findings are structural: they read the operational record and
 *   report facts that are actionable on their own terms. They carry the same
 *   WHAT / WHY / WHAT TO DO shape as every other finding, because a manager
 *   should not be able to tell which engine produced the card they are reading.
 *
 * WHAT IS DELIBERATELY NOT HERE
 *
 *   No prediction, no scoring model, no "risk" that is really a guess. Every
 *   number below is counted from rows that exist. Where a duration is used to
 *   decide "too long", the boundary is a stated operational default, named in
 *   the finding itself so the reader can disagree with it knowingly.
 */

import type {
  RrFinding,
  RrIntelligenceDomain,
  RrSeverity,
} from "@/lib/road-recovery/intelligence/types";
import type { RrAssignmentFact } from "@/lib/road-recovery/intelligence/dispatch";
import type { RrJobTimingFact, RrStateEventFact } from "@/lib/road-recovery/intelligence/timing";
import { isTerminalState } from "@/lib/road-recovery/state-machine";

/**
 * Operational defaults, stated rather than hidden.
 *
 * These are NOT SLAs. They are the point at which something stops looking like
 * work in progress and starts looking like work that has been forgotten. Each
 * one is quoted in the finding it produces so a controller can judge it.
 */
export const RR_OPERATIONAL_DEFAULTS = {
  /** A dispatch-ready job with nobody assigned. */
  unassignedMinutes: 15,
  /** An offer nobody has answered. */
  awaitingAcceptanceMinutes: 10,
  /** No movement at all on a live job. */
  noMovementHours: 4,
  /** Refusals on ONE job before the dispatcher should stop and look. */
  repeatedDeclineCount: 2,
  /** Arrivals recorded with no GPS fix before the pattern matters. */
  gpsExceptionCount: 2,
} as const;

export type RrOperationalInput = {
  asOfIso: string;
  jobs: readonly RrJobTimingFact[];
  events: readonly RrStateEventFact[];
  assignments: readonly RrAssignmentFact[];
  /** Per job: mandatory requirements still outstanding, with their labels. */
  outstandingEvidence: readonly {
    serviceJobId: string;
    jobRef: string | null;
    serviceState: string;
    outstandingLabels: string[];
  }[];
  /**
   * Arrivals recorded with NO position, and the reason the driver gave.
   *
   * Passed in rather than inferred from the event stream, because the event
   * fact deliberately carries timing rather than coordinates and guessing from
   * a duration field would be wrong.
   */
  unverifiedArrivals: readonly { serviceJobId: string; reason: string | null }[];
};

/** States in which a job is waiting for a driver to be chosen. */
const AWAITING_DISPATCH = new Set(["dispatch_pending", "authorised", "bystand_requested"]);

function minutesBetween(fromIso: string, toIso: string): number | null {
  const from = Date.parse(fromIso);
  const to = Date.parse(toIso);
  if (!Number.isFinite(from) || !Number.isFinite(to)) return null;
  return Math.max(0, Math.round((to - from) / 60_000));
}

function plural(count: number, one: string, many: string): string {
  return count === 1 ? one : many;
}

/** Highest severity first, then most affected, then a stable key order. */
function severityRank(severity: RrSeverity): number {
  return { critical: 0, high: 1, medium: 2, low: 3 }[severity];
}

/**
 * Builds the structural findings.
 *
 * Every finding names the jobs it is about. A control room cannot act on
 * "3 jobs are stuck" — it acts on "RR-260824-0007 and RR-260824-0011".
 */
export function buildOperationalFindings(input: RrOperationalInput): RrFinding[] {
  const findings: RrFinding[] = [];
  const { asOfIso } = input;

  const liveJobs = input.jobs.filter((job) => !isTerminalState(job.workflowKey, job.serviceState));

  const latestEventAt = new Map<string, string>();
  for (const event of input.events) {
    const current = latestEventAt.get(event.serviceJobId);
    if (!current || Date.parse(event.occurredAt) > Date.parse(current)) {
      latestEventAt.set(event.serviceJobId, event.occurredAt);
    }
  }

  const liveAssignmentsByJob = new Map<string, RrAssignmentFact[]>();
  for (const assignment of input.assignments) {
    const list = liveAssignmentsByJob.get(assignment.serviceJobId) ?? [];
    list.push(assignment);
    liveAssignmentsByJob.set(assignment.serviceJobId, list);
  }

  /* ── 1. Nobody is going ─────────────────────────────────────────────────── */

  const unassigned = liveJobs.filter((job) => {
    if (!AWAITING_DISPATCH.has(job.serviceState)) return false;
    const assignments = liveAssignmentsByJob.get(job.serviceJobId) ?? [];
    const hasLiveOffer = assignments.some(
      (a) => a.assignmentStatus === "offered" || a.assignmentStatus === "accepted"
    );
    if (hasLiveOffer) return false;
    const waited = minutesBetween(job.createdAt, asOfIso);
    return waited !== null && waited >= RR_OPERATIONAL_DEFAULTS.unassignedMinutes;
  });

  if (unassigned.length > 0) {
    const waits = unassigned
      .map((job) => minutesBetween(job.createdAt, asOfIso) ?? 0)
      .sort((a, b) => b - a);
    const longest = waits[0];
    findings.push({
      key: "operational_unassigned_jobs",
      domain: "dispatch",
      severity: longest >= 60 ? "critical" : "high",
      symptom: `${unassigned.length} ${plural(unassigned.length, "job has", "jobs have")} nobody assigned, the longest waiting ${longest} minutes.`,
      rootCause:
        unassigned.length === 1
          ? "One job passed dispatch without a driver being offered it."
          : "Jobs are reaching dispatch faster than drivers are being offered them.",
      rootCauseConfidence: 70,
      evidence: unassigned
        .slice(0, 5)
        .map((job) => `${job.serviceCode.replace(/_/g, " ")} job waiting ${minutesBetween(job.createdAt, asOfIso)} minutes with no live offer.`),
      recommendation:
        "Open the Dispatch Board and offer each of these jobs to its recommended driver.",
      alternative:
        "If no truck is genuinely available, tell the customer now rather than letting the job age silently.",
      expectedOutcome: "Every waiting job has a named driver on the way.",
      consequenceIfIgnored:
        "The customer is waiting at a roadside with nobody dispatched, and the first anyone hears of it is the complaint.",
      metricKey: null,
      affectedCount: unassigned.length,
      financialImpactZAR: null,
      beforeMetrics: { unassignedJobs: unassigned.length, longestWaitMinutes: longest },
    });
  }

  /* ── 2. Offered, but nobody has answered ────────────────────────────────── */

  const stale = input.assignments.filter((assignment) => {
    if (assignment.assignmentStatus !== "offered" || !assignment.offeredAt) return false;
    const waited = minutesBetween(assignment.offeredAt, asOfIso);
    return waited !== null && waited >= RR_OPERATIONAL_DEFAULTS.awaitingAcceptanceMinutes;
  });

  if (stale.length > 0) {
    const longest = Math.max(
      ...stale.map((a) => minutesBetween(a.offeredAt as string, asOfIso) ?? 0)
    );
    findings.push({
      key: "operational_awaiting_acceptance",
      domain: "dispatch",
      severity: longest >= 30 ? "high" : "medium",
      symptom: `${stale.length} ${plural(stale.length, "offer has", "offers have")} gone unanswered, the longest for ${longest} minutes.`,
      rootCause:
        "The offered driver has not accepted or declined — typically a phone that is asleep, out of signal, or already occupied.",
      rootCauseConfidence: 60,
      evidence: stale
        .slice(0, 5)
        .map((a) => `Offer sent ${minutesBetween(a.offeredAt as string, asOfIso)} minutes ago with no answer.`),
      recommendation: "Call the driver. If they do not answer, reassign to the next eligible driver.",
      alternative: "Wait if you know the driver is mid-handover and about to respond.",
      expectedOutcome: "Every offer is answered, or reassigned to somebody who will.",
      consequenceIfIgnored:
        "The job looks dispatched on the board while nobody is actually driving to it.",
      metricKey: null,
      affectedCount: stale.length,
      financialImpactZAR: null,
      beforeMetrics: { staleOffers: stale.length, longestWaitMinutes: longest },
    });
  }

  /* ── 3. Refused more than once ──────────────────────────────────────────── */

  const declinesByJob = new Map<string, RrAssignmentFact[]>();
  for (const assignment of input.assignments) {
    if (assignment.assignmentStatus !== "declined") continue;
    const list = declinesByJob.get(assignment.serviceJobId) ?? [];
    list.push(assignment);
    declinesByJob.set(assignment.serviceJobId, list);
  }
  const repeatedlyDeclined = [...declinesByJob.entries()].filter(
    ([, list]) => list.length >= RR_OPERATIONAL_DEFAULTS.repeatedDeclineCount
  );

  if (repeatedlyDeclined.length > 0) {
    const reasons = repeatedlyDeclined
      .flatMap(([, list]) => list.map((a) => a.declineReason).filter(Boolean))
      .slice(0, 4) as string[];
    findings.push({
      key: "operational_repeated_declines",
      domain: "dispatch",
      severity: "high",
      symptom: `${repeatedlyDeclined.length} ${plural(repeatedlyDeclined.length, "job has", "jobs have")} been declined by ${RR_OPERATIONAL_DEFAULTS.repeatedDeclineCount} or more drivers.`,
      rootCause:
        reasons.length > 0
          ? "The drivers gave a consistent reason, which usually means the job needs different equipment rather than a different driver."
          : "Repeated refusal of one job usually means the job is mis-specified for the fleet being offered it.",
      rootCauseConfidence: reasons.length > 0 ? 75 : 55,
      evidence:
        reasons.length > 0
          ? reasons.map((reason) => `Driver declined: ${reason}`)
          : repeatedlyDeclined.map(([, list]) => `${list.length} drivers declined the same job without giving a reason.`),
      recommendation:
        "Check the service code and vehicle details against the fleet — the job is probably asking for a truck class nobody available can provide.",
      alternative: "Subcontract the job if no truck in the fleet can perform it.",
      expectedOutcome: "The job is matched to equipment that can actually do it, first time.",
      consequenceIfIgnored:
        "The job cycles through the whole fleet being refused while the customer waits.",
      metricKey: null,
      affectedCount: repeatedlyDeclined.length,
      financialImpactZAR: null,
      beforeMetrics: { jobsDeclinedRepeatedly: repeatedlyDeclined.length },
    });
  }

  /* ── 4. Live, but not moving ────────────────────────────────────────────── */

  const stuck = liveJobs.filter((job) => {
    const last = latestEventAt.get(job.serviceJobId) ?? job.createdAt;
    const idle = minutesBetween(last, asOfIso);
    return idle !== null && idle >= RR_OPERATIONAL_DEFAULTS.noMovementHours * 60;
  });

  if (stuck.length > 0) {
    const idles = stuck
      .map((job) => ({
        job,
        hours: Math.round(
          ((minutesBetween(latestEventAt.get(job.serviceJobId) ?? job.createdAt, asOfIso) ?? 0) / 60) * 10
        ) / 10,
      }))
      .sort((a, b) => b.hours - a.hours);
    findings.push({
      key: "operational_stuck_jobs",
      domain: "exceptions",
      severity: idles[0].hours >= 24 ? "critical" : "high",
      symptom: `${stuck.length} live ${plural(stuck.length, "job has", "jobs have")} not moved for over ${RR_OPERATIONAL_DEFAULTS.noMovementHours} hours, the longest ${idles[0].hours} hours.`,
      rootCause:
        "A job that stops producing state events is usually waiting on a person, not on the system — an unrecorded arrival, an unanswered authorisation, or a driver who finished without closing the job.",
      rootCauseConfidence: 65,
      evidence: idles
        .slice(0, 5)
        .map((entry) => `Job is at "${entry.job.serviceState.replace(/_/g, " ")}" with no movement for ${entry.hours} hours.`),
      recommendation:
        "Open each job's timeline and establish where it actually is, then record the step that was missed.",
      alternative:
        "Cancel the job with a reason if it was abandoned, so it stops appearing as live work.",
      expectedOutcome: "The board reflects reality, and billing is not blocked by a job nobody closed.",
      consequenceIfIgnored:
        "Revenue sits unbilled behind a job that everybody believes is finished, and the board stops being trusted.",
      metricKey: null,
      affectedCount: stuck.length,
      financialImpactZAR: null,
      beforeMetrics: { stuckJobs: stuck.length, longestIdleHours: idles[0].hours },
    });
  }

  /* ── 5. Finished work that cannot be billed ─────────────────────────────── */

  const blocked = input.outstandingEvidence.filter((row) => row.outstandingLabels.length > 0);
  if (blocked.length > 0) {
    const totalMissing = blocked.reduce((sum, row) => sum + row.outstandingLabels.length, 0);
    const commonest = new Map<string, number>();
    for (const row of blocked) {
      for (const label of row.outstandingLabels) {
        commonest.set(label, (commonest.get(label) ?? 0) + 1);
      }
    }
    const ranked = [...commonest.entries()].sort((a, b) => b[1] - a[1]);
    findings.push({
      key: "operational_evidence_blocking_billing",
      domain: "billing_readiness",
      severity: "high",
      symptom: `${blocked.length} ${plural(blocked.length, "job is", "jobs are")} missing mandatory evidence, ${totalMissing} ${plural(totalMissing, "item", "items")} in total.`,
      rootCause:
        ranked.length > 0 && ranked[0][1] > 1
          ? `The same item is missing on ${ranked[0][1]} jobs — "${ranked[0][0]}" — which points at a step drivers are routinely skipping rather than isolated forgetfulness.`
          : "Evidence was not captured before the job moved on, and the driver has since left the scene.",
      rootCauseConfidence: ranked.length > 0 && ranked[0][1] > 1 ? 80 : 60,
      evidence: blocked
        .slice(0, 5)
        .map((row) => `${row.jobRef ?? "Job"} (${row.serviceState.replace(/_/g, " ")}) still needs: ${row.outstandingLabels.slice(0, 3).join(", ")}.`),
      recommendation:
        ranked.length > 0 && ranked[0][1] > 1
          ? `Brief drivers on capturing "${ranked[0][0]}" before leaving the scene, and chase the outstanding items on these jobs today.`
          : "Contact the drivers while the vehicles are still accessible and capture the outstanding items.",
      alternative:
        "Waive a requirement deliberately, with a reason, where the evidence genuinely cannot be obtained.",
      expectedOutcome: "These jobs become billable instead of ageing in the billing-blocked list.",
      consequenceIfIgnored:
        "The work is done and unpaid, and the evidence becomes unobtainable once the vehicle is released.",
      metricKey: null,
      affectedCount: blocked.length,
      financialImpactZAR: null,
      beforeMetrics: { jobsBlocked: blocked.length, missingItems: totalMissing },
    });
  }

  /* ── 6. Arrivals nobody could verify ────────────────────────────────────── */

  const unverified = input.unverifiedArrivals;
  if (unverified.length >= RR_OPERATIONAL_DEFAULTS.gpsExceptionCount) {
    const reasons = new Map<string, number>();
    for (const row of unverified) {
      const reason = (row.reason || "no reason recorded").replace(/^Arrival recorded without location\.\s*Reason:\s*/i, "");
      reasons.set(reason, (reasons.get(reason) ?? 0) + 1);
    }
    const ranked = [...reasons.entries()].sort((a, b) => b[1] - a[1]);
    const dominant = ranked[0];
    findings.push({
      key: "operational_gps_exceptions",
      domain: "tow_operations",
      severity: unverified.length >= 5 ? "high" : "medium",
      symptom: `${unverified.length} arrivals were recorded without a verified GPS position.`,
      rootCause:
        dominant && dominant[1] > 1
          ? `The same reason accounts for ${dominant[1]} of them — "${dominant[0].replace(/_/g, " ")}" — which points at a device or coverage problem rather than drivers avoiding the check.`
          : "Arrivals were recorded through the stated-reason exception rather than a GPS fix.",
      rootCauseConfidence: dominant && dominant[1] > 1 ? 75 : 55,
      evidence: ranked
        .slice(0, 4)
        .map(([reason, count]) => `${count} ${plural(count, "arrival", "arrivals")}: ${reason.replace(/_/g, " ")}.`),
      recommendation:
        dominant && dominant[1] > 1
          ? `Investigate "${dominant[0].replace(/_/g, " ")}" — replace the device or accept the coverage gap explicitly.`
          : "Review the reasons given against the locations, and confirm the exception is genuine.",
      alternative:
        "Accept the exceptions where the area is known to have no coverage, and record that decision.",
      expectedOutcome: "Arrival times become defensible evidence again rather than assertions.",
      consequenceIfIgnored:
        "Arrival times cannot be defended in a dispute, and standby billing built on them becomes arguable.",
      metricKey: null,
      affectedCount: unverified.length,
      financialImpactZAR: null,
      beforeMetrics: { unverifiedArrivals: unverified.length },
    });
  }

  return findings.sort((a, b) => {
    if (severityRank(a.severity) !== severityRank(b.severity)) {
      return severityRank(a.severity) - severityRank(b.severity);
    }
    if (b.affectedCount !== a.affectedCount) return b.affectedCount - a.affectedCount;
    return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
  });
}

/** The domains these findings can appear under, so callers can merge them correctly. */
export const RR_OPERATIONAL_DOMAINS: RrIntelligenceDomain[] = [
  "dispatch",
  "exceptions",
  "billing_readiness",
  "tow_operations",
];

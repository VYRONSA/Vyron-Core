/**
 * VYRON CORE — Road & Recovery dispatch intelligence (Phase 6).
 *
 * PURE. Facts in, deterministic result out.
 *
 * Reads the offer/response history already recorded on `rr_dispatch_assignments`. Every
 * offer carries `offered_at`, `responded_at`, `assignment_status`, `sequence_number` and,
 * on a decline, a mandatory `decline_reason` — which is what makes it possible to answer
 * not just "dispatch was slow" but "dispatch was slow because the first two trucks
 * declined for vehicle breakdown".
 */

import { stateForRole } from "@/lib/road-recovery/state-machine";
import type { RrJobTimingFact, RrStateEventFact } from "./timing";
import { groupEventsByJob } from "./timing";

/** One offer, exactly as rr_dispatch_assignments stores it. */
export type RrAssignmentFact = {
  id: string;
  serviceJobId: string;
  employeeId: string | null;
  fieldVehicleId: string | null;
  assignmentStatus: "offered" | "accepted" | "declined" | "cancelled" | "reassigned" | "completed";
  sequenceNumber: number;
  offeredAt: string | null;
  respondedAt: string | null;
  declineReason: string | null;
};

function parse(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const value = Date.parse(iso);
  return Number.isFinite(value) ? value : null;
}

function byJob(assignments: readonly RrAssignmentFact[]): Map<string, RrAssignmentFact[]> {
  const grouped = new Map<string, RrAssignmentFact[]>();
  for (const assignment of assignments) {
    const bucket = grouped.get(assignment.serviceJobId);
    if (bucket) bucket.push(assignment);
    else grouped.set(assignment.serviceJobId, [assignment]);
  }
  for (const [jobId, bucket] of grouped) {
    grouped.set(
      jobId,
      [...bucket].sort((a, b) => {
        if (a.sequenceNumber !== b.sequenceNumber) return a.sequenceNumber - b.sequenceNumber;
        return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
      })
    );
  }
  return grouped;
}

export type RrDispatchSample = {
  serviceJobId: string;
  serviceCode: string;
  counterpartyId: string | null;
  seconds: number;
};

/**
 * Time from the job becoming dispatchable until the FIRST offer went out.
 *
 * This is the controller's clock, not the driver's: it measures how long a job sat in the
 * pool before anyone was asked. Separating it from time-to-accept is what distinguishes a
 * controller who is overloaded from a fleet that is refusing work — two problems with
 * completely different remedies.
 */
export function timeToFirstOfferSamples(
  jobs: readonly RrJobTimingFact[],
  events: readonly RrStateEventFact[],
  assignments: readonly RrAssignmentFact[]
): RrDispatchSample[] {
  const eventsByJob = groupEventsByJob(events);
  const assignmentsByJob = byJob(assignments);
  const samples: RrDispatchSample[] = [];

  for (const job of jobs) {
    const poolState = stateForRole(job.workflowKey, "dispatch_pool", job.workflowVersion);
    if (!poolState) continue;

    const jobEvents = eventsByJob.get(job.serviceJobId);
    const poolEntry = jobEvents?.find((event) => event.toState === poolState);
    // A job created directly into the dispatch pool has no transition INTO it, so the
    // creation instant is the honest start of the controller's clock.
    const start =
      parse(poolEntry?.occurredAt ?? null) ??
      (job.serviceState === poolState || jobEvents === undefined ? parse(job.createdAt) : null);
    if (start === null) continue;

    const offers = assignmentsByJob.get(job.serviceJobId);
    if (!offers || offers.length === 0) continue;

    const firstOffer = offers
      .map((offer) => parse(offer.offeredAt))
      .filter((value): value is number => value !== null)
      .sort((a, b) => a - b)[0];
    if (firstOffer === undefined || firstOffer < start) continue;

    samples.push({
      serviceJobId: job.serviceJobId,
      serviceCode: job.serviceCode,
      counterpartyId: job.counterpartyId,
      seconds: (firstOffer - start) / 1000,
    });
  }

  return samples;
}

/** Offer to acceptance, measured only on offers that were actually accepted. */
export function timeToAcceptSamples(
  jobs: readonly RrJobTimingFact[],
  assignments: readonly RrAssignmentFact[]
): RrDispatchSample[] {
  const jobIndex = new Map(jobs.map((job) => [job.serviceJobId, job]));
  const samples: RrDispatchSample[] = [];

  for (const assignment of assignments) {
    if (assignment.assignmentStatus !== "accepted" && assignment.assignmentStatus !== "completed") {
      continue;
    }
    const job = jobIndex.get(assignment.serviceJobId);
    if (!job) continue;

    const offered = parse(assignment.offeredAt);
    const responded = parse(assignment.respondedAt);
    if (offered === null || responded === null || responded < offered) continue;

    samples.push({
      serviceJobId: assignment.serviceJobId,
      serviceCode: job.serviceCode,
      counterpartyId: job.counterpartyId,
      seconds: (responded - offered) / 1000,
    });
  }

  return samples;
}

export type RrDispatchCounts = {
  offersMade: number;
  accepted: number;
  declined: number;
  cancelled: number;
  awaitingResponse: number;
  /** null when no offer in the window was ever responded to. */
  acceptanceRatePct: number | null;
  jobsDispatched: number;
  jobsReassigned: number;
  /** null when no job in the window was dispatched at all. */
  reassignmentRatePct: number | null;
  /** Decline reasons, most frequent first. The raw material of root-cause analysis. */
  declineReasons: Array<{ reason: string; count: number }>;
};

export function dispatchCounts(assignments: readonly RrAssignmentFact[]): RrDispatchCounts {
  let accepted = 0;
  let declined = 0;
  let cancelled = 0;
  let awaiting = 0;
  const reasons = new Map<string, number>();

  for (const assignment of assignments) {
    switch (assignment.assignmentStatus) {
      case "accepted":
      case "completed":
        accepted += 1;
        break;
      case "declined": {
        declined += 1;
        const reason = (assignment.declineReason ?? "").trim() || "unspecified";
        reasons.set(reason, (reasons.get(reason) ?? 0) + 1);
        break;
      }
      case "cancelled":
      case "reassigned":
        cancelled += 1;
        break;
      case "offered":
        awaiting += 1;
        break;
    }
  }

  const grouped = byJob(assignments);
  let reassigned = 0;
  for (const offers of grouped.values()) {
    if (offers.some((offer) => offer.sequenceNumber > 1)) reassigned += 1;
  }

  const responded = accepted + declined;
  const jobsDispatched = grouped.size;

  return {
    offersMade: assignments.length,
    accepted,
    declined,
    cancelled,
    awaitingResponse: awaiting,
    acceptanceRatePct: responded === 0 ? null : (accepted / responded) * 100,
    jobsDispatched,
    jobsReassigned: reassigned,
    reassignmentRatePct: jobsDispatched === 0 ? null : (reassigned / jobsDispatched) * 100,
    declineReasons: [...reasons.entries()]
      .map(([reason, count]) => ({ reason, count }))
      .sort((a, b) => {
        if (b.count !== a.count) return b.count - a.count;
        return a.reason < b.reason ? -1 : a.reason > b.reason ? 1 : 0;
      }),
  };
}

export type RrDriverDispatchStat = {
  employeeId: string;
  offers: number;
  accepted: number;
  declined: number;
  /** null when the driver was never asked to respond. */
  acceptanceRatePct: number | null;
  topDeclineReason: string | null;
};

/** Per-driver offer behaviour. Drivers who were never offered work do not appear. */
export function driverDispatchStats(
  assignments: readonly RrAssignmentFact[]
): RrDriverDispatchStat[] {
  const byDriver = new Map<string, RrAssignmentFact[]>();
  for (const assignment of assignments) {
    if (!assignment.employeeId) continue;
    const bucket = byDriver.get(assignment.employeeId);
    if (bucket) bucket.push(assignment);
    else byDriver.set(assignment.employeeId, [assignment]);
  }

  const stats: RrDriverDispatchStat[] = [];
  for (const [employeeId, offers] of byDriver) {
    const counts = dispatchCounts(offers);
    stats.push({
      employeeId,
      offers: offers.length,
      accepted: counts.accepted,
      declined: counts.declined,
      acceptanceRatePct: counts.acceptanceRatePct,
      topDeclineReason: counts.declineReasons[0]?.reason ?? null,
    });
  }

  return stats.sort((a, b) => {
    if (b.offers !== a.offers) return b.offers - a.offers;
    return a.employeeId < b.employeeId ? -1 : a.employeeId > b.employeeId ? 1 : 0;
  });
}

export type RrVehicleDispatchStat = {
  fieldVehicleId: string;
  jobs: number;
};

/** Per-vehicle job counts, for fleet utilisation. */
export function vehicleDispatchStats(
  assignments: readonly RrAssignmentFact[]
): RrVehicleDispatchStat[] {
  const counts = new Map<string, Set<string>>();
  for (const assignment of assignments) {
    if (!assignment.fieldVehicleId) continue;
    if (assignment.assignmentStatus !== "accepted" && assignment.assignmentStatus !== "completed") {
      continue;
    }
    const bucket = counts.get(assignment.fieldVehicleId);
    if (bucket) bucket.add(assignment.serviceJobId);
    else counts.set(assignment.fieldVehicleId, new Set([assignment.serviceJobId]));
  }

  return [...counts.entries()]
    .map(([fieldVehicleId, jobs]) => ({ fieldVehicleId, jobs: jobs.size }))
    .sort((a, b) => {
      if (b.jobs !== a.jobs) return b.jobs - a.jobs;
      return a.fieldVehicleId < b.fieldVehicleId ? -1 : a.fieldVehicleId > b.fieldVehicleId ? 1 : 0;
    });
}

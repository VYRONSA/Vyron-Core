/**
 * VYRON CORE — Road & Recovery domain assembly (Phase 6).
 *
 * PURE. Facts in, deterministic result out. No Supabase, no clock, no randomness, no AI.
 *
 * This module assembles the thirteen measured Road & Recovery domains. Executive Health
 * and Recommended Actions are derived from what this produces, by the health engine and
 * the recommendation engine respectively.
 *
 * ROOT CAUSE IS EVIDENCE-BASED OR ABSENT.
 *
 * Every cause stated here is derived from a count that was actually recorded — the decline
 * reasons on the offers, the authority status of the aged vehicles, the exception codes
 * that recurred. Confidence is the share of the population the cause explains, so a cause
 * covering nine of ten cases reads as strong and one covering two of ten reads as weak.
 * Where the facts support nothing, the cause is null and the card says the cause is
 * undetermined. A plausible sentence with no evidence behind it is worse than silence: it
 * sends a manager to fix the wrong thing and costs them their trust in the next card.
 */

import { isTerminalState, physicalStatusFor } from "@/lib/road-recovery/state-machine";
import { RR_DOMAIN_LABELS } from "./types";
import type {
  RrDomainResult,
  RrFinding,
  RrIntelligenceDomain,
  RrIntelligenceWindow,
  RrMetricResult,
  RrSeverity,
} from "./types";
import { buildMetric, type RrThreshold } from "./thresholds";
import { metricsForDomain } from "./metric-catalogue";
import {
  completionCounts,
  cycleTimeSamples,
  durationStats,
  responseToSceneSamples,
  secondsToHours,
  secondsToMinutes,
  timeOnSceneSamples,
  worstOffenders,
  type RrJobTimingFact,
  type RrStateEventFact,
} from "./timing";
import {
  dispatchCounts,
  driverDispatchStats,
  timeToAcceptSamples,
  timeToFirstOfferSamples,
  vehicleDispatchStats,
  type RrAssignmentFact,
} from "./dispatch";
import {
  assertNoBystandJobs,
  bystandTotals,
  type RrBystandDetailFact,
  type RrStandbySummaryFact,
} from "./bystand";
import {
  storageTotals,
  type RrReleaseAuthorityFact,
  type RrStorageAccrualFact,
  type RrStorageBookingFact,
} from "./storage";
import {
  driverTotals,
  fleetTotals,
  type RrDriverCertificationFact,
  type RrTowTruckFact,
} from "./assets";
import {
  authorisationTotals,
  billingReadinessTotals,
  counterpartyStats,
  distanceTotals,
  profitabilityTotals,
  type RrAuthorisationFact,
  type RrAuthorisationJobFact,
  type RrChargeCalculationFact,
  type RrDistanceFact,
  type RrJobMarginFact,
} from "./commercial";
import { exceptionTotals, isOpenException, type RrExceptionFact } from "./exceptions";

/** Everything the domain layer needs, loaded once by the service. */
export type RrIntelligenceFacts = {
  jobs: RrJobTimingFact[];
  /** Non-BYSTAND jobs. Separated at the boundary, asserted below. */
  towJobs: RrJobTimingFact[];
  bystandJobs: RrJobTimingFact[];
  events: RrStateEventFact[];
  assignments: RrAssignmentFact[];
  standbySummaries: RrStandbySummaryFact[];
  bystandDetails: RrBystandDetailFact[];
  bookings: RrStorageBookingFact[];
  accruals: RrStorageAccrualFact[];
  authorities: RrReleaseAuthorityFact[];
  trucks: RrTowTruckFact[];
  certifications: RrDriverCertificationFact[];
  authorisations: RrAuthorisationFact[];
  calculations: RrChargeCalculationFact[];
  distanceFacts: RrDistanceFact[];
  distanceEstimates: Array<{ serviceJobId: string; distanceKm: number }>;
  disputes: Array<{ serviceJobId: string; disputeType: string }>;
  exceptions: RrExceptionFact[];
  margins: RrJobMarginFact[];
  authJobs: RrAuthorisationJobFact[];
};

export type RrDomainBuildResult = {
  domains: RrDomainResult[];
  metrics: RrMetricResult[];
  findings: RrFinding[];
};

export type RrDomainContext = {
  thresholds: readonly RrThreshold[];
  window: RrIntelligenceWindow;
  filters: { serviceCode: string | null; counterpartyId: string | null };
  detailLimit: number;
};

type Measured = { value: number | null; sampleSize: number };

function measured(value: number | null, sampleSize: number): Measured {
  return { value, sampleSize };
}

/** A count is always known, even when it is zero: zero open exceptions is a real answer. */
function counted(value: number): Measured {
  return { value, sampleSize: 1 };
}

function round(value: number | null, places = 2): number | null {
  if (value === null || !Number.isFinite(value)) return null;
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

function metricsFor(
  domain: RrIntelligenceDomain,
  values: Record<string, Measured>,
  context: RrDomainContext
): RrMetricResult[] {
  return metricsForDomain(domain).map((definition) => {
    const value = values[definition.key] ?? { value: null, sampleSize: 0 };
    return buildMetric({
      metricKey: definition.key,
      value: value.value,
      sampleSize: value.sampleSize,
      thresholds: context.thresholds,
      serviceCode: definition.scopes.serviceCode ? context.filters.serviceCode : null,
      counterpartyId: definition.scopes.counterparty ? context.filters.counterpartyId : null,
      asOfIso: context.window.asOfIso,
    });
  });
}

/** A determined root cause, or the honest absence of one. */
export type RrRootCause = {
  cause: string | null;
  confidence: number | null;
  evidence: string[];
};

const NO_CAUSE: RrRootCause = { cause: null, confidence: null, evidence: [] };

/**
 * Confidence as the share of the population a cause explains.
 *
 * Floored at 40 and capped at 95: a cause derived from real counts is never presented as
 * certain, and one explaining a minority of cases is still worth stating as long as the
 * card shows how weak it is.
 */
function shareConfidence(explained: number, total: number): number | null {
  if (total <= 0 || explained <= 0) return null;
  return Math.max(40, Math.min(95, Math.round((explained / total) * 100)));
}

function breach(metric: RrMetricResult): boolean {
  return (
    metric.thresholdSource === "configured" &&
    (metric.band === "warning" || metric.band === "critical")
  );
}

function severityForBand(metric: RrMetricResult): RrSeverity {
  return metric.band === "critical" ? "high" : "medium";
}

function findingFrom(
  metric: RrMetricResult,
  input: {
    cause: RrRootCause;
    recommendation: string;
    alternative: string;
    outcome: string;
    consequence: string;
    affectedCount: number;
    financialImpactZAR?: number | null;
    severity?: RrSeverity;
    extraBefore?: Record<string, number>;
  }
): RrFinding {
  return {
    key: `${metric.key}:${metric.band}`,
    domain: metric.domain,
    severity: input.severity ?? severityForBand(metric),
    symptom: `${metric.label} is ${metric.value} ${metric.unit} against a configured target of ${metric.target} ${metric.unit}, measured over ${metric.sampleSize} record(s).`,
    rootCause: input.cause.cause,
    rootCauseConfidence: input.cause.confidence,
    evidence: input.cause.evidence,
    recommendation: input.recommendation,
    alternative: input.alternative,
    expectedOutcome: input.outcome,
    consequenceIfIgnored: input.consequence,
    metricKey: metric.key,
    affectedCount: input.affectedCount,
    financialImpactZAR: input.financialImpactZAR ?? null,
    beforeMetrics: {
      measuredValue: metric.value ?? 0,
      targetValue: metric.target ?? 0,
      sampleSize: metric.sampleSize,
      ...(input.extraBefore ?? {}),
    },
  };
}

function domainResult(
  domain: RrIntelligenceDomain,
  metrics: RrMetricResult[],
  findings: RrFinding[],
  detail: Record<string, unknown>,
  empty: boolean
): RrDomainResult {
  return {
    domain,
    label: RR_DOMAIN_LABELS[domain],
    metrics,
    findings,
    detail,
    empty,
    truncated: null,
  };
}

// ---------------------------------------------------------------------------
// The assembly
// ---------------------------------------------------------------------------

export function buildDomains(
  facts: RrIntelligenceFacts,
  context: RrDomainContext
): RrDomainBuildResult {
  // The BYSTAND boundary is asserted, not assumed. If a BYSTAND job ever reaches the tow
  // population this throws rather than quietly averaging an attendance into tow response.
  assertNoBystandJobs(facts.towJobs, "Road & Recovery tow operations intelligence");

  const domains: RrDomainResult[] = [];
  const allFindings: RrFinding[] = [];

  const towJobIds = new Set(facts.towJobs.map((job) => job.serviceJobId));
  const towAssignments = facts.assignments.filter((entry) => towJobIds.has(entry.serviceJobId));

  // ------------------------------------------------------------- 1. Dispatch
  const counts = dispatchCounts(towAssignments);
  const firstOfferSamples = timeToFirstOfferSamples(facts.towJobs, facts.events, towAssignments);
  const acceptSamples = timeToAcceptSamples(facts.towJobs, towAssignments);
  const firstOfferStats = durationStats(firstOfferSamples);
  const acceptStats = durationStats(acceptSamples);

  const dispatchMetrics = metricsFor(
    "dispatch",
    {
      dispatch_time_to_assign_minutes: measured(
        secondsToMinutes(firstOfferStats.averageSeconds),
        firstOfferStats.count
      ),
      dispatch_time_to_accept_minutes: measured(
        secondsToMinutes(acceptStats.averageSeconds),
        acceptStats.count
      ),
      dispatch_acceptance_rate_pct: measured(
        counts.acceptanceRatePct,
        counts.accepted + counts.declined
      ),
      dispatch_reassignment_rate_pct: measured(counts.reassignmentRatePct, counts.jobsDispatched),
    },
    context
  );

  const dispatchCause = ((): RrRootCause => {
    const top = counts.declineReasons[0];
    if (top && counts.declined > 0 && top.reason !== "unspecified") {
      return {
        cause: `Offers are being declined before anyone accepts. The most common recorded reason is "${top.reason}".`,
        confidence: shareConfidence(top.count, counts.declined),
        evidence: [
          `${counts.declined} of ${counts.offersMade} offers were declined.`,
          `"${top.reason}" accounts for ${top.count} of those declines.`,
          `${counts.jobsReassigned} of ${counts.jobsDispatched} jobs needed more than one offer.`,
        ],
      };
    }
    if (counts.awaitingResponse > 0 && counts.awaitingResponse >= counts.accepted) {
      return {
        cause:
          "Offers are going out but not being answered. The delay is in driver response rather than in the controller finding a truck.",
        confidence: shareConfidence(counts.awaitingResponse, counts.offersMade),
        evidence: [
          `${counts.awaitingResponse} offers are still awaiting a response.`,
          `${counts.accepted} offers were accepted in the same period.`,
        ],
      };
    }
    return NO_CAUSE;
  })();

  for (const metric of dispatchMetrics) {
    if (!breach(metric)) continue;
    allFindings.push(
      findingFrom(metric, {
        cause: dispatchCause,
        recommendation:
          "Escalate the affected jobs to the controller on duty and re-offer to the next ranked candidate. Review whether eligible trucks were actually available at the time before treating this as a controller problem.",
        alternative:
          "Continue monitoring for one more week if the breach is marginal and the volume was unusually high in this period.",
        outcome: "Jobs reach a truck within the configured target and the dispatch backlog clears.",
        consequence:
          "Response times stay long, counterparties notice before you do, and the operation loses work to competitors who answered first.",
        affectedCount: counts.jobsDispatched,
      })
    );
  }

  domains.push(
    domainResult(
      "dispatch",
      dispatchMetrics,
      allFindings.filter((finding) => finding.domain === "dispatch"),
      {
        offersMade: counts.offersMade,
        accepted: counts.accepted,
        declined: counts.declined,
        awaitingResponse: counts.awaitingResponse,
        jobsDispatched: counts.jobsDispatched,
        jobsReassigned: counts.jobsReassigned,
        declineReasons: counts.declineReasons.slice(0, context.detailLimit),
        slowestToOffer: worstOffenders(firstOfferSamples, context.detailLimit),
      },
      towAssignments.length === 0
    )
  );

  // ------------------------------------------------------- 2. Tow operations
  const responseSamples = responseToSceneSamples(facts.towJobs, facts.events);
  const onSceneSamples = timeOnSceneSamples(facts.towJobs, facts.events);
  const cycleSamples = cycleTimeSamples(facts.towJobs, facts.events);
  const responseStats = durationStats(responseSamples);
  const onSceneStats = durationStats(onSceneSamples);
  const cycleStats = durationStats(cycleSamples);
  // Whether a terminal state means "cancelled" is declared by the workflow definition as
  // its physical status. Matching on the state NAME would break the moment a workflow
  // named a cancellation state something other than "cancelled".
  const completion = completionCounts(
    facts.towJobs,
    facts.events,
    (workflowKey, state) => physicalStatusFor(workflowKey, state) === "Cancelled"
  );

  const towMetrics = metricsFor(
    "tow_operations",
    {
      response_time_to_scene_minutes: measured(
        secondsToMinutes(responseStats.averageSeconds),
        responseStats.count
      ),
      time_on_scene_minutes: measured(secondsToMinutes(onSceneStats.averageSeconds), onSceneStats.count),
      job_cycle_time_hours: measured(secondsToHours(cycleStats.averageSeconds), cycleStats.count),
      job_completion_rate_pct: measured(
        completion.completionRatePct,
        completion.completed + completion.cancelled
      ),
    },
    context
  );

  const towCause = ((): RrRootCause => {
    // If the time spent waiting for a driver to accept is a large share of the whole
    // response, the delay is upstream of the drive and the drivers are not the problem.
    if (
      acceptStats.averageSeconds !== null &&
      responseStats.averageSeconds !== null &&
      responseStats.averageSeconds > 0
    ) {
      const share = acceptStats.averageSeconds / (acceptStats.averageSeconds + responseStats.averageSeconds);
      if (share >= 0.4) {
        return {
          cause:
            "Most of the elapsed time is spent waiting for a driver to accept, not driving to the scene. The delay is in dispatch response rather than in travel.",
          confidence: shareConfidence(Math.round(share * 100), 100),
          evidence: [
            `Average time to accept: ${round(secondsToMinutes(acceptStats.averageSeconds))} minutes.`,
            `Average travel to scene: ${round(secondsToMinutes(responseStats.averageSeconds))} minutes.`,
          ],
        };
      }
    }
    if (counts.jobsReassigned > 0 && counts.jobsDispatched > 0 && counts.jobsReassigned / counts.jobsDispatched >= 0.25) {
      return {
        cause:
          "A quarter or more of jobs needed to be re-offered, so the clock ran while the job changed hands.",
        confidence: shareConfidence(counts.jobsReassigned, counts.jobsDispatched),
        evidence: [`${counts.jobsReassigned} of ${counts.jobsDispatched} jobs were reassigned at least once.`],
      };
    }
    return NO_CAUSE;
  })();

  for (const metric of towMetrics) {
    if (!breach(metric)) continue;
    allFindings.push(
      findingFrom(metric, {
        cause: towCause,
        recommendation:
          "Review the slowest jobs for distance, truck class and acceptance delay, and brief the drivers concerned. Check depot coverage for the times of day involved before changing anything else.",
        alternative:
          "Set a service-code-specific target if heavy recovery is being measured against a light-tow expectation.",
        outcome: "Response time to scene returns within the configured target.",
        consequence:
          "Scene times keep drifting, counterparty SLAs come under pressure, and roadside customers wait longer than they were promised.",
        affectedCount: metric.sampleSize,
      })
    );
  }

  domains.push(
    domainResult(
      "tow_operations",
      towMetrics,
      allFindings.filter((finding) => finding.domain === "tow_operations"),
      {
        completed: completion.completed,
        cancelled: completion.cancelled,
        open: completion.open,
        responseMedianMinutes: round(secondsToMinutes(responseStats.medianSeconds)),
        responseP90Minutes: round(secondsToMinutes(responseStats.p90Seconds)),
        cycleMedianHours: round(secondsToHours(cycleStats.medianSeconds)),
        slowestToScene: worstOffenders(responseSamples, context.detailLimit),
      },
      facts.towJobs.length === 0
    )
  );

  // -------------------------------------------------------------- 3. BYSTAND
  const bystand = bystandTotals(facts.standbySummaries, facts.bystandDetails);
  const bystandMetrics = metricsFor(
    "bystand",
    {
      bystand_time_to_scene_minutes: measured(
        secondsToMinutes(bystand.averageTimeToSceneSeconds),
        bystand.sealedAttendances
      ),
      bystand_stand_down_response_minutes: measured(
        secondsToMinutes(bystand.averageStandDownResponseSeconds),
        bystand.sealedAttendances
      ),
      bystand_standing_hours_avg: measured(
        secondsToHours(bystand.averageStandingSeconds),
        bystand.sealedAttendances
      ),
      bystand_paused_ratio_pct: measured(bystand.pausedRatioPct, bystand.sealedAttendances),
    },
    context
  );

  for (const metric of bystandMetrics) {
    if (!breach(metric)) continue;
    allFindings.push(
      findingFrom(metric, {
        cause:
          bystand.attendancesWithAnomalies > 0
            ? {
                cause:
                  "The sealed standing clock recorded anomalies on some attendances, which usually means the standing and paused transitions were not recorded as they happened.",
                confidence: shareConfidence(bystand.attendancesWithAnomalies, bystand.sealedAttendances),
                evidence: [
                  `${bystand.attendancesWithAnomalies} of ${bystand.sealedAttendances} sealed attendances carry anomalies.`,
                  `${bystand.missingReports} sealed attendance(s) have no submitted report.`,
                ],
              }
            : NO_CAUSE,
        recommendation:
          "Review the BYSTAND attendances concerned with the controllers who ran them, and confirm the standing and paused transitions are being recorded at the scene rather than afterwards.",
        alternative:
          "Leave the target unchanged and re-measure next month if the volume in this period was too small to be representative.",
        outcome: "Standing time is recorded accurately as it happens and the sealed clock stops carrying anomalies.",
        consequence:
          "Billable standing time is understated or challenged, and BYSTAND attendance stops paying for itself.",
        affectedCount: bystand.sealedAttendances,
      })
    );
  }

  domains.push(
    domainResult(
      "bystand",
      bystandMetrics,
      allFindings.filter((finding) => finding.domain === "bystand"),
      {
        attendances: bystand.attendances,
        sealedAttendances: bystand.sealedAttendances,
        converted: bystand.converted,
        conversionRatePct: round(bystand.conversionRatePct),
        missingReports: bystand.missingReports,
        attendancesWithAnomalies: bystand.attendancesWithAnomalies,
        totalStandingHours: round(bystand.totalStandingSeconds / 3600),
        reasonBreakdown: bystand.reasonBreakdown.slice(0, context.detailLimit),
        authorityBreakdown: bystand.authorityBreakdown.slice(0, context.detailLimit),
        // Stated on the card itself so nobody reads BYSTAND numbers as tow numbers.
        separationNote:
          "BYSTAND attendance is measured on its own clock from the sealed standby summary. A conversion creates a SEPARATE recovery job which is measured as a tow; neither absorbs the other.",
      },
      facts.bystandJobs.length === 0
    )
  );

  // -------------------------------------------------------------- 4. Storage
  const storage = storageTotals(facts.bookings, facts.accruals, facts.authorities, {
    asOfIso: context.window.asOfIso,
    ageingLimit: context.detailLimit,
  });

  const storageMetrics = metricsFor(
    "storage",
    {
      storage_ageing_over_30_days_count: counted(storage.over30Days),
      storage_release_delay_days_avg: measured(
        storage.averageReleaseDelayDays,
        storage.closedOccupancies
      ),
      storage_occupancy_days_avg: measured(storage.averageElapsedDays, storage.sealedCount),
      storage_free_day_leakage_days: measured(storage.totalFreeDaysApplied, storage.sealedCount),
    },
    context
  );

  const storageCause = ((): RrRootCause => {
    const aged = storage.ageing.filter((entry) => entry.daysHeld > 30);
    if (aged.length === 0) return NO_CAUSE;
    const noAuthority = aged.filter((entry) => entry.authorityStatus === "no_authority").length;
    const authorised = aged.filter(
      (entry) => entry.authorityStatus === "released_authorised" || entry.authorityStatus === "disposal_authorised"
    ).length;

    if (authorised >= noAuthority && authorised > 0) {
      return {
        cause:
          "The vehicles have verified release or disposal authority but collection has not been arranged. The blockage is with the owner or insurer, not with your paperwork.",
        confidence: shareConfidence(authorised, aged.length),
        evidence: [
          `${authorised} of ${aged.length} aged vehicles already hold verified authority.`,
          `${storage.authorisedButNotCollected} occupancies overall are authorised but still in a bay.`,
        ],
      };
    }
    if (noAuthority > 0) {
      return {
        cause:
          "Release or disposal authority has never been obtained for these vehicles, so they cannot lawfully leave the yard.",
        confidence: shareConfidence(noAuthority, aged.length),
        evidence: [
          `${noAuthority} of ${aged.length} aged vehicles have no active authority of any kind.`,
        ],
      };
    }
    return NO_CAUSE;
  })();

  // Financial exposure is CALCULATED, not guessed: the daily rate actually recorded on
  // each aged booking, multiplied by the days it has been held.
  const agedExposure = ((): number | null => {
    const rated = facts.bookings.filter(
      (booking) => booking.checkedOutAt === null && booking.rateAmount !== null && booking.rateAmount > 0
    );
    if (rated.length === 0) return null;
    const rateByBooking = new Map(rated.map((booking) => [booking.id, booking.rateAmount as number]));
    let total = 0;
    let counted = 0;
    for (const entry of storage.ageing) {
      const rate = rateByBooking.get(entry.bookingId);
      if (rate === undefined || entry.daysHeld <= 30) continue;
      total += rate * entry.daysHeld;
      counted += 1;
    }
    return counted === 0 ? null : Math.round(total);
  })();

  for (const metric of storageMetrics) {
    if (!breach(metric)) continue;
    allFindings.push(
      findingFrom(metric, {
        cause: storageCause,
        recommendation:
          "Work the aged list: chase authority where none exists, and chase collection where authority is already verified. Confirm each aged vehicle is still accruing against a live storage rate.",
        alternative:
          "Begin the disposal process for vehicles whose owners cannot be reached, where the notice period has run.",
        outcome: "Aged vehicles leave the yard and bay capacity is recovered.",
        consequence:
          "Bays stay occupied by vehicles nobody is collecting, capacity for paying work shrinks, and unrecoverable storage accrues against owners who will dispute it.",
        affectedCount: storage.over30Days,
        financialImpactZAR: agedExposure,
        extraBefore: { over30Days: storage.over30Days, over60Days: storage.over60Days },
      })
    );
  }

  domains.push(
    domainResult(
      "storage",
      storageMetrics,
      allFindings.filter((finding) => finding.domain === "storage"),
      {
        openOccupancies: storage.openOccupancies,
        closedOccupancies: storage.closedOccupancies,
        over30Days: storage.over30Days,
        over60Days: storage.over60Days,
        over90Days: storage.over90Days,
        authorisedButNotCollected: storage.authorisedButNotCollected,
        unmeasurableOccupancies: storage.unmeasurableOccupancies,
        sealedCount: storage.sealedCount,
        totalSealedAmount: storage.totalSealedAmount,
        ageing: storage.ageing,
        sealedNote:
          "Occupancy days come from the SEALED storage accrual and are never recomputed. Ageing on OPEN occupancies is measured from check-in against the as-of instant.",
      },
      facts.bookings.length === 0
    )
  );

  // ---------------------------------------------------------------- 5. Fleet
  const vehicleJobs = vehicleDispatchStats(facts.assignments);
  const fleet = fleetTotals(facts.trucks, vehicleJobs, {
    asOfIso: context.window.asOfIso,
    staleLocationHours: 24,
    idleLimit: context.detailLimit,
  });

  const driverStats = driverDispatchStats(facts.assignments);
  const drivers = driverTotals(facts.certifications, driverStats, {
    asOfIso: context.window.asOfIso,
    attentionLimit: context.detailLimit,
    lowAcceptanceThresholdPct: 50,
  });

  const fleetMetrics = metricsFor(
    "fleet",
    {
      fleet_utilisation_pct: measured(fleet.utilisationPct, fleet.operational),
      fleet_out_of_service_pct: measured(fleet.outOfServicePct, fleet.trucks),
      fleet_available_capacity_pct: measured(fleet.availableCapacityPct, fleet.trucks),
      fleet_jobs_per_truck: measured(fleet.jobsPerTruck, fleet.operational),
    },
    context
  );

  const fleetCause = ((): RrRootCause => {
    if (fleet.outOfService > 0 && fleet.outOfService >= drivers.blockedDrivers) {
      return {
        cause: `${fleet.outOfService} truck(s) are out of service, so the capacity is physically unavailable rather than idle.`,
        confidence: shareConfidence(fleet.outOfService, Math.max(fleet.trucks, 1)),
        evidence: [
          `${fleet.outOfService} of ${fleet.trucks} trucks are not operational.`,
          `${fleet.idleTrucks.length} operational truck(s) took no work in this period.`,
        ],
      };
    }
    if (drivers.blockedDrivers > 0) {
      return {
        cause: `${drivers.blockedDrivers} driver(s) are blocked from dispatch by a certification that is not valid, so trucks are available but nobody can crew them.`,
        confidence: shareConfidence(drivers.blockedDrivers, Math.max(drivers.driversWithCertifications, 1)),
        evidence: [
          `${drivers.blockingCount} certification(s) currently block dispatch.`,
          `${drivers.expiringWithin30Days} more expire within 30 days.`,
        ],
      };
    }
    return NO_CAUSE;
  })();

  for (const metric of fleetMetrics) {
    if (!breach(metric)) continue;
    allFindings.push(
      findingFrom(metric, {
        cause: fleetCause,
        recommendation:
          "Confirm a return-to-service date for every truck out of commission and renew the certifications blocking drivers. Check whether the remaining truck classes can still cover the work this area normally takes.",
        alternative:
          "Hire in temporary capacity for the peak period if the repairs cannot be completed in time.",
        outcome: "Available capacity returns above target and jobs stop queueing for a truck.",
        consequence:
          "Jobs get declined or delayed for want of a truck, and counterparties route work to an operator who has one.",
        affectedCount: fleet.outOfService + drivers.blockedDrivers,
      })
    );
  }

  domains.push(
    domainResult(
      "fleet",
      fleetMetrics,
      allFindings.filter((finding) => finding.domain === "fleet"),
      {
        trucks: fleet.trucks,
        operational: fleet.operational,
        outOfService: fleet.outOfService,
        available: fleet.available,
        onJob: fleet.onJob,
        utilisedTrucks: fleet.utilisedTrucks,
        idleTrucks: fleet.idleTrucks,
        byClass: fleet.byClass,
        staleLocationCount: fleet.staleLocationCount,
      },
      fleet.trucks === 0
    )
  );

  // --------------------------------------------------------------- 6. Driver
  const driverMetrics = metricsFor(
    "driver",
    {
      driver_acceptance_rate_pct: measured(drivers.averageAcceptanceRatePct, drivers.driversOffered),
      driver_certification_expiry_30d_count: counted(drivers.expiringWithin30Days),
      driver_dispatch_blocked_count: counted(drivers.blockedDrivers),
      driver_jobs_per_driver: measured(drivers.jobsPerDriver, drivers.driversOffered),
    },
    context
  );

  const driverCause = ((): RrRootCause => {
    if (drivers.lowAcceptanceDrivers.length > 0) {
      const reasons = drivers.lowAcceptanceDrivers
        .map((entry) => entry.topDeclineReason)
        .filter((reason): reason is string => Boolean(reason));
      return {
        cause:
          reasons.length > 0
            ? `A small group of drivers is declining most of what they are offered, most often for "${reasons[0]}".`
            : "A small group of drivers is declining most of what they are offered, and no decline reason has been recorded.",
        confidence: shareConfidence(drivers.lowAcceptanceDrivers.length, Math.max(drivers.driversOffered, 1)),
        evidence: [
          `${drivers.lowAcceptanceDrivers.length} of ${drivers.driversOffered} drivers accepted under half their offers.`,
        ],
      };
    }
    if (drivers.expiredCount > 0) {
      return {
        cause: `${drivers.expiredCount} certification(s) have already lapsed, which removes those drivers from the dispatch pool.`,
        confidence: shareConfidence(drivers.expiredCount, Math.max(drivers.certifications, 1)),
        evidence: [`${drivers.expiredCount} of ${drivers.certifications} certifications are past their expiry date.`],
      };
    }
    return NO_CAUSE;
  })();

  for (const metric of driverMetrics) {
    if (!breach(metric)) continue;
    allFindings.push(
      findingFrom(metric, {
        cause: driverCause,
        recommendation:
          "Renew the lapsed and expiring certifications now, and speak to the drivers with the lowest acceptance about what they are being offered. A driver declining everything is usually being offered work they cannot do.",
        alternative:
          "Adjust the dispatch scoring so those drivers are offered work matching their vehicle class and location before escalating it as a conduct matter.",
        outcome: "The dispatch pool has enough qualified, responsive drivers to cover the work.",
        consequence:
          "The pool keeps shrinking, the same few drivers absorb every job, and fatigue and turnover follow.",
        affectedCount: drivers.blockedDrivers + drivers.expiringWithin30Days,
      })
    );
  }

  domains.push(
    domainResult(
      "driver",
      driverMetrics,
      allFindings.filter((finding) => finding.domain === "driver"),
      {
        driversWithCertifications: drivers.driversWithCertifications,
        certifications: drivers.certifications,
        blockedDrivers: drivers.blockedDrivers,
        expiringWithin30Days: drivers.expiringWithin30Days,
        expiredCount: drivers.expiredCount,
        attention: drivers.attention,
        lowAcceptanceDrivers: drivers.lowAcceptanceDrivers.slice(0, context.detailLimit),
      },
      facts.certifications.length === 0 && driverStats.length === 0
    )
  );

  // --------------------------------------------------------- 7. Counterparty
  const openBillingExceptions = facts.exceptions
    .filter((entry) => entry.origin === "billing" && isOpenException(entry))
    .map((entry) => ({ serviceJobId: entry.serviceJobId, exceptionCode: entry.exceptionCode }));

  const counterparties = counterpartyStats(
    facts.authJobs,
    facts.authorisations,
    facts.calculations,
    facts.disputes,
    openBillingExceptions,
    { asOfIso: context.window.asOfIso }
  );

  const rated = <T,>(values: Array<T | null>): T[] => values.filter((value): value is T => value !== null);
  const avg = (values: number[]): number | null =>
    values.length === 0 ? null : values.reduce((sum, value) => sum + value, 0) / values.length;

  const counterpartyMetrics = metricsFor(
    "counterparty",
    {
      counterparty_authorisation_rate_pct: measured(
        avg(rated(counterparties.map((entry) => entry.authorisationRatePct))),
        counterparties.length
      ),
      counterparty_dispute_rate_pct: measured(
        avg(rated(counterparties.map((entry) => entry.disputeRatePct))),
        counterparties.length
      ),
      counterparty_billing_block_rate_pct: measured(
        avg(rated(counterparties.map((entry) => entry.billingBlockRatePct))),
        counterparties.length
      ),
      counterparty_job_volume: measured(
        counterparties.length === 0
          ? null
          : counterparties.reduce((sum, entry) => sum + entry.jobs, 0) / counterparties.length,
        counterparties.length
      ),
    },
    context
  );

  for (const metric of counterpartyMetrics) {
    if (!breach(metric)) continue;
    const worst = [...counterparties]
      .filter((entry) => entry.disputes > 0 || entry.openBillingExceptions > 0)
      .sort((a, b) => b.disputes + b.openBillingExceptions - (a.disputes + a.openBillingExceptions))[0];
    allFindings.push(
      findingFrom(metric, {
        cause: worst
          ? {
              cause: `${worst.counterpartyName} accounts for the largest share of the problem, with ${worst.disputes} dispute(s) and ${worst.openBillingExceptions} open billing exception(s).`,
              confidence: shareConfidence(
                worst.disputes + worst.openBillingExceptions,
                counterparties.reduce((sum, entry) => sum + entry.disputes + entry.openBillingExceptions, 0)
              ),
              evidence: [
                `${worst.counterpartyName}: ${worst.jobs} job(s) in the period.`,
                `${worst.disputes} dispute(s) and ${worst.openBillingExceptions} open billing exception(s).`,
              ],
            }
          : NO_CAUSE,
        recommendation:
          "Take the recurring issues to the counterparty directly with the job references attached. A pattern with one counterparty is a commercial conversation, not an internal process failure.",
        alternative:
          "Review the rate card and authorisation terms for that counterparty before the next renewal.",
        outcome: "Authorisation and dispute rates for the affected counterparties return to normal.",
        consequence:
          "Disputes accumulate, payment slows, and the commercial relationship deteriorates without anyone having raised it.",
        affectedCount: counterparties.length,
      })
    );
  }

  domains.push(
    domainResult(
      "counterparty",
      counterpartyMetrics,
      allFindings.filter((finding) => finding.domain === "counterparty"),
      { counterparties: counterparties.slice(0, context.detailLimit) },
      counterparties.length === 0
    )
  );

  // -------------------------------------------------------- 8. Authorisation
  const expectedTotals = facts.calculations
    .filter((entry) => entry.status === "complete")
    .map((entry) => ({ serviceJobId: entry.serviceJobId, totalInclVat: entry.totalInclVat }));

  const authorisation = authorisationTotals(facts.authJobs, facts.authorisations, expectedTotals, {
    asOfIso: context.window.asOfIso,
    listLimit: context.detailLimit,
  });

  const authorisationMetrics = metricsFor(
    "authorisation",
    {
      authorisation_delay_minutes: measured(authorisation.averageDelayMinutes, authorisation.authorised),
      authorisation_missing_count: counted(authorisation.missing),
      authorisation_expired_count: counted(authorisation.expired),
      authorisation_exceeded_count: counted(authorisation.exceeded),
    },
    context
  );

  // Calculated exposure: the sum by which sealed expected charges exceed what was
  // authorised. Every rand of it comes from two recorded numbers.
  const authorisationExposure =
    authorisation.exceededDetail.length === 0
      ? null
      : Math.round(authorisation.exceededDetail.reduce((sum, entry) => sum + entry.overBy, 0));

  const authorisationCause = ((): RrRootCause => {
    const problems = authorisation.missing + authorisation.expired + authorisation.voided;
    if (problems === 0) return NO_CAUSE;
    if (authorisation.missing >= authorisation.expired) {
      return {
        cause:
          "Authorisation was never obtained for these jobs. The work was started before the counterparty issued a number.",
        confidence: shareConfidence(authorisation.missing, problems),
        evidence: [
          `${authorisation.missing} of ${authorisation.jobsRequiringAuthorisation} jobs requiring authorisation have none.`,
          `${authorisation.expired} more have an authorisation that has since expired.`,
        ],
      };
    }
    return {
      cause:
        "Authorisations are being obtained but expiring before the job is closed, which usually means the job ran longer than the authority allowed for.",
      confidence: shareConfidence(authorisation.expired, problems),
      evidence: [`${authorisation.expired} of ${problems} authorisation problems are expiries rather than omissions.`],
    };
  })();

  for (const metric of authorisationMetrics) {
    if (!breach(metric)) continue;
    allFindings.push(
      findingFrom(metric, {
        cause: authorisationCause,
        recommendation:
          "Chase the outstanding authorisation numbers with the counterparties concerned and confirm the after-hours contacts are current. Flag every job already worked without authority so the commercial exposure is visible now rather than at dispute.",
        alternative:
          "Agree a standing authorisation arrangement with the counterparties whose desks cannot answer out of hours.",
        outcome: "Work is authorised before it is performed and exposure on unauthorised jobs is closed.",
        consequence:
          "Jobs are worked that nobody agreed to pay for, and the first anyone hears of it is when the payment is refused.",
        affectedCount: authorisation.missing + authorisation.expired + authorisation.exceeded,
        financialImpactZAR: authorisationExposure,
      })
    );
  }

  domains.push(
    domainResult(
      "authorisation",
      authorisationMetrics,
      allFindings.filter((finding) => finding.domain === "authorisation"),
      {
        jobsRequiringAuthorisation: authorisation.jobsRequiringAuthorisation,
        authorised: authorisation.authorised,
        missing: authorisation.missing,
        expired: authorisation.expired,
        voided: authorisation.voided,
        exceeded: authorisation.exceeded,
        authorisationRatePct: round(authorisation.authorisationRatePct),
        worstDelays: authorisation.worstDelays,
        exceededDetail: authorisation.exceededDetail,
      },
      authorisation.jobsRequiringAuthorisation === 0
    )
  );

  // ----------------------------------------------------- 9. Billing readiness
  // A job is FINISHED when it reached a terminal state. Jobs still running are excluded
  // from the billing denominator: work in progress is not a billing failure.
  const finishedJobs: Array<{ serviceJobId: string; finishedAt: string | null }> = [];
  for (const job of facts.jobs) {
    const terminal = facts.events
      .filter(
        (event) =>
          event.serviceJobId === job.serviceJobId &&
          isTerminalState(job.workflowKey, event.toState, job.workflowVersion)
      )
      .sort((a, b) => (Date.parse(a.occurredAt) || 0) - (Date.parse(b.occurredAt) || 0))[0];
    if (terminal) finishedJobs.push({ serviceJobId: job.serviceJobId, finishedAt: terminal.occurredAt });
  }

  const billing = billingReadinessTotals(finishedJobs, facts.calculations, openBillingExceptions);

  const billingMetrics = metricsFor(
    "billing_readiness",
    {
      billing_ready_rate_pct: measured(billing.readyRatePct, billing.finishedJobs),
      billing_blocked_count: counted(billing.blockedJobs),
      billing_days_to_ready_avg: measured(billing.averageDaysToReadyDays, billing.readyJobs),
      billing_unrated_fact_count: counted(billing.unratedFactCount),
    },
    context
  );

  const billingCause = ((): RrRootCause => {
    const top = billing.topBlockers[0];
    if (top) {
      const total = billing.topBlockers.reduce((sum, entry) => sum + entry.count, 0);
      return {
        cause: `Billing is blocked most often by "${top.code}".`,
        confidence: shareConfidence(top.count, total),
        evidence: [
          `${top.count} of ${total} open billing exceptions carry that code.`,
          `${billing.neverCalculated} finished job(s) have never had a charge calculated at all.`,
        ],
      };
    }
    if (billing.neverCalculated > 0) {
      return {
        cause:
          "Finished jobs have never had their expected charge calculated, so nothing is blocking them — nobody has prepared them.",
        confidence: shareConfidence(billing.neverCalculated, Math.max(billing.finishedJobs, 1)),
        evidence: [`${billing.neverCalculated} of ${billing.finishedJobs} finished jobs have no calculation.`],
      };
    }
    return NO_CAUSE;
  })();

  for (const metric of billingMetrics) {
    if (!breach(metric)) continue;
    allFindings.push(
      findingFrom(metric, {
        cause: billingCause,
        recommendation:
          "Work the open billing exceptions job by job: capture the missing evidence, resolve the rate conflict, or obtain the authorisation. Prepare the jobs that were never calculated.",
        alternative:
          "Prioritise the highest-value blocked jobs first if the backlog cannot be cleared in one pass.",
        outcome:
          "Finished jobs become billing-ready and their information packs can be handed to VYRON FINANCE.",
        consequence:
          "Completed work sits unbilled, cash conversion slows, and evidence gets harder to recover the longer it is left.",
        affectedCount: billing.blockedJobs + billing.neverCalculated,
      })
    );
  }

  domains.push(
    domainResult(
      "billing_readiness",
      billingMetrics,
      allFindings.filter((finding) => finding.domain === "billing_readiness"),
      {
        finishedJobs: billing.finishedJobs,
        readyJobs: billing.readyJobs,
        incompleteJobs: billing.incompleteJobs,
        neverCalculated: billing.neverCalculated,
        blockedJobs: billing.blockedJobs,
        unratedFactCount: billing.unratedFactCount,
        missingFactCount: billing.missingFactCount,
        topBlockers: billing.topBlockers.slice(0, context.detailLimit),
        boundaryNote:
          "VYRON CORE prepares billing INFORMATION. It creates no invoice, payment or accounting document — VYRON FINANCE issues the invoice.",
      },
      billing.finishedJobs === 0
    )
  );

  // ------------------------------------------------------------- 10. Distance
  const gpsExceptions = facts.exceptions
    .filter((entry) => entry.exceptionCode === "gps_unavailable")
    .map((entry) => ({ serviceJobId: entry.serviceJobId }));

  const distance = distanceTotals(
    facts.towJobs.map((job) => ({ serviceJobId: job.serviceJobId })),
    facts.distanceFacts,
    facts.distanceEstimates,
    facts.disputes,
    gpsExceptions,
    { listLimit: context.detailLimit }
  );

  const distanceMetrics = metricsFor(
    "distance",
    {
      distance_variance_pct_avg: measured(distance.averageVariancePct, distance.largestVariances.length),
      distance_dispute_count: counted(distance.disputes),
      distance_missing_capture_count: counted(distance.missingCapture),
      distance_gps_unavailable_count: counted(distance.gpsUnavailable),
    },
    context
  );

  const distanceCause = ((): RrRootCause => {
    if (distance.missingCapture > 0 && distance.missingCapture >= distance.captured) {
      return {
        cause:
          "Most tow jobs have no captured distance at all, so an estimate is standing in for a measurement that was never taken.",
        confidence: shareConfidence(distance.missingCapture, Math.max(distance.towJobs, 1)),
        evidence: [
          `${distance.missingCapture} of ${distance.towJobs} tow jobs have no distance fact.`,
          `${distance.odometerCaptured} job(s) have a full odometer capture.`,
        ],
      };
    }
    if (distance.gpsUnavailable > 0) {
      return {
        cause:
          "GPS was unavailable on a number of jobs, which removes the corroboration behind the captured distance and makes it easy to challenge.",
        confidence: shareConfidence(distance.gpsUnavailable, Math.max(distance.towJobs, 1)),
        evidence: [`${distance.gpsUnavailable} job(s) recorded a gps_unavailable exception.`],
      };
    }
    if (distance.largestVariances.length > 0) {
      return {
        cause:
          "Captured distances differ materially from the dispatch estimates, which usually means the route taken was not the route estimated or the odometer was read at the wrong point.",
        confidence: shareConfidence(distance.largestVariances.length, Math.max(distance.captured, 1)),
        evidence: distance.largestVariances
          .slice(0, 3)
          .map(
            (entry) =>
              `Job ${entry.serviceJobId}: captured ${entry.capturedKm} km against an estimate of ${entry.estimatedKm} km (${entry.variancePct}%).`
          ),
      };
    }
    return NO_CAUSE;
  })();

  for (const metric of distanceMetrics) {
    if (!breach(metric)) continue;
    allFindings.push(
      findingFrom(metric, {
        cause: distanceCause,
        recommendation:
          "Review the odometer capture and GPS trail on the affected jobs. Where a reading is genuinely wrong, record a replacement fact — the original driver reading is never overwritten and stays available for the dispute.",
        alternative:
          "Accept the dispatch estimate for the affected jobs and tighten roadside capture discipline going forward.",
        outcome: "Distance is defensible against the odometer capture and the GPS trail, and disputes fall.",
        consequence:
          "Distance charges become indefensible, counterparties discount them at will, and revenue is lost on work that was actually performed.",
        affectedCount: distance.missingCapture + distance.disputes,
      })
    );
  }

  domains.push(
    domainResult(
      "distance",
      distanceMetrics,
      allFindings.filter((finding) => finding.domain === "distance"),
      {
        towJobs: distance.towJobs,
        captured: distance.captured,
        odometerCaptured: distance.odometerCaptured,
        missingCapture: distance.missingCapture,
        disputes: distance.disputes,
        gpsUnavailable: distance.gpsUnavailable,
        largestVariances: distance.largestVariances,
        immutabilityNote:
          "The driver odometer capture is never overwritten. A correction supersedes the original fact and both remain readable.",
      },
      distance.towJobs === 0
    )
  );

  // ----------------------------------------------------------- 11. Exceptions
  const exceptions = exceptionTotals(facts.exceptions, {
    asOfIso: context.window.asOfIso,
    listLimit: context.detailLimit,
  });

  const exceptionMetrics = metricsFor(
    "exceptions",
    {
      exception_open_count: counted(exceptions.open),
      exception_critical_open_count: counted(exceptions.openCritical),
      exception_avg_resolution_hours: measured(exceptions.averageResolutionHours, exceptions.resolved),
      exception_recurrence_rate_pct: measured(exceptions.recurrenceRatePct, exceptions.total),
    },
    context
  );

  const exceptionCause = ((): RrRootCause => {
    const recurring = exceptions.byCode.filter((entry) => entry.recurring);
    if (recurring.length === 0) return NO_CAUSE;
    const top = recurring[0];
    return {
      cause: `"${top.exceptionCode}" is recurring across ${top.distinctJobs} separate jobs, which makes it a process problem rather than a series of incidents.`,
      confidence: shareConfidence(top.total, exceptions.total),
      evidence: [
        `${top.total} occurrence(s) of "${top.exceptionCode}" across ${top.distinctJobs} jobs.`,
        `${exceptions.unescalatedOpen} open exception(s) have never been escalated into an action.`,
        `${exceptions.openOver7Days} open exception(s) are more than seven days old.`,
      ],
    };
  })();

  for (const metric of exceptionMetrics) {
    if (!breach(metric)) continue;
    allFindings.push(
      findingFrom(metric, {
        cause: exceptionCause,
        recommendation:
          "Assign an owner and a due date to every open critical exception, and treat the recurring codes as a process fix rather than as individual incidents.",
        alternative:
          "Waive the exceptions that are genuinely not actionable, with a recorded reason, so the real backlog is visible.",
        outcome: "Every open critical exception has a named owner and a recorded resolution.",
        consequence:
          "Exceptions accumulate, the genuinely urgent ones get lost among the routine, and the operation stops looking at the list at all.",
        affectedCount: exceptions.open,
        severity: exceptions.openCritical > 0 ? "critical" : undefined,
        extraBefore: { openCriticalExceptions: exceptions.openCritical },
      })
    );
  }

  // A recorded critical exception raises a finding on the FACT alone. It needs no
  // configured target: the operation already judged it critical when it recorded it.
  if (exceptions.openCritical > 0) {
    allFindings.push({
      key: "exception_critical_open:fact",
      domain: "exceptions",
      severity: "critical",
      symptom: `${exceptions.openCritical} critical exception(s) are open and unresolved.`,
      rootCause: exceptionCause.cause,
      rootCauseConfidence: exceptionCause.confidence,
      evidence:
        exceptionCause.evidence.length > 0
          ? exceptionCause.evidence
          : [`${exceptions.unescalatedOpen} open exception(s) have never been escalated into an action.`],
      recommendation:
        "Assign an owner and a due date to each open critical exception now, and escalate through the existing exception path.",
      alternative:
        "Downgrade the severity where the original classification was wrong, with a recorded reason.",
      expectedOutcome: "Every critical exception is owned, actioned and closed.",
      consequenceIfIgnored:
        "A critical exception is an operational or compliance risk the business has already recognised. Leaving it open is a decision to accept that risk without anyone having taken it.",
      metricKey: "exception_critical_open_count",
      affectedCount: exceptions.openCritical,
      financialImpactZAR: null,
      beforeMetrics: {
        openCriticalExceptions: exceptions.openCritical,
        openExceptions: exceptions.open,
        unescalatedOpen: exceptions.unescalatedOpen,
      },
    });
  }

  domains.push(
    domainResult(
      "exceptions",
      exceptionMetrics,
      allFindings.filter((finding) => finding.domain === "exceptions"),
      {
        total: exceptions.total,
        open: exceptions.open,
        openCritical: exceptions.openCritical,
        openHigh: exceptions.openHigh,
        resolved: exceptions.resolved,
        waived: exceptions.waived,
        openOver7Days: exceptions.openOver7Days,
        oldestOpenHours: round(exceptions.oldestOpenHours),
        unescalatedOpen: exceptions.unescalatedOpen,
        byCode: exceptions.byCode.slice(0, context.detailLimit),
        bySeverity: exceptions.bySeverity,
        byOrigin: exceptions.byOrigin,
        worstJobs: exceptions.worstJobs,
      },
      exceptions.total === 0
    )
  );

  // -------------------------------------------------------- 12. Profitability
  const profitability = profitabilityTotals(facts.margins, { listLimit: context.detailLimit });

  const profitabilityMetrics = metricsFor(
    "profitability",
    {
      // NULL, never zero, when no job had both a revenue and a cost.
      profitability_margin_pct_avg: measured(profitability.averageMarginPct, profitability.measurableJobs),
      profitability_negative_margin_count: counted(profitability.negativeMarginJobs),
      profitability_cost_coverage_pct: measured(profitability.costCoveragePct, profitability.jobs),
      profitability_expected_revenue_zar: measured(
        profitability.totalExpectedRevenueZAR,
        profitability.measurableJobs
      ),
    },
    context
  );

  const profitabilityCause = ((): RrRootCause => {
    if (profitability.jobsMissingCost > 0 && profitability.jobsMissingCost >= profitability.measurableJobs) {
      return {
        cause:
          "Most jobs have no captured cost, so profitability cannot be measured for them. This is a data-capture gap, not a margin result.",
        confidence: shareConfidence(profitability.jobsMissingCost, Math.max(profitability.jobs, 1)),
        evidence: [
          `${profitability.jobsMissingCost} of ${profitability.jobs} jobs have no cost record.`,
          `${profitability.measurableJobs} job(s) have both an expected charge and a captured cost.`,
        ],
      };
    }
    if (profitability.negativeMarginJobs > 0) {
      return {
        cause: `${profitability.negativeMarginJobs} job(s) cost more to perform than the rate card allows them to recover.`,
        confidence: shareConfidence(profitability.negativeMarginJobs, Math.max(profitability.measurableJobs, 1)),
        evidence: profitability.worstMargins
          .slice(0, 3)
          .map((entry) => `Job ${entry.serviceJobId} (${entry.serviceCode}): margin ${entry.marginPct}%.`),
      };
    }
    return NO_CAUSE;
  })();

  for (const metric of profitabilityMetrics) {
    if (!breach(metric)) continue;
    allFindings.push(
      findingFrom(metric, {
        cause: profitabilityCause,
        recommendation:
          profitability.jobsMissingCost >= profitability.measurableJobs
            ? "Close the cost-capture gap before drawing any conclusion about margin. A margin computed over a fifth of the jobs is not the operation's margin."
            : "Review the loss-making jobs against their rate cards and the actual work performed. Where the rate genuinely does not cover the service, that is a rate conversation with the counterparty.",
        alternative:
          "Continue at current rates for the remainder of the contract term and revisit at renewal.",
        outcome: "Margin is measurable across the operation and loss-making work is either repriced or declined.",
        consequence:
          "The business keeps taking work it loses money on and cannot tell which work that is.",
        affectedCount: profitability.negativeMarginJobs + profitability.jobsMissingCost,
      })
    );
  }

  domains.push(
    domainResult(
      "profitability",
      profitabilityMetrics,
      allFindings.filter((finding) => finding.domain === "profitability"),
      {
        jobs: profitability.jobs,
        measurableJobs: profitability.measurableJobs,
        jobsMissingCost: profitability.jobsMissingCost,
        jobsMissingRevenue: profitability.jobsMissingRevenue,
        totalExpectedRevenueZAR: profitability.totalExpectedRevenueZAR,
        totalCostZAR: profitability.totalCostZAR,
        totalMarginZAR: profitability.totalMarginZAR,
        negativeMarginJobs: profitability.negativeMarginJobs,
        costCoveragePct: round(profitability.costCoveragePct),
        worstMargins: profitability.worstMargins,
        byServiceCode: profitability.byServiceCode.map((entry) => ({
          ...entry,
          averageMarginPct: round(entry.averageMarginPct),
        })),
        nullNote:
          "Cost and margin are NULL when no cost was captured, never zero. Aggregates cover measurable jobs only, and the unmeasurable ones are counted separately.",
      },
      profitability.jobs === 0
    )
  );

  // ------------------------------------------------------- 13. SLA / Response
  //
  // A PROJECTION, not a separate measurement. It shows every metric alongside the target
  // the tenant configured for it, so the answer to "are we meeting our SLAs" is one
  // screen. When nothing is configured, every row reads NO SLA CONFIGURED — which is the
  // honest state of a customer who has not yet told the system what good looks like.
  const measuredMetrics = domains.flatMap((entry) => entry.metrics);
  const configured = measuredMetrics.filter((metric) => metric.thresholdSource === "configured");
  const breaching = configured.filter(
    (metric) => metric.band === "warning" || metric.band === "critical"
  );

  domains.push(
    domainResult(
      "sla",
      // The SLA view reports the configured metrics themselves rather than inventing
      // metrics of its own, so there is exactly one measurement behind each number.
      configured,
      [],
      {
        configuredCount: configured.length,
        totalMetrics: measuredMetrics.length,
        breachingCount: breaching.length,
        meetingCount: configured.length - breaching.length,
        unconfigured: measuredMetrics
          .filter((metric) => metric.thresholdSource !== "configured")
          .map((metric) => ({ key: metric.key, label: metric.label, value: metric.value, unit: metric.unit })),
        message:
          configured.length === 0
            ? "NO SLA CONFIGURED. No operational targets have been set, so no breach can be reported. Measured values are shown below for every metric; configure targets to enable SLA reporting and health scoring."
            : `${configured.length} of ${measuredMetrics.length} metrics have a configured target. ${breaching.length} are currently breaching.`,
      },
      configured.length === 0
    )
  );

  return { domains, metrics: measuredMetrics, findings: allFindings };
}

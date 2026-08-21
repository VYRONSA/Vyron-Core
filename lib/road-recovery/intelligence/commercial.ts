/**
 * VYRON CORE — Counterparty, Authorisation, Billing Readiness, Distance and
 * Operational Profitability intelligence (Phase 6).
 *
 * PURE. Facts in, deterministic result out.
 *
 * VYRON CORE IS NOT A FINANCE SYSTEM. Nothing here reads or produces an invoice, a
 * payment, a debtor balance or a ledger entry, because VYRON CORE has none of those —
 * VYRON FINANCE owns them. What this file measures is OPERATIONAL: whether a job is ready
 * to be billed, whether the distance behind a charge can be defended, whether the work was
 * authorised, and whether the operation covered its cost. "Expected charge" is an
 * operational estimate sealed by the Phase 5 charge engine; it is never an invoice.
 *
 * MISSING COST IS NULL, NEVER ZERO. A job with no cost record has an UNKNOWN margin, not a
 * 100% margin. Substituting zero would turn an accounting gap into a profitability
 * headline and send a manager to congratulate a branch that has simply not captured costs.
 */

const MS_PER_DAY = 86_400_000;
const MS_PER_MINUTE = 60_000;

function parse(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const value = Date.parse(iso);
  return Number.isFinite(value) ? value : null;
}

function mean(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

// ---------------------------------------------------------------------------
// Authorisation
// ---------------------------------------------------------------------------

/** An authorisation, from rr_authorisations. */
export type RrAuthorisationFact = {
  id: string;
  serviceJobId: string;
  counterpartyId: string;
  counterpartyName: string | null;
  authorisedAmount: number | null;
  authorisedAt: string | null;
  expiresAt: string | null;
  status: string;
};

/** The authorisation-relevant facts of a job. */
export type RrAuthorisationJobFact = {
  serviceJobId: string;
  serviceCode: string;
  requiresAuthorisation: boolean;
  createdAt: string;
  counterpartyId: string | null;
};

export type RrAuthorisationTotals = {
  jobsRequiringAuthorisation: number;
  authorised: number;
  missing: number;
  expired: number;
  voided: number;
  exceeded: number;
  /** null when nothing needed authorising. Never zero. */
  authorisationRatePct: number | null;
  /** null when no job was ever authorised. */
  averageDelayMinutes: number | null;
  worstDelays: Array<{ serviceJobId: string; minutes: number; counterpartyName: string | null }>;
  exceededDetail: Array<{
    serviceJobId: string;
    authorisedAmount: number;
    expectedTotal: number;
    overBy: number;
    counterpartyName: string | null;
  }>;
};

/**
 * Authorisation coverage, delay and over-run.
 *
 * "Exceeded" compares the SEALED expected charge against the authorised ceiling. It is an
 * operational warning that the counterparty has not agreed to the whole amount — the kind
 * of thing that becomes a dispute six weeks later — and not a finance transaction.
 */
export function authorisationTotals(
  jobs: readonly RrAuthorisationJobFact[],
  authorisations: readonly RrAuthorisationFact[],
  expectedTotals: readonly { serviceJobId: string; totalInclVat: number }[],
  input: { asOfIso: string; listLimit: number }
): RrAuthorisationTotals {
  const asOf = parse(input.asOfIso);
  const byJob = new Map<string, RrAuthorisationFact[]>();
  for (const authorisation of authorisations) {
    const bucket = byJob.get(authorisation.serviceJobId);
    if (bucket) bucket.push(authorisation);
    else byJob.set(authorisation.serviceJobId, [authorisation]);
  }

  const totalByJob = new Map(expectedTotals.map((entry) => [entry.serviceJobId, entry.totalInclVat]));
  const required = jobs.filter((job) => job.requiresAuthorisation);

  let authorised = 0;
  let missing = 0;
  let expired = 0;
  let voided = 0;
  const delays: number[] = [];
  const delayDetail: Array<{ serviceJobId: string; minutes: number; counterpartyName: string | null }> = [];
  const exceededDetail: RrAuthorisationTotals["exceededDetail"] = [];

  for (const job of required) {
    const jobAuthorisations = byJob.get(job.serviceJobId) ?? [];
    const active = jobAuthorisations.filter((entry) => entry.status === "active");
    const notExpired = active.filter((entry) => {
      const expiresAt = parse(entry.expiresAt);
      return expiresAt === null || asOf === null || expiresAt > asOf;
    });

    if (notExpired.length > 0) {
      authorised += 1;
      const created = parse(job.createdAt);
      const authorisedAt = notExpired
        .map((entry) => parse(entry.authorisedAt))
        .filter((value): value is number => value !== null)
        .sort((a, b) => a - b)[0];
      if (created !== null && authorisedAt !== undefined && authorisedAt >= created) {
        const minutes = (authorisedAt - created) / MS_PER_MINUTE;
        delays.push(minutes);
        delayDetail.push({
          serviceJobId: job.serviceJobId,
          minutes: Math.round(minutes * 100) / 100,
          counterpartyName: notExpired[0]?.counterpartyName ?? null,
        });
      }

      const ceiling = notExpired
        .map((entry) => entry.authorisedAmount)
        .filter((value): value is number => value !== null && Number.isFinite(value))
        .sort((a, b) => b - a)[0];
      const expected = totalByJob.get(job.serviceJobId);
      if (ceiling !== undefined && expected !== undefined && expected > ceiling) {
        exceededDetail.push({
          serviceJobId: job.serviceJobId,
          authorisedAmount: ceiling,
          expectedTotal: expected,
          overBy: Math.round((expected - ceiling) * 100) / 100,
          counterpartyName: notExpired[0]?.counterpartyName ?? null,
        });
      }
      continue;
    }

    if (active.length > 0) {
      expired += 1;
      continue;
    }
    if (jobAuthorisations.some((entry) => entry.status === "void")) {
      voided += 1;
      continue;
    }
    missing += 1;
  }

  delayDetail.sort((a, b) => {
    if (b.minutes !== a.minutes) return b.minutes - a.minutes;
    return a.serviceJobId < b.serviceJobId ? -1 : a.serviceJobId > b.serviceJobId ? 1 : 0;
  });
  exceededDetail.sort((a, b) => {
    if (b.overBy !== a.overBy) return b.overBy - a.overBy;
    return a.serviceJobId < b.serviceJobId ? -1 : a.serviceJobId > b.serviceJobId ? 1 : 0;
  });

  return {
    jobsRequiringAuthorisation: required.length,
    authorised,
    missing,
    expired,
    voided,
    exceeded: exceededDetail.length,
    authorisationRatePct: required.length === 0 ? null : (authorised / required.length) * 100,
    averageDelayMinutes: mean(delays),
    worstDelays: delayDetail.slice(0, Math.max(0, input.listLimit)),
    exceededDetail: exceededDetail.slice(0, Math.max(0, input.listLimit)),
  };
}

// ---------------------------------------------------------------------------
// Billing readiness
// ---------------------------------------------------------------------------

/** A sealed expected-charge calculation, from rr_charge_calculations. */
export type RrChargeCalculationFact = {
  serviceJobId: string;
  status: string;
  totalInclVat: number;
  subtotalExVat: number;
  missingFacts: string[] | null;
  unratedFacts: string[] | null;
  calculatedAt: string;
};

export type RrBillingReadinessTotals = {
  finishedJobs: number;
  readyJobs: number;
  incompleteJobs: number;
  neverCalculated: number;
  blockedJobs: number;
  /** null when no job finished in the window. Never zero. */
  readyRatePct: number | null;
  /** null when nothing became ready. */
  averageDaysToReadyDays: number | null;
  unratedFactCount: number;
  missingFactCount: number;
  /** The blockers actually seen, most frequent first. */
  topBlockers: Array<{ code: string; count: number }>;
};

/**
 * How much finished work is ready to hand to VYRON FINANCE.
 *
 * The denominator is jobs that FINISHED. A job still on the road is not "not ready to
 * bill"; it is not finished, and counting it as a billing failure would make a busy
 * operation look like a broken one.
 */
export function billingReadinessTotals(
  finishedJobs: readonly { serviceJobId: string; finishedAt: string | null }[],
  calculations: readonly RrChargeCalculationFact[],
  openBillingExceptions: readonly { serviceJobId: string; exceptionCode: string }[]
): RrBillingReadinessTotals {
  const latestByJob = new Map<string, RrChargeCalculationFact>();
  for (const calculation of calculations) {
    const existing = latestByJob.get(calculation.serviceJobId);
    if (!existing) {
      latestByJob.set(calculation.serviceJobId, calculation);
      continue;
    }
    const left = parse(existing.calculatedAt) ?? 0;
    const right = parse(calculation.calculatedAt) ?? 0;
    if (right > left) latestByJob.set(calculation.serviceJobId, calculation);
  }

  const blockedJobIds = new Set(openBillingExceptions.map((entry) => entry.serviceJobId));
  const blockerCounts = new Map<string, number>();
  for (const exception of openBillingExceptions) {
    blockerCounts.set(exception.exceptionCode, (blockerCounts.get(exception.exceptionCode) ?? 0) + 1);
  }

  let ready = 0;
  let incomplete = 0;
  let never = 0;
  let unratedFactCount = 0;
  let missingFactCount = 0;
  const daysToReady: number[] = [];

  for (const job of finishedJobs) {
    const calculation = latestByJob.get(job.serviceJobId);
    if (!calculation) {
      never += 1;
      continue;
    }

    unratedFactCount += calculation.unratedFacts?.length ?? 0;
    missingFactCount += calculation.missingFacts?.length ?? 0;

    if (calculation.status === "complete" && !blockedJobIds.has(job.serviceJobId)) {
      ready += 1;
      const finished = parse(job.finishedAt);
      const calculated = parse(calculation.calculatedAt);
      if (finished !== null && calculated !== null && calculated >= finished) {
        daysToReady.push((calculated - finished) / MS_PER_DAY);
      }
    } else {
      incomplete += 1;
    }
  }

  return {
    finishedJobs: finishedJobs.length,
    readyJobs: ready,
    incompleteJobs: incomplete,
    neverCalculated: never,
    blockedJobs: blockedJobIds.size,
    readyRatePct: finishedJobs.length === 0 ? null : (ready / finishedJobs.length) * 100,
    averageDaysToReadyDays: mean(daysToReady),
    unratedFactCount,
    missingFactCount,
    topBlockers: [...blockerCounts.entries()]
      .map(([code, count]) => ({ code, count }))
      .sort((a, b) => {
        if (b.count !== a.count) return b.count - a.count;
        return a.code < b.code ? -1 : a.code > b.code ? 1 : 0;
      }),
  };
}

// ---------------------------------------------------------------------------
// Distance
// ---------------------------------------------------------------------------

/** A recorded distance fact, from rr_billable_facts where fact_code = tow_distance. */
export type RrDistanceFact = {
  serviceJobId: string;
  quantity: number;
  source: string;
  status: string;
  odometerStartKm: number | null;
  odometerEndKm: number | null;
};

export type RrDistanceTotals = {
  towJobs: number;
  captured: number;
  missingCapture: number;
  odometerCaptured: number;
  estimateOnly: number;
  disputes: number;
  gpsUnavailable: number;
  /** null when no job had BOTH a capture and an estimate to compare. Never zero. */
  averageVariancePct: number | null;
  /** Jobs whose captured distance is furthest from the dispatch estimate. */
  largestVariances: Array<{
    serviceJobId: string;
    capturedKm: number;
    estimatedKm: number;
    variancePct: number;
  }>;
};

/**
 * Distance quality.
 *
 * The ORIGINAL facts are never touched. Variance is computed by COMPARING the driver's
 * captured odometer distance with the dispatch estimate; neither is overwritten, neither
 * is corrected, and a large variance is reported as a question to investigate rather than
 * silently resolved in favour of one source. The odometer reading a driver captured at the
 * roadside is the record that has to survive a dispute months later.
 */
export function distanceTotals(
  towJobs: readonly { serviceJobId: string }[],
  facts: readonly RrDistanceFact[],
  estimates: readonly { serviceJobId: string; distanceKm: number }[],
  disputes: readonly { serviceJobId: string; disputeType: string }[],
  gpsExceptions: readonly { serviceJobId: string }[],
  input: { listLimit: number }
): RrDistanceTotals {
  const liveFacts = facts.filter((fact) => fact.status !== "superseded");
  const factByJob = new Map(liveFacts.map((fact) => [fact.serviceJobId, fact]));
  const estimateByJob = new Map(estimates.map((entry) => [entry.serviceJobId, entry.distanceKm]));

  const variances: Array<{
    serviceJobId: string;
    capturedKm: number;
    estimatedKm: number;
    variancePct: number;
  }> = [];

  for (const job of towJobs) {
    const fact = factByJob.get(job.serviceJobId);
    const estimate = estimateByJob.get(job.serviceJobId);
    if (!fact || estimate === undefined) continue;
    // A zero estimate cannot produce a percentage. Skipping it is honest; dividing by it
    // would manufacture an infinite variance out of a missing dispatch distance.
    if (!Number.isFinite(estimate) || estimate <= 0) continue;
    const variancePct = ((fact.quantity - estimate) / estimate) * 100;
    variances.push({
      serviceJobId: job.serviceJobId,
      capturedKm: fact.quantity,
      estimatedKm: estimate,
      variancePct: Math.round(variancePct * 100) / 100,
    });
  }

  const captured = towJobs.filter((job) => factByJob.has(job.serviceJobId)).length;
  const odometerCaptured = liveFacts.filter(
    (fact) => fact.odometerStartKm !== null && fact.odometerEndKm !== null
  ).length;

  return {
    towJobs: towJobs.length,
    captured,
    missingCapture: towJobs.length - captured,
    odometerCaptured,
    estimateOnly: captured - odometerCaptured < 0 ? 0 : captured - odometerCaptured,
    disputes: disputes.filter((entry) => entry.disputeType === "distance").length,
    gpsUnavailable: new Set(gpsExceptions.map((entry) => entry.serviceJobId)).size,
    averageVariancePct: mean(variances.map((entry) => Math.abs(entry.variancePct))),
    largestVariances: [...variances]
      .sort((a, b) => {
        const left = Math.abs(b.variancePct);
        const right = Math.abs(a.variancePct);
        if (left !== right) return left - right;
        return a.serviceJobId < b.serviceJobId ? -1 : a.serviceJobId > b.serviceJobId ? 1 : 0;
      })
      .slice(0, Math.max(0, input.listLimit)),
  };
}

// ---------------------------------------------------------------------------
// Counterparty
// ---------------------------------------------------------------------------

export type RrCounterpartyStat = {
  counterpartyId: string;
  counterpartyName: string;
  jobs: number;
  authorised: number;
  /** null when this counterparty had no job needing authorisation. */
  authorisationRatePct: number | null;
  disputes: number;
  disputeRatePct: number | null;
  openBillingExceptions: number;
  billingBlockRatePct: number | null;
  /** Sealed expected charge total. Operational estimate, never an invoice. */
  expectedRevenueZAR: number | null;
};

export function counterpartyStats(
  jobs: readonly RrAuthorisationJobFact[],
  authorisations: readonly RrAuthorisationFact[],
  calculations: readonly RrChargeCalculationFact[],
  disputes: readonly { serviceJobId: string }[],
  openBillingExceptions: readonly { serviceJobId: string }[],
  input: { asOfIso: string }
): RrCounterpartyStat[] {
  const asOf = parse(input.asOfIso);
  const names = new Map<string, string>();
  const jobCounterparty = new Map<string, string>();

  for (const authorisation of authorisations) {
    if (authorisation.counterpartyName) names.set(authorisation.counterpartyId, authorisation.counterpartyName);
    jobCounterparty.set(authorisation.serviceJobId, authorisation.counterpartyId);
  }
  for (const job of jobs) {
    if (job.counterpartyId && !jobCounterparty.has(job.serviceJobId)) {
      jobCounterparty.set(job.serviceJobId, job.counterpartyId);
    }
  }

  const totalByJob = new Map<string, number>();
  for (const calculation of calculations) {
    if (calculation.status !== "complete") continue;
    totalByJob.set(calculation.serviceJobId, calculation.totalInclVat);
  }

  const disputeJobs = new Set(disputes.map((entry) => entry.serviceJobId));
  const blockedJobs = new Set(openBillingExceptions.map((entry) => entry.serviceJobId));

  const buckets = new Map<
    string,
    { jobs: Set<string>; requiring: Set<string>; authorised: Set<string>; revenue: number; hasRevenue: boolean }
  >();

  for (const job of jobs) {
    const counterpartyId = jobCounterparty.get(job.serviceJobId);
    if (!counterpartyId) continue;
    const bucket =
      buckets.get(counterpartyId) ??
      { jobs: new Set<string>(), requiring: new Set<string>(), authorised: new Set<string>(), revenue: 0, hasRevenue: false };
    bucket.jobs.add(job.serviceJobId);
    if (job.requiresAuthorisation) bucket.requiring.add(job.serviceJobId);
    const revenue = totalByJob.get(job.serviceJobId);
    if (revenue !== undefined) {
      bucket.revenue += revenue;
      bucket.hasRevenue = true;
    }
    buckets.set(counterpartyId, bucket);
  }

  for (const authorisation of authorisations) {
    if (authorisation.status !== "active") continue;
    const expiresAt = parse(authorisation.expiresAt);
    if (expiresAt !== null && asOf !== null && expiresAt <= asOf) continue;
    const bucket = buckets.get(authorisation.counterpartyId);
    if (bucket) bucket.authorised.add(authorisation.serviceJobId);
  }

  const stats: RrCounterpartyStat[] = [];
  for (const [counterpartyId, bucket] of buckets) {
    const jobIds = [...bucket.jobs];
    const disputeCount = jobIds.filter((id) => disputeJobs.has(id)).length;
    const blockedCount = jobIds.filter((id) => blockedJobs.has(id)).length;
    const requiring = bucket.requiring.size;
    const authorisedCount = [...bucket.requiring].filter((id) => bucket.authorised.has(id)).length;

    stats.push({
      counterpartyId,
      counterpartyName: names.get(counterpartyId) ?? counterpartyId,
      jobs: bucket.jobs.size,
      authorised: authorisedCount,
      authorisationRatePct: requiring === 0 ? null : (authorisedCount / requiring) * 100,
      disputes: disputeCount,
      disputeRatePct: bucket.jobs.size === 0 ? null : (disputeCount / bucket.jobs.size) * 100,
      openBillingExceptions: blockedCount,
      billingBlockRatePct: bucket.jobs.size === 0 ? null : (blockedCount / bucket.jobs.size) * 100,
      // No completed calculation means UNKNOWN expected revenue, not zero revenue.
      expectedRevenueZAR: bucket.hasRevenue ? Math.round(bucket.revenue * 100) / 100 : null,
    });
  }

  return stats.sort((a, b) => {
    if (b.jobs !== a.jobs) return b.jobs - a.jobs;
    return a.counterpartyId < b.counterpartyId ? -1 : a.counterpartyId > b.counterpartyId ? 1 : 0;
  });
}

// ---------------------------------------------------------------------------
// Operational profitability
// ---------------------------------------------------------------------------

/** One row of the rr_job_margin view. `costZAR` is null when no cost was captured. */
export type RrJobMarginFact = {
  serviceJobId: string;
  serviceCode: string;
  expectedRevenueZAR: number | null;
  costZAR: number | null;
  marginZAR: number | null;
  marginPct: number | null;
};

export type RrProfitabilityTotals = {
  jobs: number;
  /** Jobs where BOTH an expected charge and a cost exist. Only these can have a margin. */
  measurableJobs: number;
  jobsMissingCost: number;
  jobsMissingRevenue: number;
  /** null when nothing was measurable. NEVER zero — that would read as break-even. */
  averageMarginPct: number | null;
  totalExpectedRevenueZAR: number | null;
  totalCostZAR: number | null;
  totalMarginZAR: number | null;
  negativeMarginJobs: number;
  /** Share of jobs for which cost data exists at all. A data-quality measure. */
  costCoveragePct: number | null;
  worstMargins: Array<{ serviceJobId: string; serviceCode: string; marginPct: number; marginZAR: number }>;
  byServiceCode: Array<{
    serviceCode: string;
    jobs: number;
    measurableJobs: number;
    averageMarginPct: number | null;
  }>;
};

/**
 * Operational profitability.
 *
 * Every aggregate is computed over MEASURABLE jobs only — those with both an expected
 * charge and a captured cost. A job missing either is counted and reported as missing, and
 * contributes to nothing else. This is the rule that stops an operation with 10% cost
 * capture from reporting a spectacular margin.
 */
export function profitabilityTotals(
  margins: readonly RrJobMarginFact[],
  input: { listLimit: number }
): RrProfitabilityTotals {
  const measurable = margins.filter(
    (entry) =>
      entry.costZAR !== null &&
      entry.expectedRevenueZAR !== null &&
      entry.marginPct !== null &&
      Number.isFinite(entry.marginPct)
  );

  const withCost = margins.filter((entry) => entry.costZAR !== null);
  const missingCost = margins.filter((entry) => entry.costZAR === null).length;
  const missingRevenue = margins.filter((entry) => entry.expectedRevenueZAR === null).length;

  const byService = new Map<string, { jobs: number; measurable: number; marginSum: number }>();
  for (const entry of margins) {
    const bucket = byService.get(entry.serviceCode) ?? { jobs: 0, measurable: 0, marginSum: 0 };
    bucket.jobs += 1;
    if (
      entry.costZAR !== null &&
      entry.expectedRevenueZAR !== null &&
      entry.marginPct !== null &&
      Number.isFinite(entry.marginPct)
    ) {
      bucket.measurable += 1;
      bucket.marginSum += entry.marginPct;
    }
    byService.set(entry.serviceCode, bucket);
  }

  return {
    jobs: margins.length,
    measurableJobs: measurable.length,
    jobsMissingCost: missingCost,
    jobsMissingRevenue: missingRevenue,
    averageMarginPct: mean(measurable.map((entry) => entry.marginPct as number)),
    totalExpectedRevenueZAR:
      measurable.length === 0
        ? null
        : Math.round(measurable.reduce((sum, entry) => sum + (entry.expectedRevenueZAR ?? 0), 0) * 100) / 100,
    totalCostZAR:
      measurable.length === 0
        ? null
        : Math.round(measurable.reduce((sum, entry) => sum + (entry.costZAR ?? 0), 0) * 100) / 100,
    totalMarginZAR:
      measurable.length === 0
        ? null
        : Math.round(measurable.reduce((sum, entry) => sum + (entry.marginZAR ?? 0), 0) * 100) / 100,
    negativeMarginJobs: measurable.filter((entry) => (entry.marginZAR ?? 0) < 0).length,
    costCoveragePct: margins.length === 0 ? null : (withCost.length / margins.length) * 100,
    worstMargins: measurable
      .filter((entry) => (entry.marginPct as number) < 0)
      .map((entry) => ({
        serviceJobId: entry.serviceJobId,
        serviceCode: entry.serviceCode,
        marginPct: Math.round((entry.marginPct as number) * 100) / 100,
        marginZAR: Math.round((entry.marginZAR ?? 0) * 100) / 100,
      }))
      .sort((a, b) => {
        if (a.marginPct !== b.marginPct) return a.marginPct - b.marginPct;
        return a.serviceJobId < b.serviceJobId ? -1 : a.serviceJobId > b.serviceJobId ? 1 : 0;
      })
      .slice(0, Math.max(0, input.listLimit)),
    byServiceCode: [...byService.entries()]
      .map(([serviceCode, bucket]) => ({
        serviceCode,
        jobs: bucket.jobs,
        measurableJobs: bucket.measurable,
        averageMarginPct: bucket.measurable === 0 ? null : bucket.marginSum / bucket.measurable,
      }))
      .sort((a, b) => (a.serviceCode < b.serviceCode ? -1 : a.serviceCode > b.serviceCode ? 1 : 0)),
  };
}

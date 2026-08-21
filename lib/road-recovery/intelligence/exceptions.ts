/**
 * VYRON CORE — Exception intelligence (Phase 6).
 *
 * PURE. Facts in, deterministic result out.
 *
 * Road & Recovery already writes exceptions in two places for good reason:
 * `rr_job_exceptions` records what went wrong ON THE ROAD, and `rr_billing_exceptions`
 * records what stops a finished job being handed to VYRON FINANCE. They stay separate at
 * source because they are resolved by different people. Intelligence reads BOTH, because a
 * manager asking "what is blocking us" does not care which table the answer lives in.
 *
 * The recurrence analysis here is the raw material for root cause: one job with a missing
 * photograph is an incident, the same code on eleven jobs from the same depot is a
 * process failure, and only the second one deserves a manager's morning.
 */

import type { RrSeverity } from "./types";

export type RrExceptionOrigin = "job" | "billing";

/** A normalised exception from either source table. */
export type RrExceptionFact = {
  id: string;
  origin: RrExceptionOrigin;
  serviceJobId: string;
  exceptionCode: string;
  severity: RrSeverity;
  detail: string | null;
  detectedBy: string;
  resolutionStatus: string;
  createdAt: string;
  resolvedAt: string | null;
  /** Set when an exception has already been escalated into the action pipeline. */
  automationActionId: string | null;
};

const MS_PER_HOUR = 3_600_000;
const OPEN_STATUSES = new Set(["open", "acknowledged"]);

function parse(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const value = Date.parse(iso);
  return Number.isFinite(value) ? value : null;
}

function mean(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function isOpenException(exception: RrExceptionFact): boolean {
  return OPEN_STATUSES.has(exception.resolutionStatus);
}

export type RrExceptionCodeStat = {
  exceptionCode: string;
  origin: RrExceptionOrigin;
  total: number;
  open: number;
  critical: number;
  /** Distinct jobs affected. A code hitting many jobs is a process problem. */
  distinctJobs: number;
  /** null when nothing with this code was ever resolved. */
  averageResolutionHours: number | null;
  /** True when the same code affected more than one job in the window. */
  recurring: boolean;
};

export type RrExceptionTotals = {
  total: number;
  open: number;
  openCritical: number;
  openHigh: number;
  resolved: number;
  waived: number;
  /** null when nothing was ever resolved. Never zero. */
  averageResolutionHours: number | null;
  /** Open exceptions older than the ageing bracket, at the as-of instant. */
  openOver7Days: number;
  oldestOpenHours: number | null;
  /** null when there were no exceptions at all. */
  recurrenceRatePct: number | null;
  byCode: RrExceptionCodeStat[];
  bySeverity: Array<{ severity: RrSeverity; total: number; open: number }>;
  byOrigin: Array<{ origin: RrExceptionOrigin; total: number; open: number }>;
  /** Open exceptions that have NOT yet been escalated into the action pipeline. */
  unescalatedOpen: number;
  /** The jobs carrying the most open exceptions. Bounded by the caller. */
  worstJobs: Array<{ serviceJobId: string; openExceptions: number; highestSeverity: RrSeverity }>;
};

const SEVERITY_RANK: Record<RrSeverity, number> = { low: 0, medium: 1, high: 2, critical: 3 };

export function exceptionTotals(
  exceptions: readonly RrExceptionFact[],
  input: { asOfIso: string; listLimit: number }
): RrExceptionTotals {
  const asOf = parse(input.asOfIso);

  const open = exceptions.filter(isOpenException);
  const resolved = exceptions.filter((entry) => entry.resolutionStatus === "resolved");
  const waived = exceptions.filter((entry) => entry.resolutionStatus === "waived");

  const resolutionHours: number[] = [];
  for (const exception of exceptions) {
    const created = parse(exception.createdAt);
    const closed = parse(exception.resolvedAt);
    if (created === null || closed === null || closed < created) continue;
    resolutionHours.push((closed - created) / MS_PER_HOUR);
  }

  const openAges: number[] = [];
  for (const exception of open) {
    const created = parse(exception.createdAt);
    if (created === null || asOf === null || asOf < created) continue;
    openAges.push((asOf - created) / MS_PER_HOUR);
  }

  // Per-code aggregation. Origin is part of the key because the same code name can
  // legitimately exist in both tables and they are resolved by different teams.
  const codeBuckets = new Map<
    string,
    {
      exceptionCode: string;
      origin: RrExceptionOrigin;
      total: number;
      open: number;
      critical: number;
      jobs: Set<string>;
      resolutionHours: number[];
    }
  >();

  for (const exception of exceptions) {
    const key = `${exception.origin}:${exception.exceptionCode}`;
    const bucket =
      codeBuckets.get(key) ??
      {
        exceptionCode: exception.exceptionCode,
        origin: exception.origin,
        total: 0,
        open: 0,
        critical: 0,
        jobs: new Set<string>(),
        resolutionHours: [] as number[],
      };
    bucket.total += 1;
    if (isOpenException(exception)) bucket.open += 1;
    if (exception.severity === "critical") bucket.critical += 1;
    bucket.jobs.add(exception.serviceJobId);

    const created = parse(exception.createdAt);
    const closed = parse(exception.resolvedAt);
    if (created !== null && closed !== null && closed >= created) {
      bucket.resolutionHours.push((closed - created) / MS_PER_HOUR);
    }
    codeBuckets.set(key, bucket);
  }

  const byCode: RrExceptionCodeStat[] = [...codeBuckets.values()]
    .map((bucket) => ({
      exceptionCode: bucket.exceptionCode,
      origin: bucket.origin,
      total: bucket.total,
      open: bucket.open,
      critical: bucket.critical,
      distinctJobs: bucket.jobs.size,
      averageResolutionHours: mean(bucket.resolutionHours),
      recurring: bucket.jobs.size > 1,
    }))
    .sort((a, b) => {
      if (b.open !== a.open) return b.open - a.open;
      if (b.total !== a.total) return b.total - a.total;
      return a.exceptionCode < b.exceptionCode ? -1 : a.exceptionCode > b.exceptionCode ? 1 : 0;
    });

  const recurringExceptions = exceptions.filter((exception) => {
    const bucket = codeBuckets.get(`${exception.origin}:${exception.exceptionCode}`);
    return bucket ? bucket.jobs.size > 1 : false;
  }).length;

  const severities: RrSeverity[] = ["critical", "high", "medium", "low"];
  const origins: RrExceptionOrigin[] = ["job", "billing"];

  const jobBuckets = new Map<string, { openExceptions: number; highestSeverity: RrSeverity }>();
  for (const exception of open) {
    const bucket = jobBuckets.get(exception.serviceJobId) ?? { openExceptions: 0, highestSeverity: "low" as RrSeverity };
    bucket.openExceptions += 1;
    if (SEVERITY_RANK[exception.severity] > SEVERITY_RANK[bucket.highestSeverity]) {
      bucket.highestSeverity = exception.severity;
    }
    jobBuckets.set(exception.serviceJobId, bucket);
  }

  return {
    total: exceptions.length,
    open: open.length,
    openCritical: open.filter((entry) => entry.severity === "critical").length,
    openHigh: open.filter((entry) => entry.severity === "high").length,
    resolved: resolved.length,
    waived: waived.length,
    averageResolutionHours: mean(resolutionHours),
    openOver7Days: openAges.filter((hours) => hours > 168).length,
    oldestOpenHours: openAges.length === 0 ? null : Math.max(...openAges),
    recurrenceRatePct: exceptions.length === 0 ? null : (recurringExceptions / exceptions.length) * 100,
    byCode,
    bySeverity: severities.map((severity) => ({
      severity,
      total: exceptions.filter((entry) => entry.severity === severity).length,
      open: open.filter((entry) => entry.severity === severity).length,
    })),
    byOrigin: origins.map((origin) => ({
      origin,
      total: exceptions.filter((entry) => entry.origin === origin).length,
      open: open.filter((entry) => entry.origin === origin).length,
    })),
    unescalatedOpen: open.filter((entry) => entry.automationActionId === null).length,
    worstJobs: [...jobBuckets.entries()]
      .map(([serviceJobId, bucket]) => ({ serviceJobId, ...bucket }))
      .sort((a, b) => {
        if (b.openExceptions !== a.openExceptions) return b.openExceptions - a.openExceptions;
        const severityDelta = SEVERITY_RANK[b.highestSeverity] - SEVERITY_RANK[a.highestSeverity];
        if (severityDelta !== 0) return severityDelta;
        return a.serviceJobId < b.serviceJobId ? -1 : a.serviceJobId > b.serviceJobId ? 1 : 0;
      })
      .slice(0, Math.max(0, input.listLimit)),
  };
}

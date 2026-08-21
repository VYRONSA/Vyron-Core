/**
 * VYRON CORE — BYSTAND intelligence (Phase 6).
 *
 * PURE. Facts in, deterministic result out.
 *
 * BYSTAND HAS ITS OWN FILE ON PURPOSE.
 *
 * BYSTAND is an attendance service: a truck stands by at a scene, bills for standing time,
 * and may never tow anything. It is not a slow tow, and a BYSTAND job must never be
 * averaged into tow response times, counted as an uncompleted recovery, or measured
 * against a tow target. Keeping the calculation in a separate module with its own input
 * type means a tow function cannot accidentally be handed BYSTAND jobs — the separation is
 * structural rather than a comment asking future code to be careful.
 *
 * If a BYSTAND attendance is converted into a recovery, the conversion creates a SEPARATE
 * service job. That recovery job is measured as a tow, on its own clock; the BYSTAND
 * attendance keeps its own standing time. Neither one absorbs the other.
 *
 * Every duration here comes from the SEALED `rr_standby_summary`. The standing clock was
 * settled once, by the standby timer, under a recorded calculator version. Intelligence
 * reads that seal; it never re-derives standing time from raw events, because a number
 * that has already been billed must not change when a report is re-opened.
 */

/** The sealed BYSTAND result, exactly as rr_standby_summary stores it. */
export type RrStandbySummaryFact = {
  serviceJobId: string;
  sealedReason: string;
  sealedAt: string;
  totalBillableSeconds: number;
  totalPausedSeconds: number;
  standingIntervalCount: number;
  pausedIntervalCount: number;
  timeToSceneSeconds: number | null;
  standDownResponseSeconds: number | null;
  calculatorVersion: string;
  anomalies: unknown;
};

/** The BYSTAND-specific detail row, from rr_bystand_details. */
export type RrBystandDetailFact = {
  serviceJobId: string;
  reasonCodeId: string | null;
  reasonCode: string | null;
  reasonLabel: string | null;
  requestingAuthority: string | null;
  convertedServiceJobId: string | null;
  convertedAt: string | null;
  conversionReason: string | null;
  reportSubmittedAt: string | null;
};

function mean(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export type RrBystandTotals = {
  attendances: number;
  sealedAttendances: number;
  /** null when nothing was sealed. Never zero. */
  averageStandingSeconds: number | null;
  averagePausedSeconds: number | null;
  totalStandingSeconds: number;
  totalPausedSeconds: number;
  /** null when no attendance recorded a time to scene. */
  averageTimeToSceneSeconds: number | null;
  averageStandDownResponseSeconds: number | null;
  /** Paused time as a share of all attendance time. null when nothing was sealed. */
  pausedRatioPct: number | null;
  attendancesWithAnomalies: number;
  /** Attendances that later became a separate recovery job. */
  converted: number;
  /** null when there were no attendances at all. */
  conversionRatePct: number | null;
  /** Sealed attendances that never produced a report. */
  missingReports: number;
  reasonBreakdown: Array<{ reasonCode: string; label: string; count: number }>;
  authorityBreakdown: Array<{ authority: string; count: number }>;
};

function hasAnomalies(value: unknown): boolean {
  if (Array.isArray(value)) return value.length > 0;
  if (value && typeof value === "object") return Object.keys(value as object).length > 0;
  return false;
}

/**
 * Aggregates BYSTAND attendance.
 *
 * `summaries` must contain ONLY sealed BYSTAND summaries and `details` ONLY BYSTAND detail
 * rows. Nothing here can be reached from a tow job, because a tow has neither.
 */
export function bystandTotals(
  summaries: readonly RrStandbySummaryFact[],
  details: readonly RrBystandDetailFact[]
): RrBystandTotals {
  const standing = summaries.map((entry) => entry.totalBillableSeconds).filter((value) => value >= 0);
  const paused = summaries.map((entry) => entry.totalPausedSeconds).filter((value) => value >= 0);
  const toScene = summaries
    .map((entry) => entry.timeToSceneSeconds)
    .filter((value): value is number => value !== null && value >= 0);
  const standDown = summaries
    .map((entry) => entry.standDownResponseSeconds)
    .filter((value): value is number => value !== null && value >= 0);

  const totalStanding = standing.reduce((sum, value) => sum + value, 0);
  const totalPaused = paused.reduce((sum, value) => sum + value, 0);
  const attendanceSeconds = totalStanding + totalPaused;

  const reasons = new Map<string, { label: string; count: number }>();
  const authorities = new Map<string, number>();
  let converted = 0;

  for (const detail of details) {
    if (detail.convertedServiceJobId) converted += 1;

    const code = (detail.reasonCode ?? "").trim() || "unrecorded";
    const existing = reasons.get(code);
    if (existing) existing.count += 1;
    else reasons.set(code, { label: (detail.reasonLabel ?? "").trim() || code, count: 1 });

    const authority = (detail.requestingAuthority ?? "").trim() || "unrecorded";
    authorities.set(authority, (authorities.get(authority) ?? 0) + 1);
  }

  const sealedIds = new Set(summaries.map((entry) => entry.serviceJobId));
  const missingReports = details.filter(
    (detail) => sealedIds.has(detail.serviceJobId) && !detail.reportSubmittedAt
  ).length;

  return {
    attendances: details.length,
    sealedAttendances: summaries.length,
    averageStandingSeconds: mean(standing),
    averagePausedSeconds: mean(paused),
    totalStandingSeconds: totalStanding,
    totalPausedSeconds: totalPaused,
    averageTimeToSceneSeconds: mean(toScene),
    averageStandDownResponseSeconds: mean(standDown),
    pausedRatioPct: attendanceSeconds === 0 ? null : (totalPaused / attendanceSeconds) * 100,
    attendancesWithAnomalies: summaries.filter((entry) => hasAnomalies(entry.anomalies)).length,
    converted,
    conversionRatePct: details.length === 0 ? null : (converted / details.length) * 100,
    missingReports,
    reasonBreakdown: [...reasons.entries()]
      .map(([reasonCode, entry]) => ({ reasonCode, label: entry.label, count: entry.count }))
      .sort((a, b) => {
        if (b.count !== a.count) return b.count - a.count;
        return a.reasonCode < b.reasonCode ? -1 : a.reasonCode > b.reasonCode ? 1 : 0;
      }),
    authorityBreakdown: [...authorities.entries()]
      .map(([authority, count]) => ({ authority, count }))
      .sort((a, b) => {
        if (b.count !== a.count) return b.count - a.count;
        return a.authority < b.authority ? -1 : a.authority > b.authority ? 1 : 0;
      }),
  };
}

/**
 * Guard used by the domain layer and asserted directly by the BYSTAND separation tests.
 *
 * Any job whose workflow is `bystand` belongs to BYSTAND intelligence and must never
 * appear in a tow sample. This is deliberately a hard predicate rather than a filter that
 * silently drops rows: the caller either separates the two populations or the assertion
 * tells it that it did not.
 */
export function isBystandWorkflow(workflowKey: string): boolean {
  return workflowKey === "bystand";
}

/** Throws if a tow population has been contaminated with BYSTAND jobs. */
export function assertNoBystandJobs(
  jobs: readonly { serviceJobId: string; workflowKey: string }[],
  context: string
): void {
  const contaminated = jobs.filter((job) => isBystandWorkflow(job.workflowKey));
  if (contaminated.length > 0) {
    throw new Error(
      `${context}: ${contaminated.length} BYSTAND job(s) reached a tow calculation. BYSTAND attendance is never measured as a tow. Offending jobs: ${contaminated
        .slice(0, 5)
        .map((job) => job.serviceJobId)
        .join(", ")}`
    );
  }
}

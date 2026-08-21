/**
 * VYRON CORE — Road & Recovery timing intelligence (Phase 6).
 *
 * PURE. Facts in, deterministic result out. No Supabase, no clock, no randomness.
 *
 * Every duration here is derived from `rr_service_state_events`, which is append-only and
 * already records `seconds_in_previous_state` at the moment of each transition. That
 * matters: the operational clock is read from what was recorded when it happened, not
 * recomputed later against a different notion of "now".
 *
 * Semantic ROLES, never state names. `stateForRole(workflowKey, "arrival")` answers
 * `on_scene` for a tow and `arrived_on_scene` for BYSTAND, so nothing in this file needs
 * to know which service it is looking at — the mistake that would silently classify a
 * BYSTAND attendance as a tow response.
 */

import { isTerminalState, stateForRole } from "@/lib/road-recovery/state-machine";

/** One recorded transition, exactly as rr_service_state_events stores it. */
export type RrStateEventFact = {
  serviceJobId: string;
  workflowKey: string;
  workflowVersion: number | null;
  fromState: string | null;
  toState: string;
  occurredAt: string;
  secondsInPreviousState: number | null;
};

/** The job facts timing needs. */
export type RrJobTimingFact = {
  serviceJobId: string;
  workflowKey: string;
  workflowVersion: number | null;
  serviceCode: string;
  counterpartyId: string | null;
  createdAt: string;
  serviceState: string;
};

export type RrDurationSample = {
  serviceJobId: string;
  serviceCode: string;
  counterpartyId: string | null;
  /** Duration in seconds. Always >= 0. */
  seconds: number;
};

/**
 * Descriptive statistics over a sample.
 *
 * `null` everywhere when the sample is empty — never zero. A period in which nobody was
 * dispatched has no response time, and reporting 0 minutes would read as instant service.
 */
export type RrDurationStats = {
  count: number;
  averageSeconds: number | null;
  medianSeconds: number | null;
  p90Seconds: number | null;
  worstSeconds: number | null;
  bestSeconds: number | null;
};

const EMPTY_STATS: RrDurationStats = {
  count: 0,
  averageSeconds: null,
  medianSeconds: null,
  p90Seconds: null,
  worstSeconds: null,
  bestSeconds: null,
};

function parse(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const value = Date.parse(iso);
  return Number.isFinite(value) ? value : null;
}

/**
 * Sorts events into a stable, deterministic order.
 *
 * Two events can share an instant — a transition recorded in the same millisecond as
 * another — so `occurred_at` alone is not a total order. Falling back to the state name
 * keeps the sequence identical across runs, which is what makes a replayed calculation
 * match the original.
 */
function chronological(events: readonly RrStateEventFact[]): RrStateEventFact[] {
  return [...events].sort((a, b) => {
    const left = parse(a.occurredAt) ?? 0;
    const right = parse(b.occurredAt) ?? 0;
    if (left !== right) return left - right;
    return a.toState < b.toState ? -1 : a.toState > b.toState ? 1 : 0;
  });
}

export function groupEventsByJob(
  events: readonly RrStateEventFact[]
): Map<string, RrStateEventFact[]> {
  const grouped = new Map<string, RrStateEventFact[]>();
  for (const event of events) {
    const bucket = grouped.get(event.serviceJobId);
    if (bucket) bucket.push(event);
    else grouped.set(event.serviceJobId, [event]);
  }
  for (const [jobId, bucket] of grouped) grouped.set(jobId, chronological(bucket));
  return grouped;
}

/** Percentile over a sorted ascending array, linear interpolation. Null when empty. */
function percentile(sorted: readonly number[], fraction: number): number | null {
  if (sorted.length === 0) return null;
  if (sorted.length === 1) return sorted[0];
  const position = (sorted.length - 1) * fraction;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
}

export function durationStats(samples: readonly RrDurationSample[]): RrDurationStats {
  if (samples.length === 0) return EMPTY_STATS;
  const sorted = samples.map((sample) => sample.seconds).sort((a, b) => a - b);
  const total = sorted.reduce((sum, value) => sum + value, 0);
  return {
    count: sorted.length,
    averageSeconds: total / sorted.length,
    medianSeconds: percentile(sorted, 0.5),
    p90Seconds: percentile(sorted, 0.9),
    worstSeconds: sorted[sorted.length - 1],
    bestSeconds: sorted[0],
  };
}

export function secondsToMinutes(seconds: number | null): number | null {
  return seconds === null ? null : seconds / 60;
}

export function secondsToHours(seconds: number | null): number | null {
  return seconds === null ? null : seconds / 3600;
}

/**
 * Response time to scene: the moment travel began until arrival was recorded.
 *
 * A job that never reached the arrival state contributes NOTHING rather than an open-ended
 * duration measured against "now". Counting an in-flight job as if it had already arrived
 * would understate response time; counting it against the current clock would make the
 * same historical period report a different number every time it is opened.
 */
export function responseToSceneSamples(
  jobs: readonly RrJobTimingFact[],
  events: readonly RrStateEventFact[]
): RrDurationSample[] {
  const byJob = groupEventsByJob(events);
  const samples: RrDurationSample[] = [];

  for (const job of jobs) {
    const travelState = stateForRole(job.workflowKey, "travel", job.workflowVersion);
    const arrivalState = stateForRole(job.workflowKey, "arrival", job.workflowVersion);
    if (!travelState || !arrivalState) continue;

    const jobEvents = byJob.get(job.serviceJobId);
    if (!jobEvents) continue;

    const travelEntry = jobEvents.find((event) => event.toState === travelState);
    const arrivalEntry = jobEvents.find((event) => event.toState === arrivalState);
    if (!travelEntry || !arrivalEntry) continue;

    const start = parse(travelEntry.occurredAt);
    const end = parse(arrivalEntry.occurredAt);
    if (start === null || end === null || end < start) continue;

    samples.push({
      serviceJobId: job.serviceJobId,
      serviceCode: job.serviceCode,
      counterpartyId: job.counterpartyId,
      seconds: (end - start) / 1000,
    });
  }

  return samples;
}

/**
 * Time spent on scene, taken from the recorded `seconds_in_previous_state` of the
 * transition that LEFT the arrival state.
 *
 * Reading the recorded value rather than subtracting timestamps means the number matches
 * what the operational clock actually measured at the time, including any correction the
 * transition recorded.
 */
export function timeOnSceneSamples(
  jobs: readonly RrJobTimingFact[],
  events: readonly RrStateEventFact[]
): RrDurationSample[] {
  const byJob = groupEventsByJob(events);
  const samples: RrDurationSample[] = [];

  for (const job of jobs) {
    const arrivalState = stateForRole(job.workflowKey, "arrival", job.workflowVersion);
    if (!arrivalState) continue;

    const jobEvents = byJob.get(job.serviceJobId);
    if (!jobEvents) continue;

    const departure = jobEvents.find(
      (event) => event.fromState === arrivalState && event.secondsInPreviousState !== null
    );
    if (!departure || departure.secondsInPreviousState === null) continue;
    if (departure.secondsInPreviousState < 0) continue;

    samples.push({
      serviceJobId: job.serviceJobId,
      serviceCode: job.serviceCode,
      counterpartyId: job.counterpartyId,
      seconds: departure.secondsInPreviousState,
    });
  }

  return samples;
}

/** Job creation until the job reached a terminal state. Open jobs are excluded. */
export function cycleTimeSamples(
  jobs: readonly RrJobTimingFact[],
  events: readonly RrStateEventFact[]
): RrDurationSample[] {
  const byJob = groupEventsByJob(events);
  const samples: RrDurationSample[] = [];

  for (const job of jobs) {
    const jobEvents = byJob.get(job.serviceJobId);
    if (!jobEvents) continue;

    const terminal = jobEvents.find((event) =>
      isTerminalState(job.workflowKey, event.toState, job.workflowVersion)
    );
    if (!terminal) continue;

    const start = parse(job.createdAt);
    const end = parse(terminal.occurredAt);
    if (start === null || end === null || end < start) continue;

    samples.push({
      serviceJobId: job.serviceJobId,
      serviceCode: job.serviceCode,
      counterpartyId: job.counterpartyId,
      seconds: (end - start) / 1000,
    });
  }

  return samples;
}

export type RrCompletionCounts = {
  completed: number;
  cancelled: number;
  open: number;
  /** null when no job in the window reached any terminal state. */
  completionRatePct: number | null;
};

/**
 * Completion versus cancellation.
 *
 * The rate is measured over jobs that actually FINISHED. Including open jobs in the
 * denominator would make a busy day look like a failing one purely because work is still
 * in progress.
 */
export function completionCounts(
  jobs: readonly RrJobTimingFact[],
  events: readonly RrStateEventFact[],
  cancelledStates: (workflowKey: string, state: string) => boolean
): RrCompletionCounts {
  const byJob = groupEventsByJob(events);
  let completed = 0;
  let cancelled = 0;
  let open = 0;

  for (const job of jobs) {
    const jobEvents = byJob.get(job.serviceJobId) ?? [];
    const terminal = jobEvents.find((event) =>
      isTerminalState(job.workflowKey, event.toState, job.workflowVersion)
    );
    if (!terminal) {
      open += 1;
      continue;
    }
    if (cancelledStates(job.workflowKey, terminal.toState)) cancelled += 1;
    else completed += 1;
  }

  const finished = completed + cancelled;
  return {
    completed,
    cancelled,
    open,
    completionRatePct: finished === 0 ? null : (completed / finished) * 100,
  };
}

/** Groups samples by service code, for per-service targets. */
export function samplesByServiceCode(
  samples: readonly RrDurationSample[]
): Map<string, RrDurationSample[]> {
  const grouped = new Map<string, RrDurationSample[]>();
  for (const sample of samples) {
    const bucket = grouped.get(sample.serviceCode);
    if (bucket) bucket.push(sample);
    else grouped.set(sample.serviceCode, [sample]);
  }
  return grouped;
}

/** The slowest jobs in a sample, for "which jobs actually caused this" evidence. */
export function worstOffenders(
  samples: readonly RrDurationSample[],
  limit: number
): RrDurationSample[] {
  return [...samples]
    .sort((a, b) => {
      if (b.seconds !== a.seconds) return b.seconds - a.seconds;
      return a.serviceJobId < b.serviceJobId ? -1 : a.serviceJobId > b.serviceJobId ? 1 : 0;
    })
    .slice(0, Math.max(0, limit));
}

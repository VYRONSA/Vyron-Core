/**
 * VYRON CORE — BYSTAND standby timer (Phase 2).
 *
 * PURE MODULE. No Supabase, no fetch, no environment, and no clock reads — "now" is
 * supplied by the caller. That is what makes billable time reproducible: the same event
 * stream always yields the same number, and a test needs no fakes.
 *
 * ---------------------------------------------------------------------------
 * WHAT IS BILLABLE
 * ---------------------------------------------------------------------------
 *
 * Billable standing time is the time spent in the workflow's single
 * `billable_standing_clock` state — `standing_by` — and NOTHING else. Time spent
 * assigned, travelling, arrived-but-not-yet-standing, stood down, departing or writing
 * the report is NOT billable standing time, and the elapsed duration of the job is not
 * the billing clock.
 *
 * The input is public.rr_service_state_events, which Phase 0 already stamps with
 * `enters_billable_standing_clock` / `leaves_billable_standing_clock` on every
 * transition. Those flags are computed by the state machine from the workflow
 * definition, so this calculator never needs to know a state name.
 *
 * ---------------------------------------------------------------------------
 * SERVER TIME ONLY
 * ---------------------------------------------------------------------------
 *
 * `occurredAt` must be the SERVER timestamp recorded on the transition. A client-supplied
 * time may be carried alongside as telemetry, but it must never reach this function:
 * a device with a wrong clock (or a driver who sets one) would otherwise change what a
 * counterparty is billed.
 */

/** Bumped whenever the calculation changes; stamped onto every sealed summary. */
export const RR_STANDBY_CALCULATOR_VERSION = "rr-standby-1.0.0";

/** The subset of a state event this calculator needs. */
export type RrStandbyEvent = {
  /** SERVER timestamp (ISO 8601). */
  occurredAt: string;
  fromState: string | null;
  toState: string;
  entersBillableStandingClock: boolean;
  leavesBillableStandingClock: boolean;
};

export type RrStandbyInterval = {
  startedAt: string;
  /** Null while the crew is still standing by. */
  endedAt: string | null;
  seconds: number;
  open: boolean;
};

export type RrPausedInterval = {
  startedAt: string;
  endedAt: string | null;
  seconds: number;
  /** The paused state the crew was held in, e.g. scene_handover_to_authority. */
  state: string;
  open: boolean;
};

/** Anomalies are reported, never silently swallowed — billing must be explainable. */
export type RrStandbyAnomaly = {
  code:
    | "unordered_events"
    | "enter_without_close"
    | "leave_without_open"
    | "negative_interval"
    | "unparseable_timestamp"
    | "open_interval_without_now";
  detail: string;
};

export type RrStandbyComputation = {
  totalBillableSeconds: number;
  totalPausedSeconds: number;
  intervals: RrStandbyInterval[];
  pausedIntervals: RrPausedInterval[];
  /** True while the crew is still standing by (the final interval is open). */
  standingNow: boolean;
  firstStandingAt: string | null;
  lastStandingEndedAt: string | null;
  anomalies: RrStandbyAnomaly[];
  calculatorVersion: string;
};

function parseTime(value: string | null | undefined): number | null {
  if (!value) return null;
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? ms : null;
}

function secondsBetween(startMs: number, endMs: number): number {
  return Math.round((endMs - startMs) / 1000);
}

export type ComputeStandbyInput = {
  events: readonly RrStandbyEvent[];
  /**
   * States in which the standing clock is PAUSED rather than stopped, from the workflow
   * definition. Supplied rather than hardcoded so this stays workflow-agnostic.
   */
  pausedStates?: readonly string[];
  /** Caller-supplied "now", used only to extend a still-open standing interval. */
  now?: string | null;
};

/**
 * Computes billable standing time, paused time and the interval breakdown.
 *
 * Robust by construction:
 *   - events are sorted by server time (a stable sort, so equal stamps keep their order)
 *   - a second ENTER while already open is ignored and reported
 *   - a LEAVE with nothing open is ignored and reported
 *   - a negative interval contributes ZERO and is reported, never a negative bill
 *   - a zero-length interval is kept (it is a real, if instantaneous, event)
 *   - an open interval is extended to `now` when supplied, and reported when not
 */
export function computeStandbyTime(input: ComputeStandbyInput): RrStandbyComputation {
  const anomalies: RrStandbyAnomaly[] = [];
  const pausedStates = new Set(input.pausedStates ?? []);

  const decorated = input.events.map((event, index) => ({
    event,
    index,
    ms: parseTime(event.occurredAt),
  }));

  for (const entry of decorated) {
    if (entry.ms === null) {
      anomalies.push({
        code: "unparseable_timestamp",
        detail: `Event ${entry.index} has an unusable occurredAt (${entry.event.occurredAt}); it was ignored.`,
      });
    }
  }

  const usable = decorated.filter((entry) => entry.ms !== null) as {
    event: RrStandbyEvent;
    index: number;
    ms: number;
  }[];

  // Detect out-of-order input BEFORE sorting, so a malformed stream is visible rather
  // than quietly corrected.
  for (let i = 1; i < usable.length; i += 1) {
    if (usable[i].ms < usable[i - 1].ms) {
      anomalies.push({
        code: "unordered_events",
        detail: "Events were not in server-time order; they were sorted before calculation.",
      });
      break;
    }
  }

  const ordered = [...usable].sort((a, b) => (a.ms === b.ms ? a.index - b.index : a.ms - b.ms));

  const intervals: RrStandbyInterval[] = [];
  const pausedIntervals: RrPausedInterval[] = [];

  let openStartMs: number | null = null;
  let openStartIso: string | null = null;
  let openPause: { startedMs: number; startedAt: string; state: string } | null = null;

  const closePause = (endMs: number, endIso: string) => {
    if (!openPause) return;
    let seconds = secondsBetween(openPause.startedMs, endMs);
    if (seconds < 0) {
      anomalies.push({
        code: "negative_interval",
        detail: `A paused interval starting ${openPause.startedAt} ended earlier than it began; counted as zero.`,
      });
      seconds = 0;
    }
    pausedIntervals.push({
      startedAt: openPause.startedAt,
      endedAt: endIso,
      seconds,
      state: openPause.state,
      open: false,
    });
    openPause = null;
  };

  for (const { event, ms } of ordered) {
    if (event.entersBillableStandingClock) {
      // Entering standing time always ends any pause that was running.
      closePause(ms, event.occurredAt);

      if (openStartMs !== null) {
        anomalies.push({
          code: "enter_without_close",
          detail: `Standing time was already running at ${event.occurredAt}; the duplicate start was ignored.`,
        });
        continue;
      }
      openStartMs = ms;
      openStartIso = event.occurredAt;
      continue;
    }

    if (event.leavesBillableStandingClock) {
      if (openStartMs === null || openStartIso === null) {
        anomalies.push({
          code: "leave_without_open",
          detail: `Standing time ended at ${event.occurredAt} without having started; the event was ignored.`,
        });
      } else {
        let seconds = secondsBetween(openStartMs, ms);
        if (seconds < 0) {
          anomalies.push({
            code: "negative_interval",
            detail: `A standing interval starting ${openStartIso} ended earlier than it began; counted as zero.`,
          });
          seconds = 0;
        }
        intervals.push({
          startedAt: openStartIso,
          endedAt: event.occurredAt,
          seconds,
          open: false,
        });
        openStartMs = null;
        openStartIso = null;
      }

      // Leaving INTO a paused state starts non-billable paused time. Leaving into any
      // other state (stand-down, conversion, cancellation) simply stops the clock.
      if (pausedStates.has(event.toState)) {
        openPause = { startedMs: ms, startedAt: event.occurredAt, state: event.toState };
      }
      continue;
    }

    // A transition that neither starts nor stops standing time still ends a pause if it
    // moves the job out of the paused state (for example a paused crew stood down).
    if (openPause && event.fromState === openPause.state) {
      closePause(ms, event.occurredAt);
    }
  }

  // Still standing?
  let standingNow = false;
  if (openStartMs !== null && openStartIso !== null) {
    const nowMs = parseTime(input.now ?? null);
    if (nowMs === null) {
      anomalies.push({
        code: "open_interval_without_now",
        detail: `Standing time is still running from ${openStartIso}; supply "now" to include it.`,
      });
      intervals.push({ startedAt: openStartIso, endedAt: null, seconds: 0, open: true });
    } else {
      let seconds = secondsBetween(openStartMs, nowMs);
      if (seconds < 0) {
        anomalies.push({
          code: "negative_interval",
          detail: `"now" precedes the open standing interval starting ${openStartIso}; counted as zero.`,
        });
        seconds = 0;
      }
      intervals.push({ startedAt: openStartIso, endedAt: null, seconds, open: true });
    }
    standingNow = true;
  }

  // Still paused?
  if (openPause) {
    const nowMs = parseTime(input.now ?? null);
    const seconds = nowMs === null ? 0 : Math.max(0, secondsBetween(openPause.startedMs, nowMs));
    pausedIntervals.push({
      startedAt: openPause.startedAt,
      endedAt: null,
      seconds,
      state: openPause.state,
      open: true,
    });
  }

  const totalBillableSeconds = intervals.reduce((sum, entry) => sum + entry.seconds, 0);
  const totalPausedSeconds = pausedIntervals.reduce((sum, entry) => sum + entry.seconds, 0);

  const closed = intervals.filter((entry) => !entry.open);

  return {
    totalBillableSeconds,
    totalPausedSeconds,
    intervals,
    pausedIntervals,
    standingNow,
    firstStandingAt: intervals[0]?.startedAt ?? null,
    lastStandingEndedAt: closed.length ? (closed[closed.length - 1].endedAt ?? null) : null,
    anomalies,
    calculatorVersion: RR_STANDBY_CALCULATOR_VERSION,
  };
}

// ---------------------------------------------------------------------------
// SLA-lite operational measurements
// ---------------------------------------------------------------------------

/**
 * BYSTAND operational timings. Deliberately NOT an SLA engine: there are no targets, no
 * policies and no breach rules. Two measurements only, because a bystand attendance
 * delivers nothing and therefore has no delivery milestone.
 */
export type RrBystandTimings = {
  /** Assignment to GPS-verified scene arrival. */
  timeToSceneSeconds: number | null;
  /** Stand-down request to stand-down confirmed. */
  standDownResponseSeconds: number | null;
  assignedAt: string | null;
  arrivedAt: string | null;
  standDownRequestedAt: string | null;
  stoodDownAt: string | null;
};

export type RrTimingEvent = {
  occurredAt: string;
  toState: string;
  transitionCode: string;
};

export function computeBystandTimings(
  events: readonly RrTimingEvent[],
  roles: { offer?: string | null; arrival?: string | null } = {}
): RrBystandTimings {
  const ordered = [...events]
    .filter((event) => parseTime(event.occurredAt) !== null)
    .sort((a, b) => (parseTime(a.occurredAt) ?? 0) - (parseTime(b.occurredAt) ?? 0));

  const firstInto = (stateName: string | null | undefined) =>
    stateName ? (ordered.find((event) => event.toState === stateName)?.occurredAt ?? null) : null;

  const assignedAt = firstInto(roles.offer ?? "assigned");
  const arrivedAt = firstInto(roles.arrival ?? "arrived_on_scene");
  const standDownRequestedAt = firstInto("stand_down_requested");
  const stoodDownAt = firstInto("stood_down");

  const gap = (from: string | null, to: string | null): number | null => {
    const a = parseTime(from);
    const b = parseTime(to);
    if (a === null || b === null) return null;
    const seconds = secondsBetween(a, b);
    return seconds < 0 ? null : seconds;
  };

  return {
    timeToSceneSeconds: gap(assignedAt, arrivedAt),
    standDownResponseSeconds: gap(standDownRequestedAt, stoodDownAt),
    assignedAt,
    arrivedAt,
    standDownRequestedAt,
    stoodDownAt,
  };
}

/** Human-readable duration for the board and the driver app. */
export function formatStandbyDuration(totalSeconds: number): string {
  const safe = Math.max(0, Math.round(totalSeconds));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const seconds = safe % 60;
  if (hours > 0) return `${hours}h ${String(minutes).padStart(2, "0")}m`;
  if (minutes > 0) return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
  return `${seconds}s`;
}

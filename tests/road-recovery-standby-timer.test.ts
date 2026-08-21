/**
 * BYSTAND standby timer (Phase 2).
 *
 * The calculator is pure, so these tests exercise the real production logic with no
 * database and no clock. What is being protected:
 *
 *   1. billable time is the time spent STANDING BY, and nothing else
 *   2. paused time is excluded from billable time, always
 *   3. malformed input degrades safely and VISIBLY (anomalies), never into a wrong bill
 *   4. the same events always produce the same number
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  computeBystandTimings,
  computeStandbyTime,
  formatStandbyDuration,
  RR_STANDBY_CALCULATOR_VERSION,
  type RrStandbyEvent,
} from "@/lib/road-recovery/standby-timer";

const PAUSED = ["scene_handover_to_authority", "weather_hold"];

function at(minutes: number): string {
  return new Date(Date.UTC(2026, 7, 18, 6, minutes, 0)).toISOString();
}

function enter(minutes: number, from = "arrived_on_scene"): RrStandbyEvent {
  return {
    occurredAt: at(minutes),
    fromState: from,
    toState: "standing_by",
    entersBillableStandingClock: true,
    leavesBillableStandingClock: false,
  };
}

function leave(minutes: number, to: string): RrStandbyEvent {
  return {
    occurredAt: at(minutes),
    fromState: "standing_by",
    toState: to,
    entersBillableStandingClock: false,
    leavesBillableStandingClock: true,
  };
}

function plain(minutes: number, from: string, to: string): RrStandbyEvent {
  return {
    occurredAt: at(minutes),
    fromState: from,
    toState: to,
    entersBillableStandingClock: false,
    leavesBillableStandingClock: false,
  };
}

describe("standby timer — the approved worked example", () => {
  it("bills 50 minutes and excludes the 10 paused minutes", () => {
    // Stand 30 -> pause 10 -> resume, stand 20 -> stand-down.
    const result = computeStandbyTime({
      events: [
        enter(0),
        leave(30, "scene_handover_to_authority"),
        enter(40, "scene_handover_to_authority"),
        leave(60, "stand_down_requested"),
      ],
      pausedStates: PAUSED,
      now: at(90),
    });

    assert.equal(result.totalBillableSeconds, 50 * 60, "billable must be 50 minutes");
    assert.equal(result.totalPausedSeconds, 10 * 60, "paused must be 10 minutes");
    assert.equal(result.intervals.length, 2);
    assert.equal(result.pausedIntervals.length, 1);
    assert.equal(result.standingNow, false);
    assert.deepEqual(result.anomalies, []);
  });

  it("does not bill the whole elapsed job duration", () => {
    const result = computeStandbyTime({
      events: [
        enter(0),
        leave(30, "scene_handover_to_authority"),
        enter(40, "scene_handover_to_authority"),
        leave(60, "stand_down_requested"),
      ],
      pausedStates: PAUSED,
      now: at(90),
    });
    // Elapsed from first standing to now is 90 minutes; billable is 50.
    assert.notEqual(result.totalBillableSeconds, 90 * 60);
    assert.equal(result.totalBillableSeconds, 3000);
  });
});

describe("standby timer — core behaviour", () => {
  it("bills a single closed interval", () => {
    const result = computeStandbyTime({
      events: [enter(0), leave(45, "stand_down_requested")],
      pausedStates: PAUSED,
    });
    assert.equal(result.totalBillableSeconds, 45 * 60);
    assert.equal(result.totalPausedSeconds, 0);
  });

  it("extends an open interval to the supplied now", () => {
    const result = computeStandbyTime({
      events: [enter(0)],
      pausedStates: PAUSED,
      now: at(25),
    });
    assert.equal(result.totalBillableSeconds, 25 * 60);
    assert.equal(result.standingNow, true);
    assert.equal(result.intervals[0].open, true);
    assert.equal(result.intervals[0].endedAt, null);
  });

  it("reports an open interval when no now is supplied, and bills nothing for it", () => {
    const result = computeStandbyTime({ events: [enter(0)], pausedStates: PAUSED });
    assert.equal(result.totalBillableSeconds, 0);
    assert.equal(result.standingNow, true);
    assert.ok(result.anomalies.some((entry) => entry.code === "open_interval_without_now"));
  });

  it("handles multiple pauses", () => {
    const result = computeStandbyTime({
      events: [
        enter(0),
        leave(10, "weather_hold"),
        enter(15, "weather_hold"),
        leave(25, "scene_handover_to_authority"),
        enter(40, "scene_handover_to_authority"),
        leave(50, "stand_down_requested"),
      ],
      pausedStates: PAUSED,
      now: at(60),
    });
    // Billable: 0-10, 15-25, 40-50 = 30 minutes. Paused: 10-15 + 25-40 = 20 minutes.
    assert.equal(result.totalBillableSeconds, 30 * 60);
    assert.equal(result.totalPausedSeconds, 20 * 60);
    assert.equal(result.intervals.length, 3);
    assert.equal(result.pausedIntervals.length, 2);
  });

  it("keeps a zero-duration interval rather than dropping it", () => {
    const result = computeStandbyTime({
      events: [enter(10), leave(10, "stand_down_requested")],
      pausedStates: PAUSED,
    });
    assert.equal(result.totalBillableSeconds, 0);
    assert.equal(result.intervals.length, 1);
    assert.equal(result.intervals[0].seconds, 0);
  });

  it("stops the clock on conversion while standing", () => {
    const result = computeStandbyTime({
      events: [enter(0), leave(35, "converted_to_recovery")],
      pausedStates: PAUSED,
      now: at(120),
    });
    // Billable stops at conversion, not at "now".
    assert.equal(result.totalBillableSeconds, 35 * 60);
    assert.equal(result.standingNow, false);
    // Conversion is not a paused state, so no paused time accrues.
    assert.equal(result.totalPausedSeconds, 0);
  });

  it("counts no billable time when the crew never stood by", () => {
    const result = computeStandbyTime({
      events: [plain(0, "accepted", "en_route"), plain(20, "en_route", "arrived_on_scene")],
      pausedStates: PAUSED,
      now: at(60),
    });
    assert.equal(result.totalBillableSeconds, 0);
    assert.equal(result.intervals.length, 0);
    assert.equal(result.standingNow, false);
  });

  it("closes a pause when a paused crew is stood down directly (workflow v2)", () => {
    const result = computeStandbyTime({
      events: [
        enter(0),
        leave(20, "weather_hold"),
        // v2: straight from the paused state to stand-down, without resuming.
        plain(35, "weather_hold", "stand_down_requested"),
      ],
      pausedStates: PAUSED,
      now: at(60),
    });
    assert.equal(result.totalBillableSeconds, 20 * 60, "resuming was not required, so nothing more is billable");
    assert.equal(result.totalPausedSeconds, 15 * 60);
    assert.equal(result.pausedIntervals[0].open, false);
  });
});

describe("standby timer — malformed input degrades safely", () => {
  it("sorts out-of-order events and reports it", () => {
    const result = computeStandbyTime({
      events: [leave(30, "stand_down_requested"), enter(0)],
      pausedStates: PAUSED,
    });
    assert.equal(result.totalBillableSeconds, 30 * 60);
    assert.ok(result.anomalies.some((entry) => entry.code === "unordered_events"));
  });

  it("ignores a duplicate start and reports it", () => {
    const result = computeStandbyTime({
      events: [enter(0), enter(5), leave(30, "stand_down_requested")],
      pausedStates: PAUSED,
    });
    assert.equal(result.totalBillableSeconds, 30 * 60, "billed from the FIRST start");
    assert.ok(result.anomalies.some((entry) => entry.code === "enter_without_close"));
  });

  it("ignores a stop with nothing running and reports it", () => {
    const result = computeStandbyTime({
      events: [leave(10, "stand_down_requested")],
      pausedStates: PAUSED,
    });
    assert.equal(result.totalBillableSeconds, 0);
    assert.ok(result.anomalies.some((entry) => entry.code === "leave_without_open"));
  });

  it("never produces a negative bill", () => {
    const result = computeStandbyTime({
      events: [
        { ...enter(30) },
        { ...leave(10, "stand_down_requested") },
      ],
      pausedStates: PAUSED,
    });
    assert.ok(result.totalBillableSeconds >= 0);
    assert.ok(
      result.anomalies.some(
        (entry) => entry.code === "negative_interval" || entry.code === "unordered_events"
      )
    );
  });

  it("ignores an unparseable timestamp and reports it", () => {
    const result = computeStandbyTime({
      events: [
        { occurredAt: "not-a-date", fromState: null, toState: "standing_by", entersBillableStandingClock: true, leavesBillableStandingClock: false },
        enter(0),
        leave(20, "stand_down_requested"),
      ],
      pausedStates: PAUSED,
    });
    assert.equal(result.totalBillableSeconds, 20 * 60);
    assert.ok(result.anomalies.some((entry) => entry.code === "unparseable_timestamp"));
  });

  it("clamps a now that precedes the open interval", () => {
    const result = computeStandbyTime({ events: [enter(30)], pausedStates: PAUSED, now: at(10) });
    assert.equal(result.totalBillableSeconds, 0);
    assert.ok(result.anomalies.some((entry) => entry.code === "negative_interval"));
  });

  it("returns an empty result for no events", () => {
    const result = computeStandbyTime({ events: [], pausedStates: PAUSED, now: at(10) });
    assert.equal(result.totalBillableSeconds, 0);
    assert.equal(result.totalPausedSeconds, 0);
    assert.equal(result.standingNow, false);
    assert.deepEqual(result.anomalies, []);
  });
});

describe("standby timer — determinism", () => {
  it("produces identical output for identical input", () => {
    const events = [enter(0), leave(30, "weather_hold"), enter(40, "weather_hold"), leave(60, "stood_down")];
    const a = computeStandbyTime({ events, pausedStates: PAUSED, now: at(90) });
    const b = computeStandbyTime({ events, pausedStates: PAUSED, now: at(90) });
    assert.deepEqual(a, b);
  });

  it("stamps the calculator version", () => {
    const result = computeStandbyTime({ events: [], pausedStates: PAUSED });
    assert.equal(result.calculatorVersion, RR_STANDBY_CALCULATOR_VERSION);
  });

  it("reads no clock of its own", () => {
    // Without `now`, an open interval contributes zero — proof the module never calls
    // Date.now() to fill the gap.
    const result = computeStandbyTime({ events: [enter(0)], pausedStates: PAUSED });
    assert.equal(result.totalBillableSeconds, 0);
  });
});

describe("SLA-lite operational measurements", () => {
  const timingEvents = [
    { occurredAt: at(0), toState: "assigned", transitionCode: "assign" },
    { occurredAt: at(5), toState: "accepted", transitionCode: "accept" },
    { occurredAt: at(8), toState: "en_route", transitionCode: "depart" },
    { occurredAt: at(26), toState: "arrived_on_scene", transitionCode: "arrive_scene" },
    { occurredAt: at(90), toState: "stand_down_requested", transitionCode: "request_stand_down" },
    { occurredAt: at(94), toState: "stood_down", transitionCode: "stand_down" },
  ];

  it("measures time to scene", () => {
    const timings = computeBystandTimings(timingEvents, {
      offer: "assigned",
      arrival: "arrived_on_scene",
    });
    assert.equal(timings.timeToSceneSeconds, 26 * 60);
  });

  it("measures stand-down response", () => {
    const timings = computeBystandTimings(timingEvents);
    assert.equal(timings.standDownResponseSeconds, 4 * 60);
  });

  it("returns null rather than guessing when a milestone is missing", () => {
    const timings = computeBystandTimings([
      { occurredAt: at(0), toState: "assigned", transitionCode: "assign" },
    ]);
    assert.equal(timings.timeToSceneSeconds, null);
    assert.equal(timings.standDownResponseSeconds, null);
  });

  it("has no delivery milestone — a bystand attendance delivers nothing", () => {
    const timings = computeBystandTimings(timingEvents);
    assert.ok(!("deliveredAt" in timings));
    assert.ok(!("timeToDeliverySeconds" in timings));
    assert.deepEqual(Object.keys(timings).sort(), [
      "arrivedAt",
      "assignedAt",
      "standDownRequestedAt",
      "standDownResponseSeconds",
      "stoodDownAt",
      "timeToSceneSeconds",
    ]);
  });
});

describe("duration formatting", () => {
  it("formats hours, minutes and seconds", () => {
    assert.equal(formatStandbyDuration(3000), "50m 00s");
    assert.equal(formatStandbyDuration(5400), "1h 30m");
    assert.equal(formatStandbyDuration(45), "45s");
    assert.equal(formatStandbyDuration(0), "0s");
  });

  it("never renders a negative duration", () => {
    assert.equal(formatStandbyDuration(-100), "0s");
  });
});

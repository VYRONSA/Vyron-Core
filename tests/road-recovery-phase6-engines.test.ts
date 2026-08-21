/**
 * Phase 6 — Road & Recovery intelligence engines, as pure functions.
 *
 * The load-bearing assertions, all of which encode a way this could mislead a manager:
 *
 *   - NO SLA CONFIGURED never becomes an invented target, and never becomes a breach
 *   - missing data is NULL and excluded from the score; it never becomes zero
 *   - missing cost is NULL; a job with no cost never reports a 100% margin
 *   - a BYSTAND attendance can never be measured as a tow
 *   - sealed storage and standby facts are read, never recomputed
 *   - the health score is deterministic and every component explains itself
 *   - a root cause with no evidence is reported as undetermined, not guessed
 *   - the same facts always produce the same numbers and the same ordering
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  RR_METRIC_CATALOGUE,
  RR_METRIC_KEYS,
  metricDefinition,
  metricsForDomain,
  scoredMetrics,
} from "@/lib/road-recovery/intelligence/metric-catalogue";
import {
  RR_NO_SLA_CONFIGURED,
  buildMetric,
  resolveThreshold,
  scoreMetric,
  type RrThreshold,
} from "@/lib/road-recovery/intelligence/thresholds";
import {
  RR_INTELLIGENCE_DOMAINS,
  isRrIntelligenceDomain,
} from "@/lib/road-recovery/intelligence/types";
import {
  completionCounts,
  cycleTimeSamples,
  durationStats,
  responseToSceneSamples,
  timeOnSceneSamples,
  worstOffenders,
  type RrJobTimingFact,
  type RrStateEventFact,
} from "@/lib/road-recovery/intelligence/timing";
import {
  dispatchCounts,
  driverDispatchStats,
  timeToAcceptSamples,
  timeToFirstOfferSamples,
  vehicleDispatchStats,
  type RrAssignmentFact,
} from "@/lib/road-recovery/intelligence/dispatch";
import {
  assertNoBystandJobs,
  bystandTotals,
  isBystandWorkflow,
} from "@/lib/road-recovery/intelligence/bystand";
import { storageTotals } from "@/lib/road-recovery/intelligence/storage";
import { driverTotals, fleetTotals } from "@/lib/road-recovery/intelligence/assets";
import {
  authorisationTotals,
  billingReadinessTotals,
  counterpartyStats,
  distanceTotals,
  profitabilityTotals,
} from "@/lib/road-recovery/intelligence/commercial";
import { exceptionTotals } from "@/lib/road-recovery/intelligence/exceptions";
import { computeRoadRecoveryHealth } from "@/lib/road-recovery/intelligence/health";
import {
  buildRecommendations,
  priorityScore,
  toActionPayload,
  toOrchestrationInput,
} from "@/lib/road-recovery/intelligence/recommendations";
import {
  RR_ACTION_TYPES,
  RR_TRIGGER_CATALOGUE,
  RR_TRIGGER_LABELS,
  triggerForMetric,
} from "@/lib/road-recovery/intelligence/triggers";
import { buildDomains, type RrIntelligenceFacts } from "@/lib/road-recovery/intelligence/domains";
import {
  combineBusinessHealth,
  roadRecoveryContribution,
  workforceContribution,
} from "@/lib/intelligence/vertical-health";
import {
  AUTOMATION_ACTION_TYPES,
} from "@/lib/workforce-automation-engine";
import {
  WORKFLOW_ACTION_LIBRARY,
  WORKFLOW_TRIGGERS,
  orchestrateWorkflow,
} from "@/lib/workflow-orchestration-engine";

const AS_OF = "2026-06-30T12:00:00.000Z";
const WINDOW = {
  fromIso: "2026-06-01T00:00:00.000Z",
  toIso: "2026-06-30T12:00:00.000Z",
  asOfIso: AS_OF,
};

function threshold(overrides: Partial<RrThreshold> & { metricKey: string; targetValue: number }): RrThreshold {
  return {
    id: `t-${overrides.metricKey}-${overrides.version ?? 1}`,
    serviceCode: null,
    counterpartyId: null,
    warningValue: null,
    criticalValue: null,
    unit: "minutes",
    severity: "medium",
    effectiveFrom: "2026-01-01T00:00:00.000Z",
    effectiveTo: null,
    active: true,
    version: 1,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
describe("Phase 6 — metric catalogue", () => {
  it("has a unique key for every metric", () => {
    assert.equal(new Set(RR_METRIC_KEYS).size, RR_METRIC_KEYS.length);
  });

  it("assigns every metric to a real domain", () => {
    for (const metric of RR_METRIC_CATALOGUE) {
      assert.ok(isRrIntelligenceDomain(metric.domain), `${metric.key} has an unknown domain`);
    }
  });

  it("gives informational metrics zero health weight", () => {
    // Volume and revenue are business facts. Scoring a busy month as a health problem
    // would be nonsense, so the catalogue must never weight them.
    for (const metric of RR_METRIC_CATALOGUE) {
      if (metric.direction === "informational") {
        assert.equal(metric.healthWeight, 0, `${metric.key} is informational but carries weight`);
      }
    }
  });

  it("weights every non-informational metric", () => {
    for (const metric of RR_METRIC_CATALOGUE) {
      if (metric.direction !== "informational") {
        assert.ok(metric.healthWeight > 0, `${metric.key} is scorable but carries no weight`);
      }
    }
  });

  it("documents a real source for every metric", () => {
    for (const metric of RR_METRIC_CATALOGUE) {
      assert.ok(metric.source.length > 10, `${metric.key} has no documented source`);
    }
  });

  it("covers the twelve measured domains", () => {
    for (const domain of RR_INTELLIGENCE_DOMAINS) {
      if (domain === "sla" || domain === "executive_health" || domain === "recommended_actions") continue;
      assert.ok(metricsForDomain(domain).length > 0, `${domain} has no metrics`);
    }
  });

  it("resolves a definition by key and returns null for anything else", () => {
    assert.equal(metricDefinition("dispatch_acceptance_rate_pct")?.domain, "dispatch");
    assert.equal(metricDefinition("not_a_metric"), null);
  });

  it("counts scored metrics as those with weight", () => {
    assert.equal(
      scoredMetrics().length,
      RR_METRIC_CATALOGUE.filter((entry) => entry.healthWeight > 0).length
    );
  });
});

// ---------------------------------------------------------------------------
describe("Phase 6 — NO SLA CONFIGURED", () => {
  it("reports not_configured when the tenant has set no target", () => {
    const metric = buildMetric({
      metricKey: "response_time_to_scene_minutes",
      value: 95,
      sampleSize: 12,
      thresholds: [],
      asOfIso: AS_OF,
    });

    assert.equal(metric.band, "not_configured");
    assert.equal(metric.target, null);
    assert.equal(metric.thresholdSource, "not_configured");
    assert.match(metric.reason, new RegExp(RR_NO_SLA_CONFIGURED));
    // The measured value is still shown. Refusing to invent a target is not the same as
    // refusing to report the measurement.
    assert.equal(metric.value, 95);
  });

  it("never scores an unconfigured metric", () => {
    const metric = buildMetric({
      metricKey: "response_time_to_scene_minutes",
      value: 400,
      sampleSize: 40,
      thresholds: [],
      asOfIso: AS_OF,
    });
    assert.equal(scoreMetric(metric), null);
  });

  it("does not fall back to a target from a different metric", () => {
    const metric = buildMetric({
      metricKey: "response_time_to_scene_minutes",
      value: 95,
      sampleSize: 5,
      thresholds: [threshold({ metricKey: "time_on_scene_minutes", targetValue: 20 })],
      asOfIso: AS_OF,
    });
    assert.equal(metric.band, "not_configured");
  });

  it("does not apply a target scoped to a different service code", () => {
    const metric = buildMetric({
      metricKey: "response_time_to_scene_minutes",
      value: 95,
      sampleSize: 5,
      serviceCode: "heavy_recovery",
      thresholds: [
        threshold({ metricKey: "response_time_to_scene_minutes", targetValue: 30, serviceCode: "tow_in" }),
      ],
      asOfIso: AS_OF,
    });
    assert.equal(metric.band, "not_configured");
  });

  it("does not apply a retired target", () => {
    const metric = buildMetric({
      metricKey: "response_time_to_scene_minutes",
      value: 95,
      sampleSize: 5,
      thresholds: [threshold({ metricKey: "response_time_to_scene_minutes", targetValue: 30, active: false })],
      asOfIso: AS_OF,
    });
    assert.equal(metric.band, "not_configured");
  });
});

// ---------------------------------------------------------------------------
describe("Phase 6 — threshold resolution and replay", () => {
  const global30 = threshold({ metricKey: "response_time_to_scene_minutes", targetValue: 30, version: 3 });
  const perService = threshold({
    metricKey: "response_time_to_scene_minutes",
    targetValue: 60,
    serviceCode: "heavy_recovery",
    version: 1,
  });
  const perBoth = threshold({
    metricKey: "response_time_to_scene_minutes",
    targetValue: 90,
    serviceCode: "heavy_recovery",
    counterpartyId: "cp-1",
    version: 1,
  });

  it("prefers specificity over a newer general version", () => {
    // A deliberate target for one service and one insurer must not be overridden by a
    // company-wide default that happens to have a higher version number.
    const resolved = resolveThreshold([global30, perService, perBoth], {
      metricKey: "response_time_to_scene_minutes",
      serviceCode: "heavy_recovery",
      counterpartyId: "cp-1",
      asOfIso: AS_OF,
    });
    assert.equal(resolved.configured, true);
    assert.equal(resolved.configured && resolved.threshold.targetValue, 90);
  });

  it("falls back through specificity levels", () => {
    const resolved = resolveThreshold([global30, perService], {
      metricKey: "response_time_to_scene_minutes",
      serviceCode: "tow_in",
      asOfIso: AS_OF,
    });
    assert.equal(resolved.configured && resolved.threshold.targetValue, 30);
  });

  it("replays a historical result against the version in force at the time", () => {
    const march = threshold({
      metricKey: "response_time_to_scene_minutes",
      targetValue: 45,
      version: 1,
      effectiveFrom: "2026-01-01T00:00:00.000Z",
      effectiveTo: "2026-04-01T00:00:00.000Z",
      active: false,
    });
    const april = threshold({
      metricKey: "response_time_to_scene_minutes",
      targetValue: 30,
      version: 2,
      effectiveFrom: "2026-04-01T00:00:00.000Z",
    });

    // A retired version is still resolvable for the window it governed. Without this a
    // March report re-opened in June would silently be judged by April's stricter target.
    const marchView = resolveThreshold([march, april], {
      metricKey: "response_time_to_scene_minutes",
      asOfIso: "2026-03-15T00:00:00.000Z",
    });
    const juneView = resolveThreshold([march, april], {
      metricKey: "response_time_to_scene_minutes",
      asOfIso: "2026-06-15T00:00:00.000Z",
    });

    assert.equal(marchView.configured && marchView.threshold.version, 1);
    assert.equal(marchView.configured && marchView.threshold.targetValue, 45);
    assert.equal(juneView.configured && juneView.threshold.version, 2);
    assert.equal(juneView.configured && juneView.threshold.targetValue, 30);
  });

  it("excludes a target that had not yet come into force", () => {
    const future = threshold({
      metricKey: "response_time_to_scene_minutes",
      targetValue: 30,
      effectiveFrom: "2027-01-01T00:00:00.000Z",
    });
    const resolved = resolveThreshold([future], {
      metricKey: "response_time_to_scene_minutes",
      asOfIso: AS_OF,
    });
    assert.equal(resolved.configured, false);
  });

  it("treats the effective_to boundary as exclusive", () => {
    const bounded = threshold({
      metricKey: "response_time_to_scene_minutes",
      targetValue: 30,
      effectiveFrom: "2026-01-01T00:00:00.000Z",
      effectiveTo: "2026-06-30T12:00:00.000Z",
    });
    const atBoundary = resolveThreshold([bounded], {
      metricKey: "response_time_to_scene_minutes",
      asOfIso: "2026-06-30T12:00:00.000Z",
    });
    const justBefore = resolveThreshold([bounded], {
      metricKey: "response_time_to_scene_minutes",
      asOfIso: "2026-06-30T11:59:59.000Z",
    });
    assert.equal(atBoundary.configured, false);
    assert.equal(justBefore.configured, true);
  });

  it("resolves deterministically when two rows tie", () => {
    const a = threshold({ metricKey: "job_cycle_time_hours", targetValue: 5, version: 1 });
    const b = { ...a, id: "aaa-first", targetValue: 9 };
    const first = resolveThreshold([a, b], { metricKey: "job_cycle_time_hours", asOfIso: AS_OF });
    const second = resolveThreshold([b, a], { metricKey: "job_cycle_time_hours", asOfIso: AS_OF });
    assert.deepEqual(
      first.configured && first.threshold.id,
      second.configured && second.threshold.id
    );
  });

  it("refuses an unparseable as-of instant rather than guessing", () => {
    const resolved = resolveThreshold([threshold({ metricKey: "job_cycle_time_hours", targetValue: 5 })], {
      metricKey: "job_cycle_time_hours",
      asOfIso: "not-a-date",
    });
    assert.equal(resolved.configured, false);
  });
});

// ---------------------------------------------------------------------------
describe("Phase 6 — banding and scoring", () => {
  it("bands lower_is_better correctly at each boundary", () => {
    const t = threshold({
      metricKey: "response_time_to_scene_minutes",
      targetValue: 30,
      warningValue: 40,
      criticalValue: 60,
    });
    const band = (value: number) =>
      buildMetric({
        metricKey: "response_time_to_scene_minutes",
        value,
        sampleSize: 10,
        thresholds: [t],
        asOfIso: AS_OF,
      }).band;

    assert.equal(band(29), "ok");
    assert.equal(band(30), "ok", "exactly on target is on target");
    assert.equal(band(30.01), "warning");
    assert.equal(band(40), "warning", "exactly on the warning rail is still warning");
    assert.equal(band(40.01), "critical");
    assert.equal(band(600), "critical");
  });

  it("bands higher_is_better correctly", () => {
    const t = threshold({
      metricKey: "job_completion_rate_pct",
      targetValue: 95,
      warningValue: 90,
      criticalValue: 80,
      unit: "%",
    });
    const band = (value: number) =>
      buildMetric({
        metricKey: "job_completion_rate_pct",
        value,
        sampleSize: 10,
        thresholds: [t],
        asOfIso: AS_OF,
      }).band;

    assert.equal(band(96), "ok");
    assert.equal(band(95), "ok");
    assert.equal(band(94), "warning");
    assert.equal(band(90), "warning");
    assert.equal(band(89), "critical");
  });

  it("scores exactly 100 on target and decreases monotonically past it", () => {
    const t = threshold({
      metricKey: "response_time_to_scene_minutes",
      targetValue: 30,
      warningValue: 40,
      criticalValue: 60,
    });
    const score = (value: number) =>
      scoreMetric(
        buildMetric({
          metricKey: "response_time_to_scene_minutes",
          value,
          sampleSize: 10,
          thresholds: [t],
          asOfIso: AS_OF,
        })
      );

    assert.equal(score(30), 100);
    const series = [30, 35, 40, 50, 60, 90, 200].map((value) => score(value) as number);
    for (let index = 1; index < series.length; index += 1) {
      assert.ok(
        series[index] <= series[index - 1],
        `score increased as the metric got worse: ${series.join(", ")}`
      );
    }
    assert.ok((series.at(-1) as number) >= 0, "a score must never go below zero");
  });

  it("does not divide by zero on a degenerate configuration", () => {
    const t = threshold({
      metricKey: "response_time_to_scene_minutes",
      targetValue: 0,
      warningValue: 0.0001,
      criticalValue: 0.0002,
    });
    const result = scoreMetric(
      buildMetric({
        metricKey: "response_time_to_scene_minutes",
        value: 0,
        sampleSize: 3,
        thresholds: [t],
        asOfIso: AS_OF,
      })
    );
    assert.ok(result !== null && Number.isFinite(result));
  });

  it("reports no_data rather than zero when nothing was measured", () => {
    const metric = buildMetric({
      metricKey: "storage_occupancy_days_avg",
      value: null,
      sampleSize: 0,
      thresholds: [threshold({ metricKey: "storage_occupancy_days_avg", targetValue: 10, unit: "days" })],
      asOfIso: AS_OF,
    });
    assert.equal(metric.band, "no_data");
    assert.equal(metric.value, null, "a period with no storage must not report zero days");
    assert.equal(scoreMetric(metric), null);
  });

  it("treats a zero sample size as no data even when a value is supplied", () => {
    const metric = buildMetric({
      metricKey: "storage_occupancy_days_avg",
      value: 0,
      sampleSize: 0,
      thresholds: [],
      asOfIso: AS_OF,
    });
    assert.equal(metric.value, null);
  });

  it("records the threshold version that judged the measurement", () => {
    const metric = buildMetric({
      metricKey: "response_time_to_scene_minutes",
      value: 20,
      sampleSize: 4,
      thresholds: [threshold({ metricKey: "response_time_to_scene_minutes", targetValue: 30, version: 7 })],
      asOfIso: AS_OF,
    });
    assert.equal(metric.thresholdVersion, 7);
    assert.match(metric.reason, /v7/);
  });
});

// ---------------------------------------------------------------------------
describe("Phase 6 — timing", () => {
  const job = (id: string, overrides: Partial<RrJobTimingFact> = {}): RrJobTimingFact => ({
    serviceJobId: id,
    workflowKey: "tow_recovery",
    workflowVersion: 1,
    serviceCode: "tow_in",
    counterpartyId: null,
    createdAt: "2026-06-10T08:00:00.000Z",
    serviceState: "closed",
    ...overrides,
  });

  const event = (
    jobId: string,
    toState: string,
    occurredAt: string,
    overrides: Partial<RrStateEventFact> = {}
  ): RrStateEventFact => ({
    serviceJobId: jobId,
    workflowKey: "tow_recovery",
    workflowVersion: 1,
    fromState: null,
    toState,
    occurredAt,
    secondsInPreviousState: null,
    ...overrides,
  });

  it("returns null statistics for an empty sample, never zero", () => {
    const stats = durationStats([]);
    assert.equal(stats.count, 0);
    assert.equal(stats.averageSeconds, null);
    assert.equal(stats.medianSeconds, null);
    assert.equal(stats.p90Seconds, null);
  });

  it("measures response to scene from travel to arrival", () => {
    const samples = responseToSceneSamples(
      [job("j1")],
      [
        event("j1", "en_route", "2026-06-10T08:10:00.000Z"),
        event("j1", "on_scene", "2026-06-10T08:40:00.000Z"),
      ]
    );
    assert.equal(samples.length, 1);
    assert.equal(samples[0].seconds, 1800);
  });

  it("excludes a job that never arrived rather than measuring it against now", () => {
    // Counting an in-flight job would make the same historical period report a different
    // number every time it is opened.
    const samples = responseToSceneSamples(
      [job("j1")],
      [event("j1", "en_route", "2026-06-10T08:10:00.000Z")]
    );
    assert.equal(samples.length, 0);
  });

  it("ignores an arrival recorded before departure", () => {
    const samples = responseToSceneSamples(
      [job("j1")],
      [
        event("j1", "en_route", "2026-06-10T09:00:00.000Z"),
        event("j1", "on_scene", "2026-06-10T08:00:00.000Z"),
      ]
    );
    assert.equal(samples.length, 0);
  });

  it("reads time on scene from what the transition recorded", () => {
    const samples = timeOnSceneSamples(
      [job("j1")],
      [
        event("j1", "on_scene", "2026-06-10T08:40:00.000Z"),
        event("j1", "loaded", "2026-06-10T09:10:00.000Z", {
          fromState: "on_scene",
          secondsInPreviousState: 1802,
        }),
      ]
    );
    // 1802, not 1800: the recorded value is authoritative over recomputed timestamps.
    assert.equal(samples[0].seconds, 1802);
  });

  it("excludes a negative recorded duration", () => {
    const samples = timeOnSceneSamples(
      [job("j1")],
      [
        event("j1", "on_scene", "2026-06-10T08:40:00.000Z"),
        event("j1", "loaded", "2026-06-10T09:10:00.000Z", {
          fromState: "on_scene",
          secondsInPreviousState: -5,
        }),
      ]
    );
    assert.equal(samples.length, 0);
  });

  it("measures cycle time only for jobs that reached a terminal state", () => {
    const samples = cycleTimeSamples(
      [job("j1"), job("j2")],
      [
        event("j1", "closed", "2026-06-10T12:00:00.000Z"),
        event("j2", "en_route", "2026-06-10T09:00:00.000Z"),
      ]
    );
    assert.equal(samples.length, 1);
    assert.equal(samples[0].serviceJobId, "j1");
    assert.equal(samples[0].seconds, 4 * 3600);
  });

  it("excludes open jobs from the completion denominator", () => {
    const counts = completionCounts(
      [job("j1"), job("j2"), job("j3")],
      [
        event("j1", "closed", "2026-06-10T12:00:00.000Z"),
        event("j2", "cancelled", "2026-06-10T12:00:00.000Z"),
        event("j3", "en_route", "2026-06-10T09:00:00.000Z"),
      ],
      (_workflowKey, state) => state === "cancelled"
    );
    assert.equal(counts.completed, 1);
    assert.equal(counts.cancelled, 1);
    assert.equal(counts.open, 1);
    // 1 of 2 finished, not 1 of 3. Work in progress is not a failure.
    assert.equal(counts.completionRatePct, 50);
  });

  it("returns a null completion rate when nothing finished", () => {
    const counts = completionCounts(
      [job("j1")],
      [event("j1", "en_route", "2026-06-10T09:00:00.000Z")],
      () => false
    );
    assert.equal(counts.completionRatePct, null);
  });

  it("orders the worst offenders deterministically on a tie", () => {
    const samples = [
      { serviceJobId: "b", serviceCode: "tow_in", counterpartyId: null, seconds: 100 },
      { serviceJobId: "a", serviceCode: "tow_in", counterpartyId: null, seconds: 100 },
    ];
    assert.deepEqual(
      worstOffenders(samples, 2).map((entry) => entry.serviceJobId),
      worstOffenders([...samples].reverse(), 2).map((entry) => entry.serviceJobId)
    );
  });

  it("computes percentiles over a large sample without drifting", () => {
    const samples = Array.from({ length: 1000 }, (_unused, index) => ({
      serviceJobId: `j${index}`,
      serviceCode: "tow_in",
      counterpartyId: null,
      seconds: index + 1,
    }));
    const stats = durationStats(samples);
    assert.equal(stats.count, 1000);
    assert.equal(stats.bestSeconds, 1);
    assert.equal(stats.worstSeconds, 1000);
    assert.equal(stats.medianSeconds, 500.5);
    assert.ok((stats.p90Seconds as number) > 890 && (stats.p90Seconds as number) < 910);
  });
});

// ---------------------------------------------------------------------------
describe("Phase 6 — dispatch", () => {
  const offer = (overrides: Partial<RrAssignmentFact> & { id: string; serviceJobId: string }): RrAssignmentFact => ({
    employeeId: null,
    fieldVehicleId: null,
    assignmentStatus: "offered",
    sequenceNumber: 1,
    offeredAt: "2026-06-10T08:05:00.000Z",
    respondedAt: null,
    declineReason: null,
    ...overrides,
  });

  it("returns a null acceptance rate when nothing was answered", () => {
    const counts = dispatchCounts([offer({ id: "a", serviceJobId: "j1" })]);
    assert.equal(counts.acceptanceRatePct, null);
    assert.equal(counts.awaitingResponse, 1);
  });

  it("excludes unanswered offers from the acceptance denominator", () => {
    const counts = dispatchCounts([
      offer({ id: "a", serviceJobId: "j1", assignmentStatus: "accepted", respondedAt: "2026-06-10T08:06:00.000Z" }),
      offer({
        id: "b",
        serviceJobId: "j2",
        assignmentStatus: "declined",
        respondedAt: "2026-06-10T08:06:00.000Z",
        declineReason: "vehicle_breakdown",
      }),
      offer({ id: "c", serviceJobId: "j3" }),
    ]);
    assert.equal(counts.acceptanceRatePct, 50);
  });

  it("ranks decline reasons deterministically", () => {
    const counts = dispatchCounts([
      offer({ id: "a", serviceJobId: "j1", assignmentStatus: "declined", respondedAt: "x", declineReason: "too_far" }),
      offer({ id: "b", serviceJobId: "j2", assignmentStatus: "declined", respondedAt: "x", declineReason: "too_far" }),
      offer({ id: "c", serviceJobId: "j3", assignmentStatus: "declined", respondedAt: "x", declineReason: "breakdown" }),
    ]);
    assert.deepEqual(counts.declineReasons, [
      { reason: "too_far", count: 2 },
      { reason: "breakdown", count: 1 },
    ]);
  });

  it("counts a job as reassigned when it needed a second offer", () => {
    const counts = dispatchCounts([
      offer({ id: "a", serviceJobId: "j1", assignmentStatus: "declined", respondedAt: "x", declineReason: "r" }),
      offer({ id: "b", serviceJobId: "j1", sequenceNumber: 2, assignmentStatus: "accepted", respondedAt: "x" }),
      offer({ id: "c", serviceJobId: "j2", assignmentStatus: "accepted", respondedAt: "x" }),
    ]);
    assert.equal(counts.jobsDispatched, 2);
    assert.equal(counts.jobsReassigned, 1);
    assert.equal(counts.reassignmentRatePct, 50);
  });

  it("measures time to accept only on accepted offers", () => {
    const jobs: RrJobTimingFact[] = [
      {
        serviceJobId: "j1",
        workflowKey: "tow_recovery",
        workflowVersion: 1,
        serviceCode: "tow_in",
        counterpartyId: null,
        createdAt: "2026-06-10T08:00:00.000Z",
        serviceState: "closed",
      },
    ];
    const samples = timeToAcceptSamples(jobs, [
      offer({
        id: "a",
        serviceJobId: "j1",
        assignmentStatus: "accepted",
        offeredAt: "2026-06-10T08:00:00.000Z",
        respondedAt: "2026-06-10T08:03:00.000Z",
      }),
      offer({
        id: "b",
        serviceJobId: "j1",
        assignmentStatus: "declined",
        offeredAt: "2026-06-10T08:00:00.000Z",
        respondedAt: "2026-06-10T08:30:00.000Z",
        declineReason: "busy",
      }),
    ]);
    assert.equal(samples.length, 1);
    assert.equal(samples[0].seconds, 180);
  });

  it("measures time to first offer from the dispatch pool entry", () => {
    const jobs: RrJobTimingFact[] = [
      {
        serviceJobId: "j1",
        workflowKey: "tow_recovery",
        workflowVersion: 1,
        serviceCode: "tow_in",
        counterpartyId: null,
        createdAt: "2026-06-10T07:00:00.000Z",
        serviceState: "dispatch_pending",
      },
    ];
    const samples = timeToFirstOfferSamples(
      jobs,
      [
        {
          serviceJobId: "j1",
          workflowKey: "tow_recovery",
          workflowVersion: 1,
          fromState: "logged",
          toState: "dispatch_pending",
          occurredAt: "2026-06-10T08:00:00.000Z",
          secondsInPreviousState: null,
        },
      ],
      [offer({ id: "a", serviceJobId: "j1", offeredAt: "2026-06-10T08:07:00.000Z" })]
    );
    assert.equal(samples.length, 1);
    assert.equal(samples[0].seconds, 420);
  });

  it("counts a vehicle once per job even with repeated offers", () => {
    const stats = vehicleDispatchStats([
      offer({ id: "a", serviceJobId: "j1", fieldVehicleId: "v1", assignmentStatus: "accepted" }),
      offer({ id: "b", serviceJobId: "j1", fieldVehicleId: "v1", assignmentStatus: "completed" }),
    ]);
    assert.deepEqual(stats, [{ fieldVehicleId: "v1", jobs: 1 }]);
  });

  it("reports per-driver acceptance without inventing a rate for unanswered offers", () => {
    const stats = driverDispatchStats([
      offer({ id: "a", serviceJobId: "j1", employeeId: "e1" }),
      offer({ id: "b", serviceJobId: "j2", employeeId: "e2", assignmentStatus: "accepted", respondedAt: "x" }),
    ]);
    const e1 = stats.find((entry) => entry.employeeId === "e1");
    assert.equal(e1?.acceptanceRatePct, null);
  });
});

// ---------------------------------------------------------------------------
describe("Phase 6 — BYSTAND separation", () => {
  it("identifies the bystand workflow", () => {
    assert.equal(isBystandWorkflow("bystand"), true);
    assert.equal(isBystandWorkflow("tow_recovery"), false);
  });

  it("throws rather than averaging a BYSTAND attendance into tow response", () => {
    assert.throws(
      () =>
        assertNoBystandJobs(
          [
            { serviceJobId: "j1", workflowKey: "tow_recovery" },
            { serviceJobId: "j2", workflowKey: "bystand" },
          ],
          "tow operations"
        ),
      /BYSTAND/
    );
  });

  it("passes a clean tow population", () => {
    assert.doesNotThrow(() =>
      assertNoBystandJobs([{ serviceJobId: "j1", workflowKey: "tow_recovery" }], "tow operations")
    );
  });

  it("reads standing time from the sealed summary and reports nulls when empty", () => {
    const empty = bystandTotals([], []);
    assert.equal(empty.averageStandingSeconds, null);
    assert.equal(empty.pausedRatioPct, null);
    assert.equal(empty.conversionRatePct, null);
    assert.equal(empty.totalStandingSeconds, 0, "a total of nothing is genuinely zero");
  });

  it("computes the paused ratio over total attendance time", () => {
    const totals = bystandTotals(
      [
        {
          serviceJobId: "b1",
          sealedReason: "stood_down",
          sealedAt: "2026-06-10T12:00:00.000Z",
          totalBillableSeconds: 7200,
          totalPausedSeconds: 1800,
          standingIntervalCount: 2,
          pausedIntervalCount: 1,
          timeToSceneSeconds: 900,
          standDownResponseSeconds: 300,
          calculatorVersion: "rr-standby-1.0.0",
          anomalies: [],
        },
      ],
      []
    );
    assert.equal(totals.pausedRatioPct, 20);
    assert.equal(totals.averageTimeToSceneSeconds, 900);
  });

  it("counts a conversion without absorbing the recovery job", () => {
    const totals = bystandTotals(
      [],
      [
        {
          serviceJobId: "b1",
          reasonCodeId: "r1",
          reasonCode: "police_scene",
          reasonLabel: "Police scene",
          requestingAuthority: "SAPS",
          convertedServiceJobId: "j-recovery",
          convertedAt: "2026-06-10T11:00:00.000Z",
          conversionReason: "vehicle required recovery",
          reportSubmittedAt: null,
        },
        {
          serviceJobId: "b2",
          reasonCodeId: "r1",
          reasonCode: "police_scene",
          reasonLabel: "Police scene",
          requestingAuthority: "SAPS",
          convertedServiceJobId: null,
          convertedAt: null,
          conversionReason: null,
          reportSubmittedAt: "2026-06-10T12:00:00.000Z",
        },
      ]
    );
    assert.equal(totals.attendances, 2);
    assert.equal(totals.converted, 1);
    assert.equal(totals.conversionRatePct, 50);
  });

  it("flags sealed attendances with no submitted report", () => {
    const totals = bystandTotals(
      [
        {
          serviceJobId: "b1",
          sealedReason: "stood_down",
          sealedAt: "2026-06-10T12:00:00.000Z",
          totalBillableSeconds: 3600,
          totalPausedSeconds: 0,
          standingIntervalCount: 1,
          pausedIntervalCount: 0,
          timeToSceneSeconds: null,
          standDownResponseSeconds: null,
          calculatorVersion: "v1",
          anomalies: { gap: true },
        },
      ],
      [
        {
          serviceJobId: "b1",
          reasonCodeId: null,
          reasonCode: null,
          reasonLabel: null,
          requestingAuthority: null,
          convertedServiceJobId: null,
          convertedAt: null,
          conversionReason: null,
          reportSubmittedAt: null,
        },
      ]
    );
    assert.equal(totals.missingReports, 1);
    assert.equal(totals.attendancesWithAnomalies, 1);
  });
});

// ---------------------------------------------------------------------------
describe("Phase 6 — storage", () => {
  const booking = (id: string, checkedInAt: string | null, checkedOutAt: string | null = null) => ({
    id,
    serviceJobId: `job-${id}`,
    yardId: "y1",
    yardName: "Main yard",
    status: checkedOutAt ? "released" : "stored",
    checkedInAt,
    checkedOutAt,
    freeDays: 2,
    rateAmount: 150,
    currency: "ZAR",
    vehicleRegistration: `CA ${id}`,
  });

  it("reports nulls, not zeros, when nothing is sealed", () => {
    const totals = storageTotals([], [], [], { asOfIso: AS_OF, ageingLimit: 10 });
    assert.equal(totals.averageElapsedDays, null);
    assert.equal(totals.totalSealedAmount, null);
    assert.equal(totals.averageReleaseDelayDays, null);
  });

  it("reads sealed occupancy from the accrual and never recomputes it", () => {
    // The seal says 40 days. Check-in to check-out is 10. Storage intelligence must
    // report what was SEALED, because that is what the customer was quoted.
    const totals = storageTotals(
      [booking("b1", "2026-06-01T00:00:00.000Z", "2026-06-11T00:00:00.000Z")],
      [
        {
          serviceJobId: "job-b1",
          bookingId: "b1",
          sealedReason: "released",
          periodStart: "2026-06-01T00:00:00.000Z",
          periodEnd: "2026-06-11T00:00:00.000Z",
          chargeableDays: 38,
          freeDaysApplied: 2,
          elapsedDays: 40,
          billableUnits: 38,
          amount: 5700,
          currency: "ZAR",
          calculatorVersion: "rr-storage-1.0.0",
          sealedAt: "2026-06-11T00:00:00.000Z",
        },
      ],
      [],
      { asOfIso: AS_OF, ageingLimit: 10 }
    );
    assert.equal(totals.averageElapsedDays, 40);
    assert.equal(totals.averageChargeableDays, 38);
    assert.equal(totals.totalSealedAmount, 5700);
  });

  it("ages open occupancies against the supplied as-of instant", () => {
    const totals = storageTotals(
      [booking("b1", "2026-05-01T12:00:00.000Z")],
      [],
      [],
      { asOfIso: AS_OF, ageingLimit: 10 }
    );
    assert.equal(totals.openOccupancies, 1);
    assert.equal(totals.over30Days, 1);
    assert.equal(totals.ageing[0].daysHeld, 60);
    assert.equal(totals.ageing[0].authorityStatus, "no_authority");
  });

  it("produces the same ageing on every run for the same as-of instant", () => {
    const args = [[booking("b1", "2026-05-01T12:00:00.000Z")], [], []] as const;
    const first = storageTotals(args[0], args[1], args[2], { asOfIso: AS_OF, ageingLimit: 10 });
    const second = storageTotals(args[0], args[1], args[2], { asOfIso: AS_OF, ageingLimit: 10 });
    assert.deepEqual(first.ageing, second.ageing);
  });

  it("separates authorised-but-uncollected from no-authority", () => {
    const totals = storageTotals(
      [booking("b1", "2026-05-01T12:00:00.000Z"), booking("b2", "2026-05-01T12:00:00.000Z")],
      [],
      [
        {
          id: "a1",
          serviceJobId: "job-b1",
          authorityType: "release",
          status: "active",
          issuedAt: "2026-06-01T00:00:00.000Z",
          validFrom: "2026-06-01T00:00:00.000Z",
          expiresAt: null,
          verifiedAt: "2026-06-01T06:00:00.000Z",
        },
      ],
      { asOfIso: AS_OF, ageingLimit: 10 }
    );
    assert.equal(totals.authorisedButNotCollected, 1);
    const b1 = totals.ageing.find((entry) => entry.bookingId === "b1");
    const b2 = totals.ageing.find((entry) => entry.bookingId === "b2");
    assert.equal(b1?.authorityStatus, "released_authorised");
    assert.equal(b2?.authorityStatus, "no_authority");
  });

  it("ignores an expired authority when ageing", () => {
    const totals = storageTotals(
      [booking("b1", "2026-05-01T12:00:00.000Z")],
      [],
      [
        {
          id: "a1",
          serviceJobId: "job-b1",
          authorityType: "release",
          status: "active",
          issuedAt: "2026-05-02T00:00:00.000Z",
          validFrom: "2026-05-02T00:00:00.000Z",
          expiresAt: "2026-05-10T00:00:00.000Z",
          verifiedAt: "2026-05-02T00:00:00.000Z",
        },
      ],
      { asOfIso: AS_OF, ageingLimit: 10 }
    );
    assert.equal(totals.ageing[0].authorityStatus, "no_authority");
  });

  it("counts an occupancy with no check-in as unmeasurable rather than zero days", () => {
    const totals = storageTotals([booking("b1", null)], [], [], { asOfIso: AS_OF, ageingLimit: 10 });
    assert.equal(totals.unmeasurableOccupancies, 1);
    assert.equal(totals.ageing.length, 0);
  });
});

// ---------------------------------------------------------------------------
describe("Phase 6 — fleet and driver", () => {
  it("returns nulls for an operator with no trucks", () => {
    const totals = fleetTotals([], [], { asOfIso: AS_OF, staleLocationHours: 24, idleLimit: 5 });
    assert.equal(totals.outOfServicePct, null);
    assert.equal(totals.utilisationPct, null);
    assert.equal(totals.jobsPerTruck, null);
  });

  it("measures utilisation over operational trucks only", () => {
    const totals = fleetTotals(
      [
        { id: "t1", fieldVehicleId: "v1", registration: null, towClass: "light", availabilityStatus: "available", operationalStatus: "operational", baseLabel: null, locationUpdatedAt: AS_OF },
        { id: "t2", fieldVehicleId: "v2", registration: null, towClass: "light", availabilityStatus: "available", operationalStatus: "operational", baseLabel: null, locationUpdatedAt: AS_OF },
        { id: "t3", fieldVehicleId: "v3", registration: null, towClass: "heavy", availabilityStatus: "unavailable", operationalStatus: "maintenance", baseLabel: null, locationUpdatedAt: AS_OF },
      ],
      [{ fieldVehicleId: "v1", jobs: 5 }],
      { asOfIso: AS_OF, staleLocationHours: 24, idleLimit: 5 }
    );
    // 1 of 2 operational trucks took work. The truck in the workshop is not idle.
    assert.equal(totals.utilisationPct, 50);
    assert.equal(totals.outOfServicePct, (1 / 3) * 100);
    assert.equal(totals.idleTrucks.length, 1);
    assert.equal(totals.idleTrucks[0].fieldVehicleId, "v2");
  });

  it("treats a valid dispatch-blocking certification as not blocking", () => {
    const totals = driverTotals(
      [
        {
          id: "c1",
          employeeId: "e1",
          employeeName: "Driver One",
          certificationType: "code14",
          status: "valid",
          expiresAt: "2027-01-01T00:00:00.000Z",
          blocksDispatch: true,
        },
      ],
      [],
      { asOfIso: AS_OF, attentionLimit: 5, lowAcceptanceThresholdPct: 50 }
    );
    assert.equal(totals.blockedDrivers, 0);
  });

  it("treats an expired dispatch-blocking certification as blocking", () => {
    const totals = driverTotals(
      [
        {
          id: "c1",
          employeeId: "e1",
          employeeName: "Driver One",
          certificationType: "code14",
          status: "valid",
          expiresAt: "2026-06-01T00:00:00.000Z",
          blocksDispatch: true,
        },
      ],
      [],
      { asOfIso: AS_OF, attentionLimit: 5, lowAcceptanceThresholdPct: 50 }
    );
    assert.equal(totals.blockedDrivers, 1);
    assert.equal(totals.expiredCount, 1);
  });

  it("does not treat an expired non-blocking certification as blocking", () => {
    const totals = driverTotals(
      [
        {
          id: "c1",
          employeeId: "e1",
          employeeName: "Driver One",
          certificationType: "first_aid",
          status: "expired",
          expiresAt: "2026-06-01T00:00:00.000Z",
          blocksDispatch: false,
        },
      ],
      [],
      { asOfIso: AS_OF, attentionLimit: 5, lowAcceptanceThresholdPct: 50 }
    );
    assert.equal(totals.blockedDrivers, 0);
    assert.equal(totals.expiredCount, 1);
  });

  it("ignores a low acceptance rate from too few offers to judge", () => {
    const totals = driverTotals(
      [],
      [{ employeeId: "e1", offers: 2, acceptanceRatePct: 0, topDeclineReason: "busy" }],
      { asOfIso: AS_OF, attentionLimit: 5, lowAcceptanceThresholdPct: 50 }
    );
    assert.equal(totals.lowAcceptanceDrivers.length, 0);
  });
});

// ---------------------------------------------------------------------------
describe("Phase 6 — commercial domains", () => {
  it("returns a null authorisation rate when nothing needed authorising", () => {
    const totals = authorisationTotals([], [], [], { asOfIso: AS_OF, listLimit: 5 });
    assert.equal(totals.authorisationRatePct, null);
    assert.equal(totals.averageDelayMinutes, null);
  });

  it("counts a job with no authority as missing, not as expired", () => {
    const totals = authorisationTotals(
      [
        {
          serviceJobId: "j1",
          serviceCode: "accident_recovery",
          requiresAuthorisation: true,
          createdAt: "2026-06-10T08:00:00.000Z",
          counterpartyId: "cp1",
        },
      ],
      [],
      [],
      { asOfIso: AS_OF, listLimit: 5 }
    );
    assert.equal(totals.missing, 1);
    assert.equal(totals.expired, 0);
    assert.equal(totals.authorisationRatePct, 0);
  });

  it("detects an expected charge above the authorised ceiling", () => {
    const totals = authorisationTotals(
      [
        {
          serviceJobId: "j1",
          serviceCode: "accident_recovery",
          requiresAuthorisation: true,
          createdAt: "2026-06-10T08:00:00.000Z",
          counterpartyId: "cp1",
        },
      ],
      [
        {
          id: "a1",
          serviceJobId: "j1",
          counterpartyId: "cp1",
          counterpartyName: "Insurer A",
          authorisedAmount: 5000,
          authorisedAt: "2026-06-10T08:30:00.000Z",
          expiresAt: null,
          status: "active",
        },
      ],
      [{ serviceJobId: "j1", totalInclVat: 6250 }],
      { asOfIso: AS_OF, listLimit: 5 }
    );
    assert.equal(totals.exceeded, 1);
    assert.equal(totals.exceededDetail[0].overBy, 1250);
    assert.equal(totals.averageDelayMinutes, 30);
  });

  it("excludes unfinished jobs from the billing-ready denominator", () => {
    const totals = billingReadinessTotals(
      [
        { serviceJobId: "j1", finishedAt: "2026-06-11T00:00:00.000Z" },
        { serviceJobId: "j2", finishedAt: "2026-06-11T00:00:00.000Z" },
      ],
      [
        {
          serviceJobId: "j1",
          status: "complete",
          totalInclVat: 1000,
          subtotalExVat: 870,
          missingFacts: null,
          unratedFacts: null,
          calculatedAt: "2026-06-12T00:00:00.000Z",
        },
      ],
      []
    );
    assert.equal(totals.readyJobs, 1);
    assert.equal(totals.neverCalculated, 1);
    assert.equal(totals.readyRatePct, 50);
    assert.equal(totals.averageDaysToReadyDays, 1);
  });

  it("returns a null ready rate when nothing finished", () => {
    const totals = billingReadinessTotals([], [], []);
    assert.equal(totals.readyRatePct, null);
    assert.equal(totals.averageDaysToReadyDays, null);
  });

  it("does not divide by a zero distance estimate", () => {
    const totals = distanceTotals(
      [{ serviceJobId: "j1" }],
      [
        {
          serviceJobId: "j1",
          quantity: 40,
          source: "captured",
          status: "frozen",
          odometerStartKm: 1000,
          odometerEndKm: 1040,
        },
      ],
      [{ serviceJobId: "j1", distanceKm: 0 }],
      [],
      [],
      { listLimit: 5 }
    );
    assert.equal(totals.averageVariancePct, null, "a zero estimate must not create infinite variance");
    assert.equal(totals.captured, 1);
  });

  it("computes distance variance without touching the original facts", () => {
    const facts = [
      {
        serviceJobId: "j1",
        quantity: 50,
        source: "captured",
        status: "frozen",
        odometerStartKm: 1000,
        odometerEndKm: 1050,
      },
    ];
    const snapshot = JSON.stringify(facts);
    const totals = distanceTotals(
      [{ serviceJobId: "j1" }],
      facts,
      [{ serviceJobId: "j1", distanceKm: 40 }],
      [],
      [],
      { listLimit: 5 }
    );
    assert.equal(totals.averageVariancePct, 25);
    assert.equal(JSON.stringify(facts), snapshot, "the original driver reading was mutated");
  });

  it("ignores a superseded distance fact", () => {
    const totals = distanceTotals(
      [{ serviceJobId: "j1" }],
      [
        {
          serviceJobId: "j1",
          quantity: 500,
          source: "captured",
          status: "superseded",
          odometerStartKm: 1000,
          odometerEndKm: 1500,
        },
      ],
      [{ serviceJobId: "j1", distanceKm: 40 }],
      [],
      [],
      { listLimit: 5 }
    );
    assert.equal(totals.captured, 0);
    assert.equal(totals.missingCapture, 1);
  });

  it("reports margin as NULL when cost is absent, never as one hundred percent", () => {
    // This is the defect Phase 6 found in the Phase 5 margin view: a job with no cost
    // record must never read as pure profit.
    const totals = profitabilityTotals(
      [
        {
          serviceJobId: "j1",
          serviceCode: "tow_in",
          expectedRevenueZAR: 1000,
          costZAR: null,
          marginZAR: null,
          marginPct: null,
        },
      ],
      { listLimit: 5 }
    );
    assert.equal(totals.averageMarginPct, null);
    assert.equal(totals.measurableJobs, 0);
    assert.equal(totals.jobsMissingCost, 1);
    assert.equal(totals.costCoveragePct, 0);
    assert.equal(totals.totalMarginZAR, null);
  });

  it("averages margin over measurable jobs only", () => {
    const totals = profitabilityTotals(
      [
        { serviceJobId: "j1", serviceCode: "tow_in", expectedRevenueZAR: 1000, costZAR: 600, marginZAR: 400, marginPct: 40 },
        { serviceJobId: "j2", serviceCode: "tow_in", expectedRevenueZAR: 1000, costZAR: null, marginZAR: null, marginPct: null },
      ],
      { listLimit: 5 }
    );
    // 40%, not 70%. The unmeasurable job contributes to nothing but the coverage figure.
    assert.equal(totals.averageMarginPct, 40);
    assert.equal(totals.costCoveragePct, 50);
  });

  it("lists loss-making jobs worst first", () => {
    const totals = profitabilityTotals(
      [
        { serviceJobId: "j1", serviceCode: "tow_in", expectedRevenueZAR: 100, costZAR: 200, marginZAR: -100, marginPct: -100 },
        { serviceJobId: "j2", serviceCode: "tow_in", expectedRevenueZAR: 100, costZAR: 150, marginZAR: -50, marginPct: -50 },
      ],
      { listLimit: 5 }
    );
    assert.equal(totals.negativeMarginJobs, 2);
    assert.deepEqual(totals.worstMargins.map((entry) => entry.serviceJobId), ["j1", "j2"]);
  });

  it("reports counterparty revenue as null when nothing was calculated", () => {
    const stats = counterpartyStats(
      [
        {
          serviceJobId: "j1",
          serviceCode: "tow_in",
          requiresAuthorisation: true,
          createdAt: "2026-06-10T08:00:00.000Z",
          counterpartyId: "cp1",
        },
      ],
      [
        {
          id: "a1",
          serviceJobId: "j1",
          counterpartyId: "cp1",
          counterpartyName: "Insurer A",
          authorisedAmount: null,
          authorisedAt: "2026-06-10T08:10:00.000Z",
          expiresAt: null,
          status: "active",
        },
      ],
      [],
      [],
      [],
      { asOfIso: AS_OF }
    );
    assert.equal(stats.length, 1);
    assert.equal(stats[0].expectedRevenueZAR, null);
    assert.equal(stats[0].authorisationRatePct, 100);
  });
});

// ---------------------------------------------------------------------------
describe("Phase 6 — exceptions", () => {
  const exception = (
    id: string,
    overrides: Partial<Parameters<typeof exceptionTotals>[0][number]> = {}
  ) => ({
    id,
    origin: "job" as const,
    serviceJobId: `j-${id}`,
    exceptionCode: "missing_photograph",
    severity: "medium" as const,
    detail: null,
    detectedBy: "system",
    resolutionStatus: "open",
    createdAt: "2026-06-10T08:00:00.000Z",
    resolvedAt: null,
    automationActionId: null,
    ...overrides,
  });

  it("returns nulls on an empty set", () => {
    const totals = exceptionTotals([], { asOfIso: AS_OF, listLimit: 5 });
    assert.equal(totals.averageResolutionHours, null);
    assert.equal(totals.recurrenceRatePct, null);
    assert.equal(totals.oldestOpenHours, null);
  });

  it("merges both exception sources but keeps the origin visible", () => {
    const totals = exceptionTotals(
      [exception("a"), exception("b", { origin: "billing", exceptionCode: "missing_rate" })],
      { asOfIso: AS_OF, listLimit: 5 }
    );
    assert.equal(totals.total, 2);
    assert.deepEqual(
      totals.byOrigin.map((entry) => [entry.origin, entry.total]),
      [
        ["job", 1],
        ["billing", 1],
      ]
    );
  });

  it("treats acknowledged as still open", () => {
    const totals = exceptionTotals([exception("a", { resolutionStatus: "acknowledged" })], {
      asOfIso: AS_OF,
      listLimit: 5,
    });
    assert.equal(totals.open, 1);
  });

  it("marks a code recurring only when it hits more than one job", () => {
    const totals = exceptionTotals(
      [
        exception("a", { serviceJobId: "j1" }),
        exception("b", { serviceJobId: "j1" }),
        exception("c", { serviceJobId: "j2", exceptionCode: "gps_unavailable" }),
      ],
      { asOfIso: AS_OF, listLimit: 5 }
    );
    const photo = totals.byCode.find((entry) => entry.exceptionCode === "missing_photograph");
    const gps = totals.byCode.find((entry) => entry.exceptionCode === "gps_unavailable");
    assert.equal(photo?.recurring, false, "two exceptions on one job is not a recurrence");
    assert.equal(gps?.recurring, false);
  });

  it("counts unescalated open exceptions", () => {
    const totals = exceptionTotals(
      [exception("a"), exception("b", { automationActionId: "action-1" })],
      { asOfIso: AS_OF, listLimit: 5 }
    );
    assert.equal(totals.unescalatedOpen, 1);
  });

  it("ages open exceptions against the as-of instant", () => {
    const totals = exceptionTotals(
      [exception("a", { createdAt: "2026-06-01T12:00:00.000Z" })],
      { asOfIso: AS_OF, listLimit: 5 }
    );
    assert.equal(totals.openOver7Days, 1);
    assert.equal(totals.oldestOpenHours, 29 * 24);
  });

  it("ignores a resolution recorded before creation", () => {
    const totals = exceptionTotals(
      [
        exception("a", {
          resolutionStatus: "resolved",
          createdAt: "2026-06-10T12:00:00.000Z",
          resolvedAt: "2026-06-09T12:00:00.000Z",
        }),
      ],
      { asOfIso: AS_OF, listLimit: 5 }
    );
    assert.equal(totals.averageResolutionHours, null);
  });
});

// ---------------------------------------------------------------------------
describe("Phase 6 — health score", () => {
  function metric(key: string, value: number | null, target: number | null, sampleSize = 10) {
    return buildMetric({
      metricKey: key,
      value,
      sampleSize,
      thresholds:
        target === null
          ? []
          : [threshold({ metricKey: key, targetValue: target, warningValue: target * 1.25, criticalValue: target * 1.5 })],
      asOfIso: AS_OF,
    });
  }

  it("reports no score at all when nothing is configured", () => {
    const health = computeRoadRecoveryHealth([
      metric("response_time_to_scene_minutes", 95, null),
      metric("job_cycle_time_hours", 5, null),
    ]);
    assert.equal(health.score, null, "an unconfigured operation must not score zero");
    assert.equal(health.band, "not_scoreable");
    assert.match(health.narrative, /NO SLA CONFIGURED/);
    assert.equal(health.includedWeight, 0);
  });

  it("excludes a no-data metric from the denominator", () => {
    const health = computeRoadRecoveryHealth([
      metric("response_time_to_scene_minutes", 25, 30),
      metric("storage_ageing_over_30_days_count", null, 5, 0),
    ]);
    assert.equal(health.score, 100, "a domain with no data must not drag the score down");
    const excluded = health.components.find((entry) => entry.metric === "storage_ageing_over_30_days_count");
    assert.equal(excluded?.included, false);
    assert.match(excluded?.exclusionReason ?? "", /No data/);
  });

  it("explains every component", () => {
    const health = computeRoadRecoveryHealth([
      metric("response_time_to_scene_minutes", 45, 30),
      metric("job_cycle_time_hours", 2, null),
    ]);
    for (const component of health.components) {
      assert.ok(component.reason.length > 0, `${component.metric} has no reason`);
      assert.ok(
        component.included || (component.exclusionReason ?? "").length > 0,
        `${component.metric} is excluded with no stated reason`
      );
      if (component.included) {
        assert.equal(component.contribution, (component.score as number) * component.weight);
      }
    }
  });

  it("never scores an informational metric", () => {
    const health = computeRoadRecoveryHealth([
      metric("profitability_expected_revenue_zar", 500_000, 100_000),
    ]);
    assert.equal(health.score, null);
    const component = health.components[0];
    assert.equal(component.included, false);
    assert.equal(component.weight, 0);
    assert.match(component.exclusionReason ?? "", /Informational/);
  });

  it("weights a heavier metric more", () => {
    // response_time (weight 10) vs time_on_scene (weight 5).
    const responseBad = computeRoadRecoveryHealth([
      metric("response_time_to_scene_minutes", 60, 30),
      metric("time_on_scene_minutes", 10, 20),
    ]);
    const sceneBad = computeRoadRecoveryHealth([
      metric("response_time_to_scene_minutes", 15, 30),
      metric("time_on_scene_minutes", 40, 20),
    ]);
    assert.ok(
      (responseBad.score as number) < (sceneBad.score as number),
      "the heavier metric failing should hurt more"
    );
  });

  it("is deterministic across runs", () => {
    const metrics = [
      metric("response_time_to_scene_minutes", 37, 30),
      metric("job_completion_rate_pct", 91, 95),
      metric("exception_critical_open_count", 3, 0),
    ];
    const a = computeRoadRecoveryHealth(metrics);
    const b = computeRoadRecoveryHealth(metrics);
    assert.equal(a.score, b.score);
    assert.deepEqual(
      a.components.map((entry) => entry.metric),
      b.components.map((entry) => entry.metric)
    );
  });

  it("reports coverage honestly", () => {
    const health = computeRoadRecoveryHealth([
      metric("response_time_to_scene_minutes", 25, 30),
      metric("job_cycle_time_hours", 5, null),
      metric("time_on_scene_minutes", null, 20, 0),
    ]);
    assert.equal(health.configuredCoveragePct, 33.33, "coverage is reported rounded, like every other figure");
    assert.deepEqual(health.metricsWithoutTargets, ["job_cycle_time_hours"]);
    assert.deepEqual(health.metricsWithoutData, ["time_on_scene_minutes"]);
  });

  it("clamps a catastrophic metric at zero rather than going negative", () => {
    const health = computeRoadRecoveryHealth([metric("response_time_to_scene_minutes", 100_000, 30)]);
    assert.ok((health.score as number) >= 0);
  });
});

// ---------------------------------------------------------------------------
describe("Phase 6 — triggers and the shared vocabulary", () => {
  it("registers every Road & Recovery trigger in the shared WORKFLOW_TRIGGERS list", () => {
    for (const label of RR_TRIGGER_LABELS) {
      assert.ok(
        (WORKFLOW_TRIGGERS as readonly string[]).includes(label),
        `${label} is not in WORKFLOW_TRIGGERS, so the orchestration engine cannot handle it`
      );
    }
  });

  it("registers every Road & Recovery action type in the shared AUTOMATION_ACTION_TYPES list", () => {
    for (const actionType of RR_ACTION_TYPES) {
      assert.ok(
        (AUTOMATION_ACTION_TYPES as readonly string[]).includes(actionType),
        `${actionType} is not in AUTOMATION_ACTION_TYPES`
      );
    }
  });

  it("gives every trigger a fact, a condition, a severity and a path", () => {
    for (const trigger of RR_TRIGGER_CATALOGUE) {
      assert.ok(trigger.fact.length > 20, `${trigger.key} has no documented fact`);
      assert.ok(trigger.condition.length > 20, `${trigger.key} has no stated condition`);
      assert.ok(trigger.severity.length > 0);
      assert.ok(trigger.recommendationPath.length > 20, `${trigger.key} has no recommendation path`);
      assert.ok(trigger.ownerRole.length > 0, `${trigger.key} has no owner`);
    }
  });

  it("points every trigger at a metric that actually exists", () => {
    for (const trigger of RR_TRIGGER_CATALOGUE) {
      if (trigger.metricKey === null) continue;
      assert.ok(
        metricDefinition(trigger.metricKey) !== null,
        `${trigger.key} points at unknown metric ${trigger.metricKey}`
      );
    }
  });

  it("keeps every recommended action inside the shared action library", () => {
    for (const trigger of WORKFLOW_TRIGGERS) {
      const recommendation = orchestrateWorkflow({
        trigger,
        companyId: "c1",
        sourceModule: "test",
        createdBy: "tester@test",
      });
      for (const action of recommendation.recommendedActions) {
        assert.ok(
          (WORKFLOW_ACTION_LIBRARY as readonly string[]).includes(action),
          `${trigger} recommends "${action}", which is not in the action library`
        );
      }
    }
  });

  it("resolves a metric to its trigger", () => {
    assert.equal(triggerForMetric("storage_ageing_over_30_days_count")?.key, "rr_storage_ageing");
    assert.equal(triggerForMetric("not_a_metric"), null);
  });
});

// ---------------------------------------------------------------------------
describe("Phase 6 — orchestration of vertical triggers", () => {
  it("does not fabricate a rand figure when none was supplied", () => {
    const recommendation = orchestrateWorkflow({
      trigger: "Storage Ageing",
      companyId: "c1",
      sourceModule: "Road & Recovery Intelligence",
      createdBy: "tester@test",
      evidence: { affectedCount: 4 },
    });
    assert.equal(recommendation.impactEstimate.financialImpactZAR, 0);
    assert.ok(recommendation.impactEstimate.operationalImprovementScore > 0);
  });

  it("uses a calculated rand figure verbatim", () => {
    const recommendation = orchestrateWorkflow({
      trigger: "Storage Ageing",
      companyId: "c1",
      sourceModule: "Road & Recovery Intelligence",
      createdBy: "tester@test",
      evidence: { affectedCount: 4, financialImpactZAR: 18_450 },
    });
    // Not multiplied, not adjusted. The vertical calculated it from a recorded rate.
    assert.equal(recommendation.impactEstimate.financialImpactZAR, 18_450);
  });

  it("prefers a determined root cause over the template default", () => {
    const determined = orchestrateWorkflow({
      trigger: "Dispatch Delay",
      companyId: "c1",
      sourceModule: "Road & Recovery Intelligence",
      createdBy: "tester@test",
      evidence: { rootCause: "Offers declined for vehicle breakdown.", confidence: 82 },
    });
    assert.equal(determined.whyLikely, "Offers declined for vehicle breakdown.");
    assert.equal(determined.confidence, 82);
  });

  it("falls back to the template cause when none was determined", () => {
    const fallback = orchestrateWorkflow({
      trigger: "Dispatch Delay",
      companyId: "c1",
      sourceModule: "Road & Recovery Intelligence",
      createdBy: "tester@test",
      evidence: {},
    });
    assert.ok(fallback.whyLikely.length > 0);
    assert.ok(fallback.confidence > 0);
  });

  it("titles a vertical workflow after the operation, not an employee", () => {
    const recommendation = orchestrateWorkflow({
      trigger: "Billing Blocked",
      companyId: "c1",
      sourceModule: "Road & Recovery Intelligence",
      createdBy: "tester@test",
      evidence: { subject: "Billing Readiness" },
    });
    assert.match(recommendation.workflowTitle, /Billing Readiness/);
    assert.ok(!recommendation.workflowTitle.includes("Employee"));
  });

  it("leaves every workforce trigger behaving exactly as before", () => {
    const lateArrival = orchestrateWorkflow({
      trigger: "Late Arrival",
      companyId: "c1",
      employeeName: "Someone",
      sourceModule: "Workforce AI Copilot",
      createdBy: "tester@test",
      evidence: { lateMinutes: 30, signalStrength: 2 },
    });
    assert.equal(lateArrival.workflowTitle, "Late Arrival - Someone");
    assert.equal(lateArrival.impactEstimate.financialImpactZAR, Math.round(30 * 3.2 * 1.2));
    assert.deepEqual(Object.keys(lateArrival.beforeMetrics).sort(), [
      "complianceBreaches",
      "lateArrivals",
      "overtimeHours",
      "payrollBlockers",
    ]);
  });
});

// ---------------------------------------------------------------------------
describe("Phase 6 — recommendations", () => {
  const finding = (overrides: Record<string, unknown> = {}) => ({
    key: "storage_ageing_over_30_days_count:critical",
    domain: "storage" as const,
    severity: "high" as const,
    symptom: "Vehicles held over 30 days is 12 against a target of 3.",
    rootCause: "Release authority has never been obtained.",
    rootCauseConfidence: 75,
    evidence: ["9 of 12 aged vehicles have no active authority."],
    recommendation: "Chase release authority.",
    alternative: "Begin disposal.",
    expectedOutcome: "Bay capacity recovered.",
    consequenceIfIgnored: "Capacity shrinks.",
    metricKey: "storage_ageing_over_30_days_count",
    affectedCount: 12,
    financialImpactZAR: 24_000,
    beforeMetrics: { measuredValue: 12, targetValue: 3, sampleSize: 1 },
    ...overrides,
  });

  it("orders by priority, highest first", () => {
    const results = buildRecommendations(
      [
        finding({ key: "low", severity: "low", affectedCount: 1, financialImpactZAR: null }),
        finding({ key: "critical", severity: "critical", affectedCount: 20, financialImpactZAR: 90_000 }),
        finding({ key: "medium", severity: "medium", affectedCount: 5, financialImpactZAR: 1_000 }),
      ],
      { asOfIso: AS_OF, limit: 10 }
    );
    assert.deepEqual(results.map((entry) => entry.key), ["critical", "medium", "low"]);
  });

  it("breaks ties deterministically", () => {
    const a = finding({ key: "aaa" });
    const b = finding({ key: "bbb" });
    const first = buildRecommendations([a, b], { asOfIso: AS_OF, limit: 10 });
    const second = buildRecommendations([b, a], { asOfIso: AS_OF, limit: 10 });
    assert.deepEqual(first.map((entry) => entry.key), second.map((entry) => entry.key));
  });

  it("lets severity outrank breadth", () => {
    const critical = priorityScore(finding({ severity: "critical", affectedCount: 1, financialImpactZAR: null }) as never);
    const wideButLow = priorityScore(finding({ severity: "low", affectedCount: 500, financialImpactZAR: 200_000 }) as never);
    assert.ok(critical > wideButLow);
  });

  it("sets a tighter due date for a more severe finding", () => {
    const [critical] = buildRecommendations([finding({ severity: "critical" })], { asOfIso: AS_OF, limit: 1 });
    const [low] = buildRecommendations([finding({ severity: "low" })], { asOfIso: AS_OF, limit: 1 });
    assert.ok(critical.dueDateIso < low.dueDateIso);
  });

  it("marks an unquantified impact as unknown rather than zero", () => {
    const [result] = buildRecommendations([finding({ financialImpactZAR: null })], {
      asOfIso: AS_OF,
      limit: 1,
    });
    assert.equal(result.financialImpactKnown, false);
    assert.equal(result.financialImpactZAR, null);
  });

  it("drops a finding with no escalation route rather than forcing a wrong trigger", () => {
    const results = buildRecommendations(
      [finding({ key: "orphan", metricKey: "profitability_expected_revenue_zar", domain: "profitability" })],
      { asOfIso: AS_OF, limit: 10 }
    );
    assert.equal(results.length, 0);
  });

  it("omits the financial impact from the orchestration evidence when unknown", () => {
    const [result] = buildRecommendations([finding({ financialImpactZAR: null })], {
      asOfIso: AS_OF,
      limit: 1,
    });
    const input = toOrchestrationInput(result, { companyId: "c1", createdBy: "tester@test" });
    assert.equal("financialImpactZAR" in (input.evidence ?? {}), false);
  });

  it("records both the amount and whether it was known on the action payload", () => {
    const [known] = buildRecommendations([finding()], { asOfIso: AS_OF, limit: 1 });
    const payload = toActionPayload(known, {
      windowFromIso: WINDOW.fromIso,
      windowToIso: WINDOW.toIso,
      asOfIso: AS_OF,
    });
    assert.equal(payload.financial_impact_zar, 24_000);
    assert.equal(payload.financial_impact_known, true);
    assert.equal(payload.root_cause, "Release authority has never been obtained.");
    assert.equal(payload.metric_key, "storage_ageing_over_30_days_count");
    // The payload must carry the window so a later outcome check compares like with like.
    assert.equal(payload.window_from, WINDOW.fromIso);
  });

  it("keeps symptom, root cause and recommendation separate", () => {
    const [result] = buildRecommendations([finding()], { asOfIso: AS_OF, limit: 1 });
    assert.notEqual(result.symptom, result.rootCause);
    assert.notEqual(result.rootCause, result.recommendation);
    assert.ok(result.alternative.length > 0);
    assert.ok(result.consequenceIfIgnored.length > 0);
  });

  it("preserves a null root cause rather than inventing one", () => {
    const [result] = buildRecommendations(
      [finding({ rootCause: null, rootCauseConfidence: null, evidence: [] })],
      { asOfIso: AS_OF, limit: 1 }
    );
    assert.equal(result.rootCause, null);
    assert.equal(result.rootCauseConfidence, null);
  });
});

// ---------------------------------------------------------------------------
describe("Phase 6 — vertical health registry", () => {
  it("excludes an unprovisioned vertical from the denominator", () => {
    const combined = combineBusinessHealth([
      workforceContribution({
        employeeCount: 50,
        averageEmployeeHealthScore: 80,
        highRiskEmployeeCount: 2,
        recommendationsCount: 3,
      }),
      roadRecoveryContribution({
        provisioned: false,
        score: null,
        coveragePct: null,
        narrative: "",
        jobCount: 0,
        openCriticalExceptions: 0,
        metricsWithoutTargets: 0,
      }),
    ]);
    // 80, not 40. A customer without the module has not failed at it.
    assert.equal(combined.score, 80);
    assert.deepEqual(combined.includedVerticals, ["workforce"]);
    assert.equal(combined.excludedVerticals.length, 1);
    assert.match(combined.excludedVerticals[0].reason, /not provisioned/);
  });

  it("excludes a provisioned vertical that has no configured targets", () => {
    const combined = combineBusinessHealth([
      workforceContribution({
        employeeCount: 50,
        averageEmployeeHealthScore: 80,
        highRiskEmployeeCount: 0,
        recommendationsCount: 0,
      }),
      roadRecoveryContribution({
        provisioned: true,
        score: null,
        coveragePct: 0,
        narrative: "not scoreable",
        jobCount: 120,
        openCriticalExceptions: 1,
        metricsWithoutTargets: 30,
      }),
    ]);
    assert.equal(combined.score, 80);
    assert.match(combined.excludedVerticals[0].reason, /No operational targets/);
  });

  it("weights both verticals when both are scoreable", () => {
    const combined = combineBusinessHealth([
      workforceContribution({
        employeeCount: 10,
        averageEmployeeHealthScore: 100,
        highRiskEmployeeCount: 0,
        recommendationsCount: 0,
        weight: 60,
      }),
      roadRecoveryContribution({
        provisioned: true,
        score: 50,
        coveragePct: 100,
        narrative: "scored",
        jobCount: 10,
        openCriticalExceptions: 0,
        metricsWithoutTargets: 0,
        weight: 40,
      }),
    ]);
    assert.equal(combined.score, 80);
  });

  it("reports no combined score when no vertical can be scored", () => {
    const combined = combineBusinessHealth([
      workforceContribution({
        employeeCount: 0,
        averageEmployeeHealthScore: null,
        highRiskEmployeeCount: 0,
        recommendationsCount: 0,
      }),
      roadRecoveryContribution({
        provisioned: false,
        score: null,
        coveragePct: null,
        narrative: "",
        jobCount: 0,
        openCriticalExceptions: 0,
        metricsWithoutTargets: 0,
      }),
    ]);
    assert.equal(combined.score, null);
    assert.equal(combined.band, "not_scoreable");
    assert.match(combined.narrative, /cannot be scored/);
  });

  it("never scores a workforce with no employees as zero", () => {
    const contribution = workforceContribution({
      employeeCount: 0,
      averageEmployeeHealthScore: 0,
      highRiskEmployeeCount: 0,
      recommendationsCount: 0,
    });
    assert.equal(contribution.score, null);
  });
});

// ---------------------------------------------------------------------------
describe("Phase 6 — domain assembly", () => {
  const emptyFacts: RrIntelligenceFacts = {
    jobs: [],
    towJobs: [],
    bystandJobs: [],
    events: [],
    assignments: [],
    standbySummaries: [],
    bystandDetails: [],
    bookings: [],
    accruals: [],
    authorities: [],
    trucks: [],
    certifications: [],
    authorisations: [],
    calculations: [],
    distanceFacts: [],
    distanceEstimates: [],
    disputes: [],
    exceptions: [],
    margins: [],
    authJobs: [],
  };

  const context = {
    thresholds: [] as RrThreshold[],
    window: WINDOW,
    filters: { serviceCode: null, counterpartyId: null },
    detailLimit: 10,
  };

  it("produces every measured domain even with no data at all", () => {
    const built = buildDomains(emptyFacts, context);
    const keys = built.domains.map((entry) => entry.domain);
    for (const domain of RR_INTELLIGENCE_DOMAINS) {
      if (domain === "executive_health" || domain === "recommended_actions") continue;
      assert.ok(keys.includes(domain), `${domain} is missing from the assembly`);
    }
  });

  it("raises no finding at all when no target is configured", () => {
    const built = buildDomains(emptyFacts, context);
    assert.equal(built.findings.length, 0);
  });

  it("reports NO SLA CONFIGURED on the SLA domain when nothing is set", () => {
    const built = buildDomains(emptyFacts, context);
    const sla = built.domains.find((entry) => entry.domain === "sla");
    assert.equal(sla?.empty, true);
    assert.match(String(sla?.detail.message), /NO SLA CONFIGURED/);
    assert.equal(sla?.detail.configuredCount, 0);
    // Every measured metric is still listed, so the customer sees their own numbers.
    assert.ok(Number(sla?.detail.totalMetrics) > 0);
  });

  it("refuses to measure a BYSTAND job as a tow", () => {
    const contaminated: RrIntelligenceFacts = {
      ...emptyFacts,
      towJobs: [
        {
          serviceJobId: "b1",
          workflowKey: "bystand",
          workflowVersion: 2,
          serviceCode: "bystand",
          counterpartyId: null,
          createdAt: "2026-06-10T08:00:00.000Z",
          serviceState: "standing_by",
        },
      ],
    };
    assert.throws(() => buildDomains(contaminated, context), /BYSTAND/);
  });

  it("raises a critical finding on an open critical exception with no target configured", () => {
    // A recorded critical exception is a judgement the operation already made. It does
    // not need a threshold to be worth a manager's morning.
    const built = buildDomains(
      {
        ...emptyFacts,
        exceptions: [
          {
            id: "e1",
            origin: "job",
            serviceJobId: "j1",
            exceptionCode: "expired_certification",
            severity: "critical",
            detail: null,
            detectedBy: "system",
            resolutionStatus: "open",
            createdAt: "2026-06-10T08:00:00.000Z",
            resolvedAt: null,
            automationActionId: null,
          },
        ],
      },
      context
    );
    const critical = built.findings.find((entry) => entry.key === "exception_critical_open:fact");
    assert.ok(critical, "an open critical exception must raise a finding without a target");
    assert.equal(critical?.severity, "critical");
    assert.equal(critical?.affectedCount, 1);
  });

  it("raises a finding once a target is configured and breached", () => {
    const built = buildDomains(
      {
        ...emptyFacts,
        bookings: [
          {
            id: "b1",
            serviceJobId: "j1",
            yardId: "y1",
            yardName: "Main",
            status: "stored",
            checkedInAt: "2026-01-01T00:00:00.000Z",
            checkedOutAt: null,
            freeDays: 0,
            rateAmount: 150,
            currency: "ZAR",
            vehicleRegistration: "CA 1",
          },
        ],
      },
      {
        ...context,
        thresholds: [
          threshold({
            metricKey: "storage_ageing_over_30_days_count",
            targetValue: 0,
            warningValue: 1,
            criticalValue: 2,
            unit: "vehicles",
          }),
        ],
      }
    );
    const finding = built.findings.find(
      (entry) => entry.metricKey === "storage_ageing_over_30_days_count"
    );
    assert.ok(finding, "a breached configured target must raise a finding");
    // The rand figure is calculated from the recorded daily rate, not guessed.
    assert.ok((finding?.financialImpactZAR ?? 0) > 0);
    assert.ok((finding?.evidence.length ?? 0) > 0);
  });

  it("is deterministic across repeated runs on the same facts", () => {
    const facts: RrIntelligenceFacts = {
      ...emptyFacts,
      exceptions: Array.from({ length: 40 }, (_unused, index) => ({
        id: `e${index}`,
        origin: index % 2 === 0 ? ("job" as const) : ("billing" as const),
        serviceJobId: `j${index % 7}`,
        exceptionCode: index % 3 === 0 ? "missing_photograph" : "gps_unavailable",
        severity: index % 5 === 0 ? ("critical" as const) : ("medium" as const),
        detail: null,
        detectedBy: "system",
        resolutionStatus: index % 4 === 0 ? "resolved" : "open",
        createdAt: "2026-06-10T08:00:00.000Z",
        resolvedAt: index % 4 === 0 ? "2026-06-11T08:00:00.000Z" : null,
        automationActionId: null,
      })),
    };

    const a = buildDomains(facts, context);
    const b = buildDomains(facts, context);
    assert.deepEqual(JSON.stringify(a.domains), JSON.stringify(b.domains));
    assert.deepEqual(JSON.stringify(a.findings), JSON.stringify(b.findings));
  });

  it("handles a high volume of jobs without failing", () => {
    const jobs: RrJobTimingFact[] = Array.from({ length: 2000 }, (_unused, index) => ({
      serviceJobId: `j${index}`,
      workflowKey: "tow_recovery",
      workflowVersion: 1,
      serviceCode: "tow_in",
      counterpartyId: null,
      createdAt: "2026-06-10T08:00:00.000Z",
      serviceState: "closed",
    }));
    const events: RrStateEventFact[] = jobs.flatMap((job, index) => [
      {
        serviceJobId: job.serviceJobId,
        workflowKey: "tow_recovery",
        workflowVersion: 1,
        fromState: "accepted",
        toState: "en_route",
        occurredAt: "2026-06-10T08:10:00.000Z",
        secondsInPreviousState: 60,
      },
      {
        serviceJobId: job.serviceJobId,
        workflowKey: "tow_recovery",
        workflowVersion: 1,
        fromState: "en_route",
        toState: "on_scene",
        occurredAt: new Date(Date.parse("2026-06-10T08:10:00.000Z") + (index % 60) * 60_000).toISOString(),
        secondsInPreviousState: (index % 60) * 60,
      },
    ]);

    const built = buildDomains({ ...emptyFacts, jobs, towJobs: jobs, events }, context);
    const tow = built.domains.find((entry) => entry.domain === "tow_operations");
    assert.equal(tow?.empty, false);
    const response = tow?.metrics.find((entry) => entry.key === "response_time_to_scene_minutes");
    assert.ok(response && response.sampleSize > 0);
  });
});

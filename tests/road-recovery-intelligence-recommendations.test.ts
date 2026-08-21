/**
 * REGRESSION — a breached target becomes an operational decision (DEF-03).
 *
 * ---------------------------------------------------------------------------
 * THE DEFECT THIS LOCKS DOWN
 * ---------------------------------------------------------------------------
 *
 * buildRecommendations() looked a trigger up by metric key, and fell back to the DOMAIN
 * trigger only when `metricKey` was null:
 *
 *     const definition = finding.metricKey
 *       ? triggerForMetric(finding.metricKey)
 *       : findingTriggerForDomain(finding.domain);
 *     if (!definition) continue;
 *
 * Every finding is built by findingFrom(), which ALWAYS stamps `metricKey` with
 * `metric.key`. The null branch was therefore unreachable, findingTriggerForDomain() was
 * dead code, and a breach on any of the forty catalogue metrics without a trigger of its
 * own was silently discarded.
 *
 * What a customer saw was worse than nothing: with a target of 0 published against
 * `authorisation_missing_count` and four jobs missing one, the health breakdown scored the
 * metric CRITICAL, weight 7, included — while the Action Centre on the same screen read
 * "No recommendations. Every configured target is being met." Two contradictory statements,
 * side by side, and the entire Operations Director promise failing at the exact moment it
 * had something to say.
 *
 * ---------------------------------------------------------------------------
 * WHAT IS ASSERTED
 * ---------------------------------------------------------------------------
 *
 * These are PURE tests against the real catalogue, so they run everywhere and pin the
 * behaviour rather than a database's contents. The first case is the defect itself. The
 * others hold the boundaries either side of it: a metric WITH its own trigger must still
 * use that one rather than the domain's, and a finding whose domain has no trigger either
 * must still be dropped — "everything reaching the Action Centre has a real escalation
 * route" is the rule, and this fix widened what satisfies it without removing it.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildRecommendations } from "@/lib/road-recovery/intelligence/recommendations";
import { triggerForMetric } from "@/lib/road-recovery/intelligence/triggers";
import type { RrFinding } from "@/lib/road-recovery/intelligence/types";

const ASOF = "2026-08-21T00:00:00.000Z";

function finding(overrides: Partial<RrFinding>): RrFinding {
  return {
    key: "test:critical",
    domain: "authorisation",
    severity: "high",
    symptom: "Jobs missing authorisation is 4 against a configured target of 0.",
    rootCause: "Authorisation was never obtained for these jobs.",
    rootCauseConfidence: 95,
    evidence: ["4 of 7 jobs requiring authorisation have none."],
    recommendation: "Chase the outstanding authorisation numbers.",
    alternative: "Agree a standing authorisation arrangement.",
    expectedOutcome: "Work is authorised before it is performed.",
    consequenceIfIgnored: "Jobs are worked that nobody agreed to pay for.",
    metricKey: "authorisation_missing_count",
    affectedCount: 4,
    financialImpactZAR: null,
    beforeMetrics: { measuredValue: 4, targetValue: 0, sampleSize: 7 },
    ...overrides,
  };
}

describe("Road & Recovery intelligence — a breach always produces a recommendation", () => {
  it("the metric that exposed the defect genuinely has no trigger of its own", () => {
    // If this ever stops being true the first test below would pass for the wrong reason.
    assert.equal(
      triggerForMetric("authorisation_missing_count"),
      null,
      "authorisation_missing_count is expected to rely on the domain fallback"
    );
  });

  it("raises a recommendation for a metric with no trigger, via its domain", () => {
    const recommendations = buildRecommendations([finding({})], { asOfIso: ASOF, limit: 10 });

    assert.equal(recommendations.length, 1, "the breach must not be silently discarded");
    const [card] = recommendations;

    // The escalation route is real, and it comes from the domain.
    assert.equal(card.triggerKey, "rr_authorisation_delay");
    assert.ok(card.ownerRole, "an action nobody owns is not an action");
    assert.ok(card.dueDateIso, "an action with no due date cannot be measured");

    // The Operations Director contract, carried through intact.
    assert.equal(card.rootCause, "Authorisation was never obtained for these jobs.");
    assert.equal(card.rootCauseConfidence, 95);
    assert.deepEqual(card.evidence, ["4 of 7 jobs requiring authorisation have none."]);
    assert.ok(card.recommendation);
    assert.ok(card.alternative);
    assert.ok(card.expectedOutcome);
    assert.ok(card.consequenceIfIgnored);
    assert.equal(card.affectedCount, 4);
    assert.equal(card.measuredValue, 4);
    assert.equal(card.targetValue, 0);
    assert.equal(card.financialImpactKnown, false, "an unknown rand figure is never faked as zero");
  });

  it("prefers the metric's OWN trigger when it has one", () => {
    const [card] = buildRecommendations(
      [finding({ metricKey: "billing_blocked_count", domain: "billing_readiness" })],
      { asOfIso: ASOF, limit: 10 }
    );
    assert.equal(card.triggerKey, "rr_billing_blocked", "the specific trigger must win over the domain");
  });

  it("still drops a finding whose metric AND domain have no route", () => {
    // `counterparty` declares no domain trigger, and this metric has none either, so there
    // is genuinely nowhere for the action to go.
    assert.equal(triggerForMetric("counterparty_job_volume"), null);
    const recommendations = buildRecommendations(
      [finding({ metricKey: "counterparty_job_volume", domain: "counterparty" })],
      { asOfIso: ASOF, limit: 10 }
    );
    assert.deepEqual(recommendations, [], "an action nobody can act on is still noise");
  });

  it("orders by priority so the worst thing is the first thing", () => {
    const recommendations = buildRecommendations(
      [
        finding({ key: "low:warning", severity: "medium", affectedCount: 1 }),
        finding({ key: "high:critical", severity: "critical", affectedCount: 40 }),
      ],
      { asOfIso: ASOF, limit: 10 }
    );
    assert.equal(recommendations.length, 2);
    assert.ok(
      recommendations[0].priorityScore >= recommendations[1].priorityScore,
      "the higher-priority finding must be first"
    );
    assert.equal(recommendations[0].key, "high:critical");
  });
});

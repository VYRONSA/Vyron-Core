/**
 * VYRON CORE — Road & Recovery vertical health score (Phase 6).
 *
 * PURE. Facts in, deterministic result out. No AI, no weighting learned from data, no
 * number that cannot be traced back to a measurement and a target the tenant configured.
 *
 * THIS IS A VERTICAL SCORE, NOT AN EXECUTIVE SCORE. It answers "how healthy is Road &
 * Recovery" and is handed to the EXISTING executive intelligence architecture, which
 * combines it with Workforce Health and any other vertical into Combined Business Health.
 * Nothing here duplicates that combination.
 *
 * Three rules make the number honest:
 *
 *   1. A metric with no data is EXCLUDED from the denominator and reported as excluded.
 *      It never becomes zero. A tenant who ran no storage jobs has not failed at storage.
 *
 *   2. A metric with no configured target is EXCLUDED and reported as NO SLA CONFIGURED.
 *      Scoring a metric against an invented target manufactures a failure nobody defined.
 *
 *   3. Informational metrics carry zero weight. Standing hours and job volume are business
 *      facts; treating a busy month as a health problem would be nonsense.
 *
 * The consequence is deliberate and must not be "fixed": a tenant who has configured
 * nothing gets NO score, not a score of zero and not a score of 100. The engine says so.
 */

import { metricDefinition } from "./metric-catalogue";
import { scoreMetric } from "./thresholds";
import type { RrHealthComponent, RrIntelligenceDomain, RrMetricResult } from "./types";

export const RR_HEALTH_ENGINE_VERSION = "rr-health-engine-1.0.0" as const;

export type RrDomainScore = {
  domain: RrIntelligenceDomain;
  label: string;
  /** null when no metric in this domain could be scored. Never zero. */
  score: number | null;
  includedWeight: number;
  excludedWeight: number;
  componentCount: number;
  includedCount: number;
  reason: string;
};

export type RrHealthResult = {
  engineVersion: typeof RR_HEALTH_ENGINE_VERSION;
  /** 0-100, or null when nothing at all could be scored. NEVER zero as a placeholder. */
  score: number | null;
  band: "healthy" | "watch" | "at_risk" | "critical" | "not_scoreable";
  /** Every contributor, including the excluded ones and why they were excluded. */
  components: RrHealthComponent[];
  domains: RrDomainScore[];
  includedWeight: number;
  excludedWeight: number;
  /** How much of the catalogue the tenant has actually configured targets for. */
  configuredCoveragePct: number;
  metricsWithoutTargets: string[];
  metricsWithoutData: string[];
  narrative: string;
};

function round(value: number, places = 2): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

function bandFor(score: number | null): RrHealthResult["band"] {
  if (score === null) return "not_scoreable";
  if (score >= 85) return "healthy";
  if (score >= 70) return "watch";
  if (score >= 50) return "at_risk";
  return "critical";
}

/**
 * Builds the health result from measured metrics.
 *
 * The weighted mean is taken over INCLUDED weight only. Re-normalising the denominator is
 * what stops an unconfigured metric from dragging the score down: with three of ten
 * metrics configured, the score is the honest weighted mean of those three, and the
 * remaining weight is reported separately so nobody mistakes partial coverage for a
 * complete picture.
 */
export function computeRoadRecoveryHealth(metrics: readonly RrMetricResult[]): RrHealthResult {
  const components: RrHealthComponent[] = [];

  for (const metric of metrics) {
    const definition = metricDefinition(metric.key);
    const weight = definition?.healthWeight ?? 0;

    if (weight <= 0) {
      components.push({
        metric: metric.key,
        label: metric.label,
        domain: metric.domain,
        value: metric.value,
        weight: 0,
        threshold: metric.target,
        band: metric.band,
        reason: metric.reason,
        score: null,
        contribution: null,
        included: false,
        exclusionReason:
          "Informational metric. Reported for context and never scored, because volume and revenue are business facts rather than performance defects.",
      });
      continue;
    }

    if (metric.value === null) {
      components.push({
        metric: metric.key,
        label: metric.label,
        domain: metric.domain,
        value: null,
        weight,
        threshold: metric.target,
        band: metric.band,
        reason: metric.reason,
        score: null,
        contribution: null,
        included: false,
        exclusionReason:
          "No data in the selected period. Excluded from the denominator rather than scored as zero.",
      });
      continue;
    }

    if (metric.thresholdSource !== "configured") {
      components.push({
        metric: metric.key,
        label: metric.label,
        domain: metric.domain,
        value: metric.value,
        weight,
        threshold: null,
        band: "not_configured",
        reason: metric.reason,
        score: null,
        contribution: null,
        included: false,
        exclusionReason:
          "NO SLA CONFIGURED. Excluded from scoring because judging a measurement against an invented target would manufacture a breach nobody defined.",
      });
      continue;
    }

    const score = scoreMetric(metric);
    if (score === null) {
      components.push({
        metric: metric.key,
        label: metric.label,
        domain: metric.domain,
        value: metric.value,
        weight,
        threshold: metric.target,
        band: metric.band,
        reason: metric.reason,
        score: null,
        contribution: null,
        included: false,
        exclusionReason: "The configured target could not produce a score.",
      });
      continue;
    }

    components.push({
      metric: metric.key,
      label: metric.label,
      domain: metric.domain,
      value: metric.value,
      weight,
      threshold: metric.target,
      band: metric.band,
      reason: metric.reason,
      score: round(score),
      contribution: round(weight * score),
      included: true,
      exclusionReason: null,
    });
  }

  const included = components.filter((component) => component.included);
  const includedWeight = included.reduce((sum, component) => sum + component.weight, 0);
  const excludedWeight = components
    .filter((component) => !component.included && component.weight > 0)
    .reduce((sum, component) => sum + component.weight, 0);

  const score =
    includedWeight === 0
      ? null
      : round(
          included.reduce((sum, component) => sum + (component.contribution ?? 0), 0) / includedWeight
        );

  // Per-domain rollup, using the same re-normalising rule.
  const domainMap = new Map<RrIntelligenceDomain, RrHealthComponent[]>();
  for (const component of components) {
    const bucket = domainMap.get(component.domain);
    if (bucket) bucket.push(component);
    else domainMap.set(component.domain, [component]);
  }

  const domains: RrDomainScore[] = [...domainMap.entries()]
    .map(([domain, bucket]) => {
      const domainIncluded = bucket.filter((component) => component.included);
      const weight = domainIncluded.reduce((sum, component) => sum + component.weight, 0);
      const domainExcluded = bucket
        .filter((component) => !component.included && component.weight > 0)
        .reduce((sum, component) => sum + component.weight, 0);
      const domainScore =
        weight === 0
          ? null
          : round(
              domainIncluded.reduce((sum, component) => sum + (component.contribution ?? 0), 0) / weight
            );

      return {
        domain,
        label: bucket[0]?.label ?? domain,
        score: domainScore,
        includedWeight: weight,
        excludedWeight: domainExcluded,
        componentCount: bucket.length,
        includedCount: domainIncluded.length,
        reason:
          domainScore === null
            ? domainExcluded > 0
              ? "Not scored: every scorable metric in this domain is missing data or has no configured target."
              : "Not scored: this domain contributes only informational metrics."
            : `Scored from ${domainIncluded.length} of ${bucket.length} metrics (${weight} of ${weight + domainExcluded} available weight).`,
      };
    })
    .sort((a, b) => (a.domain < b.domain ? -1 : a.domain > b.domain ? 1 : 0));

  const scorable = components.filter((component) => component.weight > 0);
  const withoutTargets = scorable
    .filter((component) => component.band === "not_configured")
    .map((component) => component.metric)
    .sort();
  const withoutData = scorable
    .filter((component) => component.band === "no_data")
    .map((component) => component.metric)
    .sort();

  const coverage =
    scorable.length === 0 ? 0 : round((included.length / scorable.length) * 100);

  const narrative =
    score === null
      ? withoutTargets.length > 0
        ? `Road & Recovery health cannot be scored: ${withoutTargets.length} scorable metric(s) have NO SLA CONFIGURED and ${withoutData.length} have no data in this period. Configure operational targets to enable scoring. No score is reported rather than a misleading zero.`
        : "Road & Recovery health cannot be scored: there is no data in the selected period. No score is reported rather than a misleading zero."
      : `Road & Recovery health is ${score} out of 100, computed from ${included.length} of ${scorable.length} scorable metrics (${coverage}% coverage). ${withoutTargets.length} metric(s) have NO SLA CONFIGURED and ${withoutData.length} have no data; both are excluded from the denominator rather than scored as zero.`;

  return {
    engineVersion: RR_HEALTH_ENGINE_VERSION,
    score,
    band: bandFor(score),
    components: components.sort((a, b) => {
      // Worst included first, then excluded, so attention lands where it belongs.
      if (a.included !== b.included) return a.included ? -1 : 1;
      const left = a.score ?? Number.POSITIVE_INFINITY;
      const right = b.score ?? Number.POSITIVE_INFINITY;
      if (left !== right) return left - right;
      return a.metric < b.metric ? -1 : a.metric > b.metric ? 1 : 0;
    }),
    domains,
    includedWeight,
    excludedWeight,
    configuredCoveragePct: coverage,
    metricsWithoutTargets: withoutTargets,
    metricsWithoutData: withoutData,
    narrative,
  };
}

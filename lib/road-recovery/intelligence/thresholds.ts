/**
 * VYRON CORE — Road & Recovery operational target resolution (Phase 6).
 *
 * PURE. No I/O, no clock, no randomness.
 *
 * This is NOT a generic SLA platform. It is Road & Recovery operational target
 * configuration: a tenant states what "good" means for a metric, optionally narrowed to a
 * service code or a counterparty, and every measurement is then judged against the version
 * of that target that was in force at the instant being measured.
 *
 * The single most important behaviour in this file is what happens when a tenant has
 * configured NOTHING: the metric reports NO SLA CONFIGURED and is excluded from scoring.
 * It does not fall back to an industry default, a hardcoded number, or a value inferred
 * from the tenant's own history. An invented target produces invented breaches, and a
 * manager acting on an invented breach is being misled by their own system.
 */

import { metricDefinition } from "./metric-catalogue";
import type { RrMetricBand, RrMetricDirection, RrMetricResult, RrIntelligenceDomain } from "./types";

/** A configured target, as stored in rr_intelligence_thresholds. */
export type RrThreshold = {
  id: string;
  metricKey: string;
  /** null = applies to every service code. */
  serviceCode: string | null;
  /** null = applies to every counterparty. */
  counterpartyId: string | null;
  targetValue: number;
  warningValue: number | null;
  criticalValue: number | null;
  unit: string;
  severity: "low" | "medium" | "high" | "critical";
  /** ISO instant. Inclusive. */
  effectiveFrom: string;
  /** ISO instant, exclusive. null = still in force. */
  effectiveTo: string | null;
  active: boolean;
  version: number;
  /**
   * Provenance. Optional because the pure threshold logic never needs it — resolveBand()
   * judges a measurement against the numbers alone — but the configuration screen has to
   * show WHO set a target and why, or a retired version is an unexplained number.
   */
  notes?: string | null;
  createdBy?: string | null;
  retiredBy?: string | null;
  retiredAt?: string | null;
};

export const RR_NO_SLA_CONFIGURED = "NO SLA CONFIGURED" as const;

/** What a metric is measured against, plus how we got there. */
export type RrThresholdResolution =
  | { configured: false; reason: typeof RR_NO_SLA_CONFIGURED }
  | { configured: true; threshold: RrThreshold; specificity: number };

/**
 * Picks the target that applies to one measurement.
 *
 * Specificity beats recency: a target set for "accident_recovery jobs for Insurer A" is a
 * deliberate statement about that combination and must not be overridden by a newer
 * company-wide default. Within one specificity level the highest version in force at the
 * as-of instant wins, which is what makes a historical result reproducible — replaying a
 * March calculation resolves March's version even after April's replaced it.
 */
export function resolveThreshold(
  thresholds: readonly RrThreshold[],
  input: {
    metricKey: string;
    serviceCode?: string | null;
    counterpartyId?: string | null;
    asOfIso: string;
  }
): RrThresholdResolution {
  const asOf = Date.parse(input.asOfIso);
  if (!Number.isFinite(asOf)) return { configured: false, reason: RR_NO_SLA_CONFIGURED };

  const applicable = thresholds.filter((candidate) => {
    if (candidate.metricKey !== input.metricKey) return false;

    // `active` is NOT the test for applicability. A retired version still governs the
    // period it was in force for, and excluding it would judge a March measurement by
    // April's target the moment the report was re-opened. What makes a retired version
    // applicable is its effective window, checked below.
    //
    // The one exception is a version retired WITHOUT an end instant: there is no way to
    // say when it stopped applying, so it applies to nothing rather than to everything.
    if (!candidate.active && candidate.effectiveTo === null) return false;

    // A scoped target applies only to its scope. A null scope is a wildcard, not a
    // mismatch, which is what lets a company-wide default coexist with a narrow override.
    if (candidate.serviceCode !== null && candidate.serviceCode !== (input.serviceCode ?? null)) return false;
    if (candidate.counterpartyId !== null && candidate.counterpartyId !== (input.counterpartyId ?? null)) {
      return false;
    }

    const from = Date.parse(candidate.effectiveFrom);
    if (!Number.isFinite(from) || from > asOf) return false;
    if (candidate.effectiveTo !== null) {
      const to = Date.parse(candidate.effectiveTo);
      if (!Number.isFinite(to) || to <= asOf) return false;
    }
    return true;
  });

  if (applicable.length === 0) return { configured: false, reason: RR_NO_SLA_CONFIGURED };

  const scored = applicable.map((candidate) => ({
    candidate,
    specificity: (candidate.serviceCode !== null ? 2 : 0) + (candidate.counterpartyId !== null ? 1 : 0),
  }));

  scored.sort((a, b) => {
    if (b.specificity !== a.specificity) return b.specificity - a.specificity;
    if (b.candidate.version !== a.candidate.version) return b.candidate.version - a.candidate.version;
    // Deterministic tiebreak so two runs over the same data never disagree.
    return a.candidate.id < b.candidate.id ? -1 : a.candidate.id > b.candidate.id ? 1 : 0;
  });

  const winner = scored[0];
  return { configured: true, threshold: winner.candidate, specificity: winner.specificity };
}

/**
 * Fills in the warning and critical rails a tenant did not supply.
 *
 * A tenant who states only "response time should be 30 minutes" has still said something
 * precise: 30 is the target. The rails derived here are a presentation concern — they
 * space the bands around a number the TENANT chose. Nothing is derived when there is no
 * configured target at all, which is the case that matters.
 */
function rails(threshold: RrThreshold, direction: RrMetricDirection): { warning: number; critical: number } {
  const target = threshold.targetValue;
  if (threshold.warningValue !== null && threshold.criticalValue !== null) {
    return { warning: threshold.warningValue, critical: threshold.criticalValue };
  }

  if (direction === "higher_is_better") {
    const warning = threshold.warningValue ?? target * 0.9;
    const critical = threshold.criticalValue ?? target * 0.75;
    return { warning, critical };
  }

  const warning = threshold.warningValue ?? target * 1.25;
  const critical = threshold.criticalValue ?? target * 1.5;
  return { warning, critical };
}

function round(value: number, places = 2): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

function clamp(value: number, min = 0, max = 100): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

/**
 * Turns a raw measurement into a banded, explained metric result.
 *
 * `value === null` or `sampleSize === 0` produce band "no_data". They never produce zero:
 * a company with no storage jobs has no average storage duration, and printing 0 days
 * would read as flawless performance in a domain that was never exercised.
 */
export function buildMetric(input: {
  metricKey: string;
  value: number | null;
  sampleSize: number;
  thresholds: readonly RrThreshold[];
  serviceCode?: string | null;
  counterpartyId?: string | null;
  asOfIso: string;
  /** Overrides the catalogue label, for per-counterparty or per-driver breakdowns. */
  labelSuffix?: string | null;
}): RrMetricResult {
  const definition = metricDefinition(input.metricKey);
  const label = definition?.label ?? input.metricKey;
  const domain: RrIntelligenceDomain = definition?.domain ?? "executive_health";
  const direction: RrMetricDirection = definition?.direction ?? "informational";

  const resolution = resolveThreshold(input.thresholds, {
    metricKey: input.metricKey,
    serviceCode: input.serviceCode ?? null,
    counterpartyId: input.counterpartyId ?? null,
    asOfIso: input.asOfIso,
  });

  const base: RrMetricResult = {
    key: input.metricKey,
    label: input.labelSuffix ? `${label} — ${input.labelSuffix}` : label,
    domain,
    unit: definition?.unit ?? "",
    direction,
    value: input.sampleSize > 0 && input.value !== null && Number.isFinite(input.value)
      ? round(input.value)
      : null,
    sampleSize: input.sampleSize,
    target: null,
    warning: null,
    critical: null,
    thresholdSource: "not_configured",
    thresholdId: null,
    thresholdVersion: null,
    band: "no_data",
    reason: "",
  };

  if (base.value === null) {
    return {
      ...base,
      band: "no_data",
      reason:
        input.sampleSize === 0
          ? "No data in the selected period. Reported as no data rather than zero."
          : "The available facts do not produce a value. Reported as no data rather than zero.",
    };
  }

  if (!resolution.configured) {
    return {
      ...base,
      band: "not_configured",
      reason: `${RR_NO_SLA_CONFIGURED}. Measured value shown; no target has been set for this metric, so no breach can be claimed.`,
    };
  }

  const threshold = resolution.threshold;
  const { warning, critical } = rails(threshold, direction);
  const value = base.value;

  let band: RrMetricBand;
  if (direction === "higher_is_better") {
    band = value >= threshold.targetValue ? "ok" : value >= warning ? "warning" : value >= critical ? "critical" : "critical";
  } else {
    // Informational metrics with a configured target are judged as lower_is_better, which
    // is what a tenant means when they set a ceiling on something like standing hours.
    band = value <= threshold.targetValue ? "ok" : value <= warning ? "warning" : "critical";
  }

  const comparison = direction === "higher_is_better" ? "at or above" : "at or below";
  const reason =
    band === "ok"
      ? `Meeting the configured target of ${round(threshold.targetValue)} ${threshold.unit} (${comparison} target).`
      : band === "warning"
        ? `Past the target of ${round(threshold.targetValue)} ${threshold.unit} but within the warning rail of ${round(warning)}.`
        : `Past the critical rail of ${round(critical)} ${threshold.unit} against a target of ${round(threshold.targetValue)}.`;

  return {
    ...base,
    target: round(threshold.targetValue),
    warning: round(warning),
    critical: round(critical),
    thresholdSource: "configured",
    thresholdId: threshold.id,
    thresholdVersion: threshold.version,
    band,
    reason: `${reason} Measured over ${input.sampleSize} ${input.sampleSize === 1 ? "record" : "records"} against threshold v${threshold.version}.`,
  };
}

/**
 * The 0-100 score a banded metric contributes to health.
 *
 * Deterministic and piecewise-linear, so a manager can be told exactly why a number moved.
 * Returns null for any metric that must be excluded from the denominator — no data, no
 * configured target, or an informational metric that was never a performance judgement.
 */
export function scoreMetric(metric: RrMetricResult): number | null {
  if (metric.value === null) return null;
  if (metric.thresholdSource !== "configured") return null;
  if (metric.target === null || metric.warning === null || metric.critical === null) return null;

  const { value, target, warning, critical, direction } = metric;

  // A degenerate configuration (target === critical) would divide by zero. Rather than
  // guess, fall back to the band midpoints, which is still deterministic and explainable.
  const span = (a: number, b: number): number => (a === b ? 0 : (value - a) / (b - a));

  if (direction === "higher_is_better") {
    if (value >= target) return 100;
    if (value >= warning) return round(clamp(75 + span(warning, target) * 25));
    if (value >= critical) return round(clamp(40 + span(critical, warning) * 35));
    if (critical <= 0) return 0;
    return round(clamp((value / critical) * 40));
  }

  if (value <= target) return 100;
  if (value <= warning) return round(clamp(100 - span(target, warning) * 25));
  if (value <= critical) return round(clamp(75 - span(warning, critical) * 35));
  // Beyond critical, decay to zero over a second critical-width band.
  const overshoot = critical === 0 ? 1 : (value - critical) / Math.max(critical, 1e-9);
  return round(clamp(40 - overshoot * 40));
}

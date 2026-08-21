/**
 * VYRON CORE — Vertical health registry (Phase 6).
 *
 * PURE. Facts in, deterministic result out.
 *
 * THIS IS AN ADAPTER, NOT A SECOND EXECUTIVE ENGINE.
 *
 * VYRON CORE has one Executive Intelligence layer and it stays the master. What was
 * missing was a seam: the executive layer knew how to score Workforce and nothing else, so
 * a new vertical had no way in short of duplicating the whole thing. This file is that
 * seam — a registry that accepts a health contribution from any vertical and combines them
 * into Combined Business Health:
 *
 *     Workforce Intelligence ──┐
 *     Road & Recovery ─────────┼──> Executive Intelligence ──> Action ──> Outcome
 *     Future verticals ────────┘
 *
 * It computes NO vertical score of its own. Workforce health comes from the existing
 * executive workforce engine and Road & Recovery health from the Road & Recovery health
 * engine; this file only weighs and combines what they already decided.
 *
 * The NULL rule from the vertical engines is preserved end to end: a vertical that cannot
 * be scored is EXCLUDED from the denominator and reported as excluded. It never becomes a
 * zero, because a customer who has not enabled Road & Recovery has not failed at it.
 */

export const VERTICAL_HEALTH_REGISTRY_VERSION = "vyron-vertical-health-1.0.0" as const;

export const VERTICAL_KEYS = ["workforce", "road_recovery"] as const;
export type VerticalKey = (typeof VERTICAL_KEYS)[number];

export type VerticalHealthBand = "healthy" | "watch" | "at_risk" | "critical" | "not_scoreable";

/** One vertical's contribution to the business picture. */
export type VerticalHealthContribution = {
  vertical: VerticalKey;
  label: string;
  /** 0-100, or null when the vertical could not be scored. NEVER zero as a placeholder. */
  score: number | null;
  band: VerticalHealthBand;
  /** Relative importance of this vertical in Combined Business Health. */
  weight: number;
  /** How much of the vertical's own metric catalogue was actually scoreable. */
  coveragePct: number | null;
  /** Whether the module is provisioned for this customer at all. */
  available: boolean;
  /** Populated when available = false or score = null. */
  unavailableReason: string | null;
  narrative: string;
  /** Headline numbers the executive view shows under this vertical. */
  highlights: Array<{ label: string; value: string }>;
};

export type CombinedBusinessHealth = {
  registryVersion: typeof VERTICAL_HEALTH_REGISTRY_VERSION;
  /** 0-100, or null when no vertical could be scored. */
  score: number | null;
  band: VerticalHealthBand;
  verticals: VerticalHealthContribution[];
  includedVerticals: VerticalKey[];
  excludedVerticals: Array<{ vertical: VerticalKey; reason: string }>;
  includedWeight: number;
  excludedWeight: number;
  narrative: string;
};

function round(value: number, places = 2): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

export function bandForScore(score: number | null): VerticalHealthBand {
  if (score === null) return "not_scoreable";
  if (score >= 85) return "healthy";
  if (score >= 70) return "watch";
  if (score >= 50) return "at_risk";
  return "critical";
}

/**
 * Adapts the EXISTING executive workforce intelligence result into a contribution.
 *
 * `averageEmployeeHealthScore` is the number the workforce engine already computes and
 * publishes. It is passed through unchanged: re-deriving a workforce score here would
 * create exactly the second executive engine this file exists to avoid.
 */
export function workforceContribution(input: {
  employeeCount: number;
  averageEmployeeHealthScore: number | null;
  highRiskEmployeeCount: number;
  recommendationsCount: number;
  weight?: number;
}): VerticalHealthContribution {
  // No employees means nothing to score, not a score of zero.
  const scoreable = input.employeeCount > 0 && input.averageEmployeeHealthScore !== null;
  const score = scoreable ? round(input.averageEmployeeHealthScore as number) : null;

  return {
    vertical: "workforce",
    label: "Workforce Health",
    score,
    band: bandForScore(score),
    weight: input.weight ?? 60,
    coveragePct: null,
    available: true,
    unavailableReason: scoreable
      ? null
      : "No employee records in scope, so workforce health cannot be scored. Excluded from Combined Business Health rather than counted as zero.",
    narrative: scoreable
      ? `Workforce health is ${score} out of 100 across ${input.employeeCount} employees, with ${input.highRiskEmployeeCount} at high risk and ${input.recommendationsCount} open recommendation(s).`
      : "Workforce health is not scoreable: no employee records are in scope.",
    highlights: [
      { label: "Employees", value: String(input.employeeCount) },
      { label: "High risk", value: String(input.highRiskEmployeeCount) },
      { label: "Recommendations", value: String(input.recommendationsCount) },
    ],
  };
}

/**
 * Adapts a Road & Recovery health result into a contribution.
 *
 * When the module is not provisioned the vertical is marked unavailable and drops out of
 * the denominator entirely. When it IS provisioned but has no configured targets, the
 * score is null and the reason says so — which is the state a customer will be in on the
 * day Road & Recovery goes live, and it must read as "not configured yet" rather than as
 * a failing operation.
 */
export function roadRecoveryContribution(input: {
  provisioned: boolean;
  score: number | null;
  coveragePct: number | null;
  narrative: string;
  jobCount: number;
  openCriticalExceptions: number;
  metricsWithoutTargets: number;
  weight?: number;
}): VerticalHealthContribution {
  if (!input.provisioned) {
    return {
      vertical: "road_recovery",
      label: "Road & Recovery Health",
      score: null,
      band: "not_scoreable",
      weight: input.weight ?? 40,
      coveragePct: null,
      available: false,
      unavailableReason:
        "The Road & Recovery module is not provisioned for this company. Excluded from Combined Business Health.",
      narrative: "Road & Recovery is not enabled for this company.",
      highlights: [],
    };
  }

  const score = input.score === null ? null : round(input.score);

  return {
    vertical: "road_recovery",
    label: "Road & Recovery Health",
    score,
    band: bandForScore(score),
    weight: input.weight ?? 40,
    coveragePct: input.coveragePct,
    available: true,
    unavailableReason:
      score === null
        ? input.metricsWithoutTargets > 0
          ? `No operational targets are configured for ${input.metricsWithoutTargets} scorable metric(s), so Road & Recovery health cannot be scored. Excluded from Combined Business Health rather than counted as zero.`
          : "No Road & Recovery data in the selected period, so health cannot be scored. Excluded from Combined Business Health rather than counted as zero."
        : null,
    narrative: input.narrative,
    highlights: [
      { label: "Jobs in period", value: String(input.jobCount) },
      { label: "Open critical exceptions", value: String(input.openCriticalExceptions) },
      {
        label: "Target coverage",
        value: input.coveragePct === null ? "Not configured" : `${round(input.coveragePct)}%`,
      },
    ],
  };
}

/**
 * Combined Business Health.
 *
 * The weighted mean is taken over verticals that could actually be scored, and the weight
 * belonging to the rest is reported rather than absorbed. A company running Workforce
 * alone gets its workforce score as its business score — which is correct — and is told
 * that Road & Recovery contributed nothing and why.
 */
export function combineBusinessHealth(
  contributions: readonly VerticalHealthContribution[]
): CombinedBusinessHealth {
  const included = contributions.filter(
    (entry): entry is VerticalHealthContribution & { score: number } =>
      entry.available && entry.score !== null && entry.weight > 0
  );
  const excluded = contributions.filter((entry) => !included.includes(entry as never));

  const includedWeight = included.reduce((sum, entry) => sum + entry.weight, 0);
  const excludedWeight = excluded.reduce((sum, entry) => sum + entry.weight, 0);

  const score =
    includedWeight === 0
      ? null
      : round(included.reduce((sum, entry) => sum + entry.score * entry.weight, 0) / includedWeight);

  const narrative =
    score === null
      ? "Combined Business Health cannot be scored: no vertical produced a score in this period. No score is reported rather than a misleading zero."
      : `Combined Business Health is ${score} out of 100, weighted across ${included.length} vertical(s): ${included
          .map((entry) => `${entry.label} ${entry.score}`)
          .join(", ")}.${
          excluded.length > 0
            ? ` ${excluded.length} vertical(s) excluded: ${excluded
                .map((entry) => `${entry.label} (${entry.unavailableReason ?? "not scoreable"})`)
                .join("; ")}`
            : ""
        }`;

  return {
    registryVersion: VERTICAL_HEALTH_REGISTRY_VERSION,
    score,
    band: bandForScore(score),
    verticals: [...contributions].sort((a, b) => {
      if (a.available !== b.available) return a.available ? -1 : 1;
      if (b.weight !== a.weight) return b.weight - a.weight;
      return a.vertical < b.vertical ? -1 : a.vertical > b.vertical ? 1 : 0;
    }),
    includedVerticals: included.map((entry) => entry.vertical),
    excludedVerticals: excluded.map((entry) => ({
      vertical: entry.vertical,
      reason: entry.unavailableReason ?? "Not scoreable in this period.",
    })),
    includedWeight,
    excludedWeight,
    narrative,
  };
}

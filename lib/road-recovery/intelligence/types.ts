/**
 * VYRON CORE — Road & Recovery Intelligence, Phase 6.
 *
 * Shared vocabulary for the Road & Recovery vertical intelligence domain.
 *
 * Road & Recovery is a VERTICAL. It is NOT a second intelligence platform: the executive
 * layer, the action layer, the root-cause layer and the outcome layer already exist and
 * Phase 6 feeds them. Everything in this directory is PURE — facts in, deterministic
 * result out. No Supabase, no network, no Date.now(), no Math.random(), no AI.
 *
 * The "as-of" instant a calculation is performed against is always passed IN by the
 * caller, so a result computed today and the same result replayed next year are
 * identical. That is what makes a threshold breach reproducible.
 */

/** The bands a metric can occupy. Two of them mean "we are not going to pretend". */
export const RR_METRIC_BANDS = ["ok", "warning", "critical", "not_configured", "no_data"] as const;
export type RrMetricBand = (typeof RR_METRIC_BANDS)[number];

/**
 * Which way is good.
 *
 * `informational` metrics are reported and can still be banded when a tenant configures a
 * target for them, but they never carry health weight: standing hours and job volume are
 * business facts, not defects, and scoring them would invent a judgement nobody made.
 */
export const RR_METRIC_DIRECTIONS = ["lower_is_better", "higher_is_better", "informational"] as const;
export type RrMetricDirection = (typeof RR_METRIC_DIRECTIONS)[number];

/** The fifteen Road & Recovery intelligence domains. */
export const RR_INTELLIGENCE_DOMAINS = [
  "dispatch",
  "tow_operations",
  "bystand",
  "storage",
  "fleet",
  "driver",
  "counterparty",
  "authorisation",
  "billing_readiness",
  "distance",
  "exceptions",
  "sla",
  "profitability",
  "executive_health",
  "recommended_actions",
] as const;
export type RrIntelligenceDomain = (typeof RR_INTELLIGENCE_DOMAINS)[number];

export const RR_DOMAIN_LABELS: Readonly<Record<RrIntelligenceDomain, string>> = {
  dispatch: "Dispatch",
  tow_operations: "Tow Operations",
  bystand: "BYSTAND",
  storage: "Storage",
  fleet: "Fleet",
  driver: "Driver",
  counterparty: "Counterparty",
  authorisation: "Authorisation",
  billing_readiness: "Billing Readiness",
  distance: "Distance",
  exceptions: "Exceptions",
  sla: "SLA / Response",
  profitability: "Operational Profitability",
  executive_health: "Executive Road & Recovery Health",
  recommended_actions: "Recommended Actions",
};

/** The severity vocabulary already used by rr_job_exceptions and rr_billing_exceptions. */
export const RR_SEVERITIES = ["low", "medium", "high", "critical"] as const;
export type RrSeverity = (typeof RR_SEVERITIES)[number];

/**
 * A single measured metric.
 *
 * `value: null` means NO DATA — never zero. A tenant with no storage jobs has no average
 * storage duration; reporting 0 days would be a lie that reads as excellent performance.
 */
export type RrMetricResult = {
  key: string;
  label: string;
  domain: RrIntelligenceDomain;
  unit: string;
  direction: RrMetricDirection;
  /** null = no data. Never substituted with zero. */
  value: number | null;
  /** How many facts the value was computed from. Zero means the value must be null. */
  sampleSize: number;
  /** null = NO SLA CONFIGURED. Never invented. */
  target: number | null;
  warning: number | null;
  critical: number | null;
  thresholdSource: "configured" | "not_configured";
  /** The threshold row and version the result was measured against, for replay. */
  thresholdId: string | null;
  thresholdVersion: number | null;
  band: RrMetricBand;
  /** Plain-language explanation of the band. Always populated. */
  reason: string;
};

/** One weighted contributor to the Road & Recovery health score. */
export type RrHealthComponent = {
  metric: string;
  label: string;
  domain: RrIntelligenceDomain;
  value: number | null;
  weight: number;
  threshold: number | null;
  band: RrMetricBand;
  reason: string;
  /** 0-100 score for this component, or null when excluded from the denominator. */
  score: number | null;
  /** weight x score, or null when excluded. */
  contribution: number | null;
  included: boolean;
  /** Populated only when included = false. */
  exclusionReason: string | null;
};

/**
 * A finding: something true about the operation that a human should know.
 *
 * SYMPTOM, ROOT CAUSE and RECOMMENDATION are deliberately three separate fields. "Late
 * arrivals are up" is a symptom; "the roster changed on Tuesday" is a root cause; they are
 * not the same sentence and conflating them is how an operations report becomes noise.
 */
export type RrFinding = {
  key: string;
  domain: RrIntelligenceDomain;
  severity: RrSeverity;
  /** WHAT HAPPENED. */
  symptom: string;
  /** WHY IT HAPPENED, or null when the available facts do not support a cause. */
  rootCause: string | null;
  /** 0-100. Null when there is no root cause to be confident about. */
  rootCauseConfidence: number | null;
  /** The facts the root cause was inferred from. Never empty when rootCause is set. */
  evidence: string[];
  /** WHAT SHOULD HAPPEN. */
  recommendation: string;
  /** The alternative a manager may legitimately choose instead. */
  alternative: string;
  expectedOutcome: string;
  /** WHAT HAPPENS IF NOTHING IS DONE. */
  consequenceIfIgnored: string;
  /** The metric that produced this finding, when there is one. */
  metricKey: string | null;
  affectedCount: number;
  /** Null when the facts do not support a rand figure. NEVER zero as a placeholder. */
  financialImpactZAR: number | null;
  beforeMetrics: Record<string, number>;
};

/** The result shape every domain engine returns. */
export type RrDomainResult = {
  domain: RrIntelligenceDomain;
  label: string;
  metrics: RrMetricResult[];
  findings: RrFinding[];
  /** Facts the domain wants to show that are not metrics (counts, lists, breakdowns). */
  detail: Record<string, unknown>;
  /** True when the domain had nothing to measure at all. */
  empty: boolean;
  /** Set when a bounded query hit its cap. Intelligence is never silently truncated. */
  truncated: RrTruncationNotice | null;
};

/** An explicit, visible statement that a row limit was reached. */
export type RrTruncationNotice = {
  source: string;
  limit: number;
  returned: number;
  message: string;
};

/** The window a calculation was performed over. Always explicit, never implied. */
export type RrIntelligenceWindow = {
  /** ISO instant. Inclusive lower bound. */
  fromIso: string;
  /** ISO instant. Exclusive upper bound. */
  toIso: string;
  /** ISO instant the calculation is "as of" — drives threshold version selection. */
  asOfIso: string;
};

export function isRrIntelligenceDomain(value: string): value is RrIntelligenceDomain {
  return (RR_INTELLIGENCE_DOMAINS as readonly string[]).includes(value);
}

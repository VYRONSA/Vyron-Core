/**
 * Customer Health Score — built only from signals this app actually tracks
 * (login recency, seat/employee utilisation, module adoption, subscription
 * status). No AI-usage/storage/error telemetry exists yet, so those are
 * deliberately excluded rather than faked.
 */
export type HealthBand = "green" | "amber" | "red";

export type HealthScoreInput = {
  customerStatus: string | null;
  mostRecentLoginAt: string | null;
  employeeCount: number;
  employeeLimit: number | null;
  enabledModuleCount: number;
  planModuleCount: number;
};

export type HealthScoreResult = {
  score: number;
  band: HealthBand;
  factors: string[];
};

function daysSince(iso: string | null): number | null {
  if (!iso) return null;
  const diffMs = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(diffMs)) return null;
  return diffMs / (1000 * 60 * 60 * 24);
}

export function computeHealthScore(input: HealthScoreInput): HealthScoreResult {
  const factors: string[] = [];

  if (input.customerStatus === "suspended" || input.customerStatus === "cancelled" || input.customerStatus === "expired") {
    return { score: 0, band: "red", factors: [`Customer status is ${input.customerStatus}`] };
  }

  let score = 100;

  const loginAge = daysSince(input.mostRecentLoginAt);
  if (loginAge === null) {
    score -= 25;
    factors.push("No recorded logins yet");
  } else if (loginAge > 30) {
    score -= 25;
    factors.push(`No login in ${Math.round(loginAge)} days`);
  } else if (loginAge > 14) {
    score -= 10;
    factors.push(`Last login ${Math.round(loginAge)} days ago`);
  }

  if (input.employeeLimit && input.employeeCount === 0) {
    score -= 20;
    factors.push("No employees provisioned yet");
  } else if (input.employeeLimit && input.employeeCount > input.employeeLimit) {
    score -= 15;
    factors.push("Over employee licence limit");
  }

  if (input.planModuleCount > 0) {
    const adoptionRatio = input.enabledModuleCount / input.planModuleCount;
    if (adoptionRatio < 0.3) {
      score -= 20;
      factors.push("Low module adoption");
    } else if (adoptionRatio < 0.6) {
      score -= 10;
      factors.push("Moderate module adoption");
    }
  }

  if (input.customerStatus === "grace_period") {
    score -= 15;
    factors.push("Subscription in grace period");
  }

  score = Math.max(0, Math.min(100, score));
  const band: HealthBand = score >= 70 ? "green" : score >= 40 ? "amber" : "red";

  return { score, band, factors };
}

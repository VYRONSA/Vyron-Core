/**
 * VYRON CORE — Executive business intelligence (Phase 6).
 *
 * The adapter that lets the EXISTING Executive Intelligence layer see more than one
 * vertical. It computes nothing of its own:
 *
 *   Workforce Health        ← computeExecutiveWorkforceIntelligence() (existing, unchanged)
 *   Road & Recovery Health  ← computeRoadRecoveryIntelligence()       (Phase 6 vertical)
 *   Combined Business Health← combineBusinessHealth()                 (pure registry)
 *
 * Adding a third vertical later means adding one contribution here. It does not mean
 * another executive engine, another health framework, or another action pipeline.
 *
 * A vertical that is not provisioned, or that cannot be scored, is EXCLUDED from the
 * combined denominator and reported with the reason. It is never scored as zero — a
 * customer who has not enabled Road & Recovery has not failed at Road & Recovery.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  combineBusinessHealth,
  roadRecoveryContribution,
  workforceContribution,
  type CombinedBusinessHealth,
  type VerticalHealthContribution,
} from "@/lib/intelligence/vertical-health";
import {
  computeRoadRecoveryIntelligence,
  type RrIntelligenceOptions,
  type RrIntelligenceResult,
} from "@/lib/road-recovery/intelligence-service";

export type ExecutiveBusinessIntelligence = {
  companyId: string;
  combined: CombinedBusinessHealth;
  verticals: VerticalHealthContribution[];
  /** The full Road & Recovery result, when the module is provisioned. */
  roadRecovery: RrIntelligenceResult | null;
  roadRecoveryUnavailableReason: string | null;
  workforce: {
    employeeCount: number;
    averageEmployeeHealthScore: number | null;
    highRiskEmployeeCount: number;
    recommendationsCount: number;
    available: boolean;
    unavailableReason: string | null;
  };
  generatedAtIso: string;
};

/**
 * Whether Road & Recovery is installed for this company.
 *
 * Read from the provisioning record rather than inferred from the presence of data: a
 * customer who has the module but has not logged a job yet is PROVISIONED with no data,
 * and that reads very differently from a customer who never bought it.
 */
async function isRoadRecoveryProvisioned(
  supabase: SupabaseClient,
  companyId: string
): Promise<boolean> {
  const { data, error } = await supabase
    .from("rr_service_types")
    .select("id")
    .eq("company_id", companyId)
    .limit(1);

  if (error) return false;
  return (((data as unknown[] | null) ?? []).length) > 0;
}

export async function computeExecutiveBusinessIntelligence(
  supabase: SupabaseClient,
  input: { companyId: string; roadRecovery?: RrIntelligenceOptions }
): Promise<ExecutiveBusinessIntelligence> {
  const companyId = input.companyId;

  // Workforce comes from the EXISTING engine. It is imported dynamically so a page that
  // only needs Road & Recovery does not pull the whole workforce dataset loader.
  const workforcePromise = (async () => {
    try {
      const { computeExecutiveWorkforceIntelligence } = await import(
        "@/lib/executive-workforce-intelligence"
      );
      const result = await computeExecutiveWorkforceIntelligence(supabase, companyId);
      return {
        employeeCount: result.summary.employeeCount,
        averageEmployeeHealthScore:
          result.summary.employeeCount > 0 ? result.summary.averageEmployeeHealthScore : null,
        highRiskEmployeeCount: result.summary.highRiskEmployeeCount,
        recommendationsCount: result.summary.recommendationsCount,
        available: true,
        unavailableReason: null as string | null,
      };
    } catch (error: unknown) {
      // Workforce intelligence failing must not take the executive view down with it. The
      // vertical is reported as unavailable, with the reason, and excluded from scoring.
      return {
        employeeCount: 0,
        averageEmployeeHealthScore: null,
        highRiskEmployeeCount: 0,
        recommendationsCount: 0,
        available: false,
        unavailableReason:
          error instanceof Error
            ? `Workforce intelligence could not be computed: ${error.message}`
            : "Workforce intelligence could not be computed.",
      };
    }
  })();

  const roadRecoveryPromise = (async () => {
    const provisioned = await isRoadRecoveryProvisioned(supabase, companyId);
    if (!provisioned) {
      return { provisioned: false, result: null as RrIntelligenceResult | null, reason: null as string | null };
    }
    const result = await computeRoadRecoveryIntelligence(supabase, {
      ...(input.roadRecovery ?? { companyId }),
      companyId,
    });
    if (!result.ok) {
      return { provisioned: true, result: null, reason: result.message };
    }
    return { provisioned: true, result: result.data, reason: null };
  })();

  const [workforce, roadRecovery] = await Promise.all([workforcePromise, roadRecoveryPromise]);

  const workforceHealth = workforce.available
    ? workforceContribution({
        employeeCount: workforce.employeeCount,
        averageEmployeeHealthScore: workforce.averageEmployeeHealthScore,
        highRiskEmployeeCount: workforce.highRiskEmployeeCount,
        recommendationsCount: workforce.recommendationsCount,
      })
    : {
        ...workforceContribution({
          employeeCount: 0,
          averageEmployeeHealthScore: null,
          highRiskEmployeeCount: 0,
          recommendationsCount: 0,
        }),
        available: false,
        unavailableReason: workforce.unavailableReason,
      };

  const openCritical = roadRecovery.result
    ? Number(
        (roadRecovery.result.domains.find((domain) => domain.domain === "exceptions")?.detail
          .openCritical as number | undefined) ?? 0
      )
    : 0;

  const roadRecoveryHealth = roadRecoveryContribution({
    provisioned: roadRecovery.provisioned,
    score: roadRecovery.result?.health.score ?? null,
    coveragePct: roadRecovery.result?.health.configuredCoveragePct ?? null,
    narrative:
      roadRecovery.result?.health.narrative ??
      roadRecovery.reason ??
      "Road & Recovery intelligence is not available for this company.",
    jobCount: roadRecovery.result?.jobCount ?? 0,
    openCriticalExceptions: openCritical,
    metricsWithoutTargets: roadRecovery.result?.health.metricsWithoutTargets.length ?? 0,
  });

  const verticals = [workforceHealth, roadRecoveryHealth];

  return {
    companyId,
    combined: combineBusinessHealth(verticals),
    verticals,
    roadRecovery: roadRecovery.result,
    roadRecoveryUnavailableReason: roadRecovery.provisioned
      ? roadRecovery.reason
      : "The Road & Recovery module is not provisioned for this company.",
    workforce,
    generatedAtIso: new Date().toISOString(),
  };
}

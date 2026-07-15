import type { SupabaseClient } from "@supabase/supabase-js";

export type DisciplineStage =
  | "none"
  | "counselling"
  | "verbal_warning"
  | "written_warning"
  | "final_written_warning"
  | "hearing"
  | "dismissal_recommended";

export type RiskLevel = "low" | "medium" | "high" | "critical";

type WarningType = "verbal" | "written" | "final_written" | string;

export type DisciplinePolicy = {
  warningExpiryDays: {
    verbal: number;
    written: number;
    finalWritten: number;
  };
  counsellingBeforeWarning: boolean;
  hearingAfterFinalWarning: boolean;
  appealResetEnabled: boolean;
  repeatOffenceWindowDays: number;
  escalationThresholds: {
    verbalToWrittenCount: number;
    writtenToFinalCount: number;
    finalToHearingCount: number;
  };
  similarOffenceGroups: Record<string, string[]>;
  dismissalRules: {
    requireHearingOutcomeCodes: string[];
    minFinalWarningsInWindow: number;
    minSuspensionsInWindow: number;
  };
};

export type DisciplineContext = {
  companyId: string;
  employeeId: string;
  evaluationDateIso: string;
  triggerType: string;
  triggerIncidentType?: string | null;
  triggerCaseCategory?: string | null;
};

export type EvaluatedWarning = {
  id: string;
  warningType: WarningType;
  incidentType: string;
  issueDate: string;
  expiryDate: string | null;
  active: boolean;
  expired: boolean;
  offenceGroup: string;
};

export type DisciplineRecommendation = {
  currentStage: DisciplineStage;
  nextRecommendedAction: DisciplineStage;
  reason: string;
  supportingHistory: string[];
  warningsConsidered: EvaluatedWarning[];
  hearingsConsidered: Array<{ id: string; status: string; outcomeCode: string | null; date: string | null }>;
  expiredWarningsIgnored: EvaluatedWarning[];
  similarOffenceGroups: Array<{ group: string; count: number }>;
  repeatOffenceDetected: boolean;
  escalationRequired: boolean;
  requiresHearing: boolean;
  dismissalRecommendation: boolean;
  riskLevel: RiskLevel;
  managerGuidance: string;
  hrGuidance: string;
  requiresHrReview: boolean;
  confidenceScore: number;
};

const DEFAULT_POLICY: DisciplinePolicy = {
  warningExpiryDays: {
    verbal: 90,
    written: 180,
    finalWritten: 365,
  },
  counsellingBeforeWarning: false,
  hearingAfterFinalWarning: true,
  appealResetEnabled: true,
  repeatOffenceWindowDays: 365,
  escalationThresholds: {
    verbalToWrittenCount: 1,
    writtenToFinalCount: 1,
    finalToHearingCount: 1,
  },
  similarOffenceGroups: {
    attendance: ["late_coming", "absenteeism", "timekeeping", "unauthorised_absence"],
    misconduct: ["insubordination", "harassment", "abuse", "theft", "fraud"],
    performance: ["poor_performance", "negligence", "quality_issue"],
    safety: ["safety_violation", "ppe_non_compliance", "dangerous_act"],
  },
  dismissalRules: {
    requireHearingOutcomeCodes: ["guilty_major", "gross_misconduct_confirmed"],
    minFinalWarningsInWindow: 1,
    minSuspensionsInWindow: 1,
  },
};

function safeText(value: unknown): string {
  return String(value || "").trim().toLowerCase();
}

function parseDateOrNull(value: unknown): Date | null {
  if (!value) return null;
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return null;
  return date;
}

function addDays(date: Date, days: number): Date {
  const clone = new Date(date.getTime());
  clone.setUTCDate(clone.getUTCDate() + days);
  return clone;
}

function groupForIncident(policy: DisciplinePolicy, incidentType: string): string {
  const target = safeText(incidentType);
  for (const [group, aliases] of Object.entries(policy.similarOffenceGroups)) {
    if (aliases.map(safeText).includes(target)) return group;
  }
  return target || "unknown";
}

function stageRank(stage: DisciplineStage): number {
  switch (stage) {
    case "none":
      return 0;
    case "counselling":
      return 1;
    case "verbal_warning":
      return 2;
    case "written_warning":
      return 3;
    case "final_written_warning":
      return 4;
    case "hearing":
      return 5;
    case "dismissal_recommended":
      return 6;
    default:
      return 0;
  }
}

function warningTypeToStage(type: WarningType): DisciplineStage {
  const normalized = safeText(type);
  if (normalized.includes("final")) return "final_written_warning";
  if (normalized.includes("written")) return "written_warning";
  if (normalized.includes("verbal")) return "verbal_warning";
  return "none";
}

export async function loadPolicy(
  supabase: SupabaseClient,
  companyId: string
): Promise<DisciplinePolicy> {
  const { data } = await supabase
    .from("discipline_policy_configs")
    .select("policy_json")
    .eq("company_id", companyId)
    .eq("config_key", "default")
    .eq("active", true)
    .order("config_version", { ascending: false })
    .limit(1)
    .maybeSingle();

  const fromDb = (data?.policy_json || {}) as Partial<DisciplinePolicy>;

  return {
    ...DEFAULT_POLICY,
    ...fromDb,
    warningExpiryDays: {
      ...DEFAULT_POLICY.warningExpiryDays,
      ...(fromDb.warningExpiryDays || {}),
    },
    escalationThresholds: {
      ...DEFAULT_POLICY.escalationThresholds,
      ...(fromDb.escalationThresholds || {}),
    },
    dismissalRules: {
      ...DEFAULT_POLICY.dismissalRules,
      ...(fromDb.dismissalRules || {}),
    },
    similarOffenceGroups: {
      ...DEFAULT_POLICY.similarOffenceGroups,
      ...(fromDb.similarOffenceGroups || {}),
    },
  };
}

export async function loadDisciplineInputs(
  supabase: SupabaseClient,
  companyId: string,
  employeeId: string
): Promise<{
  warnings: any[];
  hearings: any[];
  hrCases: any[];
  notes: any[];
  progression: any | null;
}> {
  const [warningsRes, hearingsRes, hrCasesRes, notesRes, progressionRes] = await Promise.all([
    supabase
      .from("hr_warnings")
      .select("id,warning_type,incident_type,issue_date,expiry_date,status,created_at")
      .eq("company_id", companyId)
      .eq("employee_id", employeeId)
      .order("created_at", { ascending: false }),
    supabase
      .from("hearing_cases")
      .select("id,hearing_status,outcome_code,scheduled_at,completed_at,created_at")
      .eq("company_id", companyId)
      .eq("employee_id", employeeId)
      .order("created_at", { ascending: false }),
    supabase
      .from("hr_cases")
      .select("id,case_type,category,status,incident_date,created_at")
      .eq("company_id", companyId)
      .eq("employee_id", employeeId)
      .order("created_at", { ascending: false }),
    supabase
      .from("employee_notes")
      .select("id,note_category,created_at,deleted_at")
      .eq("company_id", companyId)
      .eq("employee_id", employeeId)
      .is("deleted_at", null)
      .order("created_at", { ascending: false }),
    supabase
      .from("discipline_progressions")
      .select("id,current_stage,status")
      .eq("company_id", companyId)
      .eq("employee_id", employeeId)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  return {
    warnings: warningsRes.data || [],
    hearings: hearingsRes.data || [],
    hrCases: hrCasesRes.data || [],
    notes: notesRes.data || [],
    progression: progressionRes.data || null,
  };
}

export function evaluateDiscipline(
  policy: DisciplinePolicy,
  context: DisciplineContext,
  input: {
    warnings: any[];
    hearings: any[];
    hrCases: any[];
    notes: any[];
    progression: any | null;
  }
): DisciplineRecommendation {
  const evalDate = parseDateOrNull(context.evaluationDateIso) || new Date();

  const warnings: EvaluatedWarning[] = (input.warnings || []).map((warning) => {
    const warningType = safeText(warning.warning_type) as WarningType;
    const issueDate = parseDateOrNull(warning.issue_date) || parseDateOrNull(warning.created_at) || evalDate;
    const explicitExpiry = parseDateOrNull(warning.expiry_date);

    const derivedExpiry =
      warningType.includes("final")
        ? addDays(issueDate, policy.warningExpiryDays.finalWritten)
        : warningType.includes("written")
          ? addDays(issueDate, policy.warningExpiryDays.written)
          : addDays(issueDate, policy.warningExpiryDays.verbal);

    const expiryDate = explicitExpiry || derivedExpiry;
    const expired = expiryDate.getTime() < evalDate.getTime();
    const active = !expired && safeText(warning.status) !== "withdrawn" && safeText(warning.status) !== "expired";

    return {
      id: String(warning.id),
      warningType,
      incidentType: safeText(warning.incident_type || "general"),
      issueDate: issueDate.toISOString(),
      expiryDate: expiryDate.toISOString(),
      active,
      expired,
      offenceGroup: groupForIncident(policy, String(warning.incident_type || "general")),
    };
  });

  const activeWarnings = warnings.filter((item) => item.active);
  const expiredWarningsIgnored = warnings.filter((item) => item.expired);

  const finalWarnings = activeWarnings.filter((w) => warningTypeToStage(w.warningType) === "final_written_warning");
  const writtenWarnings = activeWarnings.filter((w) => warningTypeToStage(w.warningType) === "written_warning");
  const verbalWarnings = activeWarnings.filter((w) => warningTypeToStage(w.warningType) === "verbal_warning");

  const recentWindowStart = addDays(evalDate, -policy.repeatOffenceWindowDays).getTime();
  const repeatedByGroup = new Map<string, number>();
  activeWarnings.forEach((item) => {
    const issueTime = parseDateOrNull(item.issueDate)?.getTime() || 0;
    if (issueTime < recentWindowStart) return;
    repeatedByGroup.set(item.offenceGroup, (repeatedByGroup.get(item.offenceGroup) || 0) + 1);
  });

  const similarOffenceGroups = Array.from(repeatedByGroup.entries())
    .map(([group, count]) => ({ group, count }))
    .sort((a, b) => b.count - a.count);

  const repeatOffenceDetected = similarOffenceGroups.some((entry) => entry.count >= 2);

  const hearingsConsidered = (input.hearings || []).map((hearing) => ({
    id: String(hearing.id),
    status: safeText(hearing.hearing_status || "unknown"),
    outcomeCode: hearing.outcome_code ? String(hearing.outcome_code) : null,
    date: hearing.completed_at || hearing.scheduled_at || hearing.created_at || null,
  }));

  const hasCompletedHearing = hearingsConsidered.some((item) => item.status === "completed");
  const suspensionCases = (input.hrCases || []).filter((item) => safeText(item.category).includes("suspension"));

  const currentStage = (() => {
    const persisted = safeText(input.progression?.current_stage);
    if (persisted === "dismissal_recommended") return "dismissal_recommended" as DisciplineStage;
    if (persisted === "hearing") return "hearing" as DisciplineStage;
    if (persisted === "final_written_warning") return "final_written_warning" as DisciplineStage;
    if (persisted === "written_warning") return "written_warning" as DisciplineStage;
    if (persisted === "verbal_warning") return "verbal_warning" as DisciplineStage;
    if (persisted === "counselling") return "counselling" as DisciplineStage;

    const inferred = activeWarnings
      .map((w) => warningTypeToStage(w.warningType))
      .sort((a, b) => stageRank(b) - stageRank(a))[0];

    if (inferred) return inferred;
    if ((input.notes || []).some((note) => safeText(note.note_category).includes("counselling"))) {
      return "counselling";
    }
    return "none";
  })();

  let nextRecommendedAction: DisciplineStage = currentStage;

  if (currentStage === "none") {
    nextRecommendedAction = policy.counsellingBeforeWarning ? "counselling" : "verbal_warning";
  } else if (currentStage === "counselling") {
    nextRecommendedAction = "verbal_warning";
  } else if (currentStage === "verbal_warning") {
    nextRecommendedAction =
      verbalWarnings.length > policy.escalationThresholds.verbalToWrittenCount - 1 || repeatOffenceDetected
        ? "written_warning"
        : "verbal_warning";
  } else if (currentStage === "written_warning") {
    nextRecommendedAction =
      writtenWarnings.length > policy.escalationThresholds.writtenToFinalCount - 1 || repeatOffenceDetected
        ? "final_written_warning"
        : "written_warning";
  } else if (currentStage === "final_written_warning") {
    const escalateToHearing =
      finalWarnings.length >= policy.escalationThresholds.finalToHearingCount || repeatOffenceDetected;
    nextRecommendedAction = escalateToHearing && policy.hearingAfterFinalWarning ? "hearing" : "final_written_warning";
  } else if (currentStage === "hearing") {
    nextRecommendedAction = "hearing";
  }

  let dismissalRecommendation = false;
  if (
    hasCompletedHearing &&
    hearingsConsidered.some((item) =>
      policy.dismissalRules.requireHearingOutcomeCodes.includes(safeText(item.outcomeCode || ""))
    ) &&
    finalWarnings.length >= policy.dismissalRules.minFinalWarningsInWindow &&
    suspensionCases.length >= policy.dismissalRules.minSuspensionsInWindow
  ) {
    dismissalRecommendation = true;
    nextRecommendedAction = "dismissal_recommended";
  }

  const escalationRequired = stageRank(nextRecommendedAction) > stageRank(currentStage);
  const requiresHearing = nextRecommendedAction === "hearing" || dismissalRecommendation;
  const requiresHrReview = requiresHearing || dismissalRecommendation || currentStage === "final_written_warning";

  const riskLevel: RiskLevel = dismissalRecommendation
    ? "critical"
    : nextRecommendedAction === "hearing"
      ? "high"
      : nextRecommendedAction === "final_written_warning"
        ? "high"
        : repeatOffenceDetected
          ? "medium"
          : "low";

  const supportingHistory: string[] = [
    `Active warnings: ${activeWarnings.length}`,
    `Expired warnings ignored: ${expiredWarningsIgnored.length}`,
    `Hearings considered: ${hearingsConsidered.length}`,
    `Previous HR cases considered: ${(input.hrCases || []).length}`,
  ];

  if (repeatOffenceDetected && similarOffenceGroups[0]) {
    supportingHistory.push(
      `Repeat offence detected in group '${similarOffenceGroups[0].group}' (${similarOffenceGroups[0].count} events).`
    );
  }

  const reason = escalationRequired
    ? `Escalation required from ${currentStage} to ${nextRecommendedAction} based on active warnings and repeat offence signals.`
    : `Maintain stage ${currentStage}; no escalation trigger exceeded under current policy.`;

  const confidenceScore = Math.max(
    55,
    Math.min(
      98,
      65 +
        activeWarnings.length * 3 +
        hearingsConsidered.length * 2 +
        (repeatOffenceDetected ? 10 : 0) +
        (dismissalRecommendation ? 8 : 0)
    )
  );

  return {
    currentStage,
    nextRecommendedAction,
    reason,
    supportingHistory,
    warningsConsidered: warnings,
    hearingsConsidered,
    expiredWarningsIgnored,
    similarOffenceGroups,
    repeatOffenceDetected,
    escalationRequired,
    requiresHearing,
    dismissalRecommendation,
    riskLevel,
    managerGuidance:
      nextRecommendedAction === "dismissal_recommended"
        ? "Proceed to HR/legal review. Do not terminate automatically."
        : nextRecommendedAction === "hearing"
          ? "Prepare hearing bundle and schedule chairperson-reviewed hearing."
          : "Apply recommended stage and document objective evidence.",
    hrGuidance:
      requiresHrReview
        ? "HR review required before finalizing this progression decision."
        : "HR may monitor; mandatory review not required at this stage.",
    requiresHrReview,
    confidenceScore,
  };
}

export async function persistDisciplineEvaluation(
  supabase: SupabaseClient,
  input: {
    companyId: string;
    employeeId: string;
    triggerType: string;
    triggerPayload?: Record<string, unknown>;
    recommendation: DisciplineRecommendation;
    actorEmail: string;
  }
): Promise<{ progressionId: string; decisionId: string; previousStage: DisciplineStage }> {
  const now = new Date().toISOString();

  const { data: existing } = await supabase
    .from("discipline_progressions")
    .select("id,current_stage")
    .eq("company_id", input.companyId)
    .eq("employee_id", input.employeeId)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const previousStage =
    (safeText(existing?.current_stage) as DisciplineStage) || (input.recommendation.currentStage as DisciplineStage);

  const progressionPayload = {
    company_id: input.companyId,
    employee_id: input.employeeId,
    current_stage: input.recommendation.nextRecommendedAction,
    status: "active",
    stage_reason: input.recommendation.reason,
    similar_offence_count: input.recommendation.similarOffenceGroups.reduce((sum, item) => sum + item.count, 0),
    previous_hearing_count: input.recommendation.hearingsConsidered.length,
    previous_counselling_count: input.recommendation.currentStage === "counselling" ? 1 : 0,
    risk_score:
      input.recommendation.riskLevel === "critical"
        ? 95
        : input.recommendation.riskLevel === "high"
          ? 80
          : input.recommendation.riskLevel === "medium"
            ? 60
            : 35,
    last_evaluated_at: now,
    last_recommendation_payload: input.recommendation,
    updated_at: now,
  };

  let progressionId = String(existing?.id || "");

  if (progressionId) {
    const { error } = await supabase
      .from("discipline_progressions")
      .update(progressionPayload)
      .eq("id", progressionId)
      .eq("company_id", input.companyId)
      .eq("employee_id", input.employeeId);

    if (error) throw new Error("Could not update discipline progression.");
  } else {
    const { data, error } = await supabase
      .from("discipline_progressions")
      .insert(progressionPayload)
      .select("id")
      .single();

    if (error || !data) throw new Error("Could not create discipline progression.");
    progressionId = String(data.id);
  }

  const { data: decision, error: decisionError } = await supabase
    .from("discipline_progression_decisions")
    .insert({
      company_id: input.companyId,
      employee_id: input.employeeId,
      progression_id: progressionId,
      trigger_type: input.triggerType,
      trigger_payload: input.triggerPayload || {},
      previous_stage: previousStage,
      recommended_stage: input.recommendation.nextRecommendedAction,
      requires_hearing: input.recommendation.requiresHearing,
      requires_hr_review: input.recommendation.requiresHrReview,
      dismissal_recommended: input.recommendation.dismissalRecommendation,
      risk_level: input.recommendation.riskLevel,
      confidence_score: input.recommendation.confidenceScore,
      reasoning: input.recommendation.reason,
      recommendation_payload: input.recommendation,
      created_by: input.actorEmail,
    })
    .select("id")
    .single();

  if (decisionError || !decision) throw new Error("Could not store discipline recommendation history.");

  return {
    progressionId,
    decisionId: String(decision.id),
    previousStage,
  };
}

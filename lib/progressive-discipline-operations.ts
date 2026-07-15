import type { SupabaseClient } from "@supabase/supabase-js";
import { appendTimelineEvent, safeAudit } from "@/lib/employee-relations-api";
import type { DisciplinePolicy, DisciplineRecommendation } from "@/lib/progressive-discipline-engine";

type ApplyInput = {
  companyId: string;
  employeeId: string;
  actorEmail: string;
  progressionId: string;
  decisionId: string;
  recommendation: DisciplineRecommendation;
  policy: DisciplinePolicy;
  linkedHrCaseId?: string | null;
  triggerType: string;
  triggerIncidentType?: string | null;
};

type ApplyResult = {
  warningIssued: boolean;
  warningId: string | null;
  warningUpdated: boolean;
  hearingPrepared: boolean;
  hearingId: string | null;
  hearingReused: boolean;
};

function toDateOnly(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function addDays(date: Date, days: number): Date {
  const clone = new Date(date.getTime());
  clone.setUTCDate(clone.getUTCDate() + days);
  return clone;
}

function warningTypeForStage(stage: string): "verbal" | "written" | "final_written" | null {
  if (stage === "verbal_warning") return "verbal";
  if (stage === "written_warning") return "written";
  if (stage === "final_written_warning") return "final_written";
  return null;
}

function warningExpiryDate(type: "verbal" | "written" | "final_written", policy: DisciplinePolicy): string {
  const today = new Date();
  const days =
    type === "final_written"
      ? policy.warningExpiryDays.finalWritten
      : type === "written"
        ? policy.warningExpiryDays.written
        : policy.warningExpiryDays.verbal;
  return toDateOnly(addDays(today, Math.max(1, Number(days) || 1)));
}

function warningDescription(input: ApplyInput, warningType: "verbal" | "written" | "final_written"): string {
  const stageLabel = warningType.replaceAll("_", " ");
  return [
    `Progressive discipline action issued: ${stageLabel}.`,
    `Reason: ${input.recommendation.reason}`,
    `Trigger: ${input.triggerType}`,
    input.triggerIncidentType ? `Incident: ${input.triggerIncidentType}` : null,
  ]
    .filter(Boolean)
    .join(" ");
}

export async function applyDisciplineOperationalWorkflow(
  supabase: SupabaseClient,
  input: ApplyInput
): Promise<ApplyResult> {
  let warningIssued = false;
  let warningId: string | null = null;
  let warningUpdated = false;
  let hearingPrepared = false;
  let hearingId: string | null = null;
  let hearingReused = false;

  const warningType = warningTypeForStage(input.recommendation.nextRecommendedAction);

  if (warningType) {
    const { data: existingWarning } = await supabase
      .from("hr_warnings")
      .select("id")
      .eq("company_id", input.companyId)
      .eq("employee_id", input.employeeId)
      .eq("warning_type", warningType)
      .in("status", ["active", "expiring_soon"])
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const payload = {
      linked_hr_case_id: input.linkedHrCaseId || null,
      warning_type: warningType,
      progression_stage: input.recommendation.nextRecommendedAction,
      status: "active",
      expiry_date: warningExpiryDate(warningType, input.policy),
      description: warningDescription(input, warningType),
      discipline_progression_id: input.progressionId,
      discipline_decision_id: input.decisionId,
    };

    if (existingWarning?.id) {
      const { error } = await supabase
        .from("hr_warnings")
        .update(payload)
        .eq("id", existingWarning.id)
        .eq("company_id", input.companyId)
        .eq("employee_id", input.employeeId);

      if (error) throw new Error("Could not update active warning for this discipline stage.");
      warningId = String(existingWarning.id);
      warningIssued = true;
      warningUpdated = true;
    } else {
      const { data, error } = await supabase
        .from("hr_warnings")
        .insert({
          company_id: input.companyId,
          employee_id: input.employeeId,
          ...payload,
        })
        .select("id")
        .single();

      if (error || !data) throw new Error("Could not issue warning from progressive discipline decision.");
      warningId = String(data.id);
      warningIssued = true;
      warningUpdated = false;
    }

    await appendTimelineEvent(supabase, {
      companyId: input.companyId,
      employeeId: input.employeeId,
      eventType: warningUpdated ? "warning_updated" : "warning_issued",
      sourceTable: "hr_warnings",
      sourceId: warningId,
      title: warningUpdated ? "Warning updated from discipline" : "Warning issued from discipline",
      summary: input.recommendation.nextRecommendedAction,
      metadata: {
        warningType,
        progressionId: input.progressionId,
        decisionId: input.decisionId,
        linkedHrCaseId: input.linkedHrCaseId || null,
      },
      createdBy: input.actorEmail,
    });

    await safeAudit(supabase, {
      companyId: input.companyId,
      email: input.actorEmail,
      action: warningUpdated ? "update" : "create",
      entityType: "hr_warning",
      entityId: warningId,
      metadata: {
        employeeId: input.employeeId,
        warningType,
        progressionId: input.progressionId,
        decisionId: input.decisionId,
        linkedHrCaseId: input.linkedHrCaseId || null,
      },
    });
  }

  if (input.recommendation.requiresHearing || input.recommendation.nextRecommendedAction === "hearing") {
    const { data: hearingByDecision } = await supabase
      .from("hearing_cases")
      .select("id,hearing_status")
      .eq("company_id", input.companyId)
      .eq("employee_id", input.employeeId)
      .eq("discipline_decision_id", input.decisionId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    let existingHearing = hearingByDecision;
    if (!existingHearing?.id && input.linkedHrCaseId) {
      const { data: hearingByCase } = await supabase
        .from("hearing_cases")
        .select("id,hearing_status")
        .eq("company_id", input.companyId)
        .eq("employee_id", input.employeeId)
        .eq("hr_case_id", input.linkedHrCaseId)
        .in("hearing_status", ["draft", "pending_review", "scheduled"])
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      existingHearing = hearingByCase;
    }

    if (existingHearing?.id) {
      const { error } = await supabase
        .from("hearing_cases")
        .update({
          discipline_progression_id: input.progressionId,
          discipline_decision_id: input.decisionId,
          hr_case_id: input.linkedHrCaseId || null,
          hearing_status:
            String(existingHearing.hearing_status || "").toLowerCase() === "draft"
              ? "pending_review"
              : existingHearing.hearing_status,
          updated_at: new Date().toISOString(),
        })
        .eq("id", existingHearing.id)
        .eq("company_id", input.companyId)
        .eq("employee_id", input.employeeId);

      if (error) throw new Error("Could not update pending hearing linkage.");
      hearingId = String(existingHearing.id);
      hearingPrepared = true;
      hearingReused = true;
    } else {
      const { data, error } = await supabase
        .from("hearing_cases")
        .insert({
          company_id: input.companyId,
          employee_id: input.employeeId,
          hr_case_id: input.linkedHrCaseId || null,
          hearing_type: "disciplinary",
          hearing_status: "pending_review",
          initiator_email: input.actorEmail,
          created_by: input.actorEmail,
          discipline_progression_id: input.progressionId,
          discipline_decision_id: input.decisionId,
        })
        .select("id")
        .single();

      if (error || !data) throw new Error("Could not prepare hearing from progressive discipline decision.");
      hearingId = String(data.id);
      hearingPrepared = true;
      hearingReused = false;
    }

    await appendTimelineEvent(supabase, {
      companyId: input.companyId,
      employeeId: input.employeeId,
      eventType: hearingReused ? "hearing_pending_review_updated" : "hearing_pending_review_created",
      sourceTable: "hearing_cases",
      sourceId: hearingId,
      title: hearingReused ? "Pending hearing updated" : "Pending hearing prepared",
      summary: "Prepared from progressive discipline recommendation",
      metadata: {
        progressionId: input.progressionId,
        decisionId: input.decisionId,
        linkedHrCaseId: input.linkedHrCaseId || null,
      },
      createdBy: input.actorEmail,
    });

    await safeAudit(supabase, {
      companyId: input.companyId,
      email: input.actorEmail,
      action: hearingReused ? "update" : "create",
      entityType: "hearing_case",
      entityId: hearingId,
      metadata: {
        employeeId: input.employeeId,
        source: "progressive_discipline",
        progressionId: input.progressionId,
        decisionId: input.decisionId,
        linkedHrCaseId: input.linkedHrCaseId || null,
      },
    });
  }

  return {
    warningIssued,
    warningId,
    warningUpdated,
    hearingPrepared,
    hearingId,
    hearingReused,
  };
}
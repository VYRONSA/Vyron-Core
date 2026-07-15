import { NextRequest, NextResponse } from "next/server";
import {
  appendTimelineEvent,
  asText,
  assertEmployeeBelongsToCompany,
  parseError,
  requireApiContext,
  safeAudit,
} from "@/lib/employee-relations-api";
import {
  evaluateDiscipline,
  loadDisciplineInputs,
  loadPolicy,
  persistDisciplineEvaluation,
} from "@/lib/progressive-discipline-engine";
import { applyDisciplineOperationalWorkflow } from "@/lib/progressive-discipline-operations";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const context = await requireApiContext(request, body.companyId);
    if (!context.ok) return NextResponse.json({ error: context.message }, { status: context.status });

    const employeeId = asText(body.employeeId);
    if (!employeeId) return NextResponse.json({ error: "employeeId is required." }, { status: 400 });
    const caseId = asText(body.caseId) || null;
    const applyOperationalWorkflow = body?.applyOperationalWorkflow === true;
    let linkedCaseId = caseId;

    const employeeCheck = await assertEmployeeBelongsToCompany(
      context.ctx.auth.supabase,
      context.ctx.companyId,
      employeeId
    );
    if (!employeeCheck.ok) {
      return NextResponse.json({ error: employeeCheck.message }, { status: employeeCheck.status });
    }

    if (caseId) {
      const { data: hrCase, error: hrCaseError } = await context.ctx.auth.supabase
        .from("hr_cases")
        .select("id")
        .eq("id", caseId)
        .eq("company_id", context.ctx.companyId)
        .eq("employee_id", employeeId)
        .maybeSingle();

      if (hrCaseError) {
        return NextResponse.json({ error: "Could not verify HR case ownership." }, { status: 500 });
      }

      if (!hrCase) {
        return NextResponse.json({ error: "HR case not found for this employee in this company." }, { status: 404 });
      }
      linkedCaseId = caseId;
    } else if (applyOperationalWorkflow) {
      const { data: latestCase } = await context.ctx.auth.supabase
        .from("hr_cases")
        .select("id")
        .eq("company_id", context.ctx.companyId)
        .eq("employee_id", employeeId)
        .not("status", "eq", "closed")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      linkedCaseId = latestCase?.id || null;
    }

    const [policy, inputs] = await Promise.all([
      loadPolicy(context.ctx.auth.supabase, context.ctx.companyId),
      loadDisciplineInputs(context.ctx.auth.supabase, context.ctx.companyId, employeeId),
    ]);

    const recommendation = evaluateDiscipline(
      policy,
      {
        companyId: context.ctx.companyId,
        employeeId,
        evaluationDateIso: asText(body.evaluationDate) || new Date().toISOString(),
        triggerType: asText(body.triggerType) || "employee_discipline_evaluate",
        triggerIncidentType: asText(body.incidentType) || null,
        triggerCaseCategory: asText(body.caseCategory) || null,
      },
      inputs
    );

    const persisted = await persistDisciplineEvaluation(context.ctx.auth.supabase, {
      companyId: context.ctx.companyId,
      employeeId,
      triggerType: asText(body.triggerType) || "employee_discipline_evaluate",
      triggerPayload: {
        incidentType: asText(body.incidentType) || null,
        caseCategory: asText(body.caseCategory) || null,
      },
      recommendation,
      actorEmail: context.ctx.auth.email,
    });

    await appendTimelineEvent(context.ctx.auth.supabase, {
      companyId: context.ctx.companyId,
      employeeId,
      eventType: "discipline_progression_evaluated",
      sourceTable: "discipline_progression_decisions",
      sourceId: persisted.decisionId,
      title: "Progressive discipline decision recorded",
      summary: `${persisted.previousStage} -> ${recommendation.nextRecommendedAction}`,
      metadata: {
        previousStage: persisted.previousStage,
        newStage: recommendation.nextRecommendedAction,
        reason: recommendation.reason,
        initiatedBy: context.ctx.auth.email,
      },
      createdBy: context.ctx.auth.email,
    });

    await safeAudit(context.ctx.auth.supabase, {
      companyId: context.ctx.companyId,
      email: context.ctx.auth.email,
      action: "create",
      entityType: "discipline_evaluation",
      entityId: persisted.decisionId,
      metadata: {
        employeeId,
        previousStage: persisted.previousStage,
        nextStage: recommendation.nextRecommendedAction,
      },
    });

    const appliedWorkflow = applyOperationalWorkflow
      ? await applyDisciplineOperationalWorkflow(context.ctx.auth.supabase, {
          companyId: context.ctx.companyId,
          employeeId,
          actorEmail: context.ctx.auth.email,
          progressionId: persisted.progressionId,
          decisionId: persisted.decisionId,
          recommendation,
          policy,
          linkedHrCaseId: linkedCaseId,
          triggerType: asText(body.triggerType) || "employee_discipline_evaluate",
          triggerIncidentType: asText(body.incidentType) || null,
        })
      : null;

    return NextResponse.json({
      ok: true,
      progressionId: persisted.progressionId,
      decisionId: persisted.decisionId,
      recommendation,
      appliedWorkflow,
    });
  } catch (error: unknown) {
    return NextResponse.json({ error: parseError(error) }, { status: 500 });
  }
}

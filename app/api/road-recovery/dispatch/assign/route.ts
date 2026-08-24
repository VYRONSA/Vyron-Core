import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { evaluateAndPersistCandidates } from "@/lib/road-recovery/dispatch-data";
import { offerAssignment } from "@/lib/road-recovery/job-service";
import {
  composeAssignmentOffered,
  emitRrNotification,
  loadRrJobSummary,
} from "@/lib/road-recovery/notifications";
import {
  asText,
  errorResponse,
  parseError,
  readJson,
  requireApiContext,
  serviceResponse,
} from "@/lib/road-recovery/api";

/**
 * Dispatches a job to a driver.
 *
 * The deterministic engine is RE-RUN here and is the authority: a driver who is not
 * eligible in a fresh evaluation cannot be dispatched, no matter what the controller's
 * screen showed. This is what stops a stale candidate list from dispatching a driver
 * whose certification expired in the meantime.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await readJson(request);
    const context = await requireApiContext(request, body.companyId);
    if (!context.ok) return errorResponse(context.message, context.status);

    const serviceJobId = asText(body.serviceJobId);
    const employeeId = asText(body.employeeId);
    if (!serviceJobId || !employeeId) {
      return errorResponse("serviceJobId and employeeId are required.", 400);
    }

    const evaluationId = randomUUID();
    const { evaluation, error } = await evaluateAndPersistCandidates(context.ctx.auth.supabase, {
      companyId: context.ctx.companyId,
      serviceJobId,
      evaluatedBy: context.ctx.auth.email,
      evaluatedAt: new Date().toISOString(),
      evaluationId,
    });

    if (error || !evaluation) return errorResponse(error || "Evaluation failed.", 500);

    const chosen = evaluation.candidates.find((candidate) => candidate.employeeId === employeeId);
    if (!chosen) {
      return errorResponse("That driver is not a dispatch candidate for this job.", 400);
    }
    if (!chosen.eligible) {
      const reasons = chosen.eligibilityFailures.map((failure) => failure.detail).join(" ");
      return errorResponse(`${chosen.driverName} is not eligible for this job. ${reasons}`, 409);
    }

    const { data: candidateRow } = await context.ctx.auth.supabase
      .from("rr_dispatch_candidates")
      .select("id")
      .eq("company_id", context.ctx.companyId)
      .eq("evaluation_id", evaluationId)
      .eq("employee_id", employeeId)
      .maybeSingle();

    const result = await offerAssignment(context.ctx.auth.supabase, {
      companyId: context.ctx.companyId,
      actorEmail: context.ctx.auth.email,
      serviceJobId,
      employeeId,
      fieldVehicleId: chosen.fieldVehicleId,
      candidateId: (candidateRow as { id?: string } | null)?.id || null,
      // Controller's instructions for this driver, stored on the column the assignment
      // table already has. Trimmed and capped rather than passed through untouched.
      notes: asText(body.notes).slice(0, 2000) || null,
    });

    /**
     * Tell the driver, so the office does not have to phone them.
     *
     * Emitted only on success, and deliberately not awaited into the result: a failed
     * notification must not fail a dispatch that already happened. The driver's board
     * polls independently, so the job still reaches them either way.
     */
    if (result.ok) {
      const job = await loadRrJobSummary(
        context.ctx.auth.supabase,
        context.ctx.companyId,
        serviceJobId
      );
      if (job) {
        await emitRrNotification(
          context.ctx.auth.supabase,
          composeAssignmentOffered(
            context.ctx.companyId,
            employeeId,
            job,
            result.data?.assignmentId || ""
          )
        );
      }
    }

    return serviceResponse(result);
  } catch (error: unknown) {
    return errorResponse(parseError(error), 500);
  }
}

import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { evaluateAndPersistCandidates } from "@/lib/road-recovery/dispatch-data";
import {
  asText,
  errorResponse,
  parseError,
  readJson,
  requireApiContext,
} from "@/lib/road-recovery/api";

/**
 * Runs the DETERMINISTIC dispatch engine and persists every candidate evaluation.
 *
 * POST rather than GET because it writes the explainability record: each run produces a
 * new evaluation_id in rr_dispatch_candidates rather than mutating an earlier one.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await readJson(request);
    const context = await requireApiContext(request, body.companyId);
    if (!context.ok) return errorResponse(context.message, context.status);

    const serviceJobId = asText(body.serviceJobId);
    if (!serviceJobId) return errorResponse("serviceJobId is required.", 400);

    const { evaluation, error } = await evaluateAndPersistCandidates(context.ctx.auth.supabase, {
      companyId: context.ctx.companyId,
      serviceJobId,
      evaluatedBy: context.ctx.auth.email,
      evaluatedAt: new Date().toISOString(),
      evaluationId: randomUUID(),
    });

    if (error || !evaluation) return errorResponse(error || "Evaluation failed.", 500);

    return NextResponse.json({
      ok: true,
      engineVersion: evaluation.engineVersion,
      evaluatedAt: evaluation.evaluatedAt,
      recommended: evaluation.recommended,
      eligible: evaluation.eligible,
      candidates: evaluation.candidates,
      noCandidateReason: evaluation.noCandidateReason,
    });
  } catch (error: unknown) {
    return errorResponse(parseError(error), 500);
  }
}

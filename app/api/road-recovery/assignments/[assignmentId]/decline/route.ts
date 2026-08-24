import { NextRequest } from "next/server";
import { declineAssignment } from "@/lib/road-recovery/job-service";
import { notifyDriverResponse } from "@/lib/road-recovery/notifications";
import {
  asText,
  errorResponse,
  parseError,
  readJson,
  requireApiContext,
  resolveDriverEmployeeId,
  runIdempotentMutation,
  serviceResponse,
} from "@/lib/road-recovery/api";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ assignmentId: string }> }
) {
  try {
    const body = await readJson(request);
    const context = await requireApiContext(request, body.companyId);
    if (!context.ok) return errorResponse(context.message, context.status);

    const resolved = await params;
    const assignmentId = asText(resolved.assignmentId);
    const reason = asText(body.reason);
    if (!assignmentId) return errorResponse("assignmentId is required.", 400);
    if (!reason) return errorResponse("A decline reason is required.", 400);

    const asDriver = body.asDriver !== false;
    let employeeId: string | undefined;
    if (asDriver) {
      const driver = await resolveDriverEmployeeId(
        context.ctx.auth.supabase,
        context.ctx.companyId,
        context.ctx.auth.email
      );
      if (!driver.ok) return errorResponse(driver.message, driver.status);
      employeeId = driver.employeeId;
    }

    let result: Awaited<ReturnType<typeof declineAssignment>> | null = null;
    const response = await runIdempotentMutation(
      context.ctx,
      body,
      "decline_assignment",
      null,
      async () => {
        result = await declineAssignment(context.ctx.auth.supabase, {
          companyId: context.ctx.companyId,
          actorEmail: context.ctx.auth.email,
          assignmentId,
          reason,
          employeeId,
        });
        return result;
      }
    );

    /**
     * A decline is the one response the control room must not miss — the job is now
     * unassigned and someone has to act. Carries the driver's reason so the dispatcher
     * can reassign without phoning. Fail-soft: the decline already committed.
     */
    if (result && (result as { ok: boolean }).ok) {
      await notifyDriverResponse(context.ctx.auth.supabase, {
        companyId: context.ctx.companyId,
        assignmentId,
        event: "declined",
        actorEmail: context.ctx.auth.email,
        detail: reason,
      });
    }

    return response;
  } catch (error: unknown) {
    return errorResponse(parseError(error), 500);
  }
}

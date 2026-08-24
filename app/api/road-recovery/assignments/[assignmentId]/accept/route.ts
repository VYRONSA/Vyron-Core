import { NextRequest } from "next/server";
import { acceptAssignment } from "@/lib/road-recovery/job-service";
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
    if (!assignmentId) return errorResponse("assignmentId is required.", 400);

    // The driver identity comes from the SESSION, never the body, unless a controller
    // is accepting on their behalf (in which case no employeeId gate is applied).
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

    /**
     * Idempotent: a driver on a flaky connection may send this twice. The
     * receipt decides, not the device. Without an operationId this behaves
     * exactly as it did before.
     */
    let result: Awaited<ReturnType<typeof acceptAssignment>> | null = null;
    const response = await runIdempotentMutation(
      context.ctx,
      body,
      "accept_assignment",
      null,
      async () => {
        result = await acceptAssignment(context.ctx.auth.supabase, {
          companyId: context.ctx.companyId,
          actorEmail: context.ctx.auth.email,
          assignmentId,
          employeeId,
        });
        return result;
      }
    );

    /**
     * Close the loop back to the control room.
     *
     * The dispatcher who offered the job should not have to watch the board to learn it
     * was taken. Addressed to employee_id NULL so every controller in the tenant sees it.
     * Fail-soft: the acceptance already succeeded.
     */
    if (result && (result as { ok: boolean }).ok) {
      await notifyDriverResponse(context.ctx.auth.supabase, {
        companyId: context.ctx.companyId,
        assignmentId,
        event: "accepted",
        actorEmail: context.ctx.auth.email,
      });
    }

    return response;
  } catch (error: unknown) {
    return errorResponse(parseError(error), 500);
  }
}

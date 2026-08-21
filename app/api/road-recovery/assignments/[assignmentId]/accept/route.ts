import { NextRequest } from "next/server";
import { acceptAssignment } from "@/lib/road-recovery/job-service";
import {
  asText,
  errorResponse,
  parseError,
  readJson,
  requireApiContext,
  resolveDriverEmployeeId,
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

    const result = await acceptAssignment(context.ctx.auth.supabase, {
      companyId: context.ctx.companyId,
      actorEmail: context.ctx.auth.email,
      assignmentId,
      employeeId,
    });

    return serviceResponse(result);
  } catch (error: unknown) {
    return errorResponse(parseError(error), 500);
  }
}

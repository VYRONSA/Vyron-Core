import { NextResponse, type NextRequest } from "next/server";
import { requirePlatformOperator } from "@/app/api/platform/_shared";
import { userManagementErrorResponse } from "@/lib/tenant/api-response";
import { resendCompanyUserInvite } from "@/lib/tenant/user-management";
import { logQueueJob } from "@/lib/platform/job-queue";
import { platformUserManagementContext } from "../../_actor";

export const runtime = "nodejs";

type RouteParams = { params: Promise<{ companyId: string; userId: string }> };

export async function POST(request: NextRequest, { params }: RouteParams) {
  const auth = await requirePlatformOperator(request);
  if (!auth.ok) return auth.response;

  try {
    const { companyId, userId } = await params;
    const { store, actor } = platformUserManagementContext(auth.context, companyId);
    const result = await resendCompanyUserInvite(
      store,
      actor,
      userId,
      `${request.nextUrl.origin}/invite`
    );

    // Mirrors the existing support "resend invite" action so the platform email queue
    // records both paths identically.
    await logQueueJob(auth.context.supabase, {
      queueName: "email",
      payload: { to: result.user.email, kind: "invite_resend" },
      status: "completed",
    });

    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return userManagementErrorResponse(error);
  }
}

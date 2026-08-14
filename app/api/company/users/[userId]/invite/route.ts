/**
 * Re-send the welcome / activation invitation for a company user.
 *
 * Uses the same Supabase invite mechanism as the existing Platform Console
 * "resend invite" support action (lib/client-invite-resend.ts / auth.admin
 * inviteUserByEmail), so the two never diverge and the existing flow is unaffected.
 */

import { NextResponse, type NextRequest } from "next/server";
import { requireCompanyUserContext } from "@/lib/tenant/api-auth";
import { userManagementErrorResponse } from "@/lib/tenant/api-response";
import { resendCompanyUserInvite } from "@/lib/tenant/user-management";

export const runtime = "nodejs";

type RouteParams = { params: Promise<{ userId: string }> };

export async function POST(request: NextRequest, { params }: RouteParams) {
  const gate = await requireCompanyUserContext(request);
  if (!gate.ok) return gate.response;

  try {
    const { userId } = await params;
    const result = await resendCompanyUserInvite(
      gate.context.store,
      gate.context.actor,
      userId,
      `${request.nextUrl.origin}/invite`
    );
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return userManagementErrorResponse(error);
  }
}

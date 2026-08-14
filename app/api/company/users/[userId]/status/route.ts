/**
 * Deactivate / reactivate a company user.
 *
 * Deactivation is enforced at authentication time, not by hiding the row: both
 * lib/server/authorization.ts (middleware, every protected page) and
 * lib/company-access.ts (workspace resolution) only accept company_users rows with
 * status = 'active', so a deactivated member is refused entry to the workspace on their
 * next request.
 */

import { NextResponse, type NextRequest } from "next/server";
import { requireCompanyUserContext } from "@/lib/tenant/api-auth";
import { readJsonBody, userManagementErrorResponse } from "@/lib/tenant/api-response";
import { setCompanyUserStatus } from "@/lib/tenant/user-management";

export const runtime = "nodejs";

type RouteParams = { params: Promise<{ userId: string }> };

export async function POST(request: NextRequest, { params }: RouteParams) {
  const gate = await requireCompanyUserContext(request);
  if (!gate.ok) return gate.response;

  try {
    const { userId } = await params;
    const body = await readJsonBody(request);

    if (typeof body.active !== "boolean") {
      return NextResponse.json(
        { ok: false, message: "active must be true or false." },
        { status: 400 }
      );
    }

    const result = await setCompanyUserStatus(
      gate.context.store,
      gate.context.actor,
      userId,
      body.active
    );

    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return userManagementErrorResponse(error);
  }
}

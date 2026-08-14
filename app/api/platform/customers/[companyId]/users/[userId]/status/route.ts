import { NextResponse, type NextRequest } from "next/server";
import { requirePlatformOperator } from "@/app/api/platform/_shared";
import { readJsonBody, userManagementErrorResponse } from "@/lib/tenant/api-response";
import { setCompanyUserStatus } from "@/lib/tenant/user-management";
import { platformUserManagementContext } from "../../_actor";

export const runtime = "nodejs";

type RouteParams = { params: Promise<{ companyId: string; userId: string }> };

export async function POST(request: NextRequest, { params }: RouteParams) {
  const auth = await requirePlatformOperator(request);
  if (!auth.ok) return auth.response;

  try {
    const { companyId, userId } = await params;
    const { store, actor } = platformUserManagementContext(auth.context, companyId);
    const body = await readJsonBody(request);

    if (typeof body.active !== "boolean") {
      return NextResponse.json(
        { ok: false, message: "active must be true or false." },
        { status: 400 }
      );
    }

    const result = await setCompanyUserStatus(store, actor, userId, body.active);
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return userManagementErrorResponse(error);
  }
}

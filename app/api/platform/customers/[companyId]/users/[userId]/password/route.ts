import { NextResponse, type NextRequest } from "next/server";
import { requirePlatformOperator } from "@/app/api/platform/_shared";
import {
  readJsonBody,
  readPasswordMode,
  userManagementErrorResponse,
} from "@/lib/tenant/api-response";
import { resetCompanyUserPassword } from "@/lib/tenant/user-management";
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
    const mode = readPasswordMode(body.passwordMode, "generate");

    if (mode !== "manual" && mode !== "generate") {
      return NextResponse.json(
        { ok: false, message: "passwordMode must be \"manual\" or \"generate\"." },
        { status: 400 }
      );
    }

    const result = await resetCompanyUserPassword(store, actor, userId, {
      passwordMode: mode,
      password: body.password ? String(body.password) : undefined,
      confirmPassword: body.confirmPassword ? String(body.confirmPassword) : undefined,
      requirePasswordChange:
        body.requirePasswordChange === undefined ? undefined : Boolean(body.requirePasswordChange),
    });

    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return userManagementErrorResponse(error);
  }
}

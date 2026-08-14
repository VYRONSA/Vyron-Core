import { NextResponse, type NextRequest } from "next/server";
import { requirePlatformOperator } from "@/app/api/platform/_shared";
import {
  readJsonBody,
  readModulesField,
  readPermissionsField,
  userManagementErrorResponse,
} from "@/lib/tenant/api-response";
import {
  deleteCompanyUser,
  restoreCompanyUser,
  updateCompanyUser,
  type UpdateCompanyUserInput,
} from "@/lib/tenant/user-management";
import { platformUserManagementContext } from "../_actor";

export const runtime = "nodejs";

type RouteParams = { params: Promise<{ companyId: string; userId: string }> };

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  const auth = await requirePlatformOperator(request);
  if (!auth.ok) return auth.response;

  try {
    const { companyId, userId } = await params;
    const { store, actor } = platformUserManagementContext(auth.context, companyId);
    const body = await readJsonBody(request);

    const input: UpdateCompanyUserInput = {};
    if ("firstName" in body) input.firstName = String(body.firstName || "");
    if ("lastName" in body) input.lastName = String(body.lastName || "");
    if ("email" in body) input.email = String(body.email || "");
    if ("mobile" in body) input.mobile = body.mobile === null ? null : String(body.mobile || "");
    if ("role" in body) input.role = String(body.role || "");
    if ("status" in body) input.status = body.status === "inactive" ? "inactive" : "active";

    const modules = readModulesField(body);
    if (modules !== undefined) input.modules = modules;

    const permissions = readPermissionsField(body);
    if (permissions !== undefined) input.permissions = permissions;

    const result = await updateCompanyUser(store, actor, userId, input);
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return userManagementErrorResponse(error);
  }
}

export async function DELETE(request: NextRequest, { params }: RouteParams) {
  const auth = await requirePlatformOperator(request);
  if (!auth.ok) return auth.response;

  try {
    const { companyId, userId } = await params;
    const { store, actor } = platformUserManagementContext(auth.context, companyId);
    const restore = request.nextUrl.searchParams.get("restore") === "1";

    const result = restore
      ? await restoreCompanyUser(store, actor, userId)
      : await deleteCompanyUser(store, actor, userId);

    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return userManagementErrorResponse(error);
  }
}

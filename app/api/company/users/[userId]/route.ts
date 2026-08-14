/**
 * Edit and remove a user inside the caller's own company.
 *
 * `userId` is a public.company_users.id. Every lookup is scoped by the caller's resolved
 * company id, so an id belonging to another tenant resolves to nothing and returns 404 —
 * it is never leaked as a 403 that would confirm the row exists.
 */

import { NextResponse, type NextRequest } from "next/server";
import { requireCompanyUserContext } from "@/lib/tenant/api-auth";
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

export const runtime = "nodejs";

type RouteParams = { params: Promise<{ userId: string }> };

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  const gate = await requireCompanyUserContext(request);
  if (!gate.ok) return gate.response;

  try {
    const { userId } = await params;
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

    const result = await updateCompanyUser(gate.context.store, gate.context.actor, userId, input);
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return userManagementErrorResponse(error);
  }
}

export async function DELETE(request: NextRequest, { params }: RouteParams) {
  const gate = await requireCompanyUserContext(request);
  if (!gate.ok) return gate.response;

  try {
    const { userId } = await params;
    const restore = request.nextUrl.searchParams.get("restore") === "1";

    const result = restore
      ? await restoreCompanyUser(gate.context.store, gate.context.actor, userId)
      : await deleteCompanyUser(gate.context.store, gate.context.actor, userId);

    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return userManagementErrorResponse(error);
  }
}

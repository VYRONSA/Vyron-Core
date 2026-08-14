/**
 * Platform Console → Customers → Customer → Users.
 *
 * GET  the customer's full user list (including removed memberships, which the customer
 *      surface hides) with roles, status, modules, last login and creation date.
 * POST create an administrator or any other user for that customer.
 *
 * Both are behind requirePlatformOperator: operator claim + Platform Mode elevation.
 */

import { NextResponse, type NextRequest } from "next/server";
import { requirePlatformOperator } from "@/app/api/platform/_shared";
import {
  readJsonBody,
  readModulesField,
  readPasswordMode,
  readPermissionsField,
  userManagementErrorResponse,
} from "@/lib/tenant/api-response";
import {
  createCompanyUser,
  listCompanyUsers,
  type PasswordMode,
} from "@/lib/tenant/user-management";
import { platformUserManagementContext } from "./_actor";

export const runtime = "nodejs";

type RouteParams = { params: Promise<{ companyId: string }> };

export async function GET(request: NextRequest, { params }: RouteParams) {
  const auth = await requirePlatformOperator(request);
  if (!auth.ok) return auth.response;

  try {
    const { companyId } = await params;
    const { store, actor } = platformUserManagementContext(auth.context, companyId);
    const directory = await listCompanyUsers(store, actor, { includeDeleted: true });
    return NextResponse.json({ ok: true, ...directory });
  } catch (error) {
    return userManagementErrorResponse(error);
  }
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  const auth = await requirePlatformOperator(request);
  if (!auth.ok) return auth.response;

  try {
    const { companyId } = await params;
    const { store, actor } = platformUserManagementContext(auth.context, companyId);
    const body = await readJsonBody(request);

    const result = await createCompanyUser(store, actor, {
      firstName: String(body.firstName || ""),
      lastName: String(body.lastName || ""),
      email: String(body.email || ""),
      mobile: body.mobile === undefined ? null : String(body.mobile || ""),
      role: String(body.role || "owner"),
      status: body.status === "inactive" ? "inactive" : "active",
      passwordMode: readPasswordMode(body.passwordMode, "generate") as PasswordMode,
      password: body.password ? String(body.password) : undefined,
      confirmPassword: body.confirmPassword ? String(body.confirmPassword) : undefined,
      modules: readModulesField(body) ?? null,
      permissions: readPermissionsField(body) ?? null,
      inviteRedirectTo: `${request.nextUrl.origin}/invite`,
    });

    return NextResponse.json({ ok: true, ...result }, { status: 201 });
  } catch (error) {
    return userManagementErrorResponse(error);
  }
}

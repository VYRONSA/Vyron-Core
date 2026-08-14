/**
 * Customer-facing user directory — Settings → Users & Access.
 *
 * GET  lists every user belonging to the CALLER'S company. The company is resolved from
 *      the authenticated identity (lib/tenant/api-auth.ts) and the query is scoped to it
 *      in SQL, so this endpoint cannot return another tenant's users regardless of what
 *      the client sends. Nothing is filtered in React.
 *
 * POST creates a user in that same company. Role, module and permission validation all
 *      happen server-side in lib/tenant/user-management.ts.
 */

import { NextResponse, type NextRequest } from "next/server";
import { requireCompanyUserContext } from "@/lib/tenant/api-auth";
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

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const gate = await requireCompanyUserContext(request);
  if (!gate.ok) return gate.response;

  try {
    const includeDeleted = request.nextUrl.searchParams.get("includeDeleted") === "1";
    const directory = await listCompanyUsers(gate.context.store, gate.context.actor, {
      includeDeleted,
    });
    return NextResponse.json({ ok: true, ...directory });
  } catch (error) {
    return userManagementErrorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  const gate = await requireCompanyUserContext(request);
  if (!gate.ok) return gate.response;

  try {
    const body = await readJsonBody(request);
    const result = await createCompanyUser(gate.context.store, gate.context.actor, {
      firstName: String(body.firstName || ""),
      lastName: String(body.lastName || ""),
      email: String(body.email || ""),
      mobile: body.mobile === undefined ? null : String(body.mobile || ""),
      role: String(body.role || ""),
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

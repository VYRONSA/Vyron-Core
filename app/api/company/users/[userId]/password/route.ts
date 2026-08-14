/**
 * Reset a company user's password.
 *
 * The new credential is written to Supabase Auth with the service role
 * (auth.admin.updateUserById) inside this server route. The service-role key never
 * reaches the browser, and the password is never persisted to company_users, companies,
 * profiles or the audit log — see redactSecrets() in lib/tenant/password-policy.ts.
 */

import { NextResponse, type NextRequest } from "next/server";
import { requireCompanyUserContext } from "@/lib/tenant/api-auth";
import {
  readJsonBody,
  readPasswordMode,
  userManagementErrorResponse,
} from "@/lib/tenant/api-response";
import { resetCompanyUserPassword } from "@/lib/tenant/user-management";

export const runtime = "nodejs";

type RouteParams = { params: Promise<{ userId: string }> };

export async function POST(request: NextRequest, { params }: RouteParams) {
  const gate = await requireCompanyUserContext(request);
  if (!gate.ok) return gate.response;

  try {
    const { userId } = await params;
    const body = await readJsonBody(request);
    const mode = readPasswordMode(body.passwordMode, "generate");

    if (mode !== "manual" && mode !== "generate") {
      return NextResponse.json(
        { ok: false, message: "passwordMode must be \"manual\" or \"generate\"." },
        { status: 400 }
      );
    }

    const result = await resetCompanyUserPassword(
      gate.context.store,
      gate.context.actor,
      userId,
      {
        passwordMode: mode,
        password: body.password ? String(body.password) : undefined,
        confirmPassword: body.confirmPassword ? String(body.confirmPassword) : undefined,
        requirePasswordChange:
          body.requirePasswordChange === undefined
            ? undefined
            : Boolean(body.requirePasswordChange),
      }
    );

    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return userManagementErrorResponse(error);
  }
}

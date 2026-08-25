import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdminClient } from "@/lib/server-api-auth";
import {
  registerDevice,
  revokeAllDevicesForUser,
  revokeDevice,
} from "@/lib/mobile/device-registry";
import { asText, parseError, requireApiContext } from "@/lib/employee-relations-api";

/**
 * The employee app is not a Road & Recovery feature, so this route deliberately
 * imports the TENANT-membership context rather than the R&R one: a tenant that
 * never bought the recovery vertical still has employees whose phones must ring
 * for tasks, incidents and safety alerts.
 */
async function readJson(request: NextRequest): Promise<Record<string, unknown>> {
  try {
    const parsed = await request.json();
    return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function errorResponse(message: string, status: number): NextResponse {
  return NextResponse.json({ ok: false, error: message }, { status });
}

/**
 * Device registration for the VYRON CORE Employee App.
 *
 * Deliberately NOT behind the Road & Recovery entitlement check: an employee of
 * a tenant that has not bought R&R still receives tasks, incidents, safety
 * alerts and supervisor messages, and still needs their phone to ring. Tenant
 * membership is what is required here, and `requireCompanyApiContext` enforces
 * exactly that.
 *
 * The company and the email come from the verified session. The ONLY thing this
 * route takes from the client is the opaque token its own OS just handed it —
 * which it can write and can never read back, because sql/097 grants
 * `authenticated` nothing at all on that table.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await readJson(request);
    const context = await requireApiContext(request, body.companyId);
    if (!context.ok) return errorResponse(context.message, context.status);

    const { companyId, auth } = context.ctx;

    // The employee record, when this user has one. Resolved server-side by the
    // same email link the notification feed uses — never accepted from the body.
    const { data: employee } = await auth.supabase
      .from("employees")
      .select("id")
      .eq("company_id", companyId)
      .ilike("email", auth.email)
      .eq("active", true)
      .maybeSingle();

    const result = await registerDevice(getSupabaseAdminClient(), {
      companyId,
      userEmail: auth.email,
      employeeId: employee ? String((employee as { id: string }).id) : null,
      platform: asText(body.platform),
      provider: asText(body.provider),
      deviceToken: asText(body.deviceToken),
      deviceLabel: asText(body.deviceLabel) || null,
      appVersion: asText(body.appVersion) || null,
    });

    if (!result.ok) return errorResponse(result.error, result.status);

    // An id and a status. Never the token, and never anything derived from it.
    return NextResponse.json({
      ok: true,
      registrationId: result.registrationId,
      replacedClaims: result.replacedClaims,
    });
  } catch (error: unknown) {
    return errorResponse(parseError(error), 500);
  }
}

/**
 * Sign-out. Revokes this handset, or every handset this user holds.
 *
 * Always reports success. Telling a caller "that token is not yours" would
 * confirm the token exists, which is exactly what an attacker probing tokens
 * wants to learn.
 */
export async function DELETE(request: NextRequest) {
  try {
    const body = await readJson(request);
    const context = await requireApiContext(request, body.companyId);
    if (!context.ok) return errorResponse(context.message, context.status);

    const { companyId, auth } = context.ctx;
    const admin = getSupabaseAdminClient();

    const result = body.allDevices === true
      ? await revokeAllDevicesForUser(admin, { companyId, userEmail: auth.email })
      : await revokeDevice(admin, {
          companyId,
          userEmail: auth.email,
          deviceToken: asText(body.deviceToken),
        });

    return NextResponse.json({ ok: true, revoked: result.revoked });
  } catch (error: unknown) {
    return errorResponse(parseError(error), 500);
  }
}

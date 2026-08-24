/**
 * Shared server helpers for the Road & Recovery API surface (Phase 1).
 *
 * Authentication and the tenant boundary are NOT reimplemented here. requireApiContext()
 * from lib/employee-relations-api.ts is the established pattern: it authenticates the
 * request against Supabase and then VERIFIES the supplied companyId against the caller's
 * own active membership via assertCompanyWorkspaceAccess(). A caller who edits the
 * companyId in a request is refused rather than served another tenant's data.
 *
 * Every Road & Recovery write goes through a route handler using this helper. There is
 * no browser-side mutation of any rr_* table.
 */

import { NextResponse, type NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  parseError,
  requireApiContext as requireCompanyApiContext,
} from "@/lib/employee-relations-api";
import { asText } from "@/lib/road-recovery/coerce";
import { normalizeRbacRole } from "@/lib/server/auth-routing";
import { hasModuleEntitlement } from "@/lib/server/module-entitlement";
import {
  readOperationId,
  withIdempotency,
  type RrOperationKind,
} from "@/lib/road-recovery/idempotency";
import type { RrServiceResult } from "@/lib/road-recovery/job-service";

export { parseError };
// Pure coercions live in their own module so they are unit-testable without
// pulling next/server into the test loader. Re-exported so call sites are unchanged.
export { asText, asNumberOrNull, asBooleanOrNull } from "@/lib/road-recovery/coerce";

/**
 * The Road & Recovery endpoints a DRIVER may call.
 *
 * middleware.ts already keeps an employee out of every Road & Recovery page except
 * /road-recovery/driver (EMPLOYEE_ALLOWED_PREFIXES in lib/server/auth-routing.ts), but
 * its matcher deliberately excludes /api — so that boundary existed only in the browser.
 * A driver could read the dispatch board, the billing reports, counterparty rates and the
 * executive intelligence for their company simply by calling the API the screen calls.
 *
 * The list below is the driver's OWN workflow, and nothing else: their assignments, the
 * accept/decline of an offer, GPS travel and arrival, the BYSTAND standing clock, the
 * evidence and report they capture, the requirement checklist their screen shows them,
 * and the job transitions that screen performs. Every other Road & Recovery route is
 * supervisor-and-above, matching the pages.
 *
 * Matched against the pathname with a prefix test, and DEFAULT DENY for an employee, so a
 * route added later is closed to drivers until somebody decides otherwise — the same
 * direction canAccessRouteForRole() fails in.
 */
const DRIVER_ALLOWED_API_PREFIXES = [
  "/api/road-recovery/driver",
  "/api/road-recovery/assignments",
  "/api/road-recovery/bystand/reason-codes",
  // A driver's own notification inbox. The endpoint resolves the recipient from the
  // session and returns only their rows plus control-room broadcasts, so opening it to
  // employees exposes nothing another driver owns.
  "/api/road-recovery/notifications",
] as const;

/** Job-scoped routes a driver's own screen calls, matched on the trailing segment. */
const DRIVER_ALLOWED_JOB_SUFFIXES = [
  "/transition",
  "/requirements",
  // The driver is the one standing at the vehicle, so they are the one who can photograph
  // it. Capture is theirs; deciding whether a requirement may be EXCUSED instead is not,
  // which is why /waivers stays read-only below.
  "/evidence",
] as const;

/**
 * Job-scoped routes a driver may READ but never write.
 *
 * The driver's requirement checklist renders waiver state alongside each item, so it has
 * to read them; granting the waiver itself is a controller decision and stays closed.
 */
const DRIVER_READONLY_JOB_SUFFIXES = ["/waivers"] as const;

/** BYSTAND job-scoped routes the driver's screen calls. */
const DRIVER_ALLOWED_BYSTAND_SUFFIXES = [
  "/standing",
  "/stand-down",
  "/report",
  "/evidence",
  "/timer",
] as const;

function isDriverAllowedPath(pathname: string, method: string): boolean {
  if (DRIVER_ALLOWED_API_PREFIXES.some((prefix) => pathname.startsWith(prefix))) return true;
  if (pathname.startsWith("/api/road-recovery/bystand/")) {
    return DRIVER_ALLOWED_BYSTAND_SUFFIXES.some((suffix) => pathname.endsWith(suffix));
  }
  if (pathname.startsWith("/api/road-recovery/jobs/")) {
    if (DRIVER_ALLOWED_JOB_SUFFIXES.some((suffix) => pathname.endsWith(suffix))) return true;
    return (
      method === "GET" &&
      DRIVER_READONLY_JOB_SUFFIXES.some((suffix) => pathname.endsWith(suffix))
    );
  }
  return false;
}

/**
 * The caller's role IN THIS TENANT, read through their own client so RLS applies.
 *
 * company_users.role is the tenant role ("owner" / "admin" / "supervisor" / "user"), and
 * normalizeRbacRole() maps it onto the same five-value vocabulary middleware.ts uses, so
 * there is one role vocabulary rather than two that can drift.
 */
async function resolveTenantRole(
  supabase: SupabaseClient,
  companyId: string,
  email: string
): Promise<string | null> {
  const { data } = await supabase
    .from("company_users")
    .select("role")
    .eq("company_id", companyId)
    .ilike("user_email", email)
    .eq("status", "active")
    .limit(1)
    .maybeSingle();
  const row = data as { role?: string } | null;
  return row?.role ?? null;
}

/**
 * requireApiContext with the Road & Recovery role boundary applied.
 *
 * Every Road & Recovery route imports requireApiContext from THIS module, so the check
 * lands once rather than being repeated (and eventually forgotten) in 47 route handlers.
 */
export async function requireApiContext(
  request: NextRequest,
  companyIdValue: unknown
): ReturnType<typeof requireCompanyApiContext> {
  const context = await requireCompanyApiContext(request, companyIdValue);
  if (!context.ok) return context;

  /**
   * Subscription entitlement, checked before any role question.
   *
   * middleware.ts gates the PAGES on companies.enabled_modules, but its matcher excludes
   * /api — so without this the boundary would again exist only in the browser and a
   * tenant that never bought the vertical could call all 43 endpoints directly.
   *
   * Applied to platform operators too, matching middleware.ts: the companyId here has
   * already been verified against the caller's own membership, so this asks whether THAT
   * workspace holds the module, which is the same question the page asks.
   */
  const entitled = await hasModuleEntitlement(
    context.ctx.auth.supabase,
    // AuthenticatedApiContext carries the verified email, not the auth user id, so the
    // membership resolves by address here — the same either/or the helper applies.
    { email: context.ctx.auth.email, companyId: context.ctx.companyId },
    "road_recovery"
  );
  if (!entitled) {
    return {
      ok: false,
      status: 403,
      message: "Road & Recovery is not enabled for this workspace.",
    };
  }

  // Platform operators (VYRON staff) keep the access they have on the pages.
  if (context.ctx.auth.platformOperator) return context;

  const pathname = request.nextUrl.pathname;
  if (isDriverAllowedPath(pathname, request.method)) return context;

  const tenantRole = await resolveTenantRole(
    context.ctx.auth.supabase,
    context.ctx.companyId,
    context.ctx.auth.email
  );
  if (normalizeRbacRole(tenantRole) === "employee") {
    return {
      ok: false,
      status: 403,
      message: "This Road & Recovery area is not available to your role.",
    };
  }

  return context;
}

/** Body parser that never throws — an unparseable body is an empty object. */
export async function readJson(request: NextRequest): Promise<Record<string, unknown>> {
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) return {};
  return body as Record<string, unknown>;
}

export function errorResponse(message: string, status: number): NextResponse {
  return NextResponse.json({ ok: false, error: message }, { status });
}

/** Turns a service-layer result into an HTTP response. */
export function serviceResponse<T>(result: RrServiceResult<T>): NextResponse {
  if (!result.ok) return errorResponse(result.message, result.status);
  return NextResponse.json({ ok: true, ...(result.data as Record<string, unknown>) });
}

/**
 * Resolves the employee record for the signed-in user, for driver-facing endpoints.
 *
 * The driver identity is derived from the SESSION, never from the request body, so a
 * driver cannot accept or arrive on another driver's behalf.
 */
export async function resolveDriverEmployeeId(
  supabase: SupabaseClient,
  companyId: string,
  email: string
): Promise<{ ok: true; employeeId: string } | { ok: false; status: number; message: string }> {
  const { data, error } = await supabase
    .from("employees")
    .select("id")
    .eq("company_id", companyId)
    .ilike("email", email)
    .eq("active", true)
    .maybeSingle();

  if (error) return { ok: false, status: 500, message: "Could not resolve the driver record." };
  if (!data) {
    return {
      ok: false,
      status: 403,
      message: "Your sign-in is not linked to an active employee record in this company.",
    };
  }
  return { ok: true, employeeId: String((data as { id: string }).id) };
}

/**
 * Runs a mutation at most once per (tenant, operationId).
 *
 * Wraps the existing serviceResponse() flow so a route adopts idempotency by
 * changing one line. When the body carries no operationId the mutation runs
 * exactly as it always has — every online path is unaffected, and routes can be
 * migrated one at a time.
 *
 * OWNERSHIP IS NEVER TAKEN FROM THE BODY. companyId and actorEmail come from the
 * verified context, and the database's WITH CHECK refuses anything else, so a
 * client cannot file a receipt against another tenant or another user.
 *
 * The receipt is only marked succeeded once `execute` has resolved, which for
 * PostgREST means the underlying writes have committed. A mutation that throws
 * marks the receipt failed and lets the next retry through.
 */
export async function runIdempotentMutation<T>(
  ctx: { auth: { supabase: SupabaseClient; email: string }; companyId: string },
  body: Record<string, unknown>,
  operationKind: RrOperationKind,
  serviceJobId: string | null,
  execute: () => Promise<RrServiceResult<T>>
): Promise<NextResponse> {
  const operationId = readOperationId(body.operationId);

  if (!operationId) {
    return serviceResponse(await execute());
  }

  // The receipt hashes the request MINUS the operation id itself: the id
  // identifies the attempt, it is not part of what was asked for.
  const { operationId: _ignored, ...requestBody } = body;

  let serviceResult: RrServiceResult<T> | null = null;

  const outcome = await withIdempotency(
    ctx.auth.supabase,
    {
      companyId: ctx.companyId,
      actorEmail: ctx.auth.email,
      operationId,
      operationKind,
      serviceJobId,
      requestBody,
    },
    async () => {
      serviceResult = await execute();
      // A refused mutation is a real answer, not a failure to record: replaying
      // it keeps a retry from re-attempting something the workflow already
      // rejected. Only a THROWN error marks the receipt failed.
      return serviceResult;
    }
  );

  if (outcome.status === "conflict") {
    return NextResponse.json(
      { ok: false, error: outcome.message, code: outcome.code },
      { status: 409 }
    );
  }
  if (outcome.status === "in_progress") {
    return NextResponse.json(
      { ok: false, error: outcome.message, code: outcome.code },
      { status: 409 }
    );
  }

  const replayed = outcome.status === "replayed";
  const result = (serviceResult ?? outcome.result) as RrServiceResult<T>;
  const response = serviceResponse(result);
  // Lets the client's outbox tell "this ran now" from "this had already run",
  // without exposing the receipt itself.
  response.headers.set("x-rr-operation", replayed ? "replayed" : "executed");
  return response;
}

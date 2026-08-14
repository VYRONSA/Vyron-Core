/**
 * Platform Administrator recovery endpoint.
 *
 *   GET  → report whether the platform currently has an administrator
 *   POST → provision (or repair) the Platform Administrator
 *
 * This is the ONLY route under /api/platform that does not require an authenticated
 * platform operator, because it exists precisely for the case where none exists.
 *
 * WHAT CHANGED, AND WHY
 *
 * This used to be a one-time latch: after a single successful bootstrap it refused
 * forever. That looked safe but produced an unrecoverable state — delete the promoted
 * account and the platform has zero operators *and* a bootstrap that will never run
 * again, leaving hand-editing the database as the only way back in.
 *
 * The guard is now an invariant rather than a one-shot: provisioning is permitted only
 * while the platform has NO operator. That is self-healing (it becomes available again
 * exactly when the administrator is lost) and it is not an escalation path, because
 * while any operator exists it refuses and further operators are promoted from the
 * Platform Console instead.
 *
 * Layers of protection, unchanged in spirit:
 *   - PLATFORM_BOOTSTRAP_SECRET must match (fail-closed when unset)
 *   - the zero-operator invariant above
 *   - every action is written to vyron_audit_log
 *
 *   curl -X POST https://<host>/api/platform/bootstrap \
 *     -H "x-vyron-bootstrap-secret: $PLATFORM_BOOTSTRAP_SECRET" \
 *     -H "content-type: application/json" \
 *     -d '{"email":"you@yourdomain.com","password":"..."}'
 *
 * `email`/`password` are optional: with none supplied the configured
 * PLATFORM_BOOTSTRAP_ADMIN_EMAIL / _PASSWORD are used.
 */

import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdminClient } from "@/lib/server-api-auth";
import { writeAuditLog } from "@/lib/audit-log";
import { verifyBootstrapSecret, BOOTSTRAP_SECRET_ENV } from "@/lib/platform/operator-bootstrap";
import {
  ensurePlatformAdmin,
  getConfiguredBootstrapAdmin,
  scanUsers,
} from "@/lib/platform/platform-admin-provisioning";

export const runtime = "nodejs";

const SECRET_HEADER = "x-vyron-bootstrap-secret";
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function fail(status: number, message: string, extra?: Record<string, unknown>) {
  return NextResponse.json({ ok: false, message, ...(extra || {}) }, { status });
}

/** Best-effort client IP for the audit trail — proxy headers, so advisory only. */
function requestIp(request: NextRequest): string {
  const forwarded = request.headers.get("x-forwarded-for") || "";
  return forwarded.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "unknown";
}

export async function GET(request: NextRequest) {
  const secret = verifyBootstrapSecret(request.headers.get(SECRET_HEADER) || "");
  if (!secret.ok) return fail(secret.status, secret.message);

  let supabase;
  try {
    supabase = getSupabaseAdminClient();
  } catch (error) {
    return fail(503, error instanceof Error ? error.message : "Admin client unavailable.");
  }

  const configured = getConfiguredBootstrapAdmin();
  const scan = await scanUsers(supabase, configured?.email || "");

  return NextResponse.json({
    ok: true,
    // Available whenever the platform has no operator — this is the self-healing
    // invariant, not a consumed one-time token.
    available: scan.operators.length === 0,
    operatorCount: scan.operators.length,
    operators: scan.operators.map((operator) => operator.email),
    configuredAdmin: configured?.email || null,
    configuredAdminExists: Boolean(scan.target),
    totalUsers: scan.total,
  });
}

export async function POST(request: NextRequest) {
  const secret = verifyBootstrapSecret(request.headers.get(SECRET_HEADER) || "");
  if (!secret.ok) {
    // Deliberately not written to vyron_audit_log: this endpoint is unauthenticated,
    // so logging every rejected guess would let anyone flood the audit trail.
    console.warn(`[platform-bootstrap] rejected attempt from ${requestIp(request)}: ${secret.message}`);
    return fail(secret.status, secret.message);
  }

  const body = await request.json().catch(() => null);
  const configured = getConfiguredBootstrapAdmin();

  const email = String(body?.email || configured?.email || "").trim().toLowerCase();
  const password = String(body?.password || configured?.password || "");

  if (!email || !EMAIL_PATTERN.test(email)) {
    return fail(
      400,
      `A valid email address is required — pass one in the body or set PLATFORM_BOOTSTRAP_ADMIN_EMAIL.`
    );
  }

  let supabase;
  try {
    supabase = getSupabaseAdminClient();
  } catch (error) {
    return fail(503, error instanceof Error ? error.message : "Admin client unavailable.");
  }

  const result = await ensurePlatformAdmin(supabase, {
    email,
    password,
    reason: "recovery_endpoint",
  });

  if (!result.ok) {
    await writeAuditLog(supabase, {
      userEmail: email,
      action: "platform_bootstrap_blocked",
      entityType: "platform_operator",
      metadata: { reason: result.message, ip: requestIp(request) },
    });
    // 409: refused because an operator already exists, which is the expected steady state.
    return fail(409, result.message);
  }

  return NextResponse.json({
    ok: true,
    email: result.email,
    userId: result.userId,
    actions: result.actions,
    message:
      result.actions.length === 0
        ? result.message
        : `${result.message} Sign in and open /platform. Remove ${BOOTSTRAP_SECRET_ENV} from the environment when recovery is complete.`,
  });
}

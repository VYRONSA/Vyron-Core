/**
 * POST /api/platform/bootstrap — promote the FIRST Platform Operator, once.
 *
 * This is the ONLY route under /api/platform that does not call
 * requirePlatformOperator(): by definition no operator exists yet when it runs.
 * It is guarded instead by
 *   - PLATFORM_BOOTSTRAP_SECRET (server-only env var, fail-closed when unset),
 *   - the one-time latch in public.vyron_platform_bootstrap (sql/066),
 *   - a scan proving zero accounts currently hold an operator claim.
 * Once the latch row exists this route can never promote anyone again.
 *
 *   curl -X POST https://<host>/api/platform/bootstrap \
 *     -H "x-vyron-bootstrap-secret: $PLATFORM_BOOTSTRAP_SECRET" \
 *     -H "content-type: application/json" \
 *     -d '{"email":"you@yourdomain.com"}'
 *
 * GET the same path (with the secret header) to check status without changing anything.
 */

import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdminClient } from "@/lib/server-api-auth";
import { writeAuditLog } from "@/lib/audit-log";
import {
  BOOTSTRAP_SECRET_ENV,
  buildOperatorAppMetadata,
  claimBootstrapLatch,
  readBootstrapLatch,
  releaseBootstrapLatch,
  scanUsers,
  verifyBootstrapSecret,
} from "@/lib/platform/operator-bootstrap";

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

  const latch = await readBootstrapLatch(supabase);
  if (!latch.ok) return fail(latch.status, latch.message);

  if (latch.row) {
    return NextResponse.json({
      ok: true,
      available: false,
      reason: "already_bootstrapped",
      completedAt: latch.row.completed_at,
      promotedEmail: latch.row.promoted_email,
      method: latch.row.method,
    });
  }

  const scan = await scanUsers(supabase, "");
  if (!scan.ok) return fail(scan.status, scan.message);

  const operators = scan.scan.existingOperators;
  return NextResponse.json({
    ok: true,
    available: operators.length === 0,
    reason: operators.length === 0 ? "ready" : "operator_already_exists",
    existingOperatorCount: operators.length,
  });
}

export async function POST(request: NextRequest) {
  const secret = verifyBootstrapSecret(request.headers.get(SECRET_HEADER) || "");
  if (!secret.ok) {
    // Deliberately not written to vyron_audit_log: this endpoint is
    // unauthenticated, so logging every rejected guess would let anyone flood
    // the audit trail. Server logs carry the signal instead.
    console.warn(`[platform-bootstrap] rejected attempt from ${requestIp(request)}: ${secret.message}`);
    return fail(secret.status, secret.message);
  }

  const body = await request.json().catch(() => null);
  const email = String(body?.email || "").trim().toLowerCase();

  if (!email || !EMAIL_PATTERN.test(email)) {
    return fail(400, "A valid email address is required.");
  }

  let supabase;
  try {
    supabase = getSupabaseAdminClient();
  } catch (error) {
    return fail(503, error instanceof Error ? error.message : "Admin client unavailable.");
  }

  const latch = await readBootstrapLatch(supabase);
  if (!latch.ok) return fail(latch.status, latch.message);

  if (latch.row) {
    return fail(
      410,
      `Bootstrap has already been used (${latch.row.promoted_email} on ${latch.row.completed_at}) and is permanently disabled. Promote further operators from /platform.`
    );
  }

  const scan = await scanUsers(supabase, email);
  if (!scan.ok) return fail(scan.status, scan.message);

  if (scan.scan.existingOperators.length > 0) {
    await writeAuditLog(supabase, {
      userEmail: email,
      action: "platform_bootstrap_blocked",
      entityType: "platform_operator",
      metadata: {
        reason: "operator_already_exists",
        existingOperatorCount: scan.scan.existingOperators.length,
        ip: requestIp(request),
      },
    });
    return fail(
      409,
      "A Platform Operator already exists. Bootstrap is only available when there are none — sign in as that operator and promote users from /platform."
    );
  }

  const target = scan.scan.target;
  if (!target) {
    return fail(
      404,
      `No account exists for ${email}. Create the account first (sign up in the app), then re-run bootstrap.`
    );
  }

  // Claim the latch BEFORE promoting: a concurrent second request loses here on
  // the single-row primary key rather than racing into a second promotion.
  const claim = await claimBootstrapLatch(supabase, {
    userId: target.id,
    email,
    performedBy: requestIp(request),
  });
  if (!claim.ok) return fail(claim.status, claim.message);
  if (!claim.claimed) {
    return fail(410, "Bootstrap has already been used and is permanently disabled.");
  }

  const { error: promoteError } = await supabase.auth.admin.updateUserById(target.id, {
    app_metadata: buildOperatorAppMetadata(target.app_metadata),
  });

  if (promoteError) {
    // The promotion failed, so the latch must not stay claimed — otherwise the
    // project would be permanently locked out with no operator at all.
    await releaseBootstrapLatch(supabase, target.id);
    return fail(500, `Could not promote ${email}: ${promoteError.message}`);
  }

  const audit = await writeAuditLog(supabase, {
    userEmail: email,
    action: "platform_bootstrap",
    entityType: "platform_operator",
    entityId: target.id,
    metadata: {
      method: "api",
      promotedEmail: email,
      ip: requestIp(request),
      bootstrapPermanentlyDisabled: true,
    },
  });

  return NextResponse.json({
    ok: true,
    email,
    userId: target.id,
    role: "platform_operator",
    bootstrapDisabled: true,
    auditLogged: audit.ok,
    message:
      "Platform Operator created. Sign out and sign in again to refresh your session claims, then open /platform. Bootstrap is now permanently disabled — remove " +
      `${BOOTSTRAP_SECRET_ENV} from the environment.`,
  });
}

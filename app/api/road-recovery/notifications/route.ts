import { NextRequest, NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  asText,
  errorResponse,
  parseError,
  readJson,
  requireApiContext,
} from "@/lib/road-recovery/api";
import { RR_NOTIFICATION_MODULE } from "@/lib/road-recovery/notifications";

/**
 * The signed-in user's Road & Recovery notification inbox.
 *
 * WHO SEES WHAT is decided here, on the server, from the session — never from a query
 * parameter. The caller's employee record is resolved from their verified email, and the
 * result is the union of:
 *
 *   their own driver notifications      employee_id = <their employees.id>
 *   control-room notifications          employee_id IS NULL
 *
 * A user who is not linked to an employee record (a dispatcher, typically) simply has no
 * driver rows and sees the control-room stream. That is a legitimate state, not an error,
 * so unlike the driver endpoints this one does not 403 on a missing employee record.
 *
 * requireApiContext() has already enforced authentication, tenant membership for the
 * supplied companyId, the road_recovery module entitlement and the R&R role boundary
 * before any of this runs.
 */

const MAX_LIMIT = 100;

type NotificationRow = {
  id: string;
  employee_id: string | null;
  notification_type: string;
  title: string;
  body: string | null;
  read_at: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
};

/** Resolve the caller's employee id, tolerating "not an employee". */
async function resolveOptionalEmployeeId(
  supabase: SupabaseClient,
  companyId: string,
  email: string
): Promise<string | null> {
  const { data } = await supabase
    .from("employees")
    .select("id")
    .eq("company_id", companyId)
    .ilike("email", email)
    .eq("active", true)
    .maybeSingle();
  const row = data as { id?: string } | null;
  return row?.id ? String(row.id) : null;
}

export async function GET(request: NextRequest) {
  try {
    const context = await requireApiContext(request, request.nextUrl.searchParams.get("companyId"));
    if (!context.ok) return errorResponse(context.message, context.status);

    const supabase = context.ctx.auth.supabase;
    const companyId = context.ctx.companyId;
    const employeeId = await resolveOptionalEmployeeId(
      supabase,
      companyId,
      context.ctx.auth.email
    );

    const unreadOnly = request.nextUrl.searchParams.get("unread") === "1";
    const requested = Number(request.nextUrl.searchParams.get("limit") || 30);
    const limit = Math.min(Math.max(Number.isFinite(requested) ? requested : 30, 1), MAX_LIMIT);

    // Only Road & Recovery rows: this table is shared with the mobile workforce module,
    // and an R&R screen must not surface another module's notifications. The marker lives
    // in metadata because notification_type is CHECK-constrained to a fixed vocabulary
    // that does not include rr_* values (see lib/road-recovery/notifications.ts).
    let query = supabase
      .from("mobile_workforce_notifications")
      .select("id,employee_id,notification_type,title,body,read_at,metadata,created_at")
      .eq("company_id", companyId)
      .eq("metadata->>module", RR_NOTIFICATION_MODULE)
      .order("created_at", { ascending: false })
      .limit(limit);

    // Own rows plus control-room rows. Written as an or() over server-resolved values;
    // the client never supplies an employee id.
    query = employeeId
      ? query.or(`employee_id.eq.${employeeId},employee_id.is.null`)
      : query.is("employee_id", null);

    if (unreadOnly) query = query.is("read_at", null);

    const { data, error } = await query;
    if (error) return errorResponse("Could not load notifications.", 500);

    const rows = (data || []) as NotificationRow[];
    return NextResponse.json({
      ok: true,
      notifications: rows.map((row) => ({
        id: row.id,
        // Report the precise R&R event, not the mapped storage type.
        type: String(row.metadata?.rrEvent || row.notification_type),
        title: row.title,
        body: row.body,
        readAt: row.read_at,
        createdAt: row.created_at,
        audience: row.employee_id ? "driver" : "control-room",
        metadata: row.metadata || {},
      })),
      unreadCount: rows.filter((row) => !row.read_at).length,
      fetchedAt: new Date().toISOString(),
    });
  } catch (error: unknown) {
    return errorResponse(parseError(error), 500);
  }
}

/**
 * Mark notifications read.
 *
 * Scoped three ways before the update runs: the tenant (verified by requireApiContext and
 * enforced again by RLS), the explicit id list, and the caller's own audience — so one
 * user cannot mark another driver's inbox as read. `authenticated` holds UPDATE but not
 * DELETE on this table, so read state is the only thing a client can change.
 */
export async function PATCH(request: NextRequest) {
  try {
    const body = await readJson(request);
    const context = await requireApiContext(request, body.companyId);
    if (!context.ok) return errorResponse(context.message, context.status);

    const supabase = context.ctx.auth.supabase;
    const companyId = context.ctx.companyId;
    const employeeId = await resolveOptionalEmployeeId(
      supabase,
      companyId,
      context.ctx.auth.email
    );

    const ids = Array.isArray(body.notificationIds)
      ? body.notificationIds.map((value: unknown) => asText(value)).filter(Boolean)
      : [];
    if (ids.length === 0) return errorResponse("notificationIds are required.", 400);
    if (ids.length > MAX_LIMIT) return errorResponse("Too many notifications in one request.", 400);

    let update = supabase
      .from("mobile_workforce_notifications")
      .update({ read_at: new Date().toISOString() })
      .eq("company_id", companyId)
      .in("id", ids)
      .is("read_at", null);

    update = employeeId
      ? update.or(`employee_id.eq.${employeeId},employee_id.is.null`)
      : update.is("employee_id", null);

    const { error } = await update;
    if (error) return errorResponse("Could not update the notifications.", 500);

    return NextResponse.json({ ok: true, updated: ids.length });
  } catch (error: unknown) {
    return errorResponse(parseError(error), 500);
  }
}

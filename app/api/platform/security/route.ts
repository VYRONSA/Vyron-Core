/**
 * Platform security dashboard metrics.
 *
 * Everything here is derived from public.vyron_audit_log (already installed) plus the
 * elevation registry (sql/067). Nothing new is written; this is a read-only view over
 * events the platform already records.
 */

import { NextRequest, NextResponse } from "next/server";
import { requirePlatformOperator } from "@/app/api/platform/_shared";
import { listActiveElevationSessions } from "@/lib/platform/elevation-registry";

export const runtime = "nodejs";

const AUDIT_TABLE = "vyron_audit_log";

function startOfTodayIso(): string {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
}

export async function GET(request: NextRequest) {
  const auth = await requirePlatformOperator(request);
  if (!auth.ok) return auth.response;
  const { supabase } = auth.context;

  const since = startOfTodayIso();

  const [failedRes, lockoutRes, impersonationRes, auditRes, grantsRes, sessionsRes] = await Promise.all([
    supabase
      .from(AUDIT_TABLE)
      .select("id", { count: "exact", head: true })
      .eq("action", "platform_elevation_denied")
      .gte("created_at", since),
    supabase
      .from(AUDIT_TABLE)
      .select("id", { count: "exact", head: true })
      .eq("action", "platform_elevation_locked")
      .gte("created_at", since),
    supabase
      .from(AUDIT_TABLE)
      .select("id", { count: "exact", head: true })
      .eq("action", "login_as_client")
      .gte("created_at", since),
    supabase
      .from(AUDIT_TABLE)
      .select("id", { count: "exact", head: true })
      .gte("created_at", since),
    supabase
      .from(AUDIT_TABLE)
      .select("id", { count: "exact", head: true })
      .eq("action", "platform_elevation_granted")
      .gte("created_at", since),
    listActiveElevationSessions(supabase),
  ]);

  // A missing audit table should degrade to "unknown" (null), not a fabricated zero.
  const value = (res: { count: number | null; error: unknown }) => (res.error ? null : res.count ?? 0);

  return NextResponse.json({
    ok: true,
    since,
    failedElevations: value(failedRes),
    lockouts: value(lockoutRes),
    impersonationsToday: value(impersonationRes),
    auditEventsToday: value(auditRes),
    successfulElevations: value(grantsRes),
    activeSessions: sessionsRes.ok ? sessionsRes.sessions.length : null,
    sessionRegistryAvailable: sessionsRes.ok,
    sessionRegistryMessage: sessionsRes.ok ? null : sessionsRes.message,
  });
}

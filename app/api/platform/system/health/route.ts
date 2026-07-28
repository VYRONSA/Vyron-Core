import { NextRequest, NextResponse } from "next/server";
import { requirePlatformOperator } from "@/app/api/platform/_shared";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const auth = await requirePlatformOperator(request);
  if (!auth.ok) return auth.response;
  const { supabase } = auth.context;

  const startedAt = Date.now();
  const { error: dbError } = await supabase.from("companies").select("id", { count: "exact", head: true });
  const dbLatencyMs = Date.now() - startedAt;

  const [activeSessionsRes, activeImpersonationsRes] = await Promise.all([
    supabase
      .from("vyron_user_sessions")
      .select("id", { count: "exact", head: true })
      .is("revoked_at", null)
      .gt("last_seen_at", new Date(Date.now() - 30 * 60 * 1000).toISOString()),
    supabase.from("platform_impersonation_sessions").select("id", { count: "exact", head: true }).eq("status", "active"),
  ]);

  return NextResponse.json({
    ok: true,
    database: { reachable: !dbError, latencyMs: dbLatencyMs, error: dbError?.message || null },
    activeSessions: activeSessionsRes.count || 0,
    activeImpersonations: activeImpersonationsRes.count || 0,
  });
}

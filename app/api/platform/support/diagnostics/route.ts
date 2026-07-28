import { NextRequest, NextResponse } from "next/server";
import { requirePlatformOperator } from "@/app/api/platform/_shared";

export const runtime = "nodejs";

/**
 * Real diagnostic signals only — this app has no dedicated error/API-failure/AI-failure
 * telemetry table, so those sections are reported as "not instrumented" rather than
 * filled with fabricated numbers.
 */
export async function GET(request: NextRequest) {
  const auth = await requirePlatformOperator(request);
  if (!auth.ok) return auth.response;
  const { supabase } = auth.context;

  const companyId = request.nextUrl.searchParams.get("companyId") || "";
  if (!companyId) return NextResponse.json({ ok: false, message: "companyId is required." }, { status: 400 });

  const [companyRes, sessionsRes, auditRes] = await Promise.all([
    supabase
      .from("companies")
      .select("id,name,customer_status,employee_limit,storage_limit_gb,ai_credit_limit")
      .eq("id", companyId)
      .maybeSingle(),
    supabase
      .from("vyron_user_sessions")
      .select("id,user_email,last_seen_at,revoked_at,expires_at")
      .eq("company_id", companyId)
      .order("last_seen_at", { ascending: false })
      .limit(20),
    supabase
      .from("vyron_audit_log")
      .select("id,user_email,action,entity_type,created_at")
      .eq("company_id", companyId)
      .order("created_at", { ascending: false })
      .limit(20),
  ]);

  if (companyRes.error) {
    return NextResponse.json({ ok: false, message: companyRes.error.message }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    company: companyRes.data,
    recentSessions: sessionsRes.data || [],
    recentActivity: auditRes.data || [],
    errorTracking: { instrumented: false, note: "No application error/API/AI failure telemetry table exists yet." },
  });
}

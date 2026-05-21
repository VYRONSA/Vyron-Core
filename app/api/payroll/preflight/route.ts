import { NextResponse } from "next/server";
import { getSupabaseAdminClient } from "@/lib/server-api-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const supabase = getSupabaseAdminClient();
  const [ex, hr, ph] = await Promise.all([
    supabase.from("exceptions").select("id,status"),
    supabase.from("hr_cases").select("id,status,employee_response_required"),
    supabase.from("payroll_hours").select("id,status,missing_clock_events"),
  ]);
  const exceptions = ex.data || [];
  const hrCases = hr.data || [];
  const payroll = ph.data || [];
  const openExceptions = exceptions.filter((x: any) => x.status !== "closed" && x.status !== "approved").length;
  const openHrCases = hrCases.filter((x: any) => x.status !== "closed").length;
  const missingClockEvents = payroll.reduce((s: number, x: any) => s + Number(x.missing_clock_events || 0), 0);
  const blockedPayroll = payroll.filter((x: any) => x.status === "needs_review" || Number(x.missing_clock_events || 0) > 0).length;
  const blockers = openExceptions + openHrCases + missingClockEvents + blockedPayroll;
  return NextResponse.json({
    ok: true,
    readinessScore: Math.max(0, Math.min(100, 100 - blockers * 8)),
    status: blockers ? "blocked" : "ready",
    openExceptions,
    openHrCases,
    missingClockEvents,
    blockedPayroll,
  });
}

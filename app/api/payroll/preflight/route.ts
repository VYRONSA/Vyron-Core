import { NextRequest, NextResponse } from "next/server";
import {
  assertCompanyWorkspaceAccess,
  authenticateApiRequest,
} from "@/lib/server-api-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const auth = await authenticateApiRequest(request);
    if (!auth.ok) {
      return NextResponse.json({ ok: false, error: auth.message }, { status: auth.status });
    }

    const companyId = (request.nextUrl.searchParams.get("companyId") || "").trim();
    const access = await assertCompanyWorkspaceAccess(auth.supabase, auth.email, companyId);
    if (!access.ok) {
      return NextResponse.json({ ok: false, error: access.message }, { status: access.status });
    }

    const [ex, hr, ph] = await Promise.all([
      auth.supabase.from("time_exceptions").select("id,status").eq("company_id", companyId),
      auth.supabase
        .from("hr_cases")
        .select("id,status,employee_response_required")
        .eq("company_id", companyId),
      auth.supabase
        .from("payroll_hours")
        .select("id,status,missing_clock_events")
        .eq("company_id", companyId),
    ]);

    if (ex.error || hr.error || ph.error) {
      const message = ex.error?.message || hr.error?.message || ph.error?.message;
      return NextResponse.json({ ok: false, error: message }, { status: 500 });
    }

    const exceptions = ex.data || [];
    const hrCases = hr.data || [];
    const payroll = ph.data || [];
    const openExceptions = exceptions.filter(
      (x: { status?: string | null }) => x.status !== "closed" && x.status !== "approved"
    ).length;
    const openHrCases = hrCases.filter(
      (x: { status?: string | null }) => x.status !== "closed"
    ).length;
    const missingClockEvents = payroll.reduce(
      (s: number, x: { missing_clock_events?: number | null }) =>
        s + Number(x.missing_clock_events || 0),
      0
    );
    const blockedPayroll = payroll.filter(
      (x: { status?: string | null; missing_clock_events?: number | null }) =>
        x.status === "needs_review" || Number(x.missing_clock_events || 0) > 0
    ).length;
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
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Payroll preflight failed.";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

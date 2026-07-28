import { NextRequest, NextResponse } from "next/server";
import { calculateWorkforceIntelligence } from "@/lib/intelligence-suite";
import type { WorkforceIntelligenceState } from "@/lib/intelligence-suite-types";
import { computeExecutiveWorkforceIntelligence } from "@/lib/executive-workforce-intelligence";
import {
  assertCompanyWorkspaceAccess,
  authenticateApiRequest,
} from "@/lib/server-api-auth";

export const runtime = "nodejs";

function isMissingTableError(message: string | undefined): boolean {
  if (!message) return false;
  const m = message.toLowerCase();
  return (
    m.includes("does not exist") ||
    m.includes("relation") ||
    m.includes("schema cache") ||
    m.includes("pgrst205")
  );
}

function daysAgoIso(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

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

    const fromDate = daysAgoIso(90);

    const [employeesRes, rosterRes, clockRes, leaveRes, hrCasesRes, warningsRes, payrollChecksRes, trainingRes] = await Promise.all([
      auth.supabase
        .from("employees")
        .select(
          "id,employee_number,first_name,last_name,job_title,default_store_id,active,email,phone,employment_type"
        )
        .eq("company_id", companyId)
        .order("first_name"),
      auth.supabase
        .from("roster_shifts")
        .select(
          "id,shift_date,planned_start,planned_end,role,status,employee_id,store_id"
        )
        .eq("company_id", companyId)
        .gte("shift_date", fromDate)
        .order("planned_start", { ascending: true }),
      auth.supabase
        .from("clock_events")
        .select(
          "id,employee_id,store_id,roster_shift_id,event_type,event_time,source,latitude,longitude,device_info,clock_note"
        )
        .eq("company_id", companyId)
        .order("event_time", { ascending: false }),
      auth.supabase
        .from("leave_requests")
        .select(
          "id,employee_id,leave_type,start_date,end_date,status,manager_feedback,manager_approved_at"
        )
        .eq("company_id", companyId)
        .order("start_date", { ascending: false }),
      auth.supabase
        .from("hr_cases")
        .select("id,employee_id,case_type,status")
        .eq("company_id", companyId)
        .order("id", { ascending: false }),
      auth.supabase
        .from("hr_warnings")
        .select("id,employee_id,severity,status")
        .eq("company_id", companyId)
        .order("created_at", { ascending: false }),
      auth.supabase
        .from("payroll_readiness_checks")
        .select("id,employee_id,check_type,severity,status,metadata")
        .eq("company_id", companyId)
        .order("recorded_at", { ascending: false })
        .limit(800),
      auth.supabase
        .from("employee_training")
        .select("id,employee_id,status")
        .eq("company_id", companyId)
        .order("created_at", { ascending: false }),
    ]);

    const queryError =
      employeesRes.error?.message ||
      rosterRes.error?.message ||
      clockRes.error?.message;
    if (queryError) {
      return NextResponse.json({ ok: false, error: queryError }, { status: 500 });
    }

    const leaveData = leaveRes.error && isMissingTableError(leaveRes.error.message) ? [] : (leaveRes.data || []);
    const hrCasesData = hrCasesRes.error && isMissingTableError(hrCasesRes.error.message) ? [] : (hrCasesRes.data || []);
    const warningsData = warningsRes.error && isMissingTableError(warningsRes.error.message) ? [] : (warningsRes.data || []);
    const payrollChecksData = payrollChecksRes.error && isMissingTableError(payrollChecksRes.error.message) ? [] : (payrollChecksRes.data || []);
    const trainingData = trainingRes.error && isMissingTableError(trainingRes.error.message) ? [] : (trainingRes.data || []);

    const optionalError =
      (!isMissingTableError(leaveRes.error?.message) && leaveRes.error?.message) ||
      (!isMissingTableError(hrCasesRes.error?.message) && hrCasesRes.error?.message) ||
      (!isMissingTableError(warningsRes.error?.message) && warningsRes.error?.message) ||
      (!isMissingTableError(payrollChecksRes.error?.message) && payrollChecksRes.error?.message) ||
      (!isMissingTableError(trainingRes.error?.message) && trainingRes.error?.message);
    if (optionalError) {
      return NextResponse.json({ ok: false, error: optionalError }, { status: 500 });
    }

    const intelligence: WorkforceIntelligenceState = calculateWorkforceIntelligence(
      companyId,
      employeesRes.data || [],
      clockRes.data || [],
      rosterRes.data || [],
      leaveData,
      hrCasesData,
      warningsData,
      payrollChecksData,
      trainingData
    );

    const executive = await computeExecutiveWorkforceIntelligence(auth.supabase, companyId);

    return NextResponse.json({
      ok: true,
      intelligence,
      executive: {
        summary: executive.summary,
        risks: executive.risks,
        recommendations: executive.recommendations,
      },
    });
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : "Workforce intelligence computation failed.";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

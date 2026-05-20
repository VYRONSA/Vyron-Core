import { NextRequest, NextResponse } from "next/server";
import { calculateWorkforceIntelligence } from "@/lib/intelligence-suite";
import type { WorkforceIntelligenceState } from "@/lib/intelligence-suite-types";
import {
  assertCompanyWorkspaceAccess,
  authenticateApiRequest,
} from "@/lib/server-api-auth";

export const runtime = "nodejs";

function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

export async function GET(request: NextRequest) {
  try {
    const auth = await authenticateApiRequest(request.headers.get("authorization"));
    if (!auth.ok) {
      return NextResponse.json({ ok: false, error: auth.message }, { status: auth.status });
    }

    const companyId = (request.nextUrl.searchParams.get("companyId") || "").trim();
    const access = await assertCompanyWorkspaceAccess(auth.supabase, auth.email, companyId);
    if (!access.ok) {
      return NextResponse.json({ ok: false, error: access.message }, { status: access.status });
    }

    const today = todayIsoDate();

    const [employeesRes, rosterRes, clockRes] = await Promise.all([
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
        .gte("shift_date", today)
        .order("planned_start", { ascending: true }),
      auth.supabase
        .from("clock_events")
        .select(
          "id,employee_id,store_id,roster_shift_id,event_type,event_time,source,latitude,longitude,device_info,clock_note"
        )
        .eq("company_id", companyId)
        .order("event_time", { ascending: false }),
    ]);

    const queryError =
      employeesRes.error?.message || rosterRes.error?.message || clockRes.error?.message;
    if (queryError) {
      return NextResponse.json({ ok: false, error: queryError }, { status: 500 });
    }

    const intelligence: WorkforceIntelligenceState = calculateWorkforceIntelligence(
      companyId,
      employeesRes.data || [],
      clockRes.data || [],
      rosterRes.data || []
    );

    return NextResponse.json({ ok: true, intelligence });
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : "Workforce intelligence computation failed.";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

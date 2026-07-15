import { NextRequest, NextResponse } from "next/server";
import {
  asText,
  assertEmployeeBelongsToCompany,
  parseError,
  requireApiContext,
} from "@/lib/employee-relations-api";

export async function GET(request: NextRequest) {
  try {
    const companyId = request.nextUrl.searchParams.get("companyId");
    const employeeId = asText(request.nextUrl.searchParams.get("employeeId") || "");
    const limit = Math.min(Number(request.nextUrl.searchParams.get("limit") || 50) || 50, 200);

    const context = await requireApiContext(request, companyId);
    if (!context.ok) return NextResponse.json({ error: context.message }, { status: context.status });

    if (!employeeId) return NextResponse.json({ error: "employeeId is required." }, { status: 400 });

    const employeeCheck = await assertEmployeeBelongsToCompany(
      context.ctx.auth.supabase,
      context.ctx.companyId,
      employeeId
    );
    if (!employeeCheck.ok) {
      return NextResponse.json({ error: employeeCheck.message }, { status: employeeCheck.status });
    }

    const { data, error } = await context.ctx.auth.supabase
      .from("discipline_progression_decisions")
      .select("id,trigger_type,previous_stage,recommended_stage,requires_hearing,requires_hr_review,dismissal_recommended,risk_level,confidence_score,reasoning,recommendation_payload,created_by,created_at")
      .eq("company_id", context.ctx.companyId)
      .eq("employee_id", employeeId)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (error) {
      return NextResponse.json({ error: "Could not load discipline history." }, { status: 500 });
    }

    return NextResponse.json({ ok: true, history: data || [] });
  } catch (error: unknown) {
    return NextResponse.json({ error: parseError(error) }, { status: 500 });
  }
}

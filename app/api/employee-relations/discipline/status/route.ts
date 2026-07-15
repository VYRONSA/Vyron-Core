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
      .from("discipline_progressions")
      .select("id,current_stage,status,stage_reason,risk_score,last_evaluated_at,last_recommendation_payload,updated_at")
      .eq("company_id", context.ctx.companyId)
      .eq("employee_id", employeeId)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      return NextResponse.json({ error: "Could not load discipline status." }, { status: 500 });
    }

    return NextResponse.json({ ok: true, status: data || null });
  } catch (error: unknown) {
    return NextResponse.json({ error: parseError(error) }, { status: 500 });
  }
}

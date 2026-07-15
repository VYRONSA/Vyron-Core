import { NextRequest, NextResponse } from "next/server";
import {
  asText,
  assertEmployeeBelongsToCompany,
  parseError,
  requireApiContext,
} from "@/lib/employee-relations-api";
import { evaluateDiscipline, loadDisciplineInputs, loadPolicy } from "@/lib/progressive-discipline-engine";

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

    const [policy, inputs] = await Promise.all([
      loadPolicy(context.ctx.auth.supabase, context.ctx.companyId),
      loadDisciplineInputs(context.ctx.auth.supabase, context.ctx.companyId, employeeId),
    ]);

    const recommendation = evaluateDiscipline(
      policy,
      {
        companyId: context.ctx.companyId,
        employeeId,
        evaluationDateIso: asText(request.nextUrl.searchParams.get("evaluationDate") || "") || new Date().toISOString(),
        triggerType: "discipline_recommendation_preview",
      },
      inputs
    );

    return NextResponse.json({ ok: true, recommendation });
  } catch (error: unknown) {
    return NextResponse.json({ error: parseError(error) }, { status: 500 });
  }
}

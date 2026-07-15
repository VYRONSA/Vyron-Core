import { NextRequest, NextResponse } from "next/server";
import { asText, parseError, requireApiContext } from "@/lib/employee-relations-api";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    const companyId = request.nextUrl.searchParams.get("companyId");
    const employeeId = asText(request.nextUrl.searchParams.get("employeeId") || "");
    const generationType = asText(request.nextUrl.searchParams.get("generationType") || "");
    const status = asText(request.nextUrl.searchParams.get("status") || "");
    const limit = Math.min(Number(request.nextUrl.searchParams.get("limit") || 50) || 50, 200);

    const context = await requireApiContext(request, companyId);
    if (!context.ok) {
      return NextResponse.json({ error: context.message }, { status: context.status });
    }

    let query = context.ctx.auth.supabase
      .from("ai_document_generations")
      .select(
        "id,company_id,employee_id,hr_case_id,hearing_case_id,document_type,document_version,prompt_key,prompt_version,model_name,model_version,confidence_score,generation_status,finalised,saved_source_table,saved_document_id,save_version,created_by,created_at,reviewed_by,reviewed_at,finalised_at"
      )
      .eq("company_id", context.ctx.companyId)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (employeeId) query = query.eq("employee_id", employeeId);
    if (generationType) query = query.eq("document_type", generationType);
    if (status) query = query.eq("generation_status", status);

    const { data, error } = await query;
    if (error) {
      return NextResponse.json({ error: "Could not list AI document generations." }, { status: 500 });
    }

    return NextResponse.json({ ok: true, generations: data || [] });
  } catch (error: unknown) {
    return NextResponse.json({ error: parseError(error) }, { status: 500 });
  }
}

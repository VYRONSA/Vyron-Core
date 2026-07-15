import { NextRequest, NextResponse } from "next/server";
import { requireApiContext, parseError, asText } from "@/lib/employee-relations-api";

export async function GET(request: NextRequest) {
  try {
    const companyId = request.nextUrl.searchParams.get("companyId");
    const employeeId = asText(request.nextUrl.searchParams.get("employeeId") || "");
    const templateId = asText(request.nextUrl.searchParams.get("templateId") || "");
    const limit = Math.min(Number(request.nextUrl.searchParams.get("limit") || 50) || 50, 200);

    const context = await requireApiContext(request, companyId);
    if (!context.ok) return NextResponse.json({ error: context.message }, { status: context.status });

    let query = context.ctx.auth.supabase
      .from("employee_generated_documents")
      .select(
        "id,company_id,employee_id,template_id,template_version_id,template_version_number,merge_job_id,document_type,document_title,file_bucket,file_path,signature_status,generated_at,generated_by,amendment_root_document_id,amendment_of_document_id,immutable_lock,created_at"
      )
      .eq("company_id", context.ctx.companyId)
      .order("generated_at", { ascending: false })
      .limit(limit);

    if (employeeId) query = query.eq("employee_id", employeeId);
    if (templateId) query = query.eq("template_id", templateId);

    const { data, error } = await query;

    if (error) {
      return NextResponse.json({ error: "Could not list generated contracts." }, { status: 500 });
    }

    return NextResponse.json({ ok: true, contracts: data || [] });
  } catch (error: unknown) {
    return NextResponse.json({ error: parseError(error) }, { status: 500 });
  }
}

import { NextRequest, NextResponse } from "next/server";
import { requireApiContext, parseError, asText } from "@/lib/employee-relations-api";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ documentId: string }> }
) {
  try {
    const { documentId } = await params;
    const companyId = asText(request.nextUrl.searchParams.get("companyId") || "");

    const context = await requireApiContext(request, companyId);
    if (!context.ok) return NextResponse.json({ error: context.message }, { status: context.status });

    const { data: contract, error: contractError } = await context.ctx.auth.supabase
      .from("employee_generated_documents")
      .select(
        "id,company_id,employee_id,template_id,template_version_id,template_version_number,merge_job_id,document_type,document_title,filled_values,merge_values_json,merge_snapshot_json,file_bucket,file_path,signature_status,generated_at,generated_by,amendment_root_document_id,amendment_of_document_id,immutable_lock,created_at"
      )
      .eq("id", documentId)
      .eq("company_id", context.ctx.companyId)
      .maybeSingle();

    if (contractError) {
      return NextResponse.json({ error: "Could not load generated contract metadata." }, { status: 500 });
    }

    if (!contract) {
      return NextResponse.json({ error: "Generated contract not found." }, { status: 404 });
    }

    const { data: audit, error: auditError } = await context.ctx.auth.supabase
      .from("employee_document_audit_history")
      .select("id,event_type,event_details,actor,created_at")
      .eq("company_id", context.ctx.companyId)
      .eq("source_table", "employee_generated_documents")
      .eq("source_document_id", documentId)
      .order("created_at", { ascending: false })
      .limit(50);

    if (auditError) {
      return NextResponse.json({ error: "Could not load contract audit history." }, { status: 500 });
    }

    return NextResponse.json({
      ok: true,
      contract,
      auditHistory: audit || [],
    });
  } catch (error: unknown) {
    return NextResponse.json({ error: parseError(error) }, { status: 500 });
  }
}

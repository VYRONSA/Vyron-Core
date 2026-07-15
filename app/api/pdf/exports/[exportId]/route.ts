import { NextRequest, NextResponse } from "next/server";
import { asText, parseError, requireApiContext } from "@/lib/employee-relations-api";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ exportId: string }> }
) {
  try {
    const { exportId } = await params;
    const companyId = asText(request.nextUrl.searchParams.get("companyId") || "");

    const context = await requireApiContext(request, companyId);
    if (!context.ok) {
      return NextResponse.json({ error: context.message }, { status: context.status });
    }

    const { data, error } = await context.ctx.auth.supabase
      .from("hr_packet_exports")
      .select(
        "id,company_id,employee_id,hr_case_id,hearing_case_id,packet_type,export_kind,export_status,file_bucket,file_path,documents_included,generated_by,generated_at,page_count,pdf_file_size_bytes,packet_reference,metadata,created_at,completed_at"
      )
      .eq("id", exportId)
      .eq("company_id", context.ctx.companyId)
      .maybeSingle();

    if (error) {
      return NextResponse.json({ error: "Could not load export metadata." }, { status: 500 });
    }

    if (!data) {
      return NextResponse.json({ error: "Export record not found." }, { status: 404 });
    }

    return NextResponse.json({ ok: true, export: data });
  } catch (error: unknown) {
    return NextResponse.json({ error: parseError(error) }, { status: 500 });
  }
}

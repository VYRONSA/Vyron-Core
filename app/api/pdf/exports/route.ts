import { NextRequest, NextResponse } from "next/server";
import { asText, parseError, requireApiContext } from "@/lib/employee-relations-api";

export async function GET(request: NextRequest) {
  try {
    const companyId = asText(request.nextUrl.searchParams.get("companyId") || "");
    const employeeId = asText(request.nextUrl.searchParams.get("employeeId") || "");
    const packetType = asText(request.nextUrl.searchParams.get("packetType") || "");
    const status = asText(request.nextUrl.searchParams.get("status") || "");
    const limit = Math.min(Number(request.nextUrl.searchParams.get("limit") || 200) || 200, 500);

    const context = await requireApiContext(request, companyId);
    if (!context.ok) {
      return NextResponse.json({ error: context.message }, { status: context.status });
    }

    let query = context.ctx.auth.supabase
      .from("hr_packet_exports")
      .select(
        "id,employee_id,packet_type,export_kind,export_status,file_bucket,file_path,documents_included,generated_by,generated_at,page_count,pdf_file_size_bytes,packet_reference,metadata,created_at"
      )
      .eq("company_id", context.ctx.companyId)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (employeeId) query = query.eq("employee_id", employeeId);
    if (packetType) query = query.eq("packet_type", packetType);
    if (status) query = query.eq("export_status", status);

    const { data, error } = await query;
    if (error) {
      return NextResponse.json({ error: "Could not load export history." }, { status: 500 });
    }

    return NextResponse.json({ ok: true, exports: data || [] });
  } catch (error: unknown) {
    return NextResponse.json({ error: parseError(error) }, { status: 500 });
  }
}

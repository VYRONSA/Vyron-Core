import { NextRequest, NextResponse } from "next/server";
import { asText, parseError, requireApiContext } from "@/lib/employee-relations-api";

export async function GET(request: NextRequest) {
  try {
    const companyId = asText(request.nextUrl.searchParams.get("companyId") || "");
    const queryText = asText(request.nextUrl.searchParams.get("q") || "");
    const classification = asText(request.nextUrl.searchParams.get("classification") || "");
    const sourceTable = asText(request.nextUrl.searchParams.get("sourceTable") || "");
    const limit = Math.min(Number(request.nextUrl.searchParams.get("limit") || 100) || 100, 300);

    const context = await requireApiContext(request, companyId);
    if (!context.ok) return NextResponse.json({ error: context.message }, { status: context.status });

    let employeeDocs = context.ctx.auth.supabase
      .from("employee_documents")
      .select(
        "id,employee_id,document_type,document_title,document_notes,file_name,status,document_classification,created_at,version_number"
      )
      .eq("company_id", context.ctx.companyId)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (classification) employeeDocs = employeeDocs.eq("document_classification", classification);

    let generatedDocs = context.ctx.auth.supabase
      .from("employee_generated_documents")
      .select("id,employee_id,document_type,document_title,generated_at,template_version_number,archived")
      .eq("company_id", context.ctx.companyId)
      .order("generated_at", { ascending: false })
      .limit(limit);

    const [employeeRes, generatedRes] = await Promise.all([employeeDocs, generatedDocs]);

    if (employeeRes.error) {
      return NextResponse.json({ error: "Could not search employee documents." }, { status: 500 });
    }
    if (generatedRes.error) {
      return NextResponse.json({ error: "Could not search generated documents." }, { status: 500 });
    }

    const employeeRows = (employeeRes.data || []).map((row: any) => ({
      source_table: "employee_documents",
      source_document_id: row.id,
      ...row,
    }));

    const generatedRows = (generatedRes.data || []).map((row: any) => ({
      source_table: "employee_generated_documents",
      source_document_id: row.id,
      document_classification: "employment_contract",
      status: row.archived ? "archived" : "active",
      version_number: row.template_version_number,
      created_at: row.generated_at,
      ...row,
    }));

    let allRows = [...employeeRows, ...generatedRows];

    if (sourceTable) {
      allRows = allRows.filter((row) => String(row.source_table) === sourceTable);
    }

    if (queryText) {
      const q = queryText.toLowerCase();
      allRows = allRows.filter((row) =>
        [row.document_title, row.document_type, row.file_name, row.document_notes, row.employee_id]
          .filter(Boolean)
          .some((value) => String(value).toLowerCase().includes(q))
      );
    }

    return NextResponse.json({ ok: true, results: allRows.slice(0, limit) });
  } catch (error: unknown) {
    return NextResponse.json({ error: parseError(error) }, { status: 500 });
  }
}

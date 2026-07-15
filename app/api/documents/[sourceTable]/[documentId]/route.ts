import { NextRequest, NextResponse } from "next/server";
import { asText, parseError, requireApiContext } from "@/lib/employee-relations-api";
import {
  getDocumentHistory,
  parseSourceTable,
} from "@/lib/employee-document-centre";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ sourceTable: string; documentId: string }> }
) {
  try {
    const { sourceTable, documentId } = await params;
    const companyId = asText(request.nextUrl.searchParams.get("companyId") || "");

    const context = await requireApiContext(request, companyId);
    if (!context.ok) return NextResponse.json({ error: context.message }, { status: context.status });

    const source = parseSourceTable(sourceTable);

    if (source === "employee_documents") {
      const { data, error } = await context.ctx.auth.supabase
        .from("employee_documents")
        .select(
          "id,company_id,employee_id,document_type,document_title,document_notes,file_name,file_bucket,file_path,file_mime_type,file_size_bytes,status,version_number,document_classification,metadata_json,created_at,archived_at"
        )
        .eq("id", documentId)
        .eq("company_id", context.ctx.companyId)
        .maybeSingle();

      if (error) return NextResponse.json({ error: "Could not load employee document metadata." }, { status: 500 });
      if (!data) return NextResponse.json({ error: "Document not found." }, { status: 404 });

      return NextResponse.json({ ok: true, document: data });
    }

    const { data, error } = await context.ctx.auth.supabase
      .from("employee_generated_documents")
      .select(
        "id,company_id,employee_id,document_type,document_title,template_id,template_version_id,template_version_number,file_bucket,file_path,signature_status,generated_at,generated_by,merge_snapshot_json,merge_values_json,immutable_lock,archived"
      )
      .eq("id", documentId)
      .eq("company_id", context.ctx.companyId)
      .maybeSingle();

    if (error) return NextResponse.json({ error: "Could not load generated document metadata." }, { status: 500 });
    if (!data) return NextResponse.json({ error: "Document not found." }, { status: 404 });

    return NextResponse.json({ ok: true, document: data });
  } catch (error: unknown) {
    return NextResponse.json({ error: parseError(error) }, { status: 500 });
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ sourceTable: string; documentId: string }> }
) {
  try {
    const { sourceTable, documentId } = await params;
    const body = await request.json();

    const companyId = asText(body.companyId);
    const context = await requireApiContext(request, companyId);
    if (!context.ok) return NextResponse.json({ error: context.message }, { status: context.status });

    const source = parseSourceTable(sourceTable);

    const history = await getDocumentHistory(context.ctx.auth.supabase, {
      companyId: context.ctx.companyId,
      sourceTable: source,
      sourceDocumentId: documentId,
    });

    return NextResponse.json({ ok: true, ...history });
  } catch (error: unknown) {
    return NextResponse.json({ error: parseError(error) }, { status: 500 });
  }
}

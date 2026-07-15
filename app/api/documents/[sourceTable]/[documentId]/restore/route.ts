import { NextRequest, NextResponse } from "next/server";
import {
  asText,
  parseError,
  requireApiContext,
  safeAudit,
} from "@/lib/employee-relations-api";
import { parseSourceTable, restoreDocument } from "@/lib/employee-document-centre";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ sourceTable: string; documentId: string }> }
) {
  try {
    const { sourceTable, documentId } = await params;
    const body = await request.json();

    const context = await requireApiContext(request, body.companyId);
    if (!context.ok) return NextResponse.json({ error: context.message }, { status: context.status });

    const employeeId = asText(body.employeeId);
    if (!employeeId) {
      return NextResponse.json({ error: "employeeId is required." }, { status: 400 });
    }

    const source = parseSourceTable(sourceTable);

    await restoreDocument(context.ctx.auth.supabase, {
      companyId: context.ctx.companyId,
      employeeId,
      sourceTable: source,
      sourceDocumentId: documentId,
      actor: context.ctx.auth.email,
    });

    await safeAudit(context.ctx.auth.supabase, {
      companyId: context.ctx.companyId,
      email: context.ctx.auth.email,
      action: "restore",
      entityType: "employee_document",
      entityId: documentId,
      metadata: {
        sourceTable: source,
      },
    });

    return NextResponse.json({ ok: true, status: "restored" });
  } catch (error: unknown) {
    return NextResponse.json({ error: parseError(error) }, { status: 500 });
  }
}

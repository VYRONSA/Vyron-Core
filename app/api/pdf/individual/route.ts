import { NextRequest, NextResponse } from "next/server";
import {
  asText,
  assertEmployeeBelongsToCompany,
  parseError,
  requireApiContext,
  safeAudit,
} from "@/lib/employee-relations-api";
import { generateIndividualDocumentPdf } from "@/lib/hr-pdf-service";
import { parseSourceTable } from "@/lib/employee-document-centre";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    const context = await requireApiContext(request, body.companyId);
    if (!context.ok) {
      return NextResponse.json({ error: context.message }, { status: context.status });
    }

    const employeeId = asText(body.employeeId);
    const sourceTable = parseSourceTable(body.sourceTable);
    const sourceDocumentId = asText(body.sourceDocumentId);

    if (!employeeId || !sourceDocumentId) {
      return NextResponse.json(
        { error: "employeeId and sourceDocumentId are required." },
        { status: 400 }
      );
    }

    const employeeCheck = await assertEmployeeBelongsToCompany(
      context.ctx.auth.supabase,
      context.ctx.companyId,
      employeeId
    );
    if (!employeeCheck.ok) {
      return NextResponse.json({ error: employeeCheck.message }, { status: employeeCheck.status });
    }

    const exported = await generateIndividualDocumentPdf(context.ctx.auth.supabase, {
      companyId: context.ctx.companyId,
      employeeId,
      sourceTable,
      sourceDocumentId,
      generatedBy: context.ctx.auth.email,
    });

    await safeAudit(context.ctx.auth.supabase, {
      companyId: context.ctx.companyId,
      email: context.ctx.auth.email,
      action: "create",
      entityType: "pdf_export",
      entityId: exported.exportId,
      metadata: {
        kind: "individual_document",
        sourceTable,
        sourceDocumentId,
        employeeId,
      },
    });

    return NextResponse.json({
      ok: true,
      exportId: exported.exportId,
      packet: {
        fileBucket: exported.bucket,
        filePath: exported.path,
        pageCount: exported.pageCount,
      },
    });
  } catch (error: unknown) {
    return NextResponse.json({ error: parseError(error) }, { status: 500 });
  }
}

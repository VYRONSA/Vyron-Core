import { NextRequest, NextResponse } from "next/server";
import {
  asText,
  assertEmployeeBelongsToCompany,
  parseError,
  requireApiContext,
  safeAudit,
} from "@/lib/employee-relations-api";
import {
  createEmployeeDocument,
  listEmployeeDocuments,
} from "@/lib/employee-document-centre";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    const companyId = asText(request.nextUrl.searchParams.get("companyId") || "");
    const employeeId = asText(request.nextUrl.searchParams.get("employeeId") || "");
    const limit = Math.min(Number(request.nextUrl.searchParams.get("limit") || 100) || 100, 300);

    const context = await requireApiContext(request, companyId);
    if (!context.ok) return NextResponse.json({ error: context.message }, { status: context.status });

    if (employeeId) {
      const employeeCheck = await assertEmployeeBelongsToCompany(
        context.ctx.auth.supabase,
        context.ctx.companyId,
        employeeId
      );
      if (!employeeCheck.ok) {
        return NextResponse.json({ error: employeeCheck.message }, { status: employeeCheck.status });
      }
    }

    const documents = await listEmployeeDocuments(context.ctx.auth.supabase, {
      companyId: context.ctx.companyId,
      employeeId: employeeId || undefined,
      limit,
    });

    return NextResponse.json({ ok: true, documents });
  } catch (error: unknown) {
    return NextResponse.json({ error: parseError(error) }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const form = await request.formData();

    const companyId = asText(form.get("companyId"));
    const employeeId = asText(form.get("employeeId"));
    const employeeName = asText(form.get("employeeName"));
    const documentType = asText(form.get("documentType")) || "hr_document";
    const documentTitle = asText(form.get("documentTitle")) || "Employee document";
    const documentNotes = asText(form.get("documentNotes")) || null;
    const classification = asText(form.get("classification")) || "hr_document";
    const file = form.get("file");

    const context = await requireApiContext(request, companyId);
    if (!context.ok) return NextResponse.json({ error: context.message }, { status: context.status });

    if (!employeeId) {
      return NextResponse.json({ error: "employeeId is required." }, { status: 400 });
    }

    if (!(file instanceof File)) {
      return NextResponse.json({ error: "Document file is required." }, { status: 400 });
    }

    const employeeCheck = await assertEmployeeBelongsToCompany(
      context.ctx.auth.supabase,
      context.ctx.companyId,
      employeeId
    );
    if (!employeeCheck.ok) {
      return NextResponse.json({ error: employeeCheck.message }, { status: employeeCheck.status });
    }

    const created = await createEmployeeDocument(context.ctx.auth.supabase, {
      companyId: context.ctx.companyId,
      employeeId,
      employeeName,
      documentType,
      documentTitle,
      documentNotes,
      classification,
      fileName: file.name,
      mimeType: file.type || null,
      fileBuffer: Buffer.from(await file.arrayBuffer()),
      actor: context.ctx.auth.email,
      metadata: {
        uploadChannel: "documents_api",
      },
    });

    await safeAudit(context.ctx.auth.supabase, {
      companyId: context.ctx.companyId,
      email: context.ctx.auth.email,
      action: "create",
      entityType: "employee_document",
      entityId: created.documentId,
      metadata: {
        employeeId,
        versionId: created.versionId,
        classification,
      },
    });

    return NextResponse.json({ ok: true, ...created });
  } catch (error: unknown) {
    return NextResponse.json({ error: parseError(error) }, { status: 500 });
  }
}

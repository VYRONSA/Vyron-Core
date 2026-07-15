import { NextRequest, NextResponse } from "next/server";
import {
  asText,
  assertEmployeeBelongsToCompany,
  parseError,
  requireApiContext,
  safeAudit,
} from "@/lib/employee-relations-api";
import { generatePacketPdf } from "@/lib/hr-pdf-service";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    const context = await requireApiContext(request, body.companyId);
    if (!context.ok) {
      return NextResponse.json({ error: context.message }, { status: context.status });
    }

    const employeeId = asText(body.employeeId);
    if (!employeeId) {
      return NextResponse.json({ error: "employeeId is required." }, { status: 400 });
    }

    const employeeCheck = await assertEmployeeBelongsToCompany(
      context.ctx.auth.supabase,
      context.ctx.companyId,
      employeeId
    );
    if (!employeeCheck.ok) {
      return NextResponse.json({ error: employeeCheck.message }, { status: employeeCheck.status });
    }

    const exported = await generatePacketPdf(context.ctx.auth.supabase, {
      companyId: context.ctx.companyId,
      employeeId,
      packetType: "hearing_packet",
      generatedBy: context.ctx.auth.email,
      hrCaseId: asText(body.hrCaseId) || null,
      hearingCaseId: asText(body.hearingCaseId) || null,
    });

    await safeAudit(context.ctx.auth.supabase, {
      companyId: context.ctx.companyId,
      email: context.ctx.auth.email,
      action: "create",
      entityType: "hr_packet_export",
      entityId: exported.exportId,
      metadata: {
        packetType: "hearing_packet",
        employeeId,
        pageCount: exported.pageCount,
      },
    });

    return NextResponse.json({
      ok: true,
      exportId: exported.exportId,
      packet: {
        fileBucket: exported.bucket,
        filePath: exported.path,
        pageCount: exported.pageCount,
        documentsIncluded: exported.documentsIncluded,
      },
    });
  } catch (error: unknown) {
    return NextResponse.json({ error: parseError(error) }, { status: 500 });
  }
}

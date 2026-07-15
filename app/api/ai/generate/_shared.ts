import { NextRequest, NextResponse } from "next/server";
import {
  asText,
  assertEmployeeBelongsToCompany,
  parseError,
  requireApiContext,
} from "@/lib/employee-relations-api";
import {
  generateEmployeeRelationsAiDocument,
  type AiGenerationType,
} from "@/lib/employee-relations-ai";

export async function handleGenerateRequest(
  request: NextRequest,
  generationType: AiGenerationType
) {
  try {
    const body = await request.json();
    const context = await requireApiContext(request, body.companyId);
    if (!context.ok) {
      return NextResponse.json({ error: context.message }, { status: context.status });
    }

    const employeeId = asText(body.employeeId);
    const hrCaseId = asText(body.hrCaseId) || null;
    const hearingCaseId = asText(body.hearingCaseId) || null;
    const additionalInstructions = asText(body.additionalInstructions) || null;
    const requestedDocumentType = asText(body.documentType || body.hrDocumentType || "").toLowerCase();

    let resolvedType: AiGenerationType = generationType;
    if (generationType === "hr_document" && requestedDocumentType) {
      const docTypeMap: Record<string, AiGenerationType> = {
        verbal_warning: "verbal_warning",
        written_warning: "written_warning",
        final_written_warning: "final_written_warning",
        counselling_record: "counselling_record",
        investigation_report: "investigation_report",
        hearing_notice: "hearing_notice",
        suspension_letter: "suspension_letter",
        hearing_outcome: "hearing_outcome",
        appeal_outcome: "appeal_outcome",
        dismissal_recommendation: "dismissal_recommendation",
      };

      const mappedType = docTypeMap[requestedDocumentType];
      if (mappedType) resolvedType = mappedType;
    }

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

    const generation = await generateEmployeeRelationsAiDocument(context.ctx.auth.supabase, {
      companyId: context.ctx.companyId,
      employeeId,
      hrCaseId,
      hearingCaseId,
      generationType: resolvedType,
      additionalInstructions,
      actorEmail: context.ctx.auth.email,
    });

    return NextResponse.json({
      ok: true,
      generationType: resolvedType,
      generation,
    });
  } catch (error: unknown) {
    return NextResponse.json({ error: parseError(error) }, { status: 500 });
  }
}

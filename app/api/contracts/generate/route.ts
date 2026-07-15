import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import {
  asText,
  assertEmployeeBelongsToCompany,
  parseError,
  requireApiContext,
  safeAudit,
} from "@/lib/employee-relations-api";
import {
  CONTRACT_DOCX_MIME,
  CONTRACT_OUTPUT_BUCKET,
  assertTemplateOwnershipById,
  buildDefaultMergeValues,
  cleanFileName,
  contractOutputPath,
  extractDocxPlaceholders,
  fetchEmployeeAndCompanyData,
  loadContractPlaceholderRegistry,
  renderDocxTemplate,
  resolveTemplateVersion,
  validateMergeInput,
} from "@/lib/contract-intelligence";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const context = await requireApiContext(request, body.companyId);
    if (!context.ok) return NextResponse.json({ error: context.message }, { status: context.status });

    const employeeId = asText(body.employeeId);
    const templateId = asText(body.templateId);
    const templateVersionId = asText(body.templateVersionId) || null;
    const outputTitle = asText(body.outputTitle) || "employment-contract";
    const amendmentOfDocumentId = asText(body.amendmentOfDocumentId) || null;

    if (!employeeId || !templateId) {
      return NextResponse.json({ error: "employeeId and templateId are required." }, { status: 400 });
    }

    const employeeCheck = await assertEmployeeBelongsToCompany(
      context.ctx.auth.supabase,
      context.ctx.companyId,
      employeeId
    );
    if (!employeeCheck.ok) {
      return NextResponse.json({ error: employeeCheck.message }, { status: employeeCheck.status });
    }

    const template = await assertTemplateOwnershipById(context.ctx.auth.supabase, context.ctx.companyId, templateId);
    const version = await resolveTemplateVersion(
      context.ctx.auth.supabase,
      context.ctx.companyId,
      templateId,
      templateVersionId
    );

    const { data: templateBlob, error: downloadError } = await context.ctx.auth.supabase.storage
      .from(String(version.file_bucket || ""))
      .download(String(version.file_path || ""));

    if (downloadError || !templateBlob) {
      return NextResponse.json({ error: "Could not load template file for contract generation." }, { status: 500 });
    }

    const templateBuffer = Buffer.from(await templateBlob.arrayBuffer());
    const placeholders = extractDocxPlaceholders(templateBuffer);

    const registry = await loadContractPlaceholderRegistry(context.ctx.auth.supabase, context.ctx.companyId);
    const records = await fetchEmployeeAndCompanyData(context.ctx.auth.supabase, context.ctx.companyId, employeeId);

    const defaults = buildDefaultMergeValues(records.employee, records.company);
    const validation = validateMergeInput({
      placeholdersInTemplate: placeholders,
      registry,
      defaultValues: defaults,
      inputValues: (body.values || {}) as Record<string, unknown>,
    });

    if (!validation.ok) {
      return NextResponse.json(
        {
          error: "Merge validation failed.",
          validation,
        },
        { status: 400 }
      );
    }

    const mergeInputSnapshot = {
      templateId,
      templateVersionId: version.id,
      templateVersionNumber: version.version_number,
      validation,
      generatedBy: context.ctx.auth.email,
      generatedAt: new Date().toISOString(),
    };

    const { data: mergeJob, error: mergeJobError } = await context.ctx.auth.supabase
      .from("contract_merge_jobs")
      .insert({
        company_id: context.ctx.companyId,
        employee_id: employeeId,
        template_id: templateId,
        template_version_id: version.id,
        merge_status: "processing",
        merge_input_snapshot: mergeInputSnapshot,
        started_at: new Date().toISOString(),
        created_by: context.ctx.auth.email,
      })
      .select("id")
      .single();

    if (mergeJobError || !mergeJob) {
      return NextResponse.json({ error: "Could not create merge job." }, { status: 500 });
    }

    const markMergeJobFailed = async (message: string) => {
      await context.ctx.auth.supabase
        .from("contract_merge_jobs")
        .update({
          merge_status: "failed",
          error_message: message,
          completed_at: new Date().toISOString(),
        })
        .eq("id", mergeJob.id)
        .eq("company_id", context.ctx.companyId);
    };

    try {

    const renderedBuffer = await renderDocxTemplate(templateBuffer, validation.mergeValues);

    const documentId = randomUUID();
    let amendmentRootDocumentId: string = documentId;
    let templateVersionNumber = 1;

    if (amendmentOfDocumentId) {
      const { data: amendmentParent, error: amendmentError } = await context.ctx.auth.supabase
        .from("employee_generated_documents")
        .select("id,amendment_root_document_id")
        .eq("id", amendmentOfDocumentId)
        .eq("company_id", context.ctx.companyId)
        .eq("employee_id", employeeId)
        .maybeSingle();

      if (amendmentError || !amendmentParent) {
        await markMergeJobFailed("Amendment parent contract not found.");
        return NextResponse.json({ error: "Amendment parent contract not found." }, { status: 404 });
      }

      amendmentRootDocumentId = String(amendmentParent.amendment_root_document_id || amendmentParent.id);

      const { data: latestVersionDoc, error: latestVersionError } = await context.ctx.auth.supabase
        .from("employee_generated_documents")
        .select("template_version_number")
        .eq("company_id", context.ctx.companyId)
        .eq("employee_id", employeeId)
        .eq("template_id", templateId)
        .eq("amendment_root_document_id", amendmentRootDocumentId)
        .order("template_version_number", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (latestVersionError) {
        await markMergeJobFailed("Could not calculate amendment version number.");
        return NextResponse.json({ error: "Could not calculate amendment version number." }, { status: 500 });
      }

      templateVersionNumber = Number(latestVersionDoc?.template_version_number || 0) + 1;
    }

    const outputPath = contractOutputPath(
      context.ctx.companyId,
      employeeId,
      templateId,
      `${outputTitle}-${templateVersionNumber}`
    );

    const { error: uploadError } = await context.ctx.auth.supabase.storage
      .from(CONTRACT_OUTPUT_BUCKET)
      .upload(outputPath, renderedBuffer, {
        contentType: CONTRACT_DOCX_MIME,
        upsert: false,
      });

    if (uploadError) {
      await markMergeJobFailed("Could not save generated contract document.");
      return NextResponse.json({ error: "Could not save generated contract document." }, { status: 500 });
    }

    const documentTitle = `${outputTitle} v${templateVersionNumber}`;

    const { error: documentInsertError } = await context.ctx.auth.supabase
      .from("employee_generated_documents")
      .insert({
        id: documentId,
        company_id: context.ctx.companyId,
        employee_id: employeeId,
        template_id: templateId,
        template_version_id: version.id,
        template_version_number: templateVersionNumber,
        merge_job_id: mergeJob.id,
        document_type: asText(body.documentType) || "employment_contract",
        document_title: documentTitle,
        filled_values: validation.mergeValues,
        merge_values_json: validation.mergeValues,
        merge_snapshot_json: validation.mergeSnapshot,
        generation_context_json: {
          templateVersionId: version.id,
          templateVersionNumber: version.version_number,
        },
        file_bucket: CONTRACT_OUTPUT_BUCKET,
        file_path: outputPath,
        signature_status: "unsigned",
        generated_word_html: "Generated from canonical contract merge service.",
        generated_at: new Date().toISOString(),
        generated_by: context.ctx.auth.email,
        amendment_root_document_id: amendmentRootDocumentId,
        amendment_of_document_id: amendmentOfDocumentId,
        immutable_lock: true,
      });

    if (documentInsertError) {
      await markMergeJobFailed("Could not persist generated contract metadata.");
      return NextResponse.json({ error: "Could not persist generated contract metadata." }, { status: 500 });
    }

    await context.ctx.auth.supabase
      .from("employee_document_audit_history")
      .insert({
        company_id: context.ctx.companyId,
        employee_id: employeeId,
        source_table: "employee_generated_documents",
        source_document_id: documentId,
        event_type: "contract_generated",
        event_details: {
          mergeJobId: mergeJob.id,
          templateId,
          templateVersionId: version.id,
          templateVersionNumber,
          immutable: true,
        },
        actor: context.ctx.auth.email,
      });

    await context.ctx.auth.supabase
      .from("contract_merge_jobs")
      .update({
        merge_status: "completed",
        generated_document_id: documentId,
        merge_output_snapshot: {
          documentId,
          outputBucket: CONTRACT_OUTPUT_BUCKET,
          outputPath,
          outputFileName: `${cleanFileName(documentTitle)}.docx`,
        },
        completed_at: new Date().toISOString(),
      })
      .eq("id", mergeJob.id)
      .eq("company_id", context.ctx.companyId);

    await safeAudit(context.ctx.auth.supabase, {
      companyId: context.ctx.companyId,
      email: context.ctx.auth.email,
      action: "create",
      entityType: "generated_contract",
      entityId: documentId,
      metadata: {
        employeeId,
        templateId,
        templateVersionId: version.id,
        templateVersionNumber,
        amendmentOfDocumentId,
      },
    });

    return NextResponse.json({
      ok: true,
      mergeJobId: mergeJob.id,
      documentId,
      templateVersionId: version.id,
      templateVersionNumber,
      output: {
        bucket: CONTRACT_OUTPUT_BUCKET,
        path: outputPath,
      },
      validation,
    });
    } catch (error: unknown) {
      await markMergeJobFailed(parseError(error));
      throw error;
    }
  } catch (error: unknown) {
    return NextResponse.json({ error: parseError(error) }, { status: 500 });
  }
}

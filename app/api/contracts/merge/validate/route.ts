import { NextRequest, NextResponse } from "next/server";
import {
  asText,
  assertEmployeeBelongsToCompany,
  parseError,
  requireApiContext,
  safeAudit,
} from "@/lib/employee-relations-api";
import {
  assertTemplateOwnershipById,
  buildDefaultMergeValues,
  extractDocxPlaceholders,
  fetchEmployeeAndCompanyData,
  loadContractPlaceholderRegistry,
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

    await assertTemplateOwnershipById(context.ctx.auth.supabase, context.ctx.companyId, templateId);
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
      return NextResponse.json({ error: "Could not load template file for validation." }, { status: 500 });
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

    await safeAudit(context.ctx.auth.supabase, {
      companyId: context.ctx.companyId,
      email: context.ctx.auth.email,
      action: "update",
      entityType: "contract_merge_validation",
      entityId: String(version.id),
      metadata: {
        templateId,
        templateVersionId: version.id,
        employeeId,
        ok: validation.ok,
        missingRequired: validation.missingRequired,
      },
    });

    return NextResponse.json({
      ok: true,
      validation,
      templateVersionId: version.id,
      templateVersionNumber: version.version_number,
    });
  } catch (error: unknown) {
    return NextResponse.json({ error: parseError(error) }, { status: 500 });
  }
}

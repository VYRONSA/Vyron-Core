import { NextRequest, NextResponse } from "next/server";
import { requireApiContext, parseError, safeAudit, asText } from "@/lib/employee-relations-api";
import {
  CONTRACT_DOCX_MIME,
  CONTRACT_TEMPLATE_BUCKET,
  coerceTemplateCategory,
  extractDocxPlaceholders,
  normaliseTemplateKey,
} from "@/lib/contract-intelligence";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const companyId = asText(formData.get("companyId"));
    const context = await requireApiContext(request, companyId);
    if (!context.ok) return NextResponse.json({ error: context.message }, { status: context.status });

    const templateName = asText(formData.get("templateName"));
    const templateCategory = coerceTemplateCategory(formData.get("templateCategory"));
    const description = asText(formData.get("description"));
    const effectiveDate = asText(formData.get("effectiveDate"));
    const status = asText(formData.get("status")) || "active";
    const file = formData.get("file");

    if (!templateName) {
      return NextResponse.json({ error: "templateName is required." }, { status: 400 });
    }

    if (!(file instanceof File)) {
      return NextResponse.json({ error: "DOCX template file is required." }, { status: 400 });
    }

    if (!file.name.toLowerCase().endsWith(".docx")) {
      return NextResponse.json({ error: "Only .docx templates are supported." }, { status: 400 });
    }

    const templateKey = normaliseTemplateKey(templateName, templateCategory);

    const { data: duplicateCheck, error: duplicateError } = await context.ctx.auth.supabase
      .from("contract_templates")
      .select("id")
      .eq("company_id", context.ctx.companyId)
      .eq("template_key", templateKey)
      .limit(1);

    if (duplicateError) {
      return NextResponse.json({ error: "Could not validate template uniqueness." }, { status: 500 });
    }

    if (duplicateCheck && duplicateCheck.length > 0) {
      return NextResponse.json(
        { error: "A template with the same name/category already exists for this company." },
        { status: 409 }
      );
    }

    const templateBuffer = Buffer.from(await file.arrayBuffer());
    const placeholders = extractDocxPlaceholders(templateBuffer);

    const templatePath = `${context.ctx.companyId}/templates/${templateKey}/v1-${Date.now()}.docx`;

    const { error: uploadError } = await context.ctx.auth.supabase.storage
      .from(CONTRACT_TEMPLATE_BUCKET)
      .upload(templatePath, templateBuffer, {
        contentType: CONTRACT_DOCX_MIME,
        upsert: false,
      });

    if (uploadError) {
      return NextResponse.json({ error: "Could not upload template file." }, { status: 500 });
    }

    const { data: createdTemplate, error: templateError } = await context.ctx.auth.supabase
      .from("contract_templates")
      .insert({
        company_id: context.ctx.companyId,
        template_name: templateName,
        template_category: templateCategory,
        template_key: templateKey,
        description: description || null,
        effective_date: effectiveDate || null,
        status,
        archived: false,
        file_bucket: CONTRACT_TEMPLATE_BUCKET,
        file_path: templatePath,
        active_version_number: 1,
        created_by: context.ctx.auth.email,
      })
      .select("id")
      .single();

    if (templateError || !createdTemplate) {
      return NextResponse.json({ error: "Could not create template metadata." }, { status: 500 });
    }

    const { data: createdVersion, error: versionError } = await context.ctx.auth.supabase
      .from("contract_template_versions")
      .insert({
        company_id: context.ctx.companyId,
        template_id: createdTemplate.id,
        version_number: 1,
        file_bucket: CONTRACT_TEMPLATE_BUCKET,
        file_path: templatePath,
        placeholder_schema: { placeholders },
        questionnaire_schema: {},
        change_notes: "Initial upload",
        is_active: true,
        status: "active",
        effective_date: effectiveDate || null,
        created_by: context.ctx.auth.email,
      })
      .select("id")
      .single();

    if (versionError || !createdVersion) {
      return NextResponse.json({ error: "Template created but version record failed." }, { status: 500 });
    }

    await safeAudit(context.ctx.auth.supabase, {
      companyId: context.ctx.companyId,
      email: context.ctx.auth.email,
      action: "create",
      entityType: "contract_template",
      entityId: String(createdTemplate.id),
      metadata: {
        templateVersionId: String(createdVersion.id),
        templateName,
        templateCategory,
      },
    });

    return NextResponse.json({
      ok: true,
      templateId: createdTemplate.id,
      templateVersionId: createdVersion.id,
      placeholders,
    });
  } catch (error: unknown) {
    return NextResponse.json({ error: parseError(error) }, { status: 500 });
  }
}

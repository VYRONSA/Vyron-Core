import { NextRequest, NextResponse } from "next/server";
import {
  assertCompanyWorkspaceAccess,
  authenticateApiRequest,
} from "@/lib/server-api-auth";
import type { SupabaseClient } from "@supabase/supabase-js";
import { writeAuditLog } from "@/lib/audit-log";
import { renderDocxTemplate } from "@/lib/contract-intelligence";

export const runtime = "nodejs";

type RenderRequest = {
  documentTitle?: string;
  templateBucket?: string;
  templatePath?: string;
  values?: Record<string, unknown>;
};

function cleanFileName(value: string) {
  return value
    .trim()
    .replace(/[^a-z0-9]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
}

function normaliseValues(values: Record<string, unknown>) {
  const normalised: Record<string, string> = {};

  Object.entries(values || {}).forEach(([key, value]) => {
    normalised[key] = value === null || value === undefined ? "" : String(value);
  });

  return normalised;
}

async function assertTemplateOwnership(
  supabase: SupabaseClient,
  companyId: string,
  templateBucket: string,
  templatePath: string
): Promise<{ ok: true } | { ok: false; status: number; message: string }> {
  const { data, error } = await supabase
    .from("contract_templates")
    .select("id")
    .eq("company_id", companyId)
    .eq("file_bucket", templateBucket)
    .eq("file_path", templatePath)
    .eq("status", "active")
    .limit(1);

  if (error) {
    return { ok: false, status: 500, message: "Template ownership check failed." };
  }

  if (!data || data.length === 0) {
    return {
      ok: false,
      status: 403,
      message: "Template does not belong to this company workspace.",
    };
  }

  return { ok: true };
}

export async function POST(request: NextRequest) {
  try {
    const auth = await authenticateApiRequest(request);
    if (!auth.ok) {
      return new NextResponse(auth.message, { status: auth.status });
    }

    const body = (await request.json()) as RenderRequest & { companyId?: string };
    const companyId = String(body.companyId || "").trim();

    if (!companyId) {
      return new NextResponse("companyId is required.", { status: 400 });
    }

    const access = await assertCompanyWorkspaceAccess(auth.supabase, auth.email, companyId);
    if (!access.ok) {
      return new NextResponse(access.message, { status: access.status });
    }

    if (!body.templateBucket || !body.templatePath) {
      return new NextResponse("Missing template bucket or path.", { status: 400 });
    }

    const templateAccess = await assertTemplateOwnership(
      auth.supabase,
      companyId,
      body.templateBucket,
      body.templatePath
    );
    if (!templateAccess.ok) {
      return new NextResponse(templateAccess.message, { status: templateAccess.status });
    }

    const { data, error } = await auth.supabase.storage
      .from(body.templateBucket)
      .download(body.templatePath);

    if (error || !data) {
      return new NextResponse("Could not download template.", {
        status: 500,
      });
    }

    const arrayBuffer = await data.arrayBuffer();
    const outputBuffer = await renderDocxTemplate(
      Buffer.from(arrayBuffer),
      normaliseValues(body.values || {})
    );

    const fileName = `${cleanFileName(body.documentTitle || "contract")}.docx`;

    const responseBody = new Blob([outputBuffer as BlobPart], {
      type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    });

    void writeAuditLog(auth.supabase, {
      companyId,
      userEmail: auth.email,
      action: "create",
      entityType: "contract_template_render",
      metadata: {
        templateBucket: body.templateBucket,
      },
    });

    return new NextResponse(responseBody, {
      status: 200,
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "Content-Disposition": `attachment; filename="${fileName}"`,
      },
    });
  } catch (error: any) {
    const message =
      error?.properties?.errors
        ?.map((item: any) => item.properties?.explanation || item.message)
        ?.join("\n") ||
      error?.message ||
      "Could not render DOCX template.";

    return new NextResponse(message, { status: 500 });
  }
}


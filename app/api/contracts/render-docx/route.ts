import { NextRequest, NextResponse } from "next/server";
import PizZip from "pizzip";
import Docxtemplater from "docxtemplater";
import {
  assertCompanyWorkspaceAccess,
  authenticateApiRequest,
} from "@/lib/server-api-auth";

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

export async function POST(request: NextRequest) {
  try {
    const auth = await authenticateApiRequest(request.headers.get("authorization"));
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

    const { data, error } = await auth.supabase.storage
      .from(body.templateBucket)
      .download(body.templatePath);

    if (error || !data) {
      return new NextResponse(error?.message || "Could not download template.", {
        status: 500,
      });
    }

    const arrayBuffer = await data.arrayBuffer();
    const zip = new PizZip(arrayBuffer);

    const doc = new Docxtemplater(zip, {
      paragraphLoop: true,
      linebreaks: true,
      delimiters: {
        start: "{{",
        end: "}}",
      },
    });

    doc.render(normaliseValues(body.values || {}));

    const output = doc.getZip().generate({
      type: "uint8array",
      mimeType:
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      compression: "DEFLATE",
    });

    const fileName = `${cleanFileName(body.documentTitle || "contract")}.docx`;

    const responseBody = new Blob([output as BlobPart], {
      type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
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


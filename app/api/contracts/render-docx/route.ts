import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import PizZip from "pizzip";
import Docxtemplater from "docxtemplater";

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
    const body = (await request.json()) as RenderRequest;

    if (!body.templateBucket || !body.templatePath) {
      return new NextResponse("Missing template bucket or path.", { status: 400 });
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    if (!supabaseUrl || !supabaseAnonKey) {
      return new NextResponse("Missing Supabase environment variables.", { status: 500 });
    }

    const supabase = createClient(supabaseUrl, supabaseAnonKey);

    const { data, error } = await supabase.storage
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

    return new NextResponse(output, {
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

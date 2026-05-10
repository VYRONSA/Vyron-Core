import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import PizZip from "pizzip";
import Docxtemplater from "docxtemplater";

function cleanFileName(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)+/g, "")
    .slice(0, 90);
}

function asStringMap(values: Record<string, unknown>) {
  const output: Record<string, string> = {};

  Object.entries(values || {}).forEach(([key, value]) => {
    output[key] = value === null || value === undefined ? "" : String(value);
  });

  return output;
}

export async function GET() {
  return NextResponse.json({
    ok: true,
    route: "render-contract",
    message: "DOCX render route is available.",
    hasSupabaseUrl: Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL),
    hasSupabaseAnonKey: Boolean(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY),
  });
}

export async function POST(request: Request) {
  try {
    const body = await request.json();

    const documentId = String(body.documentId || "");
    const templateBucket = String(body.templateBucket || "");
    const templatePath = String(body.templatePath || "");
    const outputTitle = String(body.outputTitle || "generated-contract");
    const employeeId = String(body.employeeId || "unknown-employee");
    const values = asStringMap(body.values || {});

    if (!documentId) {
      return NextResponse.json({ error: "documentId is required." }, { status: 400 });
    }

    if (!templateBucket || !templatePath) {
      return NextResponse.json({ error: "Template bucket and path are required." }, { status: 400 });
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    if (!supabaseUrl || !supabaseAnonKey) {
      return NextResponse.json(
        { error: "Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY." },
        { status: 500 }
      );
    }

    const supabase = createClient(supabaseUrl, supabaseAnonKey);

    const { data: templateBlob, error: downloadError } = await supabase.storage
      .from(templateBucket)
      .download(templatePath);

    if (downloadError || !templateBlob) {
      return NextResponse.json(
        {
          error:
            `${downloadError?.message || "Could not download DOCX template."} Bucket: ${templateBucket}. Path: ${templatePath}. This usually means the template database record points to a file that no longer exists in Supabase Storage.`,
        },
        { status: 500 }
      );
    }

    const templateArrayBuffer = await templateBlob.arrayBuffer();
    const zip = new PizZip(templateArrayBuffer);

    const doc = new Docxtemplater(zip, {
      paragraphLoop: true,
      linebreaks: true,
      delimiters: {
        start: "{{",
        end: "}}",
      },
    });

    try {
      doc.render(values);
    } catch (renderError: any) {
      const explanation =
        renderError?.properties?.errors
          ?.map((item: any) => item?.properties?.explanation || item?.message)
          ?.join(" | ") ||
        renderError?.message ||
        "DOCX placeholder rendering failed.";

      return NextResponse.json(
        {
          error: `DOCX render failed. Check placeholders in the Word template. ${explanation}`,
        },
        { status: 400 }
      );
    }

    const renderedBuffer = doc.getZip().generate({
      type: "nodebuffer",
      compression: "DEFLATE",
    });

    const outputPath = `${employeeId}/${documentId}/${Date.now()}-${cleanFileName(outputTitle)}.docx`;

    const { error: uploadError } = await supabase.storage
      .from("hr-signed-documents")
      .upload(outputPath, renderedBuffer, {
        contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        upsert: true,
      });

    if (uploadError) {
      return NextResponse.json({ error: uploadError.message }, { status: 500 });
    }

    const { error: updateError } = await supabase
      .from("employee_generated_documents")
      .update({
        file_bucket: "hr-signed-documents",
        file_path: outputPath,
        generated_word_html:
          "Generated from actual uploaded DOCX template. Download/open the DOCX file for exact layout.",
      })
      .eq("id", documentId);

    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 500 });
    }

    return NextResponse.json({
      ok: true,
      file_bucket: "hr-signed-documents",
      file_path: outputPath,
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || "Unexpected DOCX render error." },
      { status: 500 }
    );
  }
}

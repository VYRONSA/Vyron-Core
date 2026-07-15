import { NextRequest, NextResponse } from "next/server";
import { asText, parseError, requireApiContext } from "@/lib/employee-relations-api";

export const runtime = "nodejs";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ generationId: string }> }
) {
  try {
    const { generationId } = await params;
    const companyId = asText(request.nextUrl.searchParams.get("companyId") || "");

    const context = await requireApiContext(request, companyId);
    if (!context.ok) {
      return NextResponse.json({ error: context.message }, { status: context.status });
    }

    const { data, error } = await context.ctx.auth.supabase
      .from("ai_document_generations")
      .select("*")
      .eq("company_id", context.ctx.companyId)
      .eq("id", generationId)
      .maybeSingle();

    if (error) {
      return NextResponse.json({ error: "Could not load AI generation." }, { status: 500 });
    }

    if (!data) {
      return NextResponse.json({ error: "AI generation not found." }, { status: 404 });
    }

    return NextResponse.json({ ok: true, generation: data });
  } catch (error: unknown) {
    return NextResponse.json({ error: parseError(error) }, { status: 500 });
  }
}

import { NextRequest, NextResponse } from "next/server";
import { asText, parseError, requireApiContext } from "@/lib/employee-relations-api";
import { saveReviewedAiGeneration } from "@/lib/employee-relations-ai";

export const runtime = "nodejs";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ generationId: string }> }
) {
  try {
    const { generationId } = await params;
    const body = await request.json();
    const context = await requireApiContext(request, body.companyId);
    if (!context.ok) {
      return NextResponse.json({ error: context.message }, { status: context.status });
    }

    const editedDocumentBody = asText(body.editedDocumentBody);
    const editedTitle = asText(body.editedTitle) || null;
    const reviewerNotes = asText(body.reviewerNotes) || null;

    if (!editedDocumentBody) {
      return NextResponse.json({ error: "editedDocumentBody is required." }, { status: 400 });
    }

    const saved = await saveReviewedAiGeneration(context.ctx.auth.supabase, {
      companyId: context.ctx.companyId,
      generationId,
      actorEmail: context.ctx.auth.email,
      editedDocumentBody,
      editedTitle,
      reviewerNotes,
    });

    return NextResponse.json({ ok: true, saved });
  } catch (error: unknown) {
    return NextResponse.json({ error: parseError(error) }, { status: 500 });
  }
}

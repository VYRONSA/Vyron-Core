import { NextRequest, NextResponse } from "next/server";
import { computeExecutiveWorkforceIntelligence } from "@/lib/executive-workforce-intelligence";
import { resolveBatch9Context } from "@/app/api/workforce-intelligence/_batch9-shared";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    const context = await resolveBatch9Context(request, request.nextUrl.searchParams.get("companyId"));
    if (!context.ok) return context.response;

    const intelligence = await computeExecutiveWorkforceIntelligence(
      context.ctx.supabase,
      context.ctx.companyId
    );

    return NextResponse.json({ ok: true, summary: intelligence.summary });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Could not compute executive summary.";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

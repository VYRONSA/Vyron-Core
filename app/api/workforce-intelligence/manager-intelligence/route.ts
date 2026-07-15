import { NextRequest, NextResponse } from "next/server";
import { computeExecutiveWorkforceIntelligence } from "@/lib/executive-workforce-intelligence";
import { asPositiveInt, resolveBatch9Context } from "@/app/api/workforce-intelligence/_batch9-shared";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    const context = await resolveBatch9Context(request, request.nextUrl.searchParams.get("companyId"));
    if (!context.ok) return context.response;

    const limit = asPositiveInt(request.nextUrl.searchParams.get("limit"), 100, 500);
    const intelligence = await computeExecutiveWorkforceIntelligence(
      context.ctx.supabase,
      context.ctx.companyId
    );

    return NextResponse.json({ ok: true, managers: intelligence.managers.slice(0, limit) });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Could not compute manager intelligence.";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

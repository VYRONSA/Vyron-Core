import { NextRequest, NextResponse } from "next/server";
import { computeExecutiveBusinessIntelligence } from "@/lib/intelligence/executive-business-intelligence";
import { asText, errorResponse, parseError, requireApiContext } from "@/lib/road-recovery/api";

/**
 * Combined Business Health across every vertical.
 *
 *   Workforce Health + Road & Recovery Health -> Combined Business Health
 *
 * GET-only. A vertical that is not provisioned, or that cannot be scored, is excluded from
 * the combined denominator and reported with the reason — never scored as zero.
 */
export async function GET(request: NextRequest) {
  try {
    const search = request.nextUrl.searchParams;
    const context = await requireApiContext(request, search.get("companyId"));
    if (!context.ok) return errorResponse(context.message, context.status);

    const result = await computeExecutiveBusinessIntelligence(context.ctx.auth.supabase, {
      companyId: context.ctx.companyId,
      roadRecovery: {
        companyId: context.ctx.companyId,
        fromIso: asText(search.get("from")) || null,
        toIso: asText(search.get("to")) || null,
        asOfIso: asText(search.get("asOf")) || null,
      },
    });

    return NextResponse.json(
      { ok: true, executive: result },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error: unknown) {
    return errorResponse(parseError(error), 500);
  }
}

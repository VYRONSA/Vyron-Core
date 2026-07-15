import { NextRequest, NextResponse } from "next/server";
import { computeExecutiveWorkforceIntelligence } from "@/lib/executive-workforce-intelligence";
import {
  asPositiveInt,
  resolveBatch9Context,
} from "@/app/api/workforce-intelligence/_batch9-shared";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    const context = await resolveBatch9Context(request, request.nextUrl.searchParams.get("companyId"));
    if (!context.ok) return context.response;

    const employeeId = String(request.nextUrl.searchParams.get("employeeId") || "").trim();
    const limit = asPositiveInt(request.nextUrl.searchParams.get("limit"), 250, 1000);

    const intelligence = await computeExecutiveWorkforceIntelligence(
      context.ctx.supabase,
      context.ctx.companyId
    );

    const employees = employeeId
      ? intelligence.employees.filter((row) => row.employeeId === employeeId)
      : intelligence.employees.slice(0, limit);

    return NextResponse.json({ ok: true, employees });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Could not compute employee intelligence.";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

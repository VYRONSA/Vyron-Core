import { NextRequest, NextResponse } from "next/server";
import { asText, parseError, requireApiContext } from "@/lib/employee-relations-api";

export async function GET(request: NextRequest) {
  try {
    const companyId = request.nextUrl.searchParams.get("companyId");
    const context = await requireApiContext(request, companyId);
    if (!context.ok) return NextResponse.json({ error: context.message }, { status: context.status });

    const employeeId = asText(request.nextUrl.searchParams.get("employeeId") || "");
    const eventType = asText(request.nextUrl.searchParams.get("eventType") || "");
    const sourceTable = asText(request.nextUrl.searchParams.get("sourceTable") || "");
    const fromDate = asText(request.nextUrl.searchParams.get("fromDate") || "");
    const toDate = asText(request.nextUrl.searchParams.get("toDate") || "");
    const limit = Math.min(Number(request.nextUrl.searchParams.get("limit") || 100) || 100, 500);

    let query = context.ctx.auth.supabase
      .from("employee_relations_timeline_events")
      .select("id,company_id,employee_id,event_type,event_date,source_table,source_id,title,summary,metadata,created_by,created_at")
      .eq("company_id", context.ctx.companyId)
      .order("event_date", { ascending: false })
      .limit(limit);

    if (employeeId) query = query.eq("employee_id", employeeId);
    if (eventType) query = query.eq("event_type", eventType);
    if (sourceTable) query = query.eq("source_table", sourceTable);
    if (fromDate) query = query.gte("event_date", fromDate);
    if (toDate) query = query.lte("event_date", toDate);

    const { data, error } = await query;
    if (error) return NextResponse.json({ error: "Could not load timeline." }, { status: 500 });

    return NextResponse.json({ ok: true, timeline: data || [] });
  } catch (error: unknown) {
    return NextResponse.json({ error: parseError(error) }, { status: 500 });
  }
}

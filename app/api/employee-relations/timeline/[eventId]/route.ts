import { NextRequest, NextResponse } from "next/server";
import { asText, parseError, requireApiContext } from "@/lib/employee-relations-api";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ eventId: string }> }
) {
  try {
    const companyId = request.nextUrl.searchParams.get("companyId");
    const context = await requireApiContext(request, companyId);
    if (!context.ok) return NextResponse.json({ error: context.message }, { status: context.status });

    const eventId = asText((await params).eventId);
    if (!eventId) return NextResponse.json({ error: "eventId is required." }, { status: 400 });

    const { data, error } = await context.ctx.auth.supabase
      .from("employee_relations_timeline_events")
      .select("id,company_id,employee_id,event_type,event_date,source_table,source_id,title,summary,metadata,created_by,created_at")
      .eq("id", eventId)
      .eq("company_id", context.ctx.companyId)
      .maybeSingle();

    if (error) return NextResponse.json({ error: "Could not load timeline event." }, { status: 500 });
    if (!data) return NextResponse.json({ error: "Timeline event not found." }, { status: 404 });

    return NextResponse.json({ ok: true, event: data });
  } catch (error: unknown) {
    return NextResponse.json({ error: parseError(error) }, { status: 500 });
  }
}

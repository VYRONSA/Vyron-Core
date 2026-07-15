import { NextRequest, NextResponse } from "next/server";
import { asText, parseError, requireApiContext } from "@/lib/employee-relations-api";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  try {
    const { sessionId } = await params;
    const companyId = asText(request.nextUrl.searchParams.get("companyId") || "");
    const limit = Math.min(Number(request.nextUrl.searchParams.get("limit") || 100) || 100, 300);

    const context = await requireApiContext(request, companyId);
    if (!context.ok) return NextResponse.json({ error: context.message }, { status: context.status });

    const { data: session, error: sessionError } = await context.ctx.auth.supabase
      .from("signature_sessions")
      .select("id,document_id,signing_link_id")
      .eq("id", sessionId)
      .eq("company_id", context.ctx.companyId)
      .maybeSingle();

    if (sessionError) {
      return NextResponse.json({ error: "Could not load signature session." }, { status: 500 });
    }

    if (!session) {
      return NextResponse.json({ error: "Signature session not found." }, { status: 404 });
    }

    const [eventsRes, signaturesRes] = await Promise.all([
      context.ctx.auth.supabase
        .from("contract_signing_events")
        .select("id,event_type,actor,metadata,created_at")
        .eq("company_id", context.ctx.companyId)
        .eq("document_id", session.document_id)
        .order("created_at", { ascending: false })
        .limit(limit),
      context.ctx.auth.supabase
        .from("digital_signatures")
        .select("id,signer_name,signer_role,signing_method,signature_hash,provider,provider_reference,signed_at")
        .eq("company_id", context.ctx.companyId)
        .eq("signature_session_id", sessionId)
        .order("signed_at", { ascending: false })
        .limit(limit),
    ]);

    if (eventsRes.error) {
      return NextResponse.json({ error: "Could not load signature event history." }, { status: 500 });
    }

    if (signaturesRes.error) {
      return NextResponse.json({ error: "Could not load signature history." }, { status: 500 });
    }

    return NextResponse.json({
      ok: true,
      sessionId,
      eventHistory: eventsRes.data || [],
      signatureHistory: signaturesRes.data || [],
    });
  } catch (error: unknown) {
    return NextResponse.json({ error: parseError(error) }, { status: 500 });
  }
}

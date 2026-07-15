import { NextRequest, NextResponse } from "next/server";
import { asText, parseError, requireApiContext } from "@/lib/employee-relations-api";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  try {
    const { sessionId } = await params;
    const companyId = asText(request.nextUrl.searchParams.get("companyId") || "");

    const context = await requireApiContext(request, companyId);
    if (!context.ok) return NextResponse.json({ error: context.message }, { status: context.status });

    const { data: session, error: sessionError } = await context.ctx.auth.supabase
      .from("signature_sessions")
      .select(
        "id,company_id,employee_id,document_id,source_table,signing_link_id,provider,status,signer_roles,started_by,started_at,completed_at,cancelled_at,cancelled_by,cancellation_reason,metadata"
      )
      .eq("id", sessionId)
      .eq("company_id", context.ctx.companyId)
      .maybeSingle();

    if (sessionError) {
      return NextResponse.json({ error: "Could not load signature session status." }, { status: 500 });
    }

    if (!session) {
      return NextResponse.json({ error: "Signature session not found." }, { status: 404 });
    }

    const [signaturesRes, linkRes] = await Promise.all([
      context.ctx.auth.supabase
        .from("digital_signatures")
        .select(
          "id,signer_name,signer_role,signing_method,signature_hash,signed_at,signature_bucket,signature_path,signed_copy_bucket,signed_copy_path"
        )
        .eq("company_id", context.ctx.companyId)
        .eq("signature_session_id", sessionId)
        .order("signed_at", { ascending: false }),
      session.signing_link_id
        ? context.ctx.auth.supabase
            .from("document_signing_links")
            .select("id,status,expires_at,opened_at,signed_at,revoked_at,revoked_by,cancellation_reason,last_event_at,provider")
            .eq("id", session.signing_link_id)
            .eq("company_id", context.ctx.companyId)
            .maybeSingle()
        : Promise.resolve({ data: null, error: null } as any),
    ]);

    if (signaturesRes.error) {
      return NextResponse.json({ error: "Could not load signature artifacts." }, { status: 500 });
    }

    if (linkRes.error) {
      return NextResponse.json({ error: "Could not load signing link status." }, { status: 500 });
    }

    return NextResponse.json({
      ok: true,
      session,
      signingLink: linkRes.data || null,
      signatures: signaturesRes.data || [],
    });
  } catch (error: unknown) {
    return NextResponse.json({ error: parseError(error) }, { status: 500 });
  }
}

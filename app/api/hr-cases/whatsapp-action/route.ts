import { NextRequest, NextResponse } from "next/server";
import {
  assertCompanyWorkspaceAccess,
  authenticateApiRequest,
  getSupabaseAdminClient,
  getSupabasePublicConfig,
} from "@/lib/server-api-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function normalisePhone(value: string) {
  let phone = String(value || "").replace(/[^\d]/g, "");
  if (phone.startsWith("00")) phone = phone.slice(2);
  if (phone.startsWith("0")) phone = `27${phone.slice(1)}`;
  return phone;
}

async function logMessage(row: Record<string, any>) {
  const { error } = await getSupabaseAdminClient().from("hr_whatsapp_messages").insert(row);
  return error ? error.message : null;
}

export async function GET() {
  const { url } = getSupabasePublicConfig();
  return NextResponse.json({
    ok: true,
    route: "/api/hr-cases/whatsapp-action",
    message: "HR WhatsApp action route is live.",
    hasSupabaseUrl: Boolean(url),
    hasServiceRoleKey: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY),
    hasAnonFallback: Boolean(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY),
    hasWhatsappPhoneNumberId: Boolean(process.env.WHATSAPP_PHONE_NUMBER_ID),
    hasWhatsappAccessToken: Boolean(process.env.WHATSAPP_ACCESS_TOKEN),
    graphVersion: process.env.WHATSAPP_GRAPH_VERSION || "v20.0",
  });
}

export async function POST(request: NextRequest) {
  try {
    const auth = await authenticateApiRequest(request);
    if (!auth.ok) {
      return NextResponse.json({ ok: false, error: auth.message }, { status: auth.status });
    }

    const body = await request.json();

    const hrCaseId = String(body.hrCaseId || "").trim();
    const employeeId = body.employeeId ? String(body.employeeId).trim() : null;
    const employeeName = String(body.employeeName || "Employee").trim() || "Employee";
    const phone = normalisePhone(String(body.phone || ""));
    const feedback = String(body.feedback || "").trim() || "Case reviewed by management.";
    const status = String(body.status || "resolved").trim() || "resolved";

    if (!hrCaseId) {
      return NextResponse.json({ ok: false, error: "Missing hrCaseId." }, { status: 400 });
    }

    if (!phone) {
      return NextResponse.json({ ok: false, error: "Missing employee phone number." }, { status: 400 });
    }

    const { data: hrCase, error: hrCaseError } = await auth.supabase
      .from("hr_cases")
      .select("id,company_id")
      .eq("id", hrCaseId)
      .maybeSingle();

    if (hrCaseError) {
      return NextResponse.json({ ok: false, error: hrCaseError.message }, { status: 500 });
    }

    if (!hrCase?.company_id) {
      return NextResponse.json({ ok: false, error: "HR case not found." }, { status: 404 });
    }

    const access = await assertCompanyWorkspaceAccess(
      auth.supabase,
      auth.email,
      String(hrCase.company_id)
    );
    if (!access.ok) {
      return NextResponse.json({ ok: false, error: access.message }, { status: access.status });
    }

    const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID || "";
    const accessToken = process.env.WHATSAPP_ACCESS_TOKEN || "";
    const graphVersion = process.env.WHATSAPP_GRAPH_VERSION || "v20.0";

    if (!phoneNumberId || !accessToken) {
      return NextResponse.json(
        {
          ok: false,
          error: "Missing WhatsApp environment variables.",
          hasWhatsappPhoneNumberId: Boolean(phoneNumberId),
          hasWhatsappAccessToken: Boolean(accessToken),
        },
        { status: 500 }
      );
    }

    const whatsappBody = `Hi ${employeeName}, ${feedback} Regards, VYRON CORE.`;

    const graphResponse = await fetch(
      `https://graph.facebook.com/${graphVersion}/${phoneNumberId}/messages`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          to: phone,
          type: "text",
          text: {
            body: whatsappBody,
          },
        }),
      }
    );

    const graphData = await graphResponse.json();
    const metaMessageId = graphData?.messages?.[0]?.id || null;

    if (!graphResponse.ok) {
      const logError = await logMessage({
        direction: "outbound",
        phone,
        employee_id: employeeId,
        hr_case_id: hrCaseId,
        employee_name: employeeName,
        message_body: feedback,
        meta_message_id: metaMessageId,
        status: "failed",
        match_status: graphData?.error?.message || "WhatsApp send failed",
        raw_payload: graphData,
      });

      return NextResponse.json(
        {
          ok: false,
          error: graphData?.error?.message || "WhatsApp send failed.",
          details: graphData,
          logError,
        },
        { status: 500 }
      );
    }

    const { error: updateError } = await auth.supabase
      .from("hr_cases")
      .update({
        status,
        manager_feedback: feedback,
        employee_response_required: true,
        validity_status: "waiting_for_employee",
      })
      .eq("id", hrCaseId)
      .eq("company_id", hrCase.company_id);

    const logError = await logMessage({
      direction: "outbound",
      phone,
      employee_id: employeeId,
      hr_case_id: hrCaseId,
      employee_name: employeeName,
      message_body: feedback,
      meta_message_id: metaMessageId,
      status: updateError ? "sent_but_hr_update_failed" : "sent",
      match_status: updateError ? updateError.message : "manager_message_saved",
      raw_payload: graphData,
    });

    if (updateError) {
      return NextResponse.json(
        {
          ok: false,
          sent: true,
          error: `WhatsApp sent, but HR case did not save: ${updateError.message}`,
          messageId: metaMessageId,
          logError,
        },
        { status: 500 }
      );
    }

    if (logError) {
      return NextResponse.json(
        {
          ok: false,
          sent: true,
          savedToHrCase: true,
          error: `WhatsApp and HR case saved, but message log failed: ${logError}`,
          messageId: metaMessageId,
        },
        { status: 500 }
      );
    }

    return NextResponse.json({
      ok: true,
      sent: true,
      savedToHrCase: true,
      savedToLog: true,
      messageId: metaMessageId,
      hrCaseId,
      phone,
    });
  } catch (error: any) {
    return NextResponse.json(
      { ok: false, error: error?.message || "Unknown HR WhatsApp action error." },
      { status: 500 }
    );
  }
}

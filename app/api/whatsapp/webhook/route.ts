import { NextRequest, NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "node:crypto";
import { getSupabaseAdminClient, getSupabasePublicConfig } from "@/lib/server-api-auth";
import {
  parseWhatsAppCommand,
  processWhatsAppWorkforceCommand,
  resolveWhatsAppManager,
  sendWhatsAppWorkforceReply,
} from "@/lib/whatsapp-workforce-command";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VERIFY_TOKEN =
  process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN?.trim() || "";
const WHATSAPP_APP_SECRET = process.env.WHATSAPP_APP_SECRET?.trim() || "";

function normalisePhone(value: string) {
  let phone = String(value || "").replace(/[^\d]/g, "");
  if (phone.startsWith("00")) phone = phone.slice(2);
  if (phone.startsWith("0")) phone = `27${phone.slice(1)}`;
  return phone;
}

function phoneMatches(a: string, b: string) {
  const phoneA = normalisePhone(a);
  const phoneB = normalisePhone(b);

  if (!phoneA || !phoneB) return false;
  if (phoneA === phoneB) return true;

  const lastA = phoneA.slice(-9);
  const lastB = phoneB.slice(-9);

  return lastA.length >= 9 && lastA === lastB;
}

async function logMessage(row: Record<string, any>) {
  const { error } = await getSupabaseAdminClient().from("hr_whatsapp_messages").insert(row);
  return error ? error.message : null;
}

function verifyWebhookSignature(rawBody: string, signatureHeader: string | null): boolean {
  if (!WHATSAPP_APP_SECRET) return false;
  if (!signatureHeader || !signatureHeader.startsWith("sha256=")) return false;

  const expected = createHmac("sha256", WHATSAPP_APP_SECRET).update(rawBody, "utf8").digest("hex");
  const provided = signatureHeader.slice("sha256=".length).trim();

  const expectedBuf = Buffer.from(expected, "hex");
  const providedBuf = Buffer.from(provided, "hex");

  if (expectedBuf.length === 0 || providedBuf.length === 0) return false;
  if (expectedBuf.length !== providedBuf.length) return false;

  return timingSafeEqual(expectedBuf, providedBuf);
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;

  const mode = searchParams.get("hub.mode");
  const token = searchParams.get("hub.verify_token");
  const challenge = searchParams.get("hub.challenge");

  if (!mode && !token && !challenge) {
    const { url } = getSupabasePublicConfig();
    return NextResponse.json({
      ok: true,
      message: "WhatsApp webhook is live.",
      webhookVerifyConfigured: Boolean(VERIFY_TOKEN),
      hasSupabaseUrl: Boolean(url),
    });
  }

  if (VERIFY_TOKEN && mode === "subscribe" && token === VERIFY_TOKEN && challenge) {
    return new NextResponse(challenge, {
      status: 200,
      headers: { "Content-Type": "text/plain" },
    });
  }

  return NextResponse.json(
    {
      ok: false,
      error: "Webhook verification failed.",
    },
    { status: 403 }
  );
}

export async function POST(request: NextRequest) {
  try {
    const signatureHeader = request.headers.get("x-hub-signature-256");
    const rawBody = await request.text();

    if (!verifyWebhookSignature(rawBody, signatureHeader)) {
      return NextResponse.json({ ok: false, error: "Unauthorized request." }, { status: 401 });
    }

    let payload: any;
    try {
      payload = JSON.parse(rawBody);
    } catch {
      return NextResponse.json({ ok: false, error: "Invalid request." }, { status: 400 });
    }

    const value = payload?.entry?.[0]?.changes?.[0]?.value;
    const message = value?.messages?.[0];
    const contact = value?.contacts?.[0];

    if (!message) {
      const logError = await logMessage({
        direction: "inbound",
        status: "ignored",
        match_status: "no_message_in_payload",
        raw_payload: payload,
      });

      return NextResponse.json({ ok: true, ignored: true, reason: "No message.", logError });
    }

    const fromPhone = normalisePhone(message.from || "");
    const textBody = String(message?.text?.body || "").trim();
    const contactName = contact?.profile?.name || null;
    const messageId = message?.id || null;

    if (!fromPhone || !textBody) {
      const logError = await logMessage({
        direction: "inbound",
        phone: fromPhone,
        message_body: textBody || null,
        meta_message_id: messageId,
        status: "ignored",
        match_status: "missing_phone_or_text",
        raw_payload: payload,
      });

      return NextResponse.json({
        ok: true,
        ignored: true,
        reason: "No phone or text body.",
        logError,
      });
    }

    const supabaseAdmin = getSupabaseAdminClient();
    const workforceIntent = parseWhatsAppCommand(textBody);

    if (workforceIntent === "blocked") {
      const blockedReply =
        "That command is not allowed. Destructive and payroll export commands are blocked.";
      await sendWhatsAppWorkforceReply(fromPhone, blockedReply);
      return NextResponse.json({
        ok: false,
        workforceCommand: true,
        blocked: true,
        reply: blockedReply,
      });
    }

    const manager = await resolveWhatsAppManager(supabaseAdmin, fromPhone);
    if (manager && workforceIntent !== "unknown") {
      const commandResult = await processWhatsAppWorkforceCommand(supabaseAdmin, {
        phone: fromPhone,
        messageText: textBody,
        metaMessageId: messageId,
        companyId: manager.companyId,
        managerEmail: manager.managerEmail || undefined,
      });
      const sendResult = await sendWhatsAppWorkforceReply(fromPhone, commandResult.reply);
      return NextResponse.json({
        ok: commandResult.success,
        workforceCommand: true,
        intent: commandResult.intent,
        reply: commandResult.reply,
        mockMode: commandResult.mockMode,
        sendResult,
      });
    }

    const { data: employees, error: employeeError } = await supabaseAdmin
      .from("employees")
      .select("id, first_name, last_name, phone, company_id")
      .not("phone", "is", null);

    if (employeeError) {
      const logError = await logMessage({
        direction: "inbound",
        phone: fromPhone,
        employee_name: contactName,
        message_body: textBody,
        meta_message_id: messageId,
        status: "error",
        match_status: `employee_lookup_failed: ${employeeError.message}`,
        raw_payload: payload,
      });

      return NextResponse.json({ ok: false, error: employeeError.message, logError }, { status: 500 });
    }

    const matchedEmployees = (employees || []).filter((item: any) => phoneMatches(item.phone || "", fromPhone));

    const matchedCompanyIds = Array.from(
      new Set(matchedEmployees.map((item: any) => String(item.company_id || "")).filter(Boolean))
    );

    if (matchedCompanyIds.length !== 1) {
      const logError = await logMessage({
        direction: "inbound",
        phone: fromPhone,
        employee_name: contactName,
        message_body: textBody,
        meta_message_id: messageId,
        status: "received",
        match_status: "ambiguous_or_missing_company_match",
        raw_payload: payload,
      });

      return NextResponse.json({
        ok: true,
        saved: false,
        reason: "No unique employee match found.",
        logError,
      });
    }

    const matchedCompanyId = matchedCompanyIds[0];
    const companyScopedEmployees = matchedEmployees.filter(
      (item: any) => String(item.company_id || "") === matchedCompanyId
    );

    if (companyScopedEmployees.length !== 1) {
      const logError = await logMessage({
        direction: "inbound",
        phone: fromPhone,
        employee_name: contactName,
        message_body: textBody,
        meta_message_id: messageId,
        status: "received",
        match_status: "ambiguous_employee_match_in_company",
        raw_payload: payload,
      });

      return NextResponse.json({
        ok: true,
        saved: false,
        reason: "No unique employee match found.",
        logError,
      });
    }

    const employee = companyScopedEmployees[0];

    if (!employee) {
      const logError = await logMessage({
        direction: "inbound",
        phone: fromPhone,
        employee_name: contactName,
        message_body: textBody,
        meta_message_id: messageId,
        status: "received",
        match_status: "no_matching_employee",
        raw_payload: payload,
      });

      return NextResponse.json({
        ok: true,
        saved: false,
        reason: "No matching employee found.",
        fromPhone,
        contactName,
        messageId,
        logError,
      });
    }

    const employeeName =
      `${employee.first_name || ""} ${employee.last_name || ""}`.trim() ||
      contactName ||
      "Employee";

    const { data: hrCases, error: hrCaseError } = await supabaseAdmin
      .from("hr_cases")
      .select("id, company_id, employee_id, status, employee_response")
      .eq("company_id", matchedCompanyId)
      .eq("employee_id", employee.id)
      .not("status", "eq", "closed")
      .order("created_at", { ascending: false })
      .limit(1);

    if (hrCaseError) {
      const logError = await logMessage({
        direction: "inbound",
        phone: fromPhone,
        employee_id: employee.id,
        employee_name: employeeName,
        message_body: textBody,
        meta_message_id: messageId,
        status: "error",
        match_status: `hr_case_lookup_failed: ${hrCaseError.message}`,
        raw_payload: payload,
      });

      return NextResponse.json({ ok: false, error: hrCaseError.message, logError }, { status: 500 });
    }

    const hrCase = hrCases?.[0];

    if (!hrCase) {
      const logError = await logMessage({
        direction: "inbound",
        phone: fromPhone,
        employee_id: employee.id,
        employee_name: employeeName,
        message_body: textBody,
        meta_message_id: messageId,
        status: "received",
        match_status: "employee_found_no_open_hr_case",
        raw_payload: payload,
      });

      return NextResponse.json({
        ok: true,
        saved: false,
        reason: "Employee matched, but no open HR case found.",
        employeeId: employee.id,
        employeeName,
        fromPhone,
        textBody,
        messageId,
        logError,
      });
    }

    const existingResponse = String(hrCase.employee_response || "").trim();
    const timestamp = new Date().toLocaleString("en-ZA", { timeZone: "Africa/Johannesburg" });

    const combinedResponse = existingResponse
      ? `${existingResponse}\n\nEmployee WhatsApp reply ${timestamp}:\n${textBody}`
      : `Employee WhatsApp reply ${timestamp}:\n${textBody}`;

    const { error: updateError } = await supabaseAdmin
      .from("hr_cases")
      .update({
        employee_response: combinedResponse,
        employee_response_required: false,
        validity_status: "review_required",
        status: "open",
      })
      .eq("id", hrCase.id)
      .eq("company_id", matchedCompanyId);

    const logError = await logMessage({
      direction: "inbound",
      phone: fromPhone,
      employee_id: employee.id,
      hr_case_id: hrCase.id,
      employee_name: employeeName,
      message_body: textBody,
      meta_message_id: messageId,
      status: updateError ? "received_but_hr_update_failed" : "saved",
      match_status: updateError ? updateError.message : "saved_to_open_hr_case",
      raw_payload: payload,
    });

    if (updateError) {
      return NextResponse.json(
        { ok: false, error: updateError.message, logError },
        { status: 500 }
      );
    }

    if (logError) {
      return NextResponse.json(
        { ok: false, saved: true, error: `HR case saved, but log failed: ${logError}` },
        { status: 500 }
      );
    }

    return NextResponse.json({
      ok: true,
      saved: true,
      employeeId: employee.id,
      employeeName,
      hrCaseId: hrCase.id,
      fromPhone,
      messageId,
    });
  } catch (error: any) {
    return NextResponse.json(
      { ok: false, error: error?.message || "Unknown webhook error." },
      { status: 500 }
    );
  }
}

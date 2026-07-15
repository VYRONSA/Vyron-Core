import { NextRequest, NextResponse } from "next/server";
import { authenticateApiRequest } from "@/lib/server-api-auth";
import { VYRON_SESSION_TOKEN_COOKIE } from "@/lib/server/auth-routing";

export const runtime = "nodejs";

function normalisePhone(value: string) {
  let phone = String(value || "").trim().replace(/[^\d]/g, "");
  if (phone.startsWith("0")) phone = `27${phone.slice(1)}`;
  if (phone.startsWith("00")) phone = phone.slice(2);
  return phone;
}

export async function POST(request: NextRequest) {
  try {
    const auth = await authenticateApiRequest(
      request.headers.get("authorization"),
      request.cookies.get(VYRON_SESSION_TOKEN_COOKIE)?.value || ""
    );
    if (!auth.ok) {
      return NextResponse.json({ ok: false, error: auth.message }, { status: auth.status });
    }

    const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
    const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;
    const graphVersion = process.env.WHATSAPP_GRAPH_VERSION || "v20.0";

    if (!phoneNumberId) {
      return NextResponse.json(
        { ok: false, error: "Missing WHATSAPP_PHONE_NUMBER_ID in .env.local" },
        { status: 500 }
      );
    }

    if (!accessToken) {
      return NextResponse.json(
        { ok: false, error: "Missing WHATSAPP_ACCESS_TOKEN in .env.local" },
        { status: 500 }
      );
    }

    const body = await request.json();
    const to = normalisePhone(body?.to || "");
    const message = String(body?.message || "").trim();

    if (!to) {
      return NextResponse.json({ ok: false, error: "Recipient phone number is required." }, { status: 400 });
    }
    if (!message) {
      return NextResponse.json({ ok: false, error: "Message is required." }, { status: 400 });
    }

    const response = await fetch(`https://graph.facebook.com/${graphVersion}/${phoneNumberId}/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to,
        type: "text",
        text: {
          preview_url: false,
          body: message,
        },
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      return NextResponse.json(
        { ok: false, error: data?.error?.message || "WhatsApp send failed.", meta: data },
        { status: response.status }
      );
    }

    return NextResponse.json({
      ok: true,
      messageId: data?.messages?.[0]?.id || null,
      to,
      meta: data,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown WhatsApp API error.";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

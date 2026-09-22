import { NextResponse, type NextRequest } from "next/server";
import {
  DuplicateGuard,
  RateLimiter,
  enquiryEmailSubject,
  enquiryEmailText,
  validateEnquiry,
  type Enquiry,
} from "@/lib/marketing/enquiry";
import { SALES_EMAIL } from "@/lib/marketing/umora";

/**
 * Public marketing enquiry endpoint (no authentication — this is the website's
 * contact form). It stores nothing: the enquiry is delivered to the sales inbox
 * through whichever channel is configured, and the visitor is only told the
 * enquiry was received once delivery actually succeeded.
 *
 * Configure ONE of:
 *   UMORA_ENQUIRY_WEBHOOK_URL   POST the enquiry as JSON (CRM / automation)
 *     UMORA_ENQUIRY_WEBHOOK_TOKEN  optional bearer token for that webhook
 *   RESEND_API_KEY + UMORA_ENQUIRY_FROM   send an email via Resend's HTTP API
 *     UMORA_ENQUIRY_TO   optional override of the recipient (defaults to sales)
 *
 * With neither set the endpoint reports 503 and the form shows the direct email
 * address instead of claiming success.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const rateLimiter = new RateLimiter(5, 10 * 60 * 1000);
const duplicates = new DuplicateGuard(10 * 60 * 1000);

const DELIVERY_TIMEOUT_MS = 8000;

function clientKey(request: NextRequest): string {
  const forwarded = request.headers.get("x-forwarded-for") || "";
  const ip = forwarded.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "unknown";
  return ip;
}

async function deliverViaWebhook(url: string, enquiry: Enquiry, receivedAt: Date): Promise<boolean> {
  const token = process.env.UMORA_ENQUIRY_WEBHOOK_TOKEN;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({
      source: "umora-website",
      receivedAt: receivedAt.toISOString(),
      name: enquiry.name,
      company: enquiry.company,
      email: enquiry.email,
      phone: enquiry.phone,
      employees: enquiry.employees,
      message: enquiry.message,
      consent: true,
    }),
    signal: AbortSignal.timeout(DELIVERY_TIMEOUT_MS),
  });
  return response.ok;
}

async function deliverViaResend(enquiry: Enquiry, receivedAt: Date): Promise<boolean> {
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: process.env.UMORA_ENQUIRY_FROM,
      to: [process.env.UMORA_ENQUIRY_TO || SALES_EMAIL],
      reply_to: enquiry.email,
      subject: enquiryEmailSubject(enquiry),
      text: enquiryEmailText(enquiry, receivedAt),
    }),
    signal: AbortSignal.timeout(DELIVERY_TIMEOUT_MS),
  });
  return response.ok;
}

export async function POST(request: NextRequest) {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ ok: false, code: "invalid", errors: {} }, { status: 400 });
  }

  const result = validateEnquiry(payload as Record<string, unknown>);

  if (!result.ok) {
    if (result.code === "spam") {
      return NextResponse.json(
        {
          ok: false,
          code: "rejected",
          message: "We could not verify this submission. Please try again, or email us directly.",
        },
        { status: 400 },
      );
    }
    return NextResponse.json({ ok: false, code: "invalid", errors: result.errors }, { status: 400 });
  }

  const { enquiry } = result;

  if (!rateLimiter.check(clientKey(request))) {
    return NextResponse.json(
      { ok: false, code: "rate_limited", message: "Too many enquiries from this connection. Please try again later." },
      { status: 429 },
    );
  }

  // A retry or double submit of the same enquiry is acknowledged without sending twice.
  if (duplicates.seenBefore(enquiry.requestId)) {
    return NextResponse.json({ ok: true, duplicate: true }, { status: 200 });
  }

  const webhookUrl = process.env.UMORA_ENQUIRY_WEBHOOK_URL;
  const canEmail = Boolean(process.env.RESEND_API_KEY && process.env.UMORA_ENQUIRY_FROM);

  if (!webhookUrl && !canEmail) {
    return NextResponse.json(
      {
        ok: false,
        code: "not_configured",
        message: "Enquiry delivery is not configured on this deployment.",
      },
      { status: 503 },
    );
  }

  const receivedAt = new Date();
  try {
    const delivered = webhookUrl
      ? await deliverViaWebhook(webhookUrl, enquiry, receivedAt)
      : await deliverViaResend(enquiry, receivedAt);

    if (!delivered) {
      // Never report success for an enquiry that was not delivered.
      return NextResponse.json(
        { ok: false, code: "delivery_failed", message: "We could not send your enquiry just now." },
        { status: 502 },
      );
    }
  } catch {
    return NextResponse.json(
      { ok: false, code: "delivery_failed", message: "We could not send your enquiry just now." },
      { status: 502 },
    );
  }

  duplicates.remember(enquiry.requestId);
  return NextResponse.json({ ok: true }, { status: 200 });
}

import { NextResponse } from "next/server";
import { readPublicSupabaseEnv, validatePublicSupabaseEnv } from "@/lib/public-env";

export const runtime = "nodejs";

export async function GET() {
  const { url } = readPublicSupabaseEnv();
  const supabaseProblems = validatePublicSupabaseEnv();
  const host = url ? (() => {
    try {
      return new URL(url).host;
    } catch {
      return "invalid-url";
    }
  })() : null;

  return NextResponse.json({
    ok: supabaseProblems.length === 0,
    product: "VYRON CORE",
    timestamp: new Date().toISOString(),
    env: {
      hasSupabaseUrl: Boolean(url),
      supabaseHost: host,
      supabaseConfigOk: supabaseProblems.length === 0,
      supabaseProblems,
      hasAnonKey: Boolean(readPublicSupabaseEnv().anonKey),
      hasServiceRoleKey: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY),
      hasWhatsappPhoneNumberId: Boolean(process.env.WHATSAPP_PHONE_NUMBER_ID),
      hasWhatsappAccessToken: Boolean(process.env.WHATSAPP_ACCESS_TOKEN),
    },
  });
}

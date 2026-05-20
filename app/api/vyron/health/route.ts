import { NextResponse } from "next/server";
export const runtime = "nodejs";
export async function GET() {
  return NextResponse.json({
    ok: true,
    product: "VYRON CORE",
    timestamp: new Date().toISOString(),
    env: {
      hasSupabaseUrl: Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL),
      hasAnonKey: Boolean(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY),
      hasServiceRoleKey: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY),
      hasWhatsappPhoneNumberId: Boolean(process.env.WHATSAPP_PHONE_NUMBER_ID),
      hasWhatsappAccessToken: Boolean(process.env.WHATSAPP_ACCESS_TOKEN),
    },
  });
}

import { NextRequest, NextResponse } from "next/server";
import {
  validateMaintenanceOverride,
  logMaintenanceOverrideAttempt,
  MAINTENANCE_BYPASS_COOKIE,
} from "@/lib/platform/maintenance-mode";

export const runtime = "nodejs";

const BYPASS_TTL_SECONDS = 4 * 60 * 60; // 4 hours

export async function POST(request: NextRequest) {
  const formData = await request.formData().catch(() => null);
  const code = String(formData?.get("code") || "");
  const next = String(formData?.get("next") || "/dashboard");

  const valid = await validateMaintenanceOverride(code);
  await logMaintenanceOverrideAttempt(valid);

  const url = request.nextUrl.clone();
  if (!valid) {
    url.pathname = "/maintenance";
    url.search = `?next=${encodeURIComponent(next)}&invalid=1`;
    return NextResponse.redirect(url);
  }

  url.pathname = next.startsWith("/") ? next : "/dashboard";
  url.search = "";
  const response = NextResponse.redirect(url);
  response.cookies.set(MAINTENANCE_BYPASS_COOKIE, "1", {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    maxAge: BYPASS_TTL_SECONDS,
    path: "/",
  });
  return response;
}

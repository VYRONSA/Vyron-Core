import { NextRequest, NextResponse } from "next/server";
import { isVyronMasterOperator } from "@/lib/company-access";
import { createClientLoginUser } from "@/lib/create-client-login-user";
import { authenticateApiRequest } from "@/lib/server-api-auth";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const auth = await authenticateApiRequest(request);
    if (!auth.ok) {
      return NextResponse.json(
        { ok: false, code: "auth", message: auth.message },
        { status: auth.status }
      );
    }

    if (!isVyronMasterOperator(auth.role) && !auth.platformOperator) {
      return NextResponse.json(
        {
          ok: false,
          code: "auth",
          message: "Master operator access is required to create client login users.",
        },
        { status: 403 }
      );
    }

    const body = await request.json();
    const email = String(body.email || "").trim();
    const password = String(body.password || "");
    const companyId = String(body.companyId || "").trim();
    const role = body.role === "admin" ? "admin" : "owner";

    const result = await createClientLoginUser({ email, password, companyId, role });

    if (!result.ok) {
      const status =
        result.code === "missing_service_key" ? 503
        : result.code === "validation" ? 400
        : 400;
      return NextResponse.json(result, { status });
    }

    return NextResponse.json(result);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown create-client-user error.";
    return NextResponse.json({ ok: false, code: "auth", message }, { status: 500 });
  }
}

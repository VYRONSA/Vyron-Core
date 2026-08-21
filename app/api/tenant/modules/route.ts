import { NextRequest, NextResponse } from "next/server";
import { requireApiContext } from "@/lib/employee-relations-api";
import { getSupabaseAdminClient } from "@/lib/server-api-auth";
import { effectiveUserModules } from "@/lib/tenant/module-access";

/**
 * The signed-in user's EFFECTIVE module entitlement.
 *
 * Why this endpoint has to exist: `public.companies` has row level security enabled and
 * NO policy granting `authenticated` a read, so a browser client asking for
 * `enabled_modules` gets an empty result rather than an error. Company entitlement is
 * deliberately server-only reference data, which is why lib/tenant/user-management-store.ts
 * reads it through the service-role client too.
 *
 * The pattern here is the established one, and the order matters:
 *
 *   1. requireApiContext() authenticates the caller and VERIFIES the supplied companyId
 *      against their own active membership. A caller who edits the companyId is refused.
 *   2. Only then is the admin client used, and only ever scoped to that verified company.
 *
 * So the elevated client never decides who the caller is — it only reads reference data
 * for a company the caller has already been proven to belong to. No entitlement rule is
 * defined here: the answer comes from effectiveUserModules(), the same resolver the user
 * management layer uses, so a subscription downgrade narrows navigation with no second
 * place to keep in step.
 */
export async function GET(request: NextRequest) {
  try {
    const companyId = request.nextUrl.searchParams.get("companyId");
    const context = await requireApiContext(request, companyId);
    if (!context.ok) {
      return NextResponse.json({ ok: false, error: context.message }, { status: context.status });
    }

    const admin = getSupabaseAdminClient();

    const [companyRes, membershipRes] = await Promise.all([
      admin
        .from("companies")
        .select("enabled_modules")
        .eq("id", context.ctx.companyId)
        .maybeSingle(),
      admin
        .from("company_users")
        .select("module_access")
        .eq("company_id", context.ctx.companyId)
        .ilike("user_email", context.ctx.auth.email)
        .eq("status", "active")
        .is("deleted_at", null)
        .maybeSingle(),
    ]);

    if (companyRes.error) {
      return NextResponse.json(
        { ok: false, error: "Could not read the company's module entitlement." },
        { status: 500 }
      );
    }

    const enabled = (companyRes.data as { enabled_modules?: unknown } | null)?.enabled_modules;
    const granted = (membershipRes.data as { module_access?: unknown } | null)?.module_access;

    return NextResponse.json({
      ok: true,
      modules: effectiveUserModules(
        Array.isArray(granted) ? (granted as string[]) : null,
        Array.isArray(enabled) ? (enabled as string[]) : null
      ),
    });
  } catch {
    return NextResponse.json({ ok: false, error: "Could not read module entitlement." }, { status: 500 });
  }
}

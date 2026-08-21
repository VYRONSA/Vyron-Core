import { NextRequest, NextResponse } from "next/server";
import { requirePlatformOperator } from "@/app/api/platform/_shared";
import { writeAuditLog } from "@/lib/audit-log";
import {
  ensureCompanyModuleProvisioning,
  readModuleProvisioningStatus,
} from "@/lib/platform/module-provisioning";

export const runtime = "nodejs";

type RouteParams = { params: Promise<{ companyId: string }> };

/**
 * Current provisioning state for this customer.
 *
 * Re-derived from the database rather than read from the last attempt: a baseline
 * component can go missing after a previously successful provision, and an operator
 * asking "is this customer set up?" needs the answer as it is now.
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
  const auth = await requirePlatformOperator(request);
  if (!auth.ok) return auth.response;
  const { supabase } = auth.context;
  const { companyId } = await params;

  const status = await readModuleProvisioningStatus(supabase, companyId);
  if (status.error) {
    return NextResponse.json({ ok: false, message: status.error }, { status: 400 });
  }

  return NextResponse.json({
    ok: true,
    provisioned: status.ok,
    components: status.components,
  });
}

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  const auth = await requirePlatformOperator(request);
  if (!auth.ok) return auth.response;
  const { supabase, email } = auth.context;
  const { companyId } = await params;

  const body = await request.json().catch(() => null);
  const modules = body?.modules;
  if (!Array.isArray(modules) || !modules.every((item) => typeof item === "string")) {
    return NextResponse.json({ ok: false, message: "modules must be an array of strings." }, { status: 400 });
  }

  const { error } = await supabase
    .from("companies")
    .update({ enabled_modules: modules })
    .eq("id", companyId);

  if (error) return NextResponse.json({ ok: false, message: error.message }, { status: 400 });

  // --- Baseline data for newly granted modules ------------------------------
  //
  // Runs AFTER the entitlement is persisted, because the provisioning function re-checks
  // it and refuses to seed a company that does not hold the module.
  //
  // ADDITIVE ONLY. A module being REMOVED is simply absent from `modules` and is never
  // passed here: revoking access must never delete jobs, evidence, custody, storage,
  // requirements, policies, audit records or operational history. Re-granting the module
  // later finds that history intact and provisions only what is genuinely missing.
  const provisioning = await ensureCompanyModuleProvisioning(supabase, companyId, modules, {
    trigger: "module_toggle",
    actorEmail: email,
  });

  await writeAuditLog(supabase, {
    companyId,
    userEmail: email,
    action: "update",
    entityType: "platform_customer_modules",
    entityId: companyId,
    metadata: {
      modules,
      modulesProvisioned: provisioning.ok,
      moduleProvisioning: provisioning.results.map((entry) => ({
        module: entry.moduleCode,
        provisioned: entry.provisioned,
      })),
    },
  });

  // The entitlement change itself succeeded, so this is not a 4xx. Provisioning shortfall
  // is reported explicitly rather than swallowed: the operator sees exactly what is
  // missing and re-saving retries idempotently.
  return NextResponse.json({
    ok: true,
    provisioned: provisioning.ok,
    notices: provisioning.notices,
    components: provisioning.results.flatMap((entry) => entry.components),
  });
}

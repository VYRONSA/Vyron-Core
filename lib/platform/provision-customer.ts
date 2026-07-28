import { getSupabaseAdminClient } from "@/lib/server-api-auth";
import { provisionClientCompany, normalizeVyronEmail } from "@/lib/company-access";
import { createClientLoginUser } from "@/lib/create-client-login-user";
import { writeAuditLog } from "@/lib/audit-log";
import { logQueueJob } from "@/lib/platform/job-queue";
import { getPlatformDefaults } from "@/lib/platform/settings";
import { welcomeEmail } from "@/lib/platform/email-templates";
import { queueTemplatedNotification } from "@/lib/platform/notifications-dispatch";

export type ProvisionPlatformCustomerInput = {
  companyName: string;
  tradingName?: string;
  registrationNumber?: string;
  vatNumber?: string;
  industry?: string;
  companySize?: string;
  country?: string;
  timeZone?: string;
  currency?: string;
  addressLine1?: string;
  addressLine2?: string;
  addressCity?: string;
  addressRegion?: string;
  addressPostalCode?: string;
  /** subscription_plans.code — 'starter' | 'professional' | 'enterprise' (or a custom plan code). */
  planCode: string;
  /** solution_templates.code — optional industry preset. */
  solutionTemplateCode?: string | null;
  /** Operator overrides — default to the plan's values when omitted. */
  employeeLimit?: number | null;
  userLimit?: number | null;
  storageLimitGb?: number | null;
  aiCreditLimit?: number | null;
  apiRequestLimit?: number | null;
  /** Operator-picked module set (wizard step 3) — overrides the plan+template default union when provided. */
  enabledModulesOverride?: string[] | null;
  adminFirstName: string;
  adminLastName: string;
  adminEmail: string;
  adminMobile?: string;
  /** Omit to send an invite email instead of setting a temporary password. */
  adminPassword?: string;
  inviteRedirectTo?: string;
  /** Platform operator performing this action — written to the audit log. */
  operatorEmail: string;
};

export type ProvisionPlatformCustomerResult =
  | {
      ok: true;
      companyId: string;
      companyName: string;
      adminInvite: { ok: boolean; invited?: boolean; error?: string };
    }
  | { ok: false; message: string };

type SubscriptionPlanRow = {
  id: string;
  code: string;
  modules: string[] | null;
  employee_limit: number | null;
  storage_limit_gb: number | null;
  ai_credit_limit: number | null;
  api_request_limit: number | null;
  trial_period_days: number | null;
};

type SolutionTemplateRow = {
  id: string;
  code: string;
  default_modules: string[] | null;
};

function unionModules(a: string[] | null | undefined, b: string[] | null | undefined): string[] {
  return Array.from(new Set([...(a || []), ...(b || [])]));
}

export async function provisionPlatformCustomer(
  input: ProvisionPlatformCustomerInput
): Promise<ProvisionPlatformCustomerResult> {
  const companyName = (input.companyName || "").trim();
  const planCode = (input.planCode || "").trim().toLowerCase();
  const adminEmail = normalizeVyronEmail(input.adminEmail);

  if (!companyName) return { ok: false, message: "Company name is required." };
  if (!planCode) return { ok: false, message: "A subscription plan is required." };
  if (!adminEmail || !adminEmail.includes("@")) {
    return { ok: false, message: "A valid primary administrator email is required." };
  }

  let admin;
  try {
    admin = getSupabaseAdminClient();
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Server admin client is not configured.";
    return { ok: false, message };
  }

  const defaults = await getPlatformDefaults(admin);

  let planRow: SubscriptionPlanRow;
  if (planCode === "custom") {
    // No subscription_plans row — the operator hand-picks modules/limits directly
    // (wizard "Custom" option). Fall back to platform-wide configurable defaults
    // (sql/064 platform_settings) rather than hard-coded numbers.
    planRow = {
      id: null as unknown as string,
      code: "custom",
      modules: [],
      employee_limit: defaults.employeeLimit,
      storage_limit_gb: defaults.storageLimitGb,
      ai_credit_limit: defaults.aiCreditLimit,
      api_request_limit: null,
      trial_period_days: defaults.trialDays,
    };
  } else {
    const { data: plan, error: planError } = await admin
      .from("subscription_plans")
      .select("id,code,modules,employee_limit,storage_limit_gb,ai_credit_limit,api_request_limit,trial_period_days")
      .eq("code", planCode)
      .maybeSingle();

    if (planError) return { ok: false, message: planError.message };
    if (!plan) return { ok: false, message: `Unknown subscription plan "${input.planCode}".` };
    planRow = plan as SubscriptionPlanRow;
  }

  let templateRow: SolutionTemplateRow | null = null;
  if (input.solutionTemplateCode) {
    const { data: template, error: templateError } = await admin
      .from("solution_templates")
      .select("id,code,default_modules")
      .eq("code", input.solutionTemplateCode.trim().toLowerCase())
      .maybeSingle();
    if (templateError) return { ok: false, message: templateError.message };
    templateRow = (template as SolutionTemplateRow | null) || null;
  }

  const { company, error: companyError } = await provisionClientCompany(admin, companyName);
  if (companyError) return { ok: false, message: companyError };
  if (!company) return { ok: false, message: "Company could not be created." };

  const enabledModules =
    input.enabledModulesOverride && input.enabledModulesOverride.length > 0
      ? input.enabledModulesOverride
      : unionModules(planRow.modules, templateRow?.default_modules);
  const trialDays = planRow.trial_period_days ?? defaults.trialDays;
  const trialEndsAt = new Date(Date.now() + trialDays * 24 * 60 * 60 * 1000).toISOString();

  const { error: updateError } = await admin
    .from("companies")
    .update({
      trading_name: input.tradingName || null,
      registration_number: input.registrationNumber || null,
      vat_number: input.vatNumber || null,
      industry: input.industry || null,
      company_size: input.companySize || null,
      country: input.country || null,
      time_zone: input.timeZone || undefined,
      currency: input.currency || undefined,
      address_line1: input.addressLine1 || null,
      address_line2: input.addressLine2 || null,
      address_city: input.addressCity || null,
      address_region: input.addressRegion || null,
      address_postal_code: input.addressPostalCode || null,
      enabled_modules: enabledModules,
      plan_id: planRow.id,
      solution_template_id: templateRow?.id || null,
      employee_limit: input.employeeLimit ?? planRow.employee_limit,
      user_limit: input.userLimit ?? null,
      storage_limit_gb: input.storageLimitGb ?? planRow.storage_limit_gb,
      ai_credit_limit: input.aiCreditLimit ?? planRow.ai_credit_limit,
      api_request_limit: input.apiRequestLimit ?? planRow.api_request_limit,
      trial_ends_at: trialEndsAt,
      customer_status: "trial",
      session_idle_timeout_minutes: defaults.sessionIdleMinutes,
      session_absolute_timeout_minutes: defaults.sessionAbsoluteMinutes,
    })
    .eq("id", company.id);

  if (updateError) return { ok: false, message: updateError.message };

  const adminResult = await createClientLoginUser({
    email: adminEmail,
    password: input.adminPassword,
    companyId: company.id,
    role: "owner",
    inviteRedirectTo: input.inviteRedirectTo,
    metadata: {
      first_name: input.adminFirstName,
      last_name: input.adminLastName,
      mobile: input.adminMobile || null,
    },
  });

  await writeAuditLog(admin, {
    companyId: company.id,
    userEmail: input.operatorEmail,
    action: "create",
    entityType: "platform_customer",
    entityId: company.id,
    metadata: { plan: planRow.code, template: templateRow?.code || null },
  });

  if (adminResult.ok) {
    if (adminResult.invited) {
      await logQueueJob(admin, {
        queueName: "email",
        payload: { to: adminEmail, kind: "customer_admin_invite" },
        status: "completed",
      });
    } else {
      const template = welcomeEmail({
        companyName: company.name,
        adminName: `${input.adminFirstName} ${input.adminLastName}`.trim(),
      });
      await queueTemplatedNotification(admin, { to: adminEmail, template, companyId: company.id });
    }
  }

  return {
    ok: true,
    companyId: company.id,
    companyName: company.name,
    adminInvite: adminResult.ok
      ? { ok: true, invited: adminResult.invited }
      : { ok: false, error: adminResult.message },
  };
}

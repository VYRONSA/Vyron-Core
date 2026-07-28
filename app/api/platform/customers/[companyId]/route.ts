import { NextRequest, NextResponse } from "next/server";
import { requirePlatformOperator } from "@/app/api/platform/_shared";
import { isDeletableCompanyId, MASTER_OPERATOR_DIRECTORY_PROTECTED_MESSAGE } from "@/lib/company-access";
import { writeAuditLog, fetchAuditLogForCompany } from "@/lib/audit-log";
import { computeHealthScore } from "@/lib/platform/health-score";
import { buildCustomerTimeline } from "@/lib/platform/timeline";

const EMPLOYEE_MILESTONE_INTERVAL = 10;

export const runtime = "nodejs";

const EDITABLE_FIELDS = [
  "name",
  "trading_name",
  "registration_number",
  "vat_number",
  "industry",
  "company_size",
  "country",
  "time_zone",
  "currency",
  "address_line1",
  "address_line2",
  "address_city",
  "address_region",
  "address_postal_code",
  "employee_limit",
  "user_limit",
  "storage_limit_gb",
  "ai_credit_limit",
  "api_request_limit",
  "licence_expires_at",
  "billing_frequency",
  "renewal_date",
  "invoice_reference",
  "payment_status",
  "plan_id",
  "billing_contact",
  "purchase_order",
  "automatic_billing_ready",
  "grace_period_ends_at",
] as const;

type RouteParams = { params: Promise<{ companyId: string }> };

const LICENCE_FIELDS = new Set([
  "employee_limit",
  "user_limit",
  "storage_limit_gb",
  "ai_credit_limit",
  "api_request_limit",
  "licence_expires_at",
]);
const BILLING_FIELDS = new Set([
  "billing_frequency",
  "renewal_date",
  "invoice_reference",
  "payment_status",
  "billing_contact",
  "purchase_order",
  "automatic_billing_ready",
  "grace_period_ends_at",
]);

/** One audit entry per touched category (a single save can span more than one). */
function classifyUpdateEntityTypes(fields: string[]): string[] {
  const types = new Set<string>();
  for (const field of fields) {
    if (field === "plan_id") types.add("platform_customer_plan");
    else if (LICENCE_FIELDS.has(field)) types.add("platform_customer_licence");
    else if (BILLING_FIELDS.has(field)) types.add("platform_customer_billing");
    else types.add("platform_customer");
  }
  return Array.from(types);
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  const auth = await requirePlatformOperator(request);
  if (!auth.ok) return auth.response;
  const { supabase } = auth.context;
  const { companyId } = await params;

  const [companyRes, usersRes, employeesRes, auditRes] = await Promise.all([
    supabase.from("companies").select("*").eq("id", companyId).maybeSingle(),
    supabase
      .from("company_users")
      .select("id,user_email,role,status,last_login_at,created_at")
      .eq("company_id", companyId)
      .order("created_at", { ascending: true }),
    supabase.from("employees").select("id,created_at").eq("company_id", companyId).order("created_at", { ascending: true }),
    fetchAuditLogForCompany(supabase, companyId, 50),
  ]);

  if (companyRes.error) {
    return NextResponse.json({ ok: false, message: companyRes.error.message }, { status: 500 });
  }
  if (!companyRes.data) {
    return NextResponse.json({ ok: false, message: "Customer not found." }, { status: 404 });
  }

  let plan = null;
  if (companyRes.data.plan_id) {
    const { data: planRow } = await supabase
      .from("subscription_plans")
      .select("*")
      .eq("id", companyRes.data.plan_id)
      .maybeSingle();
    plan = planRow || null;
  }

  const users = usersRes.data || [];
  // Tolerate employees.created_at being unavailable in older schemas — milestones
  // are a nice-to-have on the timeline, not a hard dependency for this page.
  const employees = employeesRes.error ? [] : employeesRes.data || [];
  const mostRecentLoginAt = users.reduce<string | null>((latest, user) => {
    if (!user.last_login_at) return latest;
    if (!latest || user.last_login_at > latest) return user.last_login_at;
    return latest;
  }, null);

  const health = computeHealthScore({
    customerStatus: companyRes.data.customer_status,
    mostRecentLoginAt,
    employeeCount: employees.length,
    employeeLimit: companyRes.data.employee_limit,
    enabledModuleCount: (companyRes.data.enabled_modules || []).length,
    planModuleCount: (plan?.modules || []).length,
  });

  const employeeMilestones = employees
    .map((employee, index) => ({ count: index + 1, reachedAt: employee.created_at as string }))
    .filter((entry) => entry.count % EMPLOYEE_MILESTONE_INTERVAL === 0);

  const administratorInvitedEvents = users
    .filter((user) => user.role === "owner" || user.role === "admin")
    .map((user) => ({ email: user.user_email, createdAt: user.created_at as string }));

  const timeline = buildCustomerTimeline({
    auditLog: auditRes.rows,
    companyCreatedAt: companyRes.data.created_at,
    administratorInvitedEvents,
    employeeMilestones,
  });

  return NextResponse.json({
    ok: true,
    company: companyRes.data,
    plan,
    users,
    employeeCount: employees.length,
    auditLog: auditRes.rows,
    health,
    timeline,
  });
}

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  const auth = await requirePlatformOperator(request);
  if (!auth.ok) return auth.response;
  const { supabase, email } = auth.context;
  const { companyId } = await params;

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ ok: false, message: "Invalid request body." }, { status: 400 });
  }

  const updates: Record<string, unknown> = {};
  for (const field of EDITABLE_FIELDS) {
    if (field in body) updates[field] = body[field];
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ ok: false, message: "No editable fields provided." }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("companies")
    .update(updates)
    .eq("id", companyId)
    .select("id")
    .maybeSingle();

  if (error) return NextResponse.json({ ok: false, message: error.message }, { status: 400 });
  if (!data) return NextResponse.json({ ok: false, message: "Customer not found." }, { status: 404 });

  const updatedFields = Object.keys(updates);
  for (const entityType of classifyUpdateEntityTypes(updatedFields)) {
    await writeAuditLog(supabase, {
      companyId,
      userEmail: email,
      action: "update",
      entityType,
      entityId: companyId,
      metadata: { fields: updatedFields },
    });
  }

  return NextResponse.json({ ok: true });
}

/**
 * Soft delete only (sets deleted_at) — distinct from Cancel (customer_status
 * transition via /status). Matches the existing app convention (see the VYRON DEV
 * client directory's "delete" action, which archives rather than hard-deletes)
 * since a real DELETE would need every company_id-scoped table to cascade correctly.
 * Excluded from the default customer directory list but recoverable via `restore`.
 */
export async function DELETE(request: NextRequest, { params }: RouteParams) {
  const auth = await requirePlatformOperator(request);
  if (!auth.ok) return auth.response;
  const { supabase, email } = auth.context;
  const { companyId } = await params;

  if (!isDeletableCompanyId(companyId)) {
    return NextResponse.json({ ok: false, message: MASTER_OPERATOR_DIRECTORY_PROTECTED_MESSAGE }, { status: 400 });
  }

  const restore = request.nextUrl.searchParams.get("restore") === "1";

  const { error } = await supabase
    .from("companies")
    .update({ deleted_at: restore ? null : new Date().toISOString() })
    .eq("id", companyId);

  if (error) return NextResponse.json({ ok: false, message: error.message }, { status: 400 });

  await writeAuditLog(supabase, {
    companyId,
    userEmail: email,
    action: restore ? "restore" : "delete",
    entityType: "platform_customer",
    entityId: companyId,
    metadata: {},
  });

  return NextResponse.json({ ok: true, deleted: !restore });
}

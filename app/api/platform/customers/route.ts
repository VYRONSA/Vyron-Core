import { NextRequest, NextResponse } from "next/server";
import { requirePlatformOperator } from "@/app/api/platform/_shared";
import { provisionPlatformCustomer } from "@/lib/platform/provision-customer";
import { computeHealthScore } from "@/lib/platform/health-score";

export const runtime = "nodejs";

type CompanyListRow = {
  id: string;
  name: string;
  trading_name: string | null;
  industry: string | null;
  customer_status: string | null;
  plan_id: string | null;
  employee_limit: number | null;
  enabled_modules: string[] | null;
  billing_frequency: string | null;
  renewal_date: string | null;
  licence_expires_at: string | null;
  created_at: string | null;
};

export async function GET(request: NextRequest) {
  const auth = await requirePlatformOperator(request);
  if (!auth.ok) return auth.response;
  const { supabase } = auth.context;

  const { searchParams } = request.nextUrl;
  const status = searchParams.get("status");
  const search = searchParams.get("search");
  const includeDeleted = searchParams.get("includeDeleted") === "1";
  const page = Math.max(1, Number(searchParams.get("page")) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(searchParams.get("pageSize")) || 25));
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  let query = supabase
    .from("companies")
    .select(
      "id,name,trading_name,industry,customer_status,plan_id,employee_limit,enabled_modules,billing_frequency,renewal_date,licence_expires_at,created_at",
      { count: "exact" }
    )
    .order("created_at", { ascending: false })
    .range(from, to);

  if (!includeDeleted) query = query.is("deleted_at", null);
  if (status) query = query.eq("customer_status", status);
  if (search) query = query.ilike("name", `%${search}%`);

  const { data, error, count } = await query;
  if (error) return NextResponse.json({ ok: false, message: error.message }, { status: 500 });

  const companies = (data || []) as CompanyListRow[];
  const companyIds = companies.map((company) => company.id);
  const planIds = Array.from(new Set(companies.map((c) => c.plan_id).filter(Boolean))) as string[];

  const [usersRes, employeesRes, plansRes] = await Promise.all([
    companyIds.length
      ? supabase.from("company_users").select("company_id,last_login_at").in("company_id", companyIds)
      : Promise.resolve({ data: [] as { company_id: string; last_login_at: string | null }[] }),
    companyIds.length
      ? supabase.from("employees").select("company_id").in("company_id", companyIds)
      : Promise.resolve({ data: [] as { company_id: string }[] }),
    planIds.length
      ? supabase.from("subscription_plans").select("id,modules").in("id", planIds)
      : Promise.resolve({ data: [] as { id: string; modules: string[] | null }[] }),
  ]);

  const lastLoginByCompany = new Map<string, string | null>();
  for (const row of usersRes.data || []) {
    const current = lastLoginByCompany.get(row.company_id);
    if (!current || (row.last_login_at && row.last_login_at > current)) {
      lastLoginByCompany.set(row.company_id, row.last_login_at);
    }
  }

  const employeeCountByCompany = new Map<string, number>();
  for (const row of employeesRes.data || []) {
    employeeCountByCompany.set(row.company_id, (employeeCountByCompany.get(row.company_id) || 0) + 1);
  }

  const planModuleCountById = new Map((plansRes.data || []).map((plan) => [plan.id, (plan.modules || []).length]));

  const customers = companies.map((company) => {
    const health = computeHealthScore({
      customerStatus: company.customer_status,
      mostRecentLoginAt: lastLoginByCompany.get(company.id) || null,
      employeeCount: employeeCountByCompany.get(company.id) || 0,
      employeeLimit: company.employee_limit,
      enabledModuleCount: (company.enabled_modules || []).length,
      planModuleCount: company.plan_id ? planModuleCountById.get(company.plan_id) || 0 : 0,
    });
    return { ...company, healthScore: health.score, healthBand: health.band };
  });

  return NextResponse.json({
    ok: true,
    customers,
    pagination: { page, pageSize, totalCount: count ?? customers.length },
  });
}

export async function POST(request: NextRequest) {
  const auth = await requirePlatformOperator(request);
  if (!auth.ok) return auth.response;

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ ok: false, message: "Invalid request body." }, { status: 400 });
  }

  const result = await provisionPlatformCustomer({
    companyName: String(body.companyName || ""),
    tradingName: body.tradingName ? String(body.tradingName) : undefined,
    registrationNumber: body.registrationNumber ? String(body.registrationNumber) : undefined,
    vatNumber: body.vatNumber ? String(body.vatNumber) : undefined,
    industry: body.industry ? String(body.industry) : undefined,
    companySize: body.companySize ? String(body.companySize) : undefined,
    country: body.country ? String(body.country) : undefined,
    timeZone: body.timeZone ? String(body.timeZone) : undefined,
    currency: body.currency ? String(body.currency) : undefined,
    addressLine1: body.addressLine1 ? String(body.addressLine1) : undefined,
    addressLine2: body.addressLine2 ? String(body.addressLine2) : undefined,
    addressCity: body.addressCity ? String(body.addressCity) : undefined,
    addressRegion: body.addressRegion ? String(body.addressRegion) : undefined,
    addressPostalCode: body.addressPostalCode ? String(body.addressPostalCode) : undefined,
    planCode: String(body.planCode || ""),
    solutionTemplateCode: body.solutionTemplateCode ? String(body.solutionTemplateCode) : null,
    employeeLimit: body.employeeLimit ?? null,
    userLimit: body.userLimit ?? null,
    storageLimitGb: body.storageLimitGb ?? null,
    aiCreditLimit: body.aiCreditLimit ?? null,
    apiRequestLimit: body.apiRequestLimit ?? null,
    enabledModulesOverride: Array.isArray(body.enabledModules) ? body.enabledModules : null,
    adminFirstName: String(body.adminFirstName || ""),
    adminLastName: String(body.adminLastName || ""),
    adminEmail: String(body.adminEmail || ""),
    adminMobile: body.adminMobile ? String(body.adminMobile) : undefined,
    adminPassword: body.adminPassword ? String(body.adminPassword) : undefined,
    inviteRedirectTo: body.inviteRedirectTo
      ? String(body.inviteRedirectTo)
      : `${request.nextUrl.origin}/invite`,
    operatorEmail: auth.context.email,
  });

  if (!result.ok) {
    return NextResponse.json({ ok: false, message: result.message }, { status: 400 });
  }

  return NextResponse.json(result);
}

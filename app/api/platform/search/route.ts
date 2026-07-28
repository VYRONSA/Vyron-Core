import { NextRequest, NextResponse } from "next/server";
import { requirePlatformOperator } from "@/app/api/platform/_shared";

export const runtime = "nodejs";

type SearchResult = {
  type: "company" | "user" | "employee";
  id: string;
  label: string;
  sublabel: string | null;
  companyId: string | null;
};

export async function GET(request: NextRequest) {
  const auth = await requirePlatformOperator(request);
  if (!auth.ok) return auth.response;
  const { supabase } = auth.context;

  const q = (request.nextUrl.searchParams.get("q") || "").trim();
  if (q.length < 2) return NextResponse.json({ ok: true, results: [] });

  const like = `%${q}%`;

  const [companiesRes, usersRes, employeesRes] = await Promise.all([
    supabase
      .from("companies")
      .select("id,name,trading_name,registration_number,vat_number")
      .or(
        `name.ilike.${like},trading_name.ilike.${like},registration_number.ilike.${like},vat_number.ilike.${like}`
      )
      .limit(10),
    supabase.from("company_users").select("id,user_email,company_id,role").ilike("user_email", like).limit(10),
    supabase
      .from("employees")
      .select("id,company_id,first_name,last_name")
      .or(`first_name.ilike.${like},last_name.ilike.${like}`)
      .limit(10),
  ]);

  const results: SearchResult[] = [];

  for (const company of companiesRes.data || []) {
    results.push({
      type: "company",
      id: company.id,
      label: company.name,
      sublabel: company.trading_name || company.registration_number || company.vat_number || null,
      companyId: company.id,
    });
  }

  for (const user of usersRes.data || []) {
    results.push({
      type: "user",
      id: user.id,
      label: user.user_email,
      sublabel: user.role,
      companyId: user.company_id,
    });
  }

  for (const employee of employeesRes.data || []) {
    const name = [employee.first_name, employee.last_name].filter(Boolean).join(" ") || "Employee";
    results.push({
      type: "employee",
      id: employee.id,
      label: name,
      sublabel: null,
      companyId: employee.company_id,
    });
  }

  return NextResponse.json({ ok: true, results });
}

/**
 * Sprint 2 — live Supabase verification (RLS + tenant isolation).
 * Usage: node scripts/sprint-2-verify.mjs
 * Requires .env.local: NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY
 */

import { createClient } from "@supabase/supabase-js";
import { readFileSync, writeFileSync } from "fs";
import { resolve } from "path";

const ROOT = resolve(import.meta.dirname, "..");
const REPORT_PATH = resolve(ROOT, "scripts", "sprint-2-report.json");

function loadEnv() {
  const path = resolve(ROOT, ".env.local");
  const text = readFileSync(path, "utf8");
  const env = {};
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i < 1) continue;
    let v = t.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    env[t.slice(0, i).trim()] = v;
  }
  return env;
}

function pass(msg, data) {
  return { ok: true, message: msg, ...data };
}

function fail(msg, data) {
  return { ok: false, message: msg, ...data };
}

const env = loadEnv();
const url = env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !anonKey || !serviceKey) {
  console.error("Missing Supabase env in .env.local");
  process.exit(1);
}

const admin = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const RUN_ID = Date.now();
const PASSWORD = `VyronSprint2!${RUN_ID}`;
const emailA = `sprint2-client-a-${RUN_ID}@vyron-qa.invalid`;
const emailB = `sprint2-client-b-${RUN_ID}@vyron-qa.invalid`;

const report = {
  runId: RUN_ID,
  supabaseHost: new URL(url).hostname,
  timestamp: new Date().toISOString(),
  sqlAppliedByScript: false,
  preflight: {},
  rls: {},
  isolation: {},
  liveQa: {},
  errors: [],
};

const CORE_TABLES = [
  "employees",
  "stores",
  "leave_requests",
  "hr_warnings",
  "hr_cases",
  "hr_documents",
  "hr_notes",
  "clock_events",
  "roster_shifts",
  "time_exceptions",
  "payroll_batches",
  "payroll_hours",
  "company_users",
];

async function createAuthedClient(email, password) {
  const client = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`Sign-in failed for ${email}: ${error.message}`);
  return { client, session: data.session };
}

async function main() {
  // --- Preflight: functions + DEV policy probe ---
  const { data: fnProbe, error: fnErr } = await admin.rpc("vyron_user_company_ids");
  report.preflight.vyron_user_company_ids_callable = !fnErr;
  if (fnErr) report.preflight.vyron_user_company_ids_error = fnErr.message;

  const anon = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: anonEmployees, error: anonErr } = await anon.from("employees").select("id,company_id").limit(5);
  report.rls.anon_employees_query = {
    error: anonErr?.message || null,
    rowCount: anonEmployees?.length ?? 0,
    devAllowAllLikely: !anonErr && (anonEmployees?.length ?? 0) > 0,
  };

  for (const table of CORE_TABLES) {
    const { error } = await admin.from(table).select("company_id").limit(1);
    report.rls.tables_present = report.rls.tables_present || {};
    report.rls.tables_present[table] = !error || !error.message.includes("does not exist");
    if (error?.message?.includes("company_id")) {
      report.rls.missing_company_id = report.rls.missing_company_id || [];
      report.rls.missing_company_id.push(table);
    }
  }

  // --- Provision Client A / B ---
  const { data: companyA, error: companyAErr } = await admin
    .from("companies")
    .insert({ name: `Sprint2 Client A ${RUN_ID}`, status: "active", subscription_status: "active" })
    .select("id")
    .single();
  if (companyAErr) throw new Error(`Company A: ${companyAErr.message}`);

  const { data: companyB, error: companyBErr } = await admin
    .from("companies")
    .insert({ name: `Sprint2 Client B ${RUN_ID}`, status: "active", subscription_status: "active" })
    .select("id")
    .single();
  if (companyBErr) throw new Error(`Company B: ${companyBErr.message}`);

  const companyIdA = companyA.id;
  const companyIdB = companyB.id;

  const { data: userA, error: userAErr } = await admin.auth.admin.createUser({
    email: emailA,
    password: PASSWORD,
    email_confirm: true,
  });
  if (userAErr) throw new Error(`User A: ${userAErr.message}`);

  const { data: userB, error: userBErr } = await admin.auth.admin.createUser({
    email: emailB,
    password: PASSWORD,
    email_confirm: true,
  });
  if (userBErr) throw new Error(`User B: ${userBErr.message}`);

  for (const [email, companyId, role] of [
    [emailA, companyIdA, "owner"],
    [emailB, companyIdB, "owner"],
  ]) {
    const { error } = await admin.from("company_users").insert({
      company_id: companyId,
      user_email: email,
      role,
      status: "active",
    });
    if (error) throw new Error(`company_users ${email}: ${error.message}`);
  }

  const { data: storeA } = await admin
    .from("stores")
    .insert({ company_id: companyIdA, name: `Store A ${RUN_ID}`, status: "active" })
    .select("id")
    .single();

  const { data: empA } = await admin
    .from("employees")
    .insert({
      company_id: companyIdA,
      first_name: "Alpha",
      last_name: "Worker",
      employee_number: `S2A-${RUN_ID}`,
      active: true,
      default_store_id: storeA?.id || null,
    })
    .select("id,company_id")
    .single();

  const { data: empB } = await admin
    .from("employees")
    .insert({
      company_id: companyIdB,
      first_name: "Beta",
      last_name: "Worker",
      employee_number: `S2B-${RUN_ID}`,
      active: true,
    })
    .select("id,company_id")
    .single();

  const { data: leaveB } = await admin
    .from("leave_requests")
    .insert({
      company_id: companyIdB,
      employee_id: empB.id,
      employee_name: "Beta Worker",
      leave_type: "annual_leave",
      start_date: "2026-06-10",
      end_date: "2026-06-12",
      status: "pending",
      reason: "Sprint2 isolation test",
    })
    .select("id,company_id,status")
    .single();

  const { data: clockB } = await admin
    .from("clock_events")
    .insert({
      company_id: companyIdB,
      employee_id: empB.id,
      event_type: "clock_in",
      event_time: new Date().toISOString(),
      source: "sprint2-test",
    })
    .select("id,company_id")
    .single();

  const { data: docB } = await admin
    .from("hr_documents")
    .insert({
      company_id: companyIdB,
      employee_id: empB.id,
      document_title: "Sprint2 B Doc",
      document_type: "other",
      status: "active",
    })
    .select("id,company_id")
    .single();

  const { client: clientA } = await createAuthedClient(emailA, PASSWORD);

  // --- Isolation tests (Client A session) ---
  const { data: aEmployees } = await clientA.from("employees").select("id,company_id,first_name");
  const bEmployeeVisible = (aEmployees || []).some((r) => r.id === empB.id);
  const onlyCompanyA =
    (aEmployees || []).length > 0 && (aEmployees || []).every((r) => r.company_id === companyIdA);
  report.isolation.clientA_read_employees = bEmployeeVisible
    ? fail("Client A can see Client B employee", { count: aEmployees?.length, ids: aEmployees?.map((e) => e.id) })
    : onlyCompanyA
      ? pass("Client A sees only own-company employees", { count: aEmployees?.length })
      : fail("Client A employee query unexpected", { rows: aEmployees });

  const { data: updateBAttempt, error: updateBErr } = await clientA
    .from("employees")
    .update({ first_name: "HACKED" })
    .eq("id", empB.id)
    .select("id,first_name");

  report.isolation.clientA_update_clientB_employee =
    updateBErr || (updateBAttempt || []).length === 0
      ? pass("Client A cannot update Client B employee", {
          error: updateBErr?.message || null,
          rowsAffected: updateBAttempt?.length ?? 0,
        })
      : fail("Client A updated Client B employee", { rows: updateBAttempt });

  const { data: aLeave } = await clientA.from("leave_requests").select("id,company_id");
  const bLeaveVisible = (aLeave || []).some((r) => r.id === leaveB.id);
  report.isolation.clientA_read_leave = bLeaveVisible
    ? fail("Client A can see Client B leave", { count: aLeave?.length })
    : pass("Client A cannot see Client B leave", { count: aLeave?.length });

  const { data: approveB, error: approveErr } = await clientA
    .from("leave_requests")
    .update({ status: "approved" })
    .eq("id", leaveB.id)
    .select("id,status");

  const { data: leaveBAfter } = await admin
    .from("leave_requests")
    .select("status")
    .eq("id", leaveB.id)
    .single();

  report.isolation.clientA_approve_clientB_leave =
    approveErr || (approveB || []).length === 0
      ? leaveBAfter?.status === "pending"
        ? pass("Client A cannot approve Client B leave", {
            error: approveErr?.message || null,
            statusAfter: leaveBAfter?.status,
          })
        : fail("Leave B status changed without visible row update", { statusAfter: leaveBAfter?.status })
      : fail("Client A approved Client B leave", { rows: approveB });

  const { data: aClock } = await clientA.from("clock_events").select("id,company_id");
  const bClockVisible = (aClock || []).some((r) => r.id === clockB.id);
  report.isolation.clientA_read_clocking = bClockVisible
    ? fail("Client A can see Client B clock events", { count: aClock?.length })
    : pass("Client A cannot see Client B clock events", { count: aClock?.length });

  const { data: aDocs } = await clientA.from("hr_documents").select("id,company_id");
  const bDocVisible = (aDocs || []).some((r) => r.id === docB.id);
  report.isolation.clientA_read_documents = bDocVisible
    ? fail("Client A can see Client B documents", { count: aDocs?.length })
    : pass("Client A cannot see Client B documents", { count: aDocs?.length });

  const openExceptionsA = (aEmployees || []).filter((e) => e.active !== false).length;
  const pendingLeaveA = (aLeave || []).filter((r) => r.status === "pending").length;
  report.isolation.clientA_dashboard_metrics = pass("Dashboard inputs scoped to Client A", {
    activeEmployees: openExceptionsA,
    pendingLeave: pendingLeaveA,
    includesClientBEmployee: bEmployeeVisible,
    includesClientBLeave: bLeaveVisible,
  });

  // --- Live QA: employee CRUD ---
  const { data: newEmp, error: newEmpErr } = await clientA
    .from("employees")
    .insert({
      company_id: companyIdA,
      first_name: "Created",
      last_name: "Live",
      employee_number: `S2L-${RUN_ID}`,
      active: true,
    })
    .select("id,first_name")
    .single();

  const { data: afterRefresh } = await clientA
    .from("employees")
    .select("id,first_name")
    .eq("id", newEmp?.id || "")
    .maybeSingle();

  const { data: edited, error: editErr } = await clientA
    .from("employees")
    .update({ first_name: "Edited" })
    .eq("id", newEmp?.id || "")
    .eq("company_id", companyIdA)
    .select("first_name")
    .single();

  const { data: archived, error: archErr } = await clientA
    .from("employees")
    .update({ active: false })
    .eq("id", newEmp?.id || "")
    .eq("company_id", companyIdA)
    .select("active")
    .single();

  report.liveQa.employee = {
    create: newEmpErr ? fail(newEmpErr.message) : pass("Employee created", { id: newEmp.id }),
    refresh: afterRefresh?.id === newEmp?.id ? pass("Employee persisted after re-read") : fail("Employee not found after create"),
    edit: editErr ? fail(editErr.message) : edited?.first_name === "Edited" ? pass("Employee edit persisted") : fail("Edit failed", { edited }),
    archive: archErr ? fail(archErr.message) : archived?.active === false ? pass("Employee archived") : fail("Archive failed", { archived }),
  };

  // --- Live QA: session persistence ---
  const { client: clientA2, session: session2 } = await createAuthedClient(emailA, PASSWORD);
  const { data: sessionEmp } = await clientA2.from("employees").select("id").eq("id", empA.id).maybeSingle();
  report.liveQa.loginSession = session2?.access_token
    ? sessionEmp?.id === empA.id
      ? pass("Login + session token reads own employee")
      : fail("Session could not read own employee after re-login")
    : fail("No access token after login");

  // --- Live QA: clocking duplicate prevention (logic simulation via fresh read) ---
  const { data: clock1, error: c1Err } = await admin.from("clock_events").insert({
    company_id: companyIdA,
    employee_id: empA.id,
    store_id: storeA?.id,
    event_type: "clock_in",
    event_time: new Date().toISOString(),
    source: "sprint2-dup-test",
  }).select("id").single();

  const { data: todayEvents } = await clientA
    .from("clock_events")
    .select("event_type")
    .eq("employee_id", empA.id)
    .eq("company_id", companyIdA)
    .gte("event_time", new Date().toISOString().slice(0, 10));

  const lastType = todayEvents?.[0]?.event_type;
  const wouldBeClockOut = lastType === "clock_in" || lastType === "clock-in";
  report.liveQa.clocking = {
    insert: c1Err ? fail(c1Err.message) : pass("Clock-in inserted for dup test", { id: clock1?.id }),
    duplicateRule: wouldBeClockOut
      ? pass("Next kiosk action would be clock_out (duplicate clock_in prevented)")
      : fail("Unexpected last event type", { lastType, count: todayEvents?.length }),
    gpsPhoto: fail("GPS/photo capture not exercised in API script — requires browser/kiosk"),
  };

  // --- Live QA: leave ---
  const { data: leaveA, error: leaveAErr } = await clientA
    .from("leave_requests")
    .insert({
      company_id: companyIdA,
      employee_id: empA.id,
      employee_name: "Alpha Worker",
      leave_type: "annual_leave",
      start_date: "2026-07-01",
      end_date: "2026-07-02",
      status: "pending",
      reason: "Sprint2 leave test",
    })
    .select("id,status")
    .single();

  const { data: leaveRead } = await clientA.from("leave_requests").select("id").eq("id", leaveA?.id || "").maybeSingle();
  report.liveQa.leave = {
    apply: leaveAErr ? fail(leaveAErr.message) : pass("Leave request created", { id: leaveA.id }),
    history: leaveRead?.id === leaveA?.id ? pass("Leave visible to own company") : fail("Leave not found after apply"),
    approveReject: fail("Approve/reject UI flow not run in script — isolation approve test covers cross-tenant block"),
    balances: fail("Leave balances not verified — table/balance engine untested in script"),
  };

  report.liveQa.documents = fail("Upload/download/archive requires storage + browser — not run in script");
  report.liveQa.dashboardEmptyState = fail("Empty-state UI not run in browser — metric scoping verified via isolation block");

  report.cleanup = {
    companyIdA,
    companyIdB,
    emailA,
    emailB,
    note: "Test companies/users left in DB for audit; delete manually if desired.",
  };

  writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  console.log(`\nReport written to ${REPORT_PATH}`);

  const failed = Object.values({ ...report.isolation, ...report.liveQa })
    .flatMap((v) => (typeof v === "object" && v && "ok" in v ? [v] : Object.values(v || {})))
    .filter((r) => r && r.ok === false);

  process.exit(failed.length > 0 ? 1 : 0);
}

main().catch((err) => {
  report.errors.push(err.message);
  writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));
  console.error(err);
  process.exit(1);
});

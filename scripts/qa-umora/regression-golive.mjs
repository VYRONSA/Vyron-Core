// Go-live additions: kiosk role, server-side Force Logout, HR change audit, leave working days,
// narrow 062 columns. LOCAL / STAGING REPLICA ONLY (lib.mjs refuses anything else).
import { createRequire } from "module";
import { APP_URL, ANON, CEC, OTHER, STORE, URL_, check, group, kioskClock, login, sql, uuid } from "./lib.mjs";
import { USERS } from "./seed.mjs";

const require = createRequire(new URL("../../package.json", import.meta.url));
const { createClient } = require("@supabase/supabase-js");

export async function run({ S, E, emp, pinOf }) {
  const kiosk = await login(USERS.kiosk);

  group("Go-live — kiosk device role");
  {
    const dir = await kiosk.rpc("vyron_kiosk_directory", { p_company_id: CEC });
    const first = dir.data?.[0] || {};
    check("KIOSK-01 kiosk lists staff for clocking (60) without pay, contact or PIN data",
      (dir.data?.length || 0) === 60 && !("hourly_rate" in first) && !("phone" in first) && !("pin_code" in first),
      dir.error?.message || `rows=${dir.data?.length} fields=${Object.keys(first).join(",")}`);
    const direct = await kiosk.from("employees").select("id,hourly_rate").eq("company_id", CEC);
    check("KIOSK-02 kiosk cannot read the employees table", (direct.data?.length || 0) === 0, `rows=${direct.data?.length}`);
    const ok = await kioskClock(kiosk, emp(18), pinOf(18));
    check("KIOSK-03 kiosk records a clocking with the employee's PIN", ok.ok === true, ok.message || "recorded");
    const bad = await kioskClock(kiosk, emp(19), "0000");
    check("KIOSK-04 kiosk wrong PIN refused", bad.ok === false && bad.code === "pin_incorrect_pin", bad.code);
    const recent = await kiosk.rpc("vyron_kiosk_recent_events", { p_employee_id: emp(18), p_since: new Date(Date.now() - 864e5).toISOString() });
    check("KIOSK-05 kiosk shows the employee's recent clockings", (recent.data?.length || 0) >= 1, recent.error?.message || `rows=${recent.data?.length}`);
    const reads = await Promise.all([
      kiosk.from("clock_events").select("id").limit(5),
      kiosk.from("leave_requests").select("id").limit(5),
      kiosk.from("payroll_hours").select("id").limit(5),
      kiosk.from("hr_cases").select("id").limit(5),
      kiosk.from("roster_shifts").select("id").limit(5),
      kiosk.from("company_users").select("id").eq("company_id", CEC),
    ]);
    const leaked = reads.map((r) => r.data?.length || 0);
    check("KIOSK-06 kiosk sees no clockings, leave, payroll, HR cases, rosters or other users",
      leaked.slice(0, 5).every((n) => n === 0) && leaked[5] <= 1, `rows=${leaked.join("/")}`);
    const manual = await kiosk.rpc("vyron_manager_record_clock_event", { p_employee_id: emp(18), p_event_type: "clock_out", p_event_time: new Date().toISOString(), p_reason: "x" });
    const payroll = await kiosk.rpc("vyron_generate_payroll_hours", { p_company_id: CEC, p_period_start: "2026-11-01", p_period_end: "2026-11-30" });
    const promote = await kiosk.from("company_users").update({ role: "admin" }).eq("user_email", USERS.kiosk).select("role");
    check("KIOSK-07 kiosk cannot enter times, run payroll or promote itself",
      Boolean(manual.error) && Boolean(payroll.error) && (Boolean(promote.error) || promote.data?.[0]?.role !== "admin"),
      `${manual.error?.message} | ${payroll.error?.message} | ${promote.error?.message || promote.data?.[0]?.role}`);
    const photo = await kiosk.storage.from("clock-event-photos").upload(`${emp(18)}/qa/${uuid()}-clock_in.jpg`,
      new Blob([new Uint8Array([255, 216, 255])], { type: "image/jpeg" }), { contentType: "image/jpeg", upsert: false });
    const photoOther = await kiosk.storage.from("clock-event-photos").upload(`${E.OTH001}/qa/${uuid()}-clock_in.jpg`,
      new Blob([new Uint8Array([255, 216, 255])], { type: "image/jpeg" }), { contentType: "image/jpeg", upsert: false });
    check("KIOSK-09 kiosk can store a clock photo for its own staff only",
      !photo.error && Boolean(photoOther.error), `own=${photo.error?.message || "ok"} other=${photoOther.error?.message || "ALLOWED"}`);
    const other = await kioskClock(kiosk, E.OTH001, "9999");
    check("KIOSK-08 kiosk cannot clock another company's employee", other.ok === false, `${other.code} ${other.message}`);
  }

  group("Go-live — onboarding a new employee with a PIN");
  {
    sql(`delete from clock_events where employee_id in (select id from employees where employee_number='CEC-NEW1');
         delete from employees where employee_number='CEC-NEW1';`);
    const created = await S.manager.from("employees").insert({ company_id: CEC, employee_number: "CEC-NEW1", first_name: "New", last_name: "Starter",
      default_store_id: STORE, active: true, pin_code: "4455", kiosk_access_enabled: true }).select("id,pin_configured").single();
    check("NEW-01 a manager adds a new employee with a PIN", !created.error && created.data?.pin_configured === true,
      created.error?.message || `pin_configured=${created.data?.pin_configured}`);
    const clocked = created.data ? await kioskClock(kiosk, created.data.id, "4455") : { ok: false, message: "not created" };
    check("NEW-02 the new employee can clock in at the kiosk with that PIN", clocked.ok === true, clocked.message || "clocked");
  }

  group("Go-live — HR change audit (D34)");
  {
    await S.manager.from("employees").update({ hourly_rate: 52.5 }).eq("id", emp(27));
    await S.manager.from("employees").update({ pin_code: "7777" }).eq("id", emp(28));
    const day = new Date(Date.now() + 9 * 864e5).toLocaleDateString("en-CA", { timeZone: "Africa/Johannesburg" });
    const shift = await S.manager.from("roster_shifts").insert({ company_id: CEC, store_id: STORE, employee_id: emp(27), shift_date: day,
      planned_start: `${day}T08:00:00+02:00`, planned_end: `${day}T16:00:00+02:00`, status: "scheduled" }).select("id").single();
    await S.manager.from("roster_shifts").update({ planned_end: `${day}T17:00:00+02:00` }).eq("id", shift.data?.id);
    const rate = sql(`select actor_email||'|'||(changes->'hourly_rate'->>'from')||'|'||(changes->'hourly_rate'->>'to') from hr_change_audit
                      where table_name='employees' and record_id='${emp(27)}' and changes ? 'hourly_rate' order by created_at desc limit 1`);
    const [who, from, to] = rate.split("|");
    check("AUD-01 a pay-rate change is audited with who, from and to", who === USERS.manager && Number(from) === 45 && Number(to) === 52.5, rate);
    const pin = sql(`select changes->'pin_code'->>'to' from hr_change_audit where table_name='employees' and record_id='${emp(28)}' and changes ? 'pin_code' order by created_at desc limit 1`);
    check("AUD-02 a PIN change is audited without the PIN", pin === "***", `stored as ${pin}`);
    const roster = sql(`select count(*) from hr_change_audit where table_name='roster_shifts' and record_id='${shift.data?.id}'`);
    check("AUD-03 roster creation and edits are audited", Number(roster) === 2, `rows=${roster}`);
    const empRead = await S.employee1.from("hr_change_audit").select("id").limit(5);
    const mgrRead = await S.manager.from("hr_change_audit").select("id").eq("company_id", CEC).limit(5);
    check("AUD-04 managers read the audit; employees cannot", (empRead.data?.length || 0) === 0 && (mgrRead.data?.length || 0) > 0,
      `employee=${empRead.data?.length} manager=${mgrRead.data?.length}`);
  }

  group("Go-live — leave working days and holidays (D19)");
  {
    const seeded = await S.admin.rpc("vyron_seed_sa_public_holidays", { p_company_id: CEC });
    const again = await S.admin.rpc("vyron_seed_sa_public_holidays", { p_company_id: CEC });
    check("LV-01 admin loads the SA public-holiday calendar once (27 Dec 2027 not loaded unless asked)",
      seeded.data === 27 && again.data === 0 && sql(`select count(*) from leave_public_holidays where company_id='${CEC}' and holiday_date='2027-12-27'`) === "0",
      `first=${seeded.data} second=${again.data} ${seeded.error?.message || ""}`);
    const empSeed = await S.employee1.rpc("vyron_seed_sa_public_holidays", { p_company_id: CEC });
    check("LV-02 an employee cannot change the holiday calendar", Boolean(empSeed.error), empSeed.error?.message || "allowed");
    const week = await S.manager.rpc("vyron_leave_working_days", { p_company_id: CEC, p_start: "2026-12-07", p_end: "2026-12-13" });
    const holidayWeek = await S.manager.rpc("vyron_leave_working_days", { p_company_id: CEC, p_start: "2026-12-14", p_end: "2026-12-20" });
    check("LV-03 a Mon–Sun week is 5 leave days; the week with 16 Dec is 4", Number(week.data) === 5 && Number(holidayWeek.data) === 4,
      `week=${week.data} with holiday=${holidayWeek.data}`);
    sql(`delete from leave_requests where employee_id='${emp(1)}'; delete from leave_balances where employee_id='${emp(1)}';`);
    const annual = await S.employee1.from("leave_requests").insert({ company_id: CEC, employee_id: emp(1), employee_name: "Qa1 Cook",
      leave_type: "annual_leave", start_date: "2026-12-14", end_date: "2026-12-20", status: "pending", requested_days: 99 }).select("id,requested_days").single();
    check("LV-04 the database sets requested days (client value ignored, weekend and holiday excluded)", Number(annual.data?.requested_days) === 4,
      annual.error?.message || `requested_days=${annual.data?.requested_days}`);
    const sick = await S.employee1.from("leave_requests").insert({ company_id: CEC, employee_id: emp(1), employee_name: "Qa1 Cook",
      leave_type: "sick_leave", start_date: "2026-12-21", end_date: "2026-12-22", status: "pending" }).select("id").single();
    await S.manager.from("leave_requests").update({ status: "approved" }).in("id", [annual.data?.id, sick.data?.id]);
    const balances = sql(`select string_agg(leave_type||'='||days_taken::numeric::float8, ',' order by leave_type) from leave_balances where employee_id='${emp(1)}'`);
    check("LV-05 each balance counts only its own leave type (annual 4, sick 2)", balances === "annual_leave=4,sick_leave=2", balances);
  }

  group("Go-live — narrow 062 columns (104)");
  {
    const cols = sql(`select string_agg(column_name||':'||data_type, ',' order by column_name) from information_schema.columns where table_name='companies' and column_name in ('user_limit','customer_status')`);
    const extra = sql(`select count(*) from information_schema.columns where table_name='companies' and column_name in ('plan_id','storage_limit_gb','api_request_limit','billing_frequency')`);
    const status = sql(`select string_agg(distinct customer_status, ',') from companies where id not in ('${CEC}','${OTHER}')`);
    check("LIC-01 only user_limit and customer_status were added; live companies stay active", cols === "customer_status:text,user_limit:integer" && extra === "0" && status === "active",
      `cols=${cols} other062cols=${extra} status=${status}`);
  }

  group("Go-live — server-side Force Logout (D29)");
  if (!APP_URL) {
    check("FL-00 Force Logout API tests (need QA_APP_URL)", true, "skipped — API server not running");
  } else {
    const target = createClient(URL_, ANON, { auth: { persistSession: false, autoRefreshToken: false } });
    const signIn = await target.auth.signInWithPassword({ email: USERS.employee2, password: "QaPass!2026x" });
    const token = uuid();
    sql(`insert into vyron_user_sessions(session_token,user_email,company_id,expires_at) values ('${token}','${USERS.employee2}','${CEC}',now()+interval '1 day')`);
    const denied = await fetch(`${APP_URL}/api/company/sessions/revoke`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${S.payroll.qaAccessToken}` }, body: JSON.stringify({ sessionToken: token }) });
    check("FL-01 a non-administrator cannot force a logout", denied.status === 403, `HTTP ${denied.status}`);
    const foreign = await fetch(`${APP_URL}/api/company/sessions/revoke`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${S.otherAdmin.qaAccessToken}` }, body: JSON.stringify({ sessionToken: token }) });
    check("FL-02 another company's admin cannot force-logout this session", foreign.status === 404, `HTTP ${foreign.status}`);
    const res = await fetch(`${APP_URL}/api/company/sessions/revoke`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${S.admin.qaAccessToken}` }, body: JSON.stringify({ sessionToken: token }) });
    const body = await res.json().catch(() => ({}));
    const refresh = await target.auth.refreshSession({ refresh_token: signIn.data.session.refresh_token });
    check("FL-03 Force Logout revokes the session and the person's refresh token stops working",
      res.status === 200 && body.authSessionsRevoked >= 1 && Boolean(refresh.error),
      `HTTP ${res.status} revoked=${body.authSessionsRevoked} refresh=${refresh.error?.message || "STILL WORKS"}`);
    const audit = sql(`select count(*) from vyron_audit_log where action='force_logout' and company_id='${CEC}'`);
    check("FL-04 Force Logout is audited", Number(audit) >= 1, `audit rows=${audit}`);
    const again = await login(USERS.employee2);
    const usable = await again.from("employees").select("id").eq("id", emp(2));
    check("FL-05 the person can sign in again afterwards", (usable.data?.length || 0) === 1, `rows=${usable.data?.length}`);
  }
}

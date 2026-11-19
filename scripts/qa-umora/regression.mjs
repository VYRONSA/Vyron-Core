// UMORA regression suite — LOCAL REPLICA ONLY (refuses any non-local Supabase URL).
// Usage (from repo root, local Supabase running with the production schema + 100..103):
//   set -a; . <local env with API_URL, ANON_KEY, SERVICE_ROLE_KEY>; set +a
//   node scripts/qa-umora/regression.mjs [security] [clocking] [operations] [payroll] [stress]
// QA_APP_URL=http://localhost:3200 additionally exercises the Next.js API routes.
import {
  APP_URL, CAPE_TOWN, CEC, OTHER, SANDTON, STORE, admin, check, eventsFor, group, kioskClock,
  login, pct, results, sql, summary, uuid,
} from "./lib.mjs";
import { USERS, seed } from "./seed.mjs";
import { writeFileSync } from "fs";

const only = new Set(process.argv.slice(2));
const want = (name) => only.size === 0 || only.has(name);

const { employees: E } = await seed();
const emp = (n) => E["CEC" + String(n).padStart(3, "0")];
const pinOf = (n) => String(1000 + n);

const S = {
  owner: await login(USERS.owner),
  admin: await login(USERS.admin),
  manager: await login(USERS.manager),
  payroll: await login(USERS.payroll),
  employee1: await login(USERS.employee1),
  employee2: await login(USERS.employee2),
  otherAdmin: await login(USERS.otherAdmin),
};

// =====================================================================================
if (want("security")) {
  group("Security — data exposure");
  {
    const r = await S.employee1.from("employees").select("id,employee_number,hourly_rate").eq("company_id", CEC);
    check("SEC-01 employee sees only their own employee record", (r.data?.length || 0) === 1 && r.data[0].employee_number === "CEC001",
      `rows=${r.data?.length} ${r.error?.message || ""}`);
    const p = await S.employee1.from("employees").select("pin_code").limit(1);
    check("SEC-02 employee cannot read pin_code", Boolean(p.error), p.error?.message || "pin_code readable");
    const m = await S.manager.from("employees").select("pin_code").eq("company_id", CEC).limit(5);
    check("SEC-03 manager cannot read pin_code either (kiosk devtools)", Boolean(m.error), m.error?.message || "pin_code readable by manager");
    const all = await S.manager.from("employees").select("id,pin_configured,hourly_rate").eq("company_id", CEC);
    check("SEC-04 manager reads the directory with pin_configured flag, not PINs", (all.data?.length || 0) === 60 && all.data.every((e) => e.pin_configured === true),
      `rows=${all.data?.length} ${all.error?.message || ""}`);
    // Positive self-service checks (catch policies that fail closed for an employee's own rows).
    await S.admin.rpc("vyron_manager_record_clock_event", { p_employee_id: emp(1), p_event_type: "clock_in", p_event_time: new Date(Date.now() - 26 * 3600e3).toISOString(), p_reason: "QA self-read setup" });
    sql(`insert into roster_shifts(company_id,store_id,employee_id,shift_date,planned_start,planned_end,status) values
      ('${CEC}','${STORE}','${emp(1)}',current_date+3,(current_date+3)+time '08:00',(current_date+3)+time '16:00','scheduled'),
      ('${CEC}','${STORE}','${emp(5)}',current_date+3,(current_date+3)+time '08:00',(current_date+3)+time '16:00','scheduled')`);
    const ownClock = await S.employee1.from("clock_events").select("id,employee_id");
    check("SEC-06 employee reads their own clockings and nobody else's",
      (ownClock.data?.length || 0) >= 1 && ownClock.data.every((r) => r.employee_id === emp(1)),
      `rows=${ownClock.data?.length} ${ownClock.error?.message || ""}`);
    const ownRoster = await S.employee1.from("roster_shifts").select("id,employee_id");
    check("SEC-07 employee reads their own roster and nobody else's",
      (ownRoster.data?.length || 0) === 1 && ownRoster.data[0].employee_id === emp(1),
      `rows=${ownRoster.data?.length} ${ownRoster.error?.message || ""}`);
    // Clean up so the clocking tests start from a known state.
    sql(`delete from clock_events where employee_id='${emp(1)}'; delete from clock_event_audit where employee_id='${emp(1)}';
         delete from roster_shifts where company_id='${CEC}';`);
    const star = await S.manager.from("employees").select("*").limit(1);
    check("SEC-05 select(*) on employees is refused for user sessions (forces explicit safe columns)", Boolean(star.error), star.error?.message || "select * allowed");
  }

  group("Security — tenant isolation (two companies)");
  {
    const a = await S.admin.from("employees").select("id").eq("company_id", OTHER);
    check("ISO-01 CEC admin cannot read OTHER employees", (a.data?.length || 0) === 0, `rows=${a.data?.length}`);
    const b = await S.otherAdmin.from("clock_events").select("id").eq("company_id", CEC).limit(5);
    check("ISO-02 OTHER admin cannot read CEC clockings", (b.data?.length || 0) === 0, `rows=${b.data?.length}`);
    const c = await kioskClock(S.admin, E.OTH001, "9999");
    check("ISO-03 CEC admin cannot clock an OTHER employee", c.ok === false && /not permitted|42501/i.test(`${c.code} ${c.message}`), `${c.code}: ${c.message}`);
    const d = await S.otherAdmin.from("company_users").insert({ company_id: CEC, user_email: USERS.otherAdmin, role: "admin", status: "active" });
    check("ISO-04 user cannot add themselves to another company", Boolean(d.error), d.error?.message || "joined CEC");
    const e = await S.admin.from("leave_requests").insert({ company_id: OTHER, employee_id: E.OTH001, employee_name: "x", start_date: "2026-12-01", end_date: "2026-12-02", status: "pending" });
    check("ISO-05 CEC admin cannot create leave in OTHER company", Boolean(e.error), e.error?.message || "created");
  }

  group("Security — role separation inside a company");
  {
    const a = await S.employee1.from("company_users").update({ role: "admin" }).eq("user_email", USERS.employee1).select("role");
    check("ROLE-01 employee cannot promote themselves", Boolean(a.error) || a.data?.[0]?.role !== "admin", a.error?.message || `role=${a.data?.[0]?.role}`);
    const b = await S.employee1.from("company_users").update({ status: "inactive" }).eq("user_email", USERS.admin).select("status");
    check("ROLE-02 employee cannot deactivate the admin", Boolean(b.error) || !b.data?.length, b.error?.message || `rows=${b.data?.length}`);
    const c = await S.employee1.from("employees").update({ hourly_rate: 450 }).eq("id", emp(1)).select("hourly_rate");
    check("ROLE-03 employee cannot change their own pay rate", Boolean(c.error) || !c.data?.length, c.error?.message || `rows=${c.data?.length}`);
    const d = await S.employee1.from("employees").update({ active: false }).eq("id", emp(10)).select("id");
    check("ROLE-04 employee cannot deactivate a colleague", Boolean(d.error) || !d.data?.length, d.error?.message || `rows=${d.data?.length}`);
    const e = await S.employee1.from("roster_shifts").insert({ company_id: CEC, store_id: STORE, employee_id: emp(1), shift_date: "2026-12-01", planned_start: "2026-12-01T06:00:00+02:00", planned_end: "2026-12-01T14:00:00+02:00", status: "scheduled" });
    check("ROLE-05 employee cannot create roster shifts", Boolean(e.error), e.error?.message || "created");
    const f = await S.employee1.from("leave_requests").insert({ company_id: CEC, employee_id: emp(1), employee_name: "Qa1 Cook", leave_type: "annual", start_date: "2026-12-20", end_date: "2026-12-22", status: "pending" }).select("id").single();
    check("ROLE-06 employee can file their own pending leave", !f.error, f.error?.message || "filed");
    if (f.data?.id) {
      const g = await S.employee1.from("leave_requests").update({ status: "approved" }).eq("id", f.data.id).select("status");
      check("ROLE-07 employee cannot approve their own leave", Boolean(g.error) || g.data?.[0]?.status !== "approved", g.error?.message || `status=${g.data?.[0]?.status}`);
    }
    const h = await S.employee1.from("leave_requests").insert({ company_id: CEC, employee_id: emp(5), employee_name: "Qa5", leave_type: "annual", start_date: "2026-12-20", end_date: "2026-12-21", status: "pending" });
    check("ROLE-08 employee cannot file leave for a colleague", Boolean(h.error), h.error?.message || "filed for colleague");
    const i = await S.admin.from("company_users").update({ role: "employee" }).eq("user_email", USERS.admin).select("role");
    check("ROLE-09 admin cannot change their own role", Boolean(i.error), i.error?.message || `role=${i.data?.[0]?.role}`);
    const j = await S.admin.from("company_users").update({ status: "inactive" }).eq("user_email", USERS.owner).select("status");
    check("ROLE-10 admin cannot deactivate an owner", Boolean(j.error), j.error?.message || "owner deactivated");
    const k = await S.admin.from("company_users").update({ role: "owner" }).eq("user_email", USERS.manager).select("role");
    check("ROLE-11 admin cannot grant the owner role", Boolean(k.error), k.error?.message || "owner granted");
    const l = await S.admin.from("company_users").update({ role: "supervisor" }).eq("user_email", USERS.manager).select("role");
    check("ROLE-12 admin CAN change a manager's role (legitimate)", !l.error && l.data?.[0]?.role === "supervisor", l.error?.message || `role=${l.data?.[0]?.role}`);
    await S.admin.from("company_users").update({ role: "manager" }).eq("user_email", USERS.manager);
    const m = await S.employee1.from("hr_cases").select("id").limit(1);
    check("ROLE-13 employee cannot read HR cases", (m.data?.length || 0) === 0, `rows=${m.data?.length} ${m.error?.message || ""}`);
    const n = await S.employee1.from("company_users").select("user_email").eq("company_id", CEC);
    check("ROLE-14 employee sees only their own membership row", (n.data?.length || 0) === 1, `rows=${n.data?.length}`);
  }

  group("Security — account takeover (migration 062 columns present)");
  {
    sql(`alter table companies add column if not exists user_limit integer, add column if not exists customer_status text not null default 'trial'; notify pgrst, 'reload schema';`);
    await new Promise((r) => setTimeout(r, 1500));
    const victim = sql(`select id from auth.users where email='${USERS.otherAdmin}'`);
    const a = await S.admin.from("company_users").insert({ company_id: CEC, user_email: "unused-x@cec-qa.test", user_id: victim, auth_user_id: victim, role: "staff", status: "active" }).select("id").single();
    check("ATO-01 a membership cannot point at another person's login", Boolean(a.error), a.error?.message || "forged row created");
    const b = await S.admin.from("company_users").insert({ company_id: CEC, user_email: USERS.otherAdmin, role: "staff", status: "active" }).select("id").single();
    check("ATO-02 (setup) admin may add an existing UMORA user by e-mail", !b.error, b.error?.message || "added");
    if (APP_URL && b.data?.id) {
      sql(`update company_users set user_id='${victim}', auth_user_id='${victim}' where id='${b.data.id}'`);
      const res = await fetch(`${APP_URL}/api/company/users/${b.data.id}/password`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${S.admin.qaAccessToken}` },
        body: JSON.stringify({ passwordMode: "manual", password: "Pwned!Qa2026xx", confirmPassword: "Pwned!Qa2026xx", requirePasswordChange: false }),
      });
      const body = await res.text();
      check("ATO-03 password of a user who belongs to another company cannot be reset", res.status >= 400, `HTTP ${res.status} ${body.slice(0, 160)}`);
      const v = await login(USERS.otherAdmin).then(() => "original password still works", (e) => "ORIGINAL PASSWORD BROKEN: " + e.message);
      check("ATO-04 the other company's admin keeps their own password", v.startsWith("original"), v);
    } else {
      check("ATO-03 password reset API (needs QA_APP_URL)", true, "skipped — API server not running");
    }
    sql(`delete from company_users where company_id='${CEC}' and user_email in ('unused-x@cec-qa.test','${USERS.otherAdmin}')`);
  }

  group("Security — deactivation, sessions, audit log, storage");
  {
    sql(`update company_users set status='inactive' where user_email='${USERS.payroll}'`);
    const a = await S.payroll.from("employees").select("id").eq("company_id", CEC);
    const b = await S.payroll.from("clock_events").select("id").eq("company_id", CEC).limit(5);
    check("DEACT-01 deactivated user loses access", (a.data?.length || 0) === 0 && (b.data?.length || 0) === 0, `employees=${a.data?.length} clocks=${b.data?.length}`);
    sql(`update company_users set status='active' where user_email='${USERS.payroll}'`);

    const token = uuid();
    sql(`insert into vyron_user_sessions(session_token,user_email,company_id,revoked_at,expires_at) values ('${token}','${USERS.employee1}','${CEC}',now(),now()+interval '1 day')`);
    const c = await S.employee1.from("vyron_user_sessions").update({ revoked_at: null }).eq("session_token", token).select("revoked_at");
    check("SESS-01 a revoked session cannot be restored by its user", Boolean(c.error) || c.data?.[0]?.revoked_at !== null, c.error?.message || "un-revoked");

    const outsider = await login(USERS.outsider);
    const d = await outsider.from("vyron_audit_log").select("id").is("company_id", null).limit(5);
    check("AUDIT-01 a signed-up outsider cannot read platform audit entries", (d.data?.length || 0) === 0, `rows=${d.data?.length}`);
    const e = await S.admin.from("vyron_audit_log").update({ action: "tampered" }).eq("company_id", CEC).select("id");
    check("AUDIT-02 audit log entries cannot be edited", Boolean(e.error) || !e.data?.length, e.error?.message || `rows=${e.data?.length}`);

    const f = await S.employee1.storage.from("clock-event-photos").upload(`${emp(9)}/qa/forged-${uuid()}.jpg`, new Blob([new Uint8Array([255, 216, 255])], { type: "image/jpeg" }));
    check("STOR-01 employee cannot plant a clock photo in a colleague's folder", Boolean(f.error), f.error?.message || "stored");
    const g = await S.employee1.storage.from("hr-documents").upload(`${CEC}/qa-${uuid()}.pdf`, new Blob(["x"], { type: "application/pdf" }));
    check("STOR-02 employee cannot upload HR documents", Boolean(g.error), g.error?.message || "stored");
    const h = await S.manager.storage.from("hr-documents").upload(`${CEC}/qa-${uuid()}.pdf`, new Blob(["x"], { type: "application/pdf" }));
    check("STOR-03 manager CAN upload HR documents (legitimate)", !h.error, h.error?.message || "stored");
  }
}

// =====================================================================================
if (want("clocking")) {
  group("Clocking — kiosk transaction");
  {
    const a = await kioskClock(S.manager, emp(1), pinOf(1));
    const ev = await eventsFor(emp(1));
    check("CLK-01 clock-in recorded by the server function", a.ok && ev.length === 1 && ev[0].event_type === "clock_in", a.message || `rows=${ev.length}`);
    const drift = Math.abs(new Date(ev[0].event_time) - new Date(ev[0].created_at));
    check("CLK-02 clock time is the server's time", drift < 1000, `event_time vs server insert: ${drift} ms`);
    check("CLK-03 attendance date and shift session assigned", ev[0].attendance_date && ev[0].shift_session_id === ev[0].id, JSON.stringify(ev[0]));
    const b = await kioskClock(S.manager, emp(1), pinOf(1), { action: "clock_in" });
    check("CLK-04 duplicate clock-in refused", b.ok === false && b.code === "already_clocked_in", b.code);
    const c = await kioskClock(S.manager, emp(1), pinOf(1));
    check("CLK-05 next tap clocks out", c.ok && c.event.event_type === "clock_out", c.message || c.event?.event_type);
    const d = await kioskClock(S.manager, emp(1), pinOf(1), { action: "clock_out" });
    check("CLK-06 duplicate clock-out refused", d.ok === false && d.code === "not_clocked_in", d.code);
    const audit = sql(`select count(*) from clock_event_audit where employee_id='${emp(1)}' and action='insert'`);
    check("CLK-07 every clocking is in the audit trail", audit === "2", `audit rows=${audit}`);
  }

  group("Clocking — PIN");
  {
    const a = await kioskClock(S.manager, emp(2), "0000");
    check("PIN-01 wrong PIN refused", a.ok === false && a.code === "pin_incorrect_pin", `${a.code} ${JSON.stringify(a.pin || {})}`);
    for (let i = 0; i < 4; i++) await kioskClock(S.manager, emp(2), "0000");
    const b = await kioskClock(S.manager, emp(2), pinOf(2));
    check("PIN-02 five wrong PINs lock the employee (even the right PIN is refused)", b.ok === false && b.code === "pin_locked", `${b.code}`);
    const logged = sql(`select count(*) from attendance_pin_failures where employee_id='${emp(2)}'`);
    check("PIN-03 failed attempts are logged", Number(logged) >= 5, `logged=${logged}`);
    sql(`update employees set pin_code='4321' where id='${emp(2)}'`);
    const c = await kioskClock(S.manager, emp(2), "4321");
    check("PIN-04 a new PIN set by a manager clears the lock", c.ok, c.message || "ok");
    const d = await S.employee1.rpc("vyron_verify_employee_pin", { p_employee_id: emp(5), p_pin: "1005" });
    check("PIN-05 an employee cannot test a colleague's PIN", Boolean(d.error), d.error?.message || JSON.stringify(d.data));
  }

  group("Clocking — direct writes and tampering");
  {
    const a = await S.employee1.from("clock_events").insert({ company_id: CEC, employee_id: emp(1), event_type: "clock_in", event_time: "2026-11-01T06:00:00Z", source: "kiosk" });
    check("TAMP-01 employee cannot insert (back-date) a clocking", Boolean(a.error), a.error?.message || "inserted");
    const b = await S.manager.from("clock_events").insert({ company_id: CEC, employee_id: emp(5), event_type: "clock_in", source: "kiosk" });
    check("TAMP-02 even a manager cannot insert directly (must use audited functions)", Boolean(b.error), b.error?.message || "inserted");
    const ev = (await eventsFor(emp(1)))[0];
    const c = await S.manager.from("clock_events").update({ event_time: "2026-11-01T06:00:00Z" }).eq("id", ev.id).select("id");
    check("TAMP-03 recorded times cannot be edited directly", Boolean(c.error) || !c.data?.length, c.error?.message || `rows=${c.data?.length}`);
    const d = await S.employee1.rpc("vyron_record_clock_event", { p_employee_id: emp(5), p_client_event_id: uuid(), p_source: "self", p_latitude: SANDTON.latitude, p_longitude: SANDTON.longitude });
    check("TAMP-04 employee cannot clock a colleague through the function", Boolean(d.error), d.error?.message || JSON.stringify(d.data));
    const e = await S.employee1.rpc("vyron_record_clock_event", { p_employee_id: emp(1), p_client_event_id: uuid(), p_source: "kiosk", p_pin: pinOf(1), p_latitude: SANDTON.latitude, p_longitude: SANDTON.longitude });
    check("TAMP-05 an employee login cannot operate the kiosk", Boolean(e.error), e.error?.message || JSON.stringify(e.data));
    const f = await S.employee1.rpc("vyron_manager_record_clock_event", { p_employee_id: emp(1), p_event_type: "clock_in", p_event_time: new Date(Date.now() - 3600e3).toISOString(), p_reason: "x" });
    check("TAMP-06 employee cannot use manual clock entry", Boolean(f.error), f.error?.message || "recorded");
    const g = await S.manager.rpc("vyron_manager_record_clock_event", { p_employee_id: emp(60), p_event_type: "clock_in", p_event_time: new Date(Date.now() - 3600e3).toISOString(), p_reason: "own" });
    check("TAMP-07 a manager cannot manually record their own attendance", Boolean(g.error), g.error?.message || "recorded");
    const h = await S.manager.rpc("vyron_manager_record_clock_event", { p_employee_id: emp(5), p_event_type: "clock_in", p_event_time: new Date(Date.now() - 3600e3).toISOString(), p_reason: "" });
    check("TAMP-08 manual entry requires a reason", Boolean(h.error), h.error?.message || "recorded");
  }

  group("Clocking — overnight, missed clock-out, debounce");
  {
    const start = new Date(); start.setDate(start.getDate() - 1); start.setHours(22, 0, 0, 0);
    const m = await S.admin.rpc("vyron_manager_record_clock_event", { p_employee_id: emp(6), p_event_type: "clock_in", p_event_time: start.toISOString(), p_reason: "QA overnight setup" });
    const state = await S.manager.rpc("vyron_employee_clock_state", { p_employee_id: emp(6) });
    const hoursOpen = (Date.now() - start.getTime()) / 3600e3;
    if (hoursOpen < 16) {
      check("NIGHT-01 after midnight the state is still clocked in", state.data?.open_shift === true && state.data?.next_action === "clock_out", JSON.stringify(state.data));
      const out = await kioskClock(S.manager, emp(6), pinOf(6));
      const evs = await eventsFor(emp(6));
      check("NIGHT-02 overnight clock-out recorded against the shift's start date", out.ok && out.event.event_type === "clock_out" && out.event.attendance_date === evs[0].attendance_date,
        `${out.message || out.event?.event_type} date=${out.event?.attendance_date} start=${evs[0].attendance_date}`);
    } else {
      check("NIGHT-01/02 overnight (clock-in 22:00 yesterday) — run before 14:00 for this path", !m.error, `${hoursOpen.toFixed(1)}h since 22:00; covered by NIGHT-03`);
    }
    // Deterministic overnight check independent of time of day: 8 hours ago.
    const eightAgo = new Date(Date.now() - 8 * 3600e3).toISOString();
    await S.admin.rpc("vyron_manager_record_clock_event", { p_employee_id: emp(12), p_event_type: "clock_in", p_event_time: eightAgo, p_reason: "QA 8h shift" });
    const st = await S.manager.rpc("vyron_employee_clock_state", { p_employee_id: emp(12) });
    check("NIGHT-03 an 8-hour-old clock-in is still an open shift", st.data?.open_shift === true && st.data?.next_action === "clock_out", JSON.stringify(st.data));

    const stale = new Date(Date.now() - 20 * 3600e3).toISOString();
    await S.admin.rpc("vyron_manager_record_clock_event", { p_employee_id: emp(7), p_event_type: "clock_in", p_event_time: stale, p_reason: "QA missed clock-out" });
    const a = await kioskClock(S.manager, emp(7), pinOf(7));
    const exc = sql(`select count(*) from time_exceptions where employee_id='${emp(7)}' and exception_type='missing_clock_out'`);
    check("MISS-01 a shift open longer than the maximum is flagged as a missed clock-out", a.ok && a.event.event_type === "clock_in" && exc === "1" && a.warnings.length > 0,
      `${a.message || a.event?.event_type} exceptions=${exc} warnings=${JSON.stringify(a.warnings)}`);
    await S.admin.rpc("vyron_manager_record_clock_event", { p_employee_id: emp(8), p_event_type: "clock_in", p_event_time: stale, p_reason: "QA sweep" });
    const sweep = await S.manager.rpc("vyron_flag_stale_open_shifts", { p_company_id: CEC });
    check("MISS-02 the manager sweep flags missed clock-outs without waiting for the next tap", (sweep.data || 0) >= 1, `flagged=${sweep.data} ${sweep.error?.message || ""}`);

    sql(`update attendance_settings set min_seconds_between_events=60 where company_id='${CEC}'`);
    const x = await kioskClock(S.manager, emp(13), pinOf(13));
    const y = await kioskClock(S.manager, emp(13), pinOf(13));
    check("DEB-01 a second tap seconds later is refused (no accidental clock-out)", x.ok && y.ok === false && y.code === "too_soon", `${x.ok} ${y.code}`);
    sql(`update attendance_settings set min_seconds_between_events=0 where company_id='${CEC}'`);
  }

  group("Clocking — location");
  {
    const a = await kioskClock(S.manager, emp(14), pinOf(14), { coords: CAPE_TOWN });
    const exc = sql(`select count(*) from time_exceptions where employee_id='${emp(14)}' and exception_type='wrong_store'`);
    check("GEO-01 flag mode: clocking 1,270 km away is recorded, flagged and raises an exception",
      a.ok && a.event.gps_verification_status === "outside_radius" && a.event.verification_status === "needs_review" && exc === "1",
      `${a.message || a.event?.gps_verification_status} dist=${a.event?.gps_distance_from_store_meters} exceptions=${exc}`);
    const b = await kioskClock(S.manager, emp(15), pinOf(15));
    check("GEO-02 on-site clocking is within radius", b.ok && b.event.gps_verification_status === "within_radius", b.event?.gps_verification_status || b.message);
    sql(`update attendance_settings set geofence_mode='block' where company_id='${CEC}'`);
    const c = await kioskClock(S.manager, emp(16), pinOf(16), { coords: CAPE_TOWN });
    check("GEO-03 block mode: off-site clocking refused", c.ok === false && c.code === "outside_geofence", `${c.code} ${c.message}`);
    sql(`update attendance_settings set geofence_mode='flag' where company_id='${CEC}'`);
    const d = await kioskClock(S.manager, emp(17), pinOf(17), { coords: null });
    check("GEO-04 no GPS refused when the company requires GPS", d.ok === false && d.code === "gps_required", d.code);
  }

  group("Clocking — idempotency and concurrency");
  {
    const attempt = uuid();
    const taps = await Promise.all(Array.from({ length: 5 }, () => kioskClock(S.manager, emp(20), pinOf(20), { attemptId: attempt })));
    const rows = await eventsFor(emp(20));
    check("IDEM-01 five retries of the same tap create exactly one clocking", rows.length === 1 && taps.every((t) => t.ok), `rows=${rows.length} duplicates=${taps.filter((t) => t.duplicate).length}`);
    const taps2 = await Promise.all(Array.from({ length: 5 }, () => kioskClock(S.manager, emp(21), pinOf(21), { action: "clock_in" })));
    const rows2 = await eventsFor(emp(21));
    check("IDEM-02 five simultaneous separate taps create exactly one clock-in", rows2.length === 1, `rows=${rows2.length} ok=${taps2.filter((t) => t.ok).length}`);
    const conflict = await kioskClock(S.manager, emp(22), pinOf(22), { attemptId: attempt });
    check("IDEM-03 an attempt id cannot be reused for another employee", conflict.ok === false && conflict.code === "client_event_id_conflict", conflict.code);
  }

  group("Clocking — offline synchronisation");
  {
    const id = uuid();
    const tenMinAgo = new Date(Date.now() - 10 * 60e3).toISOString();
    const a = await kioskClock(S.manager, emp(23), pinOf(23), { attemptId: id, source: "offline", clientTime: tenMinAgo, action: "clock_in" });
    check("OFF-01 offline clocking keeps the device time and is flagged for review", a.ok && a.event.event_time.slice(0, 16) === tenMinAgo.slice(0, 16) && a.event.verification_status === "needs_review",
      a.message || `${a.event?.event_time} ${a.event?.verification_status}`);
    const b = await kioskClock(S.manager, emp(23), pinOf(23), { attemptId: id, source: "offline", clientTime: tenMinAgo, action: "clock_in" });
    check("OFF-02 re-syncing the same offline item does not duplicate", b.ok && b.duplicate && (await eventsFor(emp(23))).length === 1, `duplicate=${b.duplicate}`);
    const c = await kioskClock(S.manager, emp(24), pinOf(24), { source: "offline", clientTime: new Date(Date.now() - 3 * 864e5).toISOString(), action: "clock_in" });
    check("OFF-03 offline clocking older than the allowed window is refused", c.ok === false && c.code === "client_time_out_of_range", c.code);
    const d = await kioskClock(S.manager, emp(24), pinOf(24), { source: "offline", clientTime: new Date(Date.now() + 3600e3).toISOString(), action: "clock_in" });
    check("OFF-04 offline clocking in the future is refused", d.ok === false && d.code === "client_time_out_of_range", d.code);
  }

  group("Clocking — corrections");
  {
    const ev = (await eventsFor(emp(1))).find((e) => e.event_type === "clock_out");
    const requested = new Date(new Date(ev.event_time).getTime() + 30 * 60e3).toISOString();
    const r = await S.manager.from("attendance_corrections").insert({ company_id: CEC, employee_id: emp(1), clock_event_id: ev.id, correction_type: "clock_out", requested_event_time: requested, reason: "Forgot to clock out after closing", status: "pending", requested_by: USERS.manager, original_record: ev }).select("id").single();
    check("CORR-01 manager can request a correction", !r.error, r.error?.message || "requested");
    const self = await S.manager.rpc("vyron_review_attendance_correction", { p_correction_id: r.data.id, p_decision: "approved", p_notes: "self" });
    check("CORR-02 the requester cannot approve their own correction", Boolean(self.error), self.error?.message || "approved");
    const emp1 = await S.employee1.rpc("vyron_review_attendance_correction", { p_correction_id: r.data.id, p_decision: "approved" });
    check("CORR-03 an employee cannot approve corrections", Boolean(emp1.error), emp1.error?.message || "approved");
    const ok = await S.admin.rpc("vyron_review_attendance_correction", { p_correction_id: r.data.id, p_decision: "approved", p_notes: "Confirmed with CCTV" });
    const after = (await eventsFor(emp(1))).find((e) => e.id === ev.id);
    check("CORR-04 approval updates the time and keeps the original", !ok.error && after.event_time.slice(0, 16) === requested.slice(0, 16) && after.original_event_time?.slice(0, 16) === ev.event_time.slice(0, 16),
      ok.error?.message || `now=${after.event_time} original=${after.original_event_time}`);
    const trail = sql(`select reason from clock_event_audit where clock_event_id='${ev.id}' and action='update' order by created_at desc limit 1`);
    check("CORR-05 the change is audited with the correction reason", trail.includes("Forgot to clock out"), trail);
    const again = await S.admin.rpc("vyron_review_attendance_correction", { p_correction_id: r.data.id, p_decision: "rejected" });
    check("CORR-06 a decided correction cannot be decided again", Boolean(again.error), again.error?.message || "re-decided");
    const own = await S.employee2.from("attendance_corrections").insert({ company_id: CEC, employee_id: emp(2), correction_type: "missing_clock_out", requested_event_time: new Date().toISOString(), reason: "Phone died", status: "pending" });
    check("CORR-07 an employee can request a correction to their own attendance", !own.error, own.error?.message || "requested");
    const forged = await S.employee2.from("attendance_corrections").insert({ company_id: CEC, employee_id: emp(2), correction_type: "clock_in", requested_event_time: new Date().toISOString(), reason: "x", status: "approved" });
    check("CORR-08 an employee cannot file a pre-approved correction", Boolean(forged.error), forged.error?.message || "inserted approved");
  }
}

if (want("golive")) {
  const mod = await import("./regression-golive.mjs");
  await mod.run({ S, E, emp, pinOf, want });
}

// Further groups (operations, payroll, stress) are appended in regression-ops.mjs.
if (want("operations") || want("payroll") || want("stress")) {
  const mod = await import("./regression-ops.mjs");
  await mod.run({ S, E, emp, pinOf, want });
}

const failed = summary();
writeFileSync(new URL("../../audit/backups/last-regression-results.json", import.meta.url), JSON.stringify({ at: new Date().toISOString(), results }, null, 2));
process.exit(failed ? 1 : 0);

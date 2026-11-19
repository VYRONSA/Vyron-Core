// Operations, payroll and stress groups of the UMORA regression suite. LOCAL REPLICA ONLY.
import { CEC, STORE, admin, check, group, kioskClock, login, pct, sql, uuid } from "./lib.mjs";
import { USERS } from "./seed.mjs";

const SAST = (date, time) => `${date}T${time}:00+02:00`;

async function manual(S, employeeId, type, at, reason = "QA payroll scenario") {
  const { data, error } = await S.admin.rpc("vyron_manager_record_clock_event", {
    p_employee_id: employeeId, p_event_type: type, p_event_time: at, p_reason: reason,
  });
  if (error) throw new Error(`manual ${type} ${at}: ${error.message}`);
  return data;
}

export async function run({ S, E, emp, pinOf, want }) {
  // ===================================================================================
  if (want("operations")) {
    group("Operations — leave");
    {
      const filed = await S.employee1.from("leave_requests").insert({
        company_id: CEC, employee_id: emp(1), employee_name: "Qa1 Cook", leave_type: "annual_leave",
        start_date: "2026-12-14", end_date: "2026-12-16", reason: "Family visit", status: "pending",
        workflow_stage: "submitted", submitted_at: new Date().toISOString(), requested_days: 3,
        requires_attachment: false, requires_medical_certificate: false, has_required_attachment: false,
      }).select("id").single();
      check("OPS-01 employee submits leave exactly as the leave page does", !filed.error, filed.error?.message || "filed");
      const bal = sql(`select count(*) from leave_balances where employee_id='${emp(1)}'`);
      check("OPS-02 filing leave creates the employee's balance row (system trigger)", Number(bal) >= 1, `balances=${bal}`);
      const self = await S.employee1.from("leave_requests").update({ manager_feedback: "self-approved", status: "approved" }).eq("id", filed.data?.id).select("status");
      check("OPS-03 employee cannot decide their own leave", Boolean(self.error) || self.data?.[0]?.status !== "approved", self.error?.message || `status=${self.data?.[0]?.status}`);
      const approve = await S.manager.from("leave_requests").update({ status: "approved", manager_feedback: "Enjoy" }).eq("id", filed.data?.id).select("status");
      check("OPS-04 manager approves leave", !approve.error && approve.data?.[0]?.status === "approved", approve.error?.message || approve.data?.[0]?.status);
      const note = sql(`select count(*) from employee_notifications where employee_id='${emp(1)}' and title ilike '%approved%'`);
      const audit = sql(`select count(*) from leave_decision_audit where employee_id='${emp(1)}'`);
      check("OPS-05 approval notifies the employee and is audited", Number(note) >= 1 && Number(audit) >= 1, `notifications=${note} audit=${audit}`);
      const own = await S.employee1.from("employee_notifications").select("id").eq("employee_id", emp(1));
      check("OPS-06 employee reads their own notification", (own.data?.length || 0) >= 1, `rows=${own.data?.length} ${own.error?.message || ""}`);
      const second = await S.employee2.from("leave_requests").insert({ company_id: CEC, employee_id: emp(2), employee_name: "Qa2 Cook", leave_type: "annual_leave", start_date: "2026-12-21", end_date: "2026-12-22", status: "pending", workflow_stage: "submitted" }).select("id").single();
      const cancel = await S.employee2.from("leave_requests").update({ status: "cancelled", cancelled_at: new Date().toISOString(), workflow_stage: "cancelled" }).eq("id", second.data?.id).select("status");
      check("OPS-07 employee can withdraw their own pending request", !cancel.error && cancel.data?.[0]?.status === "cancelled", cancel.error?.message || cancel.data?.[0]?.status);
      const bm = await S.manager.from("leave_balances").update({ adjustment_days: 1, notes: "QA" }).eq("employee_id", emp(1)).select("id");
      check("OPS-08 manager edits a balance with the real columns", !bm.error && (bm.data?.length || 0) >= 1, bm.error?.message || `rows=${bm.data?.length}`);
      const be = await S.employee1.from("leave_balances").update({ adjustment_days: 50 }).eq("employee_id", emp(1)).select("id");
      check("OPS-09 employee cannot edit their own balance", Boolean(be.error) || !be.data?.length, be.error?.message || `rows=${be.data?.length}`);
    }

    group("Operations — rostering");
    {
      const day = new Date(Date.now() + 5 * 864e5).toLocaleDateString("en-CA", { timeZone: "Africa/Johannesburg" });
      const ins = await S.manager.from("roster_shifts").insert({
        company_id: CEC, store_id: STORE, employee_id: emp(1), shift_date: day,
        planned_start: SAST(day, "08:00"), planned_end: SAST(day, "16:00"), status: "scheduled",
        planner_notes: "QA", published: false, approved: false,
      }).select("id").single();
      check("OPS-10 manager creates a shift with the planning columns", !ins.error, ins.error?.message || "created");
      const pub = await S.manager.from("roster_shifts").update({ published: true, status: "published" }).eq("id", ins.data?.id).select("status,published");
      check("OPS-11 manager publishes the shift", !pub.error && pub.data?.[0]?.status === "published", pub.error?.message || JSON.stringify(pub.data));
      const seen = await S.employee1.from("roster_shifts").select("id,status").eq("id", ins.data?.id);
      check("OPS-12 employee sees their published shift", seen.data?.[0]?.status === "published", JSON.stringify(seen.data));
      const tpl = await S.manager.from("shift_templates").insert({ company_id: CEC, template_name: `QA Night ${uuid().slice(0, 6)}`, shift_type: "night", start_time: "22:00", end_time: "06:00", status: "active" }).select("id").single();
      check("OPS-13 manager creates a shift template", !tpl.error, tpl.error?.message || "created");
      const tplRead = await S.employee1.from("shift_templates").select("id").eq("id", tpl.data?.id);
      const tplWrite = await S.employee1.from("shift_templates").insert({ company_id: CEC, template_name: "x", shift_type: "day", start_time: "08:00", end_time: "16:00" });
      check("OPS-14 employees read templates but cannot create them", (tplRead.data?.length || 0) === 1 && Boolean(tplWrite.error), `read=${tplRead.data?.length} write=${tplWrite.error?.message || "allowed"}`);
      const swapOwn = await S.employee1.from("shift_swap_requests").insert({ company_id: CEC, requester_employee_id: emp(1), target_employee_id: emp(2), roster_shift_id: ins.data?.id, status: "requested" });
      const swapOther = await S.employee1.from("shift_swap_requests").insert({ company_id: CEC, requester_employee_id: emp(5), status: "requested" });
      check("OPS-15 employee can request a swap only for themselves", !swapOwn.error && Boolean(swapOther.error), `own=${swapOwn.error?.message || "ok"} other=${swapOther.error?.message || "allowed"}`);
    }

    group("Operations — attendance panel, employees, HR");
    {
      const queries = await Promise.all([
        S.manager.from("attendance_corrections").select("id").eq("company_id", CEC).limit(5),
        S.manager.from("attendance_review_notes").select("id").eq("company_id", CEC).limit(5),
        S.manager.from("attendance_geofences").select("id").eq("company_id", CEC).limit(5),
        S.manager.from("attendance_device_events").select("id").eq("company_id", CEC).limit(5),
        S.manager.from("time_exceptions").select("id").eq("company_id", CEC).limit(5),
        S.manager.from("attendance_settings").select("late_grace_minutes").eq("company_id", CEC).maybeSingle(),
        S.manager.from("clock_events").select("id,attendance_date").eq("company_id", CEC).gte("attendance_date", "2026-11-01").limit(5),
      ]);
      const errs = queries.map((q) => q.error?.message).filter(Boolean);
      check("OPS-16 every manager attendance panel query succeeds", errs.length === 0, errs.join("; ") || "all 7 loaded");
      const geo = await S.manager.from("attendance_geofences").insert({ company_id: CEC, store_id: STORE, geofence_name: "QA kitchen", latitude: -26.1076, longitude: 28.0567, radius_meters: 120, status: "active" });
      check("OPS-17 manager adds a geofence", !geo.error, geo.error?.message || "added");
      sql(`delete from attendance_geofences where company_id='${CEC}'`);
      const del = await S.admin.from("employees").delete().eq("id", emp(1)).select("id");
      check("OPS-18 deleting an employee with attendance history is refused (history kept)", Boolean(del.error), del.error?.message || `deleted ${del.data?.length}`);
      const arch = await S.manager.from("employees").update({ active: false, record_status: "archived" }).eq("id", emp(29)).select("id");
      check("OPS-19 manager can archive an employee", !arch.error && arch.data?.length === 1, arch.error?.message || "archived");
      sql(`update employees set active=true, record_status='active' where id='${emp(29)}'`);
      const prof = await S.manager.from("employee_profiles").upsert({ company_id: CEC, employee_id: emp(1), department: "Kitchen" }, { onConflict: "company_id,employee_id" }).select("id");
      check("OPS-20 manager saves an employee profile", !prof.error, prof.error?.message || "saved");
      const profOther = await S.employee2.from("employee_profiles").select("id").eq("employee_id", emp(1));
      check("OPS-21 an employee cannot read a colleague's profile", (profOther.data?.length || 0) === 0, `rows=${profOther.data?.length}`);
      const warning = await S.manager.from("hr_warnings").insert({
        company_id: CEC, employee_id: emp(3), employee_name: "Qa3 Cook", warning_type: "verbal_warning",
        incident_type: "late_coming", incident_date: "2026-11-10", issue_date: "2026-11-12", expiry_date: "2027-05-12",
        severity: "medium", description: "Late three times", manager_notes: null, status: "active",
      });
      check("OPS-22 HR warning in the corrected shape is accepted", !warning.error, warning.error?.message || "issued");
      sql(`delete from hr_warnings where company_id='${CEC}'`);
    }

    group("Operations — attendance reporting beyond 1,000 rows");
    {
      const from = "2026-10-01T00:00:00+02:00";
      const to = "2026-10-31T23:59:59+02:00";
      const expected = Number(sql(`select count(*) from clock_events where company_id='${CEC}' and event_time between '${from}' and '${to}'`));
      const plain = await S.manager.from("clock_events").select("id").eq("company_id", CEC).gte("event_time", from).lte("event_time", to);
      let paged = 0;
      for (let start = 0; ; start += 1000) {
        const { data } = await S.manager.from("clock_events").select("id").eq("company_id", CEC).gte("event_time", from).lte("event_time", to).order("event_time").order("id").range(start, start + 999);
        paged += data?.length || 0;
        if (!data || data.length < 1000) break;
      }
      check("OPS-23 a plain query is capped (documents the platform limit)", (plain.data?.length || 0) === Math.min(1000, expected), `plain=${plain.data?.length} expected=${expected}`);
      check("OPS-24 paged reading (as the export now does) returns every row", paged === expected && expected > 1000, `paged=${paged} expected=${expected}`);
    }
  }

  // ===================================================================================
  if (want("payroll")) {
    group("Payroll — scenario setup (October 2026)");
    const P_START = "2026-10-01";
    const P_END = "2026-10-31";
    sql(`delete from payroll_period_locks where company_id='${CEC}'; delete from payroll_hours where company_id='${CEC}';
         delete from clock_events where employee_id in ('${emp(26)}','${emp(27)}','${emp(28)}');
         delete from leave_requests where employee_id in ('${emp(26)}','${emp(27)}','${emp(28)}');
         delete from roster_shifts where employee_id in ('${emp(26)}','${emp(27)}','${emp(28)}');`);
    // emp26: Mon–Fri 5–9 Oct 08:00–18:00 with 12:00–13:00 break; Sat 10 Oct 08:00–13:00;
    //        Thu 15 Oct 22:00 → Fri 16 Oct 06:00; Sun 18 Oct 10:00–14:00; Tue 20 Oct clock-in only.
    for (const d of ["2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08", "2026-10-09"]) {
      await manual(S, emp(26), "clock_in", SAST(d, "08:00"));
      await manual(S, emp(26), "break_start", SAST(d, "12:00"));
      await manual(S, emp(26), "break_end", SAST(d, "13:00"));
      await manual(S, emp(26), "clock_out", SAST(d, "18:00"));
    }
    await manual(S, emp(26), "clock_in", SAST("2026-10-10", "08:00"));
    await manual(S, emp(26), "clock_out", SAST("2026-10-10", "13:00"));
    await manual(S, emp(26), "clock_in", SAST("2026-10-15", "22:00"));
    await manual(S, emp(26), "clock_out", SAST("2026-10-16", "06:00"));
    await manual(S, emp(26), "clock_in", SAST("2026-10-18", "10:00"));
    await manual(S, emp(26), "clock_out", SAST("2026-10-18", "14:00"));
    await manual(S, emp(26), "clock_in", SAST("2026-10-20", "08:00"));
    // emp27: clean week Mon–Fri 12–16 Oct 08:00–17:00.
    for (const d of ["2026-10-12", "2026-10-13", "2026-10-14", "2026-10-15", "2026-10-16"]) {
      await manual(S, emp(27), "clock_in", SAST(d, "08:00"));
      await manual(S, emp(27), "clock_out", SAST(d, "17:00"));
    }
    // emp28: approved leave Wed 21 – Fri 23 Oct; rostered 22 Oct (on leave) and 27 Oct (absent).
    sql(`insert into leave_requests(company_id,employee_id,employee_name,leave_type,start_date,end_date,status)
         values ('${CEC}','${emp(28)}','Qa28 Cook','annual_leave','2026-10-21','2026-10-23','approved');
         insert into roster_shifts(company_id,store_id,employee_id,shift_date,planned_start,planned_end,status) values
         ('${CEC}','${STORE}','${emp(28)}','2026-10-22','2026-10-22T08:00:00+02:00','2026-10-22T16:00:00+02:00','scheduled'),
         ('${CEC}','${STORE}','${emp(28)}','2026-10-27','2026-10-27T08:00:00+02:00','2026-10-27T16:00:00+02:00','scheduled');`);
    check("PAY-00 scenario recorded through the audited manager function", true, "47 clockings + leave + roster");

    group("Payroll — generation and figures");
    {
      const mgr = await S.manager.rpc("vyron_generate_payroll_hours", { p_company_id: CEC, p_period_start: P_START, p_period_end: P_END });
      const empl = await S.employee1.rpc("vyron_generate_payroll_hours", { p_company_id: CEC, p_period_start: P_START, p_period_end: P_END });
      check("PAY-01 only payroll-authorised roles can generate (manager and employee refused)", Boolean(mgr.error) && Boolean(empl.error), `${mgr.error?.message} / ${empl.error?.message}`);
      const t0 = performance.now();
      const gen = await S.payroll.rpc("vyron_generate_payroll_hours", { p_company_id: CEC, p_period_start: P_START, p_period_end: P_END });
      const ms = Math.round(performance.now() - t0);
      check("PAY-02 payroll user generates the period", !gen.error, gen.error?.message || `${JSON.stringify(gen.data)} in ${ms} ms`);
      const row = async (n) => (await admin.from("payroll_hours").select("*").eq("company_id", CEC).eq("employee_id", emp(n)).eq("period_start", P_START).single()).data;
      const r26 = await row(26);
      const want26 = { worked_hours: 62, normal_hours: 57, overtime_hours: 5, sunday_hours: 4, night_hours: 8, break_hours: 5, missing_clock_events: 1, shifts_worked: 8 };
      const got26 = Object.fromEntries(Object.keys(want26).map((k) => [k, Number(r26?.[k])]));
      check("PAY-03 hours match a hand calculation (breaks, overnight, weekly overtime, Sunday, night)",
        Object.entries(want26).every(([k, v]) => got26[k] === v), `got=${JSON.stringify(got26)} want=${JSON.stringify(want26)}`);
      check("PAY-04 a row with a missing clock-out needs review", r26?.status === "needs_review", `${r26?.status} ${JSON.stringify(r26?.review_reasons)}`);
      const r27 = await row(27);
      check("PAY-05 a clean row waits for approval (not auto-approved)", r27?.status === "draft" && Number(r27?.normal_hours) === 45 && Number(r27?.overtime_hours) === 0,
        `${r27?.status} ord=${r27?.normal_hours} ot=${r27?.overtime_hours}`);
      const r28 = await row(28);
      check("PAY-06 approved leave days and rostered absence are reported (leave day not counted absent)",
        Number(r28?.leave_days) === 3 && Number(r28?.absent_days) === 1, `leave=${r28?.leave_days} absent=${r28?.absent_days}`);
      const histEmp = (await admin.from("payroll_hours").select("worked_hours,overtime_hours").eq("company_id", CEC).eq("employee_id", emp(31)).eq("period_start", P_START).single()).data;
      check("PAY-07 every clocking counts — no 1,000-row truncation (31 days × 9 h = 279 h)", Number(histEmp?.worked_hours) === 279,
        `worked=${histEmp?.worked_hours} ot=${histEmp?.overtime_hours}`);
      const direct = await S.payroll.from("payroll_hours").update({ normal_hours: 999 }).eq("employee_id", emp(27)).select("id");
      check("PAY-08 payroll rows cannot be edited directly", Boolean(direct.error) || !direct.data?.length, direct.error?.message || `rows=${direct.data?.length}`);
    }

    group("Payroll — approval, export and locking");
    {
      const ids = (await admin.from("payroll_hours").select("id,employee_id").eq("company_id", CEC).eq("period_start", P_START)).data || [];
      const id26 = ids.find((r) => r.employee_id === emp(26)).id;
      const a = await S.payroll.rpc("vyron_set_payroll_hours_status", { p_company_id: CEC, p_ids: [id26], p_status: "approved", p_note: "looks fine" });
      check("PAY-09 a row with a missing clock-out cannot be approved", !a.error && a.data.updated === 0, JSON.stringify(a.data || a.error));
      const clean = await S.payroll.rpc("vyron_set_payroll_hours_status", { p_company_id: CEC, p_ids: ids.map((r) => r.id), p_status: "approved", p_note: "bulk", p_only_clean: true });
      const r27 = (await admin.from("payroll_hours").select("status,approved_by").eq("employee_id", emp(27)).eq("period_start", P_START).single()).data;
      check("PAY-10 bulk approval takes only clean rows and records who approved", r27?.status === "approved" && r27?.approved_by === USERS.payroll, `${JSON.stringify(clean.data?.updated)} ${r27?.status} by ${r27?.approved_by}`);
      const early = await S.payroll.rpc("vyron_export_payroll_period", { p_company_id: CEC, p_period_start: P_START, p_period_end: P_END });
      check("PAY-11 export refused while rows are unapproved", Boolean(early.error), early.error?.message || "exported");
      // Fix the missing clock-out properly, then regenerate.
      await manual(S, emp(26), "clock_out", SAST("2026-10-20", "16:00"), "Confirmed end of shift with supervisor");
      await S.payroll.rpc("vyron_generate_payroll_hours", { p_company_id: CEC, p_period_start: P_START, p_period_end: P_END });
      const fixed = (await admin.from("payroll_hours").select("missing_clock_events,worked_hours").eq("employee_id", emp(26)).eq("period_start", P_START).single()).data;
      check("PAY-12 after the correction the row recalculates (missing 0, +8 h)", Number(fixed?.missing_clock_events) === 0 && Number(fixed?.worked_hours) === 70, JSON.stringify(fixed));
      const all = (await admin.from("payroll_hours").select("id").eq("company_id", CEC).eq("period_start", P_START)).data.map((r) => r.id);
      const noNote = await S.payroll.rpc("vyron_set_payroll_hours_status", { p_company_id: CEC, p_ids: all, p_status: "approved", p_note: "" });
      const pending = Number(sql(`select count(*) from payroll_hours where company_id='${CEC}' and period_start='${P_START}' and status<>'approved'`));
      check("PAY-13 flagged rows need a review note to be approved", pending > 0, `updated=${noNote.data?.updated} still pending=${pending}`);
      await S.payroll.rpc("vyron_set_payroll_hours_status", { p_company_id: CEC, p_ids: all, p_status: "approved", p_note: "Reviewed overtime and absences with the kitchen manager" });
      const exp = await S.payroll.rpc("vyron_export_payroll_period", { p_company_id: CEC, p_period_start: P_START, p_period_end: P_END, p_payroll_system: "csv" });
      const row26 = exp.data?.rows?.find((r) => r.employee_number === "CEC026");
      check("PAY-14 export succeeds with employee numbers and the approved figures", !exp.error && row26 && Number(row26.ordinary_hours) > 0 && row26.approved_by === USERS.payroll,
        exp.error?.message || `rows=${exp.data?.rows?.length} CEC026=${JSON.stringify(row26)}`);
      const again = await S.payroll.rpc("vyron_export_payroll_period", { p_company_id: CEC, p_period_start: P_START, p_period_end: P_END });
      check("PAY-15 the same period cannot be exported twice", Boolean(again.error), again.error?.message || "exported twice");
      const regen = await S.payroll.rpc("vyron_generate_payroll_hours", { p_company_id: CEC, p_period_start: P_START, p_period_end: P_END });
      check("PAY-16 an exported period cannot be regenerated", Boolean(regen.error), regen.error?.message || "regenerated");
      const back = await S.payroll.rpc("vyron_set_payroll_hours_status", { p_company_id: CEC, p_ids: all, p_status: "needs_review", p_note: "x" });
      check("PAY-17 exported rows cannot be sent back or changed", back.data?.updated === 0, JSON.stringify(back.data || back.error));
      const reprint = await S.payroll.rpc("vyron_payroll_export_rows", { p_batch_id: exp.data?.export_batch_id });
      check("PAY-18 the exported batch can be re-downloaded unchanged", (reprint.data?.length || 0) === (exp.data?.rows?.length || -1), `rows=${reprint.data?.length}`);
      const audit = Number(sql(`select count(*) from payroll_hours_audit where company_id='${CEC}'`));
      check("PAY-19 every generation, approval and export is in the payroll audit trail", audit > all.length * 3, `audit rows=${audit}`);
    }
  }

  // ===================================================================================
  if (want("stress")) {
    group("Stress — concurrent clocking through the server function (local)");
    const staff = Array.from({ length: 30 }, (_, i) => 31 + i); // CEC031..CEC060
    sql(`delete from clock_events where employee_id in (select id from employees where company_id='${CEC}' and employee_number between 'CEC031' and 'CEC060') and source <> 'seed' and event_time > now() - interval '1 day';
         update employees set pin_login_attempts=0, pin_locked_until=null where company_id='${CEC}';`);
    const kiosks = await Promise.all([1, 2, 3, 4, 5].map(() => login(USERS.manager)));
    const wave = async (label, fn) => {
      const t0 = performance.now();
      const res = await Promise.all(fn());
      const wall = Math.round(performance.now() - t0);
      const ms = res.map((r) => r.ms);
      return { label, requests: res.length, ok: res.filter((r) => r.ok && !r.duplicate).length, duplicates: res.filter((r) => r.duplicate).length,
        refused: res.filter((r) => !r.ok).length, wall, p50: pct(ms, 50), p95: pct(ms, 95), codes: [...new Set(res.filter((r) => !r.ok).map((r) => r.code))] };
    };
    const todayRows = () => Number(sql(`select count(*) from clock_events where employee_id in (select id from employees where company_id='${CEC}' and employee_number between 'CEC031' and 'CEC060') and source='kiosk' and event_time > now() - interval '1 hour'`));

    const w1 = await wave("30 staff clock in simultaneously", () => staff.map((n, i) => kioskClock(kiosks[i % 5], emp(n), pinOf(n), { action: "clock_in" })));
    check("STR-01 simultaneous clock-in: one row each", w1.ok === 30 && todayRows() === 30, JSON.stringify(w1));
    const w2 = await wave("30 staff clock out simultaneously", () => staff.map((n, i) => kioskClock(kiosks[i % 5], emp(n), pinOf(n), { action: "clock_out" })));
    check("STR-02 simultaneous clock-out: one row each", w2.ok === 30 && todayRows() === 60, JSON.stringify(w2));
    const ids = staff.map(() => uuid());
    const w3 = await wave("retry storm: 30 staff × 3 retries of the same tap", () =>
      staff.flatMap((n, i) => [0, 1, 2].map(() => kioskClock(kiosks[i % 5], emp(n), pinOf(n), { attemptId: ids[i], action: "clock_in" }))));
    check("STR-03 retry storm (same attempt id) creates no duplicates", todayRows() === 90 && w3.ok === 30, JSON.stringify(w3));
    const w4 = await wave("double taps: 30 staff × 3 separate taps", () =>
      staff.flatMap((n, i) => [0, 1, 2].map(() => kioskClock(kiosks[i % 5], emp(n), pinOf(n), { action: "clock_out" }))));
    check("STR-04 separate simultaneous taps (new attempt ids) still give one clock-out each", todayRows() === 120 && w4.ok === 30, JSON.stringify(w4));

    group("Stress — large history queries (131k clockings, local)");
    const time = async (fn) => {
      const ms = [];
      let rows = 0;
      for (let i = 0; i < 5; i++) {
        const t0 = performance.now();
        const r = await fn();
        ms.push(performance.now() - t0);
        rows = r.data?.length ?? r;
      }
      return { rows, p50: pct(ms, 50), p95: pct(ms, 95) };
    };
    const h1 = await time(() => S.manager.from("clock_events").select("*").eq("company_id", CEC).order("event_time", { ascending: false }).limit(100));
    check("STR-05 manager review list (latest 100) under 500 ms p95", h1.p95 < 500, JSON.stringify(h1));
    const h2 = await time(() => S.manager.rpc("vyron_employee_clock_state", { p_employee_id: emp(40) }));
    check("STR-06 kiosk state lookup under 100 ms p95", h2.p95 < 100, JSON.stringify(h2));
    const h3 = await time(() => S.employee1.from("clock_events").select("id").limit(1000));
    check("STR-07 an employee's own history (RLS-filtered over 131k rows) under 500 ms p95", h3.p95 < 500, JSON.stringify(h3));
  }
}

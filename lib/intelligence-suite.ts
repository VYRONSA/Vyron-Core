import "server-only";

import type {
  BurnoutAlert,
  BurnoutPredictorResult,
  BuddyAlert,
  BuddyClockingGuardResult,
  DepartmentHealthScore,
  ExecutiveDashboardSnapshot,
  IntelligenceInsight,
  LeakageEngineResult,
  LabourLeakageIntelligence,
  LeaveIntelligence,
  ManagerScorecard,
  PayrollIntelligenceSnapshot,
  RosterIntelligenceSnapshot,
  AttendanceIntelligence,
  OptimizationEngineResult,
  OverstaffedShift,
  WorkforceHealthEmployeeScore,
  WorkforceIntelligenceState,
} from "./intelligence-suite-types";

/**
 * Stage 2 — Workforce intelligence suite (server-only).
 * Pure aggregations over raw-ish DB-shaped records (employees, clock_events, roster_shifts).
 */

const BASE_RATE_ZAR_PER_HOUR = 85;
const MISSING_CLOCK_OUT_PENALTY_ZAR = 340;
const BUDDY_WINDOW_MS = 180_000;
const GPS_ROUND_DECIMALS = 4;
/** Manager approval cues for overtime vouching (clock_note / exception text). */
const VOUCH_KEYWORDS =
  /\b(vouch|vouched|authorised|authorized|approve[ds]?|approval|confirmed\s+by\s+mgr|mgr\s+(ok|okay|approve))\b/i;

/** Midday-ish shifts treated as candidate “low-traffic” windows for bloat detection. */
function isLowTrafficWindow(isoPlannedStart: string): boolean {
  const h = parseIsoHour(isoPlannedStart);
  return h !== null && h >= 10 && h <= 16;
}

function parseIsoHour(iso: string): number | null {
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : new Date(t).getHours();
}

function safeArray<T>(v: unknown): T[] {
  return Array.isArray(v) ? (v as T[]) : [];
}

function num(v: unknown, fallback = 0): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function str(v: unknown, fallback = ""): string {
  return v == null ? fallback : String(v);
}

interface EmployeeLite {
  id: string;
  first_name?: string;
  last_name?: string;
  job_title?: string | null;
  default_store_id?: string | null;
  department?: string | null;
  store_name?: string | null;
}

interface ClockLite {
  id?: string;
  employee_id?: string;
  store_id?: string | null;
  roster_shift_id?: string | null;
  event_type?: string;
  event_time?: string;
  source?: string;
  latitude?: number | null;
  longitude?: number | null;
  device_info?: string | null;
  clock_note?: string | null;
  /** Rare: direct IP column if synced from edge */
  ip_address?: string | null;
}

interface RosterLite {
  id?: string;
  employee_id?: string;
  store_id?: string | null;
  shift_date?: string;
  planned_start?: string;
  planned_end?: string;
  /** Optional managerial attribution */
  supervisor_id?: string | null;
  manager_id?: string | null;
}

interface LeaveLite {
  id?: string;
  employee_id?: string | null;
  leave_type?: string | null;
  start_date?: string;
  end_date?: string;
  status?: string;
  manager_feedback?: string | null;
  manager_approved_at?: string | null;
}

interface HrCaseLite {
  id?: string;
  employee_id?: string;
  case_type?: string;
  status?: string;
}

interface WarningLite {
  id?: string;
  employee_id?: string;
  severity?: string;
  status?: string;
}

interface PayrollCheckLite {
  id?: string;
  employee_id?: string | null;
  check_type?: string;
  severity?: string;
  status?: string;
  metadata?: Record<string, unknown> | null;
}

interface TrainingLite {
  id?: string;
  employee_id?: string | null;
  status?: string | null;
}

function employeeName(e: EmployeeLite): string {
  const fn = str(e.first_name).trim();
  const ln = str(e.last_name).trim();
  return [fn, ln].filter(Boolean).join(" ").trim() || str(e.id) || "Unknown";
}

function parseDevicePayload(raw: unknown): Record<string, unknown> {
  if (typeof raw !== "string" || !raw.trim()) return {};
  try {
    const o = JSON.parse(raw) as unknown;
    return typeof o === "object" && o !== null ? (o as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function fingerprintFromClock(ev: ClockLite): {
  deviceId: string | null;
  ip: string | null;
  gpsKey: string | null;
} {
  const merged: Record<string, unknown> = { ...parseDevicePayload(ev.device_info) };
  let deviceId =
    merged.deviceId ??
    merged.device_id ??
    merged["Device-ID"] ??
    merged.hardwareId ??
    merged.kiosk_terminal_id;
  let ip =
    merged.ip ??
    merged.client_ip ??
    merged.ipAddress ??
    merged.ip_address ??
    ev.ip_address;

  const lat = num(ev.latitude, NaN);
  const lng = num(ev.longitude, NaN);
  let gpsKey: string | null = null;
  if (Number.isFinite(lat) && Number.isFinite(lng)) {
    gpsKey = `${lat.toFixed(GPS_ROUND_DECIMALS)},${lng.toFixed(GPS_ROUND_DECIMALS)}`;
  }

  return {
    deviceId: deviceId != null && String(deviceId).trim() ? String(deviceId).trim() : null,
    ip: ip != null && String(ip).trim() ? String(ip).trim() : null,
    gpsKey,
  };
}

function isClockIn(ev: ClockLite): boolean {
  const t = str(ev.event_type).toLowerCase();
  return t === "in" || t === "clock_in" || t.includes("clock in");
}

function isClockOut(ev: ClockLite): boolean {
  const t = str(ev.event_type).toLowerCase();
  return t === "out" || t === "clock_out" || t.includes("clock out");
}

function minutesLate(clockInTime: Date, rosterStartIso: string): number {
  const planned = Date.parse(rosterStartIso);
  if (!Number.isFinite(planned)) return 0;
  const diffMs = clockInTime.getTime() - planned;
  return diffMs > 0 ? Math.round(diffMs / 60_000) : 0;
}

/** Overtime without vouched manager note → leakage at BASE_RATE. */
function unvouchedOvertimeHours(
  workedHours: number,
  rosterHours: number,
  lastOutNote: string | null | undefined,
): number {
  if (workedHours <= 0) return 0;
  if (!(rosterHours > 0)) {
    /** No roster baseline — cap assumed overtime leakage */
    return Math.min(workedHours, 12);
  }
  const grossOt = Math.max(0, workedHours - rosterHours);
  if (grossOt <= 0) return 0;
  if (VOUCH_KEYWORDS.test(str(lastOutNote))) return 0;
  return grossOt;
}

const MINUTE_RATE = BASE_RATE_ZAR_PER_HOUR / 60;

function leakageEngine(
  companyId: string,
  employees: EmployeeLite[],
  clockins: ClockLite[],
  rosters: RosterLite[],
): LeakageEngineResult {
  const empMap = new Map(employees.map((e) => [str(e.id), e]));
  const rosterById = new Map(rosters.map((r) => [str(r.id), r]));
  const storeForEmployee = (eid: string) => str(empMap.get(eid)?.default_store_id) || "_unassigned";

  const leakageByBranch: Record<string, number> = {};
  const leakageByMgrAcc: Record<string, number> = {};

  function addLeakage(branchKey: string, mgrKey: string, zar: number) {
    if (zar <= 0) return;
    leakageByBranch[branchKey] = (leakageByBranch[branchKey] || 0) + zar;
    leakageByMgrAcc[mgrKey] = (leakageByMgrAcc[mgrKey] || 0) + zar;
  }

  let total = 0;

  const shiftsByRoster: Record<
    string,
    { ins: ClockLite[]; outs: ClockLite[] }
  > = {};

  for (const c of clockins) {
    const rid = str(c.roster_shift_id);
    if (!rid || rid === "null") continue;
    if (!shiftsByRoster[rid]) shiftsByRoster[rid] = { ins: [], outs: [] };
    if (isClockIn(c)) shiftsByRoster[rid].ins.push(c);
    else if (isClockOut(c)) shiftsByRoster[rid].outs.push(c);
  }

  const processedOpens = new Set<string>();

  for (const roster of rosters) {
    const rid = str(roster.id);
    const eid = str(roster.employee_id);
    if (!rid || !eid) continue;
    const rosterRow = roster;
    const pack = shiftsByRoster[rid];
    const branchKey = storeForEmployee(eid) || str(rosterRow.store_id) || companyId;
    const mgrKey =
      str(rosterRow.supervisor_id) ||
      str(rosterRow.manager_id) ||
      `branch:${branchKey}`;

    const ps = str(rosterRow.planned_start);
    const pe = str(rosterRow.planned_end);
    const rosterMinutes =
      pe && ps && Number.isFinite(Date.parse(pe)) && Number.isFinite(Date.parse(ps)) ?
        Math.max(0, Date.parse(pe) - Date.parse(ps)) / 60_000 / 60
      : 0;

    if (pack?.ins?.length && pack?.outs?.length) {
      const firstInTime = [...pack.ins].sort(
        (a, b) => Date.parse(str(a.event_time)) - Date.parse(str(b.event_time)),
      )[0];
      const lastOut = [...pack.outs].sort(
        (a, b) => Date.parse(str(b.event_time)) - Date.parse(str(a.event_time)),
      )[0];
      const tin = Date.parse(str(firstInTime.event_time));
      const tout = Date.parse(str(lastOut.event_time));
      if (Number.isFinite(tin) && Number.isFinite(tout)) {
        const workedH = Math.max(0, (tout - tin) / 3_600_000);
        const lateMin = ps ? minutesLate(new Date(tin), ps) : 0;
        const lateZ = lateMin * MINUTE_RATE;

        const otH = unvouchedOvertimeHours(workedH, rosterMinutes, lastOut.clock_note ?? firstInTime.clock_note);
        const otZ = otH * BASE_RATE_ZAR_PER_HOUR;

        addLeakage(branchKey, mgrKey, otZ + lateZ);
        total += otZ + lateZ;
      }
    }

    /** Missing paired clock-out — open IN without OUT still open at end */
    const openPairs = [...(pack?.ins ?? [])].sort(
      (a, b) => Date.parse(str(a.event_time)) - Date.parse(str(b.event_time)),
    );

    /** Simple stack: unmatched ins */
    const stack: ClockLite[] = [];
    const ordered = [...(pack?.ins ?? []), ...(pack?.outs ?? [])].sort(
      (a, b) => Date.parse(str(a.event_time)) - Date.parse(str(b.event_time)),
    );

    stack.length = 0;
    for (const ev of ordered) {
      if (isClockIn(ev)) {
        stack.push(ev);
      } else if (isClockOut(ev) && stack.length) {
        stack.pop();
      }
    }
    for (const open of stack) {
      const k = `${str(open.id)}-${str(open.roster_shift_id)}`;
      if (!processedOpens.has(k)) {
        processedOpens.add(k);
        addLeakage(branchKey, mgrKey, MISSING_CLOCK_OUT_PENALTY_ZAR);
        total += MISSING_CLOCK_OUT_PENALTY_ZAR;
      }
    }
  }

  /** Clock events with no roster_shift_id: still detect dangling clock-in with no out */
  const byEmpNoRoster = new Map<string, ClockLite[]>();
  for (const ev of clockins) {
    if (str(ev.roster_shift_id)) continue;
    const eid = str(ev.employee_id);
    if (!eid) continue;
    if (!byEmpNoRoster.has(eid)) byEmpNoRoster.set(eid, []);
    byEmpNoRoster.get(eid)!.push(ev);
  }
  for (const [eid, evs] of byEmpNoRoster) {
    const branchKey = storeForEmployee(eid);
    const mgrKey = `branch:${branchKey}`;
    const ordered = [...evs].sort(
      (a, b) => Date.parse(str(a.event_time)) - Date.parse(str(b.event_time)),
    );
    const stack: ClockLite[] = [];
    for (const ev of ordered) {
      if (isClockIn(ev)) stack.push(ev);
      else if (isClockOut(ev) && stack.length) stack.pop();
    }
    for (const open of stack) {
      const k = `orphan-${str(open.id)}`;
      if (!processedOpens.has(k)) {
        processedOpens.add(k);
        addLeakage(branchKey, mgrKey, MISSING_CLOCK_OUT_PENALTY_ZAR);
        total += MISSING_CLOCK_OUT_PENALTY_ZAR;
      }
    }
  }

  const leakageByManager = Object.entries(leakageByMgrAcc).map(([managerKey, leakageZAR]) => ({
    managerKey,
    leakageZAR: Math.round(leakageZAR * 100) / 100,
  }));

  for (const b of Object.keys(leakageByBranch)) {
    leakageByBranch[b] = Math.round((leakageByBranch[b] ?? 0) * 100) / 100;
  }

  return {
    totalLeakageZAR: Math.round(total * 100) / 100,
    leakageByBranch,
    leakageByManager,
  };
}

function buddyClockingGuard(clockins: ClockLite[]): BuddyClockingGuardResult {
  const list = [...clockins].sort(
    (a, b) => Date.parse(str(a.event_time)) - Date.parse(str(b.event_time)),
  );
  const alerts: BuddyAlert[] = [];

  const addIfBuddy = (
    a: ClockLite,
    b: ClockLite,
    reason: BuddyAlert["reason"],
  ) => {
    const ea = str(a.employee_id);
    const eb = str(b.employee_id);
    if (!ea || !eb || ea === eb) return;
    alerts.push({
      incidentId: `buddy-${str(a.id ?? "na")}-${str(b.id ?? "na")}-${reason}`,
      employeeA: ea,
      employeeB: eb,
      anchorTime:
        str(a.event_time) < str(b.event_time) ? str(a.event_time) : str(b.event_time),
      reason,
    });
  };

  for (let i = 0; i < list.length; i++) {
    const ia = Date.parse(str(list[i].event_time));
    if (!Number.isFinite(ia)) continue;
    const fa = fingerprintFromClock(list[i]);
    for (let j = i + 1; j < list.length; j++) {
      const ib = Date.parse(str(list[j].event_time));
      if (!Number.isFinite(ib)) break;
      if (ib - ia > BUDDY_WINDOW_MS) break;
      const fb = fingerprintFromClock(list[j]);
      if (
        fa.deviceId &&
        fb.deviceId &&
        fa.deviceId === fb.deviceId
      ) {
        addIfBuddy(list[i], list[j], "device");
      } else if (
        fa.ip &&
        fb.ip &&
        fa.ip === fb.ip
      ) {
        addIfBuddy(list[i], list[j], "ip");
      } else if (
        fa.gpsKey &&
        fb.gpsKey &&
        fa.gpsKey === fb.gpsKey
      ) {
        addIfBuddy(list[i], list[j], "gps");
      }
    }
  }

  /** De-dupe by sorted pair + anchor minute */
  const seen = new Set<string>();
  const unique: BuddyAlert[] = [];
  for (const x of alerts) {
    const [p, q] = [x.employeeA, x.employeeB].sort();
    const key = `${p}|${q}|${x.reason}|${x.anchorTime.slice(0, 16)}`;
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(x);
    }
  }

  const offenderAcc: Record<string, number> = {};
  for (const u of unique) {
    offenderAcc[u.employeeA] = (offenderAcc[u.employeeA] || 0) + 1;
    offenderAcc[u.employeeB] = (offenderAcc[u.employeeB] || 0) + 1;
  }
  const repeatOffenders = Object.entries(offenderAcc)
    .map(([employeeId, incidentCount]) => ({ employeeId, incidentCount }))
    .filter((o) => o.incidentCount > 1)
    .sort((a, b) => b.incidentCount - a.incidentCount);

  const buddyClockingSuspicionScore = Math.min(100, unique.length * 12 + repeatOffenders.length * 15);

  return {
    buddyClockingSuspicionScore: Math.round(buddyClockingSuspicionScore * 10) / 10,
    activeBuddyAlerts: unique,
    repeatOffenders,
  };
}

function optimizationEngine(rosters: RosterLite[], clockins: ClockLite[]): OptimizationEngineResult {
  const bySlot = new Map<
    string,
    { rosterHeadcount: number; shift: RosterLite; rosterIds: Set<string> }
  >();

  for (const r of rosters) {
    const k = `${str(r.shift_date)}|${str(r.store_id)}|${str(r.planned_start)}|${str(r.planned_end)}`;
    if (!bySlot.has(k)) {
      bySlot.set(k, {
        rosterHeadcount: 0,
        shift: r,
        rosterIds: new Set(),
      });
    }
    const slot = bySlot.get(k)!;
    if (r.id && !slot.rosterIds.has(str(r.id))) {
      slot.rosterIds.add(str(r.id));
      slot.rosterHeadcount += 1;
    }
  }

  const clockInsByRoster = new Map<string, Set<string>>();
  for (const c of clockins) {
    if (!isClockIn(c)) continue;
    const rid = str(c.roster_shift_id);
    if (!rid) continue;
    if (!clockInsByRoster.has(rid)) clockInsByRoster.set(rid, new Set());
    clockInsByRoster.get(rid)!.add(str(c.employee_id));
  }

  const overstaffed: OverstaffedShift[] = [];
  let penaltyPoints = 0;

  for (const { rosterHeadcount, shift, rosterIds } of bySlot.values()) {
    if (rosterHeadcount <= 0) continue;
    if (!isLowTrafficWindow(str(shift.planned_start))) continue;

    const union = new Set<string>();
    for (const rid of rosterIds) {
      const s = clockInsByRoster.get(rid);
      if (s) for (const e of s) union.add(e);
    }
    const uniqueClockIns = union.size;
    const threshold = rosterHeadcount * 1.15;
    if (uniqueClockIns > threshold) {
      const overrunPct = ((uniqueClockIns - rosterHeadcount) / rosterHeadcount) * 100;
      const ps = Date.parse(str(shift.planned_start));
      const pe = Date.parse(str(shift.planned_end));
      const slotH =
        Number.isFinite(ps) && Number.isFinite(pe) ? Math.max(0, (pe - ps) / 3_600_000) : 0;
      const extraHeads = uniqueClockIns - rosterHeadcount;
      const wastedHoursEstimate = extraHeads * slotH;
      const wastedLaborZAR = wastedHoursEstimate * BASE_RATE_ZAR_PER_HOUR;
      overstaffed.push({
        rosterShiftId: str(shift.id) || [...rosterIds][0] || "unknown",
        storeId: shift.store_id ?? null,
        shiftDate: str(shift.shift_date),
        rosterHeadcount,
        uniqueClockIns,
        overrunPct: Math.round(overrunPct * 10) / 10,
        wastedHoursEstimate: Math.round(wastedHoursEstimate * 100) / 100,
        wastedLaborZAR: Math.round(wastedLaborZAR * 100) / 100,
      });
      penaltyPoints += Math.min(25, overrunPct);
    }
  }

  const optimizationIndex = Math.max(0, Math.min(100, 100 - penaltyPoints));
  const laborSavingsOpportunitiesZAR = overstaffed.reduce((s, o) => s + o.wastedLaborZAR, 0);

  return {
    optimizationIndex: Math.round(optimizationIndex * 10) / 10,
    overstaffedShifts: overstaffed,
    laborSavingsOpportunitiesZAR: Math.round(laborSavingsOpportunitiesZAR * 100) / 100,
  };
}

function distinctWorkDatesForEmployee(
  eid: string,
  clockins: ClockLite[],
): string[] {
  const days = new Set<string>();
  for (const c of clockins) {
    if (str(c.employee_id) !== eid) continue;
    if (!isClockIn(c)) continue;
    const d = str(c.event_time).slice(0, 10);
    if (d.length === 10) days.add(d);
  }
  return [...days].sort();
}

function maxConsecutiveWorkDays(dates: string[]): number {
  if (!dates.length) return 0;
  let best = 1;
  let run = 1;
  for (let i = 1; i < dates.length; i++) {
    const prev = Date.parse(`${dates[i - 1]}T12:00:00Z`);
    const cur = Date.parse(`${dates[i]}T12:00:00Z`);
    const diffDays = Math.round((cur - prev) / 86_400_000);
    if (diffDays === 1) {
      run += 1;
      best = Math.max(best, run);
    } else if (diffDays > 1) {
      run = 1;
    }
  }
  return best;
}

function rollingOvertimeHours(
  eid: string,
  rosters: RosterLite[],
  clockins: ClockLite[],
  windowDays: number,
): number {
  const now = Date.now();
  const winStart = now - windowDays * 86_400_000;
  let ot = 0;
  const shiftsByRoster: Record<string, { ins: ClockLite[]; outs: ClockLite[] }> = {};
  for (const c of clockins) {
    if (str(c.employee_id) !== eid) continue;
    const rid = str(c.roster_shift_id);
    if (!rid) continue;
    if (!shiftsByRoster[rid]) shiftsByRoster[rid] = { ins: [], outs: [] };
    if (isClockIn(c)) shiftsByRoster[rid].ins.push(c);
    else if (isClockOut(c)) shiftsByRoster[rid].outs.push(c);
  }

  for (const r of rosters) {
    if (str(r.employee_id) !== eid) continue;
    const rid = str(r.id);
    const pack = shiftsByRoster[rid];
    if (!pack?.ins?.length || !pack?.outs?.length) continue;
    const tin = Date.parse(str([...pack.ins].sort((a, b) => Date.parse(str(a.event_time)) - Date.parse(str(b.event_time)))[0].event_time));
    if (!Number.isFinite(tin) || tin < winStart) continue;
    const lastOut = [...pack.outs].sort(
      (a, b) => Date.parse(str(b.event_time)) - Date.parse(str(a.event_time)),
    )[0];
    const tout = Date.parse(str(lastOut.event_time));
    const ps = Date.parse(str(r.planned_start));
    const pe = Date.parse(str(r.planned_end));
    if (!Number.isFinite(tout) || !Number.isFinite(ps) || !Number.isFinite(pe)) continue;
    const workedH = Math.max(0, (tout - tin) / 3_600_000);
    const rosterH = Math.max(0, (pe - ps) / 3_600_000);
    ot += Math.max(0, workedH - rosterH);
  }
  return ot;
}

function punctualitySeries(
  eid: string,
  rosters: RosterLite[],
  clockins: ClockLite[],
): { recentAvgLate: number; historicalAvgLate: number } {
  const rosterById = new Map(rosters.map((r) => [str(r.id), r]));
  const lates: { t: number; late: number }[] = [];
  for (const c of clockins) {
    if (str(c.employee_id) !== eid || !isClockIn(c)) continue;
    const rid = str(c.roster_shift_id);
    const r = rosterById.get(rid);
    if (!r?.planned_start) continue;
    const tin = Date.parse(str(c.event_time));
    if (!Number.isFinite(tin)) continue;
    lates.push({ t: tin, late: minutesLate(new Date(tin), r.planned_start) });
  }
  lates.sort((a, b) => a.t - b.t);
  if (!lates.length) return { recentAvgLate: 0, historicalAvgLate: 0 };
  const historicalAvgLate = lates.reduce((s, x) => s + x.late, 0) / lates.length;
  const fourteenDaysAgo = Date.now() - 14 * 86_400_000;
  const recent = lates.filter((x) => x.t >= fourteenDaysAgo);
  const recentAvgLate =
    recent.length ? recent.reduce((s, x) => s + x.late, 0) / recent.length : historicalAvgLate;
  return { recentAvgLate, historicalAvgLate };
}

function burnoutPredictor(
  employees: EmployeeLite[],
  clockins: ClockLite[],
  rosters: RosterLite[],
): BurnoutPredictorResult {
  const alerts: BurnoutAlert[] = [];

  for (const e of employees) {
    const eid = str(e.id);
    if (!eid) continue;
    const name = employeeName(e);
    const dept = str(e.job_title) || str(e.department) || "Unassigned";

    const days = distinctWorkDatesForEmployee(eid, clockins);
    const consec = maxConsecutiveWorkDays(days);

    const ot30 = rollingOvertimeHours(eid, rosters, clockins, 30);
    const { recentAvgLate, historicalAvgLate } = punctualitySeries(eid, rosters, clockins);

    let riskFactor = "";
    if (consec > 6) {
      riskFactor = `${consec} consecutive workdays without rest`;
      alerts.push({ employeeId: eid, name, department: dept, riskFactor });
    }
    if (ot30 > 30) {
      riskFactor = `Overtime ${Math.round(ot30 * 10) / 10}h in last 30 days`;
      alerts.push({ employeeId: eid, name, department: dept, riskFactor });
    }
    /** Punctuality “drop”: more lateness vs personal baseline (>15%). */
    if (
      historicalAvgLate >= 2 &&
      recentAvgLate > historicalAvgLate * 1.15
    ) {
      riskFactor = `Clock-in punctuality worsened (~${Math.round((recentAvgLate / historicalAvgLate - 1) * 100)}% more late minutes vs baseline)`;
      alerts.push({ employeeId: eid, name, department: dept, riskFactor });
    }
  }

  /** Global stress 0–100 from alert density */
  const globalBurnoutIndex = Math.min(
    100,
    alerts.length * 8 + (employees.length ? (alerts.length / employees.length) * 40 : 0),
  );

  return {
    globalBurnoutIndex: Math.round(globalBurnoutIndex * 10) / 10,
    highRiskEmployeeAlerts: alerts,
  };
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

function minutesBetweenIso(a: string, b: string): number {
  const ta = Date.parse(a);
  const tb = Date.parse(b);
  if (!Number.isFinite(ta) || !Number.isFinite(tb)) return 0;
  return Math.max(0, Math.round((tb - ta) / 60_000));
}

function avg(nums: number[]): number {
  if (!nums.length) return 0;
  return nums.reduce((s, n) => s + n, 0) / nums.length;
}

function clampPct(v: number): number {
  return Math.max(0, Math.min(100, round2(v)));
}

function scoreBand(score: number): WorkforceHealthEmployeeScore["band"] {
  if (score >= 85) return "Excellent";
  if (score >= 70) return "Good";
  if (score >= 50) return "Needs Attention";
  return "High Risk";
}

function calcExtraHours(
  r: RosterLite,
  firstInIso: string,
  lastOutIso: string,
): { worked: number; scheduled: number; overtime: number; variance: number } {
  const ps = Date.parse(str(r.planned_start));
  const pe = Date.parse(str(r.planned_end));
  const tin = Date.parse(firstInIso);
  const tout = Date.parse(lastOutIso);
  const worked = Number.isFinite(tin) && Number.isFinite(tout) ? Math.max(0, (tout - tin) / 3_600_000) : 0;
  const scheduled = Number.isFinite(ps) && Number.isFinite(pe) ? Math.max(0, (pe - ps) / 3_600_000) : 0;
  const overtime = Math.max(0, worked - scheduled);
  return { worked, scheduled, overtime, variance: worked - scheduled };
}

function computePhase1Intelligence(input: {
  companyId: string;
  employees: EmployeeLite[];
  clockins: ClockLite[];
  rosters: RosterLite[];
  leaveRequests: LeaveLite[];
  hrCases: HrCaseLite[];
  warnings: WarningLite[];
  payrollChecks: PayrollCheckLite[];
  trainings: TrainingLite[];
  leakage: LeakageEngineResult;
}): {
  labourLeakage: LabourLeakageIntelligence;
  attendance: AttendanceIntelligence;
  leave: LeaveIntelligence;
  roster: RosterIntelligenceSnapshot;
  payroll: PayrollIntelligenceSnapshot;
  workforceHealth: WorkforceHealthEmployeeScore[];
  departmentHealth: DepartmentHealthScore[];
  managerScorecard: ManagerScorecard[];
  executiveDashboard: ExecutiveDashboardSnapshot;
  insights: IntelligenceInsight[];
} {
  const { companyId, employees, clockins, rosters, leaveRequests, hrCases, warnings, payrollChecks, trainings, leakage } = input;
  const employeeById = new Map(employees.map((e) => [str(e.id), e]));
  const empName = (eid: string) => employeeName(employeeById.get(eid) || { id: eid });
  const empDept = (eid: string) => str(employeeById.get(eid)?.job_title) || "Unassigned";

  const rosterById = new Map(rosters.map((r) => [str(r.id), r]));
  const eventsByRoster = new Map<string, ClockLite[]>();
  for (const c of clockins) {
    const rid = str(c.roster_shift_id);
    if (!rid) continue;
    if (!eventsByRoster.has(rid)) eventsByRoster.set(rid, []);
    eventsByRoster.get(rid)!.push(c);
  }

  const employeeRisk = new Map<string, {
    score: number;
    leakage: number;
    triggers: Set<string>;
    lateArrivals: number;
    missed: number;
    unapprovedOt: number;
  }>();
  const ensureEmpRisk = (eid: string) => {
    if (!employeeRisk.has(eid)) {
      employeeRisk.set(eid, { score: 0, leakage: 0, triggers: new Set<string>(), lateArrivals: 0, missed: 0, unapprovedOt: 0 });
    }
    return employeeRisk.get(eid)!;
  };

  const deptOvertime = new Map<string, { overtimeHours: number; employeeIds: Set<string> }>();
  const deptLeakage = new Map<string, number>();

  let repeatedLateArrivals = 0;
  let unapprovedOvertime = 0;
  let missingClockEvents = 0;
  let excessiveAbsenteeism = 0;
  let duplicateCorrections = 0;
  const lateMinutesAll: number[] = [];
  let punctualEvents = 0;
  let totalScheduled = 0;
  let attendedScheduled = 0;
  let scheduledHours = 0;
  let workedHours = 0;
  let overstaffingHours = 0;
  let understaffingHours = 0;
  let overtimeFromRosterHours = 0;

  for (const r of rosters) {
    const rid = str(r.id);
    const eid = str(r.employee_id);
    if (!rid || !eid) continue;
    totalScheduled += 1;

    const events = (eventsByRoster.get(rid) || []).sort(
      (a, b) => Date.parse(str(a.event_time)) - Date.parse(str(b.event_time)),
    );
    const ins = events.filter(isClockIn);
    const outs = events.filter(isClockOut);

    const plannedStart = str(r.planned_start);
    if (ins.length === 0 || outs.length === 0) {
      missingClockEvents += 1;
      const row = ensureEmpRisk(eid);
      row.score += 10;
      row.leakage += MISSING_CLOCK_OUT_PENALTY_ZAR;
      row.triggers.add("missing_clock_event");
      row.missed += 1;
      continue;
    }

    attendedScheduled += 1;
    const firstIn = ins[0];
    const lastOut = outs[outs.length - 1];
    const late = plannedStart ? minutesLate(new Date(Date.parse(str(firstIn.event_time))), plannedStart) : 0;
    lateMinutesAll.push(late);
    if (late <= 5) punctualEvents += 1;
    if (late >= 10) {
      repeatedLateArrivals += 1;
      const row = ensureEmpRisk(eid);
      row.score += Math.min(12, Math.floor(late / 5));
      row.leakage += late * MINUTE_RATE;
      row.triggers.add("late_arrival");
      row.lateArrivals += 1;
    }

    const extra = calcExtraHours(r, str(firstIn.event_time), str(lastOut.event_time));
    scheduledHours += extra.scheduled;
    workedHours += extra.worked;
    overtimeFromRosterHours += extra.overtime;

    if (extra.variance > 0) overstaffingHours += extra.variance;
    if (extra.variance < 0) understaffingHours += Math.abs(extra.variance);

    const unapproved = unvouchedOvertimeHours(
      extra.worked,
      extra.scheduled,
      lastOut.clock_note ?? firstIn.clock_note,
    );
    if (unapproved > 0) {
      unapprovedOvertime += 1;
      const row = ensureEmpRisk(eid);
      row.score += Math.min(15, Math.round(unapproved * 2));
      row.leakage += unapproved * BASE_RATE_ZAR_PER_HOUR;
      row.triggers.add("unapproved_overtime");
      row.unapprovedOt += 1;
      const dept = empDept(eid);
      if (!deptOvertime.has(dept)) {
        deptOvertime.set(dept, { overtimeHours: 0, employeeIds: new Set<string>() });
      }
      const d = deptOvertime.get(dept)!;
      d.overtimeHours += unapproved;
      d.employeeIds.add(eid);
    }
  }

  const clockChecksByEmpDay = new Set<string>();
  for (const c of clockins) {
    const eid = str(c.employee_id);
    const day = str(c.event_time).slice(0, 10);
    if (eid && day.length === 10) {
      clockChecksByEmpDay.add(`${eid}|${day}`);
    }
  }

  const leaveDaysByDept = new Map<string, number>();
  const leaveByEmp = new Map<string, LeaveLite[]>();
  let repeatedMondays = 0;
  let repeatedFridays = 0;
  let adjacentPublicHolidays = 0;
  const monthLeave = new Map<string, number>();

  for (const l of leaveRequests) {
    const eid = str(l.employee_id);
    if (!eid) continue;
    if (!leaveByEmp.has(eid)) leaveByEmp.set(eid, []);
    leaveByEmp.get(eid)!.push(l);

    const start = str(l.start_date);
    const end = str(l.end_date);
    const s = Date.parse(`${start}T12:00:00Z`);
    const e = Date.parse(`${end}T12:00:00Z`);
    const days = Number.isFinite(s) && Number.isFinite(e) ? Math.max(1, Math.round((e - s) / 86_400_000) + 1) : 1;
    const dept = empDept(eid);
    leaveDaysByDept.set(dept, (leaveDaysByDept.get(dept) || 0) + days);
    monthLeave.set(start.slice(0, 7), (monthLeave.get(start.slice(0, 7)) || 0) + days);

    const dayOfWeek = Number.isFinite(s) ? new Date(s).getUTCDay() : -1;
    if (dayOfWeek === 1) repeatedMondays += 1;
    if (dayOfWeek === 5) repeatedFridays += 1;

    const nearHoliday = (() => {
      const st = dayOfWeek;
      const en = Number.isFinite(e) ? new Date(e).getUTCDay() : -1;
      return st === 1 || st === 5 || en === 1 || en === 5;
    })();
    if (nearHoliday) adjacentPublicHolidays += 1;
  }

  for (const [eid, lv] of leaveByEmp) {
    if (lv.length >= 3) {
      const monFriHits = lv.filter((l) => {
        const dt = Date.parse(`${str(l.start_date)}T12:00:00Z`);
        if (!Number.isFinite(dt)) return false;
        const d = new Date(dt).getUTCDay();
        return d === 1 || d === 5;
      }).length;
      if (monFriHits >= 2) {
        const row = ensureEmpRisk(eid);
        row.score += 8;
        row.triggers.add("leave_pattern_monday_friday");
      }
    }
  }

  for (const e of employees) {
    const eid = str(e.id);
    const leaves = leaveByEmp.get(eid) || [];
    const pendingLeaves = leaves.filter((l) => str(l.status).toLowerCase() !== "approved").length;
    if (pendingLeaves >= 2) {
      const row = ensureEmpRisk(eid);
      row.score += 6;
      row.triggers.add("pending_leave_cluster");
    }

    const empShifts = rosters.filter((r) => str(r.employee_id) === eid);
    const missingShiftDays = empShifts.filter((r) => {
      const rid = str(r.id);
      const events = eventsByRoster.get(rid) || [];
      return !events.some(isClockIn);
    }).length;
    if (missingShiftDays >= 2) {
      excessiveAbsenteeism += 1;
      const row = ensureEmpRisk(eid);
      row.score += Math.min(15, missingShiftDays * 4);
      row.triggers.add("excessive_absenteeism");
    }
  }

  const duplicateCorrectionKeys = new Map<string, number>();
  for (const c of clockins) {
    const note = str(c.clock_note).toLowerCase();
    if (!note.includes("correct")) continue;
    const key = `${str(c.employee_id)}|${str(c.roster_shift_id)}|${str(c.event_type)}`;
    duplicateCorrectionKeys.set(key, (duplicateCorrectionKeys.get(key) || 0) + 1);
  }
  for (const count of duplicateCorrectionKeys.values()) {
    if (count > 1) duplicateCorrections += count - 1;
  }

  const repeatedLateByEmp = new Map<string, number>();
  for (const [eid, r] of employeeRisk) {
    if (r.lateArrivals > 1) repeatedLateByEmp.set(eid, r.lateArrivals);
  }

  const employeeRiskRanking = Array.from(employeeRisk.entries())
    .map(([employeeId, r]) => ({
      employeeId,
      name: empName(employeeId),
      department: empDept(employeeId),
      riskScore: Math.min(100, r.score),
      estimatedLeakageZAR: round2(r.leakage),
      triggers: Array.from(r.triggers),
    }))
    .sort((a, b) => b.riskScore - a.riskScore || b.estimatedLeakageZAR - a.estimatedLeakageZAR)
    .slice(0, 20);

  for (const row of employeeRiskRanking) {
    deptLeakage.set(row.department, (deptLeakage.get(row.department) || 0) + row.estimatedLeakageZAR);
  }

  const departmentRiskRanking = Array.from(deptLeakage.entries())
    .map(([department, estimatedLeakageZAR]) => {
      const deptEmployees = employeeRiskRanking.filter((r) => r.department === department);
      const riskScore = deptEmployees.length ? round2(avg(deptEmployees.map((r) => r.riskScore))) : 0;
      return { department, riskScore, estimatedLeakageZAR: round2(estimatedLeakageZAR) };
    })
    .sort((a, b) => b.riskScore - a.riskScore || b.estimatedLeakageZAR - a.estimatedLeakageZAR);

  const highOvertimeDepartments = Array.from(deptOvertime.entries())
    .map(([department, v]) => ({
      department,
      overtimeHours: round2(v.overtimeHours),
      employeeCount: v.employeeIds.size,
    }))
    .sort((a, b) => b.overtimeHours - a.overtimeHours)
    .slice(0, 10);

  const attendancePct = totalScheduled > 0 ? clampPct((attendedScheduled / totalScheduled) * 100) : 0;
  const punctualityPct = lateMinutesAll.length > 0 ? clampPct((punctualEvents / lateMinutesAll.length) * 100) : 0;
  const missedShiftPct = totalScheduled > 0 ? clampPct(((totalScheduled - attendedScheduled) / totalScheduled) * 100) : 0;
  const averageLatenessMinutes = lateMinutesAll.length ? round2(avg(lateMinutesAll)) : 0;

  const trendByWeek = new Map<string, { sched: number; attended: number; punctual: number; lateSamples: number }>();
  for (const r of rosters) {
    const d = str(r.shift_date);
    const wk = d ? `${d.slice(0, 7)}-W${Math.ceil(Number(d.slice(8, 10)) / 7)}` : "unknown";
    if (!trendByWeek.has(wk)) trendByWeek.set(wk, { sched: 0, attended: 0, punctual: 0, lateSamples: 0 });
    const row = trendByWeek.get(wk)!;
    row.sched += 1;
    const ev = eventsByRoster.get(str(r.id)) || [];
    const inEv = ev.filter(isClockIn).sort((a, b) => Date.parse(str(a.event_time)) - Date.parse(str(b.event_time)))[0];
    if (inEv) {
      row.attended += 1;
      const late = minutesLate(new Date(Date.parse(str(inEv.event_time))), str(r.planned_start));
      row.lateSamples += 1;
      if (late <= 5) row.punctual += 1;
    }
  }

  const trend = Array.from(trendByWeek.entries())
    .map(([label, x]) => ({
      label,
      attendancePct: x.sched ? clampPct((x.attended / x.sched) * 100) : 0,
      punctualityPct: x.lateSamples ? clampPct((x.punctual / x.lateSamples) * 100) : 0,
      missedShiftPct: x.sched ? clampPct(((x.sched - x.attended) / x.sched) * 100) : 0,
    }))
    .sort((a, b) => a.label.localeCompare(b.label))
    .slice(-8);

  const deptShiftStats = new Map<string, { sched: number; attended: number; punctual: number; lateSamples: number }>();
  const storeShiftStats = new Map<string, { sched: number; attended: number; punctual: number; lateSamples: number }>();
  const managerShiftStats = new Map<string, { sched: number; attended: number; punctual: number; riskCount: number }>();

  for (const r of rosters) {
    const eid = str(r.employee_id);
    const dept = empDept(eid);
    const storeId = str(r.store_id) || "unassigned";
    const manager = str(r.manager_id || r.supervisor_id) || `store:${storeId}`;
    if (!deptShiftStats.has(dept)) deptShiftStats.set(dept, { sched: 0, attended: 0, punctual: 0, lateSamples: 0 });
    if (!storeShiftStats.has(storeId)) storeShiftStats.set(storeId, { sched: 0, attended: 0, punctual: 0, lateSamples: 0 });
    if (!managerShiftStats.has(manager)) managerShiftStats.set(manager, { sched: 0, attended: 0, punctual: 0, riskCount: 0 });
    const d = deptShiftStats.get(dept)!;
    const s = storeShiftStats.get(storeId)!;
    const m = managerShiftStats.get(manager)!;
    d.sched += 1;
    s.sched += 1;
    m.sched += 1;
    const ev = eventsByRoster.get(str(r.id)) || [];
    const inEv = ev.filter(isClockIn).sort((a, b) => Date.parse(str(a.event_time)) - Date.parse(str(b.event_time)))[0];
    if (inEv) {
      d.attended += 1;
      s.attended += 1;
      m.attended += 1;
      const late = minutesLate(new Date(Date.parse(str(inEv.event_time))), str(r.planned_start));
      d.lateSamples += 1;
      s.lateSamples += 1;
      if (late <= 5) {
        d.punctual += 1;
        s.punctual += 1;
        m.punctual += 1;
      }
    }
    const rsk = employeeRisk.get(eid);
    if (rsk && rsk.score >= 40) m.riskCount += 1;
  }

  const departmentComparison = Array.from(deptShiftStats.entries()).map(([department, x]) => ({
    department,
    attendancePct: x.sched ? clampPct((x.attended / x.sched) * 100) : 0,
    punctualityPct: x.lateSamples ? clampPct((x.punctual / x.lateSamples) * 100) : 0,
    missedShiftPct: x.sched ? clampPct(((x.sched - x.attended) / x.sched) * 100) : 0,
  })).sort((a, b) => a.attendancePct - b.attendancePct);

  const storeComparison = Array.from(storeShiftStats.entries()).map(([storeId, x]) => ({
    storeId,
    attendancePct: x.sched ? clampPct((x.attended / x.sched) * 100) : 0,
    punctualityPct: x.lateSamples ? clampPct((x.punctual / x.lateSamples) * 100) : 0,
    missedShiftPct: x.sched ? clampPct(((x.sched - x.attended) / x.sched) * 100) : 0,
  })).sort((a, b) => a.attendancePct - b.attendancePct);

  const managerComparison = Array.from(managerShiftStats.entries()).map(([manager, x]) => ({
    manager,
    attendancePct: x.sched ? clampPct((x.attended / x.sched) * 100) : 0,
    punctualityPct: x.sched ? clampPct((x.punctual / x.sched) * 100) : 0,
    riskCount: x.riskCount,
  })).sort((a, b) => a.attendancePct - b.attendancePct);

  const highLeaveDepartments = Array.from(leaveDaysByDept.entries())
    .map(([department, leaveDays]) => ({ department, leaveDays: round2(leaveDays) }))
    .sort((a, b) => b.leaveDays - a.leaveDays)
    .slice(0, 10);

  const seasonalTrends = Array.from(monthLeave.entries())
    .map(([month, leaveDays]) => ({ month, leaveDays: round2(leaveDays) }))
    .sort((a, b) => a.month.localeCompare(b.month))
    .slice(-12);

  const forecastShortages = highLeaveDepartments.slice(0, 5).map((d, idx) => ({
    date: new Date(Date.now() + (idx + 7) * 86_400_000).toISOString().slice(0, 10),
    department: d.department,
    shortageEmployees: Math.max(1, Math.round(d.leaveDays / 6)),
  }));

  const recurringPayroll = new Map<string, number>();
  const payrollManagerIssues = new Map<string, number>();
  const payrollDelayDepartments = new Map<string, number>();
  let blockerCount = 0;

  for (const c of payrollChecks) {
    const typ = str(c.check_type) || "unknown";
    recurringPayroll.set(typ, (recurringPayroll.get(typ) || 0) + 1);
    if (str(c.severity).toLowerCase() === "blocker") blockerCount += 1;
    const md = (c.metadata || {}) as Record<string, unknown>;
    const mgr = str(md.manager || md.supervisor || md.owner || "unassigned");
    payrollManagerIssues.set(mgr, (payrollManagerIssues.get(mgr) || 0) + 1);
    const dep = str(md.department || md.department_name || (c.employee_id ? empDept(str(c.employee_id)) : "Unassigned"));
    payrollDelayDepartments.set(dep, (payrollDelayDepartments.get(dep) || 0) + 1);
  }

  const recurringPayrollErrors = Array.from(recurringPayroll.entries())
    .map(([type, count]) => ({ type, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 8);

  const repeatedManagers = Array.from(payrollManagerIssues.entries())
    .map(([manager, issueCount]) => ({ manager, issueCount }))
    .sort((a, b) => b.issueCount - a.issueCount)
    .slice(0, 8);

  const delayDepartments = Array.from(payrollDelayDepartments.entries())
    .map(([department, issueCount]) => ({ department, issueCount }))
    .sort((a, b) => b.issueCount - a.issueCount)
    .slice(0, 8);

  const readinessScore = clampPct(100 - blockerCount * 8 - recurringPayrollErrors.reduce((s, x) => s + Math.min(2, x.count), 0));

  const warningsByEmp = new Map<string, number>();
  for (const w of warnings) {
    const eid = str(w.employee_id);
    if (!eid) continue;
    warningsByEmp.set(eid, (warningsByEmp.get(eid) || 0) + 1);
  }

  const hrByEmp = new Map<string, number>();
  for (const c of hrCases) {
    const eid = str(c.employee_id);
    if (!eid) continue;
    if (str(c.status).toLowerCase() !== "closed") {
      hrByEmp.set(eid, (hrByEmp.get(eid) || 0) + 1);
    }
  }

  const trainingByEmp = new Map<string, number>();
  for (const t of trainings) {
    const eid = str(t.employee_id);
    if (!eid) continue;
    const completed = str(t.status).toLowerCase() === "completed";
    trainingByEmp.set(eid, (trainingByEmp.get(eid) || 0) + (completed ? 1 : 0));
  }

  const activeEmployees = employees.filter((e) => e && str(e.id));
  const workforceHealth = activeEmployees.map((e) => {
    const eid = str(e.id);
    const risk = employeeRisk.get(eid);
    const warn = warningsByEmp.get(eid) || 0;
    const hrc = hrByEmp.get(eid) || 0;
    const trainDone = trainingByEmp.get(eid) || 0;
    const leaves = leaveByEmp.get(eid) || [];
    const att = clampPct(100 - (risk?.missed || 0) * 12 - (risk?.lateArrivals || 0) * 3);
    const leaveScore = clampPct(100 - leaves.length * 6);
    const warningsScore = clampPct(100 - warn * 15);
    const hrScore = clampPct(100 - hrc * 18);
    const trainingScore = clampPct(trainDone > 0 ? 85 + Math.min(15, trainDone * 5) : 55);
    const complianceScore = clampPct((warningsScore + hrScore) / 2);
    const overtimeScore = clampPct(100 - Math.round((risk?.unapprovedOt || 0) * 10));
    const workloadScore = clampPct(100 - Math.round((risk?.score || 0) * 0.6));
    const overall = clampPct(avg([
      att,
      leaveScore,
      warningsScore,
      hrScore,
      trainingScore,
      complianceScore,
      overtimeScore,
      workloadScore,
    ]));

    return {
      employeeId: eid,
      name: employeeName(e),
      department: str(e.job_title) || "Unassigned",
      attendance: att,
      leave: leaveScore,
      warnings: warningsScore,
      hrCases: hrScore,
      training: trainingScore,
      compliance: complianceScore,
      overtime: overtimeScore,
      workload: workloadScore,
      overall,
      band: scoreBand(overall),
    };
  }).sort((a, b) => a.overall - b.overall);

  const departmentSet = new Set<string>([
    ...activeEmployees.map((e) => str(e.job_title) || "Unassigned"),
    ...departmentComparison.map((x) => x.department),
    ...highLeaveDepartments.map((x) => x.department),
  ]);

  const departmentHealth = Array.from(departmentSet)
    .map((department) => {
      const staff = workforceHealth.filter((w) => w.department === department);
      const deptAtt = staff.length ? avg(staff.map((s) => s.attendance)) : 0;
      const deptLeave = staff.length ? avg(staff.map((s) => s.leave)) : 0;
      const deptCompliance = staff.length ? avg(staff.map((s) => s.compliance)) : 0;
      const deptWarnings = staff.length ? avg(staff.map((s) => s.warnings)) : 0;
      const deptCases = staff.length ? avg(staff.map((s) => s.hrCases)) : 0;
      const deptOvertimeHours = highOvertimeDepartments.find((h) => h.department === department)?.overtimeHours || 0;
      const productivity = clampPct(100 - deptOvertimeHours * 2);
      const training = staff.length ? avg(staff.map((s) => s.training)) : 55;
      const overall = clampPct(avg([productivity, deptAtt, deptLeave, deptCompliance, training, deptWarnings, deptCases]));
      return {
        department,
        productivity: round2(productivity),
        attendance: round2(deptAtt),
        leave: round2(deptLeave),
        compliance: round2(deptCompliance),
        training: round2(training),
        warnings: round2(deptWarnings),
        cases: round2(deptCases),
        overall: round2(overall),
      };
    })
    .sort((a, b) => a.overall - b.overall);

  const managerScorecard = managerComparison.map((m) => {
    const exceptionResolution = clampPct(100 - m.riskCount * 6);
    const leaveApprovalSpeed = clampPct(100 - leaveRequests.filter((l) => {
      const md = (l as unknown as { manager?: string }).manager;
      return str(md || "") === m.manager && !str(l.manager_approved_at);
    }).length * 8);
    const mgrDepts = new Set<string>();
    for (const r of rosters) {
      const key = str(r.manager_id || r.supervisor_id) || `store:${str(r.store_id) || "unassigned"}`;
      if (key === m.manager) mgrDepts.add(empDept(str(r.employee_id)));
    }
    const teamRows = workforceHealth.filter((w) => mgrDepts.has(w.department));
    const teamHealth = teamRows.length ? avg(teamRows.map((t) => t.overall)) : 0;
    const overtimeManagement = clampPct(100 - Math.min(70, m.riskCount * 5));
    const compliance = clampPct(avg(teamRows.map((t) => t.compliance)) || 70);
    const payrollReadiness = clampPct(readinessScore - Math.min(25, m.riskCount * 2));
    const overall = clampPct(avg([
      m.attendancePct,
      leaveApprovalSpeed,
      exceptionResolution,
      payrollReadiness,
      compliance,
      overtimeManagement,
      teamHealth,
    ]));
    return {
      manager: m.manager,
      attendancePerformance: round2(m.attendancePct),
      leaveApprovalSpeed: round2(leaveApprovalSpeed),
      exceptionResolution: round2(exceptionResolution),
      payrollReadiness: round2(payrollReadiness),
      compliance: round2(compliance),
      overtimeManagement: round2(overtimeManagement),
      teamHealth: round2(teamHealth),
      overall: round2(overall),
    };
  }).sort((a, b) => a.overall - b.overall);

  const topRiskRows = employeeRiskRanking.slice(0, 5);
  const riskInsights = topRiskRows.map((r): IntelligenceInsight => ({
    id: `risk-${r.employeeId}`,
    domain: "labour_leakage",
    title: `${r.name} elevated labour leakage risk`,
    description: `${r.name} in ${r.department} has ${r.triggers.join(", ") || "multi-factor"} risk markers.`,
    severity: r.riskScore >= 75 ? "critical" : r.riskScore >= 60 ? "high" : "medium",
    confidence: clampPct(55 + r.triggers.length * 8),
    businessImpact: `Estimated leakage R ${Math.round(r.estimatedLeakageZAR).toLocaleString("en-ZA")}`,
    recommendedAction: "Open manager review for shift evidence and enforce corrective schedule controls.",
    relatedEmployees: [r.employeeId],
    relatedDepartment: r.department,
    status: "open",
    owner: "manager",
    whatHappened: `${r.name} triggered ${r.triggers.length || 1} leakage risk signals.`,
    whyItHappened: `Observed patterns include ${r.triggers.join(", ") || "repeated attendance and overtime variance"}.`,
    costToBusinessZAR: round2(r.estimatedLeakageZAR),
    whatShouldHappenNext: "Validate evidence, lock corrective roster actions, and enforce approval controls for next cycle.",
    whoShouldDoIt: "Store Manager",
    ifNothingIsDone: "Leakage repeats in next payroll cycle and overtime/non-compliance costs compound.",
    autoPreparation: {
      canPrepare: true,
      preparedWork: [
        `Prepare manager review checklist for ${r.name}`,
        "Prepare exception packet with late/overtime/missing-clock evidence",
        "Prepare follow-up task in action centre with due date",
      ],
    },
    measurableValue: `Recover up to R ${Math.round(r.estimatedLeakageZAR).toLocaleString("en-ZA")} if corrected in current cycle.`,
  }));

  const executiveRecommendations = [
    topRiskRows[0] ? `Investigate ${topRiskRows[0].name} leakage drivers immediately.` : "No employee leakage hotspot detected.",
    departmentHealth[0] ? `Stabilise ${departmentHealth[0].department} department performance plan.` : "No department risk hotspot detected.",
    blockerCount > 0 ? `Resolve ${blockerCount} payroll blockers before payroll export lock.` : "Payroll blockers currently clear.",
  ];

  const complianceScore = clampPct(
    100 - (warnings.filter((w) => str(w.status).toLowerCase() !== "resolved").length * 3 + hrCases.filter((c) => str(c.status).toLowerCase() !== "closed").length * 4),
  );

  const workforceHealthOverall = workforceHealth.length ? clampPct(avg(workforceHealth.map((w) => w.overall))) : 0;

  const executiveDashboard: ExecutiveDashboardSnapshot = {
    topRisks: riskInsights.slice(0, 3).map((x) => ({ title: x.title, severity: x.severity, impact: x.businessImpact })),
    payrollReadiness: readinessScore,
    departmentsAtRisk: departmentRiskRanking.slice(0, 5).map((d) => ({ department: d.department, riskScore: round2(d.riskScore) })),
    attendanceTrend: trend.slice(-6).map((t) => ({ label: t.label, value: t.attendancePct })),
    labourLeakage: round2(Math.max(leakage.totalLeakageZAR, employeeRiskRanking.reduce((s, e) => s + e.estimatedLeakageZAR, 0))),
    complianceScore,
    workforceHealth: workforceHealthOverall,
    recommendations: executiveRecommendations,
  };

  const insights: IntelligenceInsight[] = [
    ...riskInsights,
    {
      id: `exec-payroll-${companyId}`,
      domain: "payroll",
      title: blockerCount > 0 ? "Payroll blockers require executive intervention" : "Payroll readiness stable",
      description: blockerCount > 0
        ? `${blockerCount} blocker-level payroll issues are delaying readiness.`
        : "No blocker-level payroll issues detected in current intelligence slice.",
      severity: blockerCount > 0 ? "high" : "low",
      confidence: 78,
      businessImpact: blockerCount > 0 ? "Delayed payroll closure risk and exception churn." : "Reduced payroll delay risk.",
      recommendedAction: blockerCount > 0
        ? "Assign blocker owners by manager and close unresolved checks before export."
        : "Maintain current control cadence and monitor recurrence trends.",
      relatedEmployees: payrollChecks.map((c) => str(c.employee_id)).filter(Boolean).slice(0, 10),
      relatedDepartment: delayDepartments[0]?.department || null,
      status: blockerCount > 0 ? "open" : "in_progress",
      owner: "payroll_controller",
      whatHappened: blockerCount > 0
        ? `${blockerCount} blocker-level payroll checks are unresolved.`
        : "No blocker-level payroll checks are currently unresolved.",
      whyItHappened: blockerCount > 0
        ? "Recurring unresolved readiness checks and ownership gaps are delaying closure."
        : "Readiness controls are currently being met.",
      costToBusinessZAR: blockerCount > 0 ? round2(blockerCount * 1800) : 0,
      whatShouldHappenNext: blockerCount > 0
        ? "Assign each blocker to an owner, set due times, and clear before export gate."
        : "Maintain current process and monitor recurrence trend weekly.",
      whoShouldDoIt: "Payroll Controller",
      ifNothingIsDone: blockerCount > 0
        ? "Payroll close delays, manual rework, and downstream correction workload increase."
        : "Low immediate risk, but recurrence can still emerge without monitoring.",
      autoPreparation: {
        canPrepare: blockerCount > 0,
        preparedWork: blockerCount > 0
          ? [
              "Prepare blocker ownership list by manager/department",
              "Prepare daily blocker burndown queue",
              "Prepare export go/no-go checklist",
            ]
          : ["Prepare weekly readiness trend snapshot"],
      },
      measurableValue: blockerCount > 0
        ? `Prevent estimated R ${Math.round(blockerCount * 1800).toLocaleString("en-ZA")} in delay and correction overhead.`
        : "Sustain payroll close confidence and reduce exception volatility.",
    },
    {
      id: `exec-att-${companyId}`,
      domain: "attendance",
      title: "Attendance and punctuality intelligence snapshot",
      description: `Attendance ${attendancePct.toFixed(1)}%, punctuality ${punctualityPct.toFixed(1)}%, missed shifts ${missedShiftPct.toFixed(1)}%.`,
      severity: missedShiftPct > 12 ? "high" : missedShiftPct > 6 ? "medium" : "low",
      confidence: 74,
      businessImpact: "Direct impact on coverage stability and overtime pressure.",
      recommendedAction: "Focus manager interventions on lowest-performing store and department comparisons.",
      relatedEmployees: employeeRiskRanking.slice(0, 8).map((r) => r.employeeId),
      relatedDepartment: departmentComparison[0]?.department || null,
      status: "open",
      owner: "operations_manager",
      whatHappened: `Attendance is ${(attendancePct).toFixed(1)}% with missed shifts at ${(missedShiftPct).toFixed(1)}%.`,
      whyItHappened: "Late arrivals, missing clock events, and uneven manager execution are driving variation.",
      costToBusinessZAR: round2((missedShiftPct / 100) * Math.max(0, scheduledHours) * BASE_RATE_ZAR_PER_HOUR),
      whatShouldHappenNext: "Target the lowest-performing department/store with manager-led corrective actions this week.",
      whoShouldDoIt: "Operations Manager",
      ifNothingIsDone: "Coverage instability grows and overtime/absence costs rise in the next schedule window.",
      autoPreparation: {
        canPrepare: true,
        preparedWork: [
          "Prepare manager comparison pack with lowest attendance teams",
          "Prepare attendance correction action list",
          "Prepare follow-up review date and owner assignment",
        ],
      },
      measurableValue: `Reduce missed shifts by 2-5% and recover estimated R ${Math.round((missedShiftPct / 100) * Math.max(0, scheduledHours) * BASE_RATE_ZAR_PER_HOUR).toLocaleString("en-ZA")} in avoidable labour loss.`,
    },
  ];

  return {
    labourLeakage: {
      estimatedLabourLeakageZAR: round2(Math.max(leakage.totalLeakageZAR, employeeRiskRanking.reduce((s, e) => s + e.estimatedLeakageZAR, 0))),
      repeatedLateArrivals,
      unapprovedOvertime,
      missingClockEvents,
      excessiveAbsenteeism,
      duplicateCorrections,
      highOvertimeDepartments,
      employeeRiskRanking,
      departmentRiskRanking,
    },
    attendance: {
      attendancePct,
      punctualityPct,
      missedShiftPct,
      averageLatenessMinutes,
      trend,
      managerComparison,
      storeComparison,
      departmentComparison,
    },
    leave: {
      leaveAbusePatterns: Math.max(0, repeatedMondays + repeatedFridays + adjacentPublicHolidays),
      repeatedMondays,
      repeatedFridays,
      adjacentPublicHolidays,
      highLeaveDepartments,
      seasonalTrends,
      forecastShortages,
    },
    roster: {
      scheduledHours: round2(scheduledHours),
      workedHours: round2(workedHours),
      varianceHours: round2(workedHours - scheduledHours),
      coveragePct: attendancePct,
      utilisationPct: scheduledHours > 0 ? clampPct((workedHours / scheduledHours) * 100) : 0,
      overstaffingHours: round2(overstaffingHours),
      understaffingHours: round2(understaffingHours),
      overtimeFromRosterHours: round2(overtimeFromRosterHours),
    },
    payroll: {
      readinessScore,
      blockerCount,
      recurringPayrollErrors,
      repeatedManagers,
      delayDepartments,
    },
    workforceHealth,
    departmentHealth,
    managerScorecard,
    executiveDashboard,
    insights,
  };
}

/**
 * Master entrypoint — aggregates all Stage 2 intelligence engines for a tenant slice.
 */
export function calculateWorkforceIntelligence(
  companyId: string,
  employees: unknown[],
  clockins: unknown[],
  rosters: unknown[],
  leaveRequests: unknown[] = [],
  hrCases: unknown[] = [],
  warnings: unknown[] = [],
  payrollChecks: unknown[] = [],
  trainings: unknown[] = [],
): WorkforceIntelligenceState {
  const e = safeArray<EmployeeLite>(employees);
  const c = safeArray<ClockLite>(clockins);
  const r = safeArray<RosterLite>(rosters);
  const l = safeArray<LeaveLite>(leaveRequests);
  const h = safeArray<HrCaseLite>(hrCases);
  const w = safeArray<WarningLite>(warnings);
  const p = safeArray<PayrollCheckLite>(payrollChecks);
  const t = safeArray<TrainingLite>(trainings);
  const safeCompanyId = str(companyId) || "_";

  const leakage = leakageEngine(safeCompanyId, e, c, r);
  const buddyClocking = buddyClockingGuard(c);
  const optimization = optimizationEngine(r, c);
  const burnout = burnoutPredictor(e, c, r);
  const phase1 = computePhase1Intelligence({
    companyId: safeCompanyId,
    employees: e,
    clockins: c,
    rosters: r,
    leaveRequests: l,
    hrCases: h,
    warnings: w,
    payrollChecks: p,
    trainings: t,
    leakage,
  });

  return {
    companyId: safeCompanyId,
    leakage,
    buddyClocking,
    optimization,
    burnout,
    labourLeakage: phase1.labourLeakage,
    attendance: phase1.attendance,
    leave: phase1.leave,
    roster: phase1.roster,
    payroll: phase1.payroll,
    workforceHealth: phase1.workforceHealth,
    departmentHealth: phase1.departmentHealth,
    managerScorecard: phase1.managerScorecard,
    executiveDashboard: phase1.executiveDashboard,
    insights: phase1.insights,
    computedAtIso: new Date().toISOString(),
  };
}

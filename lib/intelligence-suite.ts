import "server-only";

import type {
  BurnoutAlert,
  BurnoutPredictorResult,
  BuddyAlert,
  BuddyClockingGuardResult,
  LeakageEngineResult,
  OptimizationEngineResult,
  OverstaffedShift,
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

/**
 * Master entrypoint — aggregates all Stage 2 intelligence engines for a tenant slice.
 */
export function calculateWorkforceIntelligence(
  companyId: string,
  employees: unknown[],
  clockins: unknown[],
  rosters: unknown[],
): WorkforceIntelligenceState {
  const e = safeArray<EmployeeLite>(employees);
  const c = safeArray<ClockLite>(clockins);
  const r = safeArray<RosterLite>(rosters);
  const safeCompanyId = str(companyId) || "_";

  return {
    companyId: safeCompanyId,
    leakage: leakageEngine(safeCompanyId, e, c, r),
    buddyClocking: buddyClockingGuard(c),
    optimization: optimizationEngine(r, c),
    burnout: burnoutPredictor(e, c, r),
    computedAtIso: new Date().toISOString(),
  };
}

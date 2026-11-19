/**
 * Attendance monitoring maths for the manager panel — pure functions, unit-tested in
 * tests/attendance-summary.test.ts.
 *
 * Days are South African calendar days. A clocking belongs to the server-assigned
 * `attendance_date` (the date its shift started — an overnight clock-out stays on the
 * shift's day); older rows without one fall back to their SAST date.
 * An employee is "absent" only when they were rostered, the shift has started, they are
 * not on approved leave and nothing was clocked for that day. Unrostered staff are not absent.
 */

export const ATTENDANCE_TIMEZONE = "Africa/Johannesburg";

export type AttendanceEvent = {
  employee_id: string;
  event_type: string;
  event_time: string;
  attendance_date?: string | null;
};

export type AttendanceShift = {
  employee_id: string;
  shift_date: string | null;
  planned_start: string | null;
  planned_end: string | null;
  status?: string | null;
};

export type AttendanceLeave = {
  employee_id: string;
  start_date: string;
  end_date: string;
  status: string;
};

export type AttendanceRules = {
  lateGraceMinutes: number;
  earlyDepartureGraceMinutes: number;
  overtimeGraceMinutes: number;
  maxShiftHours: number;
};

export const DEFAULT_ATTENDANCE_RULES: AttendanceRules = {
  lateGraceMinutes: 5,
  earlyDepartureGraceMinutes: 5,
  overtimeGraceMinutes: 20,
  maxShiftHours: 16,
};

/** YYYY-MM-DD in South African time. */
export function sastDate(value: string | Date): string {
  const date = typeof value === "string" ? new Date(value) : value;
  return date.toLocaleDateString("en-CA", { timeZone: ATTENDANCE_TIMEZONE });
}

/** The SAST calendar days ending today, oldest first. */
export function lastSastDays(count: number, now: Date = new Date()): string[] {
  const days: string[] = [];
  for (let i = count - 1; i >= 0; i -= 1) {
    days.push(sastDate(new Date(now.getTime() - i * 86400000)));
  }
  return days;
}

const ms = (iso: string | null | undefined) => (iso ? Date.parse(iso) : NaN);
const isIn = (type: string) => type === "clock_in" || type === "in";
const isOut = (type: string) => type === "clock_out" || type === "out";

function eventDay(event: AttendanceEvent): string {
  return event.attendance_date || sastDate(event.event_time);
}

function shiftDay(shift: AttendanceShift): string {
  return shift.shift_date || (shift.planned_start ? sastDate(shift.planned_start) : "");
}

function onLeave(leaves: AttendanceLeave[], employeeId: string, day: string): boolean {
  return leaves.some(
    (leave) =>
      leave.employee_id === employeeId &&
      leave.status === "approved" &&
      leave.start_date <= day &&
      day <= leave.end_date
  );
}

export type DayAssessment = {
  rostered: boolean;
  onLeave: boolean;
  absent: boolean;
  late: boolean;
  lateMinutes: number;
  earlyDeparture: boolean;
  overtime: boolean;
  worked: boolean;
};

export function assessEmployeeDay(params: {
  employeeId: string;
  day: string;
  events: AttendanceEvent[];
  shifts: AttendanceShift[];
  leaves: AttendanceLeave[];
  now: Date;
  rules: AttendanceRules;
}): DayAssessment {
  const { employeeId, day, now, rules } = params;
  const dayEvents = params.events
    .filter((event) => event.employee_id === employeeId && eventDay(event) === day)
    .sort((a, b) => ms(a.event_time) - ms(b.event_time));
  const shift = params.shifts.find(
    (item) => item.employee_id === employeeId && shiftDay(item) === day && item.status !== "cancelled"
  );
  const leave = onLeave(params.leaves, employeeId, day);
  const startMs = ms(shift?.planned_start);
  const endMs = ms(shift?.planned_end);
  const result: DayAssessment = {
    rostered: Boolean(shift),
    onLeave: leave,
    absent: false,
    late: false,
    lateMinutes: 0,
    earlyDeparture: false,
    overtime: false,
    worked: dayEvents.length > 0,
  };

  if (!dayEvents.length) {
    result.absent = Boolean(shift) && !leave && Number.isFinite(startMs) && startMs <= now.getTime();
    return result;
  }

  const firstIn = dayEvents.find((event) => isIn(event.event_type));
  const lastOut = [...dayEvents].reverse().find((event) => isOut(event.event_type));
  if (firstIn && Number.isFinite(startMs)) {
    const lateMinutes = Math.round((ms(firstIn.event_time) - startMs) / 60000);
    result.lateMinutes = Math.max(0, lateMinutes);
    result.late = lateMinutes > rules.lateGraceMinutes;
  }
  if (lastOut && Number.isFinite(endMs)) {
    const diff = Math.round((ms(lastOut.event_time) - endMs) / 60000);
    result.earlyDeparture = diff < -rules.earlyDepartureGraceMinutes;
    result.overtime = diff > rules.overtimeGraceMinutes;
  }
  return result;
}

export type AttendanceSummary = {
  totalEmployees: number;
  rosteredToday: number;
  clockedInNow: number;
  missingClockOut: number;
  absentToday: number;
  onLeaveToday: number;
  lateToday: number;
  overtimeToday: number;
  earlyDepartures: number;
  compliancePercent: number;
};

export function computeAttendanceSummary(params: {
  employeeIds: string[];
  events: AttendanceEvent[];
  shifts: AttendanceShift[];
  leaves: AttendanceLeave[];
  now?: Date;
  rules?: AttendanceRules;
}): AttendanceSummary {
  const now = params.now || new Date();
  const rules = params.rules || DEFAULT_ATTENDANCE_RULES;
  const today = sastDate(now);
  const summary: AttendanceSummary = {
    totalEmployees: params.employeeIds.length,
    rosteredToday: 0,
    clockedInNow: 0,
    missingClockOut: 0,
    absentToday: 0,
    onLeaveToday: 0,
    lateToday: 0,
    overtimeToday: 0,
    earlyDepartures: 0,
    compliancePercent: 0,
  };

  const byEmployee = new Map<string, AttendanceEvent[]>();
  for (const event of params.events) {
    if (!byEmployee.has(event.employee_id)) byEmployee.set(event.employee_id, []);
    byEmployee.get(event.employee_id)!.push(event);
  }

  let compliant = 0;
  let accountable = 0;
  for (const employeeId of params.employeeIds) {
    const day = assessEmployeeDay({
      employeeId,
      day: today,
      events: params.events,
      shifts: params.shifts,
      leaves: params.leaves,
      now,
      rules,
    });
    if (day.rostered) summary.rosteredToday += 1;
    if (day.onLeave) summary.onLeaveToday += 1;
    if (day.absent) summary.absentToday += 1;
    if (day.late) summary.lateToday += 1;
    if (day.earlyDeparture) summary.earlyDepartures += 1;
    if (day.overtime) summary.overtimeToday += 1;

    // Open shift across midnight: the employee's latest clocking decides.
    const ordered = (byEmployee.get(employeeId) || []).sort((a, b) => ms(a.event_time) - ms(b.event_time));
    const last = ordered[ordered.length - 1];
    let missing = false;
    if (last && !isOut(last.event_type)) {
      const sessionStart = [...ordered].reverse().find((event) => isIn(event.event_type));
      const openHours = sessionStart ? (now.getTime() - ms(sessionStart.event_time)) / 3600000 : Infinity;
      if (openHours <= rules.maxShiftHours) summary.clockedInNow += 1;
      else missing = true;
    }
    if (missing) summary.missingClockOut += 1;

    if (day.rostered || day.worked) {
      accountable += 1;
      if (!day.absent && !day.late && !missing) compliant += 1;
    }
  }
  summary.compliancePercent = accountable ? Math.round((compliant / accountable) * 1000) / 10 : 0;
  return summary;
}

export function computeAttendanceTrend(params: {
  employeeIds: string[];
  events: AttendanceEvent[];
  shifts: AttendanceShift[];
  leaves: AttendanceLeave[];
  days?: number;
  now?: Date;
  rules?: AttendanceRules;
}): { days: string[]; late: number[]; absent: number[]; overtime: number[] } {
  const now = params.now || new Date();
  const rules = params.rules || DEFAULT_ATTENDANCE_RULES;
  const days = lastSastDays(params.days || 14, now);
  const late: number[] = [];
  const absent: number[] = [];
  const overtime: number[] = [];
  for (const day of days) {
    let l = 0;
    let a = 0;
    let o = 0;
    for (const employeeId of params.employeeIds) {
      const result = assessEmployeeDay({ employeeId, day, events: params.events, shifts: params.shifts, leaves: params.leaves, now, rules });
      if (result.late) l += 1;
      if (result.absent) a += 1;
      if (result.overtime) o += 1;
    }
    late.push(l);
    absent.push(a);
    overtime.push(o);
  }
  return { days, late, absent, overtime };
}

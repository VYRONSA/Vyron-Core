export type RosterShiftLite = {
  id: string;
  shift_date: string;
  planned_start: string;
  planned_end: string;
  employee_id: string;
  store_id: string;
  status?: string;
  approved?: boolean;
  published?: boolean;
};

export type LeaveRequestLite = {
  employee_id: string | null;
  start_date: string;
  end_date: string;
  status: string;
};

export type ClockEventLite = {
  employee_id: string;
  event_time: string;
  event_type: string;
};

export type CoverageRequirementLite = {
  store_id: string | null;
  coverage_date: string;
  shift_type: string;
  required_employees: number;
};

export type RosterRuleLite = {
  minimum_rest_hours: number;
  maximum_shift_hours: number;
  maximum_consecutive_days: number;
  maximum_weekly_hours: number;
};

export function parseHourMinute(value: string): number {
  if (!value) return 0;
  const section = value.includes("T") ? value.split("T")[1] || "" : value;
  const hhmm = section.slice(0, 5);
  const [hRaw, mRaw] = hhmm.split(":");
  const h = Number(hRaw || 0);
  const m = Number(mRaw || 0);
  return h + m / 60;
}

export function shiftHours(start: string, end: string): number {
  const startHours = parseHourMinute(start);
  const endHours = parseHourMinute(end);
  if (endHours >= startHours) return endHours - startHours;
  return 24 - startHours + endHours;
}

export function dateRange(startDate: string, endDate: string): string[] {
  const result: string[] = [];
  const current = new Date(`${startDate}T00:00:00`);
  const end = new Date(`${endDate}T00:00:00`);

  while (current <= end) {
    result.push(current.toISOString().slice(0, 10));
    current.setDate(current.getDate() + 1);
  }

  return result;
}

export function shiftsOverlap(a: RosterShiftLite, b: RosterShiftLite): boolean {
  if (a.employee_id !== b.employee_id) return false;
  if (a.shift_date !== b.shift_date) return false;

  const aStart = parseHourMinute(a.planned_start);
  const aEnd = parseHourMinute(a.planned_end);
  const bStart = parseHourMinute(b.planned_start);
  const bEnd = parseHourMinute(b.planned_end);

  const normAEnd = aEnd < aStart ? aEnd + 24 : aEnd;
  const normBEnd = bEnd < bStart ? bEnd + 24 : bEnd;

  return aStart < normBEnd && bStart < normAEnd;
}

export function findRosterConflicts(shifts: RosterShiftLite[]) {
  const conflicts: Array<{ first_shift_id: string; second_shift_id: string; type: string }> = [];

  for (let i = 0; i < shifts.length; i += 1) {
    for (let j = i + 1; j < shifts.length; j += 1) {
      if (shiftsOverlap(shifts[i], shifts[j])) {
        conflicts.push({
          first_shift_id: shifts[i].id,
          second_shift_id: shifts[j].id,
          type: "overlap",
        });
      }
    }
  }

  return conflicts;
}

export function detectLeaveCollisions(shifts: RosterShiftLite[], leaveRequests: LeaveRequestLite[]) {
  const approvedLeave = leaveRequests.filter((leave) => {
    const status = (leave.status || "").toLowerCase();
    return status.includes("approved") || status === "submitted";
  });

  const leaveMap = new Map<string, Set<string>>();
  approvedLeave.forEach((leave) => {
    if (!leave.employee_id) return;
    const days = dateRange(leave.start_date, leave.end_date);
    if (!leaveMap.has(leave.employee_id)) leaveMap.set(leave.employee_id, new Set());
    const setRef = leaveMap.get(leave.employee_id)!;
    days.forEach((day) => setRef.add(day));
  });

  return shifts.filter((shift) => leaveMap.get(shift.employee_id)?.has(shift.shift_date));
}

export function weeklyHoursByEmployee(shifts: RosterShiftLite[]) {
  const totals = new Map<string, number>();
  shifts.forEach((shift) => {
    const prev = totals.get(shift.employee_id) || 0;
    totals.set(shift.employee_id, prev + shiftHours(shift.planned_start, shift.planned_end));
  });
  return totals;
}

export function complianceFlags(shifts: RosterShiftLite[], rule: RosterRuleLite) {
  const flags: Array<{ shift_id: string; message: string }> = [];

  shifts.forEach((shift) => {
    const duration = shiftHours(shift.planned_start, shift.planned_end);
    if (duration > rule.maximum_shift_hours) {
      flags.push({
        shift_id: shift.id,
        message: `Shift exceeds max hours (${duration.toFixed(1)}h > ${rule.maximum_shift_hours}h)`,
      });
    }
  });

  const weekly = weeklyHoursByEmployee(shifts);
  weekly.forEach((hours, employeeId) => {
    if (hours > rule.maximum_weekly_hours) {
      const firstShift = shifts.find((shift) => shift.employee_id === employeeId);
      if (firstShift) {
        flags.push({
          shift_id: firstShift.id,
          message: `Employee weekly hours exceed limit (${hours.toFixed(1)}h > ${rule.maximum_weekly_hours}h)`,
        });
      }
    }
  });

  return flags;
}

export function coverageGaps(shifts: RosterShiftLite[], requirements: CoverageRequirementLite[]) {
  return requirements
    .map((req) => {
      const planned = shifts.filter(
        (shift) =>
          shift.shift_date === req.coverage_date &&
          (req.store_id ? shift.store_id === req.store_id : true)
      ).length;

      return {
        ...req,
        planned,
        gap: Math.max(req.required_employees - planned, 0),
      };
    })
    .filter((item) => item.gap > 0);
}

export function payrollReadiness(shifts: RosterShiftLite[], events: ClockEventLite[]) {
  const total = shifts.length;
  if (total === 0) return { readiness_percent: 0, matched: 0, missing: 0 };

  const matched = shifts.filter((shift) => {
    return events.some(
      (event) =>
        event.employee_id === shift.employee_id &&
        event.event_time.slice(0, 10) === shift.shift_date
    );
  }).length;

  return {
    readiness_percent: Number(((matched / total) * 100).toFixed(1)),
    matched,
    missing: total - matched,
  };
}

export function buildSimpleAutoPlan(input: {
  employees: Array<{ id: string; active?: boolean; default_store_id?: string | null }>;
  stores: Array<{ id: string }>;
  startDate: string;
  endDate: string;
  defaultStart: string;
  defaultEnd: string;
}) {
  const days = dateRange(input.startDate, input.endDate);
  const activeEmployees = input.employees.filter((employee) => employee.active !== false);
  const plan: Array<{
    employee_id: string;
    store_id: string;
    shift_date: string;
    planned_start: string;
    planned_end: string;
    role: string;
    status: string;
  }> = [];

  if (activeEmployees.length === 0 || input.stores.length === 0) return plan;

  days.forEach((day, dayIndex) => {
    input.stores.forEach((store, storeIndex) => {
      const employee = activeEmployees[(dayIndex + storeIndex) % activeEmployees.length];
      plan.push({
        employee_id: employee.id,
        store_id: employee.default_store_id || store.id,
        shift_date: day,
        planned_start: `${day}T${input.defaultStart}:00`,
        planned_end: `${day}T${input.defaultEnd}:00`,
        role: "Auto Planned Shift",
        status: "scheduled",
      });
    });
  });

  return plan;
}

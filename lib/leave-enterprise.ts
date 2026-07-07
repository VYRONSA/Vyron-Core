export type LeaveRequestLite = {
  id: string;
  employee_id: string | null;
  employee_name: string | null;
  leave_type: string | null;
  start_date: string;
  end_date: string;
  status: string;
  workflow_stage?: string | null;
  reviewed_by_manager?: string | null;
};

export type LeaveBalanceLite = {
  employee_id: string;
  employee_name?: string;
  leave_type: string;
  days_due_live: number;
  monthly_accrual_days?: number | null;
  pending_days?: number | null;
};

export type LeaveConflict = {
  leaveRequestId: string;
  employeeId: string | null;
  conflictType: "overlap" | "blackout" | "peak";
  severity: "low" | "medium" | "high";
  notes: string;
};

function toDay(iso: string) {
  return new Date(`${iso}T12:00:00`);
}

export function leaveDays(startDate: string, endDate: string) {
  if (!startDate || !endDate) return 0;
  const start = toDay(startDate);
  const end = toDay(endDate);
  const diff = end.getTime() - start.getTime();
  if (diff < 0) return 0;
  return Math.floor(diff / (1000 * 60 * 60 * 24)) + 1;
}

export function datesOverlap(startA: string, endA: string, startB: string, endB: string) {
  const aStart = toDay(startA).getTime();
  const aEnd = toDay(endA).getTime();
  const bStart = toDay(startB).getTime();
  const bEnd = toDay(endB).getTime();
  return aStart <= bEnd && bStart <= aEnd;
}

export function detectLeaveOverlaps(requests: LeaveRequestLite[]) {
  const active = requests.filter((item) =>
    ["submitted", "pending", "manager_approved", "hr_approved", "approved"].includes(
      String(item.workflow_stage || item.status || "").toLowerCase()
    )
  );

  const conflicts: LeaveConflict[] = [];

  for (let i = 0; i < active.length; i += 1) {
    for (let j = i + 1; j < active.length; j += 1) {
      const a = active[i];
      const b = active[j];
      if (!datesOverlap(a.start_date, a.end_date, b.start_date, b.end_date)) continue;

      if (a.employee_id && b.employee_id && a.employee_id === b.employee_id) {
        conflicts.push({
          leaveRequestId: b.id,
          employeeId: b.employee_id,
          conflictType: "overlap",
          severity: "high",
          notes: "Employee has overlapping leave requests.",
        });
      } else {
        conflicts.push({
          leaveRequestId: b.id,
          employeeId: b.employee_id,
          conflictType: "overlap",
          severity: "medium",
          notes: `Team overlap with ${a.employee_name || "another employee"}.`,
        });
      }
    }
  }

  return conflicts;
}

export function forecastBalance(params: {
  currentDaysDue: number;
  monthlyAccrualDays: number;
  pendingDays?: number;
  projectedLeaveDaysPerMonth?: number;
  months: number;
}) {
  const pending = params.pendingDays || 0;
  const projectedUse = params.projectedLeaveDaysPerMonth || 0;
  const projection: Array<{ month: number; projectedBalance: number; negative: boolean }> = [];

  let running = Number(params.currentDaysDue) - pending;

  for (let month = 1; month <= params.months; month += 1) {
    running += Number(params.monthlyAccrualDays || 0);
    running -= projectedUse;

    projection.push({
      month,
      projectedBalance: Math.round(running * 100) / 100,
      negative: running < 0,
    });
  }

  return projection;
}

export function absenteeismRate(params: {
  totalEmployees: number;
  leaveRequestsInRange: LeaveRequestLite[];
  rangeDays: number;
}) {
  if (params.totalEmployees <= 0 || params.rangeDays <= 0) return 0;

  const leaveDaysTotal = params.leaveRequestsInRange.reduce(
    (sum, item) => sum + leaveDays(item.start_date, item.end_date),
    0
  );

  const possibleDays = params.totalEmployees * params.rangeDays;
  return Math.round((leaveDaysTotal / possibleDays) * 1000) / 10;
}

export function workflowCounts(requests: LeaveRequestLite[]) {
  const counts: Record<string, number> = {
    draft: 0,
    submitted: 0,
    manager_approved: 0,
    hr_approved: 0,
    rejected: 0,
    cancelled: 0,
    completed: 0,
  };

  for (const request of requests) {
    const stage = String(request.workflow_stage || "submitted").toLowerCase();
    if (counts[stage] !== undefined) {
      counts[stage] += 1;
      continue;
    }

    if (stage === "approved") {
      counts.hr_approved += 1;
    } else if (stage === "declined") {
      counts.rejected += 1;
    }
  }

  return counts;
}

export function upcomingRequests(requests: LeaveRequestLite[], daysAhead = 21) {
  const now = new Date();
  const cutoff = new Date(now);
  cutoff.setDate(now.getDate() + daysAhead);

  return requests.filter((request) => {
    const start = toDay(request.start_date);
    return start >= now && start <= cutoff;
  });
}

export function leaveTypeLabel(value: string | null | undefined) {
  const source = String(value || "").trim();
  if (!source) return "Not set";
  return source.replaceAll("_", " ");
}

export function normalizeMonthlyAccrual(
  leaveTypeCode: string,
  configuredMonthlyAccrual: number | null | undefined
) {
  if (Number.isFinite(Number(configuredMonthlyAccrual))) {
    return Number(configuredMonthlyAccrual);
  }

  const key = leaveTypeCode.toLowerCase();

  if (key === "annual_leave" || key === "annual") return 1.25;
  if (key === "sick_leave" || key === "sick") return 2.5;
  if (key.includes("family")) return 0.25;
  if (key.includes("study")) return 0.83;
  if (key.includes("maternity")) return 10;
  if (key.includes("paternity")) return 0.83;
  if (key.includes("compassionate")) return 0.42;

  return 0.5;
}

export function projectAllBalances(input: {
  balances: LeaveBalanceLite[];
  months: number;
  projectedLeaveDaysPerMonth: number;
}) {
  return input.balances.map((balance) => {
    const projection = forecastBalance({
      currentDaysDue: Number(balance.days_due_live || 0),
      monthlyAccrualDays: normalizeMonthlyAccrual(
        balance.leave_type,
        Number(balance.monthly_accrual_days || 0)
      ),
      pendingDays: Number(balance.pending_days || 0),
      projectedLeaveDaysPerMonth: input.projectedLeaveDaysPerMonth,
      months: input.months,
    });

    const finalMonth = projection[projection.length - 1];

    return {
      ...balance,
      projection,
      projectedFinalBalance: finalMonth?.projectedBalance ?? Number(balance.days_due_live || 0),
      hasNegativeForecast: projection.some((item) => item.negative),
    };
  });
}

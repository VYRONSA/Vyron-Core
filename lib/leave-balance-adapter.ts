/** Maps production leave_balances / leave_balances_live columns to UI field names. */

export type LeaveBalanceUiRow = {
  id: string;
  company_id?: string;
  employee_id: string;
  employee_name?: string;
  leave_type: string;
  cycle_start?: string | null;
  cycle_end?: string | null;
  status?: string;
  opening_balance_days: number;
  days_accrued_live: number;
  days_taken: number;
  pending_days: number;
  days_due_live: number;
  cycle_leave_entitlement_days?: number;
};

export function appLeaveTypeToDb(value: string) {
  const lower = value.toLowerCase();
  if (["annual", "annual leave", "annual_leave"].includes(lower)) return "annual";
  if (["sick", "sick leave", "sick_leave"].includes(lower)) return "sick";
  if (lower.includes("family")) return "family";
  if (["unpaid", "unpaid_leave"].includes(lower)) return "unpaid";
  return lower.replace(/_leave$/, "");
}

export function normalizeLeaveBalanceRow(row: Record<string, unknown>): LeaveBalanceUiRow {
  const opening = Number(row.opening_balance ?? row.opening_balance_days ?? 0);
  const accrued = Number(row.accrued ?? row.days_accrued_live ?? 0);
  const taken = Number(row.taken ?? row.days_taken ?? 0);
  const pending = Number(row.pending ?? row.pending_days ?? 0);
  const available = Number(row.available ?? row.current_balance ?? row.days_due_live ?? 0);

  return {
    id: String(row.id),
    company_id: row.company_id ? String(row.company_id) : undefined,
    employee_id: String(row.employee_id),
    employee_name: row.employee_name ? String(row.employee_name) : undefined,
    leave_type: String(row.leave_type || "annual"),
    cycle_start: (row.cycle_start as string) ?? null,
    cycle_end: (row.cycle_end as string) ?? null,
    status: row.status ? String(row.status) : "active",
    opening_balance_days: opening,
    days_accrued_live: accrued,
    days_taken: taken,
    pending_days: pending,
    days_due_live: available,
    cycle_leave_entitlement_days: accrued,
  };
}

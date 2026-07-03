import type { SupabaseClient } from "@supabase/supabase-js";
import { appLeaveTypeToDb } from "@/lib/leave-balance-adapter";

/** Production leave_balances table uses opening_balance, accrued, taken (not *_days columns). */
const DEFAULT_LEAVE_SEEDS = [
  { appType: "annual_leave", accrued: 15 },
  { appType: "sick_leave", accrued: 30 },
  { appType: "family_responsibility_leave", accrued: 3 },
] as const;

/**
 * Seeds leave_balances rows so leave_balances_live can surface balances for new employees.
 */
export async function seedEmployeeLeaveBalances(
  supabase: SupabaseClient,
  opts: { companyId: string; employeeId: string; employeeName: string }
): Promise<{ ok: boolean; error: string | null; seeded: number }> {
  let seeded = 0;

  for (const seed of DEFAULT_LEAVE_SEEDS) {
    const leaveType = appLeaveTypeToDb(seed.appType);

    const { data: existing } = await supabase
      .from("leave_balances")
      .select("id")
      .eq("employee_id", opts.employeeId)
      .eq("leave_type", leaveType)
      .maybeSingle();

    if (existing?.id) continue;

    const { error } = await supabase.from("leave_balances").insert({
      company_id: opts.companyId,
      employee_id: opts.employeeId,
      leave_type: leaveType,
      opening_balance: 0,
      accrued: seed.accrued,
      taken: 0,
    });

    if (error) {
      return { ok: false, error: error.message, seeded };
    }

    seeded += 1;
  }

  return { ok: true, error: null, seeded };
}

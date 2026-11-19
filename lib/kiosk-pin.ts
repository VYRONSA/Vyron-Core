import type { SupabaseClient } from "@supabase/supabase-js";

export type PinCheckResult = { ok: true } | { ok: false; reason: string; message: string };

type PinRpcResponse = {
  ok?: boolean;
  reason?: string;
  locked_until?: string | null;
  attempts_remaining?: number | null;
};

function lockedMessage(lockedUntil: string | null | undefined): string {
  if (!lockedUntil) return "Too many incorrect PIN attempts. Ask a manager for help.";
  const time = new Date(lockedUntil).toLocaleTimeString("en-ZA", { hour: "2-digit", minute: "2-digit" });
  return `Too many incorrect PIN attempts. PIN entry is locked until ${time}.`;
}

/** Message shown for a refused PIN check. */
export function pinFailureMessage(response: PinRpcResponse | null | undefined): string {
  switch (response?.reason) {
    case "no_pin":
      return "This employee does not have a PIN set up yet. A manager must create one first.";
    case "locked":
      return lockedMessage(response.locked_until);
    case "kiosk_access_disabled":
      return "Kiosk access is disabled for this employee.";
    case "employee_inactive":
      return "This employee is not active.";
    case "employee_not_found":
      return "Employee not found.";
    case "incorrect_pin": {
      const left = response.attempts_remaining;
      return typeof left === "number" && left > 0
        ? `Incorrect PIN. ${left} attempt${left === 1 ? "" : "s"} left before PIN entry is locked.`
        : "Incorrect PIN.";
    }
    default:
      return "The PIN could not be verified.";
  }
}

/**
 * Verifies an employee PIN on the server (hashed, with lockout). The PIN never reaches the
 * browser from the database; only the typed value is sent for checking.
 */
export async function verifyEmployeePin(
  supabase: SupabaseClient,
  employeeId: string,
  pin: string
): Promise<PinCheckResult> {
  const { data, error } = await supabase.rpc("vyron_verify_employee_pin", {
    p_employee_id: employeeId,
    p_pin: pin,
  });
  if (error) {
    return { ok: false, reason: "error", message: error.message || "The PIN could not be verified." };
  }
  const response = (data || {}) as PinRpcResponse;
  if (response.ok) return { ok: true };
  return { ok: false, reason: response.reason || "unknown", message: pinFailureMessage(response) };
}

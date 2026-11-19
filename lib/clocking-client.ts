/**
 * Browser side of clocking. Every clock event is written by the server function
 * `vyron_record_clock_event` (sql/101-clocking-integrity.sql), which sets the time from the
 * server clock, verifies the PIN, serialises concurrent taps, applies the geofence and
 * assigns the shift. The browser never inserts into clock_events.
 *
 * Idempotency: one attempt id per intended clocking. Keep it while retrying the same tap
 * (network error, timeout, double tap) and only create a new one after a definitive answer.
 * The server returns the original event for a repeated attempt id instead of a duplicate.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

export type ClockAction = "clock_in" | "clock_out" | "break_start" | "break_end";
export type ClockSource = "kiosk" | "self" | "offline";

export type ClockState = {
  employee_id: string;
  open_shift: boolean;
  on_break: boolean;
  stale_open_shift: boolean;
  session_id: string | null;
  session_started_at: string | null;
  attendance_date: string | null;
  last_event_type: string | null;
  last_event_time: string | null;
  next_action: "clock_in" | "clock_out";
  max_shift_hours: number;
};

export type ClockEventRecord = {
  id: string;
  employee_id: string;
  event_type: ClockAction;
  event_time: string;
  attendance_date: string | null;
  shift_session_id: string | null;
  gps_verification_status: string | null;
  gps_distance_from_store_meters: number | null;
  verification_status: string | null;
  roster_shift_id: string | null;
  store_id: string | null;
};

export type ClockResult =
  | { ok: true; duplicate: boolean; event: ClockEventRecord; warnings: string[] }
  | { ok: false; code: string; message: string };

export type DevicePosition = { latitude: number; longitude: number; accuracy: number };

export function newClockAttemptId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  // RFC 4122 v4 fallback for older WebViews.
  const bytes = new Uint8Array(16);
  (typeof crypto !== "undefined" ? crypto : undefined)?.getRandomValues?.(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export async function fetchClockState(
  supabase: SupabaseClient,
  employeeId: string
): Promise<{ state: ClockState | null; error: string | null }> {
  const { data, error } = await supabase.rpc("vyron_employee_clock_state", { p_employee_id: employeeId });
  if (error) return { state: null, error: error.message };
  return { state: data as ClockState, error: null };
}

/** Reads the device position; resolves null instead of throwing (the server decides). */
export function readDevicePosition(timeoutMs = 15000): Promise<DevicePosition | null> {
  return new Promise((resolve) => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      resolve(null);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) =>
        resolve({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracy: position.coords.accuracy,
        }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 0 }
    );
  });
}

/**
 * Uploads the clock photo under a path derived from the attempt id, so a retry re-uses the
 * same object instead of creating another one.
 */
export async function uploadClockPhoto(
  supabase: SupabaseClient,
  employeeId: string,
  attemptId: string,
  action: string,
  file: File
): Promise<{ bucket: string; path: string }> {
  const bucket = "clock-event-photos";
  const extension = file.name.includes(".") ? file.name.split(".").pop() : "jpg";
  const day = new Date().toLocaleDateString("en-CA", { timeZone: "Africa/Johannesburg" });
  const path = `${employeeId}/${day}/${attemptId}-${action}.${extension}`;
  const { error } = await supabase.storage.from(bucket).upload(path, file, {
    contentType: file.type || "image/jpeg",
    upsert: false,
  });
  if (error && !/exists|duplicate/i.test(error.message || "")) {
    throw new Error(error.message);
  }
  return { bucket, path };
}

export type RecordClockInput = {
  employeeId: string;
  attemptId: string;
  action?: ClockAction | null;
  source: ClockSource;
  pin?: string | null;
  storeId?: string | null;
  position?: DevicePosition | null;
  photo?: { bucket: string; path: string } | null;
  deviceInfo?: string | null;
  clientTime?: string | null;
  note?: string | null;
};

function isTransient(message: string): boolean {
  return /fetch|network|timeout|timed out|503|502|504|Failed to fetch|ECONN/i.test(message);
}

/**
 * Records a clocking. Transient failures are retried with the SAME attempt id, so a lost
 * response can never turn into a second clock event.
 */
export async function recordClockEvent(
  supabase: SupabaseClient,
  input: RecordClockInput,
  retries = 2
): Promise<ClockResult> {
  const args = {
    p_employee_id: input.employeeId,
    p_client_event_id: input.attemptId,
    p_action: input.action ?? null,
    p_store_id: input.storeId || null,
    p_latitude: input.position?.latitude ?? null,
    p_longitude: input.position?.longitude ?? null,
    p_accuracy: input.position?.accuracy ?? null,
    p_pin: input.pin ?? null,
    p_source: input.source,
    p_photo_bucket: input.photo?.bucket ?? null,
    p_photo_path: input.photo?.path ?? null,
    p_device_info: input.deviceInfo ?? (typeof navigator !== "undefined" ? navigator.userAgent : null),
    p_client_time: input.clientTime ?? null,
    p_note: input.note ?? null,
  };

  let lastMessage = "Clocking failed.";
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const { data, error } = await supabase.rpc("vyron_record_clock_event", args);
      if (!error) {
        const result = (data || {}) as Record<string, unknown>;
        if (result.ok) {
          return {
            ok: true,
            duplicate: Boolean(result.duplicate),
            event: result.event as ClockEventRecord,
            warnings: (result.warnings as string[]) || [],
          };
        }
        return {
          ok: false,
          code: String(result.code || "failed"),
          message: clockFailureMessage(result),
        };
      }
      lastMessage = error.message || lastMessage;
      if (!isTransient(lastMessage)) return { ok: false, code: error.code || "error", message: lastMessage };
    } catch (caught) {
      lastMessage = caught instanceof Error ? caught.message : String(caught);
      if (!isTransient(lastMessage)) return { ok: false, code: "error", message: lastMessage };
    }
    await new Promise((resolve) => setTimeout(resolve, 600 * (attempt + 1)));
  }
  return { ok: false, code: "network", message: `Could not reach the server: ${lastMessage}. Your tap was not lost — try again.` };
}

function clockFailureMessage(result: Record<string, unknown>): string {
  const code = String(result.code || "");
  if (code.startsWith("pin_")) {
    const pin = (result.pin || {}) as { reason?: string; locked_until?: string; attempts_remaining?: number };
    switch (pin.reason) {
      case "no_pin":
        return "This employee does not have a PIN set up yet. A manager must create one first.";
      case "locked": {
        const time = pin.locked_until
          ? new Date(pin.locked_until).toLocaleTimeString("en-ZA", { hour: "2-digit", minute: "2-digit" })
          : null;
        return time
          ? `Too many incorrect PIN attempts. PIN entry is locked until ${time}.`
          : "Too many incorrect PIN attempts. Ask a manager for help.";
      }
      case "kiosk_access_disabled":
        return "Kiosk access is disabled for this employee.";
      case "incorrect_pin":
        return typeof pin.attempts_remaining === "number" && pin.attempts_remaining > 0
          ? `Incorrect PIN. Clocking was not saved. ${pin.attempts_remaining} attempt(s) left before PIN entry is locked.`
          : "Incorrect PIN. Clocking was not saved.";
      default:
        return "PIN not accepted. Clocking was not saved.";
    }
  }
  return String(result.message || "Clocking failed.");
}

export function describeClockAction(action: string | null | undefined): string {
  switch (action) {
    case "clock_in":
      return "clocked in";
    case "clock_out":
      return "clocked out";
    case "break_start":
      return "started a break";
    case "break_end":
      return "ended a break";
    default:
      return "clocked";
  }
}

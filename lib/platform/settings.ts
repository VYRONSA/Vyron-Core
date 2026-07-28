import type { SupabaseClient } from "@supabase/supabase-js";

export type PlatformDefaults = {
  trialDays: number;
  aiCreditLimit: number;
  storageLimitGb: number;
  employeeLimit: number;
  sessionIdleMinutes: number;
  sessionAbsoluteMinutes: number;
};

const FALLBACK: PlatformDefaults = {
  trialDays: 14,
  aiCreditLimit: 500,
  storageLimitGb: 25,
  employeeLimit: 50,
  sessionIdleMinutes: 30,
  sessionAbsoluteMinutes: 480,
};

/** Reads sql/064's dynamic default settings — falls back to hard-coded values only
 * if a row is missing (e.g. migration not yet run), never throws. */
export async function getPlatformDefaults(supabase: SupabaseClient): Promise<PlatformDefaults> {
  const { data } = await supabase
    .from("platform_settings")
    .select("key,value")
    .in("key", [
      "default_trial_days",
      "default_ai_credit_limit",
      "default_storage_limit_gb",
      "default_employee_limit",
      "default_session_timeout_minutes",
    ]);

  const byKey = new Map((data || []).map((row) => [row.key, row.value as Record<string, number>]));

  return {
    trialDays: byKey.get("default_trial_days")?.days ?? FALLBACK.trialDays,
    aiCreditLimit: byKey.get("default_ai_credit_limit")?.credits ?? FALLBACK.aiCreditLimit,
    storageLimitGb: byKey.get("default_storage_limit_gb")?.gb ?? FALLBACK.storageLimitGb,
    employeeLimit: byKey.get("default_employee_limit")?.limit ?? FALLBACK.employeeLimit,
    sessionIdleMinutes: byKey.get("default_session_timeout_minutes")?.idle ?? FALLBACK.sessionIdleMinutes,
    sessionAbsoluteMinutes: byKey.get("default_session_timeout_minutes")?.absolute ?? FALLBACK.sessionAbsoluteMinutes,
  };
}

export type NotificationThresholds = { expiringSoonDays: number; inactiveDays: number };

export async function getNotificationThresholds(supabase: SupabaseClient): Promise<NotificationThresholds> {
  const { data } = await supabase.from("platform_settings").select("value").eq("key", "notification_thresholds").maybeSingle();
  const value = (data?.value as Partial<NotificationThresholds>) || {};
  return {
    expiringSoonDays: value.expiringSoonDays ?? 7,
    inactiveDays: value.inactiveDays ?? 30,
  };
}

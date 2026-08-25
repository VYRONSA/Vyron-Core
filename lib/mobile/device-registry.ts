/**
 * The device registry — who may be pushed to, on which handset.
 *
 * EVERYTHING HERE RUNS AS service_role, DELIBERATELY
 *
 *   A push token is a capability: whoever holds it can make a phone buzz. So no
 *   authenticated session has any grant on mobile_device_registrations at all
 *   (sql/097). Every operation goes through this module, which is only ever
 *   called from a route that has ALREADY verified the session — and which takes
 *   the company and the email from that verified context, never from the body.
 *
 *   That is the whole reason the client can hand us a raw token safely: it can
 *   write one, and it can never read one back.
 *
 * THE SHARED-TABLET RULE
 *
 *   A yard tablet passed between shifts is the case that actually bites. If the
 *   previous employee's registration survives, the next shift's phone buzzes
 *   with someone else's job. So registering a token REVOKES every other active
 *   claim on it first. The partial unique index in sql/097 is the backstop: even
 *   if this code were wrong, the database would refuse the second live claim.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

export type RrDevicePlatform = "android" | "ios" | "web";
export type RrPushProvider = "fcm" | "apns" | "webpush";

const PLATFORMS: RrDevicePlatform[] = ["android", "ios", "web"];
const PROVIDERS: RrPushProvider[] = ["fcm", "apns", "webpush"];

export type RrDeviceRegistrationInput = {
  /** From the verified session. Never from the request body. */
  companyId: string;
  userEmail: string;
  /** Resolved server-side when the user has an employee record. */
  employeeId: string | null;
  platform: string;
  provider: string;
  deviceToken: string;
  deviceLabel?: string | null;
  appVersion?: string | null;
};

export type RrDeviceResult =
  | { ok: true; registrationId: string; replacedClaims: number }
  | { ok: false; error: string; status: number };

function normalisePlatform(value: string): RrDevicePlatform | null {
  const text = String(value || "").trim().toLowerCase();
  return (PLATFORMS as string[]).includes(text) ? (text as RrDevicePlatform) : null;
}

function normaliseProvider(value: string): RrPushProvider | null {
  const text = String(value || "").trim().toLowerCase();
  return (PROVIDERS as string[]).includes(text) ? (text as RrPushProvider) : null;
}

/**
 * A token is opaque to us, but it is not unbounded.
 *
 * FCM and APNs tokens are well under a kilobyte; anything larger is either a
 * bug or somebody probing what this endpoint will store.
 */
const MAX_TOKEN_LENGTH = 4096;

/**
 * Registers this handset to this user, and revokes anyone else's claim on it.
 *
 * `admin` must be a service-role client. The caller is responsible for having
 * authenticated the session first — this module trusts its inputs precisely
 * because the route above it does not.
 */
export async function registerDevice(
  admin: SupabaseClient,
  input: RrDeviceRegistrationInput
): Promise<RrDeviceResult> {
  const platform = normalisePlatform(input.platform);
  if (!platform) return { ok: false, error: "Unsupported device platform.", status: 400 };

  const provider = normaliseProvider(input.provider);
  if (!provider) return { ok: false, error: "Unsupported push provider.", status: 400 };

  const deviceToken = String(input.deviceToken || "").trim();
  if (!deviceToken) return { ok: false, error: "A device token is required.", status: 400 };
  if (deviceToken.length > MAX_TOKEN_LENGTH) {
    return { ok: false, error: "That device token is not valid.", status: 400 };
  }

  /**
   * Step 1 — take the handset off whoever had it.
   *
   * Scoped to this exact (provider, token) pair and to rows that are still
   * live. It deliberately crosses tenants: the same physical device really can
   * move between companies, and the previous employer's claim must end.
   */
  const { data: replaced } = await admin
    .from("mobile_device_registrations")
    .update({ revoked_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("provider", provider)
    .eq("device_token", deviceToken)
    .is("revoked_at", null)
    .select("id");

  // Step 2 — claim it. The unique index guarantees we are now the only one.
  const { data: created, error } = await admin
    .from("mobile_device_registrations")
    .insert({
      company_id: input.companyId,
      user_email: input.userEmail,
      employee_id: input.employeeId,
      platform,
      provider,
      device_token: deviceToken,
      device_label: input.deviceLabel || null,
      app_version: input.appVersion || null,
      last_seen_at: new Date().toISOString(),
    })
    .select("id")
    .single();

  if (error || !created) {
    // Never repeat the database's words to a client; see the same rule in
    // lib/road-recovery/idempotency.ts.
    return { ok: false, error: "Could not register this device. Please try again.", status: 503 };
  }

  return {
    ok: true,
    registrationId: String((created as { id: string }).id),
    replacedClaims: (replaced || []).length,
  };
}

/**
 * Revokes on sign-out.
 *
 * Scoped to BOTH the token and the signed-in user, so a malicious client cannot
 * silence somebody else's phone by posting their token. A caller who supplies a
 * token they do not own revokes nothing and is told the same thing either way —
 * "done" — because reporting "that token belongs to someone else" would confirm
 * the token exists.
 */
export async function revokeDevice(
  admin: SupabaseClient,
  input: { companyId: string; userEmail: string; deviceToken: string }
): Promise<{ ok: true; revoked: number }> {
  const deviceToken = String(input.deviceToken || "").trim();
  if (!deviceToken) return { ok: true, revoked: 0 };

  const { data } = await admin
    .from("mobile_device_registrations")
    .update({ revoked_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("company_id", input.companyId)
    .ilike("user_email", input.userEmail)
    .eq("device_token", deviceToken)
    .is("revoked_at", null)
    .select("id");

  return { ok: true, revoked: (data || []).length };
}

/**
 * Revokes EVERY device this user holds in this tenant.
 *
 * For "sign me out everywhere", and for an administrator removing somebody who
 * has left. A departing employee's phone must stop receiving operational work
 * the moment their access ends.
 */
export async function revokeAllDevicesForUser(
  admin: SupabaseClient,
  input: { companyId: string; userEmail: string }
): Promise<{ ok: true; revoked: number }> {
  const { data } = await admin
    .from("mobile_device_registrations")
    .update({ revoked_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("company_id", input.companyId)
    .ilike("user_email", input.userEmail)
    .is("revoked_at", null)
    .select("id");

  return { ok: true, revoked: (data || []).length };
}

/**
 * The handsets a notification should be delivered to.
 *
 * The ONLY function that returns tokens, and it exists for the push sender
 * alone. Nothing that can reach a browser may call it.
 */
export async function activeDevicesFor(
  admin: SupabaseClient,
  input: { companyId: string; userEmails: string[] }
): Promise<{ token: string; platform: RrDevicePlatform; provider: RrPushProvider }[]> {
  if (input.userEmails.length === 0) return [];

  const { data } = await admin
    .from("mobile_device_registrations")
    .select("device_token,platform,provider,user_email")
    .eq("company_id", input.companyId)
    .is("revoked_at", null);

  const wanted = new Set(input.userEmails.map((email) => email.trim().toLowerCase()));

  return ((data || []) as {
    device_token: string;
    platform: RrDevicePlatform;
    provider: RrPushProvider;
    user_email: string;
  }[])
    .filter((row) => wanted.has(String(row.user_email).toLowerCase()))
    .map((row) => ({ token: row.device_token, platform: row.platform, provider: row.provider }));
}

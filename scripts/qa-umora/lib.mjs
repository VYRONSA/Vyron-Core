// Shared helpers for the UMORA regression suite. LOCAL REPLICA ONLY.
import { createRequire } from "module";
import { execFileSync } from "child_process";

const require = createRequire(new URL("../../package.json", import.meta.url));
export const { createClient } = require("@supabase/supabase-js");

export const URL_ = process.env.API_URL || "http://127.0.0.1:54321";
export const ANON = process.env.ANON_KEY;
export const SERVICE = process.env.SERVICE_ROLE_KEY;
export const APP_URL = process.env.QA_APP_URL || ""; // e.g. http://localhost:3200 for API tests
export const DB_CONTAINER = process.env.QA_DB_CONTAINER || "supabase_db_vyron-core-web";

if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(URL_)) {
  throw new Error(`Refusing to run: ${URL_} is not a local Supabase. This suite never runs against production.`);
}
if (!ANON || !SERVICE) throw new Error("ANON_KEY and SERVICE_ROLE_KEY (local) are required.");

export const PASSWORD = "QaPass!2026x";
export const CEC = "aaaaaaaa-0000-0000-0000-00000000c001";
export const OTHER = "bbbbbbbb-0000-0000-0000-00000000c002";
export const STORE = "aaaaaaaa-0000-0000-0000-0000000005a1";
export const OTHER_STORE = "bbbbbbbb-0000-0000-0000-0000000005b1";
export const SANDTON = { latitude: -26.1076, longitude: 28.0567, accuracy: 12 };
export const CAPE_TOWN = { latitude: -33.9249, longitude: 18.4241, accuracy: 10 };

export const results = [];
let currentGroup = "";
export function group(name) {
  currentGroup = name;
  console.log(`\n== ${name}`);
}
export function check(id, pass, detail) {
  const text = typeof detail === "string" ? detail : JSON.stringify(detail);
  // A harness crash must never count as a pass (e.g. a refusal test that only saw a TypeError).
  if (/TypeError|ReferenceError|is not a function|Cannot read properties|fetch failed/.test(text)) pass = false;
  results.push({ group: currentGroup, id, pass: Boolean(pass), detail: text });
  console.log(`${pass ? "PASS" : "FAIL"} ${id} — ${text}`);
}

/** Run SQL in the local DB container (seeding/cleanup only). */
export function sql(statement) {
  return execFileSync("docker", ["exec", "-i", DB_CONTAINER, "psql", "-U", "postgres", "-v", "ON_ERROR_STOP=1", "-qAt"], {
    input: statement,
    encoding: "utf8",
  }).trim();
}

export const admin = createClient(URL_, SERVICE, { auth: { persistSession: false } });

export async function ensureUser(email) {
  const { data } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  const found = data?.users?.find((u) => u.email === email);
  if (found) {
    await admin.auth.admin.updateUserById(found.id, { password: PASSWORD, ban_duration: "none" });
    return found.id;
  }
  const { data: created, error } = await admin.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true });
  if (error) throw error;
  return created.user.id;
}

export async function login(email, password = PASSWORD) {
  const client = createClient(URL_, ANON, { auth: { persistSession: false } });
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`${email}: ${error.message}`);
  client.qaAccessToken = data.session.access_token;
  return client;
}

export function uuid() {
  return crypto.randomUUID();
}

export const pct = (values, p) => {
  const sorted = [...values].sort((a, b) => a - b);
  return Math.round(sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))]);
};

/** Kiosk clocking exactly as the app does it (lib/clocking-client.ts → vyron_record_clock_event). */
export async function kioskClock(client, employeeId, pin, { attemptId = uuid(), action = null, coords = SANDTON, store = STORE, source = "kiosk", clientTime = null } = {}) {
  const t0 = performance.now();
  const { data, error } = await client.rpc("vyron_record_clock_event", {
    p_employee_id: employeeId,
    p_client_event_id: attemptId,
    p_action: action,
    p_store_id: store,
    p_latitude: coords?.latitude ?? null,
    p_longitude: coords?.longitude ?? null,
    p_accuracy: coords?.accuracy ?? null,
    p_pin: pin,
    p_source: source,
    p_photo_bucket: null,
    p_photo_path: null,
    p_device_info: "qa-regression",
    p_client_time: clientTime,
    p_note: null,
  });
  const ms = performance.now() - t0;
  if (error) return { ok: false, code: error.code, message: error.message, ms };
  return { ...data, ms };
}

export async function eventsFor(employeeId) {
  const { data } = await admin
    .from("clock_events")
    .select("id,event_type,event_time,created_at,attendance_date,shift_session_id,gps_verification_status,verification_status,original_event_time,correction_id,source")
    .eq("employee_id", employeeId)
    .neq("source", "seed")
    .order("event_time");
  return data || [];
}

export function summary() {
  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  if (failed.length) {
    console.log("Failures:");
    for (const f of failed) console.log(`  ${f.group} / ${f.id}: ${f.detail}`);
  }
  return failed.length;
}

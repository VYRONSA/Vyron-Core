/** Probe live Supabase column availability — read-only selects. */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";
import { resolve } from "path";

const ROOT = resolve(import.meta.dirname, "..");
const env = {};
readFileSync(resolve(ROOT, ".env.local"), "utf8").split(/\r?\n/).forEach((line) => {
  const t = line.trim();
  if (!t || t.startsWith("#")) return;
  const i = t.indexOf("=");
  if (i < 1) return;
  env[t.slice(0, i).trim()] = t.slice(i + 1).trim();
});

const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

async function probe(table, col) {
  const { error } = await admin.from(table).select(col).limit(1);
  return { col, ok: !error, err: error?.message };
}

const tables = {
  hr_warnings: [
    "id", "company_id", "employee_id", "employee_name", "warning_type", "incident_type",
    "incident_date", "issue_date", "expiry_date", "severity", "description", "manager_notes", "status", "created_at",
  ],
  leave_balances: [
    "id", "company_id", "employee_id", "employee_name", "leave_type", "cycle_start", "cycle_end",
    "opening_balance", "opening_balance_days", "accrued", "taken", "pending", "available",
    "current_balance", "entitlement", "balance_days", "status", "created_at", "updated_at",
  ],
  employee_movements: [
    "id", "company_id", "employee_id", "movement_type", "from_store_id", "to_store_id", "effective_date", "status",
  ],
};

for (const [table, cols] of Object.entries(tables)) {
  console.log(`\n=== ${table} ===`);
  for (const col of cols) {
    const r = await probe(table, col);
    console.log(r.ok ? `  ✓ ${col}` : `  ✗ ${col} — ${r.err}`);
  }
}

for (const table of ["leave_balances", "leave_balances_live", "hr_warnings"]) {
  const { data, error } = await admin.from(table).select("*").limit(1);
  console.log(`\n=== ${table} sample keys ===`);
  if (error) console.log(error.message);
  else if (!data?.length) console.log("(no rows)");
  else console.log(Object.keys(data[0]));
}

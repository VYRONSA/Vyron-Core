/**
 * VYRON CORE — module provisioning (Phase 4, Step 1).
 *
 * ---------------------------------------------------------------------------
 * THE PROBLEM
 * ---------------------------------------------------------------------------
 *
 * `companies.enabled_modules` is written in exactly two places — the Platform Console
 * provisioning wizard and the module toggle grid. Until now, granting a module wrote that
 * array and nothing else, which is fine for modules whose tables are empty until a user
 * fills them, and wrong for a module that needs baseline reference data before it can be
 * used at all.
 *
 * Road & Recovery is the second kind. Enabling it without its service catalogue, workflow
 * definitions, BYSTAND reasons and requirement policies produces a workspace where the
 * module appears in the navigation and every action fails.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS IS NOT
 * ---------------------------------------------------------------------------
 *
 * Not a provisioning framework, a queue or a worker. There is nothing of that kind in the
 * repository to reuse — public.platform_job_queue is documented in its own source as
 * "a lightweight tracking log ... not an async worker engine", swallows its failures, and
 * only accepts email/notification/storage/ai. Building one for a single consumer would be
 * a second architecture to keep in sync.
 *
 * Instead this dispatches to a per-module provisioner, and Road & Recovery's provisioner
 * is ONE database function that runs its four existing seeds in one transaction. The
 * atomicity, idempotence and retry-safety live in the database, where they are enforced
 * rather than coordinated.
 *
 * ---------------------------------------------------------------------------
 * RULES
 * ---------------------------------------------------------------------------
 *
 *   ADDITIVE     it creates what is missing and changes nothing that exists
 *   IDEMPOTENT   running it twice is indistinguishable from running it once
 *   FAIL CLOSED  "provisioned" is reported only when every component verifies
 *   NON-DESTRUCTIVE
 *                DISABLING a module never calls this and never deletes anything —
 *                entitlement is revoked, operational history is kept
 */

import type { SupabaseClient } from "@supabase/supabase-js";

/** How the attempt was triggered. Recorded, never inferred. */
export type ProvisioningTrigger = "wizard" | "module_toggle" | "operator_retry";

export type ProvisioningComponent = {
  component: string;
  ok: boolean;
  detail: string;
};

export type ModuleProvisioningResult = {
  moduleCode: string;
  /** True only when EVERY component verified. Fail closed. */
  provisioned: boolean;
  components: ProvisioningComponent[];
  error: string | null;
};

export type EnsureProvisioningResult = {
  /** True when every provisionable module in `modules` came back fully provisioned. */
  ok: boolean;
  results: ModuleProvisioningResult[];
  /** Operator-facing lines for modules that did not fully provision. */
  notices: string[];
};

type Row = Record<string, unknown>;

function asText(value: unknown): string {
  return String(value ?? "").trim();
}

/**
 * Modules that need baseline data when granted.
 *
 * A module absent from this map provisions nothing, which is the correct behaviour for
 * most of the catalogue: entitlement alone is enough.
 */
const MODULE_PROVISIONERS: Record<
  string,
  { rpc: string; label: string }
> = {
  road_recovery: {
    rpc: "rr_provision_company",
    label: "Road & Recovery",
  },
};

export function moduleNeedsProvisioning(moduleCode: string): boolean {
  return Boolean(MODULE_PROVISIONERS[asText(moduleCode).toLowerCase()]);
}

/**
 * Provisions one module for one company and verifies the result.
 *
 * The RPC returns one row per baseline component. A missing component is NOT an
 * exception — it is a verified-incomplete outcome the operator can act on and retry.
 */
async function provisionModule(
  admin: SupabaseClient,
  companyId: string,
  moduleCode: string
): Promise<ModuleProvisioningResult> {
  const provisioner = MODULE_PROVISIONERS[moduleCode];

  const { data, error } = await admin.rpc(provisioner.rpc, { p_company_id: companyId });

  if (error) {
    return {
      moduleCode,
      provisioned: false,
      components: [],
      error: error.message || `${provisioner.label} provisioning failed.`,
    };
  }

  const rows = (Array.isArray(data) ? data : data ? [data] : []) as Row[];
  const components: ProvisioningComponent[] = rows.map((row) => ({
    component: asText(row.component),
    ok: row.ok === true,
    detail: asText(row.detail),
  }));

  // FAIL CLOSED. An empty result is not success — it means the verifier told us nothing.
  const provisioned = components.length > 0 && components.every((entry) => entry.ok);

  return { moduleCode, provisioned, components, error: null };
}

/** Writes the attempt to the append-only log. Best-effort: never masks the real outcome. */
async function recordAttempt(
  admin: SupabaseClient,
  companyId: string,
  result: ModuleProvisioningResult,
  trigger: ProvisioningTrigger,
  actorEmail: string
): Promise<void> {
  const components: Record<string, unknown> = {};
  for (const entry of result.components) {
    components[entry.component] = { ok: entry.ok, detail: entry.detail };
  }

  try {
    await admin.from("rr_module_provisioning").insert({
      company_id: companyId,
      module_code: result.moduleCode,
      trigger_source: trigger,
      outcome: result.error ? "failed" : result.provisioned ? "provisioned" : "incomplete",
      components,
      error_message: result.error,
      attempted_by: actorEmail,
    });
  } catch {
    // The log is evidence, not control flow. Losing it must not turn a successful
    // provision into a reported failure.
  }
}

/**
 * Ensures every module in `modules` that needs baseline data has it.
 *
 * Call this AFTER `companies.enabled_modules` has been persisted — the database function
 * re-checks entitlement and refuses to seed a company that does not hold the module, so
 * calling it first would fail by design.
 *
 * Modules being REMOVED are simply absent from `modules` and are never passed here.
 * Nothing in this path deletes tenant data.
 */
export async function ensureCompanyModuleProvisioning(
  admin: SupabaseClient,
  companyId: string,
  modules: readonly string[],
  options: { trigger: ProvisioningTrigger; actorEmail: string }
): Promise<EnsureProvisioningResult> {
  const codes = Array.from(
    new Set(modules.map((code) => asText(code).toLowerCase()).filter(Boolean))
  ).filter((code) => moduleNeedsProvisioning(code));

  if (codes.length === 0) {
    return { ok: true, results: [], notices: [] };
  }

  const results: ModuleProvisioningResult[] = [];
  const notices: string[] = [];

  for (const moduleCode of codes) {
    const result = await provisionModule(admin, companyId, moduleCode);
    results.push(result);
    await recordAttempt(admin, companyId, result, options.trigger, options.actorEmail);

    if (result.provisioned) continue;

    const label = MODULE_PROVISIONERS[moduleCode].label;
    if (result.error) {
      notices.push(`${label} could not be provisioned: ${result.error}`);
      continue;
    }
    const failed = result.components.filter((entry) => !entry.ok);
    notices.push(
      failed.length > 0
        ? `${label} is not fully provisioned — ${failed
            .map((entry) => entry.detail)
            .join(" ")} Re-save the module selection to retry.`
        : `${label} could not be verified as provisioned. Re-save the module selection to retry.`
    );
  }

  return { ok: results.every((entry) => entry.provisioned), results, notices };
}

/**
 * Reads current provisioning state without changing anything.
 *
 * For an operator asking "is this customer actually set up?" — the answer is re-derived
 * from the database rather than read from the last attempt, because a component can go
 * missing after a successful attempt.
 */
export async function readModuleProvisioningStatus(
  admin: SupabaseClient,
  companyId: string,
  moduleCode = "road_recovery"
): Promise<{ ok: boolean; components: ProvisioningComponent[]; error: string | null }> {
  if (!moduleNeedsProvisioning(moduleCode)) {
    return { ok: true, components: [], error: null };
  }

  const { data, error } = await admin.rpc("rr_provisioning_status", { p_company_id: companyId });
  if (error) return { ok: false, components: [], error: error.message };

  const rows = (Array.isArray(data) ? data : data ? [data] : []) as Row[];
  const components = rows.map((row) => ({
    component: asText(row.component),
    ok: row.ok === true,
    detail: asText(row.detail),
  }));

  return { ok: components.length > 0 && components.every((entry) => entry.ok), components, error: null };
}

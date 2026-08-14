/**
 * Subscription-scoped module access for customer users.
 *
 * The module catalogue is NOT redefined here. It is lib/platform/module-catalog.ts —
 * the same registry the Platform Console, the subscription plans and the solution
 * templates use (seeded by sql/062).
 *
 * The rule this file exists to enforce:
 *
 *     a user can only hold modules the COMPANY's subscription includes
 *
 * companies.enabled_modules is the company's entitlement, written by Platform Console
 * provisioning and the module toggle grid. A per-user grant is always intersected with
 * it, both on write (a request naming an unavailable module is rejected) and on read
 * (so downgrading a plan immediately narrows every user, with no migration needed).
 */

import { MODULE_CATALOG, moduleLabel } from "@/lib/platform/module-catalog";

const CATALOG_ORDER = new Map(MODULE_CATALOG.map((entry, index) => [entry.code, index]));

export type CompanyModuleOption = { code: string; label: string };

function normalizeCode(value: unknown): string {
  return String(value || "").trim().toLowerCase();
}

function sortByCatalog(codes: string[]): string[] {
  return [...codes].sort((a, b) => {
    const rankA = CATALOG_ORDER.get(a) ?? Number.MAX_SAFE_INTEGER;
    const rankB = CATALOG_ORDER.get(b) ?? Number.MAX_SAFE_INTEGER;
    if (rankA !== rankB) return rankA - rankB;
    return a.localeCompare(b);
  });
}

/**
 * The modules this company may hand out — its subscription entitlement, de-duplicated
 * and ordered by the platform catalogue.
 *
 * Codes the company holds that are not in the catalogue are kept rather than dropped:
 * a custom plan may legitimately enable a module the static catalogue has not caught up
 * with, and silently removing entitlement is worse than showing an unfamiliar code.
 */
export function companyAvailableModules(enabledModules: string[] | null | undefined): string[] {
  const codes = (enabledModules || []).map(normalizeCode).filter(Boolean);
  return sortByCatalog(Array.from(new Set(codes)));
}

export function companyModuleOptions(
  enabledModules: string[] | null | undefined
): CompanyModuleOption[] {
  return companyAvailableModules(enabledModules).map((code) => ({
    code,
    label: moduleLabel(code),
  }));
}

export type ModuleGrantResolution = {
  /** Modules to persist. NULL means "inherit every company module". */
  modules: string[] | null;
  /** Requested codes the company's subscription does not include. */
  rejected: string[];
};

/**
 * Resolves a requested per-user module grant against the company's entitlement.
 *
 * `requested === null | undefined` is the inherit-everything case and is stored as NULL,
 * so the user tracks the subscription automatically.
 */
export function resolveModuleGrant(
  requested: unknown,
  enabledModules: string[] | null | undefined
): ModuleGrantResolution {
  if (requested === null || requested === undefined) {
    return { modules: null, rejected: [] };
  }
  if (!Array.isArray(requested)) {
    return { modules: [], rejected: [] };
  }

  const available = new Set(companyAvailableModules(enabledModules));
  const granted: string[] = [];
  const rejected: string[] = [];

  for (const value of requested) {
    const code = normalizeCode(value);
    if (!code) continue;
    if (available.has(code)) granted.push(code);
    else if (!rejected.includes(code)) rejected.push(code);
  }

  return { modules: sortByCatalog(Array.from(new Set(granted))), rejected };
}

/**
 * The modules a stored membership actually resolves to today. Applied on every read so
 * a subscription downgrade narrows existing users without a data migration.
 */
export function effectiveUserModules(
  storedModuleAccess: string[] | null | undefined,
  enabledModules: string[] | null | undefined
): string[] {
  const available = companyAvailableModules(enabledModules);
  if (storedModuleAccess === null || storedModuleAccess === undefined) return available;

  const availableSet = new Set(available);
  return sortByCatalog(
    Array.from(
      new Set(storedModuleAccess.map(normalizeCode).filter((code) => code && availableSet.has(code)))
    )
  );
}

/** Human-readable access summary for the users table ("All 12 modules" / "Leave, Clocking"). */
export function summarizeModuleAccess(
  storedModuleAccess: string[] | null | undefined,
  enabledModules: string[] | null | undefined
): string {
  const available = companyAvailableModules(enabledModules);
  const effective = effectiveUserModules(storedModuleAccess, enabledModules);

  if (available.length === 0) return "No modules enabled for this company";
  if (effective.length === 0) return "No module access";
  if (effective.length === available.length) return `All ${available.length} modules`;
  if (effective.length <= 3) return effective.map(moduleLabel).join(", ");
  return `${effective.slice(0, 2).map(moduleLabel).join(", ")} +${effective.length - 2} more`;
}

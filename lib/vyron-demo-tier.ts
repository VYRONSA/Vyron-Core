/**
 * 30-day unlimited Demo tier — tenant lockout + master directory badge.
 *
 * Bypass: Vyron master operator session (handled in page load) and the permanent
 * sales sandbox company name {@link VYRON_SELLING_DEMO_COMPANY_NAME} (and normalized contains).
 */

/** Permanent sales sandbox — bypasses demo expiry (exact match or normalized substring). */
export const VYRON_SELLING_DEMO_COMPANY_NAME = "Vyron Demo Company";

export function isVyronSellingDemoCompanyName(companyName: string | undefined | null): boolean {
  const n = (companyName || "").trim().toLowerCase();
  return n === VYRON_SELLING_DEMO_COMPANY_NAME.toLowerCase() || n.includes("vyron demo company");
}

export function isVyronDemoSubscriptionTier(tier: string | undefined | null): boolean {
  return (tier || "").trim().toLowerCase() === "demo";
}

export function isVyronDemoPeriodExpired(demoStartedAt: string | undefined | null): boolean {
  if (!demoStartedAt) return false;
  const start = Date.parse(demoStartedAt);
  if (Number.isNaN(start)) return false;
  const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;
  return Date.now() > start + thirtyDaysMs;
}

export type VyronExpiredDemoTenantArgs = {
  subscriptionTier: string | undefined | null;
  demoStartedAt: string | undefined | null;
  companyName: string | undefined | null;
  /** True when signed in as Vyron master operator (e.g. info@vyronsoft.co.za). */
  masterOperatorBypass: boolean;
};

/** Full-screen demo lock for ordinary tenant users after 30 days. */
export function shouldBlockTenantForExpiredDemo(args: VyronExpiredDemoTenantArgs): boolean {
  if (args.masterOperatorBypass) return false;
  if (isVyronSellingDemoCompanyName(args.companyName)) return false;
  if (!isVyronDemoSubscriptionTier(args.subscriptionTier)) return false;
  return isVyronDemoPeriodExpired(args.demoStartedAt);
}

/** Master Client Directory: blinking badge when demo elapsed (excludes sales sandbox). */
export function shouldShowMasterDirectoryDemoExpiredBadge(entry: {
  companyName: string;
  subscriptionTier: string;
  demoStartedAt?: string | null;
}): boolean {
  if (isVyronSellingDemoCompanyName(entry.companyName)) return false;
  if (!isVyronDemoSubscriptionTier(entry.subscriptionTier)) return false;
  return isVyronDemoPeriodExpired(entry.demoStartedAt ?? null);
}

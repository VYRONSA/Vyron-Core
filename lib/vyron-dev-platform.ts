/**
 * VYRON DEV Phase 1 + Phase 2 + Phase 3 — master platform types, localStorage, and Supabase helpers.
 * Tables: vyron_clients, vyron_client_products, vyron_product_workspaces, vyron_product_packages,
 * vyron_support_sessions, vyron_client_integrations, vyron_product_deployments.
 */

import {
  isSupabaseMissingTableError,
  shouldSuppressWorkspaceLoadError,
  shouldSuppressWorkspaceLoadMessage,
} from "@/lib/company-access";
import {
  getPlatformWorkspaceId,
  isVyronDevUuid,
  readCachedDeveloperWorkspaceId,
} from "@/lib/developer-workspace";
import { readPublicSupabaseEnv } from "@/lib/public-env";
import { getSupabaseBrowserClient } from "@/lib/supabase";

export { getDeveloperWorkspaceId, getPlatformWorkspaceId } from "@/lib/developer-workspace";

export const VYRON_PRODUCT_CODES = [
  "CORE",
  "COST",
  "PAY",
  "FARM",
  "MAINT",
  "REACH",
  "FINANCE",
  "BUILD",
] as const;

export type VyronProductCode = (typeof VYRON_PRODUCT_CODES)[number];

export const VYRON_PRODUCT_NAMES: Record<VyronProductCode, string> = {
  CORE: "VYRON CORE",
  COST: "VYRON COST",
  PAY: "VYRON PAY",
  FARM: "VYRON FARM",
  MAINT: "VYRON MAINT",
  REACH: "VYRON REACH",
  FINANCE: "VYRON FINANCE",
  BUILD: "VYRON BUILD",
};

export type VyronProductStatus = "enabled" | "disabled" | "trial" | "suspended";

export type VyronWorkspaceStatus = "active" | "trial" | "suspended" | "provisioning" | "rebuilding";

export type VyronDevClientStatus = "active" | "trial" | "suspended" | "archived";

export type VyronPackageStatus = "active" | "deprecated" | "draft";

export type VyronDeploymentStatus = "healthy" | "needs_review" | "not_deployed" | "maintenance";

export type VyronDevPackage = {
  id: string;
  productCode: VyronProductCode;
  packageName: string;
  userLimit: number | null;
  companyLimit: number | null;
  storageLimitGb: number | null;
  monthlyValue: number;
  status: VyronPackageStatus;
};

export type VyronProductWorkspace = {
  id: string;
  /** vyron_product_workspaces.workspace_id */
  workspaceId: string;
  clientId: string;
  productCode: VyronProductCode;
  status: VyronProductStatus;
  workspaceStatus: VyronWorkspaceStatus;
  packageId: string | null;
  packageName: string | null;
  monthlyValue: number | null;
  createdAt: string;
  updatedAt: string;
  lastOpenedAt: string | null;
};

export type VyronDevClientProfile = {
  clientId: string;
  /** vyron_clients.client_ref */
  clientRef?: string;
  companyName?: string;
  tradingName: string;
  industry: string;
  primaryContact?: string;
  email?: string;
  phone?: string;
  status: VyronDevClientStatus;
  /** vyron_client_subscriptions.status */
  subscriptionStatus?: string;
  activeUserCount: number;
  createdAt?: string;
  updatedAt: string;
};

export type VyronDevActiveClientContext = {
  clientId: string;
  companyName: string;
  tradingName: string;
  primaryContactEmail: string;
  selectedAt: string;
};

export type VyronSupportSessionStatus = "active" | "ended";

export type VyronSupportSession = {
  sessionId: string;
  operator: string;
  clientId: string;
  clientName: string;
  productCode: VyronProductCode;
  startedAt: string;
  endedAt: string | null;
  status: VyronSupportSessionStatus;
};

export type VyronSupportSessionContext = {
  sessionId: string;
  operator: string;
  clientId: string;
  companyName: string;
  productCode: VyronProductCode;
  startedAt: string;
  /** When true, operator is viewing the live client CORE workspace (not VYRON DEV product pages). */
  supportMode?: boolean;
};

export function isVyronCoreSupportSession(
  session: VyronSupportSessionContext | null | undefined
): boolean {
  return Boolean(
    session?.clientId &&
      session.productCode === "CORE" &&
      session.supportMode !== false
  );
}

export type VyronClientProductIntegration = {
  id: string;
  clientId: string;
  productCode: VyronProductCode;
  xeroReadiness: VyronIntegrationReadiness;
  accountingReadiness: VyronIntegrationReadiness;
  payrollReadiness: VyronIntegrationReadiness;
  propertyReadiness: VyronIntegrationReadiness;
  lastSyncAt: string | null;
  notes: string;
};

export type VyronProductDeployment = {
  productCode: VyronProductCode;
  version: string;
  deploymentStatus: VyronDeploymentStatus;
  dbStatus: string;
  lastDeployment: string | null;
  environment: string;
  url: string;
};

export type VyronDevPlatformState = {
  clientProfiles: Record<string, VyronDevClientProfile>;
  productWorkspaces: VyronProductWorkspace[];
  /** clientId → productCode → packageId — maps to vyron_client_products.package_id */
  clientPackageAssignments: Record<string, Partial<Record<VyronProductCode, string>>>;
  supportSessions: VyronSupportSession[];
  clientIntegrations: VyronClientProductIntegration[];
};

export type VyronIntegrationReadiness = "ready" | "in_progress" | "planned";

export type VyronIntegrationStatus = {
  id: string;
  name: string;
  readiness: VyronIntegrationReadiness;
  notes: string;
};

export const VYRON_DEV_PLATFORM_STORAGE_KEY = "vyron_dev_platform_state";
export const VYRON_DEV_ACTIVE_CLIENT_KEY = "vyron_dev_active_client";
export const VYRON_DEV_SUPPORT_SESSION_KEY = "vyron_dev_support_session";

export const VYRON_DEV_DEFAULT_PACKAGES: VyronDevPackage[] = [
  {
    id: "pkg-core-starter",
    productCode: "CORE",
    packageName: "CORE Starter",
    userLimit: 25,
    companyLimit: 1,
    storageLimitGb: 10,
    monthlyValue: 1_499,
    status: "active",
  },
  {
    id: "pkg-core-professional",
    productCode: "CORE",
    packageName: "CORE Professional",
    userLimit: 100,
    companyLimit: 1,
    storageLimitGb: 50,
    monthlyValue: 4_999,
    status: "active",
  },
  {
    id: "pkg-core-business",
    productCode: "CORE",
    packageName: "CORE Business",
    userLimit: 250,
    companyLimit: 1,
    storageLimitGb: 100,
    monthlyValue: 7_500,
    status: "active",
  },
  {
    id: "pkg-core-enterprise",
    productCode: "CORE",
    packageName: "CORE Enterprise",
    userLimit: null,
    companyLimit: 5,
    storageLimitGb: null,
    monthlyValue: 0,
    status: "active",
  },
  {
    id: "pkg-cost-starter",
    productCode: "COST",
    packageName: "COST Starter",
    userLimit: 2,
    companyLimit: 1,
    storageLimitGb: 10,
    monthlyValue: 499,
    status: "active",
  },
  {
    id: "pkg-cost-growth",
    productCode: "COST",
    packageName: "COST Growth",
    userLimit: 5,
    companyLimit: 3,
    storageLimitGb: 25,
    monthlyValue: 1_499,
    status: "active",
  },
  {
    id: "pkg-cost-enterprise",
    productCode: "COST",
    packageName: "COST Enterprise",
    userLimit: null,
    companyLimit: 10,
    storageLimitGb: 100,
    monthlyValue: 24_999,
    status: "active",
  },
  {
    id: "pkg-pay-starter",
    productCode: "PAY",
    packageName: "PAY Starter",
    userLimit: 2,
    companyLimit: 1,
    storageLimitGb: 5,
    monthlyValue: 499,
    status: "active",
  },
  {
    id: "pkg-pay-professional",
    productCode: "PAY",
    packageName: "PAY Professional",
    userLimit: 10,
    companyLimit: 2,
    storageLimitGb: 25,
    monthlyValue: 4_999,
    status: "active",
  },
  {
    id: "pkg-pay-enterprise",
    productCode: "PAY",
    packageName: "PAY Enterprise",
    userLimit: null,
    companyLimit: 5,
    storageLimitGb: 80,
    monthlyValue: 19_999,
    status: "active",
  },
  {
    id: "pkg-farm-starter",
    productCode: "FARM",
    packageName: "FARM Starter",
    userLimit: 3,
    companyLimit: 1,
    storageLimitGb: 10,
    monthlyValue: 799,
    status: "active",
  },
  {
    id: "pkg-farm-professional",
    productCode: "FARM",
    packageName: "FARM Professional",
    userLimit: 10,
    companyLimit: 5,
    storageLimitGb: 30,
    monthlyValue: 2_999,
    status: "active",
  },
  {
    id: "pkg-farm-enterprise",
    productCode: "FARM",
    packageName: "FARM Enterprise",
    userLimit: null,
    companyLimit: 10,
    storageLimitGb: 100,
    monthlyValue: 14_999,
    status: "active",
  },
  {
    id: "pkg-maint-starter",
    productCode: "MAINT",
    packageName: "MAINT Starter",
    userLimit: 3,
    companyLimit: 1,
    storageLimitGb: 10,
    monthlyValue: 799,
    status: "active",
  },
  {
    id: "pkg-maint-professional",
    productCode: "MAINT",
    packageName: "MAINT Professional",
    userLimit: 8,
    companyLimit: 3,
    storageLimitGb: 30,
    monthlyValue: 2_499,
    status: "active",
  },
  {
    id: "pkg-maint-enterprise",
    productCode: "MAINT",
    packageName: "MAINT Enterprise",
    userLimit: null,
    companyLimit: 8,
    storageLimitGb: 80,
    monthlyValue: 12_999,
    status: "active",
  },
  {
    id: "pkg-reach-starter",
    productCode: "REACH",
    packageName: "REACH Starter",
    userLimit: 2,
    companyLimit: 1,
    storageLimitGb: 10,
    monthlyValue: 599,
    status: "active",
  },
  {
    id: "pkg-reach-growth",
    productCode: "REACH",
    packageName: "REACH Growth",
    userLimit: 5,
    companyLimit: 2,
    storageLimitGb: 15,
    monthlyValue: 1_499,
    status: "active",
  },
  {
    id: "pkg-reach-enterprise",
    productCode: "REACH",
    packageName: "REACH Enterprise",
    userLimit: null,
    companyLimit: 5,
    storageLimitGb: 60,
    monthlyValue: 9_999,
    status: "active",
  },
  {
    id: "pkg-finance-starter",
    productCode: "FINANCE",
    packageName: "FINANCE Starter",
    userLimit: 2,
    companyLimit: 1,
    storageLimitGb: 10,
    monthlyValue: 999,
    status: "active",
  },
  {
    id: "pkg-finance-professional",
    productCode: "FINANCE",
    packageName: "FINANCE Professional",
    userLimit: 8,
    companyLimit: 3,
    storageLimitGb: 40,
    monthlyValue: 7_999,
    status: "active",
  },
  {
    id: "pkg-finance-enterprise",
    productCode: "FINANCE",
    packageName: "FINANCE Enterprise",
    userLimit: null,
    companyLimit: 5,
    storageLimitGb: 80,
    monthlyValue: 19_999,
    status: "active",
  },
  {
    id: "pkg-build-starter",
    productCode: "BUILD",
    packageName: "BUILD Starter",
    userLimit: 2,
    companyLimit: 1,
    storageLimitGb: 5,
    monthlyValue: 399,
    status: "active",
  },
  {
    id: "pkg-build-professional",
    productCode: "BUILD",
    packageName: "BUILD Professional",
    userLimit: 6,
    companyLimit: 2,
    storageLimitGb: 20,
    monthlyValue: 1_999,
    status: "active",
  },
  {
    id: "pkg-build-enterprise",
    productCode: "BUILD",
    packageName: "BUILD Enterprise",
    userLimit: null,
    companyLimit: 5,
    storageLimitGb: 50,
    monthlyValue: 9_999,
    status: "active",
  },
];

export const VYRON_PRODUCT_DEPLOYMENTS: VyronProductDeployment[] = [
  {
    productCode: "CORE",
    version: "2.4.1",
    deploymentStatus: "healthy",
    dbStatus: "Connected",
    lastDeployment: "2026-06-01T08:00:00.000Z",
    environment: "production",
    url: "https://core.vyron.app",
  },
  {
    productCode: "COST",
    version: "1.2.0",
    deploymentStatus: "healthy",
    dbStatus: "Connected",
    lastDeployment: "2026-05-28T14:30:00.000Z",
    environment: "production",
    url: "https://cost.vyron.app",
  },
  {
    productCode: "PAY",
    version: "1.1.3",
    deploymentStatus: "needs_review",
    dbStatus: "Connected",
    lastDeployment: "2026-05-20T10:00:00.000Z",
    environment: "production",
    url: "https://pay.vyron.app",
  },
  {
    productCode: "FARM",
    version: "0.9.2",
    deploymentStatus: "healthy",
    dbStatus: "Connected",
    lastDeployment: "2026-05-15T09:00:00.000Z",
    environment: "production",
    url: "https://farm.vyron.app",
  },
  {
    productCode: "MAINT",
    version: "0.8.1",
    deploymentStatus: "maintenance",
    dbStatus: "Read-only",
    lastDeployment: "2026-05-10T11:00:00.000Z",
    environment: "production",
    url: "https://maint.vyron.app",
  },
  {
    productCode: "REACH",
    version: "0.7.0",
    deploymentStatus: "not_deployed",
    dbStatus: "Not provisioned",
    lastDeployment: null,
    environment: "staging",
    url: "https://reach-staging.vyron.app",
  },
  {
    productCode: "FINANCE",
    version: "0.6.5",
    deploymentStatus: "needs_review",
    dbStatus: "Connected",
    lastDeployment: "2026-05-01T16:00:00.000Z",
    environment: "production",
    url: "https://finance.vyron.app",
  },
  {
    productCode: "BUILD",
    version: "0.5.0",
    deploymentStatus: "not_deployed",
    dbStatus: "Not provisioned",
    lastDeployment: null,
    environment: "staging",
    url: "https://build-staging.vyron.app",
  },
];

export const VYRON_INTEGRATION_STATUSES: VyronIntegrationStatus[] = [
  {
    id: "xero",
    name: "Xero",
    readiness: "ready",
    notes: "OAuth connector scaffold ready for tenant workspace billing sync.",
  },
  {
    id: "future-accounting",
    name: "Future Accounting",
    readiness: "planned",
    notes: "Phase 2 — multi-ledger accounting bridge.",
  },
  {
    id: "future-payroll",
    name: "Future Payroll",
    readiness: "in_progress",
    notes: "Phase 2 — payroll export and statutory filing connectors.",
  },
  {
    id: "future-property",
    name: "Future Property",
    readiness: "planned",
    notes: "Phase 3 — property and asset register integrations.",
  },
];

function emptyPlatformState(): VyronDevPlatformState {
  return {
    clientProfiles: {},
    productWorkspaces: [],
    clientPackageAssignments: {},
    supportSessions: [],
    clientIntegrations: [],
  };
}

function normalizeWorkspace(ws: VyronProductWorkspace): VyronProductWorkspace {
  const pkg = getPackageById(ws.packageId);
  const workspaceId =
    ws.workspaceId && isVyronDevUuid(ws.workspaceId)
      ? ws.workspaceId
      : generateWorkspaceId(ws.productCode);
  return {
    ...ws,
    workspaceId,
    workspaceStatus:
      ws.workspaceStatus ||
      (ws.status === "trial"
        ? "trial"
        : ws.status === "suspended"
          ? "suspended"
          : ws.status === "disabled"
            ? "suspended"
            : "active"),
    monthlyValue: ws.monthlyValue ?? pkg?.monthlyValue ?? null,
    lastOpenedAt: ws.lastOpenedAt ?? null,
  };
}

function stripNonUuidVyronDevRecords(state: VyronDevPlatformState): VyronDevPlatformState {
  const clientProfiles: Record<string, VyronDevClientProfile> = {};
  for (const [clientId, profile] of Object.entries(state.clientProfiles)) {
    if (isVyronDevUuid(clientId) && isVyronDevUuid(profile.clientId)) {
      clientProfiles[clientId] = profile;
    }
  }

  const productWorkspaces = state.productWorkspaces.filter(
    (ws) => isVyronDevUuid(ws.clientId) && isVyronDevUuid(ws.workspaceId)
  );

  const clientPackageAssignments: VyronDevPlatformState["clientPackageAssignments"] = {};
  for (const [clientId, assignments] of Object.entries(state.clientPackageAssignments)) {
    if (isVyronDevUuid(clientId)) {
      clientPackageAssignments[clientId] = assignments;
    }
  }

  const supportSessions = state.supportSessions.filter((session) =>
    isVyronDevUuid(session.clientId)
  );

  const clientIntegrations = state.clientIntegrations.filter((integration) =>
    isVyronDevUuid(integration.clientId)
  );

  return {
    clientProfiles,
    productWorkspaces,
    clientPackageAssignments,
    supportSessions,
    clientIntegrations,
  };
}

function normalizePlatformState(parsed: Partial<VyronDevPlatformState>): VyronDevPlatformState {
  const normalized = {
    clientProfiles: parsed.clientProfiles || {},
    productWorkspaces: Array.isArray(parsed.productWorkspaces)
      ? parsed.productWorkspaces.map((ws) => normalizeWorkspace(ws as VyronProductWorkspace))
      : [],
    clientPackageAssignments: parsed.clientPackageAssignments || {},
    supportSessions: Array.isArray(parsed.supportSessions) ? parsed.supportSessions : [],
    clientIntegrations: Array.isArray(parsed.clientIntegrations) ? parsed.clientIntegrations : [],
  };
  return stripNonUuidVyronDevRecords(normalized);
}

export function readVyronDevPlatformState(): VyronDevPlatformState {
  if (typeof window === "undefined") return emptyPlatformState();
  try {
    const raw = window.localStorage.getItem(VYRON_DEV_PLATFORM_STORAGE_KEY);
    if (!raw) return emptyPlatformState();
    const parsed = JSON.parse(raw) as Partial<VyronDevPlatformState>;
    return normalizePlatformState(parsed);
  } catch {
    return emptyPlatformState();
  }
}

export function writeVyronDevPlatformState(state: VyronDevPlatformState): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(VYRON_DEV_PLATFORM_STORAGE_KEY, JSON.stringify(state));
}

export function readVyronDevActiveClient(): VyronDevActiveClientContext | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(VYRON_DEV_ACTIVE_CLIENT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as VyronDevActiveClientContext;
    if (!parsed?.clientId || !parsed.companyName) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function writeVyronDevActiveClient(context: VyronDevActiveClientContext | null): void {
  if (typeof window === "undefined") return;
  if (!context) {
    window.localStorage.removeItem(VYRON_DEV_ACTIVE_CLIENT_KEY);
    return;
  }
  window.localStorage.setItem(VYRON_DEV_ACTIVE_CLIENT_KEY, JSON.stringify(context));
}

export function readVyronDevSupportSession(): VyronSupportSessionContext | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(VYRON_DEV_SUPPORT_SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as VyronSupportSessionContext;
    if (!parsed?.sessionId || !parsed.clientId || !parsed.productCode) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function writeVyronDevSupportSession(context: VyronSupportSessionContext | null): void {
  if (typeof window === "undefined") return;
  if (!context) {
    window.localStorage.removeItem(VYRON_DEV_SUPPORT_SESSION_KEY);
    return;
  }
  window.localStorage.setItem(VYRON_DEV_SUPPORT_SESSION_KEY, JSON.stringify(context));
}

function generateId(prefix: string): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}`;
}

export function generateClientRef(existingRefs: string[]): string {
  const year = new Date().getFullYear();
  const prefix = `VYR-${year}-`;
  const nums = existingRefs
    .filter((r) => r.startsWith(prefix))
    .map((r) => parseInt(r.slice(prefix.length), 10))
    .filter((n) => !Number.isNaN(n));
  const next = (nums.length > 0 ? Math.max(...nums) : 0) + 1;
  return `${prefix}${String(next).padStart(4, "0")}`;
}

export function generateWorkspaceId(_productCode?: VyronProductCode): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return generateId("ws").replace(/^ws-/, "");
}

export function getPackagesForProduct(productCode: VyronProductCode): VyronDevPackage[] {
  return VYRON_DEV_DEFAULT_PACKAGES.filter(
    (pkg) => pkg.productCode === productCode && pkg.status === "active"
  );
}

/** Monthly package price for UI — Enterprise CORE uses contact-sales pricing. */
export function formatVyronPackageMonthlyValue(
  monthlyValue: number,
  packageName?: string | null
): string {
  const name = (packageName || "").toLowerCase();
  if (monthlyValue === 0 && name.includes("enterprise")) return "Contact Sales / Custom";
  if (monthlyValue === 0) return "Demo / Free";
  return `R ${monthlyValue.toLocaleString("en-ZA")}`;
}

export function getPackageById(packageId: string | null | undefined): VyronDevPackage | undefined {
  if (!packageId) return undefined;
  return VYRON_DEV_DEFAULT_PACKAGES.find((pkg) => pkg.id === packageId);
}

export function getDefaultPackageForProduct(productCode: VyronProductCode): VyronDevPackage | undefined {
  const packages = getPackagesForProduct(productCode);
  return packages.find((p) => p.packageName.toLowerCase().includes("starter")) || packages[0];
}

export function ensureClientProfile(
  state: VyronDevPlatformState,
  clientId: string,
  seed?: Partial<
    Pick<
      VyronDevClientProfile,
      | "tradingName"
      | "industry"
      | "status"
      | "activeUserCount"
      | "companyName"
      | "primaryContact"
      | "email"
      | "phone"
      | "clientRef"
      | "subscriptionStatus"
      | "createdAt"
    >
  >
): VyronDevPlatformState {
  if (state.clientProfiles[clientId]) return state;
  const now = new Date().toISOString();
  const existingRefs = Object.values(state.clientProfiles)
    .map((p) => p.clientRef)
    .filter(Boolean) as string[];
  const profile: VyronDevClientProfile = {
    clientId,
    clientRef: seed?.clientRef || generateClientRef(existingRefs),
    companyName: seed?.companyName,
    tradingName: seed?.tradingName || "",
    industry: seed?.industry || "General",
    primaryContact: seed?.primaryContact,
    email: seed?.email,
    phone: seed?.phone,
    status: seed?.status || "active",
    subscriptionStatus: seed?.subscriptionStatus || "active",
    activeUserCount: seed?.activeUserCount ?? 1,
    createdAt: seed?.createdAt || now,
    updatedAt: now,
  };
  return {
    ...state,
    clientProfiles: { ...state.clientProfiles, [clientId]: profile },
  };
}

export function upsertClientProfile(
  state: VyronDevPlatformState,
  profile: VyronDevClientProfile
): VyronDevPlatformState {
  return {
    ...state,
    clientProfiles: {
      ...state.clientProfiles,
      [profile.clientId]: { ...profile, updatedAt: new Date().toISOString() },
    },
  };
}

export type VyronClientProvisionInput = {
  clientId: string;
  companyName: string;
  tradingName: string;
  industry: string;
  primaryContact: string;
  email: string;
  phone: string;
  status: VyronDevClientStatus;
  createdAt?: string;
  subscriptionStatus?: string;
};

export function provisionVyronClient(
  state: VyronDevPlatformState,
  input: VyronClientProvisionInput
): VyronDevPlatformState {
  const existingRefs = Object.values(state.clientProfiles)
    .map((p) => p.clientRef)
    .filter(Boolean) as string[];
  const clientRef = generateClientRef(existingRefs);
  const now = input.createdAt || new Date().toISOString();

  let next = ensureClientProfile(state, input.clientId, {
    clientRef,
    companyName: input.companyName,
    tradingName: input.tradingName,
    industry: input.industry,
    primaryContact: input.primaryContact,
    email: input.email,
    phone: input.phone,
    status: input.status,
    subscriptionStatus: input.subscriptionStatus || "active",
    createdAt: now,
    activeUserCount: 1,
  });

  next = upsertClientProfile(next, {
    ...next.clientProfiles[input.clientId]!,
    clientRef,
    companyName: input.companyName,
    tradingName: input.tradingName,
    industry: input.industry,
    primaryContact: input.primaryContact,
    email: input.email,
    phone: input.phone,
    status: input.status,
    subscriptionStatus: input.subscriptionStatus || "active",
    createdAt: now,
    activeUserCount: 1,
    updatedAt: now,
  });

  return next;
}

export function getClientProductWorkspace(
  state: VyronDevPlatformState,
  clientId: string,
  productCode: VyronProductCode
): VyronProductWorkspace | undefined {
  return state.productWorkspaces.find(
    (ws) => ws.clientId === clientId && ws.productCode === productCode
  );
}

export function getClientProductStatus(
  state: VyronDevPlatformState,
  clientId: string,
  productCode: VyronProductCode
): VyronProductStatus {
  const ws = getClientProductWorkspace(state, clientId, productCode);
  return ws?.status ?? "disabled";
}

function workspaceStatusFromProduct(status: VyronProductStatus): VyronWorkspaceStatus {
  if (status === "trial") return "trial";
  if (status === "suspended") return "suspended";
  if (status === "disabled") return "suspended";
  return "active";
}

export function setClientProductStatus(
  state: VyronDevPlatformState,
  clientId: string,
  productCode: VyronProductCode,
  status: VyronProductStatus,
  packageId?: string | null
): VyronDevPlatformState {
  const now = new Date().toISOString();
  const existing = getClientProductWorkspace(state, clientId, productCode);
  const resolvedPackageId =
    packageId !== undefined
      ? packageId
      : state.clientPackageAssignments[clientId]?.[productCode] ?? existing?.packageId ?? null;
  const pkg = getPackageById(resolvedPackageId);

  let workspaces = state.productWorkspaces;
  if (existing) {
    workspaces = workspaces.map((ws) =>
      ws.id === existing.id
        ? {
            ...ws,
            status,
            workspaceStatus: workspaceStatusFromProduct(status),
            packageId: resolvedPackageId,
            packageName: pkg?.packageName ?? ws.packageName,
            monthlyValue: pkg?.monthlyValue ?? ws.monthlyValue,
            updatedAt: now,
          }
        : ws
    );
  } else if (status !== "disabled") {
    const defaultPkg = pkg || getDefaultPackageForProduct(productCode);
    workspaces = [
      ...workspaces,
      {
        id: generateId("ws"),
        workspaceId: generateWorkspaceId(productCode),
        clientId,
        productCode,
        status,
        workspaceStatus: workspaceStatusFromProduct(status),
        packageId: resolvedPackageId || defaultPkg?.id || null,
        packageName: pkg?.packageName ?? defaultPkg?.packageName ?? null,
        monthlyValue: pkg?.monthlyValue ?? defaultPkg?.monthlyValue ?? null,
        createdAt: now,
        updatedAt: now,
        lastOpenedAt: null,
      },
    ];
  }

  const assignments = { ...state.clientPackageAssignments };
  const finalPkgId = resolvedPackageId || pkg?.id || getDefaultPackageForProduct(productCode)?.id;
  if (finalPkgId && status !== "disabled") {
    assignments[clientId] = { ...assignments[clientId], [productCode]: finalPkgId };
  }

  return ensureClientProfile(
    { ...state, productWorkspaces: workspaces, clientPackageAssignments: assignments },
    clientId
  );
}

export function assignClientPackage(
  state: VyronDevPlatformState,
  clientId: string,
  productCode: VyronProductCode,
  packageId: string
): VyronDevPlatformState {
  const pkg = getPackageById(packageId);
  if (!pkg) return state;

  const assignments = {
    ...state.clientPackageAssignments,
    [clientId]: { ...state.clientPackageAssignments[clientId], [productCode]: packageId },
  };

  const existing = getClientProductWorkspace(state, clientId, productCode);
  let workspaces = state.productWorkspaces;
  const now = new Date().toISOString();

  if (existing) {
    workspaces = workspaces.map((ws) =>
      ws.clientId === clientId && ws.productCode === productCode
        ? {
            ...ws,
            packageId,
            packageName: pkg.packageName,
            monthlyValue: pkg.monthlyValue,
            updatedAt: now,
          }
        : ws
    );
  }

  return ensureClientProfile(
    { ...state, clientPackageAssignments: assignments, productWorkspaces: workspaces },
    clientId
  );
}

export function createProductWorkspace(
  state: VyronDevPlatformState,
  clientId: string,
  productCode: VyronProductCode
): VyronDevPlatformState {
  const existing = getClientProductWorkspace(state, clientId, productCode);
  if (existing) return state;

  const defaultPkg = getDefaultPackageForProduct(productCode);
  return setClientProductStatus(
    state,
    clientId,
    productCode,
    "enabled",
    defaultPkg?.id ?? null
  );
}

export function rebuildProductWorkspace(
  state: VyronDevPlatformState,
  clientId: string,
  productCode: VyronProductCode
): VyronDevPlatformState {
  const existing = getClientProductWorkspace(state, clientId, productCode);
  if (!existing) return createProductWorkspace(state, clientId, productCode);

  const now = new Date().toISOString();
  const workspaces = state.productWorkspaces.map((ws) =>
    ws.clientId === clientId && ws.productCode === productCode
      ? {
          ...ws,
          workspaceId: generateWorkspaceId(productCode),
          workspaceStatus: "active" as VyronWorkspaceStatus,
          updatedAt: now,
        }
      : ws
  );

  return { ...state, productWorkspaces: workspaces };
}

export function suspendProductWorkspace(
  state: VyronDevPlatformState,
  clientId: string,
  productCode: VyronProductCode
): VyronDevPlatformState {
  return setClientProductStatus(state, clientId, productCode, "suspended");
}

export function openProductWorkspace(
  state: VyronDevPlatformState,
  clientId: string,
  productCode: VyronProductCode
): VyronDevPlatformState {
  const existing = getClientProductWorkspace(state, clientId, productCode);
  if (!existing) return state;

  const now = new Date().toISOString();
  const workspaces = state.productWorkspaces.map((ws) =>
    ws.clientId === clientId && ws.productCode === productCode
      ? { ...ws, lastOpenedAt: now, updatedAt: now }
      : ws
  );

  return { ...state, productWorkspaces: workspaces };
}

export function startSupportSession(
  state: VyronDevPlatformState,
  params: {
    operator: string;
    clientId: string;
    clientName: string;
    productCode: VyronProductCode;
  }
): { state: VyronDevPlatformState; session: VyronSupportSessionContext } {
  const now = new Date().toISOString();
  const sessionId = generateId("sess");
  const session: VyronSupportSession = {
    sessionId,
    operator: params.operator,
    clientId: params.clientId,
    clientName: params.clientName,
    productCode: params.productCode,
    startedAt: now,
    endedAt: null,
    status: "active",
  };

  const endedSessions = state.supportSessions.map((s) =>
    s.status === "active"
      ? { ...s, status: "ended" as VyronSupportSessionStatus, endedAt: now }
      : s
  );

  const context: VyronSupportSessionContext = {
    sessionId,
    operator: params.operator,
    clientId: params.clientId,
    companyName: params.clientName,
    productCode: params.productCode,
    startedAt: now,
    supportMode: params.productCode === "CORE",
  };

  return {
    state: { ...state, supportSessions: [...endedSessions, session] },
    session: context,
  };
}

export function endSupportSession(
  state: VyronDevPlatformState,
  sessionId: string
): VyronDevPlatformState {
  const now = new Date().toISOString();
  return {
    ...state,
    supportSessions: state.supportSessions.map((s) =>
      s.sessionId === sessionId && s.status === "active"
        ? { ...s, status: "ended", endedAt: now }
        : s
    ),
  };
}

export function getActiveSupportSessions(state: VyronDevPlatformState): VyronSupportSession[] {
  return state.supportSessions.filter((s) => s.status === "active");
}

export function getOrCreateClientIntegration(
  state: VyronDevPlatformState,
  clientId: string,
  productCode: VyronProductCode
): VyronClientProductIntegration {
  const existing = state.clientIntegrations.find(
    (i) => i.clientId === clientId && i.productCode === productCode
  );
  if (existing) return existing;

  const isXeroProduct = productCode === "COST" || productCode === "PAY";
  return {
    id:
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : generateId("int"),
    clientId,
    productCode,
    xeroReadiness: isXeroProduct ? "in_progress" : "planned",
    accountingReadiness: "planned",
    payrollReadiness: productCode === "PAY" ? "in_progress" : "planned",
    propertyReadiness: "planned",
    lastSyncAt: null,
    notes: "",
  };
}

export function upsertClientIntegration(
  state: VyronDevPlatformState,
  integration: VyronClientProductIntegration
): VyronDevPlatformState {
  const filtered = state.clientIntegrations.filter(
    (i) => !(i.clientId === integration.clientId && i.productCode === integration.productCode)
  );
  return { ...state, clientIntegrations: [...filtered, integration] };
}

/** Minimal company row shape from master client directory (avoids importing page.tsx). */
export type VyronDevDirectorySourceEntry = {
  id: string;
  companyName: string;
  primaryAdminEmail: string;
  contactPerson?: string;
  phone?: string;
  registrationDate: string;
  subscriptionTier: string;
  monthlyFee?: number | null;
  subscriptionStatus?: string;
  companyStatus?: string;
};

export type VyronDevDirectoryClient = {
  id: string;
  clientRef: string;
  companyName: string;
  tradingName: string;
  status: VyronDevClientStatus;
  industry: string;
  primaryContact: string;
  email: string;
  phone: string;
  registrationDate: string;
  subscriptionTier: string;
  subscriptionStatus: string;
  monthlyFee: number;
};

export type VyronDevMasterDashboardMetrics = {
  totalClients: number;
  activeClients: number;
  totalActiveUsers: number;
  totalWorkspaces: number;
  activeSupportSessions: number;
  productsEnabled: number;
  mrr: number;
  trialClients: number;
  suspendedClients: number;
  productBreakdown: Record<
    VyronProductCode,
    { enabled: number; trial: number; suspended: number; disabled: number }
  >;
  productEnabledClientCounts: Record<VyronProductCode, number>;
};

export function computeMasterDashboardMetrics(
  clients: VyronDevDirectoryClient[],
  platformState: VyronDevPlatformState
): VyronDevMasterDashboardMetrics {
  const liveClients = clients.filter((c) => c.status !== "archived");
  const activeClients = liveClients.filter((c) => c.status === "active" || c.status === "trial");

  const productBreakdown = VYRON_PRODUCT_CODES.reduce(
    (acc, code) => {
      acc[code] = { enabled: 0, trial: 0, suspended: 0, disabled: 0 };
      return acc;
    },
    {} as VyronDevMasterDashboardMetrics["productBreakdown"]
  );

  const productEnabledClientCounts = VYRON_PRODUCT_CODES.reduce(
    (acc, code) => {
      acc[code] = 0;
      return acc;
    },
    {} as VyronDevMasterDashboardMetrics["productEnabledClientCounts"]
  );

  for (const client of liveClients) {
    for (const code of VYRON_PRODUCT_CODES) {
      const status = getClientProductStatus(platformState, client.id, code);
      productBreakdown[code][status === "enabled" ? "enabled" : status]++;
      if (status === "enabled" || status === "trial") {
        productEnabledClientCounts[code] += 1;
      }
    }
  }

  const productsEnabled = platformState.productWorkspaces.filter(
    (ws) => ws.status === "enabled" || ws.status === "trial"
  ).length;

  const totalWorkspaces = platformState.productWorkspaces.filter(
    (ws) => ws.status !== "disabled"
  ).length;

  const mrr = liveClients.reduce((sum, client) => {
    if (client.status === "suspended") return sum;
    let clientMrr = client.monthlyFee;
    for (const code of VYRON_PRODUCT_CODES) {
      const ws = getClientProductWorkspace(platformState, client.id, code);
      if (ws && (ws.status === "enabled" || ws.status === "trial")) {
        const pkg = getPackageById(ws.packageId);
        if (pkg && pkg.monthlyValue > 0) clientMrr += pkg.monthlyValue;
      }
    }
    return sum + clientMrr;
  }, 0);

  return {
    totalClients: liveClients.length,
    activeClients: activeClients.length,
    totalActiveUsers: liveClients.reduce((sum, c) => {
      const profile = platformState.clientProfiles[c.id];
      return sum + (profile?.activeUserCount ?? 1);
    }, 0),
    totalWorkspaces,
    activeSupportSessions: getActiveSupportSessions(platformState).length,
    productsEnabled,
    mrr,
    trialClients: liveClients.filter((c) => c.status === "trial").length,
    suspendedClients: liveClients.filter((c) => c.status === "suspended").length,
    productBreakdown,
    productEnabledClientCounts,
  };
}

export type VyronDevClientBillingSummary = {
  subscriptionStatus: string;
  monthlyRevenue: number;
  productsEnabled: number;
  productsTrial: number;
  productsSuspended: number;
  packageValue: number;
};

export type VyronDevProductRevenueBreakdown = {
  productCode: VyronProductCode;
  productName: string;
  enabledClients: number;
  trialClients: number;
  suspendedClients: number;
  mrr: number;
};

export function computeProductRevenueBreakdown(
  clients: VyronDevDirectoryClient[],
  platformState: VyronDevPlatformState
): VyronDevProductRevenueBreakdown[] {
  const liveClients = clients.filter((c) => c.status !== "archived");

  return VYRON_PRODUCT_CODES.map((code) => {
    let enabledClients = 0;
    let trialClients = 0;
    let suspendedClients = 0;
    let mrr = 0;

    for (const client of liveClients) {
      const ws = getClientProductWorkspace(platformState, client.id, code);
      if (!ws || ws.status === "disabled") continue;
      if (ws.status === "enabled") enabledClients += 1;
      if (ws.status === "trial") trialClients += 1;
      if (ws.status === "suspended") suspendedClients += 1;
      if ((ws.status === "enabled" || ws.status === "trial") && client.status !== "suspended") {
        const pkg = getPackageById(ws.packageId);
        if (pkg && pkg.monthlyValue > 0) mrr += pkg.monthlyValue;
      }
    }

    return {
      productCode: code,
      productName: VYRON_PRODUCT_NAMES[code],
      enabledClients,
      trialClients,
      suspendedClients,
      mrr,
    };
  });
}

export function computeClientBillingSummary(
  client: VyronDevDirectoryClient,
  platformState: VyronDevPlatformState
): VyronDevClientBillingSummary {
  let packageValue = 0;
  let productsEnabled = 0;
  let productsTrial = 0;
  let productsSuspended = 0;

  for (const code of VYRON_PRODUCT_CODES) {
    const ws = getClientProductWorkspace(platformState, client.id, code);
    if (!ws || ws.status === "disabled") continue;
    if (ws.status === "enabled") {
      productsEnabled += 1;
      const pkg = getPackageById(ws.packageId);
      if (pkg && pkg.monthlyValue > 0) packageValue += pkg.monthlyValue;
    } else if (ws.status === "trial") {
      productsTrial += 1;
      const pkg = getPackageById(ws.packageId);
      if (pkg && pkg.monthlyValue > 0) packageValue += pkg.monthlyValue;
    } else if (ws.status === "suspended") {
      productsSuspended += 1;
    }
  }

  const subscriptionStatus =
    client.status === "suspended"
      ? "Suspended"
      : client.status === "trial"
        ? "Trial"
        : client.status === "archived"
          ? "Archived"
          : client.subscriptionStatus || "Active";

  return {
    subscriptionStatus,
    monthlyRevenue: client.monthlyFee + packageValue,
    productsEnabled,
    productsTrial,
    productsSuspended,
    packageValue,
  };
}

export function mapDirectoryEntryToDevClient(
  entry: VyronDevDirectorySourceEntry,
  platformState: VyronDevPlatformState
): VyronDevDirectoryClient {
  const profile = platformState.clientProfiles[entry.id];
  const companyArchived = (entry.companyStatus || "").toLowerCase() === "archived";
  const onHold = (entry.subscriptionStatus || "").toLowerCase() === "on-hold";
  const isDemo = (entry.subscriptionTier || "").toLowerCase() === "demo";

  let status: VyronDevClientStatus = profile?.status ?? "active";
  if (companyArchived) status = "archived";
  else if (profile?.status === "suspended" || onHold) status = "suspended";
  else if (isDemo || profile?.status === "trial") status = "trial";

  const monthlyFee =
    entry.monthlyFee != null && !Number.isNaN(Number(entry.monthlyFee))
      ? Number(entry.monthlyFee)
      : 0;

  return {
    id: entry.id,
    clientRef:
      profile?.clientRef ||
      `VYR-${entry.id.replace(/-/g, "").slice(0, 8).toUpperCase()}`,
    companyName: entry.companyName,
    tradingName: profile?.tradingName || entry.companyName,
    status,
    industry: profile?.industry || "General",
    primaryContact: profile?.primaryContact || entry.contactPerson || "—",
    email: profile?.email || entry.primaryAdminEmail || "—",
    phone: profile?.phone || entry.phone || "—",
    registrationDate: profile?.createdAt || entry.registrationDate,
    subscriptionTier: entry.subscriptionTier,
    subscriptionStatus: profile?.subscriptionStatus || entry.subscriptionStatus || "active",
    monthlyFee,
  };
}

export function isCoreProductAvailable(productCode: VyronProductCode): boolean {
  return productCode === "CORE";
}

export function productOpenLabel(productCode: VyronProductCode): string {
  return `Open ${productCode}`;
}

export function deploymentStatusLabel(status: VyronDeploymentStatus): string {
  const labels: Record<VyronDeploymentStatus, string> = {
    healthy: "Healthy",
    needs_review: "Needs Review",
    not_deployed: "Not Deployed",
    maintenance: "Maintenance",
  };
  return labels[status];
}

export function deploymentStatusClass(status: VyronDeploymentStatus): string {
  if (status === "healthy") return "bg-emerald-100 text-emerald-800";
  if (status === "needs_review") return "bg-amber-100 text-amber-900";
  if (status === "maintenance") return "bg-violet-100 text-violet-900";
  return "bg-slate-200 text-slate-700";
}

// ---------------------------------------------------------------------------
// Phase 3 — Supabase persistence (browser client; graceful fallback)
// ---------------------------------------------------------------------------

export type VyronDevPersistenceStatus = "local" | "supabase" | "syncing" | "error";

export type VyronDevSupabaseFetchResult = {
  state: VyronDevPlatformState | null;
  tablesAvailable: boolean;
  error: string | null;
};

export type VyronDevSupabaseSaveResult = {
  ok: boolean;
  tablesAvailable: boolean;
  error: string | null;
};

const VYRON_DEV_TABLES = [
  "vyron_developer_workspaces",
  "vyron_clients",
  "vyron_client_products",
  "vyron_product_workspaces",
  "vyron_product_packages",
  "vyron_support_sessions",
  "vyron_client_integrations",
  "vyron_product_deployments",
] as const;

async function resolveDeveloperWorkspaceIdForSupabase(): Promise<string | null> {
  const resolved =
    (await getPlatformWorkspaceId()) ?? readCachedDeveloperWorkspaceId();
  return resolved && isVyronDevUuid(resolved) ? resolved : null;
}

function isVyronDevMissingTableError(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false;
  return VYRON_DEV_TABLES.some((table) => isSupabaseMissingTableError(error, table));
}

function getVyronDevSupabaseClient() {
  if (typeof window === "undefined") return null;
  const { url, anonKey } = readPublicSupabaseEnv();
  if (!url || !anonKey) return null;
  try {
    return getSupabaseBrowserClient();
  } catch {
    return null;
  }
}

function clientProfileToRow(profile: VyronDevClientProfile, developerWorkspaceId: string) {
  return {
    id: profile.clientId,
    developer_workspace_id: developerWorkspaceId,
    client_ref: profile.clientRef || profile.clientId,
    company_name: profile.companyName || profile.tradingName || "Unknown",
    trading_name: profile.tradingName || null,
    industry: profile.industry || null,
    primary_contact: profile.primaryContact || null,
    email: profile.email || null,
    phone: profile.phone || null,
    status: profile.status,
    subscription_status: profile.subscriptionStatus || "active",
    active_user_count: profile.activeUserCount ?? 1,
    created_at: profile.createdAt || profile.updatedAt,
    updated_at: profile.updatedAt,
  };
}

function rowToClientProfile(row: Record<string, unknown>): VyronDevClientProfile {
  return {
    clientId: String(row.id),
    clientRef: String(row.client_ref),
    companyName: row.company_name ? String(row.company_name) : undefined,
    tradingName: String(row.trading_name || row.company_name || ""),
    industry: String(row.industry || "General"),
    primaryContact: row.primary_contact ? String(row.primary_contact) : undefined,
    email: row.email ? String(row.email) : undefined,
    phone: row.phone ? String(row.phone) : undefined,
    status: row.status as VyronDevClientStatus,
    subscriptionStatus: row.subscription_status ? String(row.subscription_status) : undefined,
    activeUserCount: Number(row.active_user_count ?? 1),
    createdAt: row.created_at ? String(row.created_at) : undefined,
    updatedAt: String(row.updated_at || new Date().toISOString()),
  };
}

function workspaceToWorkspaceRow(ws: VyronProductWorkspace, developerWorkspaceId: string) {
  const row: Record<string, unknown> = {
    developer_workspace_id: developerWorkspaceId,
    workspace_id: ws.workspaceId,
    client_id: ws.clientId,
    product_code: ws.productCode,
    status: ws.status,
    workspace_status: ws.workspaceStatus,
    package_id: ws.packageId,
    package_name: ws.packageName,
    monthly_value: ws.monthlyValue,
    last_opened_at: ws.lastOpenedAt,
    created_at: ws.createdAt,
    updated_at: ws.updatedAt,
  };
  if (isVyronDevUuid(ws.id)) {
    row.id = ws.id;
  }
  return row;
}

function rowToWorkspace(row: Record<string, unknown>): VyronProductWorkspace {
  return normalizeWorkspace({
    id: String(row.id),
    workspaceId: String(row.workspace_id),
    clientId: String(row.client_id),
    productCode: row.product_code as VyronProductCode,
    status: row.status as VyronProductStatus,
    workspaceStatus: row.workspace_status as VyronWorkspaceStatus,
    packageId: row.package_id ? String(row.package_id) : null,
    packageName: row.package_name ? String(row.package_name) : null,
    monthlyValue: row.monthly_value != null ? Number(row.monthly_value) : null,
    createdAt: String(row.created_at || new Date().toISOString()),
    updatedAt: String(row.updated_at || new Date().toISOString()),
    lastOpenedAt: row.last_opened_at ? String(row.last_opened_at) : null,
  });
}

function rowToSupportSession(row: Record<string, unknown>): VyronSupportSession {
  return {
    sessionId: String(row.session_id),
    operator: String(row.operator_email),
    clientId: row.client_id ? String(row.client_id) : "",
    clientName: String(row.client_name),
    productCode: row.product_code as VyronProductCode,
    startedAt: String(row.started_at),
    endedAt: row.ended_at ? String(row.ended_at) : null,
    status: row.status as VyronSupportSessionStatus,
  };
}

function rowToIntegration(row: Record<string, unknown>): VyronClientProductIntegration {
  return {
    id: String(row.id),
    clientId: String(row.client_id),
    productCode: row.product_code as VyronProductCode,
    xeroReadiness: row.xero_readiness as VyronIntegrationReadiness,
    accountingReadiness: row.accounting_readiness as VyronIntegrationReadiness,
    payrollReadiness: row.payroll_readiness as VyronIntegrationReadiness,
    propertyReadiness: row.property_readiness as VyronIntegrationReadiness,
    lastSyncAt: row.last_sync_at ? String(row.last_sync_at) : null,
    notes: String(row.notes || ""),
  };
}

export function mergeVyronDevPlatformState(
  local: VyronDevPlatformState,
  remote: VyronDevPlatformState
): VyronDevPlatformState {
  const clientProfiles = { ...local.clientProfiles, ...remote.clientProfiles };

  const workspaceMap = new Map<string, VyronProductWorkspace>();
  for (const ws of local.productWorkspaces) {
    workspaceMap.set(`${ws.clientId}:${ws.productCode}`, ws);
  }
  for (const ws of remote.productWorkspaces) {
    workspaceMap.set(`${ws.clientId}:${ws.productCode}`, ws);
  }

  const clientPackageAssignments = { ...local.clientPackageAssignments };
  for (const [clientId, assignments] of Object.entries(remote.clientPackageAssignments)) {
    clientPackageAssignments[clientId] = {
      ...clientPackageAssignments[clientId],
      ...assignments,
    };
  }
  for (const ws of remote.productWorkspaces) {
    if (ws.packageId && ws.status !== "disabled") {
      clientPackageAssignments[ws.clientId] = {
        ...clientPackageAssignments[ws.clientId],
        [ws.productCode]: ws.packageId,
      };
    }
  }

  const sessionMap = new Map<string, VyronSupportSession>();
  for (const session of local.supportSessions) {
    sessionMap.set(session.sessionId, session);
  }
  for (const session of remote.supportSessions) {
    sessionMap.set(session.sessionId, session);
  }

  const integrationMap = new Map<string, VyronClientProductIntegration>();
  for (const integration of local.clientIntegrations) {
    integrationMap.set(`${integration.clientId}:${integration.productCode}`, integration);
  }
  for (const integration of remote.clientIntegrations) {
    integrationMap.set(`${integration.clientId}:${integration.productCode}`, integration);
  }

  return normalizePlatformState({
    clientProfiles,
    productWorkspaces: Array.from(workspaceMap.values()),
    clientPackageAssignments,
    supportSessions: Array.from(sessionMap.values()),
    clientIntegrations: Array.from(integrationMap.values()),
  });
}

export async function fetchVyronDevPlatformStateFromSupabase(): Promise<VyronDevSupabaseFetchResult> {
  const supabase = getVyronDevSupabaseClient();
  if (!supabase) {
    return { state: null, tablesAvailable: false, error: null };
  }

  try {
    const developerWorkspaceId = await resolveDeveloperWorkspaceIdForSupabase();
    if (!developerWorkspaceId) {
      return { state: null, tablesAvailable: false, error: null };
    }

    const [clientsRes, workspacesRes, sessionsRes, integrationsRes] = await Promise.all([
      supabase
        .from("vyron_clients")
        .select("*")
        .eq("developer_workspace_id", developerWorkspaceId),
      supabase
        .from("vyron_product_workspaces")
        .select("*")
        .eq("developer_workspace_id", developerWorkspaceId),
      supabase
        .from("vyron_support_sessions")
        .select("*")
        .eq("developer_workspace_id", developerWorkspaceId)
        .order("started_at", { ascending: false }),
      supabase
        .from("vyron_client_integrations")
        .select("*")
        .eq("developer_workspace_id", developerWorkspaceId),
    ]);

    const firstError =
      clientsRes.error || workspacesRes.error || sessionsRes.error || integrationsRes.error;
    if (firstError) {
      if (isVyronDevMissingTableError(firstError) || shouldSuppressWorkspaceLoadError(firstError)) {
        return { state: null, tablesAvailable: false, error: null };
      }
      return { state: null, tablesAvailable: true, error: firstError.message };
    }

    const clientProfiles: Record<string, VyronDevClientProfile> = {};
    for (const row of clientsRes.data || []) {
      const profile = rowToClientProfile(row as Record<string, unknown>);
      clientProfiles[profile.clientId] = profile;
    }

    const productWorkspaces = (workspacesRes.data || []).map((row) =>
      rowToWorkspace(row as Record<string, unknown>)
    );

    const clientPackageAssignments: VyronDevPlatformState["clientPackageAssignments"] = {};
    for (const ws of productWorkspaces) {
      if (ws.packageId && ws.status !== "disabled") {
        clientPackageAssignments[ws.clientId] = {
          ...clientPackageAssignments[ws.clientId],
          [ws.productCode]: ws.packageId,
        };
      }
    }

    const supportSessions = (sessionsRes.data || []).map((row) =>
      rowToSupportSession(row as Record<string, unknown>)
    );

    const clientIntegrations = (integrationsRes.data || []).map((row) =>
      rowToIntegration(row as Record<string, unknown>)
    );

    return {
      state: normalizePlatformState({
        clientProfiles,
        productWorkspaces,
        clientPackageAssignments,
        supportSessions,
        clientIntegrations,
      }),
      tablesAvailable: true,
      error: null,
    };
  } catch (err) {
    return {
      state: null,
      tablesAvailable: false,
      error: err instanceof Error ? err.message : "Supabase fetch failed",
    };
  }
}

export async function saveVyronClientToSupabase(
  profile: VyronDevClientProfile
): Promise<VyronDevSupabaseSaveResult> {
  const supabase = getVyronDevSupabaseClient();
  if (!supabase) return { ok: false, tablesAvailable: false, error: null };
  if (!isVyronDevUuid(profile.clientId)) {
    return { ok: false, tablesAvailable: true, error: null };
  }

  try {
    const developerWorkspaceId = await resolveDeveloperWorkspaceIdForSupabase();
    if (!developerWorkspaceId) {
      return { ok: false, tablesAvailable: false, error: null };
    }

    const { error } = await supabase
      .from("vyron_clients")
      .upsert(clientProfileToRow(profile, developerWorkspaceId), { onConflict: "id" });
    if (error) {
      if (isVyronDevMissingTableError(error)) {
        return { ok: false, tablesAvailable: false, error: null };
      }
      return { ok: false, tablesAvailable: true, error: error.message };
    }
    return { ok: true, tablesAvailable: true, error: null };
  } catch (err) {
    return {
      ok: false,
      tablesAvailable: false,
      error: err instanceof Error ? err.message : "Save client failed",
    };
  }
}

export async function saveClientProductStatusToSupabase(
  clientId: string,
  productCode: VyronProductCode,
  status: VyronProductStatus,
  packageId?: string | null,
  workspace?: VyronProductWorkspace | null
): Promise<VyronDevSupabaseSaveResult> {
  const supabase = getVyronDevSupabaseClient();
  if (!supabase) return { ok: false, tablesAvailable: false, error: null };
  if (!isVyronDevUuid(clientId)) {
    return { ok: false, tablesAvailable: true, error: null };
  }

  const developerWorkspaceId = await resolveDeveloperWorkspaceIdForSupabase();
  if (!developerWorkspaceId) {
    return { ok: false, tablesAvailable: false, error: null };
  }

  const pkg = getPackageById(packageId);
  const payload = {
    developer_workspace_id: developerWorkspaceId,
    client_id: clientId,
    product_code: productCode,
    status,
    package_id: packageId ?? null,
    package_name: pkg?.packageName ?? workspace?.packageName ?? null,
    monthly_value: pkg?.monthlyValue ?? workspace?.monthlyValue ?? null,
    updated_at: new Date().toISOString(),
  };

  try {
    const { error } = await supabase
      .from("vyron_client_products")
      .upsert(payload, { onConflict: "client_id,product_code" });
    if (error) {
      if (isVyronDevMissingTableError(error)) {
        return { ok: false, tablesAvailable: false, error: null };
      }
      return { ok: false, tablesAvailable: true, error: error.message };
    }
    return { ok: true, tablesAvailable: true, error: null };
  } catch (err) {
    return {
      ok: false,
      tablesAvailable: false,
      error: err instanceof Error ? err.message : "Save product status failed",
    };
  }
}

export async function saveProductWorkspaceToSupabase(
  workspace: VyronProductWorkspace
): Promise<VyronDevSupabaseSaveResult> {
  const supabase = getVyronDevSupabaseClient();
  if (!supabase) return { ok: false, tablesAvailable: false, error: null };
  const normalizedWorkspace = normalizeWorkspace(workspace);
  if (!isVyronDevUuid(normalizedWorkspace.clientId)) {
    return { ok: false, tablesAvailable: true, error: null };
  }

  try {
    const developerWorkspaceId = await resolveDeveloperWorkspaceIdForSupabase();
    if (!developerWorkspaceId) {
      return { ok: false, tablesAvailable: false, error: null };
    }
    const productResult = await saveClientProductStatusToSupabase(
      normalizedWorkspace.clientId,
      normalizedWorkspace.productCode,
      normalizedWorkspace.status,
      normalizedWorkspace.packageId,
      normalizedWorkspace
    );
    if (!productResult.ok && productResult.tablesAvailable) {
      return productResult;
    }

    const { error } = await supabase
      .from("vyron_product_workspaces")
      .upsert(workspaceToWorkspaceRow(normalizedWorkspace, developerWorkspaceId), {
        onConflict: "client_id,product_code",
      });
    if (error) {
      if (isVyronDevMissingTableError(error)) {
        return { ok: false, tablesAvailable: false, error: null };
      }
      return { ok: false, tablesAvailable: true, error: error.message };
    }
    return { ok: true, tablesAvailable: true, error: null };
  } catch (err) {
    return {
      ok: false,
      tablesAvailable: false,
      error: err instanceof Error ? err.message : "Save workspace failed",
    };
  }
}

export async function saveSupportSessionToSupabase(
  session: VyronSupportSession
): Promise<VyronDevSupabaseSaveResult> {
  const supabase = getVyronDevSupabaseClient();
  if (!supabase) return { ok: false, tablesAvailable: false, error: null };

  try {
    const developerWorkspaceId = await resolveDeveloperWorkspaceIdForSupabase();
    if (!developerWorkspaceId) {
      return { ok: false, tablesAvailable: false, error: null };
    }

    const { error } = await supabase.from("vyron_support_sessions").upsert(
      {
        developer_workspace_id: developerWorkspaceId,
        session_id: session.sessionId,
        operator_email: session.operator,
        client_id: isVyronDevUuid(session.clientId) ? session.clientId : null,
        client_name: session.clientName,
        product_code: session.productCode,
        status: session.status,
        started_at: session.startedAt,
        ended_at: session.endedAt,
      },
      { onConflict: "session_id" }
    );
    if (error) {
      if (isVyronDevMissingTableError(error)) {
        return { ok: false, tablesAvailable: false, error: null };
      }
      return { ok: false, tablesAvailable: true, error: error.message };
    }
    return { ok: true, tablesAvailable: true, error: null };
  } catch (err) {
    return {
      ok: false,
      tablesAvailable: false,
      error: err instanceof Error ? err.message : "Save support session failed",
    };
  }
}

export async function saveClientIntegrationToSupabase(
  integration: VyronClientProductIntegration
): Promise<VyronDevSupabaseSaveResult> {
  const supabase = getVyronDevSupabaseClient();
  if (!supabase) return { ok: false, tablesAvailable: false, error: null };
  if (!isVyronDevUuid(integration.clientId)) {
    return { ok: false, tablesAvailable: true, error: null };
  }

  try {
    const developerWorkspaceId = await resolveDeveloperWorkspaceIdForSupabase();
    if (!developerWorkspaceId) {
      return { ok: false, tablesAvailable: false, error: null };
    }

    const row: Record<string, unknown> = {
      developer_workspace_id: developerWorkspaceId,
      client_id: integration.clientId,
      product_code: integration.productCode,
      xero_readiness: integration.xeroReadiness,
      accounting_readiness: integration.accountingReadiness,
      payroll_readiness: integration.payrollReadiness,
      property_readiness: integration.propertyReadiness,
      last_sync_at: integration.lastSyncAt,
      notes: integration.notes,
      updated_at: new Date().toISOString(),
    };
    if (isVyronDevUuid(integration.id)) {
      row.id = integration.id;
    }

    const { error } = await supabase.from("vyron_client_integrations").upsert(row, {
      onConflict: "client_id,product_code",
    });
    if (error) {
      if (isVyronDevMissingTableError(error)) {
        return { ok: false, tablesAvailable: false, error: null };
      }
      return { ok: false, tablesAvailable: true, error: error.message };
    }
    return { ok: true, tablesAvailable: true, error: null };
  } catch (err) {
    return {
      ok: false,
      tablesAvailable: false,
      error: err instanceof Error ? err.message : "Save integration failed",
    };
  }
}

export async function fetchVyronProductDeploymentsFromSupabase(): Promise<{
  deployments: VyronProductDeployment[] | null;
  tablesAvailable: boolean;
  error: string | null;
}> {
  const supabase = getVyronDevSupabaseClient();
  if (!supabase) {
    return { deployments: null, tablesAvailable: false, error: null };
  }

  try {
    const { data, error } = await supabase.from("vyron_product_deployments").select("*");
    if (error) {
      if (isVyronDevMissingTableError(error)) {
        return { deployments: null, tablesAvailable: false, error: null };
      }
      return { deployments: null, tablesAvailable: true, error: error.message };
    }
    if (!data?.length) {
      return { deployments: null, tablesAvailable: true, error: null };
    }
    const deployments = data.map((row) => ({
      productCode: row.product_code as VyronProductCode,
      version: String(row.version),
      deploymentStatus: row.deployment_status as VyronDeploymentStatus,
      dbStatus: String(row.db_status),
      lastDeployment: row.last_deployment ? String(row.last_deployment) : null,
      environment: String(row.environment),
      url: String(row.url),
    }));
    return { deployments, tablesAvailable: true, error: null };
  } catch (err) {
    return {
      deployments: null,
      tablesAvailable: false,
      error: err instanceof Error ? err.message : "Fetch deployments failed",
    };
  }
}

export async function syncDefaultPackagesToSupabase(): Promise<VyronDevSupabaseSaveResult> {
  const supabase = getVyronDevSupabaseClient();
  if (!supabase) return { ok: false, tablesAvailable: false, error: null };

  try {
    const rows = VYRON_DEV_DEFAULT_PACKAGES.map((pkg) => ({
      id: pkg.id,
      product_code: pkg.productCode,
      package_name: pkg.packageName,
      user_limit: pkg.userLimit,
      company_limit: pkg.companyLimit,
      storage_limit_gb: pkg.storageLimitGb,
      monthly_value: pkg.monthlyValue,
      status: pkg.status,
      updated_at: new Date().toISOString(),
    }));

    const { error } = await supabase
      .from("vyron_product_packages")
      .upsert(rows, { onConflict: "id" });
    if (error) {
      if (isVyronDevMissingTableError(error) || shouldSuppressWorkspaceLoadError(error)) {
        return { ok: false, tablesAvailable: false, error: null };
      }
      return { ok: false, tablesAvailable: true, error: error.message };
    }
    return { ok: true, tablesAvailable: true, error: null };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Sync packages failed";
    if (shouldSuppressWorkspaceLoadMessage(message)) {
      return { ok: false, tablesAvailable: false, error: null };
    }
    return {
      ok: false,
      tablesAvailable: false,
      error: message,
    };
  }
}

export async function syncProvisionedClientToSupabase(
  state: VyronDevPlatformState,
  clientId: string
): Promise<"local" | "supabase"> {
  if (!isVyronDevUuid(clientId)) return "local";
  const profile = state.clientProfiles[clientId];
  if (!profile) return "local";

  const clientResult = await saveVyronClientToSupabase(profile);
  if (!clientResult.tablesAvailable) return "local";
  if (!clientResult.ok) return "local";

  const workspaces = state.productWorkspaces.filter((ws) => ws.clientId === clientId);
  for (const ws of workspaces) {
    const wsResult = await saveProductWorkspaceToSupabase(ws);
    if (!wsResult.ok) return "local";
  }

  return "supabase";
}

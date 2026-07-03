/**
 * VYRON CORE tenant RBAC — production role matrix (Batch 11).
 * Client-side nav enforcement; pair with sql/030 RLS for database isolation.
 */

import { isVyronMasterOperator, VYRON_MASTER_OPERATOR_EMAIL } from "@/lib/company-access";

export const VYRON_TENANT_ROLES = [
  "super_admin",
  "owner",
  "admin",
  "manager",
  "supervisor",
  "employee",
] as const;

export type VyronTenantRole = (typeof VYRON_TENANT_ROLES)[number];

/** Resolved permission layer used for nav + UI gates. */
export type TenantPermissionLayer =
  | "platform"
  | "owner"
  | "admin"
  | "manager"
  | "supervisor"
  | "employee";

export const TENANT_RBAC_ROLE_OPTIONS = [
  { value: "owner", label: "Owner" },
  { value: "admin", label: "Admin" },
  { value: "manager", label: "Manager" },
  { value: "supervisor", label: "Supervisor" },
  { value: "employee", label: "Employee" },
] as const;

const ROLE_ALIASES: Record<string, VyronTenantRole> = {
  super_admin: "super_admin",
  superadmin: "super_admin",
  platform_admin: "super_admin",
  owner: "owner",
  super_user: "owner",
  superuser: "owner",
  admin: "admin",
  manager: "manager",
  supervisor: "supervisor",
  employee: "employee",
  user: "employee",
  limited_user: "employee",
  limited: "employee",
  staff: "employee",
};

/** Routes reserved for company owners (billing, workspace governance). */
export const TENANT_OWNER_ONLY_NAV = new Set([
  "Company Setup",
  "Team Access Control",
  "Billing",
]);

/** Schedule + self-service routes for frontline employees. */
export const TENANT_EMPLOYEE_NAV = new Set([
  "Command Centre",
  "Clocking",
  "Stores & Rosters",
  "Rosters",
  "Leave Management",
  "Employees",
  "Staff",
  "Field Mobile",
  "Mobile Workforce Hub",
  "Training Centre",
]);

/** Blocked for supervisors (managers regain Reports). */
export const TENANT_SUPERVISOR_BLOCKED_NAV = new Set([
  "Reports Centre",
  "Smart Detection",
  "Automation Centre",
  "Integrations",
  "AI Intelligence Layer",
  "History Reports",
  "Risk & Compliance Centre",
  "Compliance",
  "Company Setup",
  "Team Access Control",
  "Billing",
]);

/** Blocked for employees and limited operators. */
export const TENANT_EMPLOYEE_BLOCKED_NAV = new Set([
  ...TENANT_SUPERVISOR_BLOCKED_NAV,
  "Import Staff",
  "Payroll Prep",
  "HR Cases",
  "Warnings",
  "HR Documents",
  "Stores",
  "Manager Action Centre",
  "Employee Notifications",
  "WhatsApp Action Centre",
  "Document Hub",
  "Final V1 Control",
  "Executive Reports",
  "Payroll Export Centre",
  "Reports Intelligence",
  "Notification Escalation",
  "Mobile Workforce",
  "System Health",
  "Field Operations",
  "Job Visits",
  "Job Timeline",
  "Workforce Journey",
  "Travel Intelligence",
  "Route History",
  "Vehicle Intelligence",
  "Workforce Cost Intelligence",
  "Profitability Intelligence",
  "Client Portal",
  "Workforce Risk Intelligence",
  "AI Command Centre",
  "WhatsApp Command Centre",
  "Workforce Digital Twin",
  "Payroll Intelligence Dashboard",
  "Payroll Readiness",
  "Payroll Leakage",
  "Payroll Forecast",
  "Payroll Exceptions",
  "Workforce Lifecycle",
  "Recruitment Intelligence",
  "Vacancies",
  "Applicants",
  "Interviews",
  "Skills Intelligence",
  "Succession Planning",
  "Executive Command Centre",
  "Operational Command Centre",
  "Workforce Operating Dashboard",
  "Automation Library",
  "Workforce Health Score",
  "Pilot Readiness",
]);

/** VYRON DEV routes allowed while Login As Client / support session is active. */
export const VYRON_DEV_SUPPORT_ALLOWED_ROUTES = new Set([
  "Command Centre",
  "Client Directory",
  "Client Setup",
  "Login As Client",
  "Client Provisioning",
  "Workspace Provisioning",
  "Package Engine",
  "Billing",
  "Deployment Centre",
  "Integrations Status",
  "Product Workspace",
  "Demo Requests",
  "Client Recommendations",
]);

export function normalizeTenantRole(
  role: string | null | undefined,
  userEmail?: string | null
): VyronTenantRole {
  if (isVyronMasterOperator(role || "", userEmail)) return "super_admin";
  const normalized = (role || "employee").toLowerCase().trim().replace(/\s+/g, "_");
  return ROLE_ALIASES[normalized] || "employee";
}

export function resolveTenantPermissionLayer(
  userRole: string,
  userEmail?: string | null
): TenantPermissionLayer {
  const role = normalizeTenantRole(userRole, userEmail);
  if (role === "super_admin") return "platform";
  if (role === "owner") return "owner";
  if (role === "admin") return "admin";
  if (role === "manager") return "manager";
  if (role === "supervisor") return "supervisor";
  return "employee";
}

export function formatTenantRbacRoleLabel(role: string): string {
  const normalized = normalizeTenantRole(role);
  const hit = TENANT_RBAC_ROLE_OPTIONS.find((opt) => opt.value === normalized);
  if (hit) return hit.label;
  if (normalized === "super_admin") return "Super Admin";
  return formatRoleText(role || "employee");
}

function formatRoleText(value: string): string {
  return value
    .replaceAll("_", " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

export function canTenantInviteUsers(layer: TenantPermissionLayer): boolean {
  return layer === "owner";
}

export function canTenantSubmitFeedback(layer: TenantPermissionLayer): boolean {
  return layer !== "platform";
}

export function isRouteAllowedDuringSupportSession(
  active: string,
  supportModeActive = false
): boolean {
  if (supportModeActive) return true;
  return VYRON_DEV_SUPPORT_ALLOWED_ROUTES.has(active);
}

export function isTenantNavRouteAllowed(active: string, layer: TenantPermissionLayer): boolean {
  if (active === "Send Feedback") return canTenantSubmitFeedback(layer);
  if (layer === "platform") return true;
  if (layer === "owner") return true;
  if (TENANT_OWNER_ONLY_NAV.has(active)) return false;
  if (layer === "admin") return true;
  if (layer === "manager") {
    return !TENANT_SUPERVISOR_BLOCKED_NAV.has(active) || active === "Reports Centre";
  }
  if (layer === "supervisor") {
    return !TENANT_SUPERVISOR_BLOCKED_NAV.has(active);
  }
  return TENANT_EMPLOYEE_NAV.has(active);
}

export function filterSidebarNavGroupsByRbac(
  groups: { label: string; items: string[] }[],
  userRole: string,
  userEmail?: string | null,
  resolveTarget: (item: string) => string = (item) => item
) {
  const layer = resolveTenantPermissionLayer(userRole, userEmail);
  if (layer === "platform" || layer === "owner") return groups;

  return groups
    .map((group) => ({
      ...group,
      items: group.items.filter((item) => {
        const target = resolveTarget(item);
        return isTenantNavRouteAllowed(target, layer);
      }),
    }))
    .filter((group) => group.items.length > 0);
}

/** Permission matrix summary for UI / audit documentation. */
export const VYRON_PERMISSION_MATRIX: Record<
  VyronTenantRole,
  { label: string; capabilities: string[] }
> = {
  super_admin: {
    label: "Super Admin",
    capabilities: [
      "Access VYRON DEV",
      "Create clients",
      "Delete clients",
      "Login as client",
      "Access all companies",
    ],
  },
  owner: {
    label: "Owner",
    capabilities: [
      "Manage own company",
      "Billing",
      "Users",
      "Sites",
      "Employees",
      "Full workspace navigation",
    ],
  },
  admin: {
    label: "Admin",
    capabilities: [
      "Manage employees",
      "Rosters",
      "Leave",
      "HR",
      "Field Operations",
    ],
  },
  manager: {
    label: "Manager",
    capabilities: [
      "Manage own teams",
      "Approve leave",
      "View reports",
      "Field Operations",
    ],
  },
  supervisor: {
    label: "Supervisor",
    capabilities: ["View team", "Create jobs", "Update jobs", "Field Operations"],
  },
  employee: {
    label: "Employee",
    capabilities: ["Clocking", "Leave requests", "Field Mobile", "Own profile"],
  },
};

export function isVyronPlatformOperatorEmail(email: string | null | undefined): boolean {
  return (email || "").trim().toLowerCase() === VYRON_MASTER_OPERATOR_EMAIL;
}

export function buildTenantWorkspaceNavGroup(
  layer: TenantPermissionLayer,
  feedbackRoute: string
): { label: string; items: string[] } | null {
  const items: string[] = [];
  if (layer === "owner") {
    items.push("Company Setup", "Document Hub", "Team Access Control");
  } else if (layer === "admin" || layer === "manager") {
    items.push("Document Hub");
  } else if (layer === "supervisor") {
    items.push("Document Hub");
  }
  if (canTenantSubmitFeedback(layer)) {
    items.push(feedbackRoute);
  }
  if (!items.length) return null;
  return { label: "Workspace", items };
}

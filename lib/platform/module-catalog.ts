/** Canonical module codes + display labels — must match subscription_plans/solution_templates
 * seed data in sql/062-platform-console-foundation.sql. */
export const MODULE_CATALOG: { code: string; label: string }[] = [
  { code: "dashboard", label: "Dashboard" },
  { code: "employees", label: "Employees" },
  { code: "leave", label: "Leave" },
  { code: "clocking", label: "Clocking" },
  { code: "discipline", label: "Discipline" },
  { code: "hearings", label: "Hearings" },
  { code: "contracts", label: "Contracts" },
  { code: "recruitment", label: "Recruitment" },
  { code: "performance", label: "Performance" },
  { code: "documents", label: "Documents" },
  { code: "reports", label: "Reports" },
  { code: "ai_copilot", label: "AI Copilot" },
  { code: "ai_intelligence", label: "AI Intelligence" },
  { code: "payroll_intelligence", label: "Payroll Intelligence" },
  { code: "workforce_intelligence", label: "Workforce Intelligence" },
  { code: "profitability_intelligence", label: "Profitability Intelligence" },
  { code: "digital_twin", label: "Digital Twin" },
  { code: "route_intelligence", label: "Route Intelligence" },
  { code: "route_history", label: "Route History" },
  { code: "vehicle_intelligence", label: "Vehicle Intelligence" },
  { code: "mobile_workforce", label: "Mobile Workforce" },
  { code: "client_portal", label: "Client Portal" },
  { code: "whatsapp", label: "WhatsApp" },
  { code: "api_access", label: "API Access" },
];

export function moduleLabel(code: string): string {
  return MODULE_CATALOG.find((entry) => entry.code === code)?.label || code;
}

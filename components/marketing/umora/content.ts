// Shared UMORA marketing content used by more than one public page. Product
// capability copy here must describe what the platform actually does today.

import {
  BarChart3,
  Briefcase,
  CalendarDays,
  CalendarRange,
  ClipboardCheck,
  Clock,
  FileText,
  LayoutDashboard,
  ListChecks,
  Route,
  ShieldCheck,
  Smartphone,
  Sparkles,
  Users,
  Wallet,
  Workflow,
  type LucideIcon,
} from "lucide-react";

export type Module = { icon: LucideIcon; name: string; text: string };

export const platformModules: Module[] = [
  { icon: Users, name: "People", text: "Employee records, roles, branches and workforce profiles." },
  { icon: Clock, name: "Clocking", text: "GPS and photo-verified attendance." },
  { icon: CalendarDays, name: "Rostering", text: "Plan shifts and align people with operational demand." },
  { icon: CalendarRange, name: "Leave", text: "Digital requests, approvals and policy-aware visibility." },
  { icon: Route, name: "Manager Actions", text: "One place to resolve workforce exceptions." },
  { icon: Briefcase, name: "HR Operations", text: "Cases, warnings and employee workflows." },
  { icon: FileText, name: "Documents", text: "Centralised employee and compliance documents." },
  { icon: ShieldCheck, name: "Compliance", text: "Track policies, exceptions and historical records." },
  { icon: Wallet, name: "Payroll Readiness", text: "Identify attendance, overtime and payroll risk before close." },
  { icon: Sparkles, name: "Intelligence", text: "Surface workforce patterns, risks and operational insights." },
];

/** Icons for the feature-matrix groups in lib/marketing/site.ts, by group name. */
export const groupIcons: Record<string, LucideIcon> = {
  "Employee Management": Users,
  Clocking: Clock,
  Leave: CalendarRange,
  HR: Briefcase,
  Compliance: ShieldCheck,
  "Payroll Readiness": Wallet,
  Analytics: BarChart3,
  "AI Intelligence": Sparkles,
  Operations: ListChecks,
  Mobile: Smartphone,
  Reports: FileText,
};

export const solutionIcons: Record<string, LucideIcon> = {
  "Payroll Leakage Prevention": Wallet,
  "Manager Action Centre": ListChecks,
  "Compliance Command": ClipboardCheck,
  "Mobile Workforce Execution": Smartphone,
  "Operational Intelligence": Sparkles,
  "Enterprise Rollout": Workflow,
};

export const fallbackIcon = LayoutDashboard;

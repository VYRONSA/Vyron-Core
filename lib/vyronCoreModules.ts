import type { VyronCoreModule } from "@/types/vyron-core";

export const vyronCoreModules: VyronCoreModule[] = [
  {
    name: "Clocking",
    status: "live",
    owner: "client",
    description: "Photo, GPS and shift-aware employee clocking.",
  },
  {
    name: "Payroll Prep",
    status: "live",
    owner: "client",
    description: "Payroll blocker and export readiness workflow.",
  },
  {
    name: "Automation Centre",
    status: "build",
    owner: "client",
    description: "AI-style policy, exception and manager action assistance.",
  },
  {
    name: "Owner HQ",
    status: "build",
    owner: "owner",
    description: "Private founder dashboard for internal SaaS operations.",
  },
];

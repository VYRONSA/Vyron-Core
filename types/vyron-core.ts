export type VyronModuleStatus = "live" | "build" | "planned" | "locked";

export type VyronCoreModule = {
  name: string;
  status: VyronModuleStatus;
  owner: "client" | "owner" | "system";
  description: string;
};

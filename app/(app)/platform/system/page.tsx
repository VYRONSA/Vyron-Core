"use client";

import SystemAdministrationPanel from "@/components/platform/SystemAdministrationPanel";
import PlatformSecurityPanel from "@/components/platform/PlatformSecurityPanel";

export default function PlatformSystemPage() {
  return (
    <>
      <PlatformSecurityPanel />
      <SystemAdministrationPanel />
    </>
  );
}

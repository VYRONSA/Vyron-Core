"use client";

import ComplianceWorkspace from "@/components/road-recovery/ComplianceWorkspace";
import RoadRecoveryShell from "@/components/road-recovery/RoadRecoveryShell";

export default function RoadRecoveryCompliancePage() {
  return (
    <RoadRecoveryShell active="compliance">
      {(companyId) => <ComplianceWorkspace companyId={companyId} />}
    </RoadRecoveryShell>
  );
}

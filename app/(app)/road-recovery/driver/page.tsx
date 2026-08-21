"use client";

import DriverJobWorkflow from "@/components/road-recovery/DriverJobWorkflow";
import RoadRecoveryShell from "@/components/road-recovery/RoadRecoveryShell";

export default function RoadRecoveryDriverPage() {
  return (
    <RoadRecoveryShell active="driver">
      {(companyId) => <DriverJobWorkflow companyId={companyId} />}
    </RoadRecoveryShell>
  );
}

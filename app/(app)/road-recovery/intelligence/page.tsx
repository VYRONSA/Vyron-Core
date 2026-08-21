"use client";

import OperationsIntelligence from "@/components/road-recovery/OperationsIntelligence";
import RoadRecoveryShell from "@/components/road-recovery/RoadRecoveryShell";

export default function RoadRecoveryIntelligencePage() {
  return (
    <RoadRecoveryShell active="intelligence">
      {(companyId) => <OperationsIntelligence companyId={companyId} />}
    </RoadRecoveryShell>
  );
}

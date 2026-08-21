"use client";

import RoadRecoveryShell from "@/components/road-recovery/RoadRecoveryShell";
import ThresholdEditor from "@/components/road-recovery/ThresholdEditor";

export default function RoadRecoveryTargetsPage() {
  return (
    <RoadRecoveryShell active="targets">
      {(companyId) => <ThresholdEditor companyId={companyId} />}
    </RoadRecoveryShell>
  );
}

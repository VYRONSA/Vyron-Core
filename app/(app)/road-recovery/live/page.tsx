"use client";

import LiveOperationsWall from "@/components/road-recovery/LiveOperationsWall";
import RoadRecoveryShell from "@/components/road-recovery/RoadRecoveryShell";

export default function RoadRecoveryLivePage() {
  return (
    <RoadRecoveryShell active="live">
      {(companyId) => <LiveOperationsWall companyId={companyId} />}
    </RoadRecoveryShell>
  );
}

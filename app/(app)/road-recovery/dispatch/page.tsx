"use client";

import DispatchBoard from "@/components/road-recovery/DispatchBoard";
import RoadRecoveryShell from "@/components/road-recovery/RoadRecoveryShell";

export default function RoadRecoveryDispatchPage() {
  return (
    <RoadRecoveryShell active="dispatch">
      {(companyId) => <DispatchBoard companyId={companyId} />}
    </RoadRecoveryShell>
  );
}

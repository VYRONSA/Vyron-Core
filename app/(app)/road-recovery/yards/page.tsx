"use client";

import RoadRecoveryShell from "@/components/road-recovery/RoadRecoveryShell";
import YardManager from "@/components/road-recovery/YardManager";

export default function RoadRecoveryYardsPage() {
  return (
    <RoadRecoveryShell active="yards">
      {(companyId) => <YardManager companyId={companyId} />}
    </RoadRecoveryShell>
  );
}

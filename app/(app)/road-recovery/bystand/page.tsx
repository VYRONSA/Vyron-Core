"use client";

import BystandBoard from "@/components/road-recovery/BystandBoard";
import RoadRecoveryShell from "@/components/road-recovery/RoadRecoveryShell";

export default function RoadRecoveryBystandPage() {
  return (
    <RoadRecoveryShell active="bystand">
      {(companyId) => <BystandBoard companyId={companyId} />}
    </RoadRecoveryShell>
  );
}

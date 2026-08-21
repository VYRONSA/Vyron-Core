"use client";

import ExceptionsBoard from "@/components/road-recovery/ExceptionsBoard";
import RoadRecoveryShell from "@/components/road-recovery/RoadRecoveryShell";

export default function RoadRecoveryExceptionsPage() {
  return (
    <RoadRecoveryShell active="exceptions">
      {(companyId) => <ExceptionsBoard companyId={companyId} />}
    </RoadRecoveryShell>
  );
}

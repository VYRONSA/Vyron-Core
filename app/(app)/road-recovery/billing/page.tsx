"use client";

import BillingIntelligence from "@/components/road-recovery/BillingIntelligence";
import RoadRecoveryShell from "@/components/road-recovery/RoadRecoveryShell";

export default function RoadRecoveryBillingPage() {
  return (
    <RoadRecoveryShell active="billing">
      {(companyId) => <BillingIntelligence companyId={companyId} />}
    </RoadRecoveryShell>
  );
}

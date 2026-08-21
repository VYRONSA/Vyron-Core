"use client";

import RequirementPolicyEditor from "@/components/road-recovery/RequirementPolicyEditor";
import RoadRecoveryShell from "@/components/road-recovery/RoadRecoveryShell";

export default function RoadRecoveryRequirementsPage() {
  return (
    <RoadRecoveryShell active="requirements">
      {(companyId) => <RequirementPolicyEditor companyId={companyId} />}
    </RoadRecoveryShell>
  );
}

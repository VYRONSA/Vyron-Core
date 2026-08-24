"use client";

import NotificationInbox from "@/components/road-recovery/NotificationInbox";
import RoadRecoveryShell from "@/components/road-recovery/RoadRecoveryShell";

export default function RoadRecoveryNotificationsPage() {
  return (
    <RoadRecoveryShell active="notifications">
      {(companyId) => <NotificationInbox companyId={companyId} />}
    </RoadRecoveryShell>
  );
}

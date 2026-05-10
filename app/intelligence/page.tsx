"use client";

import ExecutiveIntelligenceDashboard from "@/components/ExecutiveIntelligenceDashboard";
import LabourLeakageEngine from "@/components/LabourLeakageEngine";
import NotificationCommandCentre from "@/components/NotificationCommandCentre";

export default function IntelligencePage() {
  return (
    <div>
      <ExecutiveIntelligenceDashboard />
      <div className="bg-[#eef7ff] px-5 py-8 md:px-8">
        <div className="mx-auto max-w-[1800px] space-y-8">
          <LabourLeakageEngine />
          <NotificationCommandCentre />
        </div>
      </div>
    </div>
  );
}

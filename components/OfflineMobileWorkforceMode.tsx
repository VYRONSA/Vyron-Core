"use client";

import MobileOfflineSyncBar from "@/components/mobile-workforce/MobileOfflineSyncBar";

/** Legacy route module — delegates to Batch 12 offline sync bar. */
export default function OfflineMobileWorkforceMode() {
  return (
    <div className="space-y-4">
      <MobileOfflineSyncBar />
      <p className="text-sm text-slate-500">
        Offline queue stores clock, travel, job events, photos and incidents locally. Actions sync
        automatically when the device reconnects.
      </p>
    </div>
  );
}

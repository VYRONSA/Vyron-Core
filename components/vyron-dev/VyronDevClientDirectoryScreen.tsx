"use client";

import React from "react";
import {
  ensureClientProfile,
  type VyronDevDirectorySourceEntry,
  type VyronDevPlatformState,
  type VyronProductCode,
} from "@/lib/vyron-dev-platform";
import VyronDevExtendedClientDirectory from "./VyronDevExtendedClientDirectory";

type Props = {
  entries: VyronDevDirectorySourceEntry[];
  platformState: VyronDevPlatformState;
  onPlatformStateChange: (next: VyronDevPlatformState) => void;
  onCreateClient: () => void;
  onEditClient?: (entry: VyronDevDirectorySourceEntry) => void;
  onSuspendClient?: (entry: VyronDevDirectorySourceEntry) => void | Promise<void>;
  onDeleteClient?: (entry: VyronDevDirectorySourceEntry) => void | Promise<void>;
  onCloneDemoClient?: (entry: VyronDevDirectorySourceEntry) => void | Promise<void>;
  onOpenClientDetail?: (entry: VyronDevDirectorySourceEntry) => void;
  onOpenProduct: (clientId: string, productCode: VyronProductCode) => void;
};

export default function VyronDevClientDirectoryScreen(props: Props) {
  const syncedState = React.useMemo(() => {
    let next = props.platformState;
    for (const entry of props.entries) {
      next = ensureClientProfile(next, entry.id, {
        tradingName: entry.companyName,
        industry: "General",
      });
    }
    return next;
  }, [props.entries, props.platformState]);

  return (
    <div className="mt-2">
      <VyronDevExtendedClientDirectory {...props} platformState={syncedState} />
    </div>
  );
}

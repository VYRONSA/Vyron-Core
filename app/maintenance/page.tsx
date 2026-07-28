import { getMaintenanceMode } from "@/lib/platform/maintenance-mode";
import MaintenanceScreen from "@/components/platform/MaintenanceScreen";

export default async function MaintenancePage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; invalid?: string }>;
}) {
  const { next, invalid } = await searchParams;
  const status = await getMaintenanceMode();

  return (
    <MaintenanceScreen
      message={status.message}
      expectedReturnAt={status.expectedReturnAt}
      overrideInvalid={invalid === "1"}
      nextPath={next || "/dashboard"}
    />
  );
}

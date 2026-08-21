/**
 * VYRON CORE — Fleet and Driver intelligence (Phase 6).
 *
 * PURE. Facts in, deterministic result out.
 *
 * Fleet capacity and driver readiness are the two constraints that decide whether a job
 * can be dispatched at all, which is why they sit together: a truck out of service and a
 * driver whose certification lapsed produce the same operational symptom — nobody to send
 * — from completely different causes, and telling them apart is the whole point.
 */

/** A tow truck, from rr_tow_truck_profiles joined to field_vehicles. */
export type RrTowTruckFact = {
  id: string;
  fieldVehicleId: string;
  registration: string | null;
  towClass: string;
  availabilityStatus: string;
  operationalStatus: string;
  baseLabel: string | null;
  locationUpdatedAt: string | null;
};

/** A driver certification, from rr_driver_certifications. */
export type RrDriverCertificationFact = {
  id: string;
  employeeId: string;
  employeeName: string | null;
  certificationType: string;
  status: string;
  expiresAt: string | null;
  blocksDispatch: boolean;
};

const MS_PER_DAY = 86_400_000;

function parse(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const value = Date.parse(iso);
  return Number.isFinite(value) ? value : null;
}

export type RrFleetTotals = {
  trucks: number;
  operational: number;
  outOfService: number;
  available: number;
  onJob: number;
  /** null when the tenant has no trucks recorded. Never zero. */
  outOfServicePct: number | null;
  availableCapacityPct: number | null;
  /** Trucks that took at least one job in the window, as a share of operational trucks. */
  utilisationPct: number | null;
  utilisedTrucks: number;
  /** null when there are no operational trucks to divide by. */
  jobsPerTruck: number | null;
  /** Trucks that took no work at all in the window, worst case first. */
  idleTrucks: Array<{ fieldVehicleId: string; registration: string | null; towClass: string }>;
  byClass: Array<{ towClass: string; trucks: number; jobs: number }>;
  /** Trucks whose location has not been refreshed, which weakens dispatch scoring. */
  staleLocationCount: number;
};

export function fleetTotals(
  trucks: readonly RrTowTruckFact[],
  vehicleJobCounts: readonly { fieldVehicleId: string; jobs: number }[],
  input: { asOfIso: string; staleLocationHours: number; idleLimit: number }
): RrFleetTotals {
  const asOf = parse(input.asOfIso);
  const jobsByVehicle = new Map(vehicleJobCounts.map((entry) => [entry.fieldVehicleId, entry.jobs]));

  const operational = trucks.filter((truck) => truck.operationalStatus === "operational");
  const outOfService = trucks.filter((truck) => truck.operationalStatus !== "operational");
  const available = trucks.filter((truck) => truck.availabilityStatus === "available");
  const onJob = trucks.filter((truck) => truck.availabilityStatus === "on_job");

  const utilised = operational.filter((truck) => (jobsByVehicle.get(truck.fieldVehicleId) ?? 0) > 0);
  const totalJobs = operational.reduce(
    (sum, truck) => sum + (jobsByVehicle.get(truck.fieldVehicleId) ?? 0),
    0
  );

  const byClassMap = new Map<string, { trucks: number; jobs: number }>();
  for (const truck of trucks) {
    const entry = byClassMap.get(truck.towClass) ?? { trucks: 0, jobs: 0 };
    entry.trucks += 1;
    entry.jobs += jobsByVehicle.get(truck.fieldVehicleId) ?? 0;
    byClassMap.set(truck.towClass, entry);
  }

  const staleCutoff = asOf === null ? null : asOf - input.staleLocationHours * 3_600_000;
  const staleLocationCount =
    staleCutoff === null
      ? 0
      : trucks.filter((truck) => {
          const updated = parse(truck.locationUpdatedAt);
          return updated === null || updated < staleCutoff;
        }).length;

  const idle = operational
    .filter((truck) => (jobsByVehicle.get(truck.fieldVehicleId) ?? 0) === 0)
    .map((truck) => ({
      fieldVehicleId: truck.fieldVehicleId,
      registration: truck.registration,
      towClass: truck.towClass,
    }))
    .sort((a, b) => (a.fieldVehicleId < b.fieldVehicleId ? -1 : a.fieldVehicleId > b.fieldVehicleId ? 1 : 0));

  return {
    trucks: trucks.length,
    operational: operational.length,
    outOfService: outOfService.length,
    available: available.length,
    onJob: onJob.length,
    outOfServicePct: trucks.length === 0 ? null : (outOfService.length / trucks.length) * 100,
    availableCapacityPct: trucks.length === 0 ? null : (available.length / trucks.length) * 100,
    utilisationPct: operational.length === 0 ? null : (utilised.length / operational.length) * 100,
    utilisedTrucks: utilised.length,
    jobsPerTruck: operational.length === 0 ? null : totalJobs / operational.length,
    idleTrucks: idle.slice(0, Math.max(0, input.idleLimit)),
    byClass: [...byClassMap.entries()]
      .map(([towClass, entry]) => ({ towClass, trucks: entry.trucks, jobs: entry.jobs }))
      .sort((a, b) => (a.towClass < b.towClass ? -1 : a.towClass > b.towClass ? 1 : 0)),
    staleLocationCount,
  };
}

export type RrDriverReadinessEntry = {
  employeeId: string;
  employeeName: string | null;
  certificationType: string;
  status: string;
  expiresAt: string | null;
  daysUntilExpiry: number | null;
  blocksDispatch: boolean;
};

export type RrDriverTotals = {
  driversWithCertifications: number;
  certifications: number;
  /** Certifications that already prevent the driver being dispatched. */
  blockingCount: number;
  blockedDrivers: number;
  expiringWithin30Days: number;
  expiredCount: number;
  /** Worst first: already blocking, then soonest to expire. Bounded by the caller. */
  attention: RrDriverReadinessEntry[];
  /** null when no driver was ever offered work in the window. */
  averageAcceptanceRatePct: number | null;
  jobsPerDriver: number | null;
  driversOffered: number;
  /** Drivers who declined more than they accepted. Not an accusation; a question. */
  lowAcceptanceDrivers: Array<{ employeeId: string; acceptanceRatePct: number; offers: number; topDeclineReason: string | null }>;
};

/**
 * Driver readiness and responsiveness.
 *
 * A certification is treated as blocking when the record says it blocks dispatch AND it is
 * not currently valid. Both halves matter: an expired first-aid certificate that was never
 * marked as dispatch-blocking should not stop a truck, and a dispatch-blocking certificate
 * that is perfectly valid is not a problem.
 */
export function driverTotals(
  certifications: readonly RrDriverCertificationFact[],
  dispatchStats: readonly {
    employeeId: string;
    offers: number;
    acceptanceRatePct: number | null;
    topDeclineReason: string | null;
  }[],
  input: { asOfIso: string; attentionLimit: number; lowAcceptanceThresholdPct: number }
): RrDriverTotals {
  const asOf = parse(input.asOfIso);
  const drivers = new Set(certifications.map((entry) => entry.employeeId));

  const enriched: RrDriverReadinessEntry[] = certifications.map((entry) => {
    const expires = parse(entry.expiresAt);
    const daysUntilExpiry =
      expires === null || asOf === null ? null : (expires - asOf) / MS_PER_DAY;
    const expired = daysUntilExpiry !== null && daysUntilExpiry < 0;
    const invalid = entry.status !== "valid" || expired;
    return {
      employeeId: entry.employeeId,
      employeeName: entry.employeeName,
      certificationType: entry.certificationType,
      status: entry.status,
      expiresAt: entry.expiresAt,
      daysUntilExpiry: daysUntilExpiry === null ? null : Math.round(daysUntilExpiry * 10) / 10,
      blocksDispatch: entry.blocksDispatch && invalid,
    };
  });

  const blocking = enriched.filter((entry) => entry.blocksDispatch);
  const expired = enriched.filter(
    (entry) => entry.daysUntilExpiry !== null && entry.daysUntilExpiry < 0
  );
  const expiringSoon = enriched.filter(
    (entry) => entry.daysUntilExpiry !== null && entry.daysUntilExpiry >= 0 && entry.daysUntilExpiry <= 30
  );

  const attention = [...blocking, ...expiringSoon].sort((a, b) => {
    if (a.blocksDispatch !== b.blocksDispatch) return a.blocksDispatch ? -1 : 1;
    const left = a.daysUntilExpiry ?? Number.POSITIVE_INFINITY;
    const right = b.daysUntilExpiry ?? Number.POSITIVE_INFINITY;
    if (left !== right) return left - right;
    return a.employeeId < b.employeeId ? -1 : a.employeeId > b.employeeId ? 1 : 0;
  });

  const rated = dispatchStats.filter(
    (entry): entry is typeof entry & { acceptanceRatePct: number } => entry.acceptanceRatePct !== null
  );
  const totalOffers = dispatchStats.reduce((sum, entry) => sum + entry.offers, 0);

  return {
    driversWithCertifications: drivers.size,
    certifications: certifications.length,
    blockingCount: blocking.length,
    blockedDrivers: new Set(blocking.map((entry) => entry.employeeId)).size,
    expiringWithin30Days: expiringSoon.length,
    expiredCount: expired.length,
    attention: attention.slice(0, Math.max(0, input.attentionLimit)),
    averageAcceptanceRatePct:
      rated.length === 0
        ? null
        : rated.reduce((sum, entry) => sum + entry.acceptanceRatePct, 0) / rated.length,
    jobsPerDriver: dispatchStats.length === 0 ? null : totalOffers / dispatchStats.length,
    driversOffered: dispatchStats.length,
    lowAcceptanceDrivers: rated
      .filter((entry) => entry.acceptanceRatePct < input.lowAcceptanceThresholdPct && entry.offers >= 3)
      .map((entry) => ({
        employeeId: entry.employeeId,
        acceptanceRatePct: Math.round(entry.acceptanceRatePct * 100) / 100,
        offers: entry.offers,
        topDeclineReason: entry.topDeclineReason,
      }))
      .sort((a, b) => {
        if (a.acceptanceRatePct !== b.acceptanceRatePct) return a.acceptanceRatePct - b.acceptanceRatePct;
        return a.employeeId < b.employeeId ? -1 : a.employeeId > b.employeeId ? 1 : 0;
      }),
  };
}

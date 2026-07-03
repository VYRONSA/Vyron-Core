/**
 * VYRON CORE Batch 13 — Vehicle & Asset Intelligence.
 * Extends field_vehicles / field_assets / field_trailers from Field Operations.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { isSupabaseMissingTableError } from "@/lib/company-access";
import { DEFAULT_FIELD_COST_RATE } from "@/lib/field-cost-intelligence";
import {
  fetchFieldOperationsSnapshot,
  type FieldJob,
  type FieldJobEvent,
  type FieldOperationsSnapshot,
} from "@/lib/field-operations";
import { formatDuration, haversineKm } from "@/lib/field-travel-intelligence";

export const VEHICLE_REGISTER_STATUSES = [
  "active",
  "maintenance",
  "out_of_service",
  "sold",
] as const;

export type VehicleRegisterStatus = (typeof VEHICLE_REGISTER_STATUSES)[number];

export const VEHICLE_RISK_TYPES = [
  "excessive_distance",
  "idle_time",
  "vehicle_not_used",
  "maintenance_due",
  "unexpected_travel",
  "high_travel_cost",
  "low_utilisation",
] as const;

export type VehicleRiskType = (typeof VEHICLE_RISK_TYPES)[number];

export const VEHICLE_RISK_THRESHOLDS = {
  excessiveDistanceKm: 200,
  idleMinutes: 90,
  unusedDays: 7,
  highTravelCostZar: 650,
  lowUtilisationPct: 25,
} as const;

export type VehicleRegister = {
  id: string;
  companyId: string;
  registration: string;
  vehicleName: string;
  vehicleType: string;
  vin: string | null;
  make: string | null;
  model: string | null;
  year: number | null;
  fuelType: string;
  currentOdometer: number | null;
  assignedDriverId: string | null;
  status: VehicleRegisterStatus;
  lastServiceOdometer: number | null;
  serviceIntervalKm: number | null;
  notes: string | null;
};

export type TrailerRegister = {
  id: string;
  companyId: string;
  trailerNumber: string;
  registration: string | null;
  trailerType: string;
  assignedVehicleId: string | null;
  status: string;
  notes: string | null;
};

export type AssetRegister = {
  id: string;
  companyId: string;
  assetName: string;
  assetNumber: string;
  assetType: string;
  serialNumber: string | null;
  assignedEmployeeId: string | null;
  assignedVehicleId: string | null;
  currentSite: string | null;
  status: string;
  notes: string | null;
};

export type VehicleTimelineDay = {
  vehicleId: string;
  date: string;
  driverId: string | null;
  driverName: string | null;
  startDay: string | null;
  travelStart: string | null;
  arriveSite: string | null;
  leaveSite: string | null;
  endDay: string | null;
  distanceKm: number;
  travelSeconds: number;
  jobsCompleted: number;
  odometerStart: number | null;
  odometerEnd: number | null;
  distanceFromOdometer: number | null;
};

export type VehicleCostRow = {
  vehicleId: string;
  costDate: string;
  distanceKm: number;
  travelCost: number;
  jobCost: number;
  costPerKm: number;
  utilisationPct: number;
};

export type VehicleRiskEvent = {
  id: string;
  companyId: string;
  vehicleId: string | null;
  assetId: string | null;
  riskType: VehicleRiskType;
  severity: "info" | "warning" | "critical";
  message: string;
  detectedAt: string;
  resolvedAt: string | null;
};

export type AssetUtilisationRow = {
  assetId: string;
  utilDate: string;
  hoursUsed: number;
  jobsCount: number;
  idleDays: number;
  revenueZar: number;
  costZar: number;
};

export type VehicleIntelligenceDashboard = {
  activeVehicles: number;
  vehiclesInUse: number;
  assetsInUse: number;
  distanceTravelledKm: number;
  vehicleCostZar: number;
  utilisationPct: number;
  maintenanceDue: number;
  vehicles: VehicleRegister[];
  trailers: TrailerRegister[];
  assets: AssetRegister[];
  timelines: VehicleTimelineDay[];
  costs: VehicleCostRow[];
  assetUtilisation: AssetUtilisationRow[];
  risks: VehicleRiskEvent[];
  tablesAvailable: boolean;
  error: string | null;
};

const INTEL_TABLES = [
  "field_trailers",
  "field_vehicle_events",
  "field_vehicle_costs",
  "field_asset_utilisation",
  "field_vehicle_risk_events",
] as const;

function num(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function isIntelMissingTableError(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  return INTEL_TABLES.some((table) => isSupabaseMissingTableError(error, table));
}

function normalizeVehicleStatus(raw: string | null | undefined): VehicleRegisterStatus {
  const value = (raw || "active").toLowerCase();
  if (value === "maintenance") return "maintenance";
  if (value === "out_of_service" || value === "retired") return "out_of_service";
  if (value === "sold") return "sold";
  return "active";
}

function rowToVehicle(row: Record<string, unknown>): VehicleRegister {
  const make = row.make ? String(row.make) : null;
  const model = row.model ? String(row.model) : null;
  const legacyMakeModel = row.make_model ? String(row.make_model) : "";
  const vehicleName =
    (row.vehicle_name ? String(row.vehicle_name) : "") ||
    [make, model].filter(Boolean).join(" ") ||
    legacyMakeModel ||
    String(row.registration || "Vehicle");

  return {
    id: String(row.id),
    companyId: String(row.company_id),
    registration: String(row.registration),
    vehicleName,
    vehicleType: String(row.vehicle_type || "light_commercial"),
    vin: row.vin ? String(row.vin) : null,
    make,
    model,
    year: num(row.year),
    fuelType: String(row.fuel_type || "diesel"),
    currentOdometer: num(row.odometer_km),
    assignedDriverId: row.assigned_employee_id ? String(row.assigned_employee_id) : null,
    status: normalizeVehicleStatus(String(row.status || "active")),
    lastServiceOdometer: num(row.last_service_odometer),
    serviceIntervalKm: num(row.service_interval_km),
    notes: row.notes ? String(row.notes) : null,
  };
}

function rowToTrailer(row: Record<string, unknown>): TrailerRegister {
  return {
    id: String(row.id),
    companyId: String(row.company_id),
    trailerNumber: String(row.trailer_number),
    registration: row.registration ? String(row.registration) : null,
    trailerType: String(row.trailer_type || "flatbed"),
    assignedVehicleId: row.assigned_vehicle_id ? String(row.assigned_vehicle_id) : null,
    status: String(row.status || "active"),
    notes: row.notes ? String(row.notes) : null,
  };
}

function rowToAsset(row: Record<string, unknown>): AssetRegister {
  return {
    id: String(row.id),
    companyId: String(row.company_id),
    assetName: String(row.name),
    assetNumber: String(row.asset_number || row.asset_code || ""),
    assetType: String(row.asset_type || "equipment"),
    serialNumber: row.serial_number ? String(row.serial_number) : null,
    assignedEmployeeId: row.assigned_employee_id ? String(row.assigned_employee_id) : null,
    assignedVehicleId: row.assigned_vehicle_id ? String(row.assigned_vehicle_id) : null,
    currentSite: row.current_site ? String(row.current_site) : null,
    status: String(row.status || "available"),
    notes: row.notes ? String(row.notes) : null,
  };
}

function rowToVehicleEvent(row: Record<string, unknown>) {
  return {
    id: String(row.id),
    vehicleId: String(row.vehicle_id),
    employeeId: row.employee_id ? String(row.employee_id) : null,
    jobId: row.job_id ? String(row.job_id) : null,
    eventType: String(row.event_type),
    odometerStartKm: num(row.odometer_start_km),
    odometerEndKm: num(row.odometer_end_km),
    distanceKm: num(row.distance_km) ?? 0,
    travelSeconds: num(row.travel_seconds) ?? 0,
    recordedAt: String(row.recorded_at),
  };
}

function rowToRisk(row: Record<string, unknown>): VehicleRiskEvent {
  return {
    id: String(row.id),
    companyId: String(row.company_id),
    vehicleId: row.vehicle_id ? String(row.vehicle_id) : null,
    assetId: row.asset_id ? String(row.asset_id) : null,
    riskType: row.risk_type as VehicleRiskType,
    severity:
      row.severity === "critical" || row.severity === "info" ? row.severity : "warning",
    message: String(row.message),
    detectedAt: String(row.detected_at),
    resolvedAt: row.resolved_at ? String(row.resolved_at) : null,
  };
}

function eventDate(iso: string): string {
  return iso.slice(0, 10);
}

function distanceFromEvents(events: FieldJobEvent[]): number {
  let total = 0;
  for (let i = 1; i < events.length; i += 1) {
    const prev = events[i - 1];
    const curr = events[i];
    if (
      prev.latitude != null &&
      prev.longitude != null &&
      curr.latitude != null &&
      curr.longitude != null
    ) {
      total += haversineKm(prev.latitude, prev.longitude, curr.latitude, curr.longitude);
    }
  }
  return Math.round(total * 10) / 10;
}

function travelSecondsBetween(events: FieldJobEvent[], fromType: string, toType: string): number {
  const start = events.find((e) => e.eventType === fromType);
  const end = events.find((e) => e.eventType === toType);
  if (!start || !end) return 0;
  const delta = new Date(end.recordedAt).getTime() - new Date(start.recordedAt).getTime();
  return delta > 0 ? Math.round(delta / 1000) : 0;
}

export function buildVehicleTimelines(
  snapshot: FieldOperationsSnapshot,
  vehicles: VehicleRegister[],
  vehicleEvents: ReturnType<typeof rowToVehicleEvent>[],
  focusDate: string
): VehicleTimelineDay[] {
  const timelines: VehicleTimelineDay[] = [];

  for (const vehicle of vehicles) {
    const driverId = vehicle.assignedDriverId;
    const dayEvents = snapshot.events.filter(
      (e) =>
        eventDate(e.recordedAt) === focusDate &&
        (driverId ? e.employeeId === driverId : false)
    );

    const vehicleJobs = snapshot.jobs.filter(
      (job) =>
        job.vehicleId === vehicle.id &&
        (job.scheduledStart ? eventDate(job.scheduledStart) === focusDate : false)
    );

    const relatedEvents =
      vehicleJobs.length > 0
        ? snapshot.events.filter(
            (e) =>
              eventDate(e.recordedAt) === focusDate &&
              e.jobId &&
              vehicleJobs.some((j) => j.id === e.jobId)
          )
        : dayEvents;

    const sorted = [...relatedEvents].sort(
      (a, b) => new Date(a.recordedAt).getTime() - new Date(b.recordedAt).getTime()
    );

    const odometerEvents = vehicleEvents.filter(
      (e) => e.vehicleId === vehicle.id && eventDate(e.recordedAt) === focusDate
    );
    const odometerStart =
      odometerEvents.find((e) => e.eventType.includes("odometer_start") || e.eventType.includes("Start"))
        ?.odometerStartKm ??
      odometerEvents.find((e) => e.odometerStartKm != null)?.odometerStartKm ??
      null;
    const odometerEnd =
      odometerEvents.find((e) => e.eventType.includes("odometer_end") || e.eventType.includes("End"))
        ?.odometerEndKm ??
      odometerEvents.find((e) => e.odometerEndKm != null)?.odometerEndKm ??
      null;

    const distanceFromOdometer =
      odometerStart != null && odometerEnd != null && odometerEnd >= odometerStart
        ? Math.round((odometerEnd - odometerStart) * 10) / 10
        : null;

    const jobsCompleted = vehicleJobs.filter((j) => j.status === "Completed").length;

    timelines.push({
      vehicleId: vehicle.id,
      date: focusDate,
      driverId: driverId,
      driverName: null,
      startDay: sorted.find((e) => e.eventType === "Start Day")?.recordedAt ?? null,
      travelStart: sorted.find((e) => e.eventType === "Start Travel")?.recordedAt ?? null,
      arriveSite: sorted.find((e) => e.eventType === "Arrive Site")?.recordedAt ?? null,
      leaveSite: sorted.find((e) => e.eventType === "Leave Site")?.recordedAt ?? null,
      endDay: sorted.find((e) => e.eventType === "End Day")?.recordedAt ?? null,
      distanceKm: distanceFromOdometer ?? distanceFromEvents(sorted),
      travelSeconds: travelSecondsBetween(sorted, "Start Travel", "Arrive Site"),
      jobsCompleted,
      odometerStart,
      odometerEnd,
      distanceFromOdometer,
    });
  }

  return timelines;
}

export function computeVehicleCosts(
  timelines: VehicleTimelineDay[],
  travelRatePerKm = DEFAULT_FIELD_COST_RATE.travelRatePerKm,
  activeVehicleCount: number
): VehicleCostRow[] {
  const inUseCount = timelines.filter((t) => t.distanceKm > 0 || t.jobsCompleted > 0).length;
  const utilisationPct =
    activeVehicleCount > 0 ? Math.round((inUseCount / activeVehicleCount) * 1000) / 10 : 0;

  return timelines.map((timeline) => {
    const distanceKm = timeline.distanceFromOdometer ?? timeline.distanceKm;
    const travelCost = Math.round(distanceKm * travelRatePerKm * 100) / 100;
    const jobCost = timeline.jobsCompleted * 450;
    const costPerKm = distanceKm > 0 ? Math.round((travelCost / distanceKm) * 10000) / 10000 : 0;

    return {
      vehicleId: timeline.vehicleId,
      costDate: timeline.date,
      distanceKm,
      travelCost,
      jobCost,
      costPerKm,
      utilisationPct,
    };
  });
}

export function computeAssetUtilisation(
  snapshot: FieldOperationsSnapshot,
  assets: AssetRegister[],
  focusDate: string
): AssetUtilisationRow[] {
  return assets.map((asset) => {
    const jobs = snapshot.jobs.filter(
      (job) =>
        job.assetId === asset.id &&
        (job.scheduledStart ? eventDate(job.scheduledStart) === focusDate : true)
    );
    const completed = jobs.filter((j) => j.status === "Completed");
    const hoursUsed = completed.length * 4;
    const revenueZar = completed.length * 2800;
    const costZar = completed.length * 650;

    return {
      assetId: asset.id,
      utilDate: focusDate,
      hoursUsed,
      jobsCount: jobs.length,
      idleDays: jobs.length === 0 ? 1 : 0,
      revenueZar,
      costZar,
    };
  });
}

export function detectVehicleRisks(input: {
  vehicles: VehicleRegister[];
  timelines: VehicleTimelineDay[];
  costs: VehicleCostRow[];
  snapshot: FieldOperationsSnapshot;
  focusDate: string;
}): Omit<VehicleRiskEvent, "id" | "companyId" | "resolvedAt">[] {
  const risks: Omit<VehicleRiskEvent, "id" | "companyId" | "resolvedAt">[] = [];
  const now = new Date().toISOString();

  for (const vehicle of input.vehicles) {
    const timeline = input.timelines.find((t) => t.vehicleId === vehicle.id);
    const cost = input.costs.find((c) => c.vehicleId === vehicle.id);

    if (timeline && timeline.distanceKm > VEHICLE_RISK_THRESHOLDS.excessiveDistanceKm) {
      risks.push({
        vehicleId: vehicle.id,
        assetId: null,
        riskType: "excessive_distance",
        severity: "warning",
        message: `${vehicle.vehicleName} travelled ${timeline.distanceKm} km on ${input.focusDate} (threshold ${VEHICLE_RISK_THRESHOLDS.excessiveDistanceKm} km).`,
        detectedAt: now,
      });
    }

    if (timeline && timeline.travelSeconds > VEHICLE_RISK_THRESHOLDS.idleMinutes * 60) {
      risks.push({
        vehicleId: vehicle.id,
        assetId: null,
        riskType: "idle_time",
        severity: "info",
        message: `${vehicle.vehicleName} idle/travel time ${formatDuration(timeline.travelSeconds)} exceeds ${VEHICLE_RISK_THRESHOLDS.idleMinutes} min.`,
        detectedAt: now,
      });
    }

    const recentJob = input.snapshot.jobs.find(
      (j) =>
        j.vehicleId === vehicle.id &&
        j.scheduledStart &&
        new Date(j.scheduledStart).getTime() >
          Date.now() - VEHICLE_RISK_THRESHOLDS.unusedDays * 86400000
    );
    if (!recentJob && vehicle.status === "active") {
      risks.push({
        vehicleId: vehicle.id,
        assetId: null,
        riskType: "vehicle_not_used",
        severity: "warning",
        message: `${vehicle.vehicleName} has no linked jobs in the last ${VEHICLE_RISK_THRESHOLDS.unusedDays} days.`,
        detectedAt: now,
      });
    }

    if (
      vehicle.currentOdometer != null &&
      vehicle.lastServiceOdometer != null &&
      vehicle.serviceIntervalKm != null &&
      vehicle.currentOdometer - vehicle.lastServiceOdometer >= vehicle.serviceIntervalKm
    ) {
      risks.push({
        vehicleId: vehicle.id,
        assetId: null,
        riskType: "maintenance_due",
        severity: "critical",
        message: `${vehicle.vehicleName} service interval exceeded (${vehicle.serviceIntervalKm} km).`,
        detectedAt: now,
      });
    } else if (vehicle.status === "maintenance") {
      risks.push({
        vehicleId: vehicle.id,
        assetId: null,
        riskType: "maintenance_due",
        severity: "warning",
        message: `${vehicle.vehicleName} is flagged for maintenance.`,
        detectedAt: now,
      });
    }

    if (cost && cost.travelCost > VEHICLE_RISK_THRESHOLDS.highTravelCostZar) {
      risks.push({
        vehicleId: vehicle.id,
        assetId: null,
        riskType: "high_travel_cost",
        severity: "warning",
        message: `${vehicle.vehicleName} travel cost R${cost.travelCost.toFixed(2)} exceeds threshold.`,
        detectedAt: now,
      });
    }

  }

  const fleetUtil = input.costs[0]?.utilisationPct ?? 0;
  if (fleetUtil > 0 && fleetUtil < VEHICLE_RISK_THRESHOLDS.lowUtilisationPct) {
    risks.push({
      vehicleId: null,
      assetId: null,
      riskType: "low_utilisation",
      severity: "info",
      message: `Fleet utilisation ${fleetUtil}% is below ${VEHICLE_RISK_THRESHOLDS.lowUtilisationPct}%.`,
      detectedAt: now,
    });
  }

  return risks;
}

export async function fetchVehicleAssetSnapshot(
  supabase: SupabaseClient,
  companyId: string,
  focusDate = new Date().toISOString().slice(0, 10)
): Promise<VehicleIntelligenceDashboard> {
  const empty: VehicleIntelligenceDashboard = {
    activeVehicles: 0,
    vehiclesInUse: 0,
    assetsInUse: 0,
    distanceTravelledKm: 0,
    vehicleCostZar: 0,
    utilisationPct: 0,
    maintenanceDue: 0,
    vehicles: [],
    trailers: [],
    assets: [],
    timelines: [],
    costs: [],
    assetUtilisation: [],
    risks: [],
    tablesAvailable: false,
    error: null,
  };

  if (!companyId) return empty;

  const [fieldSnapshot, vehiclesRes, trailersRes, assetsRes, vehicleEventsRes, costsRes, utilRes, risksRes] =
    await Promise.all([
      fetchFieldOperationsSnapshot(supabase, companyId),
      supabase.from("field_vehicles").select("*").eq("company_id", companyId).order("registration"),
      supabase.from("field_trailers").select("*").eq("company_id", companyId).order("trailer_number"),
      supabase.from("field_assets").select("*").eq("company_id", companyId).order("name"),
      supabase
        .from("field_vehicle_events")
        .select("*")
        .eq("company_id", companyId)
        .gte("recorded_at", `${focusDate}T00:00:00`)
        .lte("recorded_at", `${focusDate}T23:59:59`)
        .order("recorded_at"),
      supabase
        .from("field_vehicle_costs")
        .select("*")
        .eq("company_id", companyId)
        .eq("cost_date", focusDate),
      supabase
        .from("field_asset_utilisation")
        .select("*")
        .eq("company_id", companyId)
        .eq("util_date", focusDate),
      supabase
        .from("field_vehicle_risk_events")
        .select("*")
        .eq("company_id", companyId)
        .is("resolved_at", null)
        .order("detected_at", { ascending: false })
        .limit(50),
    ]);

  const intelError =
    trailersRes.error || vehicleEventsRes.error || costsRes.error || utilRes.error || risksRes.error;

  if (intelError && isIntelMissingTableError(intelError)) {
    return { ...empty, tablesAvailable: false };
  }

  if (vehiclesRes.error && !isSupabaseMissingTableError(vehiclesRes.error, "field_vehicles")) {
    return { ...empty, error: vehiclesRes.error.message };
  }

  const vehicles = (vehiclesRes.data || []).map((r) => rowToVehicle(r as Record<string, unknown>));
  const trailers = (trailersRes.data || []).map((r) => rowToTrailer(r as Record<string, unknown>));
  const assets = (assetsRes.data || []).map((r) => rowToAsset(r as Record<string, unknown>));
  const vehicleEvents = (vehicleEventsRes.data || []).map((r) =>
    rowToVehicleEvent(r as Record<string, unknown>)
  );

  const timelines = buildVehicleTimelines(fieldSnapshot, vehicles, vehicleEvents, focusDate);
  const activeVehicles = vehicles.filter((v) => v.status === "active").length;
  const computedCosts = computeVehicleCosts(timelines, DEFAULT_FIELD_COST_RATE.travelRatePerKm, activeVehicles);
  const assetUtilisation = computeAssetUtilisation(fieldSnapshot, assets, focusDate);
  const detectedRisks = detectVehicleRisks({
    vehicles,
    timelines,
    costs: computedCosts,
    snapshot: fieldSnapshot,
    focusDate,
  });

  const storedCosts: VehicleCostRow[] = (costsRes.data || []).map((row) => ({
    vehicleId: String((row as Record<string, unknown>).vehicle_id),
    costDate: String((row as Record<string, unknown>).cost_date).slice(0, 10),
    distanceKm: num((row as Record<string, unknown>).distance_km) ?? 0,
    travelCost: num((row as Record<string, unknown>).travel_cost) ?? 0,
    jobCost: num((row as Record<string, unknown>).job_cost) ?? 0,
    costPerKm: num((row as Record<string, unknown>).cost_per_km) ?? 0,
    utilisationPct: num((row as Record<string, unknown>).utilisation_pct) ?? 0,
  }));

  const costs = storedCosts.length > 0 ? storedCosts : computedCosts;

  const storedRisks = (risksRes.data || []).map((r) => rowToRisk(r as Record<string, unknown>));
  const risks: VehicleRiskEvent[] =
    storedRisks.length > 0
      ? storedRisks
      : detectedRisks.map((r, index) => ({
          ...r,
          id: `detected-${index}`,
          companyId,
          resolvedAt: null,
        }));

  const vehiclesInUse = fieldSnapshot.jobs.filter(
    (j) =>
      j.vehicleId &&
      j.scheduledStart &&
      eventDate(j.scheduledStart) === focusDate &&
      j.status !== "Cancelled"
  ).length;

  const assetsInUse = fieldSnapshot.jobs.filter(
    (j) =>
      j.assetId &&
      j.scheduledStart &&
      eventDate(j.scheduledStart) === focusDate &&
      j.status !== "Cancelled"
  ).length;

  const distanceTravelledKm = costs.reduce((sum, c) => sum + c.distanceKm, 0);
  const vehicleCostZar = costs.reduce((sum, c) => sum + c.travelCost + c.jobCost, 0);
  const utilisationPct =
    costs.length > 0
      ? Math.round(costs.reduce((sum, c) => sum + c.utilisationPct, 0) / costs.length)
      : activeVehicles > 0
        ? Math.round((vehiclesInUse / activeVehicles) * 1000) / 10
        : 0;

  const maintenanceDue = vehicles.filter(
    (v) =>
      v.status === "maintenance" ||
      (v.currentOdometer != null &&
        v.lastServiceOdometer != null &&
        v.serviceIntervalKm != null &&
        v.currentOdometer - v.lastServiceOdometer >= v.serviceIntervalKm)
  ).length;

  return {
    activeVehicles,
    vehiclesInUse,
    assetsInUse,
    distanceTravelledKm: Math.round(distanceTravelledKm * 10) / 10,
    vehicleCostZar: Math.round(vehicleCostZar * 100) / 100,
    utilisationPct,
    maintenanceDue,
    vehicles,
    trailers,
    assets,
    timelines,
    costs,
    assetUtilisation:
      (utilRes.data || []).length > 0
        ? (utilRes.data || []).map((row) => ({
            assetId: String((row as Record<string, unknown>).asset_id),
            utilDate: String((row as Record<string, unknown>).util_date).slice(0, 10),
            hoursUsed: num((row as Record<string, unknown>).hours_used) ?? 0,
            jobsCount: Number((row as Record<string, unknown>).jobs_count || 0),
            idleDays: Number((row as Record<string, unknown>).idle_days || 0),
            revenueZar: num((row as Record<string, unknown>).revenue_zar) ?? 0,
            costZar: num((row as Record<string, unknown>).cost_zar) ?? 0,
          }))
        : assetUtilisation,
    risks,
    tablesAvailable: true,
    error: fieldSnapshot.error,
  };
}

export type CreateVehicleInput = {
  companyId: string;
  registration: string;
  vehicleName: string;
  vehicleType?: string;
  vin?: string | null;
  make?: string | null;
  model?: string | null;
  year?: number | null;
  fuelType?: string;
  currentOdometer?: number | null;
  assignedDriverId?: string | null;
  status?: VehicleRegisterStatus;
};

export async function createVehicleRegister(
  supabase: SupabaseClient,
  input: CreateVehicleInput
): Promise<{ vehicle: VehicleRegister | null; error: string | null }> {
  const makeModel =
    [input.make, input.model].filter(Boolean).join(" ") || input.vehicleName.trim();

  const { data, error } = await supabase
    .from("field_vehicles")
    .insert({
      company_id: input.companyId,
      registration: input.registration.trim().toUpperCase(),
      make_model: makeModel,
      vehicle_name: input.vehicleName.trim(),
      vehicle_type: input.vehicleType || "light_commercial",
      vin: input.vin || null,
      make: input.make || null,
      model: input.model || null,
      year: input.year ?? null,
      fuel_type: input.fuelType || "diesel",
      odometer_km: input.currentOdometer ?? null,
      assigned_employee_id: input.assignedDriverId || null,
      status: input.status || "active",
      updated_at: new Date().toISOString(),
    })
    .select("*")
    .single();

  if (error || !data) return { vehicle: null, error: error?.message || "Failed to create vehicle." };
  return { vehicle: rowToVehicle(data as Record<string, unknown>), error: null };
}

export type CreateTrailerInput = {
  companyId: string;
  trailerNumber: string;
  registration?: string | null;
  trailerType?: string;
  assignedVehicleId?: string | null;
  status?: string;
};

export async function createTrailerRegister(
  supabase: SupabaseClient,
  input: CreateTrailerInput
): Promise<{ trailer: TrailerRegister | null; error: string | null }> {
  const { data, error } = await supabase
    .from("field_trailers")
    .insert({
      company_id: input.companyId,
      trailer_number: input.trailerNumber.trim(),
      registration: input.registration?.trim() || null,
      trailer_type: input.trailerType || "flatbed",
      assigned_vehicle_id: input.assignedVehicleId || null,
      status: input.status || "active",
      updated_at: new Date().toISOString(),
    })
    .select("*")
    .single();

  if (error || !data) return { trailer: null, error: error?.message || "Failed to create trailer." };
  return { trailer: rowToTrailer(data as Record<string, unknown>), error: null };
}

export type CreateAssetRegisterInput = {
  companyId: string;
  assetName: string;
  assetNumber: string;
  assetType?: string;
  serialNumber?: string | null;
  assignedEmployeeId?: string | null;
  assignedVehicleId?: string | null;
  currentSite?: string | null;
  status?: string;
};

export async function createAssetRegister(
  supabase: SupabaseClient,
  input: CreateAssetRegisterInput
): Promise<{ asset: AssetRegister | null; error: string | null }> {
  const { data, error } = await supabase
    .from("field_assets")
    .insert({
      company_id: input.companyId,
      asset_code: input.assetNumber.trim(),
      asset_number: input.assetNumber.trim(),
      name: input.assetName.trim(),
      asset_type: input.assetType || "equipment",
      serial_number: input.serialNumber || null,
      assigned_employee_id: input.assignedEmployeeId || null,
      assigned_vehicle_id: input.assignedVehicleId || null,
      current_site: input.currentSite || null,
      status: input.status || "available",
      updated_at: new Date().toISOString(),
    })
    .select("*")
    .single();

  if (error || !data) return { asset: null, error: error?.message || "Failed to create asset." };
  return { asset: rowToAsset(data as Record<string, unknown>), error: null };
}

export async function recordVehicleOdometer(
  supabase: SupabaseClient,
  input: {
    companyId: string;
    vehicleId: string;
    employeeId?: string | null;
    jobId?: string | null;
    odometerStartKm?: number | null;
    odometerEndKm?: number | null;
    recordedAt?: string;
  }
): Promise<{ error: string | null }> {
  const recordedAt = input.recordedAt || new Date().toISOString();
  const distanceKm =
    input.odometerStartKm != null &&
    input.odometerEndKm != null &&
    input.odometerEndKm >= input.odometerStartKm
      ? input.odometerEndKm - input.odometerStartKm
      : null;

  const rows = [];
  if (input.odometerStartKm != null) {
    rows.push({
      company_id: input.companyId,
      vehicle_id: input.vehicleId,
      employee_id: input.employeeId || null,
      job_id: input.jobId || null,
      event_type: "odometer_start",
      odometer_start_km: input.odometerStartKm,
      recorded_at: recordedAt,
    });
  }
  if (input.odometerEndKm != null) {
    rows.push({
      company_id: input.companyId,
      vehicle_id: input.vehicleId,
      employee_id: input.employeeId || null,
      job_id: input.jobId || null,
      event_type: "odometer_end",
      odometer_end_km: input.odometerEndKm,
      distance_km: distanceKm,
      recorded_at: recordedAt,
    });
  }

  if (rows.length === 0) return { error: "Provide start or end odometer reading." };

  const { error } = await supabase.from("field_vehicle_events").insert(rows);
  if (error) return { error: error.message };

  if (input.odometerEndKm != null) {
    await supabase
      .from("field_vehicles")
      .update({ odometer_km: input.odometerEndKm, updated_at: new Date().toISOString() })
      .eq("id", input.vehicleId)
      .eq("company_id", input.companyId);
  }

  return { error: null };
}

export function formatVehicleStatus(status: VehicleRegisterStatus): string {
  if (status === "out_of_service") return "Out Of Service";
  return status.charAt(0).toUpperCase() + status.slice(1);
}

export function jobResourceSummary(
  job: FieldJob,
  vehicles: VehicleRegister[],
  trailers: TrailerRegister[],
  assets: AssetRegister[],
  employeeName: string | null
): string {
  const parts: string[] = [];
  if (employeeName) parts.push(employeeName);
  const vehicle = vehicles.find((v) => v.id === job.vehicleId);
  if (vehicle) parts.push(vehicle.vehicleName || vehicle.registration);
  const trailer = trailers.find((t) => t.id === job.trailerId);
  if (trailer) parts.push(`Trailer ${trailer.trailerNumber}`);
  const asset = assets.find((a) => a.id === job.assetId);
  if (asset) parts.push(asset.assetName);
  return parts.length > 0 ? parts.join(" · ") : "—";
}

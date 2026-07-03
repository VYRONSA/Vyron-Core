/**
 * GPS radius validation for mobile workforce clocking and field events.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { isSupabaseMissingTableError, shouldSuppressWorkspaceLoadError } from "@/lib/company-access";

export type GpsValidationResult = {
  insideRadius: boolean;
  distanceMeters: number | null;
  radiusMeters: number;
  exceptionCreated: boolean;
  validationId: string | null;
};

const EARTH_RADIUS_M = 6_371_000;

export function haversineDistanceMeters(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return EARTH_RADIUS_M * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export async function validateMobileGpsRadius(
  supabase: SupabaseClient,
  params: {
    companyId: string;
    employeeId: string;
    employeeLat: number;
    employeeLng: number;
    siteLat: number;
    siteLng: number;
    radiusMeters?: number;
    jobId?: string | null;
    storeId?: string | null;
    referenceType?: string;
    createException?: boolean;
  }
): Promise<GpsValidationResult> {
  const radiusMeters = params.radiusMeters ?? 150;
  const distanceMeters = haversineDistanceMeters(
    params.employeeLat,
    params.employeeLng,
    params.siteLat,
    params.siteLng
  );
  const insideRadius = distanceMeters <= radiusMeters;
  let exceptionCreated = false;
  let validationId: string | null = null;

  const { data: validationRow, error: validationError } = await supabase
    .from("mobile_gps_validations")
    .insert({
      company_id: params.companyId,
      employee_id: params.employeeId,
      job_id: params.jobId || null,
      store_id: params.storeId || null,
      reference_type: params.referenceType || "job",
      employee_latitude: params.employeeLat,
      employee_longitude: params.employeeLng,
      site_latitude: params.siteLat,
      site_longitude: params.siteLng,
      radius_meters: radiusMeters,
      distance_meters: Math.round(distanceMeters * 100) / 100,
      inside_radius: insideRadius,
      exception_created: false,
    })
    .select("id")
    .single();

  if (!validationError && validationRow?.id) {
    validationId = String(validationRow.id);
  }

  if (!insideRadius && params.createException !== false) {
    const { error: exceptionError } = await supabase.from("time_exceptions").insert({
      company_id: params.companyId,
      employee_id: params.employeeId,
      exception_type: "gps_outside_radius",
      severity: "medium",
      description: `Mobile GPS outside site radius (${Math.round(distanceMeters)}m / ${radiusMeters}m limit).`,
      status: "open",
      source: "mobile_workforce",
    });
    exceptionCreated = !exceptionError;

    if (validationId) {
      await supabase
        .from("mobile_gps_validations")
        .update({ exception_created: exceptionCreated })
        .eq("id", validationId);
    }
  }

  if (
    validationError &&
    (isSupabaseMissingTableError(validationError, "mobile_gps_validations") ||
      shouldSuppressWorkspaceLoadError(validationError))
  ) {
    return {
      insideRadius,
      distanceMeters: Math.round(distanceMeters * 100) / 100,
      radiusMeters,
      exceptionCreated: false,
      validationId: null,
    };
  }

  return {
    insideRadius,
    distanceMeters: Math.round(distanceMeters * 100) / 100,
    radiusMeters,
    exceptionCreated,
    validationId,
  };
}

export function gpsRadiusLabel(result: GpsValidationResult): string {
  if (result.distanceMeters == null) return "GPS unavailable";
  return result.insideRadius
    ? `Inside radius (${result.distanceMeters}m)`
    : `Outside radius (${result.distanceMeters}m / ${result.radiusMeters}m)`;
}

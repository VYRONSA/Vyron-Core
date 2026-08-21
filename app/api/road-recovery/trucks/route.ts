import { NextRequest, NextResponse } from "next/server";
import {
  asNumberOrNull,
  asText,
  errorResponse,
  parseError,
  readJson,
  requireApiContext,
} from "@/lib/road-recovery/api";

/** Tow truck capability profiles. Truck IDENTITY stays in public.field_vehicles. */
export async function GET(request: NextRequest) {
  try {
    const context = await requireApiContext(request, request.nextUrl.searchParams.get("companyId"));
    if (!context.ok) return errorResponse(context.message, context.status);

    const { data, error } = await context.ctx.auth.supabase
      .from("rr_tow_truck_profiles")
      .select("*")
      .eq("company_id", context.ctx.companyId)
      .order("tow_class");

    if (error) return errorResponse("Could not load tow truck profiles.", 500);
    return NextResponse.json({ ok: true, trucks: data || [] });
  } catch (error: unknown) {
    return errorResponse(parseError(error), 500);
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await readJson(request);
    const context = await requireApiContext(request, body.companyId);
    if (!context.ok) return errorResponse(context.message, context.status);

    const fieldVehicleId = asText(body.fieldVehicleId);
    const towClass = asText(body.towClass);
    if (!fieldVehicleId || !towClass) {
      return errorResponse("fieldVehicleId and towClass are required.", 400);
    }

    const equipment = Array.isArray(body.equipment)
      ? (body.equipment as unknown[]).map((item) => asText(item)).filter(Boolean)
      : [];

    const { data, error } = await context.ctx.auth.supabase
      .from("rr_tow_truck_profiles")
      .insert({
        company_id: context.ctx.companyId,
        field_vehicle_id: fieldVehicleId,
        tow_class: towClass,
        gvm_kg: asNumberOrNull(body.gvmKg),
        payload_capacity_kg: asNumberOrNull(body.payloadCapacityKg),
        max_vehicle_length_m: asNumberOrNull(body.maxVehicleLengthM),
        has_winch: body.hasWinch === true,
        winch_capacity_kg: body.hasWinch === true ? asNumberOrNull(body.winchCapacityKg) : null,
        has_boom: body.hasBoom === true,
        boom_capacity_kg: body.hasBoom === true ? asNumberOrNull(body.boomCapacityKg) : null,
        has_underlift: body.hasUnderlift === true,
        has_dollies: body.hasDollies === true,
        equipment,
        base_label: asText(body.baseLabel) || null,
        base_latitude: asNumberOrNull(body.baseLatitude),
        base_longitude: asNumberOrNull(body.baseLongitude),
      })
      .select("id")
      .single();

    if (error) return errorResponse(error.message, 400);
    return NextResponse.json({ ok: true, towTruckProfileId: (data as { id: string }).id });
  } catch (error: unknown) {
    return errorResponse(parseError(error), 500);
  }
}

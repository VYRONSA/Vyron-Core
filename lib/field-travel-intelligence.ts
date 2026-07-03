/**
 * VYRON CORE Phase 4B — Workforce Travel Intelligence.
 * Derives journey metrics and alerts from field_job_events (Phase 4A).
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { isSupabaseMissingTableError } from "@/lib/company-access";
import type {
  FieldDailyShift,
  FieldJob,
  FieldJobEvent,
  FieldOperationsSnapshot,
} from "@/lib/field-operations";

export const FIELD_ROUTE_SEGMENT_TYPES = ["travel", "site", "working", "idle"] as const;
export type FieldRouteSegmentType = (typeof FIELD_ROUTE_SEGMENT_TYPES)[number];

export const FIELD_JOURNEY_ALERT_TYPES = [
  "Travel Time Excessive",
  "Long Idle Period",
  "GPS Mismatch",
  "Employee Never Arrived",
  "Site Visit Too Short",
] as const;

export type FieldJourneyAlertType = (typeof FIELD_JOURNEY_ALERT_TYPES)[number];

export const FIELD_JOURNEY_THRESHOLDS = {
  /** Travel time > this % of shift triggers alert */
  excessiveTravelPct: 60,
  excessiveTravelKm: 120,
  /** Idle time > this many minutes triggers alert */
  longIdleMinutes: 90,
  longIdlePct: 25,
  gpsMismatchMeters: 500,
  minSiteVisitMinutes: 15,
  /** Arrive Site with no Start Job within this window counts as idle */
  arriveSiteIdleMinutes: 15,
} as const;

export type FieldRouteSegment = {
  id?: string;
  segmentOrder: number;
  segmentType: FieldRouteSegmentType;
  jobId: string | null;
  fromEventId: string | null;
  toEventId: string | null;
  startedAt: string;
  endedAt: string | null;
  durationSeconds: number;
  distanceKm: number;
  startLatitude: number | null;
  startLongitude: number | null;
  endLatitude: number | null;
  endLongitude: number | null;
};

export type FieldRoute = {
  id?: string;
  companyId: string;
  employeeId: string;
  routeDate: string;
  shiftId: string | null;
  startedAt: string | null;
  endedAt: string | null;
  distanceKm: number;
  travelSeconds: number;
  siteSeconds: number;
  workingSeconds: number;
  idleSeconds: number;
  jobsCompleted: number;
  productivityPct: number;
  status: "active" | "completed";
  segments: FieldRouteSegment[];
};

export type FieldJourneyAlert = {
  id: string;
  type: FieldJourneyAlertType;
  severity: "warning" | "critical";
  employeeId: string;
  jobId: string | null;
  message: string;
  recordedAt: string;
};

export type EmployeeJourneySummary = {
  employeeId: string;
  routeDate: string;
  route: FieldRoute;
  events: FieldJobEvent[];
  alerts: FieldJourneyAlert[];
};

export type TravelIntelligenceLeaderboards = {
  topTravelTime: { employeeId: string; travelSeconds: number }[];
  mostProductive: { employeeId: string; productivityPct: number }[];
  highestIdle: { employeeId: string; idleSeconds: number }[];
  mostJobsCompleted: { employeeId: string; jobsCompleted: number }[];
};

export type RouteHistoryFilter = "today" | "week" | "month";

export type WorkforceJourneyDashboard = {
  routeDate: string;
  distanceKm: number;
  travelSeconds: number;
  siteSeconds: number;
  idleSeconds: number;
  jobsCompleted: number;
  productivityPct: number;
  workingSeconds: number;
  journeys: EmployeeJourneySummary[];
  alerts: FieldJourneyAlert[];
};

const TRAVEL_TABLES = ["field_routes", "field_route_segments"] as const;

function isTravelMissingTableError(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  return TRAVEL_TABLES.some((table) => isSupabaseMissingTableError(error, table));
}

export function haversineKm(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const r = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return r * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function haversineMeters(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  return haversineKm(lat1, lon1, lat2, lon2) * 1000;
}

function secondsBetween(startIso: string, endIso: string): number {
  const start = Date.parse(startIso);
  const end = Date.parse(endIso);
  if (Number.isNaN(start) || Number.isNaN(end) || end <= start) return 0;
  return Math.round((end - start) / 1000);
}

function hasGps(event: FieldJobEvent): boolean {
  return event.latitude != null && event.longitude != null;
}

function segmentDistanceKm(
  start: { lat: number | null; lon: number | null },
  end: { lat: number | null; lon: number | null }
): number {
  if (start.lat == null || start.lon == null || end.lat == null || end.lon == null) return 0;
  return haversineKm(start.lat, start.lon, end.lat, end.lon);
}

function closeSegment(
  segments: FieldRouteSegment[],
  endEvent: FieldJobEvent,
  endTime: string
): void {
  const open = segments[segments.length - 1];
  if (!open || open.endedAt) return;
  open.endedAt = endTime;
  open.toEventId = endEvent.id;
  open.durationSeconds = secondsBetween(open.startedAt, endTime);
  if (hasGps(endEvent)) {
    open.endLatitude = endEvent.latitude;
    open.endLongitude = endEvent.longitude;
  }
  if (open.segmentType === "travel") {
    open.distanceKm = segmentDistanceKm(
      { lat: open.startLatitude, lon: open.startLongitude },
      { lat: open.endLatitude, lon: open.endLongitude }
    );
  }
}

function openSegment(
  segments: FieldRouteSegment[],
  type: FieldRouteSegmentType,
  event: FieldJobEvent,
  jobId: string | null
): void {
  segments.push({
    segmentOrder: segments.length,
    segmentType: type,
    jobId,
    fromEventId: event.id,
    toEventId: null,
    startedAt: event.recordedAt,
    endedAt: null,
    durationSeconds: 0,
    distanceKm: 0,
    startLatitude: event.latitude,
    startLongitude: event.longitude,
    endLatitude: null,
    endLongitude: null,
  });
}

function sumSegmentSeconds(segments: FieldRouteSegment[], type: FieldRouteSegmentType): number {
  return segments
    .filter((s) => s.segmentType === type)
    .reduce((sum, s) => sum + s.durationSeconds, 0);
}

function computeTravelSecondsFromEvents(events: FieldJobEvent[]): number {
  let total = 0;
  for (const start of events.filter((e) => e.eventType === "Start Travel")) {
    const end = events.find(
      (e) =>
        e.eventType === "Arrive Site" &&
        e.jobId === start.jobId &&
        Date.parse(e.recordedAt) > Date.parse(start.recordedAt)
    );
    if (end) total += secondsBetween(start.recordedAt, end.recordedAt);
  }
  return total;
}

function computeSiteSecondsFromEvents(events: FieldJobEvent[]): number {
  let total = 0;
  for (const arrive of events.filter((e) => e.eventType === "Arrive Site")) {
    const leave = events.find(
      (e) =>
        e.eventType === "Leave Site" &&
        e.jobId === arrive.jobId &&
        Date.parse(e.recordedAt) > Date.parse(arrive.recordedAt)
    );
    if (leave) total += secondsBetween(arrive.recordedAt, leave.recordedAt);
  }
  return total;
}

function computeWorkingSecondsFromEvents(events: FieldJobEvent[]): number {
  let total = 0;
  const sorted = [...events].sort((a, b) => Date.parse(a.recordedAt) - Date.parse(b.recordedAt));
  for (let i = 0; i < sorted.length; i += 1) {
    const event = sorted[i];
    if (event.eventType !== "Start Job") continue;
    const complete = sorted.find(
      (e) =>
        e.eventType === "Complete Job" &&
        e.jobId === event.jobId &&
        Date.parse(e.recordedAt) > Date.parse(event.recordedAt)
    );
    if (!complete) continue;
    let block = secondsBetween(event.recordedAt, complete.recordedAt);
    const pauses = sorted.filter(
      (e) =>
        e.eventType === "Pause Job" &&
        e.jobId === event.jobId &&
        Date.parse(e.recordedAt) > Date.parse(event.recordedAt) &&
        Date.parse(e.recordedAt) < Date.parse(complete.recordedAt)
    );
    for (const pause of pauses) {
      const resume = sorted.find(
        (e) =>
          e.eventType === "Resume Job" &&
          e.jobId === pause.jobId &&
          Date.parse(e.recordedAt) > Date.parse(pause.recordedAt)
      );
      if (resume) block -= secondsBetween(pause.recordedAt, resume.recordedAt);
    }
    total += Math.max(0, block);
  }
  return total;
}

function computeIdleSecondsFromEvents(events: FieldJobEvent[]): number {
  let total = 0;
  const sorted = [...events].sort((a, b) => Date.parse(a.recordedAt) - Date.parse(b.recordedAt));
  for (const pause of sorted.filter((e) => e.eventType === "Pause Job")) {
    const resume = sorted.find(
      (e) =>
        e.eventType === "Resume Job" &&
        e.jobId === pause.jobId &&
        Date.parse(e.recordedAt) > Date.parse(pause.recordedAt)
    );
    if (resume) total += secondsBetween(pause.recordedAt, resume.recordedAt);
  }

  const idleThresholdSec = FIELD_JOURNEY_THRESHOLDS.arriveSiteIdleMinutes * 60;
  for (const arrive of sorted.filter((e) => e.eventType === "Arrive Site")) {
    const startJob = sorted.find(
      (e) =>
        e.eventType === "Start Job" &&
        e.jobId === arrive.jobId &&
        Date.parse(e.recordedAt) > Date.parse(arrive.recordedAt)
    );
    const leaveSite = sorted.find(
      (e) =>
        e.eventType === "Leave Site" &&
        e.jobId === arrive.jobId &&
        Date.parse(e.recordedAt) > Date.parse(arrive.recordedAt)
    );
    const windowEnd = startJob?.recordedAt || leaveSite?.recordedAt;
    if (!windowEnd) continue;
    const gap = secondsBetween(arrive.recordedAt, windowEnd);
    if (!startJob && gap >= idleThresholdSec) {
      total += gap;
    } else if (startJob && gap >= idleThresholdSec) {
      total += secondsBetween(arrive.recordedAt, startJob.recordedAt);
    }
  }

  return total;
}

function computeShiftSeconds(
  startedAt: string | null,
  endedAt: string | null,
  fallbackSeconds: number
): number {
  if (startedAt && endedAt) return secondsBetween(startedAt, endedAt);
  return fallbackSeconds;
}

function computeProductivityPct(workingSeconds: number, shiftSeconds: number): number {
  if (shiftSeconds <= 0) return 0;
  return Math.round((workingSeconds / shiftSeconds) * 1000) / 10;
}

function computeTravelDistanceFromEvents(events: FieldJobEvent[]): number {
  let total = 0;
  for (const start of events.filter((e) => e.eventType === "Start Travel")) {
    const end = events.find(
      (e) =>
        e.eventType === "Arrive Site" &&
        e.jobId === start.jobId &&
        Date.parse(e.recordedAt) > Date.parse(start.recordedAt)
    );
    if (!end) continue;
    total += segmentDistanceKm(
      { lat: start.latitude, lon: start.longitude },
      { lat: end.latitude, lon: end.longitude }
    );
  }
  return total;
}

function sumSegmentDistance(segments: FieldRouteSegment[]): number {
  return segments.reduce((sum, s) => sum + s.distanceKm, 0);
}

export function computeEmployeeJourney(input: {
  companyId: string;
  employeeId: string;
  routeDate: string;
  events: FieldJobEvent[];
  shift?: FieldDailyShift | null;
}): FieldRoute {
  const dayEvents = input.events
    .filter(
      (e) =>
        e.employeeId === input.employeeId && e.recordedAt.slice(0, 10) === input.routeDate
    )
    .sort((a, b) => Date.parse(a.recordedAt) - Date.parse(b.recordedAt));

  const segments: FieldRouteSegment[] = [];
  let openType: FieldRouteSegmentType | null = null;
  let activeJobId: string | null = null;
  let travelStartedForJob: string | null = null;

  for (const event of dayEvents) {
    const jobId = event.jobId;

    switch (event.eventType) {
      case "Start Day":
        break;
      case "Start Travel":
        if (openType) closeSegment(segments, event, event.recordedAt);
        openSegment(segments, "travel", event, jobId);
        openType = "travel";
        travelStartedForJob = jobId;
        activeJobId = jobId;
        break;
      case "Arrive Site":
        if (openType === "travel") closeSegment(segments, event, event.recordedAt);
        openSegment(segments, "site", event, jobId);
        openType = "site";
        travelStartedForJob = null;
        activeJobId = jobId;
        break;
      case "Start Job":
        if (openType === "site") closeSegment(segments, event, event.recordedAt);
        openSegment(segments, "working", event, jobId);
        openType = "working";
        activeJobId = jobId;
        break;
      case "Pause Job":
        if (openType === "working") closeSegment(segments, event, event.recordedAt);
        openSegment(segments, "idle", event, jobId ?? activeJobId);
        openType = "idle";
        break;
      case "Resume Job":
        if (openType === "idle") closeSegment(segments, event, event.recordedAt);
        openSegment(segments, "working", event, jobId ?? activeJobId);
        openType = "working";
        break;
      case "Complete Job":
        if (openType === "working") closeSegment(segments, event, event.recordedAt);
        openType = openType === "working" ? null : openType;
        if (segments.length && segments[segments.length - 1].segmentType === "site") {
          /* remain on site */
        } else if (!openType || segments[segments.length - 1]?.endedAt) {
          openSegment(segments, "site", event, jobId ?? activeJobId);
          openType = "site";
        }
        activeJobId = jobId ?? activeJobId;
        break;
      case "Leave Site":
        if (openType) closeSegment(segments, event, event.recordedAt);
        openType = null;
        activeJobId = null;
        break;
      case "End Day":
        if (openType) closeSegment(segments, event, event.recordedAt);
        openType = null;
        break;
      default:
        break;
    }

    if (event.eventType === "Start Travel" && !travelStartedForJob) {
      travelStartedForJob = jobId;
    }
  }

  const travelSeconds = computeTravelSecondsFromEvents(dayEvents);
  const siteSeconds = computeSiteSecondsFromEvents(dayEvents);
  const workingSeconds = computeWorkingSecondsFromEvents(dayEvents);
  let idleSeconds = computeIdleSecondsFromEvents(dayEvents);

  const startedAt =
    input.shift?.startedAt ||
    dayEvents.find((e) => e.eventType === "Start Day")?.recordedAt ||
    dayEvents[0]?.recordedAt ||
    null;
  const endedAt =
    input.shift?.endedAt ||
    [...dayEvents].reverse().find((e) => e.eventType === "End Day")?.recordedAt ||
    dayEvents[dayEvents.length - 1]?.recordedAt ||
    null;

  if (startedAt && endedAt) {
    const shiftSeconds = secondsBetween(startedAt, endedAt);
    const accounted = travelSeconds + siteSeconds + idleSeconds;
    const gap = shiftSeconds - accounted - workingSeconds;
    if (gap > 60) {
      idleSeconds += gap;
    }
  }

  const jobsCompleted = dayEvents.filter((e) => e.eventType === "Complete Job").length;
  const distanceKm = Math.max(sumSegmentDistance(segments), computeTravelDistanceFromEvents(dayEvents));
  const shiftSeconds = computeShiftSeconds(
    startedAt,
    endedAt,
    travelSeconds + siteSeconds + workingSeconds + idleSeconds
  );
  const productivityPct = computeProductivityPct(workingSeconds, shiftSeconds);

  const status: FieldRoute["status"] =
    dayEvents.some((e) => e.eventType === "End Day") || input.shift?.status === "completed"
      ? "completed"
      : "active";

  return {
    companyId: input.companyId,
    employeeId: input.employeeId,
    routeDate: input.routeDate,
    shiftId: input.shift?.id ?? null,
    startedAt,
    endedAt,
    distanceKm: Math.round(distanceKm * 1000) / 1000,
    travelSeconds,
    siteSeconds,
    workingSeconds,
    idleSeconds,
    jobsCompleted,
    productivityPct,
    status,
    segments,
  };
}

export function detectJourneyAlerts(input: {
  journey: FieldRoute;
  events: FieldJobEvent[];
  jobs: FieldJob[];
}): FieldJourneyAlert[] {
  const alerts: FieldJourneyAlert[] = [];
  const { journey, events, jobs } = input;
  const employeeEvents = events
    .filter(
      (e) =>
        e.employeeId === journey.employeeId &&
        e.recordedAt.slice(0, 10) === journey.routeDate
    )
    .sort((a, b) => Date.parse(a.recordedAt) - Date.parse(b.recordedAt));

  const totalShift =
    journey.startedAt && journey.endedAt
      ? secondsBetween(journey.startedAt, journey.endedAt)
      : journey.travelSeconds + journey.siteSeconds + journey.workingSeconds + journey.idleSeconds;

  if (
    journey.distanceKm >= FIELD_JOURNEY_THRESHOLDS.excessiveTravelKm ||
    (totalShift > 0 &&
      (journey.travelSeconds / totalShift) * 100 >= FIELD_JOURNEY_THRESHOLDS.excessiveTravelPct)
  ) {
    alerts.push({
      id: `excessive-travel-${journey.employeeId}-${journey.routeDate}`,
      type: "Travel Time Excessive",
      severity: "warning",
      employeeId: journey.employeeId,
      jobId: null,
      message: `Travel ${formatDuration(journey.travelSeconds)} / ${journey.distanceKm.toFixed(1)} km exceeds policy.`,
      recordedAt: journey.endedAt || journey.startedAt || new Date().toISOString(),
    });
  }

  if (
    journey.idleSeconds >= FIELD_JOURNEY_THRESHOLDS.longIdleMinutes * 60 ||
    (totalShift > 0 &&
      (journey.idleSeconds / totalShift) * 100 >= FIELD_JOURNEY_THRESHOLDS.longIdlePct)
  ) {
    alerts.push({
      id: `long-idle-${journey.employeeId}-${journey.routeDate}`,
      type: "Long Idle Period",
      severity: "warning",
      employeeId: journey.employeeId,
      jobId: null,
      message: `Idle time ${formatDuration(journey.idleSeconds)} exceeds threshold.`,
      recordedAt: journey.endedAt || journey.startedAt || new Date().toISOString(),
    });
  }

  for (const event of employeeEvents) {
    if (event.eventType !== "Arrive Site" || !event.jobId) continue;
    const job = jobs.find((j) => j.id === event.jobId);
    if (!job || job.latitude == null || job.longitude == null || !hasGps(event)) continue;
    const meters = haversineMeters(
      event.latitude!,
      event.longitude!,
      job.latitude,
      job.longitude
    );
    if (meters > FIELD_JOURNEY_THRESHOLDS.gpsMismatchMeters) {
      alerts.push({
        id: `gps-mismatch-${event.id}`,
        type: "GPS Mismatch",
        severity: "critical",
        employeeId: journey.employeeId,
        jobId: event.jobId,
        message: `Arrive Site GPS ${Math.round(meters)} m from job site for ${job.jobRef}.`,
        recordedAt: event.recordedAt,
      });
    }
  }

  const travels = employeeEvents.filter((e) => e.eventType === "Start Travel");
  for (const travel of travels) {
    if (!travel.jobId) continue;
    const arrived = employeeEvents.find(
      (e) =>
        e.eventType === "Arrive Site" &&
        e.jobId === travel.jobId &&
        Date.parse(e.recordedAt) > Date.parse(travel.recordedAt)
    );
    if (!arrived) {
      const job = jobs.find((j) => j.id === travel.jobId);
      alerts.push({
        id: `never-arrived-${travel.id}`,
        type: "Employee Never Arrived",
        severity: "critical",
        employeeId: journey.employeeId,
        jobId: travel.jobId,
        message: `Travel started for ${job?.jobRef || "job"} without Arrive Site event.`,
        recordedAt: travel.recordedAt,
      });
    }
  }

  for (const segment of journey.segments) {
    if (segment.segmentType !== "site" || !segment.jobId) continue;
    const minutes = segment.durationSeconds / 60;
    if (minutes >= FIELD_JOURNEY_THRESHOLDS.minSiteVisitMinutes) continue;
    const completed = employeeEvents.some(
      (e) => e.eventType === "Complete Job" && e.jobId === segment.jobId
    );
    if (!completed) continue;
    const job = jobs.find((j) => j.id === segment.jobId);
    alerts.push({
      id: `short-visit-${segment.fromEventId}-${segment.jobId}`,
      type: "Site Visit Too Short",
      severity: "warning",
      employeeId: journey.employeeId,
      jobId: segment.jobId,
      message: `Site visit ${Math.round(minutes)} min for ${job?.jobRef || "job"} is below minimum.`,
      recordedAt: segment.startedAt,
    });
  }

  return alerts;
}

export function buildWorkforceJourneyDashboard(
  snapshot: FieldOperationsSnapshot,
  routeDate: string,
  companyId?: string
): WorkforceJourneyDashboard {
  const resolvedCompanyId =
    companyId || snapshot.jobs[0]?.companyId || snapshot.events[0]?.companyId || "";
  const employeeIds = [
    ...new Set(
      snapshot.events
        .filter((e) => e.recordedAt.slice(0, 10) === routeDate)
        .map((e) => e.employeeId)
    ),
  ];

  const journeys: EmployeeJourneySummary[] = employeeIds.map((employeeId) => {
    const shift =
      snapshot.shifts.find(
        (s) => s.employeeId === employeeId && s.shiftDate === routeDate
      ) ?? null;
    const route = computeEmployeeJourney({
      companyId: resolvedCompanyId || shift?.companyId || "",
      employeeId,
      routeDate,
      events: snapshot.events,
      shift,
    });
    route.companyId = resolvedCompanyId || shift?.companyId || route.companyId;
    const alerts = detectJourneyAlerts({
      journey: route,
      events: snapshot.events,
      jobs: snapshot.jobs,
    });
    const dayEvents = snapshot.events
      .filter(
        (e) =>
          e.employeeId === employeeId && e.recordedAt.slice(0, 10) === routeDate
      )
      .sort((a, b) => Date.parse(a.recordedAt) - Date.parse(b.recordedAt));
    return { employeeId, routeDate, route, events: dayEvents, alerts };
  });

  const totals = journeys.reduce(
    (acc, j) => ({
      distanceKm: acc.distanceKm + j.route.distanceKm,
      travelSeconds: acc.travelSeconds + j.route.travelSeconds,
      siteSeconds: acc.siteSeconds + j.route.siteSeconds,
      idleSeconds: acc.idleSeconds + j.route.idleSeconds,
      workingSeconds: acc.workingSeconds + j.route.workingSeconds,
      jobsCompleted: acc.jobsCompleted + j.route.jobsCompleted,
    }),
    {
      distanceKm: 0,
      travelSeconds: 0,
      siteSeconds: 0,
      idleSeconds: 0,
      workingSeconds: 0,
      jobsCompleted: 0,
    }
  );

  const totalShiftSeconds = journeys.reduce((sum, j) => {
    const shift = computeShiftSeconds(
      j.route.startedAt,
      j.route.endedAt,
      j.route.travelSeconds +
        j.route.siteSeconds +
        j.route.workingSeconds +
        j.route.idleSeconds
    );
    return sum + shift;
  }, 0);
  const productivityPct = computeProductivityPct(totals.workingSeconds, totalShiftSeconds);

  const alerts = journeys.flatMap((j) => j.alerts);

  return {
    routeDate,
    distanceKm: Math.round(totals.distanceKm * 1000) / 1000,
    travelSeconds: totals.travelSeconds,
    siteSeconds: totals.siteSeconds,
    idleSeconds: totals.idleSeconds,
    jobsCompleted: totals.jobsCompleted,
    productivityPct,
    workingSeconds: totals.workingSeconds,
    journeys,
    alerts,
  };
}

export function formatEventClockTime(iso: string): string {
  const parsed = Date.parse(iso);
  if (Number.isNaN(parsed)) return "—";
  return new Date(parsed).toLocaleTimeString("en-ZA", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

export function buildTravelIntelligenceLeaderboards(
  journeys: EmployeeJourneySummary[]
): TravelIntelligenceLeaderboards {
  const topTravelTime = [...journeys]
    .sort((a, b) => b.route.travelSeconds - a.route.travelSeconds)
    .slice(0, 10)
    .map((j) => ({ employeeId: j.employeeId, travelSeconds: j.route.travelSeconds }));

  const mostProductive = [...journeys]
    .sort((a, b) => b.route.productivityPct - a.route.productivityPct)
    .slice(0, 10)
    .map((j) => ({ employeeId: j.employeeId, productivityPct: j.route.productivityPct }));

  const highestIdle = [...journeys]
    .sort((a, b) => b.route.idleSeconds - a.route.idleSeconds)
    .slice(0, 10)
    .map((j) => ({ employeeId: j.employeeId, idleSeconds: j.route.idleSeconds }));

  const mostJobsCompleted = [...journeys]
    .sort((a, b) => b.route.jobsCompleted - a.route.jobsCompleted)
    .slice(0, 10)
    .map((j) => ({ employeeId: j.employeeId, jobsCompleted: j.route.jobsCompleted }));

  return { topTravelTime, mostProductive, highestIdle, mostJobsCompleted };
}

export function datesForRouteHistoryFilter(
  filter: RouteHistoryFilter,
  anchor = new Date()
): string[] {
  const dates: string[] = [];
  const end = new Date(anchor);
  end.setHours(0, 0, 0, 0);
  const days = filter === "today" ? 1 : filter === "week" ? 7 : 30;
  for (let i = 0; i < days; i += 1) {
    const d = new Date(end);
    d.setDate(end.getDate() - i);
    dates.push(d.toISOString().slice(0, 10));
  }
  return dates;
}

export function buildRouteHistoryDashboard(
  snapshot: FieldOperationsSnapshot,
  dates: string[],
  companyId?: string,
  employeeFilter?: string
): WorkforceJourneyDashboard & { dates: string[] } {
  const journeys: EmployeeJourneySummary[] = [];
  for (const routeDate of dates) {
    const day = buildWorkforceJourneyDashboard(snapshot, routeDate, companyId);
    for (const journey of day.journeys) {
      if (employeeFilter && journey.employeeId !== employeeFilter) continue;
      journeys.push(journey);
    }
  }

  const totals = journeys.reduce(
    (acc, j) => ({
      distanceKm: acc.distanceKm + j.route.distanceKm,
      travelSeconds: acc.travelSeconds + j.route.travelSeconds,
      siteSeconds: acc.siteSeconds + j.route.siteSeconds,
      idleSeconds: acc.idleSeconds + j.route.idleSeconds,
      workingSeconds: acc.workingSeconds + j.route.workingSeconds,
      jobsCompleted: acc.jobsCompleted + j.route.jobsCompleted,
    }),
    {
      distanceKm: 0,
      travelSeconds: 0,
      siteSeconds: 0,
      idleSeconds: 0,
      workingSeconds: 0,
      jobsCompleted: 0,
    }
  );

  const totalShiftSeconds = journeys.reduce((sum, j) => {
    return (
      sum +
      computeShiftSeconds(
        j.route.startedAt,
        j.route.endedAt,
        j.route.travelSeconds +
          j.route.siteSeconds +
          j.route.workingSeconds +
          j.route.idleSeconds
      )
    );
  }, 0);

  return {
    dates,
    routeDate: dates[0] || new Date().toISOString().slice(0, 10),
    distanceKm: Math.round(totals.distanceKm * 1000) / 1000,
    travelSeconds: totals.travelSeconds,
    siteSeconds: totals.siteSeconds,
    idleSeconds: totals.idleSeconds,
    jobsCompleted: totals.jobsCompleted,
    productivityPct: computeProductivityPct(totals.workingSeconds, totalShiftSeconds),
    workingSeconds: totals.workingSeconds,
    journeys,
    alerts: journeys.flatMap((j) => j.alerts),
  };
}

export function formatDuration(totalSeconds: number): string {
  if (totalSeconds <= 0) return "0m";
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

export function formatDistanceKm(km: number): string {
  if (km < 1) return `${Math.round(km * 1000)} m`;
  return `${km.toFixed(1)} km`;
}

export function alertSeverityClass(severity: FieldJourneyAlert["severity"]): string {
  return severity === "critical"
    ? "bg-rose-100 text-rose-900 border-rose-200"
    : "bg-amber-100 text-amber-950 border-amber-200";
}

export function segmentTypeClass(type: FieldRouteSegmentType): string {
  if (type === "travel") return "bg-blue-100 text-blue-800";
  if (type === "site") return "bg-cyan-100 text-cyan-900";
  if (type === "working") return "bg-emerald-100 text-emerald-800";
  return "bg-slate-200 text-slate-700";
}

export async function syncFieldRoutesFromSnapshot(
  supabase: SupabaseClient,
  snapshot: FieldOperationsSnapshot,
  routeDate: string
): Promise<{ ok: boolean; error: string | null }> {
  const companyId = snapshot.jobs[0]?.companyId || snapshot.events[0]?.companyId;
  if (!companyId) return { ok: true, error: null };

  const dashboard = buildWorkforceJourneyDashboard(snapshot, routeDate);
  const now = new Date().toISOString();

  for (const journey of dashboard.journeys) {
    const { data: routeRow, error: routeError } = await supabase
      .from("field_routes")
      .upsert(
        {
          company_id: companyId,
          employee_id: journey.employeeId,
          route_date: routeDate,
          shift_id: journey.route.shiftId,
          started_at: journey.route.startedAt,
          ended_at: journey.route.endedAt,
          distance_km: journey.route.distanceKm,
          travel_seconds: journey.route.travelSeconds,
          site_seconds: journey.route.siteSeconds,
          working_seconds: journey.route.workingSeconds,
          idle_seconds: journey.route.idleSeconds,
          jobs_completed: journey.route.jobsCompleted,
          productivity_pct: journey.route.productivityPct,
          status: journey.route.status,
          updated_at: now,
        },
        { onConflict: "company_id,employee_id,route_date" }
      )
      .select("id")
      .single();

    if (routeError) {
      if (isTravelMissingTableError(routeError)) return { ok: false, error: null };
      return { ok: false, error: routeError.message };
    }

    const routeId = routeRow?.id as string | undefined;
    if (!routeId) continue;

    await supabase.from("field_route_segments").delete().eq("route_id", routeId);

    if (journey.route.segments.length === 0) continue;

    const segmentRows = journey.route.segments.map((segment, index) => ({
      company_id: companyId,
      route_id: routeId,
      segment_order: index,
      segment_type: segment.segmentType,
      job_id: segment.jobId,
      from_event_id: segment.fromEventId,
      to_event_id: segment.toEventId,
      started_at: segment.startedAt,
      ended_at: segment.endedAt,
      duration_seconds: segment.durationSeconds,
      distance_km: segment.distanceKm,
      start_latitude: segment.startLatitude,
      start_longitude: segment.startLongitude,
      end_latitude: segment.endLatitude,
      end_longitude: segment.endLongitude,
    }));

    const { error: segError } = await supabase.from("field_route_segments").insert(segmentRows);
    if (segError && !isTravelMissingTableError(segError)) {
      return { ok: false, error: segError.message };
    }
  }

  return { ok: true, error: null };
}

export async function fetchFieldRoutesForDate(
  supabase: SupabaseClient,
  companyId: string,
  routeDate: string
): Promise<{ routes: FieldRoute[]; error: string | null; tablesAvailable: boolean }> {
  if (!companyId) return { routes: [], error: null, tablesAvailable: false };

  const { data: routeRows, error: routeError } = await supabase
    .from("field_routes")
    .select("*")
    .eq("company_id", companyId)
    .eq("route_date", routeDate);

  if (routeError) {
    if (isTravelMissingTableError(routeError)) {
      return { routes: [], error: null, tablesAvailable: false };
    }
    return { routes: [], error: routeError.message, tablesAvailable: true };
  }

  const routeIds = (routeRows || []).map((r) => String(r.id));
  let segmentRows: Record<string, unknown>[] = [];
  if (routeIds.length) {
    const { data, error: segError } = await supabase
      .from("field_route_segments")
      .select("*")
      .in("route_id", routeIds)
      .order("segment_order", { ascending: true });
    if (segError && !isTravelMissingTableError(segError)) {
      return { routes: [], error: segError.message, tablesAvailable: true };
    }
    segmentRows = (data || []) as Record<string, unknown>[];
  }

  const routes: FieldRoute[] = (routeRows || []).map((row) => {
    const id = String(row.id);
    const segments = segmentRows
      .filter((s) => String(s.route_id) === id)
      .map((s, index) => ({
        id: String(s.id),
        segmentOrder: Number(s.segment_order ?? index),
        segmentType: String(s.segment_type) as FieldRouteSegmentType,
        jobId: s.job_id ? String(s.job_id) : null,
        fromEventId: s.from_event_id ? String(s.from_event_id) : null,
        toEventId: s.to_event_id ? String(s.to_event_id) : null,
        startedAt: String(s.started_at),
        endedAt: s.ended_at ? String(s.ended_at) : null,
        durationSeconds: Number(s.duration_seconds || 0),
        distanceKm: Number(s.distance_km || 0),
        startLatitude: s.start_latitude != null ? Number(s.start_latitude) : null,
        startLongitude: s.start_longitude != null ? Number(s.start_longitude) : null,
        endLatitude: s.end_latitude != null ? Number(s.end_latitude) : null,
        endLongitude: s.end_longitude != null ? Number(s.end_longitude) : null,
      }));

    return {
      id,
      companyId: String(row.company_id),
      employeeId: String(row.employee_id),
      routeDate: String(row.route_date).slice(0, 10),
      shiftId: row.shift_id ? String(row.shift_id) : null,
      startedAt: row.started_at ? String(row.started_at) : null,
      endedAt: row.ended_at ? String(row.ended_at) : null,
      distanceKm: Number(row.distance_km || 0),
      travelSeconds: Number(row.travel_seconds || 0),
      siteSeconds: Number(row.site_seconds || 0),
      workingSeconds: Number(row.working_seconds || 0),
      idleSeconds: Number(row.idle_seconds || 0),
      jobsCompleted: Number(row.jobs_completed || 0),
      productivityPct: Number(row.productivity_pct || 0),
      status: row.status === "completed" ? "completed" : "active",
      segments,
    };
  });

  return { routes, error: null, tablesAvailable: true };
}

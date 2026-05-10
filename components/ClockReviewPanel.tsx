"use client";

import React, { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Camera,
  CheckCircle2,
  Clock3,
  Eye,
  MapPin,
  RefreshCcw,
  ShieldCheck,
  X,
} from "lucide-react";
import { supabase } from "../lib/supabase";

type ClockEventRow = {
  id: string;
  employee_id: string;
  store_id: string | null;
  event_type: string;
  event_time: string;
  source: string;
  latitude: number | null;
  longitude: number | null;
  photo_bucket?: string | null;
  photo_path?: string | null;
  gps_accuracy_meters?: number | null;
  gps_distance_from_store_meters?: number | null;
  gps_verification_status?: string | null;
  photo_verification_status?: string | null;
  verification_status?: string | null;
  verification_notes?: string | null;
  retain_photo_until?: string | null;
  device_platform?: string | null;
  device_user_agent?: string | null;
  created_at?: string | null;
};

type EmployeeRow = {
  id: string;
  employee_number: string | null;
  first_name: string;
  last_name: string;
};

type StoreRow = {
  id: string;
  name: string;
};

function formatText(value: string | null | undefined) {
  if (!value) return "Not set";
  return value.replaceAll("_", " ");
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return "Not set";

  try {
    return new Date(value).toLocaleString("en-ZA", {
      weekday: "short",
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return value;
  }
}

function employeeName(employee: EmployeeRow | undefined) {
  if (!employee) return "Unknown employee";
  return `${employee.first_name || ""} ${employee.last_name || ""}`.trim();
}

function statusClass(value: string | null | undefined) {
  if (value === "verified" || value === "inside_radius" || value === "photo_captured") {
    return "bg-emerald-100 text-emerald-700";
  }

  if (value === "manager_review" || value === "outside_radius" || value === "store_gps_missing") {
    return "bg-amber-100 text-amber-700";
  }

  if (value === "rejected" || value === "gps_missing") {
    return "bg-rose-100 text-rose-700";
  }

  return "bg-slate-100 text-slate-700";
}

function Pill({ value }: { value: string | null | undefined }) {
  return (
    <span className={`rounded-full px-3 py-1 text-xs font-black capitalize ${statusClass(value)}`}>
      {formatText(value)}
    </span>
  );
}

function StatCard({
  title,
  value,
  subtitle,
  tone,
}: {
  title: string;
  value: string;
  subtitle: string;
  tone: string;
}) {
  return (
    <div className={`rounded-[28px] border p-5 ${tone}`}>
      <div className="text-xs font-black uppercase tracking-[0.22em] opacity-70">
        {title}
      </div>
      <div className="mt-3 text-4xl font-black">{value}</div>
      <div className="mt-2 text-sm font-semibold opacity-80">{subtitle}</div>
    </div>
  );
}

export default function ClockReviewPanel() {
  const [clockEvents, setClockEvents] = useState<ClockEventRow[]>([]);
  const [employees, setEmployees] = useState<EmployeeRow[]>([]);
  const [stores, setStores] = useState<StoreRow[]>([]);
  const [selectedEvent, setSelectedEvent] = useState<ClockEventRow | null>(null);
  const [signedPhotoUrl, setSignedPhotoUrl] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | "verified" | "manager_review" | "outside_radius">("all");
  const [loading, setLoading] = useState(true);
  const [photoLoading, setPhotoLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const employeeMap = useMemo(() => {
    const map = new Map<string, EmployeeRow>();
    employees.forEach((employee) => map.set(employee.id, employee));
    return map;
  }, [employees]);

  const storeMap = useMemo(() => {
    const map = new Map<string, StoreRow>();
    stores.forEach((store) => map.set(store.id, store));
    return map;
  }, [stores]);

  const filteredEvents = useMemo(() => {
    if (filter === "all") return clockEvents;

    if (filter === "outside_radius") {
      return clockEvents.filter((event) => event.gps_verification_status === "outside_radius");
    }

    return clockEvents.filter((event) => event.verification_status === filter);
  }, [clockEvents, filter]);

  const verifiedCount = useMemo(
    () => clockEvents.filter((event) => event.verification_status === "verified").length,
    [clockEvents]
  );

  const reviewCount = useMemo(
    () => clockEvents.filter((event) => event.verification_status === "manager_review").length,
    [clockEvents]
  );

  const outsideRadiusCount = useMemo(
    () => clockEvents.filter((event) => event.gps_verification_status === "outside_radius").length,
    [clockEvents]
  );

  useEffect(() => {
    loadReviewData();
  }, []);

  async function loadReviewData() {
    setLoading(true);
    setError(null);

    const [clockResult, employeeResult, storeResult] = await Promise.all([
      supabase
        .from("clock_events")
        .select("*")
        .order("event_time", { ascending: false })
        .limit(100),
      supabase
        .from("employees")
        .select("id,employee_number,first_name,last_name")
        .order("first_name", { ascending: true }),
      supabase
        .from("stores")
        .select("id,name")
        .order("name", { ascending: true }),
    ]);

    if (clockResult.error) {
      setError(clockResult.error.message);
      setLoading(false);
      return;
    }

    if (employeeResult.error) {
      setError(employeeResult.error.message);
      setLoading(false);
      return;
    }

    if (storeResult.error) {
      setError(storeResult.error.message);
      setLoading(false);
      return;
    }

    setClockEvents((clockResult.data || []) as ClockEventRow[]);
    setEmployees((employeeResult.data || []) as EmployeeRow[]);
    setStores((storeResult.data || []) as StoreRow[]);
    setLoading(false);
  }

  async function openEvent(event: ClockEventRow) {
    setSelectedEvent(event);
    setSignedPhotoUrl(null);
    setPhotoLoading(true);
    setError(null);

    if (!event.photo_bucket || !event.photo_path) {
      setPhotoLoading(false);
      return;
    }

    const { data, error: signedError } = await supabase.storage
      .from(event.photo_bucket)
      .createSignedUrl(event.photo_path, 60 * 10);

    if (signedError) {
      setError(signedError.message);
      setPhotoLoading(false);
      return;
    }

    setSignedPhotoUrl(data.signedUrl);
    setPhotoLoading(false);
  }

  function storeName(storeId: string | null) {
    if (!storeId) return "No store linked";
    return storeMap.get(storeId)?.name || "Unknown store";
  }

  function closeEvent() {
    setSelectedEvent(null);
    setSignedPhotoUrl(null);
    setPhotoLoading(false);
  }

  return (
    <div className="mt-8 space-y-8">
      <section className="rounded-[34px] bg-gradient-to-r from-[#07101f] to-[#0b1a33] p-6 text-white shadow-2xl shadow-slate-300">
        <div className="flex flex-col gap-5 md:flex-row md:items-center md:justify-between">
          <div>
            <div className="text-xs font-bold uppercase tracking-[0.4em] text-cyan-300">
              VYRON VERIFY
            </div>
            <h2 className="mt-3 text-4xl font-bold">Clocking Proof Review</h2>
            <p className="mt-4 max-w-3xl text-sm leading-7 text-slate-300">
              Review employee clock-ins and clock-outs with photo proof, GPS distance,
              device evidence and manager-review flags.
            </p>
          </div>

          <button
            onClick={loadReviewData}
            className="flex w-fit items-center gap-2 rounded-2xl bg-white px-5 py-3 text-sm font-bold text-slate-950"
          >
            <RefreshCcw className="h-4 w-4" />
            {loading ? "Loading..." : "Refresh"}
          </button>
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-4">
        <StatCard
          title="Events Loaded"
          value={String(clockEvents.length)}
          subtitle="Latest 100 records"
          tone="border-slate-200 bg-white text-slate-950"
        />
        <StatCard
          title="Verified"
          value={String(verifiedCount)}
          subtitle="Photo + GPS passed"
          tone="border-emerald-200 bg-emerald-50 text-emerald-900"
        />
        <StatCard
          title="Review Needed"
          value={String(reviewCount)}
          subtitle="Manager must check"
          tone="border-amber-200 bg-amber-50 text-amber-900"
        />
        <StatCard
          title="Outside Radius"
          value={String(outsideRadiusCount)}
          subtitle="GPS outside allowed area"
          tone="border-rose-200 bg-rose-50 text-rose-900"
        />
      </section>

      {error && (
        <section className="rounded-2xl bg-rose-50 p-4 text-sm font-semibold text-rose-700">
          <AlertTriangle className="mr-2 inline h-4 w-4" />
          {error}
        </section>
      )}

      <section className="rounded-[34px] border border-slate-200 bg-white p-6 shadow-[0_10px_30px_rgba(0,0,0,0.08)]">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <div className="text-xs font-bold uppercase tracking-[0.35em] text-blue-600">
              Verification Feed
            </div>
            <h3 className="mt-2 text-2xl font-bold text-slate-950">
              Latest Clocking Evidence
            </h3>
            <p className="mt-2 text-sm text-slate-500">
              Click any event to open the full photo and GPS proof pack.
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            {(["all", "verified", "manager_review", "outside_radius"] as const).map((item) => (
              <button
                key={item}
                onClick={() => setFilter(item)}
                className={`rounded-full px-4 py-2 text-xs font-black uppercase tracking-[0.16em] ${
                  filter === item
                    ? "bg-slate-950 text-white"
                    : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                }`}
              >
                {formatText(item)}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-6 space-y-3">
          {loading ? (
            <div className="rounded-2xl bg-slate-50 p-5 text-sm font-semibold text-slate-500">
              Loading clocking proof records...
            </div>
          ) : filteredEvents.length === 0 ? (
            <div className="rounded-2xl bg-slate-50 p-5 text-sm font-semibold text-slate-500">
              No clocking proof records found for this filter.
            </div>
          ) : (
            filteredEvents.map((event) => {
              const employee = employeeMap.get(event.employee_id);

              return (
                <button
                  key={event.id}
                  onClick={() => openEvent(event)}
                  className="w-full rounded-[26px] border border-slate-200 bg-slate-50 p-5 text-left transition hover:-translate-y-0.5 hover:shadow-lg"
                >
                  <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                    <div>
                      <div className="text-lg font-black text-slate-950">
                        {employeeName(employee)}
                      </div>
                      <div className="mt-1 text-xs font-semibold text-slate-500">
                        {employee?.employee_number || event.employee_id} ·{" "}
                        {formatText(event.event_type)} · {formatDateTime(event.event_time)}
                      </div>
                    </div>

                    <div className="flex flex-wrap gap-2">
                      <Pill value={event.verification_status} />
                      <Pill value={event.gps_verification_status} />
                    </div>
                  </div>

                  <div className="mt-4 grid gap-3 md:grid-cols-4">
                    <div className="rounded-2xl bg-white p-4">
                      <div className="text-xs font-black uppercase tracking-[0.18em] text-slate-400">
                        Store
                      </div>
                      <div className="mt-1 text-sm font-bold text-slate-950">
                        {storeName(event.store_id)}
                      </div>
                    </div>

                    <div className="rounded-2xl bg-white p-4">
                      <div className="text-xs font-black uppercase tracking-[0.18em] text-slate-400">
                        Distance
                      </div>
                      <div className="mt-1 text-sm font-bold text-slate-950">
                        {event.gps_distance_from_store_meters === null ||
                        event.gps_distance_from_store_meters === undefined
                          ? "Not checked"
                          : `${Math.round(Number(event.gps_distance_from_store_meters))} m`}
                      </div>
                    </div>

                    <div className="rounded-2xl bg-white p-4">
                      <div className="text-xs font-black uppercase tracking-[0.18em] text-slate-400">
                        Photo
                      </div>
                      <div className="mt-1 text-sm font-bold text-slate-950">
                        {event.photo_path ? "Saved" : "Missing"}
                      </div>
                    </div>

                    <div className="rounded-2xl bg-white p-4">
                      <div className="text-xs font-black uppercase tracking-[0.18em] text-slate-400">
                        Source
                      </div>
                      <div className="mt-1 text-sm font-bold text-slate-950">
                        {event.source}
                      </div>
                    </div>
                  </div>
                </button>
              );
            })
          )}
        </div>
      </section>

      {selectedEvent && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60 p-4">
          <div className="max-h-[92vh] w-full max-w-5xl overflow-y-auto rounded-[34px] bg-white p-6 shadow-2xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="text-xs font-bold uppercase tracking-[0.35em] text-blue-600">
                  Clocking Proof Pack
                </div>
                <h3 className="mt-2 text-3xl font-black text-slate-950">
                  {employeeName(employeeMap.get(selectedEvent.employee_id))}
                </h3>
                <p className="mt-2 text-sm text-slate-500">
                  {formatText(selectedEvent.event_type)} ·{" "}
                  {formatDateTime(selectedEvent.event_time)}
                </p>
              </div>

              <button onClick={closeEvent} className="rounded-2xl bg-slate-100 p-3">
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="mt-6 grid gap-6 xl:grid-cols-[0.95fr_1.05fr]">
              <section className="rounded-[28px] border border-slate-200 bg-slate-50 p-5">
                <div className="flex items-center gap-2">
                  <Camera className="h-5 w-5 text-blue-600" />
                  <h4 className="text-xl font-black text-slate-950">Photo Proof</h4>
                </div>

                <div className="mt-4 overflow-hidden rounded-2xl bg-slate-950">
                  {photoLoading ? (
                    <div className="flex h-[420px] items-center justify-center text-sm font-bold text-white">
                      Loading photo...
                    </div>
                  ) : signedPhotoUrl ? (
                    <img
                      src={signedPhotoUrl}
                      alt="Clocking proof"
                      className="h-[420px] w-full object-cover"
                    />
                  ) : (
                    <div className="flex h-[420px] items-center justify-center p-8 text-center text-sm font-bold text-white">
                      No photo saved for this event.
                    </div>
                  )}
                </div>

                <div className="mt-4">
                  <Pill value={selectedEvent.photo_verification_status} />
                </div>
              </section>

              <section className="space-y-4">
                <div className="rounded-[28px] border border-slate-200 bg-slate-50 p-5">
                  <div className="flex items-center gap-2">
                    <ShieldCheck className="h-5 w-5 text-blue-600" />
                    <h4 className="text-xl font-black text-slate-950">Verification</h4>
                  </div>

                  <div className="mt-4 grid gap-3 md:grid-cols-2">
                    <Info label="Main Status" value={formatText(selectedEvent.verification_status)} />
                    <Info label="GPS Status" value={formatText(selectedEvent.gps_verification_status)} />
                    <Info
                      label="Distance"
                      value={
                        selectedEvent.gps_distance_from_store_meters === null ||
                        selectedEvent.gps_distance_from_store_meters === undefined
                          ? "Not checked"
                          : `${Math.round(Number(selectedEvent.gps_distance_from_store_meters))} m`
                      }
                    />
                    <Info
                      label="Accuracy"
                      value={
                        selectedEvent.gps_accuracy_meters === null ||
                        selectedEvent.gps_accuracy_meters === undefined
                          ? "Not captured"
                          : `${Math.round(Number(selectedEvent.gps_accuracy_meters))} m`
                      }
                    />
                  </div>
                </div>

                <div className="rounded-[28px] border border-slate-200 bg-slate-50 p-5">
                  <div className="flex items-center gap-2">
                    <MapPin className="h-5 w-5 text-blue-600" />
                    <h4 className="text-xl font-black text-slate-950">Location</h4>
                  </div>

                  <div className="mt-4 grid gap-3 md:grid-cols-2">
                    <Info label="Store" value={storeName(selectedEvent.store_id)} />
                    <Info label="Latitude" value={String(selectedEvent.latitude ?? "Not captured")} />
                    <Info label="Longitude" value={String(selectedEvent.longitude ?? "Not captured")} />
                    <Info label="Source" value={selectedEvent.source} />
                  </div>
                </div>

                <div className="rounded-[28px] border border-slate-200 bg-slate-50 p-5">
                  <div className="flex items-center gap-2">
                    <Eye className="h-5 w-5 text-blue-600" />
                    <h4 className="text-xl font-black text-slate-950">Audit Detail</h4>
                  </div>

                  <div className="mt-4 grid gap-3">
                    <Info label="Device Platform" value={selectedEvent.device_platform || "Not captured"} />
                    <Info label="Retain Photo Until" value={selectedEvent.retain_photo_until || "Not set"} />
                    <Info label="Notes" value={selectedEvent.verification_notes || "No notes"} />
                  </div>

                  <div className="mt-4 rounded-2xl bg-white p-4">
                    <div className="text-xs font-black uppercase tracking-[0.18em] text-slate-400">
                      User Agent
                    </div>
                    <div className="mt-2 break-words text-xs font-semibold text-slate-600">
                      {selectedEvent.device_user_agent || "Not captured"}
                    </div>
                  </div>
                </div>
              </section>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl bg-white p-4">
      <div className="text-xs font-black uppercase tracking-[0.18em] text-slate-400">
        {label}
      </div>
      <div className="mt-2 text-sm font-bold text-slate-950">{value}</div>
    </div>
  );
}
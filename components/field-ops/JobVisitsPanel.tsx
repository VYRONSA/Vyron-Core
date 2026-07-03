"use client";

import React, { useEffect, useMemo, useState } from "react";
import { MapPin, Plus, RefreshCcw } from "lucide-react";
import {
  createFieldJob,
  fetchFieldOperationsSnapshot,
  FIELD_SITE_TYPE_LABELS,
  FIELD_SITE_TYPES,
  formatFieldTimestamp,
  jobStatusClass,
  type FieldJob,
  type FieldSiteType,
} from "@/lib/field-operations";
import { supabase } from "@/lib/supabase";

type EmployeeRow = { id: string; first_name: string; last_name: string; active: boolean };
type StoreRow = { id: string; name: string; city: string | null };

type Props = {
  companyId: string;
  employees: EmployeeRow[];
  stores: StoreRow[];
};

function employeeLabel(employees: EmployeeRow[], id: string) {
  const row = employees.find((e) => e.id === id);
  if (!row) return "—";
  return `${row.first_name} ${row.last_name}`.trim();
}

export default function JobVisitsPanel({ companyId, employees, stores }: Props) {
  const [jobs, setJobs] = useState<FieldJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  const [title, setTitle] = useState("");
  const [siteType, setSiteType] = useState<FieldSiteType>("customer_address");
  const [storeId, setStoreId] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [customerAddress, setCustomerAddress] = useState("");
  const [employeeId, setEmployeeId] = useState("");
  const [vehicleId, setVehicleId] = useState("");
  const [trailerId, setTrailerId] = useState("");
  const [assetId, setAssetId] = useState("");
  const [vehicles, setVehicles] = useState<{ id: string; label: string }[]>([]);
  const [trailers, setTrailers] = useState<{ id: string; label: string }[]>([]);
  const [assets, setAssets] = useState<{ id: string; label: string }[]>([]);
  const [latitude, setLatitude] = useState("");
  const [longitude, setLongitude] = useState("");
  const [scheduledStart, setScheduledStart] = useState("");
  const [notes, setNotes] = useState("");

  const activeEmployees = useMemo(
    () => employees.filter((employee) => employee.active),
    [employees]
  );

  async function load() {
    if (!companyId) return;
    setLoading(true);
    const snapshot = await fetchFieldOperationsSnapshot(supabase, companyId);
    setJobs(snapshot.jobs);
    setVehicles(
      snapshot.vehicles.map((v) => ({
        id: v.id,
        label: `${v.registration}${v.vehicleName ? ` · ${v.vehicleName}` : v.makeModel ? ` · ${v.makeModel}` : ""}`,
      }))
    );
    setAssets(
      snapshot.assets.map((a) => ({
        id: a.id,
        label: `${a.name}${a.assetNumber || a.assetCode ? ` · ${a.assetNumber || a.assetCode}` : ""}`,
      }))
    );
    const trailersRes = await supabase
      .from("field_trailers")
      .select("id, trailer_number, registration")
      .eq("company_id", companyId)
      .order("trailer_number");
    if (!trailersRes.error) {
      setTrailers(
        (trailersRes.data || []).map((row) => ({
          id: String((row as { id: string }).id),
          label: `Trailer ${String((row as { trailer_number: string }).trailer_number)}`,
        }))
      );
    }
    setLoading(false);
  }

  useEffect(() => {
    void load();
  }, [companyId]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return jobs;
    return jobs.filter((job) =>
      [job.title, job.jobRef, job.customerName, job.customerAddress, job.status]
        .join(" ")
        .toLowerCase()
        .includes(term)
    );
  }, [jobs, search]);

  async function handleCreate(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setMessage(null);

    if (!title.trim()) {
      setError("Job title is required.");
      return;
    }

    if (siteType === "fixed_site" && !storeId) {
      setError("Select a fixed site store.");
      return;
    }
    if (siteType === "customer_address" && !customerAddress.trim()) {
      setError("Customer address is required.");
      return;
    }
    if (siteType === "gps_location" && (!latitude.trim() || !longitude.trim())) {
      setError("GPS latitude and longitude are required.");
      return;
    }

    setSaving(true);
    const result = await createFieldJob(supabase, {
      companyId,
      title,
      siteType,
      storeId: siteType === "fixed_site" ? storeId : null,
      customerName: customerName.trim() || null,
      customerAddress: siteType === "customer_address" ? customerAddress.trim() : null,
      latitude: siteType === "gps_location" ? Number(latitude) : null,
      longitude: siteType === "gps_location" ? Number(longitude) : null,
      scheduledStart: scheduledStart || null,
      notes: notes.trim() || null,
      employeeId: employeeId || null,
      vehicleId: vehicleId || null,
      trailerId: trailerId || null,
      assetId: assetId || null,
      existingJobRefs: jobs.map((job) => job.jobRef),
    });
    setSaving(false);

    if (result.error) {
      setError(result.error);
      return;
    }

    setMessage(`Job ${result.job?.jobRef} created${employeeId ? " and dispatched" : ""}.`);
    setTitle("");
    setCustomerName("");
    setCustomerAddress("");
    setLatitude("");
    setLongitude("");
    setScheduledStart("");
    setNotes("");
    setEmployeeId("");
    setVehicleId("");
    setTrailerId("");
    setAssetId("");
    await load();
  }

  return (
    <div className="space-y-6">
      <section className="rounded-[2rem] border border-white/80 bg-white/95 p-6 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="text-xs font-bold uppercase tracking-[0.35em] text-cyan-700">Job Visits</div>
            <h2 className="mt-2 text-2xl font-black text-slate-950">Field job register</h2>
            <p className="mt-2 text-sm text-slate-500">
              Schedule visits to fixed sites, customer addresses, mobile assets, or GPS coordinates.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void load()}
            className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 px-4 py-2 text-sm font-black"
          >
            <RefreshCcw className="h-4 w-4" />
            Refresh
          </button>
        </div>
      </section>

      <section className="rounded-[2rem] border border-cyan-100 bg-cyan-50/40 p-6">
        <h3 className="text-lg font-black text-slate-950">Create job visit</h3>
        <form onSubmit={handleCreate} className="mt-4 grid gap-4 md:grid-cols-2">
          <label className="block text-sm font-bold text-slate-700 md:col-span-2">
            Job title
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="mt-2 w-full rounded-2xl border border-white bg-white px-4 py-3 text-sm font-semibold"
              placeholder="e.g. HVAC maintenance — Sandton"
            />
          </label>

          <label className="block text-sm font-bold text-slate-700">
            Site type
            <select
              value={siteType}
              onChange={(e) => setSiteType(e.target.value as FieldSiteType)}
              className="mt-2 w-full rounded-2xl border border-white bg-white px-4 py-3 text-sm font-black"
            >
              {FIELD_SITE_TYPES.map((type) => (
                <option key={type} value={type}>
                  {FIELD_SITE_TYPE_LABELS[type]}
                </option>
              ))}
            </select>
          </label>

          <label className="block text-sm font-bold text-slate-700">
            Assign employee
            <select
              value={employeeId}
              onChange={(e) => setEmployeeId(e.target.value)}
              className="mt-2 w-full rounded-2xl border border-white bg-white px-4 py-3 text-sm font-semibold"
            >
              <option value="">Unassigned (Pending)</option>
              {activeEmployees.map((employee) => (
                <option key={employee.id} value={employee.id}>
                  {employeeLabel(activeEmployees, employee.id)}
                </option>
              ))}
            </select>
          </label>

          <label className="block text-sm font-bold text-slate-700">
            Vehicle
            <select
              value={vehicleId}
              onChange={(e) => setVehicleId(e.target.value)}
              className="mt-2 w-full rounded-2xl border border-white bg-white px-4 py-3 text-sm font-semibold"
            >
              <option value="">No vehicle</option>
              {vehicles.map((vehicle) => (
                <option key={vehicle.id} value={vehicle.id}>
                  {vehicle.label}
                </option>
              ))}
            </select>
          </label>

          <label className="block text-sm font-bold text-slate-700">
            Trailer
            <select
              value={trailerId}
              onChange={(e) => setTrailerId(e.target.value)}
              className="mt-2 w-full rounded-2xl border border-white bg-white px-4 py-3 text-sm font-semibold"
            >
              <option value="">No trailer</option>
              {trailers.map((trailer) => (
                <option key={trailer.id} value={trailer.id}>
                  {trailer.label}
                </option>
              ))}
            </select>
          </label>

          <label className="block text-sm font-bold text-slate-700">
            Asset / equipment
            <select
              value={assetId}
              onChange={(e) => setAssetId(e.target.value)}
              className="mt-2 w-full rounded-2xl border border-white bg-white px-4 py-3 text-sm font-semibold"
            >
              <option value="">No asset</option>
              {assets.map((asset) => (
                <option key={asset.id} value={asset.id}>
                  {asset.label}
                </option>
              ))}
            </select>
          </label>

          {siteType === "fixed_site" && (
            <label className="block text-sm font-bold text-slate-700 md:col-span-2">
              Fixed site
              <select
                value={storeId}
                onChange={(e) => setStoreId(e.target.value)}
                className="mt-2 w-full rounded-2xl border border-white bg-white px-4 py-3 text-sm font-semibold"
              >
                <option value="">Select store…</option>
                {stores.map((store) => (
                  <option key={store.id} value={store.id}>
                    {store.name}
                    {store.city ? ` · ${store.city}` : ""}
                  </option>
                ))}
              </select>
            </label>
          )}

          {siteType === "customer_address" && (
            <>
              <label className="block text-sm font-bold text-slate-700">
                Customer name
                <input
                  value={customerName}
                  onChange={(e) => setCustomerName(e.target.value)}
                  className="mt-2 w-full rounded-2xl border border-white bg-white px-4 py-3 text-sm font-semibold"
                />
              </label>
              <label className="block text-sm font-bold text-slate-700">
                Customer address
                <input
                  value={customerAddress}
                  onChange={(e) => setCustomerAddress(e.target.value)}
                  className="mt-2 w-full rounded-2xl border border-white bg-white px-4 py-3 text-sm font-semibold"
                />
              </label>
            </>
          )}

          {siteType === "gps_location" && (
            <>
              <label className="block text-sm font-bold text-slate-700">
                Latitude
                <input
                  value={latitude}
                  onChange={(e) => setLatitude(e.target.value)}
                  className="mt-2 w-full rounded-2xl border border-white bg-white px-4 py-3 text-sm font-semibold"
                />
              </label>
              <label className="block text-sm font-bold text-slate-700">
                Longitude
                <input
                  value={longitude}
                  onChange={(e) => setLongitude(e.target.value)}
                  className="mt-2 w-full rounded-2xl border border-white bg-white px-4 py-3 text-sm font-semibold"
                />
              </label>
            </>
          )}

          <label className="block text-sm font-bold text-slate-700">
            Scheduled start
            <input
              type="datetime-local"
              value={scheduledStart}
              onChange={(e) => setScheduledStart(e.target.value)}
              className="mt-2 w-full rounded-2xl border border-white bg-white px-4 py-3 text-sm font-semibold"
            />
          </label>

          <label className="block text-sm font-bold text-slate-700 md:col-span-2">
            Notes
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              className="mt-2 w-full rounded-2xl border border-white bg-white px-4 py-3 text-sm font-semibold"
            />
          </label>

          <div className="md:col-span-2">
            {error && (
              <p className="mb-3 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-800">
                {error}
              </p>
            )}
            {message && (
              <p className="mb-3 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-800">
                {message}
              </p>
            )}
            <button
              type="submit"
              disabled={saving}
              className="inline-flex items-center gap-2 rounded-2xl bg-[#06101f] px-5 py-3 text-sm font-black text-cyan-300 disabled:opacity-50"
            >
              <Plus className="h-4 w-4" />
              {saving ? "Creating…" : "Create job visit"}
            </button>
          </div>
        </form>
      </section>

      <section className="rounded-[2rem] border border-white/80 bg-white/95 p-6 shadow-sm">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search jobs…"
          className="mb-4 w-full max-w-md rounded-2xl border border-slate-200 px-4 py-3 text-sm font-semibold"
        />

        {loading ? (
          <p className="text-sm font-semibold text-slate-500">Loading jobs…</p>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-6 py-12 text-center">
            <MapPin className="h-8 w-8 text-slate-400" />
            <p className="mt-3 font-black text-slate-900">No job visits yet</p>
            <p className="mt-1 text-sm text-slate-500">Create a field job to start operational tracking.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[960px] text-left text-sm">
              <thead>
                <tr className="text-xs font-black uppercase tracking-[0.2em] text-slate-500">
                  <th className="px-3 py-2">Ref</th>
                  <th className="px-3 py-2">Title</th>
                  <th className="px-3 py-2">Site</th>
                  <th className="px-3 py-2">Scheduled</th>
                  <th className="px-3 py-2">Resources</th>
                  <th className="px-3 py-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((job) => (
                  <tr key={job.id} className="border-t border-slate-100">
                    <td className="px-3 py-3 font-mono text-xs">{job.jobRef}</td>
                    <td className="px-3 py-3 font-bold text-slate-950">{job.title}</td>
                    <td className="px-3 py-3 text-slate-600">
                      {FIELD_SITE_TYPE_LABELS[job.siteType]}
                      {job.customerAddress ? ` · ${job.customerAddress}` : ""}
                    </td>
                    <td className="px-3 py-3 text-slate-600">
                      {formatFieldTimestamp(job.scheduledStart)}
                    </td>
                    <td className="px-3 py-3 text-xs text-slate-600">
                      {[
                        job.vehicleId
                          ? vehicles.find((v) => v.id === job.vehicleId)?.label
                          : null,
                        job.trailerId
                          ? trailers.find((t) => t.id === job.trailerId)?.label
                          : null,
                        job.assetId ? assets.find((a) => a.id === job.assetId)?.label : null,
                      ]
                        .filter(Boolean)
                        .join(" · ") || "—"}
                    </td>
                    <td className="px-3 py-3">
                      <span
                        className={`rounded-full px-3 py-1 text-[10px] font-black uppercase tracking-wider ${jobStatusClass(job.status)}`}
                      >
                        {job.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

"use client";

import React, { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Gauge,
  Package,
  Plus,
  RefreshCcw,
  Route,
  Truck,
  Wrench,
} from "lucide-react";
import { formatDuration } from "@/lib/field-travel-intelligence";
import {
  createAssetRegister,
  createTrailerRegister,
  createVehicleRegister,
  fetchVehicleAssetSnapshot,
  formatVehicleStatus,
  type VehicleIntelligenceDashboard,
} from "@/lib/vehicle-asset-intelligence";
import { supabase } from "@/lib/supabase";

type EmployeeRow = { id: string; first_name: string; last_name: string };

type Props = {
  companyId: string;
  employees: EmployeeRow[];
};

type TabId =
  | "dashboard"
  | "vehicles"
  | "trailers"
  | "assets"
  | "timeline"
  | "costs"
  | "risk"
  | "utilisation";

function employeeName(employees: EmployeeRow[], id: string | null) {
  if (!id) return "—";
  const row = employees.find((e) => e.id === id);
  if (!row) return "—";
  return `${row.first_name} ${row.last_name}`.trim();
}

function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

export default function VehicleAssetIntelligencePanel({ companyId, employees }: Props) {
  const [focusDate, setFocusDate] = useState(todayIsoDate);
  const [tab, setTab] = useState<TabId>("dashboard");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<VehicleIntelligenceDashboard | null>(null);

  const [vRegistration, setVRegistration] = useState("");
  const [vName, setVName] = useState("");
  const [vType, setVType] = useState("light_commercial");
  const [vDriver, setVDriver] = useState("");
  const [tNumber, setTNumber] = useState("");
  const [tVehicle, setTVehicle] = useState("");
  const [aName, setAName] = useState("");
  const [aNumber, setANumber] = useState("");
  const [aType, setAType] = useState("loader");

  async function load() {
    if (!companyId) return;
    setLoading(true);
    const snapshot = await fetchVehicleAssetSnapshot(supabase, companyId, focusDate);
    setData(snapshot);
    setLoading(false);
  }

  useEffect(() => {
    void load();
  }, [companyId, focusDate]);

  const vehicleById = useMemo(() => {
    const map = new Map<string, string>();
    (data?.vehicles || []).forEach((v) => map.set(v.id, v.vehicleName || v.registration));
    return map;
  }, [data?.vehicles]);

  async function handleCreateVehicle(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setMessage(null);
    if (!vRegistration.trim() || !vName.trim()) {
      setError("Registration and vehicle name are required.");
      return;
    }
    setSaving(true);
    const result = await createVehicleRegister(supabase, {
      companyId,
      registration: vRegistration,
      vehicleName: vName,
      vehicleType: vType,
      assignedDriverId: vDriver || null,
    });
    setSaving(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    setMessage(`Vehicle ${result.vehicle?.registration} added.`);
    setVRegistration("");
    setVName("");
    setVDriver("");
    await load();
  }

  async function handleCreateTrailer(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setMessage(null);
    if (!tNumber.trim()) {
      setError("Trailer number is required.");
      return;
    }
    setSaving(true);
    const result = await createTrailerRegister(supabase, {
      companyId,
      trailerNumber: tNumber,
      assignedVehicleId: tVehicle || null,
    });
    setSaving(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    setMessage(`Trailer ${result.trailer?.trailerNumber} added.`);
    setTNumber("");
    setTVehicle("");
    await load();
  }

  async function handleCreateAsset(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setMessage(null);
    if (!aName.trim() || !aNumber.trim()) {
      setError("Asset name and number are required.");
      return;
    }
    setSaving(true);
    const result = await createAssetRegister(supabase, {
      companyId,
      assetName: aName,
      assetNumber: aNumber,
      assetType: aType,
    });
    setSaving(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    setMessage(`Asset ${result.asset?.assetName} added.`);
    setAName("");
    setANumber("");
    await load();
  }

  const tabs: { id: TabId; label: string }[] = [
    { id: "dashboard", label: "Dashboard" },
    { id: "vehicles", label: "Vehicles" },
    { id: "trailers", label: "Trailers" },
    { id: "assets", label: "Assets" },
    { id: "timeline", label: "Timeline" },
    { id: "costs", label: "Costs" },
    { id: "risk", label: "Risk" },
    { id: "utilisation", label: "Asset Utilisation" },
  ];

  return (
    <div className="space-y-6">
      <section className="rounded-[2rem] border border-white/80 bg-white/95 p-6 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="text-xs font-bold uppercase tracking-[0.35em] text-cyan-700">
              Vehicle Intelligence
            </div>
            <h2 className="mt-2 text-2xl font-black text-slate-950">
              Vehicle &amp; Asset Intelligence
            </h2>
            <p className="mt-2 text-sm text-slate-500">
              Track fleet, trailers, and mobile assets linked to jobs, travel, costs, and risk.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <label className="text-xs font-black uppercase tracking-wider text-slate-500">
              Date
              <input
                type="date"
                value={focusDate}
                onChange={(e) => setFocusDate(e.target.value)}
                className="mt-1 block rounded-2xl border border-slate-200 px-3 py-2 text-sm font-semibold"
              />
            </label>
            <button
              type="button"
              onClick={() => void load()}
              className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 px-4 py-2 text-sm font-black"
            >
              <RefreshCcw className="h-4 w-4" />
              Refresh
            </button>
          </div>
        </div>

        {!data?.tablesAvailable && !loading && (
          <p className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-900">
            Run migration <code className="font-mono">sql/032-vehicle-asset-intelligence.sql</code> to
            enable vehicle intelligence tables.
          </p>
        )}
      </section>

      <div className="flex flex-wrap gap-2">
        {tabs.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setTab(item.id)}
            className={`rounded-full px-4 py-2 text-xs font-black uppercase tracking-wider ${
              tab === item.id
                ? "bg-[#06101f] text-cyan-300"
                : "border border-slate-200 bg-white text-slate-600"
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>

      {(error || message) && (
        <p
          className={`rounded-2xl border px-4 py-3 text-sm font-semibold ${
            error
              ? "border-rose-200 bg-rose-50 text-rose-800"
              : "border-emerald-200 bg-emerald-50 text-emerald-800"
          }`}
        >
          {error || message}
        </p>
      )}

      {tab === "dashboard" && (
        <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {[
            { label: "Active Vehicles", value: data?.activeVehicles ?? 0, icon: Truck },
            { label: "Vehicles In Use", value: data?.vehiclesInUse ?? 0, icon: Route },
            { label: "Assets In Use", value: data?.assetsInUse ?? 0, icon: Package },
            {
              label: "Distance Travelled",
              value: `${data?.distanceTravelledKm ?? 0} km`,
              icon: Gauge,
            },
            {
              label: "Vehicle Cost",
              value: `R ${(data?.vehicleCostZar ?? 0).toFixed(2)}`,
              icon: Wrench,
            },
            {
              label: "Utilisation %",
              value: `${data?.utilisationPct ?? 0}%`,
              icon: Gauge,
            },
            { label: "Maintenance Due", value: data?.maintenanceDue ?? 0, icon: AlertTriangle },
          ].map((card) => (
            <div
              key={card.label}
              className="rounded-[1.5rem] border border-cyan-100/80 bg-cyan-50/40 p-5 shadow-sm"
            >
              <card.icon className="h-5 w-5 text-cyan-800" />
              <div className="mt-4 text-3xl font-black text-slate-950">
                {loading ? "…" : card.value}
              </div>
              <div className="text-xs font-black uppercase tracking-wider text-slate-500">
                {card.label}
              </div>
            </div>
          ))}
        </section>
      )}

      {tab === "vehicles" && (
        <div className="grid gap-6 xl:grid-cols-2">
          <section className="rounded-[2rem] border border-cyan-100 bg-cyan-50/40 p-6">
            <h3 className="text-lg font-black text-slate-950">Add vehicle</h3>
            <form onSubmit={handleCreateVehicle} className="mt-4 grid gap-3">
              <input
                value={vRegistration}
                onChange={(e) => setVRegistration(e.target.value)}
                placeholder="Registration number"
                className="rounded-2xl border border-white bg-white px-4 py-3 text-sm font-semibold"
              />
              <input
                value={vName}
                onChange={(e) => setVName(e.target.value)}
                placeholder="Vehicle name"
                className="rounded-2xl border border-white bg-white px-4 py-3 text-sm font-semibold"
              />
              <select
                value={vType}
                onChange={(e) => setVType(e.target.value)}
                className="rounded-2xl border border-white bg-white px-4 py-3 text-sm font-semibold"
              >
                <option value="light_commercial">Light Commercial</option>
                <option value="bakkie">Bakkie</option>
                <option value="truck">Truck</option>
                <option value="van">Van</option>
              </select>
              <select
                value={vDriver}
                onChange={(e) => setVDriver(e.target.value)}
                className="rounded-2xl border border-white bg-white px-4 py-3 text-sm font-semibold"
              >
                <option value="">Assigned driver (optional)</option>
                {employees.map((e) => (
                  <option key={e.id} value={e.id}>
                    {employeeName(employees, e.id)}
                  </option>
                ))}
              </select>
              <button
                type="submit"
                disabled={saving}
                className="inline-flex items-center gap-2 rounded-2xl bg-[#06101f] px-4 py-3 text-sm font-black text-cyan-300"
              >
                <Plus className="h-4 w-4" />
                Add vehicle
              </button>
            </form>
          </section>

          <section className="rounded-[2rem] border border-white/80 bg-white/95 p-6 shadow-sm">
            <h3 className="text-lg font-black text-slate-950">Vehicle register</h3>
            <div className="mt-4 overflow-x-auto">
              <table className="w-full min-w-[720px] text-left text-sm">
                <thead>
                  <tr className="text-xs font-black uppercase tracking-wider text-slate-500">
                    <th className="px-2 py-2">Reg</th>
                    <th className="px-2 py-2">Name</th>
                    <th className="px-2 py-2">Type</th>
                    <th className="px-2 py-2">Driver</th>
                    <th className="px-2 py-2">Odometer</th>
                    <th className="px-2 py-2">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {(data?.vehicles || []).map((v) => (
                    <tr key={v.id} className="border-t border-slate-100">
                      <td className="px-2 py-2 font-mono text-xs">{v.registration}</td>
                      <td className="px-2 py-2 font-bold">{v.vehicleName}</td>
                      <td className="px-2 py-2">{v.vehicleType}</td>
                      <td className="px-2 py-2">{employeeName(employees, v.assignedDriverId)}</td>
                      <td className="px-2 py-2">{v.currentOdometer ?? "—"}</td>
                      <td className="px-2 py-2">{formatVehicleStatus(v.status)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      )}

      {tab === "trailers" && (
        <div className="grid gap-6 xl:grid-cols-2">
          <section className="rounded-[2rem] border border-violet-100 bg-violet-50/40 p-6">
            <h3 className="text-lg font-black text-slate-950">Add trailer</h3>
            <form onSubmit={handleCreateTrailer} className="mt-4 grid gap-3">
              <input
                value={tNumber}
                onChange={(e) => setTNumber(e.target.value)}
                placeholder="Trailer number"
                className="rounded-2xl border border-white bg-white px-4 py-3 text-sm font-semibold"
              />
              <select
                value={tVehicle}
                onChange={(e) => setTVehicle(e.target.value)}
                className="rounded-2xl border border-white bg-white px-4 py-3 text-sm font-semibold"
              >
                <option value="">Assigned vehicle (optional)</option>
                {(data?.vehicles || []).map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.registration} · {v.vehicleName}
                  </option>
                ))}
              </select>
              <button
                type="submit"
                disabled={saving}
                className="inline-flex items-center gap-2 rounded-2xl bg-[#06101f] px-4 py-3 text-sm font-black text-cyan-300"
              >
                <Plus className="h-4 w-4" />
                Add trailer
              </button>
            </form>
          </section>

          <section className="rounded-[2rem] border border-white/80 bg-white/95 p-6 shadow-sm">
            <h3 className="text-lg font-black text-slate-950">Trailer register</h3>
            <table className="mt-4 w-full text-left text-sm">
              <thead>
                <tr className="text-xs font-black uppercase tracking-wider text-slate-500">
                  <th className="px-2 py-2">Number</th>
                  <th className="px-2 py-2">Registration</th>
                  <th className="px-2 py-2">Vehicle</th>
                  <th className="px-2 py-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {(data?.trailers || []).map((t) => (
                  <tr key={t.id} className="border-t border-slate-100">
                    <td className="px-2 py-2 font-bold">{t.trailerNumber}</td>
                    <td className="px-2 py-2">{t.registration || "—"}</td>
                    <td className="px-2 py-2">
                      {t.assignedVehicleId
                        ? vehicleById.get(t.assignedVehicleId) || "—"
                        : "—"}
                    </td>
                    <td className="px-2 py-2">{t.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </div>
      )}

      {tab === "assets" && (
        <div className="grid gap-6 xl:grid-cols-2">
          <section className="rounded-[2rem] border border-amber-100 bg-amber-50/40 p-6">
            <h3 className="text-lg font-black text-slate-950">Add asset</h3>
            <form onSubmit={handleCreateAsset} className="mt-4 grid gap-3">
              <input
                value={aName}
                onChange={(e) => setAName(e.target.value)}
                placeholder="Asset name (e.g. CAT Loader)"
                className="rounded-2xl border border-white bg-white px-4 py-3 text-sm font-semibold"
              />
              <input
                value={aNumber}
                onChange={(e) => setANumber(e.target.value)}
                placeholder="Asset number"
                className="rounded-2xl border border-white bg-white px-4 py-3 text-sm font-semibold"
              />
              <select
                value={aType}
                onChange={(e) => setAType(e.target.value)}
                className="rounded-2xl border border-white bg-white px-4 py-3 text-sm font-semibold"
              >
                <option value="loader">CAT Loader</option>
                <option value="generator">Generator</option>
                <option value="compressor">Compressor</option>
                <option value="tractor">Tractor</option>
                <option value="spray_rig">Spray Rig</option>
                <option value="security_trailer">Security Trailer</option>
                <option value="mobile_workshop">Mobile Workshop</option>
              </select>
              <button
                type="submit"
                disabled={saving}
                className="inline-flex items-center gap-2 rounded-2xl bg-[#06101f] px-4 py-3 text-sm font-black text-cyan-300"
              >
                <Plus className="h-4 w-4" />
                Add asset
              </button>
            </form>
          </section>

          <section className="rounded-[2rem] border border-white/80 bg-white/95 p-6 shadow-sm">
            <h3 className="text-lg font-black text-slate-950">Asset register</h3>
            <table className="mt-4 w-full text-left text-sm">
              <thead>
                <tr className="text-xs font-black uppercase tracking-wider text-slate-500">
                  <th className="px-2 py-2">Number</th>
                  <th className="px-2 py-2">Name</th>
                  <th className="px-2 py-2">Type</th>
                  <th className="px-2 py-2">Site</th>
                  <th className="px-2 py-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {(data?.assets || []).map((a) => (
                  <tr key={a.id} className="border-t border-slate-100">
                    <td className="px-2 py-2 font-mono text-xs">{a.assetNumber}</td>
                    <td className="px-2 py-2 font-bold">{a.assetName}</td>
                    <td className="px-2 py-2">{a.assetType}</td>
                    <td className="px-2 py-2">{a.currentSite || "—"}</td>
                    <td className="px-2 py-2">{a.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </div>
      )}

      {tab === "timeline" && (
        <section className="rounded-[2rem] border border-white/80 bg-white/95 p-6 shadow-sm">
          <h3 className="text-lg font-black text-slate-950">Vehicle timeline — {focusDate}</h3>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[1100px] text-left text-sm">
              <thead>
                <tr className="text-xs font-black uppercase tracking-wider text-slate-500">
                  <th className="px-2 py-2">Vehicle</th>
                  <th className="px-2 py-2">Driver</th>
                  <th className="px-2 py-2">Start Day</th>
                  <th className="px-2 py-2">Travel</th>
                  <th className="px-2 py-2">Arrive</th>
                  <th className="px-2 py-2">Leave</th>
                  <th className="px-2 py-2">End Day</th>
                  <th className="px-2 py-2">Distance</th>
                  <th className="px-2 py-2">Travel Time</th>
                  <th className="px-2 py-2">Jobs</th>
                </tr>
              </thead>
              <tbody>
                {(data?.timelines || []).map((row) => (
                  <tr key={row.vehicleId} className="border-t border-slate-100">
                    <td className="px-2 py-2 font-bold">
                      {vehicleById.get(row.vehicleId) || row.vehicleId}
                    </td>
                    <td className="px-2 py-2">{employeeName(employees, row.driverId)}</td>
                    <td className="px-2 py-2 text-xs">{row.startDay?.slice(11, 16) || "—"}</td>
                    <td className="px-2 py-2 text-xs">{row.travelStart?.slice(11, 16) || "—"}</td>
                    <td className="px-2 py-2 text-xs">{row.arriveSite?.slice(11, 16) || "—"}</td>
                    <td className="px-2 py-2 text-xs">{row.leaveSite?.slice(11, 16) || "—"}</td>
                    <td className="px-2 py-2 text-xs">{row.endDay?.slice(11, 16) || "—"}</td>
                    <td className="px-2 py-2">{row.distanceKm} km</td>
                    <td className="px-2 py-2">{formatDuration(row.travelSeconds)}</td>
                    <td className="px-2 py-2">{row.jobsCompleted}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {tab === "costs" && (
        <section className="rounded-[2rem] border border-white/80 bg-white/95 p-6 shadow-sm">
          <h3 className="text-lg font-black text-slate-950">Vehicle cost intelligence</h3>
          <table className="mt-4 w-full text-left text-sm">
            <thead>
              <tr className="text-xs font-black uppercase tracking-wider text-slate-500">
                <th className="px-2 py-2">Vehicle</th>
                <th className="px-2 py-2">Distance</th>
                <th className="px-2 py-2">Travel Cost</th>
                <th className="px-2 py-2">Job Cost</th>
                <th className="px-2 py-2">Cost / KM</th>
                <th className="px-2 py-2">Utilisation</th>
              </tr>
            </thead>
            <tbody>
              {(data?.costs || []).map((row) => (
                <tr key={row.vehicleId} className="border-t border-slate-100">
                  <td className="px-2 py-2 font-bold">
                    {vehicleById.get(row.vehicleId) || row.vehicleId}
                  </td>
                  <td className="px-2 py-2">{row.distanceKm} km</td>
                  <td className="px-2 py-2">R {row.travelCost.toFixed(2)}</td>
                  <td className="px-2 py-2">R {row.jobCost.toFixed(2)}</td>
                  <td className="px-2 py-2">R {row.costPerKm.toFixed(2)}</td>
                  <td className="px-2 py-2">{row.utilisationPct}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {tab === "risk" && (
        <section className="rounded-[2rem] border border-white/80 bg-white/95 p-6 shadow-sm">
          <h3 className="text-lg font-black text-slate-950">Vehicle risk engine</h3>
          <div className="mt-4 space-y-3">
            {(data?.risks || []).length === 0 ? (
              <p className="text-sm text-slate-500">No active vehicle risk events.</p>
            ) : (
              (data?.risks || []).map((risk) => (
                <div
                  key={risk.id}
                  className={`rounded-2xl border px-4 py-3 text-sm ${
                    risk.severity === "critical"
                      ? "border-rose-200 bg-rose-50 text-rose-900"
                      : risk.severity === "warning"
                        ? "border-amber-200 bg-amber-50 text-amber-900"
                        : "border-slate-200 bg-slate-50 text-slate-800"
                  }`}
                >
                  <div className="font-black uppercase tracking-wider text-[10px]">
                    {risk.riskType.replaceAll("_", " ")} · {risk.severity}
                  </div>
                  <div className="mt-1 font-semibold">{risk.message}</div>
                </div>
              ))
            )}
          </div>
        </section>
      )}

      {tab === "utilisation" && (
        <section className="rounded-[2rem] border border-white/80 bg-white/95 p-6 shadow-sm">
          <h3 className="text-lg font-black text-slate-950">Asset utilisation</h3>
          <table className="mt-4 w-full text-left text-sm">
            <thead>
              <tr className="text-xs font-black uppercase tracking-wider text-slate-500">
                <th className="px-2 py-2">Asset</th>
                <th className="px-2 py-2">Hours Used</th>
                <th className="px-2 py-2">Jobs</th>
                <th className="px-2 py-2">Idle Days</th>
                <th className="px-2 py-2">Revenue</th>
                <th className="px-2 py-2">Cost</th>
              </tr>
            </thead>
            <tbody>
              {(data?.assetUtilisation || []).map((row) => {
                const asset = (data?.assets || []).find((a) => a.id === row.assetId);
                return (
                  <tr key={row.assetId} className="border-t border-slate-100">
                    <td className="px-2 py-2 font-bold">{asset?.assetName || row.assetId}</td>
                    <td className="px-2 py-2">{row.hoursUsed}h</td>
                    <td className="px-2 py-2">{row.jobsCount}</td>
                    <td className="px-2 py-2">{row.idleDays}</td>
                    <td className="px-2 py-2">R {row.revenueZar.toFixed(2)}</td>
                    <td className="px-2 py-2">R {row.costZar.toFixed(2)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      )}
    </div>
  );
}

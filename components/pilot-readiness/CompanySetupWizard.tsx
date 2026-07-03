"use client";

import React, { useEffect, useState } from "react";
import { Building2, MapPin, Plus } from "lucide-react";
import { supabase } from "@/lib/supabase";

type StoreRow = { id: string; name: string };

type Props = {
  companyId: string;
  companyName: string;
  stores: StoreRow[];
  onRefresh: () => void;
};

export default function CompanySetupWizard({
  companyId,
  companyName,
  stores,
  onRefresh,
}: Props) {
  const [name, setName] = useState(companyName);
  const [contactPerson, setContactPerson] = useState("");
  const [phone, setPhone] = useState("");
  const [storeName, setStoreName] = useState("");
  const [storeCity, setStoreCity] = useState("");
  const [storeRegion, setStoreRegion] = useState("Gauteng");
  const [savingProfile, setSavingProfile] = useState(false);
  const [savingStore, setSavingStore] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setName(companyName);
  }, [companyName]);

  useEffect(() => {
    if (!companyId) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("companies")
        .select("name,contact_person,phone")
        .eq("id", companyId)
        .maybeSingle();
      if (cancelled || !data) return;
      setName((data.name || companyName || "").trim());
      setContactPerson(data.contact_person || "");
      setPhone(data.phone || "");
    })();
    return () => {
      cancelled = true;
    };
  }, [companyId, companyName]);

  async function saveProfile() {
    if (!companyId) return;
    setSavingProfile(true);
    setError(null);
    setMessage(null);
    const { error: saveErr } = await supabase
      .from("companies")
      .update({
        name: name.trim() || null,
        contact_person: contactPerson.trim() || null,
        phone: phone.trim() || null,
      })
      .eq("id", companyId);
    setSavingProfile(false);
    if (saveErr) {
      setError(saveErr.message);
      return;
    }
    setMessage("Company profile saved.");
    onRefresh();
  }

  async function addStore() {
    if (!companyId || !storeName.trim()) return;
    setSavingStore(true);
    setError(null);
    setMessage(null);
    const { error: saveErr } = await supabase.from("stores").insert({
      company_id: companyId,
      name: storeName.trim(),
      city: storeCity.trim() || null,
      region: storeRegion.trim() || null,
      status: "active",
      opening_time: "08:00",
      closing_time: "17:00",
      gps_radius_meters: 150,
    });
    setSavingStore(false);
    if (saveErr) {
      setError(saveErr.message);
      return;
    }
    setStoreName("");
    setMessage(`Store "${storeName.trim()}" added.`);
    onRefresh();
  }

  return (
    <div className="space-y-6">
      <section className="rounded-[1.5rem] border border-white/80 bg-white p-6 shadow-sm">
        <div className="flex items-center gap-2 text-xs font-black uppercase tracking-[0.35em] text-cyan-700">
          <Building2 className="h-4 w-4" />
          Step 1 — Company profile (~5 min)
        </div>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <label className="block text-sm font-bold text-slate-700">
            Company name
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="mt-1 w-full rounded-xl border border-slate-200 px-4 py-3 font-normal"
              placeholder="Legal entity name"
            />
          </label>
          <label className="block text-sm font-bold text-slate-700">
            Contact person
            <input
              value={contactPerson}
              onChange={(e) => setContactPerson(e.target.value)}
              className="mt-1 w-full rounded-xl border border-slate-200 px-4 py-3 font-normal"
              placeholder="Primary administrator"
            />
          </label>
          <label className="block text-sm font-bold text-slate-700 md:col-span-2">
            Phone
            <input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              className="mt-1 w-full rounded-xl border border-slate-200 px-4 py-3 font-normal"
              placeholder="082 000 0000"
            />
          </label>
        </div>
        <button
          type="button"
          onClick={saveProfile}
          disabled={savingProfile || !companyId}
          className="mt-4 rounded-2xl bg-[#06101f] px-5 py-3 text-sm font-black text-cyan-300 disabled:opacity-60"
        >
          {savingProfile ? "Saving…" : "Save company profile"}
        </button>
      </section>

      <section className="rounded-[1.5rem] border border-white/80 bg-white p-6 shadow-sm">
        <div className="flex items-center gap-2 text-xs font-black uppercase tracking-[0.35em] text-cyan-700">
          <MapPin className="h-4 w-4" />
          Step 2 — First store / site (~5 min)
        </div>
        <p className="mt-2 text-sm text-slate-500">
          {stores.length > 0
            ? `${stores.length} store(s) configured: ${stores.map((s) => s.name).join(", ")}`
            : "Add at least one site for clocking, rosters, and payroll."}
        </p>
        <div className="mt-4 grid gap-4 md:grid-cols-3">
          <label className="block text-sm font-bold text-slate-700 md:col-span-2">
            Store name
            <input
              value={storeName}
              onChange={(e) => setStoreName(e.target.value)}
              className="mt-1 w-full rounded-xl border border-slate-200 px-4 py-3 font-normal"
              placeholder="Main branch"
            />
          </label>
          <label className="block text-sm font-bold text-slate-700">
            City
            <input
              value={storeCity}
              onChange={(e) => setStoreCity(e.target.value)}
              className="mt-1 w-full rounded-xl border border-slate-200 px-4 py-3 font-normal"
              placeholder="Johannesburg"
            />
          </label>
          <label className="block text-sm font-bold text-slate-700 md:col-span-3">
            Province / region
            <input
              value={storeRegion}
              onChange={(e) => setStoreRegion(e.target.value)}
              className="mt-1 w-full rounded-xl border border-slate-200 px-4 py-3 font-normal"
            />
          </label>
        </div>
        <button
          type="button"
          onClick={addStore}
          disabled={savingStore || !storeName.trim()}
          className="mt-4 flex items-center gap-2 rounded-2xl bg-[#06101f] px-5 py-3 text-sm font-black text-cyan-300 disabled:opacity-60"
        >
          <Plus className="h-4 w-4" />
          {savingStore ? "Adding…" : "Add store"}
        </button>
      </section>

      {message && <p className="text-sm font-bold text-emerald-700">{message}</p>}
      {error && <p className="text-sm font-bold text-rose-700">{error}</p>}
    </div>
  );
}

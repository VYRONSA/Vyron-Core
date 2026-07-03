"use client";

import React, { useEffect, useState } from "react";
import { ExternalLink, Plus, RefreshCcw, Star, Users } from "lucide-react";
import Link from "next/link";
import {
  createClientPortalUser,
  fetchClientPortalClients,
  loadClientPortalHub,
  type ClientPortalHub,
} from "@/lib/client-portal-platform";
import { supabase } from "@/lib/supabase";

type Props = {
  companyId: string;
  employees: { id: string; first_name: string; last_name: string }[];
};

export default function ClientPortalAdminPanel({ companyId, employees }: Props) {
  const [clients, setClients] = useState<{ id: string; clientName: string }[]>([]);
  const [selectedClientId, setSelectedClientId] = useState("");
  const [hub, setHub] = useState<ClientPortalHub | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [portalEmail, setPortalEmail] = useState("");
  const [portalName, setPortalName] = useState("");

  async function loadClients() {
    if (!companyId) return;
    setLoading(true);
    const list = await fetchClientPortalClients(supabase, companyId);
    setClients(list);
    if (!selectedClientId && list[0]) setSelectedClientId(list[0].id);
    setLoading(false);
  }

  async function loadHub() {
    if (!companyId || !selectedClientId) return;
    const data = await loadClientPortalHub(supabase, companyId, selectedClientId, null, employees);
    setHub(data);
  }

  useEffect(() => {
    void loadClients();
  }, [companyId]);

  useEffect(() => {
    if (selectedClientId) void loadHub();
  }, [selectedClientId, companyId]);

  async function handleCreateUser(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setMessage(null);
    if (!selectedClientId || !portalEmail.trim() || !portalName.trim()) {
      setError("Client, email, and contact name are required.");
      return;
    }
    setSaving(true);
    const result = await createClientPortalUser(supabase, {
      companyId,
      clientId: selectedClientId,
      email: portalEmail,
      contactName: portalName,
    });
    setSaving(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    setMessage(`Portal user ${result.user?.email} created.`);
    setPortalEmail("");
    setPortalName("");
  }

  return (
    <div className="space-y-6">
      <section className="rounded-[2rem] border border-white/80 bg-white/95 p-6 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="text-xs font-bold uppercase tracking-[0.35em] text-violet-700">
              Client Portal Admin
            </div>
            <h2 className="mt-2 text-2xl font-black text-slate-950">
              Customer experience &amp; satisfaction
            </h2>
            <p className="mt-2 text-sm text-slate-500">
              Provision portal users, monitor CSAT, and preview the customer-facing experience.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => {
                void loadClients();
                void loadHub();
              }}
              className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 px-4 py-2 text-sm font-black"
            >
              <RefreshCcw className="h-4 w-4" />
              Refresh
            </button>
            <Link
              href="/client-portal"
              className="inline-flex items-center gap-2 rounded-2xl bg-[#06101f] px-4 py-2 text-sm font-black text-violet-300"
            >
              <ExternalLink className="h-4 w-4" />
              Open client portal
            </Link>
          </div>
        </div>
      </section>

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[
          { label: "Portal clients", value: clients.length, icon: Users },
          { label: "Open requests", value: hub?.requests.filter((r) => r.status === "open").length ?? 0, icon: Users },
          {
            label: "Avg satisfaction",
            value: hub?.satisfaction.averageRating ? `${hub.satisfaction.averageRating}/5` : "—",
            icon: Star,
          },
          { label: "Active jobs", value: hub?.jobs.filter((j) => j.status !== "Completed").length ?? 0, icon: Users },
        ].map((card) => (
          <div
            key={card.label}
            className="rounded-[1.5rem] border border-violet-100/80 bg-violet-50/40 p-5 shadow-sm"
          >
            <card.icon className="h-5 w-5 text-violet-800" />
            <div className="mt-4 text-3xl font-black text-slate-950">
              {loading ? "…" : card.value}
            </div>
            <div className="text-xs font-black uppercase tracking-wider text-slate-500">
              {card.label}
            </div>
          </div>
        ))}
      </section>

      <section className="grid gap-6 xl:grid-cols-2">
        <div className="rounded-[2rem] border border-violet-100 bg-violet-50/40 p-6">
          <label className="block text-sm font-bold text-slate-700">
            Billing client
            <select
              value={selectedClientId}
              onChange={(e) => setSelectedClientId(e.target.value)}
              className="mt-2 w-full rounded-2xl border border-white bg-white px-4 py-3 text-sm font-semibold"
            >
              <option value="">Select client…</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.clientName}
                </option>
              ))}
            </select>
          </label>

          <h3 className="mt-6 text-lg font-black text-slate-950">Add portal user</h3>
          <form onSubmit={handleCreateUser} className="mt-4 grid gap-3">
            <input
              value={portalEmail}
              onChange={(e) => setPortalEmail(e.target.value)}
              placeholder="Client email"
              type="email"
              className="rounded-2xl border border-white bg-white px-4 py-3 text-sm font-semibold"
            />
            <input
              value={portalName}
              onChange={(e) => setPortalName(e.target.value)}
              placeholder="Contact name"
              className="rounded-2xl border border-white bg-white px-4 py-3 text-sm font-semibold"
            />
            <button
              type="submit"
              disabled={saving || !selectedClientId}
              className="inline-flex items-center gap-2 rounded-2xl bg-[#06101f] px-4 py-3 text-sm font-black text-violet-300 disabled:opacity-50"
            >
              <Plus className="h-4 w-4" />
              Create portal user
            </button>
          </form>
        </div>

        <div className="rounded-[2rem] border border-white/80 bg-white/95 p-6 shadow-sm">
          <h3 className="text-lg font-black text-slate-950">Client satisfaction</h3>
          <p className="mt-2 text-sm text-slate-600">
            {hub?.satisfaction.npsLabel || "No ratings"} — {hub?.satisfaction.totalRatings ?? 0}{" "}
            ratings for {hub?.clientName || "selected client"}
          </p>
          <div className="mt-4 space-y-2">
            {(hub?.satisfaction.recentRatings || []).slice(0, 5).map((r, idx) => (
              <div key={idx} className="rounded-xl border border-slate-100 px-3 py-2 text-sm">
                <span className="font-black text-amber-700">{r.rating}/5</span>
                {r.feedback && <span className="ml-2 text-slate-600">{r.feedback}</span>}
              </div>
            ))}
          </div>
        </div>
      </section>

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
    </div>
  );
}

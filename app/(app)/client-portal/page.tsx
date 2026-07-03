"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import ClientPortalHub from "@/components/client-portal/ClientPortalHub";
import { getCompanyAccess, isVyronMasterOperator } from "@/lib/company-access";
import {
  fetchClientPortalClients,
  resolveClientPortalUser,
} from "@/lib/client-portal-platform";
import { supabase } from "@/lib/supabase";

export default function ClientPortalPage() {
  const [companyId, setCompanyId] = useState("");
  const [clientId, setClientId] = useState("");
  const [portalUserId, setPortalUserId] = useState<string | null>(null);
  const [contactName, setContactName] = useState("");
  const [clients, setClients] = useState<{ id: string; clientName: string }[]>([]);
  const [isTenantPreview, setIsTenantPreview] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      const { data: authData } = await supabase.auth.getUser();
      const email = authData?.user?.email?.trim().toLowerCase() || "";

      const portal = await resolveClientPortalUser(supabase, email);
      if (cancelled) return;

      if (portal.user) {
        setCompanyId(portal.user.companyId);
        setClientId(portal.user.clientId);
        setPortalUserId(portal.user.id);
        setContactName(portal.user.contactName);
        setLoading(false);
        return;
      }

      const { access, error: accessError } = await getCompanyAccess(supabase);
      if (cancelled) return;

      const isMaster = isVyronMasterOperator("", email);
      const tenantCompanyId = access?.company_id || "";

      if (!tenantCompanyId && !isMaster) {
        setError(
          portal.error ||
            accessError ||
            "Sign in with a portal user email or tenant account to access the client portal."
        );
        setLoading(false);
        return;
      }

      if (tenantCompanyId) {
        setIsTenantPreview(true);
        setCompanyId(tenantCompanyId);
        const list = await fetchClientPortalClients(supabase, tenantCompanyId);
        if (cancelled) return;
        setClients(list);
        if (list[0]) {
          setClientId(list[0].id);
          setContactName(`${list[0].clientName} (preview)`);
        }
      }

      setLoading(false);
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <main className="min-h-screen bg-[#f6f8fb] p-4 text-slate-950">
      <div className="mx-auto max-w-5xl space-y-4">
        <Link
          href="/"
          className="inline-flex items-center gap-2 text-sm font-bold text-violet-800 hover:text-violet-950"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to VYRON CORE
        </Link>

        {loading ? (
          <p className="text-sm font-semibold text-slate-500">Loading client portal…</p>
        ) : error ? (
          <p className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-800">
            {error}
          </p>
        ) : !clientId ? (
          <p className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-900">
            No billing clients found. Add clients in Profitability Intelligence first, then create
            portal users.
          </p>
        ) : (
          <>
            {isTenantPreview && clients.length > 1 && (
              <label className="block text-sm font-bold text-slate-700">
                Preview as client
                <select
                  value={clientId}
                  onChange={(e) => {
                    const next = clients.find((c) => c.id === e.target.value);
                    setClientId(e.target.value);
                    if (next) setContactName(`${next.clientName} (preview)`);
                  }}
                  className="mt-2 w-full max-w-md rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold"
                >
                  {clients.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.clientName}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <ClientPortalHub
              companyId={companyId}
              clientId={clientId}
              portalUserId={portalUserId}
              contactName={contactName}
            />
          </>
        )}
      </div>
    </main>
  );
}

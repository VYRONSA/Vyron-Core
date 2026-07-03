"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import WorkforceDigitalTwinPanel from "@/components/field-ops/WorkforceDigitalTwinPanel";
import { getCompanyAccess } from "@/lib/company-access";
import { supabase } from "@/lib/supabase";

export default function WorkforceDigitalTwinPage() {
  const [companyId, setCompanyId] = useState("");
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      const { data: sessionData } = await supabase.auth.getSession();
      const { access, error: accessError } = await getCompanyAccess(supabase);
      if (cancelled) return;

      if (accessError || !access?.company_id) {
        setError(accessError || "No company access.");
        setLoading(false);
        return;
      }

      setCompanyId(access.company_id);
      setUserEmail(sessionData.session?.user?.email || null);
      setLoading(false);
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <main className="min-h-screen bg-[#f6f8fb] p-4 text-slate-950 md:p-8">
      <section className="mx-auto max-w-6xl space-y-6">
        <Link
          href="/"
          className="inline-flex items-center gap-2 text-sm font-bold text-cyan-800 hover:text-cyan-950"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to VYRON CORE
        </Link>

        {loading ? (
          <p className="text-sm font-semibold text-slate-500">Loading Workforce Digital Twin…</p>
        ) : error ? (
          <p className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-800">
            {error}
          </p>
        ) : (
          <WorkforceDigitalTwinPanel companyId={companyId} userEmail={userEmail} />
        )}
      </section>
    </main>
  );
}

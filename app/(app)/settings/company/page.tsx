"use client";

/**
 * Settings → Company Master.
 *
 * The company is resolved from vyron_company_directory_ids() - the shared VYRON
 * company directory - and never from a position in a list. An account may hold
 * access to several companies through different modules, so where more than one
 * is visible the person chooses; taking companies[0] is how a populated company
 * ends up looking like somebody else's.
 *
 * The id chosen here is only a request. Every read and write re-resolves the
 * caller from auth.uid() inside the sql/098 functions, so naming a company you
 * do not hold gets you the same answer as naming one that does not exist.
 */

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { Building2, ChevronLeft, Loader2 } from "lucide-react";
import CompanyMasterPanel from "@/components/settings/CompanyMasterPanel";
import { getCompanyMaster, listVisibleCompanyIds } from "@/lib/company-master";

type Choice = { id: string; name: string };

export default function CompanyMasterSettingsPage() {
  const [choices, setChoices] = useState<Choice[]>([]);
  const [selected, setSelected] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  /* Loaded inside the effect so every state write follows an await. */
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const ids = await listVisibleCompanyIds();
        const named = await Promise.all(
          ids.map(async (id) => {
            try {
              const c = await getCompanyMaster(id);
              return { id, name: c.name ?? `Company ${id.slice(0, 8)}` };
            } catch {
              /* Visible in the directory but unreadable: reported as itself
                 rather than dropped, so the discrepancy stays noticeable. */
              return { id, name: `Company ${id.slice(0, 8)}` };
            }
          }),
        );
        if (cancelled) return;
        named.sort((a, b) => a.name.localeCompare(b.name));
        setChoices(named);
        /* One visible company is selected for the person. That is not
           "assume the first" - it is "there is only one". */
        if (named.length === 1) setSelected(named[0].id);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  return (
    <main className="vyron-shell p-6 md:p-8">
      <div className="mx-auto max-w-[1100px] space-y-6">
        <Link
          href="/dashboard"
          className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-4 py-2 text-xs font-black uppercase tracking-wide text-white transition hover:bg-white/20"
        >
          <ChevronLeft className="h-3.5 w-3.5" /> Back to Command Centre
        </Link>

        {loading && (
          <div className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.04] p-6 text-sm text-white/70">
            <Loader2 className="h-4 w-4 animate-spin" /> Finding the companies you can administer…
          </div>
        )}

        {!loading && error && (
          <div className="rounded-2xl border border-red-400/30 bg-red-400/10 p-6 text-sm text-red-100">
            Company details could not be loaded. {error}
          </div>
        )}

        {!loading && !error && choices.length === 0 && (
          <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-6">
            <div className="flex items-start gap-3">
              <Building2 className="mt-0.5 h-5 w-5 shrink-0 text-white/40" />
              <div>
                <h1 className="text-base font-black text-white">No company is visible to you</h1>
                <p className="mt-2 max-w-2xl text-sm leading-relaxed text-white/70">
                  Your account is signed in but holds no company access in any VYRON module. A
                  company administrator or the platform operator can grant it.
                </p>
              </div>
            </div>
          </div>
        )}

        {!loading && !error && choices.length > 1 && (
          <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-5">
            <label className="block">
              <span className="mb-2 block text-[11px] font-bold uppercase tracking-wide text-white/50">
                Company
              </span>
              <select
                value={selected}
                onChange={(e) => setSelected(e.target.value)}
                className="w-full max-w-md rounded-lg border border-white/15 bg-slate-900 px-3 py-2 text-sm text-white focus:border-white/40 focus:outline-none"
              >
                <option value="">Choose a company…</option>
                {choices.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </label>
            <p className="mt-2 text-[11px] text-white/35">
              You hold access to {choices.length} companies. Records never move between them.
            </p>
          </div>
        )}

        {!loading && !error && selected && <CompanyMasterPanel companyId={selected} />}
      </div>
    </main>
  );
}

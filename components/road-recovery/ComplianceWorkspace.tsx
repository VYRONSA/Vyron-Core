"use client";

/**
 * Compliance workspace (Phase 3).
 *
 * Brings the three job-level views together — requirements, verdict, evidence — behind a
 * job picker. Deliberately a NEW screen: the Dispatch Board, BYSTAND Board and Live
 * Operations Wall are operational views and are left exactly as they are.
 */

import { RREmptyState, RRLaneEmpty, RRLoading } from "@/components/road-recovery/ui";
import React, { useCallback, useMemo, useState } from "react";
import CustodyChainPanel from "@/components/road-recovery/CustodyChainPanel";
import EvidenceTimeline from "@/components/road-recovery/EvidenceTimeline";
import ReleaseAuthorityPanel from "@/components/road-recovery/ReleaseAuthorityPanel";
import StorageReleasePanel from "@/components/road-recovery/StorageReleasePanel";
import JobCompliancePanel from "@/components/road-recovery/JobCompliancePanel";
import RequirementsChecklist from "@/components/road-recovery/RequirementsChecklist";
import { RR_POLL_INTERVALS, rrFetchJson, useRrPoll } from "@/lib/road-recovery/use-rr-poll";

type JobRow = {
  id: string;
  service_state: string;
  workflow_key: string;
  origin_label: string | null;
  vehicle_registration: string | null;
  vehicle_make: string | null;
  vehicle_model: string | null;
  created_at: string;
};

type TabKey = "requirements" | "compliance" | "evidence" | "custody" | "storage" | "authority";

const TABS: { key: TabKey; label: string }[] = [
  { key: "requirements", label: "Requirements" },
  { key: "compliance", label: "Compliance" },
  { key: "evidence", label: "Evidence timeline" },
  // Phase 4. Custody and storage are separate tabs because they answer separate
  // questions: who possesses the vehicle, and what it is costing to keep it.
  { key: "custody", label: "Custody" },
  { key: "storage", label: "Storage & release" },
  { key: "authority", label: "Authority" },
];

export default function ComplianceWorkspace({ companyId }: { companyId: string }) {
  const [selectedJobId, setSelectedJobId] = useState<string>("");
  const [tab, setTab] = useState<TabKey>("requirements");
  const [search, setSearch] = useState("");

  const fetcher = useCallback(
    () =>
      rrFetchJson<{ jobs: JobRow[] }>(
        `/api/road-recovery/jobs?companyId=${encodeURIComponent(companyId)}&limit=200`
      ),
    [companyId]
  );

  const poll = useRrPoll<{ jobs: JobRow[] }>(fetcher, RR_POLL_INTERVALS.liveOperations, {
    enabled: Boolean(companyId),
  });

  const jobs = useMemo(() => {
    const all = poll.data?.jobs ?? [];
    const needle = search.trim().toLowerCase();
    if (!needle) return all;
    return all.filter((job) =>
      [job.vehicle_registration, job.origin_label, job.service_state, job.workflow_key]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(needle))
    );
  }, [poll.data, search]);

  const selected = jobs.find((job) => job.id === selectedJobId) ?? null;

  return (
    <div className="grid gap-4 lg:grid-cols-[340px_1fr]">
      <aside className="space-y-2">
        <input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search registration, origin, state…"
          className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm font-semibold"
        />
        {poll.initialLoading ? (
          <RRLoading label="Loading jobs" />
        ) : poll.error ? (
          <p role="alert" className="rounded-[22px] border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-900">
            {poll.error}
          </p>
        ) : jobs.length === 0 ? (
          <p className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-600">
            No jobs match.
          </p>
        ) : (
          <ul className="space-y-2">
            {jobs.map((job) => (
              <li key={job.id}>
                <button
                  type="button"
                  onClick={() => setSelectedJobId(job.id)}
                  className={`w-full rounded-2xl border p-3 text-left ${
                    selectedJobId === job.id
                      ? "border-slate-900 bg-slate-900 text-cyan-200"
                      : "border-slate-200 bg-white text-slate-800 hover:bg-slate-50"
                  }`}
                >
                  <p className="text-sm font-black">
                    {job.vehicle_registration || "Unregistered vehicle"}
                  </p>
                  <p className="text-xs font-semibold opacity-80">
                    {job.workflow_key.replace(/_/g, " ")} · {job.service_state.replace(/_/g, " ")}
                  </p>
                  <p className="text-xs font-semibold opacity-60">
                    {job.origin_label || "No origin recorded"}
                  </p>
                </button>
              </li>
            ))}
          </ul>
        )}
      </aside>

      <section className="space-y-4">
        {!selected ? (
          <div className="rounded-2xl border border-slate-200 bg-white p-6">
            <p className="text-sm font-semibold text-slate-600">
              Select a job to review what it must produce, whether it complies, and what has
              been captured.
            </p>
          </div>
        ) : (
          <>
            <header className="rounded-2xl border border-slate-200 bg-white p-4">
              <h2 className="text-lg font-black text-slate-900">
                {selected.vehicle_registration || "Unregistered vehicle"}
                <span className="ml-2 text-sm font-bold text-slate-500">
                  {[selected.vehicle_make, selected.vehicle_model].filter(Boolean).join(" ")}
                </span>
              </h2>
              <p className="text-sm font-semibold text-slate-500">
                {selected.workflow_key.replace(/_/g, " ")} ·{" "}
                {selected.service_state.replace(/_/g, " ")}
              </p>
              <nav className="mt-3 flex flex-wrap gap-2">
                {TABS.map((entry) => (
                  <button
                    key={entry.key}
                    type="button"
                    onClick={() => setTab(entry.key)}
                    className={`rounded-xl px-3 py-1.5 text-xs font-bold ${
                      tab === entry.key
                        ? "bg-slate-900 text-cyan-300"
                        : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                    }`}
                  >
                    {entry.label}
                  </button>
                ))}
              </nav>
            </header>

            {tab === "requirements" ? (
              <RequirementsChecklist companyId={companyId} serviceJobId={selected.id} />
            ) : null}
            {tab === "compliance" ? (
              <JobCompliancePanel companyId={companyId} serviceJobId={selected.id} />
            ) : null}
            {tab === "evidence" ? (
              <EvidenceTimeline companyId={companyId} serviceJobId={selected.id} />
            ) : null}
            {tab === "custody" ? (
              <CustodyChainPanel companyId={companyId} serviceJobId={selected.id} />
            ) : null}
            {tab === "storage" ? (
              <StorageReleasePanel companyId={companyId} serviceJobId={selected.id} />
            ) : null}
            {tab === "authority" ? (
              <ReleaseAuthorityPanel companyId={companyId} serviceJobId={selected.id} />
            ) : null}
          </>
        )}
      </section>
    </div>
  );
}

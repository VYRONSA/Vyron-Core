"use client";

/**
 * Evidence Timeline (Phase 3).
 *
 * Everything captured for a job, in the order it was captured, with the requirements each
 * item satisfies. One evidence item may appear against several requirements — that is the
 * point of linking semantics to the LINK rather than to the evidence row.
 */

import { RREmptyState, RRLaneEmpty, RRLoading } from "@/components/road-recovery/ui";
import React, { useCallback, useMemo } from "react";
import { RR_POLL_INTERVALS, rrFetchJson, useRrPoll } from "@/lib/road-recovery/use-rr-poll";

type EvidenceLink = {
  id: string;
  evidence_id: string;
  requirement_code: string;
  verification_status: string;
  rejected_reason: string | null;
  verified_by: string | null;
  verified_at: string | null;
  linked_by: string | null;
  created_at: string;
};

type TimelineEntry = {
  evidenceId: string;
  capturedAt: string | null;
  linkedAt: string;
  linkedBy: string | null;
  requirements: { code: string; status: string; rejectionReason: string | null }[];
};

const STATUS_CHIP: Record<string, string> = {
  accepted: "bg-emerald-100 text-emerald-800",
  pending: "bg-slate-100 text-slate-700",
  rejected: "bg-rose-100 text-rose-800",
};

export default function EvidenceTimeline({
  companyId,
  serviceJobId,
}: {
  companyId: string;
  serviceJobId: string;
}) {
  const fetcher = useCallback(
    () =>
      rrFetchJson<{ links: EvidenceLink[] }>(
        `/api/road-recovery/jobs/${serviceJobId}/evidence-links?companyId=${encodeURIComponent(companyId)}`
      ),
    [companyId, serviceJobId]
  );

  const poll = useRrPoll<{ links: EvidenceLink[] }>(fetcher, RR_POLL_INTERVALS.liveOperations, {
    enabled: Boolean(companyId && serviceJobId),
    key: serviceJobId,
  });

  // Group by evidence item: one capture, possibly many requirements.
  const timeline = useMemo<TimelineEntry[]>(() => {
    const links = poll.data?.links ?? [];
    const byEvidence = new Map<string, TimelineEntry>();

    for (const link of links) {
      const existing = byEvidence.get(link.evidence_id);
      const requirement = {
        code: link.requirement_code,
        status: link.verification_status,
        rejectionReason: link.rejected_reason,
      };
      if (existing) {
        existing.requirements.push(requirement);
        continue;
      }
      byEvidence.set(link.evidence_id, {
        evidenceId: link.evidence_id,
        capturedAt: link.created_at,
        linkedAt: link.created_at,
        linkedBy: link.linked_by,
        requirements: [requirement],
      });
    }

    return Array.from(byEvidence.values()).sort((a, b) => {
      const left = new Date(a.capturedAt || a.linkedAt).getTime();
      const right = new Date(b.capturedAt || b.linkedAt).getTime();
      return left - right;
    });
  }, [poll.data]);

  if (poll.initialLoading) {
    return <RRLoading label="Loading evidence" />;
  }
  if (poll.error) {
    return (
      <p role="alert" className="rounded-[22px] border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-900">
        {poll.error}
      </p>
    );
  }
  if (timeline.length === 0) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-4">
        <p className="text-sm font-semibold text-slate-600">
          Nothing has been captured against this job&apos;s requirements yet.
        </p>
      </div>
    );
  }

  return (
    <ol className="space-y-3">
      {timeline.map((entry, index) => (
        <li key={entry.evidenceId} className="relative rounded-2xl border border-slate-200 bg-white p-4 pl-11">
          <span className="absolute left-4 top-4 flex h-5 w-5 items-center justify-center rounded-full bg-slate-900 text-[10px] font-black text-cyan-300">
            {index + 1}
          </span>
          <p className="text-xs font-bold uppercase tracking-wide text-slate-500">
            {entry.capturedAt
              ? new Date(entry.capturedAt).toLocaleString("en-ZA")
              : new Date(entry.linkedAt).toLocaleString("en-ZA")}
            {entry.linkedBy ? ` · linked by ${entry.linkedBy}` : ""}
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {entry.requirements.map((requirement) => (
              <span
                key={`${entry.evidenceId}-${requirement.code}`}
                title={requirement.rejectionReason || undefined}
                className={`rounded-full px-2.5 py-1 text-xs font-bold ${
                  STATUS_CHIP[requirement.status] || STATUS_CHIP.pending
                }`}
              >
                {requirement.code.replace(/_/g, " ")}
                {requirement.status === "rejected" ? " · rejected" : ""}
              </span>
            ))}
          </div>
          {entry.requirements.length > 1 ? (
            <p className="mt-2 text-xs font-semibold text-slate-500">
              One capture satisfying {entry.requirements.length} requirements.
            </p>
          ) : null}
        </li>
      ))}
    </ol>
  );
}

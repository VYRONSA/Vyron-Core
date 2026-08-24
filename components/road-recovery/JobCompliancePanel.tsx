"use client";

/**
 * Job Compliance panel (Phase 3).
 *
 * States the job's compliance verdict plainly — including WHY it is blocked and what
 * would unblock it. The panel calls no engine of its own: it renders the deterministic
 * server verdict, and "Seal this evaluation" writes an immutable record of it.
 */

import React, { useCallback, useState } from "react";
import { RR_POLL_INTERVALS, rrFetchJson, useRrPoll } from "@/lib/road-recovery/use-rr-poll";
import type { ComplianceView } from "@/components/road-recovery/RequirementsChecklist";

type SealedEvaluation = {
  id: string;
  status: string;
  evidence_complete: boolean;
  scope: string;
  missing_codes: string[] | null;
  waived_codes: string[] | null;
  blocking_codes: string[] | null;
  completeness_percent: number | null;
  engine_version: string | null;
  evaluated_at: string;
  evaluated_by: string | null;
};

type CompliancePayload = {
  compliance: ComplianceView;
  history: SealedEvaluation[];
};

type ExceptionRow = {
  id: string;
  exception_code: string;
  severity: string;
  detail: string | null;
  resolution_status: string;
  created_at: string;
};

const STATUS_TONE: Record<string, { chip: string; label: string; explain: string }> = {
  compliant: {
    chip: "bg-emerald-200 text-emerald-900",
    label: "Compliant",
    explain: "Every required item has been captured. This job can be invoiced.",
  },
  waived_compliant: {
    chip: "bg-amber-200 text-amber-900",
    label: "Compliant with waivers",
    explain:
      "This job can be invoiced, but one or more requirements were excused rather than met. The waivers below travel with the job.",
  },
  incomplete: {
    chip: "bg-slate-200 text-slate-800",
    label: "Incomplete",
    explain:
      "Items are outstanding, but none of them blocks invoicing at this scope.",
  },
  non_compliant: {
    chip: "bg-rose-200 text-rose-900",
    label: "Blocked",
    explain:
      "Mandatory evidence is missing. Invoicing is refused by the server until it is captured or formally waived.",
  },
};

export default function JobCompliancePanel({
  companyId,
  serviceJobId,
}: {
  companyId: string;
  serviceJobId: string;
}) {
  const [sealing, setSealing] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [sealedId, setSealedId] = useState<string | null>(null);

  const fetcher = useCallback(async () => {
    const query = `companyId=${encodeURIComponent(companyId)}`;
    const [compliance, exceptions] = await Promise.all([
      rrFetchJson<CompliancePayload>(
        `/api/road-recovery/jobs/${serviceJobId}/compliance?${query}`
      ),
      rrFetchJson<{ exceptions: ExceptionRow[] }>(
        `/api/road-recovery/exceptions?${query}&serviceJobId=${encodeURIComponent(serviceJobId)}&status=open`
      ),
    ]);
    return { ...compliance, exceptions: exceptions.exceptions || [] };
  }, [companyId, serviceJobId]);

  const poll = useRrPoll<CompliancePayload & { exceptions: ExceptionRow[] }>(
    fetcher,
    RR_POLL_INTERVALS.liveOperations,
    { enabled: Boolean(companyId && serviceJobId), key: serviceJobId }
  );

  const refresh = poll.refresh;

  const seal = useCallback(async () => {
    setSealing(true);
    setActionError(null);
    try {
      const result = await rrFetchJson<{ evaluationId: string }>(
        `/api/road-recovery/jobs/${serviceJobId}/compliance`,
        { method: "POST", body: JSON.stringify({ companyId, scope: "invoice" }) }
      );
      setSealedId(result.evaluationId);
      refresh();
    } catch (error: unknown) {
      setActionError(error instanceof Error ? error.message : "Could not seal the evaluation.");
    } finally {
      setSealing(false);
    }
  }, [companyId, refresh, serviceJobId]);

  if (poll.initialLoading) {
    return <p className="text-sm font-semibold text-slate-500">Evaluating compliance…</p>;
  }
  if (poll.error) {
    return (
      <p role="alert" className="rounded-[22px] border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-900">
        {poll.error}
      </p>
    );
  }
  if (!poll.data) return null;

  const compliance = poll.data.compliance;
  const tone = STATUS_TONE[compliance.status] || STATUS_TONE.incomplete;
  const blockingResults = compliance.results.filter((entry) => entry.blocking);
  const waivedResults = compliance.results.filter((entry) => entry.waived);
  // compliance.missing is EVERY unsatisfied mandatory requirement, which is a superset of
  // compliance.blocking. Rendering it whole under "not blocking" told a controller that
  // items which do block invoicing did not, so the blocking codes are removed here and
  // the section is shown only when something genuinely non-blocking is left.
  const blockingCodes = new Set(compliance.blocking);
  const nonBlockingMissing = compliance.missing.filter((code) => !blockingCodes.has(code));

  return (
    <div className="space-y-4">
      <section className="rounded-2xl border border-slate-200 bg-white p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className={`rounded-full px-3 py-1 text-sm font-black ${tone.chip}`}>
              {tone.label}
            </span>
            <span
              className={`rounded-full px-3 py-1 text-xs font-bold ${
                compliance.evidenceComplete
                  ? "bg-emerald-100 text-emerald-800"
                  : "bg-rose-100 text-rose-800"
              }`}
            >
              evidence_complete = {String(compliance.evidenceComplete)}
            </span>
          </div>
          <button
            type="button"
            onClick={seal}
            disabled={sealing}
            className="rounded-xl bg-slate-900 px-3 py-2 text-xs font-bold text-cyan-300 hover:bg-slate-800 disabled:opacity-40"
          >
            {sealing ? "Sealing…" : "Seal this evaluation"}
          </button>
        </div>
        <p className="mt-3 text-sm font-semibold text-slate-600">{tone.explain}</p>
        {sealedId ? (
          <p className="mt-2 text-xs font-bold text-emerald-700">
            Evaluation sealed. It cannot be edited or removed.
          </p>
        ) : null}
        {actionError ? (
          <p className="mt-2 text-xs font-bold text-rose-700">{actionError}</p>
        ) : null}
      </section>

      {blockingResults.length > 0 ? (
        <section className="rounded-2xl border border-rose-200 bg-rose-50 p-4">
          <h4 className="text-xs font-bold uppercase tracking-wide text-rose-700">
            Blocking invoicing ({blockingResults.length})
          </h4>
          <ul className="mt-2 space-y-1.5">
            {blockingResults.map((entry) => (
              <li key={entry.requirementCode} className="text-sm font-semibold text-rose-900">
                {entry.label}
                {entry.minCount > 1 ? ` (${entry.capturedCount}/${entry.minCount})` : ""}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {nonBlockingMissing.length > 0 ? (
        <section className="rounded-2xl border border-slate-200 bg-white p-4">
          <h4 className="text-xs font-bold uppercase tracking-wide text-slate-500">
            Outstanding, not blocking ({nonBlockingMissing.length})
          </h4>
          <p className="mt-2 text-sm font-semibold text-slate-700">
            {nonBlockingMissing.join(", ").replace(/_/g, " ")}
          </p>
        </section>
      ) : null}

      {waivedResults.length > 0 ? (
        <section className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
          <h4 className="text-xs font-bold uppercase tracking-wide text-amber-800">
            Waived ({waivedResults.length}) — never silent
          </h4>
          <ul className="mt-2 space-y-1.5">
            {waivedResults.map((entry) => (
              <li key={entry.requirementCode} className="text-sm font-semibold text-amber-900">
                {entry.label} — {(entry.waiverReasonCode || "").replace(/_/g, " ")}
                {entry.waivedBy ? ` · authorised by ${entry.waivedBy}` : ""}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {poll.data.exceptions.length > 0 ? (
        <section className="rounded-2xl border border-slate-200 bg-white p-4">
          <h4 className="text-xs font-bold uppercase tracking-wide text-slate-500">
            Open exceptions ({poll.data.exceptions.length})
          </h4>
          <ul className="mt-2 space-y-1.5">
            {poll.data.exceptions.map((entry) => (
              <li key={entry.id} className="text-sm font-semibold text-slate-800">
                <span className="uppercase">{entry.severity}</span> ·{" "}
                {entry.exception_code.replace(/_/g, " ")}
                {entry.detail ? ` — ${entry.detail}` : ""}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {poll.data.history.length > 0 ? (
        <section className="rounded-2xl border border-slate-200 bg-white p-4">
          <h4 className="text-xs font-bold uppercase tracking-wide text-slate-500">
            Sealed evaluations
          </h4>
          <div className="mt-2 overflow-x-auto">
            <table className="w-full min-w-[560px] text-left text-xs">
              <thead className="text-slate-500">
                <tr>
                  <th className="py-1 pr-3 font-bold">When</th>
                  <th className="py-1 pr-3 font-bold">Status</th>
                  <th className="py-1 pr-3 font-bold">Complete</th>
                  <th className="py-1 pr-3 font-bold">Blocking</th>
                  <th className="py-1 pr-3 font-bold">By</th>
                </tr>
              </thead>
              <tbody className="font-semibold text-slate-800">
                {poll.data.history.map((entry) => (
                  <tr key={entry.id} className="border-t border-slate-100">
                    <td className="py-1.5 pr-3">
                      {new Date(entry.evaluated_at).toLocaleString("en-ZA")}
                    </td>
                    <td className="py-1.5 pr-3">{entry.status.replace(/_/g, " ")}</td>
                    <td className="py-1.5 pr-3">{String(entry.evidence_complete)}</td>
                    <td className="py-1.5 pr-3">{(entry.blocking_codes || []).length}</td>
                    <td className="py-1.5 pr-3">{entry.evaluated_by || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
    </div>
  );
}

"use client";

/**
 * Requirements Checklist (Phase 3).
 *
 * What THIS job must produce, read from its frozen snapshot — not from whatever the
 * policy says today. Designed to be usable on a phone at the roadside: one requirement
 * per row, large touch targets, and a plain statement of what is still outstanding.
 *
 * It displays compliance; it never decides it. The verdict shown here is the server's.
 */

import React, { useCallback, useMemo, useState } from "react";
import { RR_POLL_INTERVALS, rrFetchJson, useRrPoll } from "@/lib/road-recovery/use-rr-poll";
import { captureEvidence } from "@/lib/road-recovery/evidence-capture";

export type RequirementResultView = {
  requirementCode: string;
  label: string;
  evidenceKind: string;
  mandatory: boolean;
  applicable: boolean;
  satisfied: boolean;
  waived: boolean;
  blocking: boolean;
  capturedCount: number;
  minCount: number;
  guidance?: string | null;
  waiverReasonCode?: string | null;
  waiverReasonDetail?: string | null;
  waivedBy?: string | null;
};

export type ComplianceView = {
  status: "compliant" | "waived_compliant" | "incomplete" | "non_compliant";
  evidenceComplete: boolean;
  scope: string;
  results: RequirementResultView[];
  missing: string[];
  waived: string[];
  blocking: string[];
  satisfiedCount: number;
  applicableCount: number;
  completenessPercent: number;
  policyKey: string | null;
  policyVersion: number | null;
  engineVersion: string;
  evaluatedAt: string;
};

type ChecklistPayload = {
  requirements: unknown[];
  compliance: ComplianceView;
};

const KIND_LABELS: Record<string, string> = {
  photo: "Photograph",
  document: "Document",
  field: "Recorded detail",
  signature: "Signature",
  gps: "GPS confirmation",
  authorisation: "Authorisation",
  reference: "Reference number",
  handover: "Handover record",
};

export function requirementTone(result: RequirementResultView): {
  border: string;
  chip: string;
  text: string;
} {
  if (result.waived) {
    return {
      border: "border-amber-300 bg-amber-50",
      chip: "bg-amber-200 text-amber-900",
      text: "Waived",
    };
  }
  if (result.satisfied) {
    return {
      border: "border-emerald-200 bg-emerald-50",
      chip: "bg-emerald-200 text-emerald-900",
      text: "Captured",
    };
  }
  if (result.blocking) {
    return {
      border: "border-rose-300 bg-rose-50",
      chip: "bg-rose-200 text-rose-900",
      text: "Blocking",
    };
  }
  if (!result.applicable) {
    return {
      border: "border-slate-200 bg-slate-50",
      chip: "bg-slate-200 text-slate-700",
      text: "Not applicable",
    };
  }
  return {
    border: "border-slate-300 bg-white",
    chip: "bg-slate-200 text-slate-800",
    text: "Outstanding",
  };
}

export default function RequirementsChecklist({
  companyId,
  serviceJobId,
  compact = false,
  capturedByRole = "controller",
  onChanged,
}: {
  companyId: string;
  serviceJobId: string;
  /** Compact mode is the driver's roadside view: capture, but no waiver controls. */
  compact?: boolean;
  /**
   * Who is standing at the vehicle. Stored on the evidence row, so a dispute can tell a
   * driver's roadside photograph from a controller's desk capture. Kept separate from
   * `compact` on purpose — one is layout, this is identity.
   */
  capturedByRole?: string;
  onChanged?: () => void;
}) {
  const [busyCode, setBusyCode] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [captureCode, setCaptureCode] = useState<string | null>(null);
  const [captureFile, setCaptureFile] = useState<File | null>(null);
  const [captureNote, setCaptureNote] = useState("");
  const [captureMessage, setCaptureMessage] = useState<string | null>(null);
  const [waiveCode, setWaiveCode] = useState<string | null>(null);
  const [reasonCode, setReasonCode] = useState("");
  const [reasonDetail, setReasonDetail] = useState("");
  const [reasonCodes, setReasonCodes] = useState<string[]>([]);

  const fetcher = useCallback(async () => {
    const [checklist, waivers] = await Promise.all([
      rrFetchJson<ChecklistPayload>(
        `/api/road-recovery/jobs/${serviceJobId}/requirements?companyId=${encodeURIComponent(companyId)}`
      ),
      rrFetchJson<{ reasonCodes: string[] }>(
        `/api/road-recovery/jobs/${serviceJobId}/waivers?companyId=${encodeURIComponent(companyId)}`
      ),
    ]);
    setReasonCodes(waivers.reasonCodes || []);
    return checklist;
  }, [companyId, serviceJobId]);

  const poll = useRrPoll<ChecklistPayload>(fetcher, RR_POLL_INTERVALS.driverActive, {
    enabled: Boolean(companyId && serviceJobId),
    key: serviceJobId,
  });

  const compliance = poll.data?.compliance ?? null;
  const refresh = poll.refresh;

  const grouped = useMemo(() => {
    const results = compliance?.results ?? [];
    return {
      outstanding: results.filter((entry) => entry.applicable && !entry.satisfied),
      captured: results.filter((entry) => entry.satisfied && !entry.waived),
      waived: results.filter((entry) => entry.waived),
      notApplicable: results.filter((entry) => !entry.applicable),
    };
  }, [compliance]);

  /**
   * Capture, then link, through the shared browser helper.
   *
   * A requirement whose evidence_kind is a recorded DETAIL (an engine number, a distance)
   * is satisfied by a note and needs no file, which is why the file is optional and the
   * button is enabled by either one.
   */
  const submitCapture = useCallback(
    async (result: RequirementResultView) => {
      setBusyCode(result.requirementCode);
      setActionError(null);
      setCaptureMessage(null);
      try {
        const outcome = await captureEvidence({
          companyId,
          serviceJobId,
          file: captureFile,
          requirementCodes: [result.requirementCode],
          notes: captureNote.trim() || null,
          capturedByRole,
          // A recorded detail is typed at a desk; only ask the device for a position when
          // there is actually something photographed at a place.
          withGps: Boolean(captureFile),
        });
        setCaptureCode(null);
        setCaptureFile(null);
        setCaptureNote("");
        setCaptureMessage(
          outcome.linked.length > 0
            ? `Captured against ${outcome.linked.join(", ")}.`
            : `Captured, but nothing was linked${outcome.linkError ? `: ${outcome.linkError}` : "."}`
        );
        refresh();
        onChanged?.();
      } catch (error: unknown) {
        setActionError(error instanceof Error ? error.message : "Could not capture the evidence.");
      } finally {
        setBusyCode(null);
      }
    },
    [captureFile, captureNote, capturedByRole, companyId, onChanged, refresh, serviceJobId]
  );

  const submitWaiver = useCallback(async () => {
    if (!waiveCode || !reasonCode) return;
    setBusyCode(waiveCode);
    setActionError(null);
    try {
      await rrFetchJson(`/api/road-recovery/jobs/${serviceJobId}/waivers`, {
        method: "POST",
        body: JSON.stringify({
          companyId,
          requirementCode: waiveCode,
          reasonCode,
          reasonDetail: reasonDetail || null,
        }),
      });
      setWaiveCode(null);
      setReasonCode("");
      setReasonDetail("");
      refresh();
      onChanged?.();
    } catch (error: unknown) {
      setActionError(error instanceof Error ? error.message : "Could not record the waiver.");
    } finally {
      setBusyCode(null);
    }
  }, [companyId, onChanged, refresh, reasonCode, reasonDetail, serviceJobId, waiveCode]);

  if (poll.initialLoading) {
    return <p className="text-sm font-semibold text-slate-500">Loading requirements…</p>;
  }
  if (poll.error) {
    return (
      <p className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-800">
        {poll.error}
      </p>
    );
  }
  if (!compliance) return null;

  if (compliance.results.length === 0) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-4">
        <p className="text-sm font-semibold text-slate-600">
          No evidence requirements are configured for this job.
        </p>
      </div>
    );
  }

  const renderRow = (result: RequirementResultView) => {
    const tone = requirementTone(result);
    return (
      <li key={result.requirementCode} className={`rounded-2xl border p-3 ${tone.border}`}>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-sm font-bold text-slate-900">{result.label}</p>
            <p className="mt-0.5 text-xs font-semibold text-slate-500">
              {KIND_LABELS[result.evidenceKind] || result.evidenceKind}
              {result.minCount > 1 ? ` · ${result.capturedCount}/${result.minCount} captured` : ""}
              {result.mandatory ? "" : " · optional"}
            </p>
          </div>
          <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${tone.chip}`}>
            {tone.text}
          </span>
        </div>

        {result.guidance && !result.satisfied ? (
          <p className="mt-2 text-xs font-medium text-slate-600">{result.guidance}</p>
        ) : null}

        {result.waived ? (
          <p className="mt-2 rounded-xl bg-white/70 px-2.5 py-1.5 text-xs font-semibold text-amber-900">
            Waived — {(result.waiverReasonCode || "").replace(/_/g, " ")}
            {result.waiverReasonDetail ? `: ${result.waiverReasonDetail}` : ""}
            {result.waivedBy ? ` (authorised by ${result.waivedBy})` : ""}
          </p>
        ) : null}

        {result.applicable && !result.satisfied ? (
          <div className="mt-2 flex flex-wrap gap-2">
            {/* Capture comes FIRST and is the primary control. Waiving is the exception,
                and a screen that offers only the exception is how every job ends up
                billing on waivers. */}
            <button
              type="button"
              onClick={() => {
                setCaptureCode(captureCode === result.requirementCode ? null : result.requirementCode);
                setCaptureFile(null);
                setCaptureNote("");
                setActionError(null);
                setCaptureMessage(null);
              }}
              className="rounded-xl bg-emerald-700 px-3 py-1.5 text-xs font-bold text-white hover:bg-emerald-800"
            >
              {captureCode === result.requirementCode ? "Cancel capture" : "Capture"}
            </button>
            {!compact ? (
              <button
                type="button"
                onClick={() => {
                  setWaiveCode(result.requirementCode);
                  setActionError(null);
                }}
                className="rounded-xl bg-white px-3 py-1.5 text-xs font-bold text-slate-700 ring-1 ring-slate-300 hover:bg-slate-50"
              >
                Waive with reason
              </button>
            ) : null}
          </div>
        ) : null}

        {captureCode === result.requirementCode ? (
          <div className="mt-2 space-y-2 rounded-xl border border-emerald-300 bg-emerald-50 p-3">
            <p className="text-xs font-bold text-emerald-900">
              {KIND_LABELS[result.evidenceKind] || result.evidenceKind}
              {result.minCount > 1
                ? ` — ${result.capturedCount} of ${result.minCount} captured so far`
                : ""}
            </p>
            {result.guidance ? (
              <p className="text-[11px] font-semibold text-emerald-900/80">{result.guidance}</p>
            ) : null}
            <input
              type="file"
              aria-label={`Evidence file for ${result.label}`}
              accept="image/*,application/pdf"
              capture="environment"
              onChange={(event) => setCaptureFile(event.target.files?.[0] ?? null)}
              className="w-full rounded-xl border border-emerald-300 bg-white px-3 py-2 text-xs font-semibold"
            />
            <input
              aria-label={`Evidence note for ${result.label}`}
              value={captureNote}
              onChange={(event) => setCaptureNote(event.target.value)}
              placeholder="What this shows, or the detail being recorded."
              className="w-full rounded-xl border border-emerald-300 bg-white px-3 py-2 text-xs"
            />
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={busyCode === result.requirementCode || (!captureFile && !captureNote.trim())}
                onClick={() => submitCapture(result)}
                className="rounded-lg bg-emerald-700 px-3 py-1.5 text-xs font-bold text-white disabled:opacity-40"
              >
                {busyCode === result.requirementCode ? "Capturing…" : "Save evidence"}
              </button>
              <button
                type="button"
                onClick={() => setCaptureCode(null)}
                className="rounded-lg bg-white px-3 py-1.5 text-xs font-bold text-slate-700"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : null}

        {!compact && waiveCode === result.requirementCode ? (
          <div className="mt-2 space-y-2 rounded-xl border border-slate-300 bg-white p-3">
            <p className="text-xs font-bold text-slate-700">
              A waiver is permanently recorded against your name and stays visible on every
              compliance result for this job.
            </p>
            <select
              value={reasonCode}
              onChange={(event) => setReasonCode(event.target.value)}
              className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm font-semibold"
            >
              <option value="">Select a reason…</option>
              {reasonCodes.map((code) => (
                <option key={code} value={code}>
                  {code.replace(/_/g, " ")}
                </option>
              ))}
            </select>
            <textarea
              value={reasonDetail}
              onChange={(event) => setReasonDetail(event.target.value)}
              rows={2}
              placeholder="What happened?"
              className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
            />
            <div className="flex gap-2">
              <button
                type="button"
                disabled={!reasonCode || busyCode === result.requirementCode}
                onClick={submitWaiver}
                className="rounded-xl bg-amber-500 px-3 py-1.5 text-xs font-bold text-white disabled:opacity-40"
              >
                {busyCode === result.requirementCode ? "Recording…" : "Record waiver"}
              </button>
              <button
                type="button"
                onClick={() => setWaiveCode(null)}
                className="rounded-xl bg-slate-200 px-3 py-1.5 text-xs font-bold text-slate-700"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : null}
      </li>
    );
  };

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-slate-200 bg-white p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs font-bold uppercase tracking-wide text-slate-500">
              Evidence completeness
            </p>
            <p className="text-2xl font-black text-slate-900">
              {compliance.completenessPercent}%
              <span className="ml-2 text-sm font-bold text-slate-500">
                {compliance.satisfiedCount} of {compliance.applicableCount} required
              </span>
            </p>
          </div>
          <button
            type="button"
            onClick={refresh}
            className="rounded-xl bg-slate-100 px-3 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-200"
          >
            Refresh
          </button>
        </div>
        <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-slate-200">
          <div
            className={`h-full ${compliance.evidenceComplete ? "bg-emerald-500" : "bg-cyan-500"}`}
            style={{ width: `${Math.min(100, Math.max(0, compliance.completenessPercent))}%` }}
          />
        </div>
      </div>

      {actionError ? (
        <p className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-800">
          {actionError}
        </p>
      ) : null}

      {captureMessage ? (
        <p className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-800">
          {captureMessage}
        </p>
      ) : null}

      {grouped.outstanding.length > 0 ? (
        <section>
          <h4 className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-500">
            Still outstanding ({grouped.outstanding.length})
          </h4>
          <ul className="space-y-2">{grouped.outstanding.map(renderRow)}</ul>
        </section>
      ) : null}

      {grouped.waived.length > 0 ? (
        <section>
          <h4 className="mb-2 text-xs font-bold uppercase tracking-wide text-amber-700">
            Waived ({grouped.waived.length})
          </h4>
          <ul className="space-y-2">{grouped.waived.map(renderRow)}</ul>
        </section>
      ) : null}

      {grouped.captured.length > 0 ? (
        <section>
          <h4 className="mb-2 text-xs font-bold uppercase tracking-wide text-emerald-700">
            Captured ({grouped.captured.length})
          </h4>
          <ul className="space-y-2">{grouped.captured.map(renderRow)}</ul>
        </section>
      ) : null}

      {grouped.notApplicable.length > 0 ? (
        <section>
          <h4 className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-400">
            Not applicable to this job ({grouped.notApplicable.length})
          </h4>
          <ul className="space-y-2">{grouped.notApplicable.map(renderRow)}</ul>
        </section>
      ) : null}

      <p className="text-xs font-semibold text-slate-400">
        Policy {compliance.policyKey || "none"}
        {compliance.policyVersion ? ` v${compliance.policyVersion}` : ""} · engine{" "}
        {compliance.engineVersion}
      </p>
    </div>
  );
}

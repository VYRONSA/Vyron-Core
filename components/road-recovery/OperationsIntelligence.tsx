"use client";

/**
 * Road & Recovery Executive & Operations Intelligence (Phase 6).
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS SCREEN IS
 * ---------------------------------------------------------------------------
 *
 * The Operations Director view. Every card answers the same six questions:
 *
 *   WHAT HAPPENED   the measurement, against the target the business configured
 *   WHY             the root cause, with the evidence behind it, or "undetermined"
 *   WHAT IT COSTS   a calculated rand figure, or "Not quantified" — never a guessed one
 *   WHAT TO DO      the recommended decision, and the alternative
 *   WHO             the owner role and the due date
 *   IF NOTHING      the consequence of leaving it
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS SCREEN REFUSES TO DO
 * ---------------------------------------------------------------------------
 *
 * It never shows a target the customer did not set. A metric with no target reads
 * NO SLA CONFIGURED and is excluded from the score. It never shows zero where the answer
 * is unknown: no data reads "No data", missing cost reads "Not measurable". And it never
 * shows an invoice, a payment or a ledger — VYRON FINANCE owns those.
 *
 * Built from the same primitives as every other Road & Recovery screen so it reads as part
 * of VYRON CORE rather than a separate analytics product.
 */

import React, { useCallback, useMemo, useState } from "react";
import { RR_POLL_INTERVALS, rrFetchJson, useRrPoll } from "@/lib/road-recovery/use-rr-poll";

type MetricBand = "ok" | "warning" | "critical" | "not_configured" | "no_data";

type Metric = {
  key: string;
  label: string;
  domain: string;
  unit: string;
  direction: string;
  value: number | null;
  sampleSize: number;
  target: number | null;
  thresholdSource: "configured" | "not_configured";
  thresholdVersion: number | null;
  band: MetricBand;
  reason: string;
};

type Finding = {
  key: string;
  domain: string;
  severity: string;
  symptom: string;
  rootCause: string | null;
  rootCauseConfidence: number | null;
  evidence: string[];
  recommendation: string;
  alternative: string;
  expectedOutcome: string;
  consequenceIfIgnored: string;
  affectedCount: number;
  financialImpactZAR: number | null;
};

type Recommendation = Finding & {
  domainLabel: string;
  trigger: string;
  priorityScore: number;
  ownerRole: string;
  dueDateIso: string;
  financialImpactKnown: boolean;
  measuredValue: number | null;
  targetValue: number | null;
  actionType: string;
};

type HealthComponent = {
  metric: string;
  label: string;
  value: number | null;
  weight: number;
  threshold: number | null;
  band: MetricBand;
  reason: string;
  score: number | null;
  contribution: number | null;
  included: boolean;
  exclusionReason: string | null;
};

type Domain = {
  domain: string;
  label: string;
  metrics: Metric[];
  findings: Finding[];
  detail: Record<string, unknown>;
  empty: boolean;
  truncated: { message: string } | null;
};

type Intelligence = {
  window: { fromIso: string; toIso: string; asOfIso: string };
  domains: Domain[];
  metrics: Metric[];
  health: {
    score: number | null;
    band: string;
    narrative: string;
    components: HealthComponent[];
    configuredCoveragePct: number;
    metricsWithoutTargets: string[];
    metricsWithoutData: string[];
  };
  recommendations: Recommendation[];
  thresholdsConfigured: number;
  truncations: { message: string }[];
  jobCount: number;
  bystandCount: number;
  generatedAtIso: string;
};

const NO_SLA = "NO SLA CONFIGURED";

/** Section order is operational: the decision first, then the evidence behind it. */
const SECTION_ORDER = [
  "recommended_actions",
  "executive_health",
  "sla",
  "dispatch",
  "tow_operations",
  "bystand",
  "storage",
  "authorisation",
  "billing_readiness",
  "distance",
  "exceptions",
  "fleet",
  "driver",
  "counterparty",
  "profitability",
];

function bandChip(band: MetricBand | string): string {
  switch (band) {
    case "ok":
      return "border-emerald-200 bg-emerald-50 text-emerald-800";
    case "warning":
      return "border-amber-200 bg-amber-50 text-amber-800";
    case "critical":
      return "border-rose-200 bg-rose-50 text-rose-800";
    case "no_data":
      return "border-slate-200 bg-slate-50 text-slate-500";
    default:
      return "border-slate-300 bg-white text-slate-600";
  }
}

function bandLabel(band: MetricBand | string): string {
  switch (band) {
    case "ok":
      return "On target";
    case "warning":
      return "Warning";
    case "critical":
      return "Critical";
    case "no_data":
      return "No data";
    case "not_configured":
      return NO_SLA;
    default:
      return String(band);
  }
}

function severityChip(severity: string): string {
  switch (severity) {
    case "critical":
      return "border-rose-300 bg-rose-100 text-rose-900";
    case "high":
      return "border-orange-200 bg-orange-50 text-orange-800";
    case "medium":
      return "border-amber-200 bg-amber-50 text-amber-800";
    default:
      return "border-slate-200 bg-slate-50 text-slate-600";
  }
}

/** Never renders a bare zero for an unknown. */
function showNumber(value: number | null, unit: string): string {
  if (value === null) return "No data";
  return unit ? `${value} ${unit}` : String(value);
}

function showRand(value: number | null, known: boolean): string {
  if (!known || value === null) return "Not quantified";
  return `R ${value.toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function showDate(iso: string): string {
  const parsed = Date.parse(iso);
  return Number.isFinite(parsed) ? new Date(parsed).toLocaleDateString("en-ZA") : iso;
}

export default function OperationsIntelligence({ companyId }: { companyId: string }) {
  const [days, setDays] = useState(30);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openDomain, setOpenDomain] = useState<string | null>("recommended_actions");

  const load = useCallback(async () => {
    const to = new Date();
    const from = new Date(to.getTime() - days * 86_400_000);
    const params = new URLSearchParams({
      companyId,
      from: from.toISOString(),
      to: to.toISOString(),
    });
    const payload = await rrFetchJson<{ ok: boolean; intelligence: Intelligence }>(
      `/api/road-recovery/intelligence?${params.toString()}`
    );
    return payload.intelligence;
  }, [companyId, days]);

  const { data, loading, refresh } = useRrPoll<Intelligence>(load, RR_POLL_INTERVALS.intelligence, {
    key: String(days),
  });

  const domainsByKey = useMemo(() => {
    const map = new Map<string, Domain>();
    for (const domain of data?.domains ?? []) map.set(domain.domain, domain);
    return map;
  }, [data]);

  const prepareAction = useCallback(
    async (recommendation: Recommendation) => {
      setBusy(recommendation.key);
      setError(null);
      setNotice(null);
      try {
        const response = await rrFetchJson<{ ok: boolean; actionId: string; owner: string; dueDate: string }>(
          "/api/road-recovery/intelligence/actions",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ companyId, findingKey: recommendation.key }),
          }
        );
        setNotice(
          `Action prepared and sent to the approval queue. Owner: ${response.owner}. Due ${showDate(response.dueDate)}. It now appears in Action Intelligence alongside every other workflow.`
        );
        await refresh();
      } catch (caught: unknown) {
        setError(caught instanceof Error ? caught.message : String(caught));
      } finally {
        setBusy(null);
      }
    },
    [companyId, refresh]
  );

  if (loading && !data) {
    return <p className="text-sm font-semibold text-slate-600">Loading Road &amp; Recovery intelligence…</p>;
  }
  if (!data) {
    return (
      <p role="alert" className="rounded-[22px] border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-900">
        Road &amp; Recovery intelligence could not be loaded.
      </p>
    );
  }

  const health = data.health;
  const noTargets = data.thresholdsConfigured === 0;

  return (
    <div className="space-y-4">
      {/* -------------------------------------------------- Executive header */}
      <section className="rounded-2xl border border-slate-200 bg-white p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-lg font-black text-slate-900">Road &amp; Recovery Intelligence</h1>
            <p className="mt-1 max-w-2xl text-xs font-semibold text-slate-600">
              What happened, why it happened, what it is costing, what should happen next and who owns it.
              Road &amp; Recovery is a vertical of UMORA Executive Intelligence — recommendations enter
              the same Action Intelligence pipeline as every other workflow.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <select
              value={days}
              onChange={(event) => setDays(Number(event.target.value))}
              className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-bold text-slate-700"
            >
              <option value={7}>Last 7 days</option>
              <option value={30}>Last 30 days</option>
              <option value={90}>Last 90 days</option>
            </select>
            <button
              type="button"
              onClick={() => void refresh()}
              className="rounded-xl bg-slate-900 px-3 py-2 text-xs font-bold text-cyan-300 hover:bg-slate-800"
            >
              Refresh
            </button>
          </div>
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <p className="text-[11px] font-bold uppercase tracking-wide text-slate-500">
              Road &amp; Recovery Health
            </p>
            <p className="mt-1 text-2xl font-black tabular-nums text-slate-900">
              {health.score === null ? "Not scoreable" : `${health.score} / 100`}
            </p>
            <p className="mt-1 text-[11px] font-semibold text-slate-600">
              {health.score === null ? NO_SLA : bandLabel(health.band === "healthy" ? "ok" : health.band)}
            </p>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <p className="text-[11px] font-bold uppercase tracking-wide text-slate-500">Jobs in period</p>
            <p className="mt-1 text-2xl font-black tabular-nums text-slate-900">{data.jobCount}</p>
            <p className="mt-1 text-[11px] font-semibold text-slate-600">
              {data.bystandCount} BYSTAND attendance(s), measured separately
            </p>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <p className="text-[11px] font-bold uppercase tracking-wide text-slate-500">Targets configured</p>
            <p className="mt-1 text-2xl font-black tabular-nums text-slate-900">{data.thresholdsConfigured}</p>
            <p className="mt-1 text-[11px] font-semibold text-slate-600">
              {health.configuredCoveragePct}% of scorable metrics
            </p>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <p className="text-[11px] font-bold uppercase tracking-wide text-slate-500">Recommended actions</p>
            <p className="mt-1 text-2xl font-black tabular-nums text-slate-900">{data.recommendations.length}</p>
            <p className="mt-1 text-[11px] font-semibold text-slate-600">
              {data.recommendations.filter((entry) => entry.severity === "critical").length} critical
            </p>
          </div>
        </div>

        <p className="mt-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-xs font-semibold text-slate-700">
          {health.narrative}
        </p>
      </section>

      {/* ------------------------------------------------- Honesty banners */}
      {noTargets ? (
        <section className="rounded-2xl border border-amber-300 bg-amber-50 p-4">
          <p className="text-sm font-black text-amber-900">{NO_SLA}</p>
          <p className="mt-1 text-xs font-semibold text-amber-900">
            No operational targets have been set for this company, so no metric can report a breach and health
            cannot be scored. Every measured value below is still shown. Nothing is compared against an
            assumed industry standard — the system will not invent a target the business has not agreed.
          </p>
        </section>
      ) : null}

      {data.truncations.length > 0 ? (
        <section className="rounded-2xl border border-orange-300 bg-orange-50 p-4">
          <p className="text-sm font-black text-orange-900">Partial data</p>
          {data.truncations.map((entry, index) => (
            <p key={index} className="mt-1 text-xs font-semibold text-orange-900">
              {entry.message}
            </p>
          ))}
        </section>
      ) : null}

      {notice ? (
        <p role="status" className="rounded-[22px] border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-900">
          {notice}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="rounded-[22px] border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-900">
          {error}
        </p>
      ) : null}

      {/* -------------------------------------------- Recommended actions */}
      <section className="rounded-2xl border border-slate-200 bg-white">
        <header className="border-b border-slate-200 px-5 py-4">
          <h2 className="text-sm font-black text-slate-900">Recommended Actions</h2>
          <p className="mt-1 text-xs font-semibold text-slate-600">
            Operational decisions, ordered by priority. Preparing one sends it to the existing approval queue
            with an owner, a due date and a captured before-value, so improvement can be measured afterwards.
          </p>
        </header>

        {data.recommendations.length === 0 ? (
          <p className="px-5 py-6 text-xs font-semibold text-slate-600">
            {noTargets
              ? "No recommendations. Operational targets have not been configured, so no target-based finding can be raised. Recorded critical exceptions would still appear here."
              : "No recommendations. Every configured target is being met and no critical exception is open."}
          </p>
        ) : (
          <ul className="divide-y divide-slate-200">
            {data.recommendations.map((recommendation) => (
              <li key={recommendation.key} className="px-5 py-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={`rounded-full border px-2 py-0.5 text-[10px] font-black uppercase ${severityChip(recommendation.severity)}`}
                      >
                        {recommendation.severity}
                      </span>
                      <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] font-bold text-slate-600">
                        {recommendation.domainLabel}
                      </span>
                      <span className="rounded-full border border-cyan-200 bg-cyan-50 px-2 py-0.5 text-[10px] font-bold text-cyan-800">
                        {recommendation.trigger}
                      </span>
                      <span className="text-[10px] font-bold text-slate-400">
                        Priority {recommendation.priorityScore}
                      </span>
                    </div>

                    {/* WHAT HAPPENED */}
                    <p className="mt-2 text-sm font-bold text-slate-900">{recommendation.symptom}</p>

                    {/* WHY — symptom, cause and recommendation stay visibly separate */}
                    <div className="mt-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                      <p className="text-[10px] font-black uppercase tracking-wide text-slate-500">
                        Likely root cause
                      </p>
                      {recommendation.rootCause ? (
                        <>
                          <p className="mt-0.5 text-xs font-semibold text-slate-800">
                            {recommendation.rootCause}
                          </p>
                          {recommendation.rootCauseConfidence !== null ? (
                            <p className="mt-0.5 text-[10px] font-bold text-slate-500">
                              Confidence {recommendation.rootCauseConfidence}% — derived from the counts below,
                              not from a model.
                            </p>
                          ) : null}
                          {recommendation.evidence.length > 0 ? (
                            <ul className="mt-1 list-inside list-disc text-[11px] font-semibold text-slate-600">
                              {recommendation.evidence.map((line, index) => (
                                <li key={index}>{line}</li>
                              ))}
                            </ul>
                          ) : null}
                        </>
                      ) : (
                        <p className="mt-0.5 text-xs font-semibold text-slate-600">
                          Undetermined. The available operational data does not support a specific cause, so
                          none is stated.
                        </p>
                      )}
                    </div>

                    {/* WHAT TO DO */}
                    <p className="mt-2 text-xs font-semibold text-slate-800">
                      <span className="font-black text-slate-900">Recommended: </span>
                      {recommendation.recommendation}
                    </p>
                    <p className="mt-1 text-xs font-semibold text-slate-600">
                      <span className="font-black text-slate-700">Alternative: </span>
                      {recommendation.alternative}
                    </p>
                    <p className="mt-1 text-xs font-semibold text-slate-600">
                      <span className="font-black text-slate-700">Expected outcome: </span>
                      {recommendation.expectedOutcome}
                    </p>
                    <p className="mt-1 text-xs font-semibold text-rose-700">
                      <span className="font-black">If nothing is done: </span>
                      {recommendation.consequenceIfIgnored}
                    </p>
                  </div>

                  {/* WHO, WHEN, HOW MUCH */}
                  <div className="w-full shrink-0 space-y-2 sm:w-56">
                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                      <p className="text-[10px] font-black uppercase tracking-wide text-slate-500">Owner</p>
                      <p className="text-xs font-bold text-slate-900">{recommendation.ownerRole}</p>
                      <p className="mt-1 text-[10px] font-black uppercase tracking-wide text-slate-500">Due</p>
                      <p className="text-xs font-bold text-slate-900">{showDate(recommendation.dueDateIso)}</p>
                      <p className="mt-1 text-[10px] font-black uppercase tracking-wide text-slate-500">
                        Financial impact
                      </p>
                      <p className="text-xs font-bold text-slate-900">
                        {showRand(recommendation.financialImpactZAR, recommendation.financialImpactKnown)}
                      </p>
                      <p className="mt-1 text-[10px] font-black uppercase tracking-wide text-slate-500">
                        Affected
                      </p>
                      <p className="text-xs font-bold text-slate-900">{recommendation.affectedCount}</p>
                    </div>
                    <button
                      type="button"
                      disabled={busy === recommendation.key}
                      onClick={() => void prepareAction(recommendation)}
                      className="w-full rounded-xl bg-slate-900 px-3 py-2 text-xs font-bold text-cyan-300 hover:bg-slate-800 disabled:opacity-50"
                    >
                      {busy === recommendation.key ? "Preparing…" : "Prepare action"}
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ------------------------------------------------ Health breakdown */}
      <section className="rounded-2xl border border-slate-200 bg-white">
        <header className="border-b border-slate-200 px-5 py-4">
          <h2 className="text-sm font-black text-slate-900">How the health score was calculated</h2>
          <p className="mt-1 text-xs font-semibold text-slate-600">
            Every component, its weight, its band and its contribution. Components with no data or no
            configured target are excluded from the denominator and listed with the reason — they are never
            counted as zero.
          </p>
        </header>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-left text-xs">
            <thead className="bg-slate-50 text-[10px] font-black uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-2">Metric</th>
                <th className="px-4 py-2">Value</th>
                <th className="px-4 py-2">Target</th>
                <th className="px-4 py-2">Band</th>
                <th className="px-4 py-2">Weight</th>
                <th className="px-4 py-2">Score</th>
                <th className="px-4 py-2">Included</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {health.components.map((component) => (
                <tr key={component.metric} className={component.included ? "" : "bg-slate-50/60"}>
                  <td className="px-4 py-2 font-bold text-slate-800">{component.label}</td>
                  <td className="px-4 py-2 font-semibold text-slate-700">
                    {component.value === null ? "No data" : component.value}
                  </td>
                  <td className="px-4 py-2 font-semibold text-slate-700">
                    {component.threshold === null ? NO_SLA : component.threshold}
                  </td>
                  <td className="px-4 py-2">
                    <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold ${bandChip(component.band)}`}>
                      {bandLabel(component.band)}
                    </span>
                  </td>
                  <td className="px-4 py-2 font-semibold text-slate-700">{component.weight}</td>
                  <td className="px-4 py-2 font-semibold text-slate-700">
                    {component.score === null ? "—" : component.score}
                  </td>
                  <td className="px-4 py-2 text-[11px] font-semibold text-slate-600">
                    {component.included ? "Yes" : component.exclusionReason}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* --------------------------------------------------- Domain detail */}
      <section className="space-y-3">
        {SECTION_ORDER.filter((key) => key !== "recommended_actions" && key !== "executive_health").map(
          (key) => {
            const domain = domainsByKey.get(key);
            if (!domain) return null;
            const open = openDomain === key;

            return (
              <div key={key} className="rounded-2xl border border-slate-200 bg-white">
                <button
                  type="button"
                  onClick={() => setOpenDomain(open ? null : key)}
                  className="flex w-full items-center justify-between px-5 py-3 text-left"
                >
                  <span className="text-sm font-black text-slate-900">{domain.label}</span>
                  <span className="flex items-center gap-2">
                    {domain.findings.length > 0 ? (
                      <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-bold text-amber-800">
                        {domain.findings.length} finding(s)
                      </span>
                    ) : null}
                    {domain.empty ? (
                      <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] font-bold text-slate-500">
                        No data
                      </span>
                    ) : null}
                    <span className="text-xs font-bold text-slate-400">{open ? "Hide" : "Show"}</span>
                  </span>
                </button>

                {open ? (
                  <div className="border-t border-slate-200 px-5 py-4">
                    {domain.truncated ? (
                      <p className="mb-3 rounded-xl border border-orange-200 bg-orange-50 px-3 py-2 text-[11px] font-semibold text-orange-900">
                        {domain.truncated.message}
                      </p>
                    ) : null}

                    {domain.metrics.length > 0 ? (
                      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                        {domain.metrics.map((metric) => (
                          <div key={metric.key} className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                            <p className="text-[10px] font-black uppercase tracking-wide text-slate-500">
                              {metric.label}
                            </p>
                            <p className="mt-1 text-lg font-black text-slate-900">
                              {showNumber(metric.value, metric.unit)}
                            </p>
                            <span
                              className={`mt-1 inline-block rounded-full border px-2 py-0.5 text-[10px] font-bold ${bandChip(metric.band)}`}
                            >
                              {bandLabel(metric.band)}
                            </span>
                            <p className="mt-1 text-[10px] font-semibold text-slate-600">{metric.reason}</p>
                          </div>
                        ))}
                      </div>
                    ) : null}

                    {Object.keys(domain.detail).length > 0 ? (
                      <details className="mt-3">
                        <summary className="cursor-pointer text-[11px] font-black uppercase tracking-wide text-slate-500">
                          Supporting detail
                        </summary>
                        <pre className="mt-2 max-h-80 overflow-auto rounded-xl bg-slate-900 p-3 text-[11px] leading-relaxed text-cyan-200">
                          {JSON.stringify(domain.detail, null, 2)}
                        </pre>
                      </details>
                    ) : null}
                  </div>
                ) : null}
              </div>
            );
          }
        )}
      </section>

      <p className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-[11px] font-semibold text-slate-600">
        UMORA prepares operational intelligence and billing information. It issues no invoice, records no
        payment and posts to no ledger — VYRON FINANCE owns those. Measured{" "}
        {showDate(data.window.fromIso)} to {showDate(data.window.toIso)}, as of{" "}
        {new Date(data.window.asOfIso).toLocaleString("en-ZA")}.
      </p>
    </div>
  );
}

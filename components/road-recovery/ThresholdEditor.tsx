"use client";

/**
 * Operational target configuration (Operator Completion, Condition 2).
 *
 * The intelligence engine has supported configurable thresholds since Phase 6 — versioned,
 * scoped, retireable — and nothing in the browser could publish one. The result was that
 * every customer's Intelligence Centre read NO SLA CONFIGURED forever and the Action Centre
 * had nothing to say. This is that missing screen and nothing more.
 *
 * It defines NO metric, NO default and NO severity band of its own:
 *
 *   - the metrics come from RR_METRIC_CATALOGUE, returned by the API alongside the
 *     thresholds, so a metric added to the catalogue appears here without a change
 *   - which scopes a metric accepts (service code, counterparty) is the catalogue's
 *     `scopes` flag, and the server re-checks it
 *   - the unit is the catalogue's unit; it is shown, not chosen
 *   - there is no suggested target. A target means "the business has decided this is what
 *     good looks like", and inventing one would manufacture breaches nobody agreed to
 *
 * Editing is publishing. publishThreshold() retires the current version and inserts the
 * next, so a breach recorded last March can still be replayed against March's target —
 * which is why the history is shown here rather than hidden.
 */

import React, { useMemo, useState } from "react";
import { RR_POLL_INTERVALS, rrFetchJson, useRrPoll } from "@/lib/road-recovery/use-rr-poll";

type MetricDefinition = {
  key: string;
  label: string;
  domain: string;
  unit: string;
  direction: "lower_is_better" | "higher_is_better";
  healthWeight: number;
  source: string;
  scopes: { serviceCode: boolean; counterparty: boolean };
};

type ThresholdRow = {
  id: string;
  metricKey: string;
  serviceCode: string | null;
  counterpartyId: string | null;
  targetValue: number;
  warningValue: number | null;
  criticalValue: number | null;
  unit: string;
  severity: string;
  effectiveFrom: string | null;
  effectiveTo: string | null;
  active: boolean;
  version: number;
  notes: string | null;
  createdBy: string | null;
  retiredBy: string | null;
  retiredAt: string | null;
};

type Payload = {
  thresholds: ThresholdRow[];
  activeCount: number;
  catalogue: MetricDefinition[];
  message: string;
};

const SEVERITIES = ["low", "medium", "high", "critical"] as const;

const inputClass =
  "mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-900";

function Field({ label, hint, children, wide = false }: { label: string; hint?: string; children: React.ReactNode; wide?: boolean }) {
  return (
    <label className={`text-xs font-bold text-slate-600 ${wide ? "sm:col-span-2" : ""}`}>
      {label}
      {children}
      {hint ? <span className="mt-1 block text-[11px] font-semibold text-slate-400">{hint}</span> : null}
    </label>
  );
}

function when(iso: string | null): string {
  return iso ? new Date(iso).toLocaleString("en-ZA") : "—";
}

export default function ThresholdEditor({ companyId }: { companyId: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [showRetired, setShowRetired] = useState(false);

  const [metricKey, setMetricKey] = useState("");
  const [serviceCode, setServiceCode] = useState("");
  const [counterpartyId, setCounterpartyId] = useState("");
  const [targetValue, setTargetValue] = useState("");
  const [warningValue, setWarningValue] = useState("");
  const [criticalValue, setCriticalValue] = useState("");
  const [severity, setSeverity] = useState<string>("medium");
  const [effectiveFrom, setEffectiveFrom] = useState("");
  const [notes, setNotes] = useState("");

  const poll = useRrPoll<Payload>(
    () =>
      rrFetchJson<Payload>(
        `/api/road-recovery/intelligence/thresholds?companyId=${encodeURIComponent(companyId)}`
      ),
    RR_POLL_INTERVALS.intelligence,
    { enabled: Boolean(companyId) }
  );

  const [counterparties, setCounterparties] = useState<{ id: string; legal_name: string }[]>([]);
  const [serviceCodes, setServiceCodes] = useState<string[]>([]);
  const scopeReady = counterparties.length > 0 || serviceCodes.length > 0;

  // Scope options come from the tenant's OWN catalogue and counterparties, so a target can
  // only be scoped to something this company actually operates.
  async function loadScopes() {
    if (scopeReady) return;
    try {
      const [parties, board] = await Promise.all([
        rrFetchJson<{ counterparties: { id: string; legal_name: string }[] }>(
          `/api/road-recovery/counterparties?companyId=${encodeURIComponent(companyId)}`
        ),
        rrFetchJson<{ serviceTypes: { service_code: string }[] }>(
          `/api/road-recovery/board?companyId=${encodeURIComponent(companyId)}`
        ),
      ]);
      setCounterparties(parties.counterparties || []);
      setServiceCodes([...new Set((board.serviceTypes || []).map((entry) => entry.service_code))].sort());
    } catch {
      // Scoping is optional; a company-wide target is still publishable without this.
    }
  }

  // Memoised so the empty-array fallback is not a fresh reference on every render, which
  // would make both useMemo blocks below recompute for no reason.
  const catalogue = useMemo(() => poll.data?.catalogue ?? [], [poll.data]);
  const definition = useMemo(
    () => catalogue.find((entry) => entry.key === metricKey) ?? null,
    [catalogue, metricKey]
  );

  const byDomain = useMemo(() => {
    const map = new Map<string, MetricDefinition[]>();
    for (const entry of catalogue) {
      if (!map.has(entry.domain)) map.set(entry.domain, []);
      map.get(entry.domain)?.push(entry);
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [catalogue]);

  const active = (poll.data?.thresholds ?? []).filter((row) => row.active);
  const retired = (poll.data?.thresholds ?? []).filter((row) => !row.active);

  async function act(run: () => Promise<string>) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      setNotice(await run());
      poll.refresh();
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : "That did not work.");
    } finally {
      setBusy(false);
    }
  }

  const publish = () =>
    act(async () => {
      const result = await rrFetchJson<{ version: number; retiredVersion: number | null }>(
        "/api/road-recovery/intelligence/thresholds",
        {
          method: "POST",
          body: JSON.stringify({
            companyId,
            metricKey,
            serviceCode: definition?.scopes.serviceCode ? serviceCode || null : null,
            counterpartyId: definition?.scopes.counterparty ? counterpartyId || null : null,
            targetValue: Number(targetValue),
            warningValue: warningValue.trim() === "" ? null : Number(warningValue),
            criticalValue: criticalValue.trim() === "" ? null : Number(criticalValue),
            unit: definition?.unit || "",
            severity,
            effectiveFrom: effectiveFrom ? new Date(effectiveFrom).toISOString() : null,
            notes: notes.trim() || null,
          }),
        }
      );
      setShowForm(false);
      setTargetValue("");
      setWarningValue("");
      setCriticalValue("");
      setNotes("");
      return result.retiredVersion
        ? `Published version ${result.version}. Version ${result.retiredVersion} was retired and stays on record, so past results still replay against it.`
        : `Published version ${result.version}.`;
    });

  const retire = (row: ThresholdRow) =>
    act(async () => {
      await rrFetchJson("/api/road-recovery/intelligence/thresholds", {
        method: "PATCH",
        body: JSON.stringify({ companyId, thresholdId: row.id }),
      });
      return `Target retired. ${row.metricKey} returns to NO SLA CONFIGURED and is excluded from scoring rather than counted as zero.`;
    });

  function editFrom(row: ThresholdRow) {
    setMetricKey(row.metricKey);
    setServiceCode(row.serviceCode || "");
    setCounterpartyId(row.counterpartyId || "");
    setTargetValue(String(row.targetValue));
    setWarningValue(row.warningValue == null ? "" : String(row.warningValue));
    setCriticalValue(row.criticalValue == null ? "" : String(row.criticalValue));
    setSeverity(row.severity);
    setNotes("");
    setEffectiveFrom("");
    setShowForm(true);
    void loadScopes();
  }

  return (
    <div className="space-y-5">
      <header className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-black text-slate-900">Operational targets</h1>
            <p className="mt-1 max-w-3xl text-sm text-slate-500">
              What good looks like for this business. Until a metric has a target it reads
              NO SLA CONFIGURED, is excluded from the health score rather than counted as
              zero, and can raise no recommendation. Nothing here is pre-filled — the system
              will not decide your service levels for you.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                setShowForm((open) => !open);
                setNotice(null);
                setError(null);
                void loadScopes();
              }}
              className="rounded-xl bg-cyan-700 px-4 py-2 text-sm font-bold text-white"
            >
              {showForm ? "Close" : "Set a target"}
            </button>
            <button
              onClick={poll.refresh}
              disabled={poll.loading}
              className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-bold text-cyan-300 disabled:opacity-50"
            >
              {poll.loading ? "Refreshing…" : "Refresh"}
            </button>
          </div>
        </div>
        <p className="mt-3 rounded-2xl bg-slate-50 px-4 py-3 text-xs font-semibold text-slate-600">
          {poll.data?.message ?? "Loading targets…"}
        </p>
      </header>

      {error ? (
        <p className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-800">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-800">
          {notice}
        </p>
      ) : null}

      {showForm ? (
        <section className="rounded-3xl border border-slate-300 bg-white p-5 shadow-sm">
          <h2 className="text-lg font-black text-slate-900">Publish a target</h2>
          <p className="mt-1 text-xs font-semibold text-slate-500">
            Publishing retires the current version and records a new one. The old version is
            kept, not overwritten, so a breach judged last month can still be replayed
            against the target that applied then.
          </p>

          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <Field label="Metric" wide hint={definition ? definition.source : "Only metrics the system already measures can carry a target."}>
              <select
                aria-label="Metric"
                value={metricKey}
                onChange={(event) => {
                  setMetricKey(event.target.value);
                  setServiceCode("");
                  setCounterpartyId("");
                }}
                className={inputClass}
              >
                <option value="">Select a metric…</option>
                {byDomain.map(([domain, entries]) => (
                  <optgroup key={domain} label={domain.replace(/_/g, " ")}>
                    {entries.map((entry) => (
                      <option key={entry.key} value={entry.key}>
                        {entry.label} ({entry.unit})
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </Field>

            {definition ? (
              <p className="rounded-2xl bg-slate-50 px-4 py-3 text-xs font-semibold text-slate-600 sm:col-span-2">
                {definition.label} is measured in <strong>{definition.unit}</strong> and{" "}
                <strong>{definition.direction === "lower_is_better" ? "lower is better" : "higher is better"}</strong>.
                It carries a health weight of {definition.healthWeight}
                {definition.healthWeight === 0 ? " — informational, reported but never scored." : "."}
              </p>
            ) : null}

            <Field label={`Target${definition ? ` (${definition.unit})` : ""}`} hint="The value the business commits to.">
              <input
                aria-label="Target"
                value={targetValue}
                onChange={(event) => setTargetValue(event.target.value)}
                inputMode="decimal"
                className={inputClass}
              />
            </Field>

            <Field label="Severity" hint="How hard a breach escalates once it becomes an action.">
              <select
                aria-label="Severity"
                value={severity}
                onChange={(event) => setSeverity(event.target.value)}
                className={inputClass}
              >
                {SEVERITIES.map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="Warning band" hint="Optional. Where the metric stops being on target.">
              <input
                aria-label="Warning band"
                value={warningValue}
                onChange={(event) => setWarningValue(event.target.value)}
                inputMode="decimal"
                className={inputClass}
              />
            </Field>

            <Field label="Critical band" hint="Optional. Must differ from the warning band.">
              <input
                aria-label="Critical band"
                value={criticalValue}
                onChange={(event) => setCriticalValue(event.target.value)}
                inputMode="decimal"
                className={inputClass}
              />
            </Field>

            {definition?.scopes.serviceCode ? (
              <Field label="Service" hint="Leave blank to apply to every service.">
                <select
                  aria-label="Service"
                  value={serviceCode}
                  onChange={(event) => setServiceCode(event.target.value)}
                  className={inputClass}
                >
                  <option value="">All services</option>
                  {serviceCodes.map((code) => (
                    <option key={code} value={code}>
                      {code.replace(/_/g, " ")}
                    </option>
                  ))}
                </select>
              </Field>
            ) : null}

            {definition?.scopes.counterparty ? (
              <Field label="Counterparty" hint="Leave blank to apply to every counterparty.">
                <select
                  aria-label="Counterparty"
                  value={counterpartyId}
                  onChange={(event) => setCounterpartyId(event.target.value)}
                  className={inputClass}
                >
                  <option value="">All counterparties</option>
                  {counterparties.map((entry) => (
                    <option key={entry.id} value={entry.id}>
                      {entry.legal_name}
                    </option>
                  ))}
                </select>
              </Field>
            ) : null}

            <Field label="Effective from" hint="Leave blank to apply from now.">
              <input
                aria-label="Effective from"
                type="datetime-local"
                value={effectiveFrom}
                onChange={(event) => setEffectiveFrom(event.target.value)}
                className={inputClass}
              />
            </Field>

            <Field label="Why this target" wide hint="Recorded against the version, so a later reader knows what it was for.">
              <input
                aria-label="Why this target"
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
                placeholder="Agreed with Cape Mutual in the March service review."
                className={inputClass}
              />
            </Field>
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busy || !metricKey || targetValue.trim() === ""}
              onClick={publish}
              className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-bold text-cyan-300 disabled:opacity-40"
            >
              {busy ? "Publishing…" : "Publish target"}
            </button>
            <button
              type="button"
              onClick={() => setShowForm(false)}
              className="rounded-xl bg-slate-200 px-4 py-2 text-sm font-bold text-slate-700"
            >
              Cancel
            </button>
          </div>
        </section>
      ) : null}

      <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-sm font-black uppercase tracking-wide text-slate-700">
          In force ({active.length})
        </h2>
        {active.length === 0 ? (
          <p className="mt-3 text-sm font-semibold text-slate-500">
            No operational targets are configured. Every metric reads NO SLA CONFIGURED, the
            health score is not reported, and no target-based recommendation can be raised.
          </p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[880px] text-left text-xs">
              <thead>
                <tr className="text-[10px] font-black uppercase tracking-wide text-slate-500">
                  <th className="pb-2">Metric</th>
                  <th className="pb-2">Scope</th>
                  <th className="pb-2">Target</th>
                  <th className="pb-2">Warning</th>
                  <th className="pb-2">Critical</th>
                  <th className="pb-2">Severity</th>
                  <th className="pb-2">Version</th>
                  <th className="pb-2">From</th>
                  <th className="pb-2">Set by</th>
                  <th className="pb-2" />
                </tr>
              </thead>
              <tbody>
                {active.map((row) => {
                  const meta = catalogue.find((entry) => entry.key === row.metricKey);
                  return (
                    <tr key={row.id} className="border-t border-slate-100 align-top">
                      <td className="py-2 pr-3 font-bold text-slate-900">
                        {meta?.label || row.metricKey}
                        {row.notes ? (
                          <span className="mt-0.5 block text-[11px] font-semibold text-slate-500">{row.notes}</span>
                        ) : null}
                      </td>
                      <td className="py-2 pr-3 text-slate-600">
                        {row.serviceCode ? row.serviceCode.replace(/_/g, " ") : "all services"}
                        {row.counterpartyId ? " · one counterparty" : ""}
                      </td>
                      <td className="py-2 pr-3 font-mono font-bold text-slate-900">
                        {row.targetValue} {row.unit}
                      </td>
                      <td className="py-2 pr-3 font-mono text-slate-600">{row.warningValue ?? "—"}</td>
                      <td className="py-2 pr-3 font-mono text-slate-600">{row.criticalValue ?? "—"}</td>
                      <td className="py-2 pr-3 font-bold text-slate-700">{row.severity}</td>
                      <td className="py-2 pr-3 font-mono text-slate-600">v{row.version}</td>
                      <td className="py-2 pr-3 text-slate-500">{when(row.effectiveFrom)}</td>
                      <td className="py-2 pr-3 text-slate-500">{row.createdBy || "—"}</td>
                      <td className="py-2">
                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={() => editFrom(row)}
                            className="rounded-lg bg-slate-100 px-2.5 py-1 text-[11px] font-bold text-slate-700"
                          >
                            Edit as new version
                          </button>
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => retire(row)}
                            className="rounded-lg bg-white px-2.5 py-1 text-[11px] font-bold text-rose-700 ring-1 ring-rose-200 disabled:opacity-40"
                          >
                            Retire
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-black uppercase tracking-wide text-slate-700">
            Retired versions ({retired.length})
          </h2>
          <button
            type="button"
            onClick={() => setShowRetired((open) => !open)}
            className="text-xs font-bold text-slate-500"
          >
            {showRetired ? "Hide" : "Show"}
          </button>
        </div>
        <p className="mt-1 text-xs font-semibold text-slate-500">
          Kept, never deleted. A measurement taken while one of these was in force is still
          judged against it.
        </p>
        {showRetired && retired.length > 0 ? (
          <ul className="mt-3 space-y-2">
            {retired.map((row) => (
              <li key={row.id} className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs">
                <span className="font-bold text-slate-900">
                  {catalogue.find((entry) => entry.key === row.metricKey)?.label || row.metricKey} v{row.version}
                </span>
                <span className="text-slate-600">
                  {" "}— target {row.targetValue} {row.unit}, in force {when(row.effectiveFrom)} to {when(row.effectiveTo)}
                  {row.retiredBy ? `, retired by ${row.retiredBy}` : ""}
                </span>
              </li>
            ))}
          </ul>
        ) : null}
      </section>
    </div>
  );
}

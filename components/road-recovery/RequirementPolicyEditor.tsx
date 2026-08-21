"use client";

/**
 * Counterparty Requirements editor (Phase 3).
 *
 * Insurer and fleet requirements are CONTRACTUAL and differ per counterparty, so they are
 * configured here as data. Nothing in the codebase hardcodes a particular insurer's rules.
 *
 * Editing publishes a NEW VERSION rather than mutating the current one: jobs already
 * created keep the frozen snapshot they were measured against, and a verdict already
 * shown to a counterparty stays reconcilable with the rule that produced it.
 */

import React, { useCallback, useMemo, useState } from "react";
import { RR_POLL_INTERVALS, rrFetchJson, useRrPoll } from "@/lib/road-recovery/use-rr-poll";

type PolicyItem = {
  requirementCode: string;
  label: string;
  evidenceKind: string;
  mandatory: boolean;
  condition: Record<string, unknown>;
  minCount: number;
  blockingScopes: string[];
  guidance?: string;
  sortOrder: number;
};

type Policy = {
  policyKey: string;
  counterpartyId: string | null;
  serviceCode: string | null;
  version: number;
  active: boolean;
  effectiveFrom: string | null;
  effectiveTo: string | null;
  requirements: PolicyItem[];
};

type PoliciesPayload = {
  policies: Policy[];
  evidenceKinds: string[];
  blockingScopes: string[];
};

type Counterparty = { id: string; legal_name: string; counterparty_code: string };

const SERVICE_CODES = [
  "accident_recovery",
  "tow_in",
  "jump_start",
  "roadside_assistance",
  "bystand",
  "heavy_recovery",
  "vehicle_movement",
  "storage",
];

function blankItem(index: number): PolicyItem {
  return {
    requirementCode: "",
    label: "",
    evidenceKind: "photo",
    mandatory: true,
    condition: { always: true },
    minCount: 1,
    blockingScopes: ["invoice"],
    sortOrder: (index + 1) * 10,
  };
}

export default function RequirementPolicyEditor({ companyId }: { companyId: string }) {
  const [selectedKey, setSelectedKey] = useState<string>("");
  const [draftItems, setDraftItems] = useState<PolicyItem[] | null>(null);
  const [draftKey, setDraftKey] = useState("");
  const [draftLabel, setDraftLabel] = useState("");
  const [draftCounterparty, setDraftCounterparty] = useState("");
  const [draftService, setDraftService] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  const fetcher = useCallback(async () => {
    const query = `companyId=${encodeURIComponent(companyId)}`;
    const [policies, counterparties] = await Promise.all([
      rrFetchJson<PoliciesPayload>(`/api/road-recovery/requirements/policies?${query}`),
      rrFetchJson<{ counterparties: Counterparty[] }>(
        `/api/road-recovery/counterparties?${query}`
      ),
    ]);
    return { ...policies, counterparties: counterparties.counterparties || [] };
  }, [companyId]);

  const poll = useRrPoll<PoliciesPayload & { counterparties: Counterparty[] }>(
    fetcher,
    RR_POLL_INTERVALS.driverIdle,
    { enabled: Boolean(companyId) }
  );

  const refresh = poll.refresh;
  const policies = useMemo(() => poll.data?.policies ?? [], [poll.data]);
  // Memoised because counterpartyName() closes over it: a fresh [] on every render would
  // make that callback — and everything depending on it — change identity every time.
  const counterparties = useMemo(() => poll.data?.counterparties ?? [], [poll.data]);
  const evidenceKinds = poll.data?.evidenceKinds ?? [];

  const active = useMemo(
    () => policies.filter((policy) => policy.active).sort((a, b) => a.policyKey.localeCompare(b.policyKey)),
    [policies]
  );
  const superseded = useMemo(
    () => policies.filter((policy) => !policy.active).sort((a, b) => b.version - a.version),
    [policies]
  );

  const selected = useMemo(
    () => policies.find((policy) => policy.active && policy.policyKey === selectedKey) ?? null,
    [policies, selectedKey]
  );

  const counterpartyName = useCallback(
    (id: string | null) => {
      if (!id) return "All counterparties";
      const match = counterparties.find((entry) => entry.id === id);
      return match ? match.legal_name : id;
    },
    [counterparties]
  );

  const startFrom = useCallback((policy: Policy | null) => {
    setSaved(null);
    setSaveError(null);
    if (!policy) {
      setDraftKey("");
      setDraftLabel("");
      setDraftCounterparty("");
      setDraftService("");
      setDraftItems([blankItem(0)]);
      return;
    }
    setDraftKey(policy.policyKey);
    setDraftLabel("");
    setDraftCounterparty(policy.counterpartyId || "");
    setDraftService(policy.serviceCode || "");
    setDraftItems(policy.requirements.map((item) => ({ ...item })));
  }, []);

  const patchItem = useCallback((index: number, patch: Partial<PolicyItem>) => {
    setDraftItems((current) => {
      if (!current) return current;
      const next = [...current];
      next[index] = { ...next[index], ...patch };
      return next;
    });
  }, []);

  const publish = useCallback(async () => {
    if (!draftItems) return;
    setSaving(true);
    setSaveError(null);
    setSaved(null);
    try {
      const result = await rrFetchJson<{ policyKey: string; version: number }>(
        "/api/road-recovery/requirements/policies",
        {
          method: "POST",
          body: JSON.stringify({
            companyId,
            policyKey: draftKey,
            label: draftLabel || null,
            counterpartyId: draftCounterparty || null,
            serviceCode: draftService || null,
            items: draftItems,
          }),
        }
      );
      setSaved(`Published ${result.policyKey} v${result.version}.`);
      setDraftItems(null);
      refresh();
    } catch (error: unknown) {
      setSaveError(error instanceof Error ? error.message : "Could not publish the policy.");
    } finally {
      setSaving(false);
    }
  }, [companyId, draftCounterparty, draftItems, draftKey, draftLabel, draftService, refresh]);

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-4">
        <div>
          <h2 className="text-lg font-black text-slate-900">Requirement policies</h2>
          <p className="text-sm font-semibold text-slate-500">
            {active.length} active · {superseded.length} superseded. Editing publishes a new
            version; existing jobs keep the version they were created under.
          </p>
        </div>
        <button
          type="button"
          onClick={() => startFrom(null)}
          className="rounded-xl bg-slate-900 px-3 py-2 text-xs font-bold text-cyan-300 hover:bg-slate-800"
        >
          New policy
        </button>
      </header>

      {saved ? (
        <p className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-bold text-emerald-800">
          {saved}
        </p>
      ) : null}
      {saveError ? (
        <p className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-800">
          {saveError}
        </p>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
        <aside className="space-y-2">
          {poll.initialLoading ? (
            <p className="text-sm font-semibold text-slate-500">Loading policies…</p>
          ) : poll.error ? (
            <p className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-800">
              {poll.error}
            </p>
          ) : (
            active.map((policy) => (
              <button
                key={`${policy.policyKey}-${policy.version}`}
                type="button"
                onClick={() => {
                  setSelectedKey(policy.policyKey);
                  setDraftItems(null);
                }}
                className={`w-full rounded-2xl border p-3 text-left ${
                  selectedKey === policy.policyKey
                    ? "border-slate-900 bg-slate-900 text-cyan-200"
                    : "border-slate-200 bg-white text-slate-800 hover:bg-slate-50"
                }`}
              >
                <p className="text-sm font-black">{policy.policyKey.replace(/_/g, " ")}</p>
                <p className="text-xs font-semibold opacity-80">
                  v{policy.version} · {policy.serviceCode || "all services"} ·{" "}
                  {counterpartyName(policy.counterpartyId)}
                </p>
                <p className="text-xs font-semibold opacity-60">
                  {policy.requirements.length} requirements
                </p>
              </button>
            ))
          )}
        </aside>

        <section className="space-y-4">
          {draftItems ? (
            <div className="rounded-2xl border border-slate-300 bg-white p-4">
              <h3 className="text-sm font-black text-slate-900">Publish a new version</h3>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <label className="text-xs font-bold text-slate-600">
                  Policy key
                  <input
                    value={draftKey}
                    onChange={(event) => setDraftKey(event.target.value)}
                    placeholder="e.g. santam_accident_recovery"
                    className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm font-semibold"
                  />
                </label>
                <label className="text-xs font-bold text-slate-600">
                  Label
                  <input
                    value={draftLabel}
                    onChange={(event) => setDraftLabel(event.target.value)}
                    className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm font-semibold"
                  />
                </label>
                <label className="text-xs font-bold text-slate-600">
                  Counterparty
                  <select
                    value={draftCounterparty}
                    onChange={(event) => setDraftCounterparty(event.target.value)}
                    className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm font-semibold"
                  >
                    <option value="">All counterparties (tenant default)</option>
                    {counterparties.map((entry) => (
                      <option key={entry.id} value={entry.id}>
                        {entry.legal_name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-xs font-bold text-slate-600">
                  Service
                  <select
                    value={draftService}
                    onChange={(event) => setDraftService(event.target.value)}
                    className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm font-semibold"
                  >
                    <option value="">All services</option>
                    {SERVICE_CODES.map((code) => (
                      <option key={code} value={code}>
                        {code.replace(/_/g, " ")}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <ul className="mt-4 space-y-3">
                {draftItems.map((item, index) => (
                  <li key={index} className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
                    <div className="grid gap-2 sm:grid-cols-2">
                      <input
                        value={item.requirementCode}
                        onChange={(event) =>
                          patchItem(index, { requirementCode: event.target.value })
                        }
                        placeholder="requirement_code"
                        className="rounded-xl border border-slate-300 px-3 py-2 text-sm font-semibold"
                      />
                      <input
                        value={item.label}
                        onChange={(event) => patchItem(index, { label: event.target.value })}
                        placeholder="What the driver is asked for"
                        className="rounded-xl border border-slate-300 px-3 py-2 text-sm font-semibold"
                      />
                      <select
                        value={item.evidenceKind}
                        onChange={(event) => patchItem(index, { evidenceKind: event.target.value })}
                        className="rounded-xl border border-slate-300 px-3 py-2 text-sm font-semibold"
                      >
                        {evidenceKinds.map((kind) => (
                          <option key={kind} value={kind}>
                            {kind}
                          </option>
                        ))}
                      </select>
                      <input
                        type="number"
                        min={1}
                        value={item.minCount}
                        onChange={(event) =>
                          patchItem(index, { minCount: Math.max(1, Number(event.target.value) || 1) })
                        }
                        className="rounded-xl border border-slate-300 px-3 py-2 text-sm font-semibold"
                      />
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-3">
                      <label className="flex items-center gap-2 text-xs font-bold text-slate-700">
                        <input
                          type="checkbox"
                          checked={item.mandatory}
                          onChange={(event) => patchItem(index, { mandatory: event.target.checked })}
                        />
                        Mandatory
                      </label>
                      <label className="flex items-center gap-2 text-xs font-bold text-slate-700">
                        <input
                          type="checkbox"
                          checked={item.blockingScopes.includes("invoice")}
                          onChange={(event) =>
                            patchItem(index, {
                              blockingScopes: event.target.checked ? ["invoice"] : [],
                            })
                          }
                        />
                        Blocks invoicing
                      </label>
                      <button
                        type="button"
                        onClick={() =>
                          setDraftItems((current) =>
                            current ? current.filter((_, position) => position !== index) : current
                          )
                        }
                        className="ml-auto rounded-xl bg-white px-3 py-1.5 text-xs font-bold text-rose-700"
                      >
                        Remove
                      </button>
                    </div>
                  </li>
                ))}
              </ul>

              <div className="mt-4 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() =>
                    setDraftItems((current) =>
                      current ? [...current, blankItem(current.length)] : current
                    )
                  }
                  className="rounded-xl bg-slate-200 px-3 py-2 text-xs font-bold text-slate-800"
                >
                  Add requirement
                </button>
                <button
                  type="button"
                  disabled={saving || !draftKey || draftItems.length === 0}
                  onClick={publish}
                  className="rounded-xl bg-slate-900 px-3 py-2 text-xs font-bold text-cyan-300 disabled:opacity-40"
                >
                  {saving ? "Publishing…" : "Publish new version"}
                </button>
                <button
                  type="button"
                  onClick={() => setDraftItems(null)}
                  className="rounded-xl bg-white px-3 py-2 text-xs font-bold text-slate-600"
                >
                  Discard
                </button>
              </div>
            </div>
          ) : selected ? (
            <div className="rounded-2xl border border-slate-200 bg-white p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h3 className="text-sm font-black text-slate-900">
                    {selected.policyKey.replace(/_/g, " ")} · v{selected.version}
                  </h3>
                  <p className="text-xs font-semibold text-slate-500">
                    {counterpartyName(selected.counterpartyId)} ·{" "}
                    {selected.serviceCode || "all services"}
                    {selected.effectiveFrom
                      ? ` · effective from ${new Date(selected.effectiveFrom).toLocaleDateString("en-ZA")}`
                      : ""}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => startFrom(selected)}
                  className="rounded-xl bg-slate-900 px-3 py-2 text-xs font-bold text-cyan-300"
                >
                  Edit as new version
                </button>
              </div>

              <div className="mt-3 overflow-x-auto">
                <table className="w-full min-w-[640px] text-left text-xs">
                  <thead className="text-slate-500">
                    <tr>
                      <th className="py-1 pr-3 font-bold">Requirement</th>
                      <th className="py-1 pr-3 font-bold">Kind</th>
                      <th className="py-1 pr-3 font-bold">Min</th>
                      <th className="py-1 pr-3 font-bold">Mandatory</th>
                      <th className="py-1 pr-3 font-bold">Blocks</th>
                      <th className="py-1 pr-3 font-bold">Condition</th>
                    </tr>
                  </thead>
                  <tbody className="font-semibold text-slate-800">
                    {[...selected.requirements]
                      .sort((a, b) => a.sortOrder - b.sortOrder)
                      .map((item) => (
                        <tr key={item.requirementCode} className="border-t border-slate-100">
                          <td className="py-1.5 pr-3">
                            {item.label}
                            <span className="block text-[11px] font-medium text-slate-400">
                              {item.requirementCode}
                            </span>
                          </td>
                          <td className="py-1.5 pr-3">{item.evidenceKind}</td>
                          <td className="py-1.5 pr-3">{item.minCount}</td>
                          <td className="py-1.5 pr-3">{item.mandatory ? "yes" : "no"}</td>
                          <td className="py-1.5 pr-3">{item.blockingScopes.join(", ") || "—"}</td>
                          <td className="py-1.5 pr-3 font-mono text-[11px]">
                            {JSON.stringify(item.condition)}
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            <div className="rounded-2xl border border-slate-200 bg-white p-6">
              <p className="text-sm font-semibold text-slate-600">
                Select a policy to review its requirements, or create a new one.
              </p>
            </div>
          )}

          {superseded.length > 0 ? (
            <div className="rounded-2xl border border-slate-200 bg-white p-4">
              <h4 className="text-xs font-bold uppercase tracking-wide text-slate-500">
                Superseded versions ({superseded.length})
              </h4>
              <ul className="mt-2 space-y-1">
                {superseded.map((policy) => (
                  <li
                    key={`${policy.policyKey}-${policy.version}`}
                    className="text-xs font-semibold text-slate-600"
                  >
                    {policy.policyKey.replace(/_/g, " ")} v{policy.version} ·{" "}
                    {policy.requirements.length} requirements
                    {policy.effectiveTo
                      ? ` · closed ${new Date(policy.effectiveTo).toLocaleDateString("en-ZA")}`
                      : ""}
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-xs font-medium text-slate-400">
                Kept deliberately: a job created under an older version was measured against
                that version, and its verdict must stay reconcilable with it.
              </p>
            </div>
          ) : null}
        </section>
      </div>
    </div>
  );
}

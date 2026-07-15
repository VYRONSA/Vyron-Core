"use client";

import React, { useEffect, useState } from "react";
import { Clock } from "lucide-react";
import { supabase } from "@/lib/supabase";
import {
  DEFAULT_SESSION_ABSOLUTE_TIMEOUT_MINUTES,
  DEFAULT_SESSION_IDLE_TIMEOUT_MINUTES,
  MAX_SESSION_ABSOLUTE_TIMEOUT_MINUTES,
  MAX_SESSION_IDLE_TIMEOUT_MINUTES,
  MIN_SESSION_ABSOLUTE_TIMEOUT_MINUTES,
  MIN_SESSION_IDLE_TIMEOUT_MINUTES,
} from "@/lib/server/session-validation";

type Props = {
  companyId: string;
};

/** Phase 1C Task 2 — lets an owner/platform operator configure this company's idle and
 * absolute session timeout. Bounds mirror the CHECK constraints in
 * sql/061-session-security-hardening.sql; evaluateSessionValidity() falls back to the
 * same safe defaults shown here when a value is unset. */
export default function SessionTimeoutSettingsPanel({ companyId }: Props) {
  const [idleMinutes, setIdleMinutes] = useState(DEFAULT_SESSION_IDLE_TIMEOUT_MINUTES);
  const [absoluteMinutes, setAbsoluteMinutes] = useState(DEFAULT_SESSION_ABSOLUTE_TIMEOUT_MINUTES);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (!companyId) return;
      setLoading(true);
      const { data } = await supabase
        .from("companies")
        .select("session_idle_timeout_minutes,session_absolute_timeout_minutes")
        .eq("id", companyId)
        .maybeSingle();

      if (cancelled) return;
      setIdleMinutes(data?.session_idle_timeout_minutes ?? DEFAULT_SESSION_IDLE_TIMEOUT_MINUTES);
      setAbsoluteMinutes(
        data?.session_absolute_timeout_minutes ?? DEFAULT_SESSION_ABSOLUTE_TIMEOUT_MINUTES
      );
      setLoading(false);
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [companyId]);

  async function handleSave() {
    if (!companyId) return;
    setSaving(true);
    setError(null);
    setMessage(null);

    const clampedIdle = Math.min(
      Math.max(Math.round(idleMinutes), MIN_SESSION_IDLE_TIMEOUT_MINUTES),
      MAX_SESSION_IDLE_TIMEOUT_MINUTES
    );
    const clampedAbsolute = Math.min(
      Math.max(Math.round(absoluteMinutes), MIN_SESSION_ABSOLUTE_TIMEOUT_MINUTES),
      MAX_SESSION_ABSOLUTE_TIMEOUT_MINUTES
    );

    const { error: updateError } = await supabase
      .from("companies")
      .update({
        session_idle_timeout_minutes: clampedIdle,
        session_absolute_timeout_minutes: clampedAbsolute,
      })
      .eq("id", companyId);

    setIdleMinutes(clampedIdle);
    setAbsoluteMinutes(clampedAbsolute);
    setSaving(false);

    if (updateError) {
      setError(updateError.message);
      return;
    }
    setMessage("Session timeout settings saved.");
  }

  return (
    <div className="rounded-[2rem] border border-slate-200/80 bg-white p-6 shadow-sm">
      <div className="flex items-center gap-2">
        <Clock className="h-5 w-5 text-cyan-700" />
        <h3 className="text-xl font-black text-slate-950">Session Timeout</h3>
      </div>
      <p className="mt-2 text-sm text-slate-500">
        How long a signed-in session can stay idle, and its maximum lifetime, before this
        workspace requires signing in again.
      </p>

      {loading ? (
        <p className="mt-6 text-sm text-slate-500">Loading current settings...</p>
      ) : (
        <>
          <div className="mt-6 grid gap-4 md:grid-cols-2">
            <label className="text-sm font-bold">
              Idle timeout (minutes)
              <input
                type="number"
                min={MIN_SESSION_IDLE_TIMEOUT_MINUTES}
                max={MAX_SESSION_IDLE_TIMEOUT_MINUTES}
                value={idleMinutes}
                onChange={(event) => setIdleMinutes(Number(event.target.value))}
                className="vyron-input vyron-focus-ring mt-2"
              />
              <span className="mt-1 block text-xs font-medium text-slate-400">
                {MIN_SESSION_IDLE_TIMEOUT_MINUTES}-{MAX_SESSION_IDLE_TIMEOUT_MINUTES} minutes
              </span>
            </label>
            <label className="text-sm font-bold">
              Absolute session lifetime (minutes)
              <input
                type="number"
                min={MIN_SESSION_ABSOLUTE_TIMEOUT_MINUTES}
                max={MAX_SESSION_ABSOLUTE_TIMEOUT_MINUTES}
                value={absoluteMinutes}
                onChange={(event) => setAbsoluteMinutes(Number(event.target.value))}
                className="vyron-input vyron-focus-ring mt-2"
              />
              <span className="mt-1 block text-xs font-medium text-slate-400">
                {MIN_SESSION_ABSOLUTE_TIMEOUT_MINUTES}-{MAX_SESSION_ABSOLUTE_TIMEOUT_MINUTES} minutes
              </span>
            </label>
          </div>

          {error ? (
            <div className="mt-4 rounded-2xl bg-rose-50 p-4 text-sm font-semibold text-rose-700">
              {error}
            </div>
          ) : null}
          {message ? (
            <div className="mt-4 rounded-2xl bg-emerald-50 p-4 text-sm font-semibold text-emerald-800">
              {message}
            </div>
          ) : null}

          <button
            type="button"
            disabled={saving}
            onClick={() => void handleSave()}
            className="mt-6 flex w-fit items-center gap-2 rounded-2xl bg-[#06101f] px-5 py-3 text-sm font-black text-cyan-300 shadow-lg shadow-cyan-950/15 disabled:opacity-50"
          >
            {saving ? "Saving..." : "Save Session Settings"}
          </button>
        </>
      )}
    </div>
  );
}

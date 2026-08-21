"use client";

/**
 * Scoped polling for Road & Recovery screens (Phase 1).
 *
 * WHY POLLING AND NOT SUPABASE REALTIME
 *
 * There is no realtime anywhere in VYRON CORE: no `supabase_realtime` publication in any
 * migration, no channel subscription in any component, and the browser client is
 * created by @supabase/ssr with no realtime configuration. Introducing it would mean
 * adding tables to a replication publication, changing REPLICA IDENTITY, and validating
 * that RLS is correctly applied to the replication stream — a platform-wide security
 * surface that a single vertical should not open on its own.
 *
 * So Phase 1 polls, deliberately and narrowly:
 *
 *   Dispatch Board        15s
 *   Live Operations Wall  20s
 *   Driver, active job    30s
 *   Driver, idle          60s
 *
 * Polling PAUSES while the tab is hidden, so a backgrounded board costs nothing, and
 * every screen exposes a manual refresh. This hook is used only by Road & Recovery
 * routes; no existing screen is affected and no global architecture is introduced.
 */

import { useCallback, useEffect, useRef, useState } from "react";

export const RR_POLL_INTERVALS = {
  dispatchBoard: 15_000,
  liveOperations: 20_000,
  driverActive: 30_000,
  driverIdle: 60_000,
  // Intelligence aggregates a month of history. Polling it at board speed would re-run
  // every domain calculation for a screen nobody watches second by second.
  intelligence: 120_000,
} as const;

export type RrPollState<T> = {
  data: T | null;
  error: string | null;
  loading: boolean;
  /** True only for the first load, so the UI can distinguish it from a refresh. */
  initialLoading: boolean;
  lastUpdatedAt: string | null;
  refresh: () => void;
  paused: boolean;
};

/**
 * Polls `fetcher` on an interval, pausing while the document is hidden.
 *
 * A refresh triggered while one is already in flight is ignored rather than queued, so a
 * slow network cannot build a backlog of overlapping requests.
 */
export function useRrPoll<T>(
  fetcher: () => Promise<T>,
  intervalMs: number,
  options: { enabled?: boolean; key?: string } = {}
): RrPollState<T> {
  const enabled = options.enabled !== false;
  /**
   * What the fetcher reads, expressed as a value.
   *
   * The fetcher itself is held in a ref (below) so an inline closure does not restart the
   * interval on every render — but that also meant a caller who CHANGED what it fetches
   * (a different billing report, a different job, a new date filter) got no refetch at
   * all, and the screen kept showing the previous selection's data under the new
   * heading until the next tick, which for the billing screen is a full minute.
   *
   * `key` is the caller's statement of what the fetcher depends on. Changing it refetches
   * immediately; leaving it undefined preserves the original behaviour exactly.
   */
  const key = options.key ?? "";

  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  // Set only from the async completion path, never synchronously inside an effect body.
  const [loadedOnce, setLoadedOnce] = useState(false);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<string | null>(null);
  const [paused, setPaused] = useState(false);

  /**
   * The key a request is currently in flight FOR, or null when nothing is in flight.
   *
   * A plain boolean was not enough once `key` existed: a click that lands while the
   * previous report is still loading would be dropped as "already in flight", and the
   * slower response would then be written over the newer selection. Tracking the key
   * makes both decisions correct — a duplicate request for the same key is still
   * ignored, a request for a NEW key always goes out, and a late response is discarded
   * when the selection has moved on.
   */
  const inFlightKey = useRef<string | null>(null);
  const cancelled = useRef(false);

  // The latest fetcher is kept in a ref so a caller can pass an inline closure without
  // restarting the interval on every render. Synced in an effect rather than during
  // render, because a ref write during render is not a safe read/write ordering.
  const fetcherRef = useRef(fetcher);
  useEffect(() => {
    fetcherRef.current = fetcher;
  }, [fetcher]);

  // A key change means the previous payload describes something else entirely, so it is
  // dropped rather than left on screen while the new request is in flight. Held in state
  // rather than a ref: this is React's documented "adjust state when a prop changes"
  // pattern, and a ref written during render is neither safe nor allowed here.
  const [renderedKey, setRenderedKey] = useState(key);
  if (renderedKey !== key) {
    setRenderedKey(key);
    if (data !== null) setData(null);
  }

  // Read inside run() so the interval callback always sees the current selection.
  const keyRef = useRef(key);
  useEffect(() => {
    keyRef.current = key;
  }, [key]);

  const run = useCallback(async () => {
    if (!enabled) return;
    const requestKey = keyRef.current;
    if (inFlightKey.current === requestKey) return;
    inFlightKey.current = requestKey;
    setLoading(true);
    try {
      const result = await fetcherRef.current();
      if (cancelled.current || keyRef.current !== requestKey) return;
      setData(result);
      setError(null);
      setLastUpdatedAt(new Date().toISOString());
    } catch (caught: unknown) {
      if (cancelled.current || keyRef.current !== requestKey) return;
      setError(caught instanceof Error ? caught.message : "Could not refresh.");
    } finally {
      if (inFlightKey.current === requestKey) inFlightKey.current = null;
      if (!cancelled.current && keyRef.current === requestKey) {
        setLoading(false);
        setLoadedOnce(true);
      }
    }
  }, [enabled]);

  useEffect(() => {
    cancelled.current = false;
    if (!enabled) return;

    keyRef.current = key;
    void run();

    let timer: ReturnType<typeof setInterval> | null = null;

    const start = () => {
      if (timer) return;
      timer = setInterval(() => void run(), intervalMs);
    };
    const stop = () => {
      if (!timer) return;
      clearInterval(timer);
      timer = null;
    };

    const onVisibilityChange = () => {
      const hidden = typeof document !== "undefined" && document.hidden;
      setPaused(hidden);
      if (hidden) {
        stop();
      } else {
        // Refresh immediately on return so the operator never reads stale data.
        void run();
        start();
      }
    };

    if (typeof document !== "undefined" && !document.hidden) start();
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", onVisibilityChange);
    }

    return () => {
      cancelled.current = true;
      stop();
      if (typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", onVisibilityChange);
      }
    };
  }, [run, intervalMs, enabled, key]);

  return {
    data,
    error,
    loading,
    // Derived rather than stored: a disabled poller is not "initially loading".
    initialLoading: enabled && !loadedOnce,
    lastUpdatedAt,
    refresh: () => void run(),
    paused,
  };
}

/** Fetch helper that surfaces the API's error message rather than a bare status code. */
export async function rrFetchJson<T>(input: string, init?: RequestInit): Promise<T> {
  const response = await fetch(input, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers || {}) },
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload?.ok) {
    throw new Error(payload?.error || `Request failed (${response.status}).`);
  }
  return payload as T;
}

"use client";

/**
 * The current time, read the way React wants external state read.
 *
 * Calling `Date.now()` during render makes a component impure: two renders with
 * identical props produce different output, which is exactly the class of bug
 * that shows up as a timestamp that changes when something unrelated re-renders.
 *
 * So the clock lives OUTSIDE React. One interval serves every subscriber, the
 * snapshot only changes when that interval fires, and `getSnapshot` returns the
 * same number for the whole of a render pass.
 */

import { useSyncExternalStore } from "react";

const TICK_MS = 5_000;

let clock = 0;
let timer: ReturnType<typeof setInterval> | null = null;
const listeners = new Set<() => void>();

function tick(): void {
  clock = Date.now();
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (timer === null) {
    // Set immediately so the first paint after mount has a real time, rather
    // than waiting a full interval to stop showing zero.
    tick();
    timer = setInterval(tick, TICK_MS);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && timer !== null) {
      clearInterval(timer);
      timer = null;
    }
  };
}

/**
 * Epoch milliseconds, updated every few seconds.
 *
 * Returns 0 on the server and until the first subscription — callers must treat
 * 0 as "not known yet" rather than as 1970, which is why the relative-time
 * helpers below take it explicitly.
 */
export function useNow(): number {
  return useSyncExternalStore(
    subscribe,
    () => clock,
    () => 0
  );
}

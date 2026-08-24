"use client";

/**
 * Starts the outbox and renders its one line of driver-facing status.
 *
 * The driver never learns that IndexedDB, a service worker or an idempotency
 * receipt exists. They see at most one sentence, and only when there is
 * something to say: work in flight, work waiting for signal, or work that needs
 * them. A quiet queue renders nothing at all.
 */

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, CloudOff, Loader2 } from "lucide-react";
import { useNow } from "@/lib/road-recovery/use-now";
import {
  processQueue,
  pruneSucceeded,
  retryItem,
  startOutbox,
  statusFor,
  subscribe,
  type RrOutboxItem,
} from "@/lib/road-recovery/outbox";

/** Registers the worker that wakes the queue. Never caches; see public/rr-sw.js. */
function useServiceWorker() {
  useEffect(() => {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/rr-sw.js", { scope: "/" }).catch(() => {
      // A refused registration (private mode, unsupported browser) costs the
      // queue nothing: the page's own online/visibility handlers still drain it.
    });
  }, []);
}

export function useOutbox() {
  const [items, setItems] = useState<RrOutboxItem[]>([]);
  const [online, setOnline] = useState(true);

  useServiceWorker();

  useEffect(() => {
    startOutbox();
    const unsubscribe = subscribe(setItems);
    const sync = () => setOnline(navigator.onLine);
    sync();
    window.addEventListener("online", sync);
    window.addEventListener("offline", sync);
    return () => {
      unsubscribe();
      window.removeEventListener("online", sync);
      window.removeEventListener("offline", sync);
    };
  }, []);

  // Completed work stops being interesting once the driver has seen it.
  useEffect(() => {
    const timer = setInterval(() => void pruneSucceeded(), 30_000);
    return () => clearInterval(timer);
  }, []);

  const pending = useMemo(
    () => items.filter((item) => item.state === "QUEUED" || item.state === "RETRY" || item.state === "SENDING"),
    [items]
  );
  const attention = useMemo(() => items.filter((item) => item.state === "FAILED"), [items]);
  // "Recently completed" needs a clock, and a clock read during render makes the
  // component impure. `useNow` supplies one from outside React instead.
  const now = useNow();
  const justDone = useMemo(
    () => items.filter((item) => item.state === "SUCCEEDED" && now > 0 && now - item.createdAt < 30_000),
    [items, now]
  );

  return { items, pending, attention, justDone, online };
}

/**
 * The status strip. One message, chosen by urgency: something needing attention
 * outranks work in flight, which outranks a recent success.
 */
export default function OutboxStatus() {
  const { pending, attention, justDone, online } = useOutbox();

  const onAction = useCallback(
    async (item: RrOutboxItem) => {
      const status = statusFor(item, online);
      if (status.action === "retry") return void retryItem(item.operationId);
      if (status.action === "sign_in") return void (window.location.href = "/login");
      // refresh_job / reload — the job has moved on; re-read it.
      window.location.reload();
    },
    [online]
  );

  if (attention.length > 0) {
    const item = attention[0];
    const status = statusFor(item, online);
    return (
      <div
        role="status"
        className="flex flex-wrap items-center gap-3 rounded-[22px] border border-amber-300 bg-amber-50 px-4 py-3"
      >
        <AlertTriangle className="h-5 w-5 shrink-0 text-amber-700" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-black text-amber-900">{status.title}</div>
          {status.detail && <div className="text-sm leading-6 text-amber-800">{status.detail}</div>}
        </div>
        {status.actionLabel && (
          <button
            type="button"
            onClick={() => void onAction(item)}
            className="vyron-focus-ring inline-flex min-h-11 items-center rounded-2xl bg-amber-900 px-5 text-sm font-black text-white"
          >
            {status.actionLabel}
          </button>
        )}
      </div>
    );
  }

  if (pending.length > 0) {
    const item = pending[0];
    const status = statusFor(item, online);
    const many = pending.length > 1 ? ` (${pending.length} updates)` : "";
    return (
      <div
        role="status"
        className={`flex items-center gap-3 rounded-[22px] border px-4 py-3 ${
          online ? "border-sky-200 bg-sky-50" : "border-slate-300 bg-slate-100"
        }`}
      >
        {online ? (
          <Loader2 className="h-5 w-5 shrink-0 animate-spin text-sky-700" aria-hidden="true" />
        ) : (
          <CloudOff className="h-5 w-5 shrink-0 text-slate-600" aria-hidden="true" />
        )}
        <div className="min-w-0">
          <div className={`text-sm font-black ${online ? "text-sky-900" : "text-slate-900"}`}>
            {status.title}
            {many}
          </div>
          {status.detail && (
            <div className={`text-sm leading-6 ${online ? "text-sky-800" : "text-slate-700"}`}>
              {status.detail}
            </div>
          )}
        </div>
      </div>
    );
  }

  if (justDone.length > 0) {
    return (
      <div
        role="status"
        className="flex items-center gap-3 rounded-[22px] border border-emerald-200 bg-emerald-50 px-4 py-3"
      >
        <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-700" aria-hidden="true" />
        <div>
          <div className="text-sm font-black text-emerald-900">Completed</div>
          <div className="text-sm leading-6 text-emerald-800">Saved.</div>
        </div>
      </div>
    );
  }

  return null;
}

/** Nudges the queue — used by screens after they enqueue. */
export function drainOutbox(): void {
  void processQueue();
}

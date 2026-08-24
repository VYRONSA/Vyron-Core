"use client";

/**
 * Road & Recovery notification inbox.
 *
 * Refresh comes from the EXISTING poller (lib/road-recovery/use-rr-poll.ts) — no second
 * polling engine, and no Realtime. That is what delivers "the driver does not have to
 * refresh": the inbox polls at the dispatch-board cadence, so an offer made in the office
 * appears on the driver's phone within one interval without any action from them.
 *
 * Every notification is actionable. `metadata.href` is written by the server when the
 * notification is composed, so tapping a row opens the job it is about instead of leaving
 * the reader to find it. Rows without a link are still readable, just not clickable.
 */

import React, { useCallback, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Bell, Check } from "lucide-react";
import { RR_POLL_INTERVALS, rrFetchJson, useRrPoll } from "@/lib/road-recovery/use-rr-poll";
import { useNow } from "@/lib/road-recovery/use-now";
import { RREmptyState } from "@/components/road-recovery/ui";

type NotificationItem = {
  id: string;
  type: string;
  title: string;
  body: string | null;
  readAt: string | null;
  createdAt: string;
  audience: "driver" | "control-room";
  metadata: Record<string, unknown>;
};

type InboxPayload = {
  notifications: NotificationItem[];
  unreadCount: number;
  fetchedAt: string;
};

/** Minutes-ago phrasing. Absolute timestamps mean nothing to someone on a roadside. */
function relativeTime(iso: string, now: number): string {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return "";
  // The clock is not known until the component has mounted; saying nothing beats
  // saying "20431 min ago" for the one frame before it is.
  if (now === 0) return "";
  const minutes = Math.max(0, Math.round((now - then) / 60000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

/** Urgency by event type, so a decline does not read like a completion. */
function toneFor(type: string): string {
  if (type === "rr_assignment_declined" || type === "rr_job_escalated") {
    return "border-rose-200 bg-rose-50";
  }
  if (type === "rr_assignment_offered" || type === "rr_bystand_requested") {
    return "border-amber-200 bg-amber-50";
  }
  if (type === "rr_job_completed" || type === "rr_assignment_accepted") {
    return "border-emerald-200 bg-emerald-50";
  }
  return "border-slate-200 bg-white";
}

export function useRrNotifications(companyId: string) {
  return useRrPoll<InboxPayload>(
    () =>
      rrFetchJson<InboxPayload>(
        `/api/road-recovery/notifications?companyId=${encodeURIComponent(companyId)}&limit=40`
      ),
    // Same cadence as the dispatch board: an offer must not sit unseen longer than the
    // board it came from takes to refresh.
    RR_POLL_INTERVALS.dispatchBoard,
    { enabled: Boolean(companyId), key: companyId }
  );
}

export default function NotificationInbox({ companyId }: { companyId: string }) {
  const router = useRouter();
  const inbox = useRrNotifications(companyId);
  const [marking, setMarking] = useState(false);
  const now = useNow();

  const items = useMemo(() => inbox.data?.notifications ?? [], [inbox.data]);
  const unread = items.filter((item) => !item.readAt);

  const markRead = useCallback(
    async (ids: string[]) => {
      if (ids.length === 0 || marking) return;
      setMarking(true);
      try {
        await rrFetchJson(`/api/road-recovery/notifications`, {
          method: "PATCH",
          body: JSON.stringify({ companyId, notificationIds: ids }),
        });
        inbox.refresh();
      } catch {
        // Read state is a convenience, not operational data. A failure here must not
        // interrupt the person using the screen; the next poll re-reports the truth.
      } finally {
        setMarking(false);
      }
    },
    [companyId, inbox, marking]
  );

  const open = useCallback(
    (item: NotificationItem) => {
      const href = typeof item.metadata?.href === "string" ? item.metadata.href : null;
      if (!item.readAt) void markRead([item.id]);
      if (href) router.push(href);
    },
    [markRead, router]
  );

  return (
    <section className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="inline-flex h-11 w-11 items-center justify-center rounded-2xl bg-slate-900 text-cyan-300">
            <Bell className="h-5 w-5" aria-hidden="true" />
          </span>
          <div>
            <h2 className="text-lg font-black tracking-tight text-slate-900">Notifications</h2>
            <p className="text-xs font-semibold text-slate-500">
              {unread.length > 0
                ? `${unread.length} unread · refreshes every ${RR_POLL_INTERVALS.dispatchBoard / 1000}s`
                : `Up to date · refreshes every ${RR_POLL_INTERVALS.dispatchBoard / 1000}s`}
            </p>
          </div>
        </div>

        {unread.length > 0 && (
          <button
            type="button"
            onClick={() => void markRead(unread.map((item) => item.id))}
            disabled={marking}
            className="vyron-focus-ring inline-flex min-h-11 items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 text-sm font-black text-slate-700 transition hover:bg-slate-50 disabled:opacity-60"
          >
            <Check className="h-4 w-4" aria-hidden="true" />
            Mark all read
          </button>
        )}
      </header>

      {inbox.initialLoading ? (
        <p className="text-sm font-semibold text-slate-500">Loading notifications…</p>
      ) : items.length === 0 ? (
        <RREmptyState
          title="No notifications"
          description="Job offers, driver responses, authorisations and escalations appear here as they happen. The list refreshes on its own."
          hint="Nothing needs your attention"
          tone="ready"
        />
      ) : (
        <ul className="space-y-2">
          {items.map((item) => {
            const href = typeof item.metadata?.href === "string" ? item.metadata.href : null;
            const isUnread = !item.readAt;
            return (
              <li key={item.id}>
                <button
                  type="button"
                  onClick={() => open(item)}
                  aria-label={`${item.title}${href ? ", open job" : ""}`}
                  className={`vyron-focus-ring flex w-full items-start gap-3 rounded-[22px] border p-4 text-left transition ${toneFor(
                    item.type
                  )} ${href ? "hover:-translate-y-0.5 hover:shadow-md" : "cursor-default"}`}
                >
                  {/* Unread marker doubles as the touch affordance on a phone. */}
                  <span
                    aria-hidden="true"
                    className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${
                      isUnread ? "bg-slate-900" : "bg-transparent ring-1 ring-slate-300"
                    }`}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-baseline gap-x-2">
                      <span className={`text-sm ${isUnread ? "font-black" : "font-bold"} text-slate-900`}>
                        {item.title}
                      </span>
                      <span className="text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500">
                        {relativeTime(item.createdAt, now)}
                      </span>
                    </span>
                    {item.body && (
                      <span className="mt-1 block text-sm leading-6 text-slate-600">{item.body}</span>
                    )}
                    {href && (
                      <span className="mt-2 block text-xs font-black uppercase tracking-[0.14em] text-cyan-700">
                        Open job →
                      </span>
                    )}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {inbox.error && (
        <p className="text-sm font-semibold text-rose-600">{inbox.error}</p>
      )}
    </section>
  );
}

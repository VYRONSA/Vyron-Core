"use client";

/**
 * The VYRON CORE Employee App.
 *
 * WHO THIS IS FOR
 *
 *   Somebody standing outside, holding a phone in one hand, possibly wearing
 *   gloves, possibly in the dark, usually in a hurry. Everything below follows
 *   from that: one dominant action per screen, targets big enough to hit
 *   without looking, status stated in words rather than colour alone, and no
 *   typing where a tap will do.
 *
 * WHAT IT IS NOT
 *
 *   Not a dashboard. A dashboard answers "how are we doing"; this answers
 *   "what do I do next". If a number cannot change what the employee does in
 *   the next minute, it does not belong on Home.
 *
 * WHERE THE WORK ACTUALLY HAPPENS
 *
 *   Nothing here re-implements a workflow. WORK embeds the existing
 *   DriverJobWorkflow, which owns the state machine, the outbox, evidence and
 *   idempotency. This file is a shell: navigation, identity, connection state
 *   and the incident capability. That split is deliberate — the proven code
 *   stays proven.
 */

import React, { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import {
  AlertTriangle,
  Bell,
  Briefcase,
  ChevronRight,
  Home,
  MoreHorizontal,
  ShieldAlert,
  Wifi,
  WifiOff,
} from "lucide-react";
import DriverJobWorkflow from "@/components/road-recovery/DriverJobWorkflow";
import IncidentReporter from "@/components/mobile/IncidentReporter";
import { useRoadRecoveryCompany } from "@/lib/road-recovery/use-company";
import { rrFetchJson, RR_POLL_INTERVALS, useRrPoll } from "@/lib/road-recovery/use-rr-poll";
import {
  allDrafts,
  draftSendState,
  markSubmitted,
  type RrIncidentDraft,
} from "@/lib/mobile/incident-drafts";
import {
  allItems,
  clearLocalWorkspace,
  startOutbox,
  subscribe,
} from "@/lib/road-recovery/outbox";
import { drainEvidence } from "@/lib/road-recovery/evidence-queue";
import { getSupabaseBrowserClient } from "@/lib/supabase";
import { productBrand } from "@/lib/brand";
import { isNativeApp, onConnectivityChange, onDeepLink, onPushOpened } from "@/lib/mobile/bridge";

type Tab = "home" | "work" | "incidents" | "inbox" | "more";

const TABS: { id: Tab; label: string; icon: typeof Home }[] = [
  { id: "home", label: "Home", icon: Home },
  { id: "work", label: "Work", icon: Briefcase },
  { id: "incidents", label: "Incidents", icon: AlertTriangle },
  { id: "inbox", label: "Inbox", icon: Bell },
  { id: "more", label: "More", icon: MoreHorizontal },
];

type NotificationRow = {
  id: string;
  title: string;
  body: string | null;
  readAt?: string | null;
  read_at?: string | null;
  createdAt?: string;
  created_at?: string;
  metadata?: Record<string, unknown> | null;
};

type IncidentRow = {
  id: string;
  title: string;
  category: string | null;
  severity: string | null;
  status: string;
  urgencyReason?: string;
  created_at: string;
};

/**
 * Connectivity, read from the platform rather than mirrored into state.
 *
 * Inside the app this is the native radio; in a browser it is navigator.onLine.
 * The employee is told which, because "no signal" and "no job" must never look
 * the same.
 */
function useOnline(): boolean {
  const subscribe = useCallback((notify: () => void) => {
    let dispose: (() => void) | undefined;
    void onConnectivityChange(() => notify()).then((off) => {
      dispose = off;
    });
    return () => dispose?.();
  }, []);
  const getSnapshot = useCallback(
    () => (typeof navigator === "undefined" ? true : navigator.onLine),
    []
  );
  return useSyncExternalStore(subscribe, getSnapshot, () => true);
}

export default function EmployeeApp() {
  const { companyId, loading, error } = useRoadRecoveryCompany();
  const [tab, setTab] = useState<Tab>("home");
  const [reporting, setReporting] = useState(false);
  const [drafts, setDrafts] = useState<RrIncidentDraft[]>([]);
  const online = useOnline();

  /* ── Deep links and push taps land on the right screen ─────────────────── */

  const openLink = useCallback((raw: string) => {
    // vyroncore://incident/<id> or https://host/app?tab=incidents
    const link = raw.toLowerCase();
    if (link.includes("/incident")) setTab("incidents");
    // "/road-recovery/driver?job=<id>" is the shape the control room actually
    // sends, so match the query key and the driver route too - not just a
    // "/job" path segment that nothing emits.
    else if (
      link.includes("/job") ||
      link.includes("job=") ||
      link.includes("/work") ||
      link.includes("/driver")
    )
      setTab("work");
    else if (link.includes("/notification") || link.includes("/inbox")) setTab("inbox");
    else if (link.includes("/safety")) {
      setTab("incidents");
      setReporting(true);
    }
  }, []);

  useEffect(() => {
    let disposeLink: (() => void) | undefined;
    let disposePush: (() => void) | undefined;
    void onDeepLink(openLink).then((off) => { disposeLink = off; });
    void onPushOpened(openLink).then((off) => { disposePush = off; });
    return () => {
      disposeLink?.();
      disposePush?.();
    };
  }, [openLink]);

  /**
   * Reconciles what this device is holding against what the server has taken.
   *
   * A draft is only called "submitted" once the outbox reports its operation
   * accepted — the same rule evidence follows. Because the queue's operationId
   * IS the incident's primary key, that is a direct lookup rather than a guess.
   */
  const refreshDrafts = useCallback(async () => {
    const [drafted, queued] = await Promise.all([allDrafts(), allItems()]);
    const accepted = new Set(
      queued.filter((item) => item.state === "SUCCEEDED").map((item) => item.operationId)
    );
    const settled = drafted.filter((d) => d.state === "submitting" && accepted.has(d.incidentId));
    if (settled.length > 0) {
      await Promise.all(settled.map((d) => markSubmitted(d.incidentId)));
      setDrafts(await allDrafts());
      return;
    }
    setDrafts(drafted);
  }, []);

  /**
   * The queue runs for the WHOLE app, not just the Work tab.
   *
   * Found the hard way: the outbox used to be started by DriverJobWorkflow, so
   * an employee who reported an incident and never opened Work had nothing
   * draining their queue — the report sat on the device indefinitely. The app
   * shell owns it now, because the app shell is always mounted.
   */
  /**
   * Photographs captured offline need somebody to carry them once signal
   * returns. Same lesson as the outbox: the pump belongs to the shell, because
   * the shell is the only thing guaranteed to be mounted.
   */
  const uploadBlob = useCallback(
    async (path: string, blob: Blob, contentType: string) => {
      const { error } = await getSupabaseBrowserClient()
        .storage.from("rr-evidence")
        .upload(path, blob, { contentType, upsert: false });
      if (!error) return { ok: true } as const;
      const already = /exist/i.test(error.message || "");
      return { ok: false as const, error: error.message || "Upload failed.", alreadyExists: already };
    },
    []
  );

  useEffect(() => {
    startOutbox();
    const pump = async () => {
      await drainEvidence(uploadBlob);
      await refreshDrafts();
    };
    void pump();
    // Same reason as the driver screen: reconcile when the queue moves, not on
    // a timer, so an employee is never told their report is still sending after
    // the control room already has it.
    const unsubscribe = subscribe(() => void refreshDrafts());
    window.addEventListener("online", pump);
    const timer = setInterval(pump, 5_000);
    return () => {
      unsubscribe();
      window.removeEventListener("online", pump);
      clearInterval(timer);
    };
  }, [refreshDrafts, uploadBlob]);

  /* ── The two feeds Home summarises ─────────────────────────────────────── */

  const notifications = useRrPoll<{ notifications: NotificationRow[]; unreadCount?: number }>(
    () => rrFetchJson(`/api/road-recovery/notifications?companyId=${encodeURIComponent(companyId)}`),
    RR_POLL_INTERVALS.driverActive,
    { enabled: Boolean(companyId) }
  );

  /**
   * Opening a message from the Inbox.
   *
   * A job alert that says "Accept or decline" has to take the employee to the
   * job. These rows were inert: a driver tapped an urgent alert, nothing moved,
   * and the badge stayed lit - which teaches them the Inbox is decoration.
   *
   * The destination comes from the notification's own metadata rather than being
   * guessed from its wording, and it is routed through exactly the same function
   * a push tap or a deep link uses, so all three can never disagree about where a
   * given notification leads.
   */
  const openNotification = useCallback(
    (note: NotificationRow) => {
      const metadata = note.metadata ?? {};
      const href = typeof metadata.href === "string" ? metadata.href : "";
      const serviceJobId = typeof metadata.serviceJobId === "string" ? metadata.serviceJobId : "";
      const incidentId = typeof metadata.incidentId === "string" ? metadata.incidentId : "";

      /**
       * Route on the ids first, and only fall back to the link text.
       *
       * The href a job alert carries is "/road-recovery/driver?job=<id>", which
       * matches none of the patterns openLink looks for - so the row was marked
       * read and the employee was left staring at the same screen. An explicit
       * serviceJobId is unambiguous in a way a URL shape is not, and it does not
       * break the next time a route is renamed.
       */
      if (serviceJobId) setTab("work");
      else if (incidentId) setTab("incidents");
      else if (href) openLink(href);

      // Mark it read only if it is not already, so a re-read does not churn the
      // server. A failure here is silent on purpose: the employee has been taken
      // where they asked to go, and an unread badge is not worth an error.
      const alreadyRead = note.readAt ?? note.read_at;
      if (!alreadyRead && companyId) {
        void rrFetchJson(`/api/road-recovery/notifications`, {
          method: "PATCH",
          body: JSON.stringify({ companyId, notificationIds: [note.id] }),
        })
          .then(() => notifications.refresh?.())
          .catch(() => undefined);
      }
    },
    [companyId, notifications, openLink]
  );


  const incidents = useRrPoll<{ incidents: IncidentRow[] }>(
    () => rrFetchJson(`/api/mobile/incidents?companyId=${encodeURIComponent(companyId)}`),
    RR_POLL_INTERVALS.driverActive,
    { enabled: Boolean(companyId) }
  );

  const unread = useMemo(
    () => (notifications.data?.notifications || []).filter((n) => !(n.readAt ?? n.read_at)).length,
    [notifications.data]
  );

  const openIncidents = useMemo(
    () => (incidents.data?.incidents || []).filter((i) => i.status === "submitted" || i.status === "reviewing"),
    [incidents.data]
  );

  // Everything still on the device, for the list and the tab badge.
  const unsent = drafts.filter((d) => d.state !== "submitted");
  // Counted apart for the Home summary, because only one of these sends itself.
  const sendState = draftSendState(drafts);

  if (loading) {
    return <Splash message="Signing you in…" />;
  }
  if (error || !companyId) {
    return <Splash message={error || "No workspace access."} tone="error" />;
  }

  return (
    <div className="flex min-h-dvh flex-col bg-[#f6f8fb]">
      {/* Connection state lives in the chrome, so it is answerable at any moment. */}
      <header className="sticky top-0 z-20 flex items-center justify-between gap-3 bg-[#07101f] px-4 pb-3 pt-[calc(env(safe-area-inset-top,0px)_+_0.75rem)] text-white">
        <div className="min-w-0">
          <p className="umora-sans text-[10px] font-bold uppercase tracking-[0.2em] text-cyan-300">{productBrand.mark}</p>
          <p className="truncate text-sm font-black">{TABS.find((t) => t.id === tab)?.label}</p>
        </div>
        <span
          data-testid="app-connection"
          className={`flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-black ${
            online ? "bg-emerald-500/15 text-emerald-300" : "bg-amber-500/20 text-amber-200"
          }`}
        >
          {online ? <Wifi className="h-3.5 w-3.5" /> : <WifiOff className="h-3.5 w-3.5" />}
          {online ? "Online" : "No connection"}
        </span>
      </header>

      <main className="min-h-0 flex-1 overflow-y-auto px-4 pb-28 pt-4">
        {reporting ? (
          <IncidentReporter
            companyId={companyId}
            online={online}
            onClose={() => {
              setReporting(false);
              void refreshDrafts();
              incidents.refresh();
            }}
          />
        ) : (
          <>
            {tab === "home" && (
              <HomeTab
                unread={unread}
                openIncidents={openIncidents.length}
                sendState={sendState}
                online={online}
                onReport={() => { setReporting(true); setTab("incidents"); }}
                onGo={setTab}
              />
            )}
            {tab === "work" && <DriverJobWorkflow companyId={companyId} />}
            {tab === "incidents" && (
              <IncidentsTab
                incidents={incidents.data?.incidents || []}
                drafts={unsent}
                online={online}
                onReport={() => setReporting(true)}
              />
            )}
            {tab === "inbox" && (
              <InboxTab
                notifications={notifications.data?.notifications || []}
                onOpen={openNotification}
              />
            )}
            {tab === "more" && <MoreTab queued={sendState.queued + sendState.needsAttention} />}
          </>
        )}
      </main>

      {/* Safety is reachable from every screen without opening a menu. */}
      {!reporting && (
        <button
          type="button"
          onClick={() => { setReporting(true); setTab("incidents"); }}
          data-testid="app-safety-button"
          className="vyron-focus-ring fixed bottom-24 right-4 z-30 flex min-h-14 items-center gap-2 rounded-full bg-rose-600 px-5 text-sm font-black text-white shadow-lg"
        >
          <ShieldAlert className="h-5 w-5" aria-hidden="true" />
          Report
        </button>
      )}

      <nav
        data-testid="app-bottom-nav"
        className="fixed inset-x-0 bottom-0 z-20 grid grid-cols-5 border-t border-slate-200 bg-white pb-[env(safe-area-inset-bottom)]"
      >
        {TABS.map(({ id, label, icon: Icon }) => {
          const active = tab === id && !reporting;
          const badge = id === "inbox" ? unread : id === "incidents" ? unsent.length : 0;
          return (
            <button
              key={id}
              type="button"
              onClick={() => { setReporting(false); setTab(id); }}
              aria-current={active ? "page" : undefined}
              className={`vyron-focus-ring relative flex min-h-16 flex-col items-center justify-center gap-1 text-[11px] font-black ${
                active ? "text-cyan-700" : "text-slate-500"
              }`}
            >
              <Icon className="h-5 w-5" aria-hidden="true" />
              {label}
              {badge > 0 && (
                <span className="absolute right-[22%] top-2 min-w-5 rounded-full bg-rose-600 px-1 text-[10px] font-black text-white">
                  {badge > 9 ? "9+" : badge}
                </span>
              )}
            </button>
          );
        })}
      </nav>
    </div>
  );
}

function Splash({ message, tone = "info" }: { message: string; tone?: "info" | "error" }) {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-3 bg-[#07101f] px-8 text-center">
      <p className="umora-sans text-[11px] font-bold uppercase tracking-[0.3em] text-cyan-300">{productBrand.mark}</p>
      <p className={`text-sm font-bold ${tone === "error" ? "text-rose-300" : "text-slate-300"}`}>{message}</p>
    </div>
  );
}

/**
 * HOME — one question answered: what needs me now?
 *
 * Cards appear only when they have something to say. An employee with nothing
 * outstanding should see a short, calm screen, not a wall of zeroes.
 */
function HomeTab({
  unread,
  openIncidents,
  sendState,
  online,
  onReport,
  onGo,
}: {
  unread: number;
  openIncidents: number;
  sendState: { queued: number; unfinished: number; needsAttention: number };
  online: boolean;
  onReport: () => void;
  onGo: (tab: Tab) => void;
}) {
  const nothingOutstanding =
    unread === 0 &&
    openIncidents === 0 &&
    sendState.queued === 0 &&
    sendState.unfinished === 0 &&
    sendState.needsAttention === 0;

  return (
    <div className="flex flex-col gap-3">
      {!online && (
        <p className="rounded-[22px] bg-amber-100 px-4 py-3 text-sm font-bold text-amber-900">
          You are offline. You can still record work and report incidents — everything you do is saved
          on this device and sent automatically when you have signal.
        </p>
      )}

      {sendState.queued > 0 && (
        <Card
          tone="amber"
          title={`${sendState.queued} report${sendState.queued === 1 ? "" : "s"} waiting to send`}
          detail="Saved on this device. They will send themselves when you have signal."
          onClick={() => onGo("incidents")}
        />
      )}

      {/* An unfinished report will never send on its own — say so, and say what
          to do about it, rather than promising it is already handled. */}
      {sendState.unfinished > 0 && (
        <Card
          tone="amber"
          title={`${sendState.unfinished} unfinished report${sendState.unfinished === 1 ? "" : "s"}`}
          detail={
            sendState.unfinished === 1
              ? "Not sent yet. Open it to finish and send it."
              : "Not sent yet. Open them to finish and send them."
          }
          onClick={() => onGo("incidents")}
        />
      )}

      {sendState.needsAttention > 0 && (
        <Card
          tone="amber"
          title={`${sendState.needsAttention} report${sendState.needsAttention === 1 ? "" : "s"} need attention`}
          detail="These could not be sent. Open them to see why."
          onClick={() => onGo("incidents")}
        />
      )}

      <button
        type="button"
        onClick={onReport}
        data-testid="home-report-incident"
        className="vyron-focus-ring flex min-h-[72px] w-full items-center justify-between gap-3 rounded-[26px] bg-rose-600 px-5 text-left text-white"
      >
        <span>
          <span className="block text-base font-black">Report an incident</span>
          <span className="block text-xs font-bold text-rose-100">
            Accident, injury, near miss or anything unsafe
          </span>
        </span>
        <ShieldAlert className="h-7 w-7 shrink-0" aria-hidden="true" />
      </button>

      <Card
        tone="slate"
        title="My work"
        detail="Jobs assigned to you, and what to do next."
        onClick={() => onGo("work")}
      />

      {unread > 0 && (
        <Card
          tone="cyan"
          title={`${unread} unread message${unread === 1 ? "" : "s"}`}
          detail="Job alerts and messages from the control room."
          onClick={() => onGo("inbox")}
        />
      )}

      {openIncidents > 0 && (
        <Card
          tone="slate"
          title={`${openIncidents} incident${openIncidents === 1 ? "" : "s"} still open`}
          detail="Reports you have filed that are still being reviewed."
          onClick={() => onGo("incidents")}
        />
      )}

      {nothingOutstanding && (
        <p className="rounded-[22px] bg-white px-4 py-6 text-center text-sm font-bold text-slate-500">
          Nothing needs you right now.
        </p>
      )}
    </div>
  );
}

function Card({
  title,
  detail,
  tone,
  onClick,
}: {
  title: string;
  detail: string;
  tone: "slate" | "amber" | "cyan";
  onClick: () => void;
}) {
  const tones = {
    slate: "bg-white text-slate-900",
    amber: "bg-amber-50 text-amber-900",
    cyan: "bg-cyan-50 text-cyan-900",
  };
  return (
    <button
      type="button"
      onClick={onClick}
      className={`vyron-focus-ring flex min-h-[68px] w-full items-center justify-between gap-3 rounded-[24px] px-5 text-left ${tones[tone]}`}
    >
      <span className="min-w-0">
        <span className="block text-sm font-black">{title}</span>
        <span className="block text-xs font-bold opacity-70">{detail}</span>
      </span>
      <ChevronRight className="h-5 w-5 shrink-0 opacity-50" aria-hidden="true" />
    </button>
  );
}

function IncidentsTab({
  incidents,
  drafts,
  online,
  onReport,
}: {
  incidents: IncidentRow[];
  drafts: RrIncidentDraft[];
  online: boolean;
  onReport: () => void;
}) {
  return (
    <div className="flex flex-col gap-3">
      <button
        type="button"
        onClick={onReport}
        data-testid="incidents-report-button"
        className="vyron-focus-ring min-h-14 w-full rounded-[24px] bg-rose-600 text-base font-black text-white"
      >
        Report an incident
      </button>

      {drafts.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="px-1 text-[11px] font-black uppercase tracking-wide text-slate-500">On this device</h2>
          {drafts.map((draft) => (
            <div key={draft.incidentId} className="rounded-[22px] bg-amber-50 px-4 py-3" data-testid="incident-draft">
              <p className="text-sm font-black text-amber-900">{draft.title || "Incident report"}</p>
              <p className="text-xs font-bold text-amber-800">
                {online ? "Saved on device. Sending…" : "Saved on device. Waiting for connection."}
              </p>
            </div>
          ))}
        </section>
      )}

      <section className="flex flex-col gap-2">
        <h2 className="px-1 text-[11px] font-black uppercase tracking-wide text-slate-500">Submitted</h2>
        {incidents.length === 0 ? (
          <p className="rounded-[22px] bg-white px-4 py-6 text-center text-sm font-bold text-slate-500">
            You have not reported anything.
          </p>
        ) : (
          incidents.map((incident) => (
            <div key={incident.id} className="rounded-[22px] bg-white px-4 py-3" data-testid="incident-row">
              <div className="flex items-start justify-between gap-2">
                <p className="text-sm font-black text-slate-900">{incident.title}</p>
                <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-black uppercase text-slate-600">
                  {incident.status}
                </span>
              </div>
              {incident.urgencyReason && (
                <p className="mt-1 text-xs font-bold text-slate-500">{incident.urgencyReason}</p>
              )}
            </div>
          ))
        )}
      </section>
    </div>
  );
}

function InboxTab({
  notifications,
  onOpen,
}: {
  notifications: NotificationRow[];
  onOpen: (note: NotificationRow) => void;
}) {
  if (notifications.length === 0) {
    return (
      <p className="rounded-[22px] bg-white px-4 py-6 text-center text-sm font-bold text-slate-500">
        Nothing new.
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-2">
      {notifications.map((note) => {
        const unread = !(note.readAt ?? note.read_at);
        return (
          <button
            key={note.id}
            type="button"
            data-testid="inbox-row"
            onClick={() => onOpen(note)}
            className={`vyron-focus-ring w-full rounded-[22px] px-4 py-3 text-left ${
              unread ? "bg-cyan-50" : "bg-white"
            }`}
          >
            <p className="text-sm font-black text-slate-900">{note.title}</p>
            {note.body && <p className="mt-1 text-xs font-bold text-slate-600">{note.body}</p>}
          </button>
        );
      })}
    </div>
  );
}

/**
 * MORE — deliberately honest about what does not exist yet.
 *
 * Showing a Training tile that opens nothing teaches an employee the app is
 * unreliable. Anything without a backend says so plainly instead.
 */
/**
 * Signing out, and the one thing it must never do.
 *
 * A yard handset gets passed between employees, so an app with no sign-out
 * cannot be handed over at all - the next person inherits the previous one's
 * session, work and inbox. That is the reason this exists.
 *
 * It is also the most dangerous button in the app. Signing out clears the local
 * stores, and those stores are where a driver's unsent reports and photographs
 * live. So it refuses while anything is still queued and says exactly how much
 * is waiting, rather than asking someone standing in the rain to weigh up a
 * warning dialog. Once the queue is empty there is nothing to lose, and the
 * handover is clean.
 */
function SignOutRow({ queued }: { queued: number }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const blocked = queued > 0;

  async function signOut() {
    if (blocked || busy) return;
    setBusy(true);
    setError(null);
    try {
      const { getSupabaseBrowserClient } = await import("@/lib/supabase");
      await getSupabaseBrowserClient().auth.signOut();
      // The queues are empty (checked above), so clearing them removes only
      // this employee's finished traces - never anything still owed to them.
      await clearLocalWorkspace();
      window.location.replace("/login");
    } catch {
      setBusy(false);
      setError("Could not sign out. Check your connection and try again.");
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        onClick={signOut}
        disabled={blocked || busy}
        data-testid="more-sign-out"
        className={`vyron-focus-ring flex min-h-16 items-center justify-between gap-3 rounded-[22px] px-5 text-left ${
          blocked ? "bg-white/60" : "bg-white"
        }`}
      >
        <span>
          <span className={`block text-sm font-black ${blocked ? "text-slate-400" : "text-slate-900"}`}>
            {busy ? "Signing out…" : "Sign out"}
          </span>
          <span className={`block text-xs font-bold ${blocked ? "text-slate-400" : "text-slate-500"}`}>
            {blocked
              ? `${queued} report${queued === 1 ? "" : "s"} still to send. Sign out once ${
                  queued === 1 ? "it has" : "they have"
                } gone.`
              : "Hand this phone to someone else safely."}
          </span>
        </span>
      </button>
      {error && <p className="px-5 text-xs font-bold text-rose-600">{error}</p>}
    </div>
  );
}

function MoreTab({ queued }: { queued: number }) {
  const items: { label: string; detail: string; href?: string }[] = [
    { label: "My profile", detail: "Your details and workspace", href: "/dashboard" },
    { label: "Road & Recovery", detail: "Full job board and history", href: "/road-recovery/driver" },
    { label: "Documents", detail: "Not available in this release yet" },
    { label: "Training", detail: "Not available in this release yet" },
    { label: "Help and support", detail: "Contact your supervisor or control room" },
  ];
  return (
    <div className="flex flex-col gap-2">
      {items.map((item) =>
        item.href ? (
          <a
            key={item.label}
            href={item.href}
            className="vyron-focus-ring flex min-h-16 items-center justify-between gap-3 rounded-[22px] bg-white px-5"
          >
            <span>
              <span className="block text-sm font-black text-slate-900">{item.label}</span>
              <span className="block text-xs font-bold text-slate-500">{item.detail}</span>
            </span>
            <ChevronRight className="h-5 w-5 opacity-40" aria-hidden="true" />
          </a>
        ) : (
          <div key={item.label} className="flex min-h-16 items-center rounded-[22px] bg-white/60 px-5">
            <span>
              <span className="block text-sm font-black text-slate-400">{item.label}</span>
              <span className="block text-xs font-bold text-slate-400">{item.detail}</span>
            </span>
          </div>
        )
      )}
      <SignOutRow queued={queued} />
      <p className="px-2 pt-2 text-[11px] font-bold text-slate-400">
        {isNativeApp() ? `${productBrand.name} app` : `${productBrand.name} (browser)`}
      </p>
    </div>
  );
}

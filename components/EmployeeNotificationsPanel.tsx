"use client";

import React, { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Archive,
  Bell,
  CheckCircle2,
  ClipboardList,
  MessageCircle,
  RefreshCcw,
  Send,
} from "lucide-react";
import { supabase } from "../lib/supabase";

type DeliveryStatus = "pending" | "drafted" | "sent" | "read" | "failed" | "cancelled";

type EmployeeNotification = {
  id: string;
  employee_id: string;
  employee_name: string;
  employee_phone: string | null;
  employee_email: string | null;
  notification_type: string;
  title: string;
  message: string;
  related_module: string | null;
  related_record_id: string | null;
  delivery_channel: string;
  delivery_status: DeliveryStatus;
  whatsapp_url: string | null;
  sent_at: string | null;
  read_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

const actionableNotificationTypes = new Set([
  "hr_warning",
  "hr_document",
  "clocking_feedback",
  "payroll_feedback",
  "general",
  "manager_message",
]);

const systemNotificationTypes = new Set(["leave_status"]);

const statusStyles: Record<DeliveryStatus, string> = {
  pending: "bg-amber-100 text-amber-700",
  drafted: "bg-blue-100 text-blue-700",
  sent: "bg-emerald-100 text-emerald-700",
  read: "bg-cyan-100 text-cyan-700",
  failed: "bg-rose-100 text-rose-700",
  cancelled: "bg-slate-200 text-slate-700",
};

function formatDateTime(value: string | null | undefined) {
  if (!value) return "Not set";
  try {
    return new Date(value).toLocaleString("en-ZA", {
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return value;
  }
}

function formatText(value: string | null | undefined) {
  if (!value) return "General";
  return value.replaceAll("_", " ");
}

function buildWhatsAppUrl(notification: EmployeeNotification) {
  const message = [
    "VYRON CORE",
    "",
    notification.title,
    "",
    notification.message,
    "",
    `Employee: ${notification.employee_name}`,
  ].join("\n");

  const phone = (notification.employee_phone || "").replace(/\D/g, "");

  if (phone) {
    return `https://wa.me/${phone}?text=${encodeURIComponent(message)}`;
  }

  return `https://wa.me/?text=${encodeURIComponent(message)}`;
}

function isActionable(notification: EmployeeNotification) {
  return actionableNotificationTypes.has(notification.notification_type);
}

function isSystemLog(notification: EmployeeNotification) {
  return systemNotificationTypes.has(notification.notification_type) || !isActionable(notification);
}

export default function EmployeeNotificationsPanel({
  onUpdated,
}: {
  onUpdated?: () => void | Promise<void>;
}) {
  const [notifications, setNotifications] = useState<EmployeeNotification[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"action" | "system">("action");
  const [filter, setFilter] = useState<"all" | DeliveryStatus>("pending");
  const [error, setError] = useState<string | null>(null);

  const actionableNotifications = useMemo(
    () => notifications.filter((item) => isActionable(item)),
    [notifications]
  );

  const systemNotifications = useMemo(
    () => notifications.filter((item) => isSystemLog(item)),
    [notifications]
  );

  const filteredActionableNotifications = useMemo(() => {
    if (filter === "all") return actionableNotifications;
    return actionableNotifications.filter((item) => item.delivery_status === filter);
  }, [filter, actionableNotifications]);

  const pendingActionCount = useMemo(
    () =>
      actionableNotifications.filter((item) =>
        ["pending", "drafted", "failed"].includes(item.delivery_status)
      ).length,
    [actionableNotifications]
  );

  const sentActionCount = useMemo(
    () => actionableNotifications.filter((item) => item.delivery_status === "sent").length,
    [actionableNotifications]
  );

  const failedActionCount = useMemo(
    () => actionableNotifications.filter((item) => item.delivery_status === "failed").length,
    [actionableNotifications]
  );

  async function fetchNotifications() {
    setLoading(true);
    setError(null);

    const { data, error: fetchError } = await supabase
      .from("employee_notifications")
      .select("*")
      .order("created_at", { ascending: false });

    if (fetchError) {
      setError(fetchError.message);
      setLoading(false);
      return;
    }

    setNotifications((data || []) as EmployeeNotification[]);
    setLoading(false);
  }

  useEffect(() => {
    fetchNotifications();
  }, []);

  async function markStatus(id: string, status: DeliveryStatus) {
    setSavingId(id);
    setError(null);

    const payload: Partial<EmployeeNotification> = {
      delivery_status: status,
      updated_at: new Date().toISOString(),
    };

    if (status === "sent") {
      payload.sent_at = new Date().toISOString();
    }

    if (status === "read") {
      payload.read_at = new Date().toISOString();
    }

    const { error: updateError } = await supabase
      .from("employee_notifications")
      .update(payload)
      .eq("id", id);

    if (updateError) {
      setError(updateError.message);
      setSavingId(null);
      return;
    }

    await fetchNotifications();

    if (onUpdated) {
      await onUpdated();
    }

    setSavingId(null);
  }

  async function openWhatsApp(notification: EmployeeNotification) {
    const whatsappUrl = notification.whatsapp_url || buildWhatsAppUrl(notification);

    setSavingId(notification.id);

    await supabase
      .from("employee_notifications")
      .update({
        delivery_channel: "whatsapp",
        delivery_status: "drafted",
        whatsapp_url: whatsappUrl,
        updated_at: new Date().toISOString(),
      })
      .eq("id", notification.id);

    window.open(whatsappUrl, "_blank");

    await fetchNotifications();

    if (onUpdated) {
      await onUpdated();
    }

    setSavingId(null);
  }

  return (
    <div className="mt-8 grid gap-8 xl:grid-cols-[0.75fr_1.25fr]">
      <section className="rounded-[34px] bg-gradient-to-r from-[#07101f] to-[#0b1a33] p-6 text-white shadow-2xl shadow-slate-300">
        <div className="text-xs font-bold uppercase tracking-[0.4em] text-cyan-300">
          Communication Centre
        </div>
        <h2 className="mt-3 text-3xl font-bold">Employee Notifications</h2>
        <p className="mt-4 text-sm leading-7 text-slate-300">
          Manager queue now only shows messages that need action. Leave approval
          messages are kept in a system log so the manager is not forced to mark
          every approval as read or sent.
        </p>

        <div className="mt-6 grid gap-3">
          <div className="rounded-2xl bg-white/10 p-4">
            <div className="text-xs font-black uppercase tracking-[0.2em] text-slate-400">
              Action required
            </div>
            <div className="mt-2 text-4xl font-black text-amber-300">
              {pendingActionCount}
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-2xl bg-white/10 p-4">
              <div className="text-xs font-bold text-slate-400">Sent</div>
              <div className="mt-2 text-2xl font-black text-emerald-300">
                {sentActionCount}
              </div>
            </div>

            <div className="rounded-2xl bg-white/10 p-4">
              <div className="text-xs font-bold text-slate-400">Failed</div>
              <div className="mt-2 text-2xl font-black text-rose-300">
                {failedActionCount}
              </div>
            </div>

            <div className="rounded-2xl bg-white/10 p-4">
              <div className="text-xs font-bold text-slate-400">System log</div>
              <div className="mt-2 text-2xl font-black text-cyan-300">
                {systemNotifications.length}
              </div>
            </div>
          </div>
        </div>

        <div className="mt-6 rounded-2xl bg-white/10 p-4 text-sm leading-6 text-slate-300">
          Proper logic: HR warnings and manager messages need action. Leave approved
          / declined messages are automatic system records.
        </div>
      </section>

      <section className="rounded-[34px] border border-slate-200/70 bg-white p-6 shadow-[0_10px_30px_rgba(0,0,0,0.08)]">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <div className="text-xs font-bold uppercase tracking-[0.35em] text-blue-600">
              VYRON CORE
            </div>
            <h2 className="mt-2 text-3xl font-bold text-slate-950">
              Notification Queue
            </h2>
            <p className="mt-2 text-sm leading-6 text-slate-500">
              Action Required is for manager-controlled employee communication.
              System Log is read-only history.
            </p>
          </div>

          <button
            onClick={fetchNotifications}
            className="flex w-fit items-center gap-2 rounded-2xl bg-slate-950 px-5 py-3 text-sm font-bold text-white"
          >
            <RefreshCcw className="h-4 w-4" />
            Refresh
          </button>
        </div>

        <div className="mt-6 grid gap-3 sm:grid-cols-2">
          <button
            onClick={() => setActiveTab("action")}
            className={`rounded-2xl px-5 py-4 text-left text-sm font-black transition ${
              activeTab === "action"
                ? "bg-slate-950 text-white"
                : "bg-slate-100 text-slate-700 hover:bg-slate-200"
            }`}
          >
            <Bell className="mr-2 inline h-4 w-4" />
            Action Required ({actionableNotifications.length})
          </button>

          <button
            onClick={() => setActiveTab("system")}
            className={`rounded-2xl px-5 py-4 text-left text-sm font-black transition ${
              activeTab === "system"
                ? "bg-slate-950 text-white"
                : "bg-slate-100 text-slate-700 hover:bg-slate-200"
            }`}
          >
            <ClipboardList className="mr-2 inline h-4 w-4" />
            System Log ({systemNotifications.length})
          </button>
        </div>

        {activeTab === "action" && (
          <div className="mt-5 flex flex-wrap gap-2">
            {(["pending", "all", "drafted", "sent", "read", "failed", "cancelled"] as Array<
              "all" | DeliveryStatus
            >).map((item) => (
              <button
                key={item}
                onClick={() => setFilter(item)}
                className={`rounded-full px-4 py-2 text-xs font-bold uppercase tracking-[0.15em] ${
                  filter === item
                    ? "bg-slate-950 text-white"
                    : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                }`}
              >
                {item === "all" ? "All" : formatText(item)}
              </button>
            ))}
          </div>
        )}

        {error && (
          <div className="mt-5 rounded-2xl bg-rose-50 p-4 text-sm font-semibold text-rose-700">
            <AlertTriangle className="mr-2 inline h-4 w-4" />
            {error}
          </div>
        )}

        {loading ? (
          <div className="mt-6 rounded-[26px] border border-dashed border-slate-200 bg-slate-50 p-8 text-center text-sm font-semibold text-slate-500">
            Loading employee notifications...
          </div>
        ) : activeTab === "action" ? (
          filteredActionableNotifications.length === 0 ? (
            <div className="mt-6 rounded-[26px] border border-dashed border-slate-200 bg-slate-50 p-8 text-center">
              <Bell className="mx-auto h-10 w-10 text-slate-300" />
              <div className="mt-3 text-lg font-bold text-slate-950">
                No actionable notifications
              </div>
              <p className="mt-2 text-sm text-slate-500">
                HR warnings, payroll feedback, clocking feedback and manager
                messages will appear here.
              </p>
            </div>
          ) : (
            <div className="mt-6 space-y-4">
              {filteredActionableNotifications.map((notification) => (
                <article
                  key={notification.id}
                  className="rounded-[26px] border border-slate-200 bg-slate-50 p-5"
                >
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                    <div>
                      <div className="text-xl font-bold text-slate-950">
                        {notification.employee_name}
                      </div>
                      <div className="mt-1 text-xs font-semibold text-slate-500">
                        {notification.employee_id} · {formatText(notification.notification_type)}
                      </div>
                    </div>

                    <span
                      className={`w-fit rounded-full px-3 py-1 text-xs font-bold uppercase ${
                        statusStyles[notification.delivery_status]
                      }`}
                    >
                      {formatText(notification.delivery_status)}
                    </span>
                  </div>

                  <div className="mt-5 rounded-2xl bg-white p-4">
                    <div className="text-xs font-bold uppercase tracking-[0.2em] text-slate-400">
                      {notification.title}
                    </div>
                    <p className="mt-2 text-sm leading-6 text-slate-600">
                      {notification.message}
                    </p>
                  </div>

                  <div className="mt-4 grid gap-3 md:grid-cols-3">
                    <div className="rounded-2xl bg-white p-4">
                      <div className="text-xs font-bold uppercase tracking-[0.2em] text-slate-400">
                        Module
                      </div>
                      <div className="mt-2 font-bold text-slate-950">
                        {formatText(notification.related_module)}
                      </div>
                    </div>

                    <div className="rounded-2xl bg-white p-4">
                      <div className="text-xs font-bold uppercase tracking-[0.2em] text-slate-400">
                        Channel
                      </div>
                      <div className="mt-2 font-bold text-slate-950">
                        {formatText(notification.delivery_channel)}
                      </div>
                    </div>

                    <div className="rounded-2xl bg-white p-4">
                      <div className="text-xs font-bold uppercase tracking-[0.2em] text-slate-400">
                        Created
                      </div>
                      <div className="mt-2 font-bold text-slate-950">
                        {formatDateTime(notification.created_at)}
                      </div>
                    </div>
                  </div>

                  <div className="mt-4 flex flex-wrap gap-2">
                    <button
                      onClick={() => openWhatsApp(notification)}
                      disabled={savingId === notification.id}
                      className="flex items-center gap-2 rounded-2xl bg-emerald-600 px-4 py-3 text-sm font-bold text-white disabled:opacity-60"
                    >
                      <MessageCircle className="h-4 w-4" />
                      WhatsApp Draft
                    </button>

                    <button
                      onClick={() => markStatus(notification.id, "sent")}
                      disabled={savingId === notification.id}
                      className="flex items-center gap-2 rounded-2xl bg-slate-950 px-4 py-3 text-sm font-bold text-white disabled:opacity-60"
                    >
                      <Send className="h-4 w-4" />
                      Mark Sent
                    </button>

                    <button
                      onClick={() => markStatus(notification.id, "cancelled")}
                      disabled={savingId === notification.id}
                      className="flex items-center gap-2 rounded-2xl bg-slate-500 px-4 py-3 text-sm font-bold text-white disabled:opacity-60"
                    >
                      <Archive className="h-4 w-4" />
                      Archive
                    </button>
                  </div>
                </article>
              ))}
            </div>
          )
        ) : systemNotifications.length === 0 ? (
          <div className="mt-6 rounded-[26px] border border-dashed border-slate-200 bg-slate-50 p-8 text-center">
            <ClipboardList className="mx-auto h-10 w-10 text-slate-300" />
            <div className="mt-3 text-lg font-bold text-slate-950">
              No system log notifications
            </div>
            <p className="mt-2 text-sm text-slate-500">
              Leave approval/decline history will appear here.
            </p>
          </div>
        ) : (
          <div className="mt-6 space-y-4">
            {systemNotifications.map((notification) => (
              <article
                key={notification.id}
                className="rounded-[26px] border border-slate-200 bg-slate-50 p-5"
              >
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                  <div>
                    <div className="text-xl font-bold text-slate-950">
                      {notification.employee_name}
                    </div>
                    <div className="mt-1 text-xs font-semibold text-slate-500">
                      {notification.employee_id} · {formatText(notification.notification_type)}
                    </div>
                  </div>

                  <span className="w-fit rounded-full bg-slate-200 px-3 py-1 text-xs font-bold uppercase text-slate-700">
                    System Log
                  </span>
                </div>

                <div className="mt-5 rounded-2xl bg-white p-4">
                  <div className="text-xs font-bold uppercase tracking-[0.2em] text-slate-400">
                    {notification.title}
                  </div>
                  <p className="mt-2 text-sm leading-6 text-slate-600">
                    {notification.message}
                  </p>
                </div>

                <div className="mt-4 rounded-2xl bg-cyan-50 p-4 text-sm leading-6 text-cyan-800">
                  <CheckCircle2 className="mr-2 inline h-4 w-4" />
                  No manager action required. This is an automatic system record.
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

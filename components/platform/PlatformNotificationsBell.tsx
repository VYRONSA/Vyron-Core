"use client";

import React, { useEffect, useState } from "react";
import { Bell } from "lucide-react";
import { platformFetch } from "@/lib/platform/platform-client";

type Notification = {
  type: string;
  severity: "info" | "warning" | "critical";
  companyId: string | null;
  title: string;
  message: string;
};

const SEVERITY_DOT: Record<string, string> = {
  info: "bg-cyan-400",
  warning: "bg-amber-400",
  critical: "bg-rose-500",
};

export default function PlatformNotificationsBell() {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const result = await platformFetch<{ notifications: Notification[] }>("/api/platform/notifications");
      if (!cancelled && result.ok) setNotifications(result.data.notifications);
    }
    load();
    const interval = setInterval(load, 60_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="relative rounded-full bg-white/10 p-3 text-white hover:bg-white/20"
      >
        <Bell className="h-5 w-5" />
        {notifications.length > 0 ? (
          <span className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full bg-rose-600 text-[10px] font-black text-white">
            {notifications.length > 9 ? "9+" : notifications.length}
          </span>
        ) : null}
      </button>
      {open ? (
        <div className="absolute right-0 z-20 mt-2 w-80 overflow-hidden rounded-2xl bg-white shadow-xl">
          <div className="max-h-96 overflow-y-auto">
            {notifications.length === 0 ? (
              <p className="p-4 text-sm text-slate-500">No alerts.</p>
            ) : (
              notifications.map((notification, index) => (
                <div key={index} className="flex gap-3 border-b border-slate-100 p-3">
                  <span className={`mt-1 h-2 w-2 flex-shrink-0 rounded-full ${SEVERITY_DOT[notification.severity]}`} />
                  <div>
                    <div className="text-sm font-bold text-slate-900">{notification.title}</div>
                    <div className="text-xs text-slate-500">{notification.message}</div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

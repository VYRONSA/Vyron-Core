"use client";

import React, { useEffect, useState } from "react";
import { platformFetch } from "@/lib/platform/platform-client";
import PlatformPanel from "./PlatformPanel";

type FeatureFlag = { code: string; name: string; description: string | null; is_enabled: boolean; rollout_scope: string };
type Announcement = { id: string; title: string; body: string; is_active: boolean; starts_at: string };
type ReleaseNote = { id: string; version: string; title: string; body: string | null; released_at: string };
type QueueCounts = Record<string, Record<string, number>>;
type HealthData = { database: { reachable: boolean; latencyMs: number }; activeSessions: number; activeImpersonations: number };
type MaintenanceModeSetting = { enabled?: boolean; message?: string; expected_return_at?: string | null; override_code?: string | null };

type GenericSettingValue = Record<string, string | number | undefined>;
type ChannelPrefs = { email?: boolean; inApp?: boolean };
type NotificationPreferences = Record<string, ChannelPrefs>;

const NOTIFICATION_TYPE_LABELS: Record<string, string> = {
  trial_expiring: "Trial expiring",
  subscription_expiring: "Subscription expiring",
  customer_suspended: "Customer suspended",
  customer_inactive: "Customer inactive",
  failed_job: "Failed job",
};

export default function SystemAdministrationPanel() {
  const [flags, setFlags] = useState<FeatureFlag[]>([]);
  const [settings, setSettings] = useState<
    Record<string, ({ enabled?: boolean; message?: string; body?: string } & MaintenanceModeSetting) | GenericSettingValue>
  >({});
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [releaseNotes, setReleaseNotes] = useState<ReleaseNote[]>([]);
  const [queues, setQueues] = useState<QueueCounts | null>(null);
  const [health, setHealth] = useState<HealthData | null>(null);
  const [newAnnouncement, setNewAnnouncement] = useState({ title: "", body: "" });
  const [newRelease, setNewRelease] = useState({ version: "", title: "", body: "" });
  const [error, setError] = useState<string | null>(null);

  async function loadAll() {
    const [flagsRes, settingsRes, announcementsRes, releaseNotesRes, queuesRes, healthRes] = await Promise.all([
      platformFetch<{ flags: FeatureFlag[] }>("/api/platform/system/feature-flags"),
      platformFetch<{ settings: Record<string, { enabled?: boolean; message?: string; body?: string }> }>(
        "/api/platform/system/settings"
      ),
      platformFetch<{ announcements: Announcement[] }>("/api/platform/system/announcements"),
      platformFetch<{ releaseNotes: ReleaseNote[] }>("/api/platform/system/release-notes"),
      platformFetch<{ counts: QueueCounts }>("/api/platform/system/queues"),
      platformFetch<HealthData>("/api/platform/system/health"),
    ]);

    if (flagsRes.ok) setFlags(flagsRes.data.flags);
    if (settingsRes.ok) setSettings(settingsRes.data.settings);
    if (announcementsRes.ok) setAnnouncements(announcementsRes.data.announcements);
    if (releaseNotesRes.ok) setReleaseNotes(releaseNotesRes.data.releaseNotes);
    if (queuesRes.ok) setQueues(queuesRes.data.counts);
    if (healthRes.ok) setHealth(healthRes.data);
  }

  useEffect(() => {
    (async () => {
      await loadAll();
    })();
  }, []);

  async function toggleFlag(flag: FeatureFlag) {
    const result = await platformFetch("/api/platform/system/feature-flags", {
      method: "PATCH",
      body: JSON.stringify({ code: flag.code, isEnabled: !flag.is_enabled }),
    });
    if (!result.ok) return setError(result.message);
    setFlags((prev) => prev.map((f) => (f.code === flag.code ? { ...f, is_enabled: !f.is_enabled } : f)));
  }

  async function saveMaintenanceMode(patch: MaintenanceModeSetting) {
    const nextValue = { ...maintenance, ...patch };
    const result = await platformFetch("/api/platform/system/settings", {
      method: "PATCH",
      body: JSON.stringify({ key: "maintenance_mode", value: nextValue }),
    });
    if (!result.ok) return setError(result.message);
    setSettings((prev) => ({ ...prev, maintenance_mode: nextValue }));
  }

  async function saveLegalContent(key: "terms_content" | "privacy_content", body: string) {
    const result = await platformFetch("/api/platform/system/settings", {
      method: "PATCH",
      body: JSON.stringify({ key, value: { body } }),
    });
    if (!result.ok) return setError(result.message);
    setSettings((prev) => ({ ...prev, [key]: { body } }));
  }

  async function toggleNotificationChannel(notificationType: string, channel: keyof ChannelPrefs) {
    const current = (settings.notification_preferences as NotificationPreferences) || {};
    const nextValue: NotificationPreferences = {
      ...current,
      [notificationType]: { ...current[notificationType], [channel]: !current[notificationType]?.[channel] },
    };
    const result = await platformFetch("/api/platform/system/settings", {
      method: "PATCH",
      body: JSON.stringify({ key: "notification_preferences", value: nextValue }),
    });
    if (!result.ok) return setError(result.message);
    setSettings((prev) => ({ ...prev, notification_preferences: nextValue }));
  }

  async function saveGenericSetting(key: string, field: string, rawValue: string, numeric: boolean) {
    const current = (settings[key] as GenericSettingValue) || {};
    const value = { ...current, [field]: numeric ? Number(rawValue) : rawValue };
    const result = await platformFetch("/api/platform/system/settings", {
      method: "PATCH",
      body: JSON.stringify({ key, value }),
    });
    if (!result.ok) return setError(result.message);
    setSettings((prev) => ({ ...prev, [key]: value }));
  }

  async function addAnnouncement() {
    if (!newAnnouncement.title.trim() || !newAnnouncement.body.trim()) return;
    const result = await platformFetch("/api/platform/system/announcements", {
      method: "POST",
      body: JSON.stringify(newAnnouncement),
    });
    if (!result.ok) return setError(result.message);
    setNewAnnouncement({ title: "", body: "" });
    loadAll();
  }

  async function addReleaseNote() {
    if (!newRelease.version.trim() || !newRelease.title.trim()) return;
    const result = await platformFetch("/api/platform/system/release-notes", {
      method: "POST",
      body: JSON.stringify(newRelease),
    });
    if (!result.ok) return setError(result.message);
    setNewRelease({ version: "", title: "", body: "" });
    loadAll();
  }

  const inputClass = "w-full rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm outline-none focus:border-cyan-500";
  const labelClass = "text-xs font-black uppercase tracking-wide text-slate-500";
  const maintenance = (settings.maintenance_mode as MaintenanceModeSetting & { message?: string }) || {};
  const terms = settings.terms_content || {};
  const privacy = settings.privacy_content || {};

  return (
    <div className="flex flex-col gap-6">
      {error ? <PlatformPanel className="text-rose-700">{error}</PlatformPanel> : null}

      <section className="grid gap-5 md:grid-cols-3">
        <PlatformPanel>
          <div className={labelClass}>Database</div>
          <div className="mt-2 text-2xl font-black text-[#06101f]">
            {health ? (health.database.reachable ? "Healthy" : "Unreachable") : "…"}
          </div>
          {health ? <p className="mt-1 text-xs text-slate-500">{health.database.latencyMs}ms latency</p> : null}
        </PlatformPanel>
        <PlatformPanel>
          <div className={labelClass}>Active Sessions</div>
          <div className="mt-2 text-2xl font-black text-[#06101f]">{health?.activeSessions ?? "…"}</div>
        </PlatformPanel>
        <PlatformPanel>
          <div className={labelClass}>Active Impersonation Sessions</div>
          <div className="mt-2 text-2xl font-black text-[#06101f]">{health?.activeImpersonations ?? "…"}</div>
        </PlatformPanel>
      </section>

      <PlatformPanel>
        <h3 className="text-lg font-black text-[#06101f]">Maintenance Mode</h3>
        <label className="mt-3 flex items-center gap-3 text-sm font-bold text-slate-700">
          <input
            type="checkbox"
            checked={Boolean(maintenance.enabled)}
            onChange={(e) => saveMaintenanceMode({ enabled: e.target.checked })}
          />
          Enable maintenance mode
        </label>
        <textarea
          className={`${inputClass} mt-3`}
          rows={2}
          placeholder="Message shown to customers…"
          defaultValue={maintenance.message || ""}
          onBlur={(e) => saveMaintenanceMode({ message: e.target.value })}
        />
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          <label className="flex flex-col gap-1">
            <span className={labelClass}>Expected Return Time (optional)</span>
            <input
              type="datetime-local"
              className={inputClass}
              defaultValue={maintenance.expected_return_at ? maintenance.expected_return_at.slice(0, 16) : ""}
              onBlur={(e) => saveMaintenanceMode({ expected_return_at: e.target.value ? new Date(e.target.value).toISOString() : null })}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className={labelClass}>Emergency Override Code</span>
            <input
              type="text"
              className={inputClass}
              placeholder="Set a code to allow emergency bypass"
              defaultValue={maintenance.override_code || ""}
              onBlur={(e) => saveMaintenanceMode({ override_code: e.target.value || null })}
            />
          </label>
        </div>
        <p className="mt-2 text-xs text-slate-500">
          Enforced platform-wide via middleware — Platform Operators always bypass; other users are redirected to a
          branded maintenance page. Anyone with the override code above can bypass it from that page (4-hour grace).
        </p>
      </PlatformPanel>

      <PlatformPanel>
        <h3 className="text-lg font-black text-[#06101f]">Platform Defaults & Contact</h3>
        <p className="mt-2 text-xs text-slate-500">
          Read dynamically by customer provisioning and the notifications engine — changing these does not require a deploy.
        </p>
        <div className="mt-4 grid gap-4 md:grid-cols-3">
          <label className="flex flex-col gap-1">
            <span className={labelClass}>Default Trial Days</span>
            <input type="number" className={inputClass} defaultValue={(settings.default_trial_days as GenericSettingValue)?.days ?? 14} onBlur={(e) => saveGenericSetting("default_trial_days", "days", e.target.value, true)} />
          </label>
          <label className="flex flex-col gap-1">
            <span className={labelClass}>Default AI Credits</span>
            <input type="number" className={inputClass} defaultValue={(settings.default_ai_credit_limit as GenericSettingValue)?.credits ?? 500} onBlur={(e) => saveGenericSetting("default_ai_credit_limit", "credits", e.target.value, true)} />
          </label>
          <label className="flex flex-col gap-1">
            <span className={labelClass}>Default Storage (GB)</span>
            <input type="number" className={inputClass} defaultValue={(settings.default_storage_limit_gb as GenericSettingValue)?.gb ?? 25} onBlur={(e) => saveGenericSetting("default_storage_limit_gb", "gb", e.target.value, true)} />
          </label>
          <label className="flex flex-col gap-1">
            <span className={labelClass}>Default Employee Limit</span>
            <input type="number" className={inputClass} defaultValue={(settings.default_employee_limit as GenericSettingValue)?.limit ?? 50} onBlur={(e) => saveGenericSetting("default_employee_limit", "limit", e.target.value, true)} />
          </label>
          <label className="flex flex-col gap-1">
            <span className={labelClass}>Session Idle Timeout (min)</span>
            <input type="number" className={inputClass} defaultValue={(settings.default_session_timeout_minutes as GenericSettingValue)?.idle ?? 30} onBlur={(e) => saveGenericSetting("default_session_timeout_minutes", "idle", e.target.value, true)} />
          </label>
          <label className="flex flex-col gap-1">
            <span className={labelClass}>Session Absolute Timeout (min)</span>
            <input type="number" className={inputClass} defaultValue={(settings.default_session_timeout_minutes as GenericSettingValue)?.absolute ?? 480} onBlur={(e) => saveGenericSetting("default_session_timeout_minutes", "absolute", e.target.value, true)} />
          </label>
          <label className="flex flex-col gap-1">
            <span className={labelClass}>Platform Email</span>
            <input className={inputClass} defaultValue={(settings.platform_email as GenericSettingValue)?.email ?? ""} onBlur={(e) => saveGenericSetting("platform_email", "email", e.target.value, false)} />
          </label>
          <label className="flex flex-col gap-1">
            <span className={labelClass}>Support Email</span>
            <input className={inputClass} defaultValue={(settings.support_contact as GenericSettingValue)?.email ?? ""} onBlur={(e) => saveGenericSetting("support_contact", "email", e.target.value, false)} />
          </label>
          <label className="flex flex-col gap-1">
            <span className={labelClass}>Support Phone</span>
            <input className={inputClass} defaultValue={(settings.support_contact as GenericSettingValue)?.phone ?? ""} onBlur={(e) => saveGenericSetting("support_contact", "phone", e.target.value, false)} />
          </label>
        </div>
      </PlatformPanel>

      <PlatformPanel>
        <h3 className="text-lg font-black text-[#06101f]">Notification Preferences</h3>
        <p className="mt-2 text-xs text-slate-500">
          Per-type channel routing for operator alerts. In-App is live (the bell in the header). Email reuses the
          templates in lib/platform/email-templates.ts but has no delivery provider wired up yet — enabling it here
          only marks intent. SMS/WhatsApp are reserved for a future channel integration.
        </p>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[480px] text-left text-sm">
            <thead>
              <tr className="text-xs font-black uppercase tracking-wide text-slate-500">
                <th className="px-3 py-2">Notification</th>
                <th className="px-3 py-2">In-App</th>
                <th className="px-3 py-2">Email</th>
                <th className="px-3 py-2">SMS/WhatsApp</th>
              </tr>
            </thead>
            <tbody>
              {Object.keys(NOTIFICATION_TYPE_LABELS).map((type) => {
                const prefs = ((settings.notification_preferences as NotificationPreferences) || {})[type] || {};
                return (
                  <tr key={type} className="border-b border-slate-100">
                    <td className="px-3 py-2 font-bold text-slate-800">{NOTIFICATION_TYPE_LABELS[type]}</td>
                    <td className="px-3 py-2">
                      <input type="checkbox" checked={Boolean(prefs.inApp)} onChange={() => toggleNotificationChannel(type, "inApp")} />
                    </td>
                    <td className="px-3 py-2">
                      <input type="checkbox" checked={Boolean(prefs.email)} onChange={() => toggleNotificationChannel(type, "email")} />
                    </td>
                    <td className="px-3 py-2 text-xs text-slate-400">Coming soon</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </PlatformPanel>

      <PlatformPanel>
        <h3 className="text-lg font-black text-[#06101f]">Feature Flags</h3>
        <div className="mt-4 flex flex-col gap-2">
          {flags.length === 0 ? (
            <p className="text-sm text-slate-500">No feature flags defined yet.</p>
          ) : (
            flags.map((flag) => (
              <label key={flag.code} className="flex items-center justify-between rounded-2xl border border-slate-200 bg-white px-4 py-3">
                <div>
                  <div className="text-sm font-bold text-slate-900">{flag.name}</div>
                  {flag.description ? <div className="text-xs text-slate-500">{flag.description}</div> : null}
                </div>
                <input type="checkbox" checked={flag.is_enabled} onChange={() => toggleFlag(flag)} />
              </label>
            ))
          )}
        </div>
      </PlatformPanel>

      <PlatformPanel>
        <h3 className="text-lg font-black text-[#06101f]">Platform Announcements</h3>
        <div className="mt-3 flex flex-col gap-2">
          <input className={inputClass} placeholder="Title" value={newAnnouncement.title} onChange={(e) => setNewAnnouncement((p) => ({ ...p, title: e.target.value }))} />
          <textarea className={inputClass} rows={2} placeholder="Body" value={newAnnouncement.body} onChange={(e) => setNewAnnouncement((p) => ({ ...p, body: e.target.value }))} />
          <button type="button" onClick={addAnnouncement} className="w-fit rounded-full bg-[#06101f] px-5 py-2 text-xs font-black text-white">
            Publish Announcement
          </button>
        </div>
        <ul className="mt-4 flex flex-col gap-2 text-sm">
          {announcements.map((announcement) => (
            <li key={announcement.id} className="rounded-2xl border border-slate-100 p-3">
              <div className="font-bold text-slate-900">{announcement.title}</div>
              <div className="text-slate-600">{announcement.body}</div>
            </li>
          ))}
        </ul>
      </PlatformPanel>

      <PlatformPanel>
        <h3 className="text-lg font-black text-[#06101f]">Release Notes</h3>
        <div className="mt-3 flex flex-col gap-2 md:flex-row">
          <input className={inputClass} placeholder="Version" value={newRelease.version} onChange={(e) => setNewRelease((p) => ({ ...p, version: e.target.value }))} />
          <input className={inputClass} placeholder="Title" value={newRelease.title} onChange={(e) => setNewRelease((p) => ({ ...p, title: e.target.value }))} />
        </div>
        <textarea className={`${inputClass} mt-2`} rows={2} placeholder="Notes" value={newRelease.body} onChange={(e) => setNewRelease((p) => ({ ...p, body: e.target.value }))} />
        <button type="button" onClick={addReleaseNote} className="mt-2 w-fit rounded-full bg-[#06101f] px-5 py-2 text-xs font-black text-white">
          Publish Release Note
        </button>
        <ul className="mt-4 flex flex-col gap-2 text-sm">
          {releaseNotes.map((note) => (
            <li key={note.id} className="rounded-2xl border border-slate-100 p-3">
              <div className="font-bold text-slate-900">v{note.version} — {note.title}</div>
              {note.body ? <div className="text-slate-600">{note.body}</div> : null}
            </li>
          ))}
        </ul>
      </PlatformPanel>

      <PlatformPanel>
        <h3 className="text-lg font-black text-[#06101f]">Terms & Conditions / Privacy Policy</h3>
        <div className="mt-3 grid gap-4 md:grid-cols-2">
          <label className="flex flex-col gap-2">
            <span className={labelClass}>Terms & Conditions</span>
            <textarea className={inputClass} rows={6} defaultValue={terms.body || ""} onBlur={(e) => saveLegalContent("terms_content", e.target.value)} />
          </label>
          <label className="flex flex-col gap-2">
            <span className={labelClass}>Privacy Policy</span>
            <textarea className={inputClass} rows={6} defaultValue={privacy.body || ""} onBlur={(e) => saveLegalContent("privacy_content", e.target.value)} />
          </label>
        </div>
      </PlatformPanel>

      <PlatformPanel>
        <h3 className="text-lg font-black text-[#06101f]">Background Jobs / Queues</h3>
        <p className="mt-2 text-xs text-slate-500">
          Tracking view only — jobs logged here (email sends, etc.) are not yet processed by an async worker.
        </p>
        <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {queues &&
            Object.entries(queues).map(([queueName, counts]) => (
              <div key={queueName} className="rounded-2xl border border-slate-200 bg-white p-4">
                <div className="text-xs font-black uppercase text-slate-500">{queueName}</div>
                <div className="mt-2 flex flex-col gap-1 text-xs text-slate-600">
                  {Object.entries(counts).map(([status, count]) => (
                    <div key={status} className="flex justify-between">
                      <span className="capitalize">{status}</span>
                      <span className="font-bold">{count}</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
        </div>
      </PlatformPanel>
    </div>
  );
}

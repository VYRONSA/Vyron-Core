"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Bell,
  Briefcase,
  Camera,
  Clock3,
  FileText,
  MapPin,
  ShieldAlert,
  Smartphone,
  ListTodo,
  RefreshCcw,
} from "lucide-react";
import MobileOfflineSyncBar from "@/components/mobile-workforce/MobileOfflineSyncBar";
import {
  captureBrowserGps,
  capturePhotoFromFile,
  createMobileTask,
  fetchEmployeeMobileDocuments,
  loadMobileWorkforceHub,
  markMobileNotificationRead,
  MOBILE_WORKFLOW_STEPS,
  respondToMobileTask,
  saveMobilePhotoEvidence,
  submitMobileIncident,
  workflowProgressIndex,
  type MobileWorkforceHub,
} from "@/lib/mobile-workforce-platform";
import { validateMobileGpsRadius, gpsRadiusLabel } from "@/lib/mobile-workforce-gps";
import {
  enqueueOfflineAction,
  getOfflineQueueStatus,
  isBrowserOnline,
} from "@/lib/mobile-workforce-offline";
import {
  formatFieldTimestamp,
  recordFieldJobEvent,
  type FieldEventType,
} from "@/lib/field-operations";
import { supabase } from "@/lib/supabase";

type EmployeeRow = {
  id: string;
  first_name: string;
  last_name: string;
  active: boolean;
};

type StoreRow = { id: string; name: string; gps_radius_meters?: number | null };

type Props = {
  companyId: string;
  employees: EmployeeRow[];
  stores?: StoreRow[];
  userEmail?: string | null;
  canAssignTasks?: boolean;
};

type HubView = "hub" | "workflow" | "tasks" | "documents" | "notifications" | "incidents";

function employeeName(e: EmployeeRow) {
  return `${e.first_name} ${e.last_name}`.trim();
}

export default function MobileWorkforceHub({
  companyId,
  employees,
  stores = [],
  userEmail,
  canAssignTasks = false,
}: Props) {
  const [employeeId, setEmployeeId] = useState("");
  const [jobId, setJobId] = useState("");
  const [hub, setHub] = useState<MobileWorkforceHub | null>(null);
  const [documents, setDocuments] = useState<
    Awaited<ReturnType<typeof fetchEmployeeMobileDocuments>>
  >([]);
  const [view, setView] = useState<HubView>("hub");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [gpsLabel, setGpsLabel] = useState<string | null>(null);
  const [notes, setNotes] = useState("");
  const [taskTitle, setTaskTitle] = useState("");
  const [taskDescription, setTaskDescription] = useState("");
  const [incidentTitle, setIncidentTitle] = useState("");
  const [incidentDescription, setIncidentDescription] = useState("");
  const [incidentPhoto, setIncidentPhoto] = useState<string | null>(null);

  const activeEmployees = useMemo(() => employees.filter((e) => e.active), [employees]);

  const lastFieldEvent = useMemo(() => {
    if (!hub?.todayTimeline.length) return null;
    return hub.todayTimeline[hub.todayTimeline.length - 1].eventType;
  }, [hub]);

  const progressIndex = workflowProgressIndex(lastFieldEvent);

  const load = useCallback(async () => {
    if (!companyId || !employeeId) return;
    setLoading(true);
    const data = await loadMobileWorkforceHub(supabase, companyId, employeeId);
    setHub(data);
    const docs = await fetchEmployeeMobileDocuments(supabase, companyId, employeeId);
    setDocuments(docs);
    setLoading(false);
  }, [companyId, employeeId]);

  useEffect(() => {
    if (!employeeId && activeEmployees.length === 1) {
      setEmployeeId(activeEmployees[0].id);
    }
  }, [activeEmployees, employeeId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function runWithOfflineFallback(
    type: "field_event" | "photo_evidence" | "incident_report" | "clock_in" | "clock_out",
    payload: Record<string, unknown>,
    onlineAction: () => Promise<boolean>
  ): Promise<void> {
    setError(null);
    setMessage(null);
    setBusy(true);

    if (!isBrowserOnline()) {
      enqueueOfflineAction({ type, companyId, employeeId, payload });
      setMessage("Saved offline — will sync when connection returns.");
      setBusy(false);
      return;
    }

    const ok = await onlineAction();
    setBusy(false);
    if (ok) {
      setMessage("Action recorded.");
      await load();
    }
  }

  async function handleWorkflowEvent(eventType: FieldEventType) {
    const gps = await captureBrowserGps();
    const selectedJob = hub?.assignedJobs.find((j) => j.id === jobId);

    if (
      selectedJob?.latitude != null &&
      selectedJob?.longitude != null &&
      gps.latitude != null &&
      gps.longitude != null
    ) {
      const store = stores.find((s) => s.id === selectedJob.storeId);
      const radius = store?.gps_radius_meters ?? 150;
      const validation = await validateMobileGpsRadius(supabase, {
        companyId,
        employeeId,
        employeeLat: gps.latitude,
        employeeLng: gps.longitude,
        siteLat: selectedJob.latitude,
        siteLng: selectedJob.longitude,
        radiusMeters: radius,
        jobId: selectedJob.id,
        storeId: selectedJob.storeId,
      });
      setGpsLabel(gpsRadiusLabel(validation));
    }

    const requiresJob = eventType !== "Start Day" && eventType !== "End Day";
    if (requiresJob && !jobId) {
      setError("Select a job for this step.");
      return;
    }

    await runWithOfflineFallback(
      "field_event",
      {
        eventType,
        jobId: requiresJob ? jobId : null,
        latitude: gps.latitude,
        longitude: gps.longitude,
        accuracy: gps.accuracy,
        notes,
        deviceInfo: typeof navigator !== "undefined" ? navigator.userAgent.slice(0, 120) : null,
      },
      async () => {
        const result = await recordFieldJobEvent(supabase, {
          companyId,
          employeeId,
          eventType,
          jobId: requiresJob ? jobId : null,
          gps,
          notes: notes.trim() || null,
        });
        if (result.error) {
          setError(result.error);
          return false;
        }
        return true;
      }
    );
    setNotes("");
  }

  async function handlePhotoEvidence(
    evidenceType: "clock_in" | "clock_out" | "arrive_site" | "complete_job",
    file: File
  ) {
    const photoUrl = await capturePhotoFromFile(file);
    if (!photoUrl) {
      setError("Could not read photo.");
      return;
    }
    const gps = await captureBrowserGps();

    await runWithOfflineFallback(
      "photo_evidence",
      {
        evidenceType,
        jobId: jobId || null,
        photoUrl,
        latitude: gps.latitude,
        longitude: gps.longitude,
        gpsAccuracy: gps.accuracy,
      },
      async () => {
        const result = await saveMobilePhotoEvidence(supabase, {
          companyId,
          employeeId,
          evidenceType,
          jobId: jobId || null,
          photoUrl,
          latitude: gps.latitude,
          longitude: gps.longitude,
          gpsAccuracy: gps.accuracy,
        });
        if (result.error) {
          setError(result.error);
          return false;
        }
        return result.ok;
      }
    );
  }

  async function handleTaskResponse(taskId: string, action: "accept" | "reject" | "complete") {
    setBusy(true);
    const result = await respondToMobileTask(supabase, taskId, action);
    setBusy(false);
    if (result.error) setError(result.error);
    else await load();
  }

  async function handleAssignTask() {
    if (!canAssignTasks || !taskTitle.trim()) return;
    setBusy(true);
    const result = await createMobileTask(supabase, {
      companyId,
      assignedToEmployeeId: employeeId,
      assignedByEmail: userEmail || "manager@workspace",
      title: taskTitle,
      description: taskDescription,
      priority: "normal",
    });
    setBusy(false);
    if (result.error) setError(result.error);
    else {
      setTaskTitle("");
      setTaskDescription("");
      await load();
    }
  }

  async function handleIncidentSubmit() {
    if (!incidentTitle.trim() || !incidentDescription.trim()) {
      setError("Title and description required.");
      return;
    }
    const gps = await captureBrowserGps();
    await runWithOfflineFallback(
      "incident_report",
      {
        title: incidentTitle,
        description: incidentDescription,
        photoUrl: incidentPhoto,
        latitude: gps.latitude,
        longitude: gps.longitude,
      },
      async () => {
        const result = await submitMobileIncident(supabase, {
          companyId,
          employeeId,
          title: incidentTitle,
          description: incidentDescription,
          photoUrl: incidentPhoto,
          latitude: gps.latitude,
          longitude: gps.longitude,
        });
        if (result.error) {
          setError(result.error);
          return false;
        }
        setIncidentTitle("");
        setIncidentDescription("");
        setIncidentPhoto(null);
        return result.ok;
      }
    );
  }

  const unreadNotifications = hub?.notifications.filter((n) => !n.readAt).length ?? 0;
  const queueStatus = getOfflineQueueStatus();

  return (
    <div className="mx-auto max-w-lg space-y-4 pb-8">
      <section className="rounded-[2rem] border border-[#06101f] bg-[#06101f] p-5 text-white shadow-xl">
        <div className="flex items-center gap-3">
          <div className="rounded-2xl bg-cyan-400/15 p-2.5 text-cyan-300">
            <Smartphone className="h-6 w-6" />
          </div>
          <div>
            <div className="text-[10px] font-bold uppercase tracking-[0.35em] text-cyan-300">
              Mobile Workforce Hub
            </div>
            <h1 className="text-xl font-black">Field teams · mobile ready</h1>
          </div>
        </div>
        <p className="mt-3 text-xs leading-5 text-slate-400">
          Technicians, guards, farm workers, drivers, maintenance & sales teams — clock, travel,
          jobs, evidence & incidents from one hub.
        </p>
      </section>

      <MobileOfflineSyncBar onSynced={() => void load()} />

      <label className="block text-sm font-bold text-slate-700">
        Employee
        <select
          value={employeeId}
          onChange={(e) => setEmployeeId(e.target.value)}
          className="mt-2 w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm font-semibold"
        >
          <option value="">Select…</option>
          {activeEmployees.map((e) => (
            <option key={e.id} value={e.id}>
              {employeeName(e)}
            </option>
          ))}
        </select>
      </label>

      {employeeId ? (
        <>
          <nav className="flex flex-wrap gap-2">
            {(
              [
                ["hub", "Hub", Smartphone],
                ["workflow", "Jobs", Briefcase],
                ["tasks", "Tasks", ListTodo],
                ["documents", "Docs", FileText],
                ["notifications", "Alerts", Bell],
                ["incidents", "Safety", ShieldAlert],
              ] as const
            ).map(([id, label, Icon]) => (
              <button
                key={id}
                type="button"
                onClick={() => setView(id)}
                className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-black ${
                  view === id
                    ? "border-cyan-600 bg-cyan-600 text-white"
                    : "border-slate-200 bg-white text-slate-700"
                }`}
              >
                <Icon className="h-3.5 w-3.5" />
                {label}
                {id === "notifications" && unreadNotifications > 0 ? (
                  <span className="rounded-full bg-rose-500 px-1.5 text-[10px] text-white">
                    {unreadNotifications}
                  </span>
                ) : null}
              </button>
            ))}
          </nav>

          {error ? (
            <p className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-800">
              {error}
            </p>
          ) : null}
          {message ? (
            <p className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-800">
              {message}
            </p>
          ) : null}

          {view === "hub" && (
            <div className="space-y-3">
              {loading ? (
                <p className="text-sm text-slate-500">Loading hub…</p>
              ) : (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    <HubCard
                      icon={Clock3}
                      label="Clock"
                      value={
                        hub?.clockStatus === "clocked_in"
                          ? "Clocked in"
                          : hub?.clockStatus === "clocked_out"
                            ? "Clocked out"
                            : "—"
                      }
                    />
                    <HubCard
                      icon={Briefcase}
                      label="Shift"
                      value={hub?.currentShift?.status || "Not started"}
                    />
                    <HubCard
                      icon={MapPin}
                      label="Jobs today"
                      value={String(hub?.assignedJobs.length ?? 0)}
                    />
                    <HubCard
                      icon={ListTodo}
                      label="Leave balance"
                      value={
                        hub?.leaveBalanceDays != null
                          ? `${hub.leaveBalanceDays.toFixed(1)} days`
                          : "—"
                      }
                    />
                  </div>

                  <section className="rounded-2xl border border-slate-200 bg-white p-4">
                    <h3 className="text-sm font-black text-slate-900">Today&apos;s timeline</h3>
                    {hub?.todayTimeline.length ? (
                      <ul className="mt-3 space-y-2">
                        {hub.todayTimeline.map((ev) => (
                          <li
                            key={ev.id}
                            className="flex justify-between rounded-xl bg-slate-50 px-3 py-2 text-xs"
                          >
                            <span className="font-bold">{ev.eventType}</span>
                            <span className="text-slate-500">
                              {formatFieldTimestamp(ev.recordedAt)}
                            </span>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="mt-2 text-xs text-slate-500">No events yet today.</p>
                    )}
                  </section>

                  {!hub?.tablesAvailable ? (
                    <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-900">
                      Run <code className="rounded bg-white px-1">sql/031-mobile-workforce-platform.sql</code>{" "}
                      for tasks, notifications & incidents.
                    </p>
                  ) : null}
                </>
              )}
            </div>
          )}

          {view === "workflow" && (
            <div className="space-y-4">
              <label className="block text-sm font-bold text-slate-700">
                Active job
                <select
                  value={jobId}
                  onChange={(e) => setJobId(e.target.value)}
                  className="mt-2 w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm font-semibold"
                >
                  <option value="">Select job…</option>
                  {(hub?.assignedJobs || []).map((job) => (
                    <option key={job.id} value={job.id}>
                      {job.jobRef} · {job.title}
                    </option>
                  ))}
                </select>
              </label>

              <div className="rounded-2xl border border-slate-200 bg-white p-4">
                <div className="text-xs font-black uppercase tracking-wider text-slate-500">
                  Day progress
                </div>
                <div className="mt-3 flex gap-1">
                  {MOBILE_WORKFLOW_STEPS.map((step, idx) => (
                    <div
                      key={step}
                      className={`h-2 flex-1 rounded-full ${
                        idx <= progressIndex ? "bg-cyan-500" : "bg-slate-200"
                      }`}
                      title={step}
                    />
                  ))}
                </div>
                <p className="mt-2 text-xs font-semibold text-slate-600">
                  Last: {lastFieldEvent || "—"}
                  {queueStatus.pending > 0 ? ` · ${queueStatus.pending} pending sync` : ""}
                </p>
                {gpsLabel ? (
                  <p className="mt-2 text-xs font-semibold text-cyan-800">{gpsLabel}</p>
                ) : null}
              </div>

              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={2}
                placeholder="Notes (optional)"
                className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm"
              />

              <div className="grid grid-cols-2 gap-2">
                {MOBILE_WORKFLOW_STEPS.map((step) => (
                  <button
                    key={step}
                    type="button"
                    disabled={busy}
                    onClick={() => void handleWorkflowEvent(step)}
                    className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 text-left text-xs font-black text-slate-900 hover:border-cyan-300 disabled:opacity-50"
                  >
                    {step}
                  </button>
                ))}
              </div>

              <div className="rounded-2xl border border-dashed border-cyan-300 bg-cyan-50/50 p-4">
                <div className="flex items-center gap-2 text-sm font-black text-cyan-900">
                  <Camera className="h-4 w-4" />
                  Photo evidence
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  {(
                    [
                      ["clock_in", "Clock In"],
                      ["clock_out", "Clock Out"],
                      ["arrive_site", "Arrive Site"],
                      ["complete_job", "Complete Job"],
                    ] as const
                  ).map(([type, label]) => (
                    <label
                      key={type}
                      className="cursor-pointer rounded-xl border border-cyan-200 bg-white px-3 py-2 text-center text-xs font-bold text-cyan-900"
                    >
                      {label}
                      <input
                        type="file"
                        accept="image/*"
                        capture="environment"
                        className="hidden"
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file) void handlePhotoEvidence(type, file);
                        }}
                      />
                    </label>
                  ))}
                </div>
              </div>
            </div>
          )}

          {view === "tasks" && (
            <div className="space-y-3">
              {canAssignTasks ? (
                <div className="rounded-2xl border border-slate-200 bg-white p-4">
                  <h3 className="text-sm font-black">Assign task</h3>
                  <input
                    value={taskTitle}
                    onChange={(e) => setTaskTitle(e.target.value)}
                    placeholder="Task title"
                    className="mt-2 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
                  />
                  <textarea
                    value={taskDescription}
                    onChange={(e) => setTaskDescription(e.target.value)}
                    placeholder="Description"
                    rows={2}
                    className="mt-2 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
                  />
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void handleAssignTask()}
                    className="mt-3 rounded-xl bg-[#06101f] px-4 py-2 text-xs font-black text-cyan-300"
                  >
                    Assign to employee
                  </button>
                </div>
              ) : null}

              {(hub?.tasks || []).map((task) => (
                <article
                  key={task.id}
                  className="rounded-2xl border border-slate-200 bg-white p-4"
                >
                  <div className="font-black text-slate-900">{task.title}</div>
                  <p className="mt-1 text-xs text-slate-500">{task.description}</p>
                  <div className="mt-2 text-[10px] font-bold uppercase text-slate-400">
                    {task.status} · {task.priority}
                  </div>
                  {task.status === "pending" || task.status === "accepted" ? (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {task.status === "pending" ? (
                        <>
                          <button
                            type="button"
                            onClick={() => void handleTaskResponse(task.id, "accept")}
                            className="rounded-lg bg-emerald-100 px-3 py-1 text-xs font-black text-emerald-800"
                          >
                            Accept
                          </button>
                          <button
                            type="button"
                            onClick={() => void handleTaskResponse(task.id, "reject")}
                            className="rounded-lg bg-rose-100 px-3 py-1 text-xs font-black text-rose-800"
                          >
                            Reject
                          </button>
                        </>
                      ) : (
                        <button
                          type="button"
                          onClick={() => void handleTaskResponse(task.id, "complete")}
                          className="rounded-lg bg-cyan-100 px-3 py-1 text-xs font-black text-cyan-900"
                        >
                          Complete
                        </button>
                      )}
                    </div>
                  ) : null}
                </article>
              ))}
              {!hub?.tasks.length ? (
                <p className="text-sm text-slate-500">No tasks assigned.</p>
              ) : null}
            </div>
          )}

          {view === "documents" && (
            <div className="space-y-2">
              <p className="text-xs font-semibold text-slate-500">Read-only employee vault</p>
              {documents.map((doc) => (
                <div
                  key={doc.id}
                  className="flex items-center justify-between rounded-xl border border-slate-200 bg-white px-4 py-3"
                >
                  <div>
                    <div className="text-sm font-bold text-slate-900">{doc.title}</div>
                    <div className="text-[10px] font-bold uppercase text-slate-400">
                      {doc.category}
                    </div>
                  </div>
                  <FileText className="h-4 w-4 text-slate-400" />
                </div>
              ))}
              {!documents.length ? (
                <p className="text-sm text-slate-500">No documents for this employee.</p>
              ) : null}
            </div>
          )}

          {view === "notifications" && (
            <div className="space-y-2">
              {(hub?.notifications || []).map((n) => (
                <button
                  key={n.id}
                  type="button"
                  onClick={() => {
                    void markMobileNotificationRead(supabase, n.id).then(() => load());
                  }}
                  className={`w-full rounded-xl border px-4 py-3 text-left ${
                    n.readAt ? "border-slate-100 bg-slate-50" : "border-cyan-200 bg-cyan-50"
                  }`}
                >
                  <div className="text-sm font-bold text-slate-900">{n.title}</div>
                  <div className="text-xs text-slate-600">{n.body}</div>
                  <div className="mt-1 text-[10px] font-bold uppercase text-slate-400">
                    {n.notificationType}
                  </div>
                </button>
              ))}
              {!hub?.notifications.length ? (
                <p className="text-sm text-slate-500">No notifications.</p>
              ) : null}
            </div>
          )}

          {view === "incidents" && (
            <div className="space-y-4 rounded-2xl border border-rose-100 bg-rose-50/30 p-4">
              <h3 className="text-sm font-black text-rose-900">Report incident</h3>
              <input
                value={incidentTitle}
                onChange={(e) => setIncidentTitle(e.target.value)}
                placeholder="Incident title"
                className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
              />
              <textarea
                value={incidentDescription}
                onChange={(e) => setIncidentDescription(e.target.value)}
                placeholder="What happened?"
                rows={3}
                className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
              />
              <label className="block cursor-pointer rounded-xl border border-dashed border-rose-300 bg-white px-4 py-3 text-center text-xs font-bold text-rose-800">
                Add photo
                <input
                  type="file"
                  accept="image/*"
                  capture="environment"
                  className="hidden"
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    if (file) setIncidentPhoto(await capturePhotoFromFile(file));
                  }}
                />
              </label>
              <button
                type="button"
                disabled={busy}
                onClick={() => void handleIncidentSubmit()}
                className="w-full rounded-xl bg-rose-700 px-4 py-3 text-sm font-black text-white"
              >
                Submit incident
              </button>
            </div>
          )}

          <button
            type="button"
            onClick={() => void load()}
            className="inline-flex items-center gap-2 text-xs font-black text-slate-500"
          >
            <RefreshCcw className="h-3.5 w-3.5" />
            Refresh hub
          </button>
        </>
      ) : (
        <p className="text-sm text-slate-500">Select an employee to open the mobile hub.</p>
      )}
    </div>
  );
}

function HubCard({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ElementType;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <Icon className="h-4 w-4 text-cyan-700" />
      <div className="mt-2 text-lg font-black text-slate-950">{value}</div>
      <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">{label}</div>
    </div>
  );
}

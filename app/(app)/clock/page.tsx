"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  Camera,
  CheckCircle2,
  Clock3,
  MapPin,
  RefreshCcw,
  Search,
  ShieldCheck,
  UserRound,
} from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  formatClientSafeError,
  resolveKioskCompanyId,
} from "@/lib/kiosk-company-context";
import ClockingAttendanceEnterprisePanel from "@/components/ClockingAttendanceEnterprisePanel";
import { supabase } from "@/lib/supabase";

type EmployeeRow = {
  id: string;
  company_id?: string | null;
  employee_number: string | null;
  first_name: string;
  last_name: string;
  job_title: string | null;
  default_store_id: string | null;
  active: boolean;
  email: string | null;
  phone: string | null;
  pin_code?: string | null;
};

type StoreRow = {
  id: string;
  name: string;
  city: string | null;
  region: string | null;
  status: string;
};

type ClockEventRow = {
  id: string;
  company_id?: string | null;
  employee_id: string;
  store_id: string | null;
  roster_shift_id: string | null;
  event_type: string;
  event_time: string;
  source: string;
  latitude: number | null;
  longitude: number | null;
  gps_accuracy?: number | null;
  photo_url?: string | null;
  photo_bucket?: string | null;
  photo_path?: string | null;
  device_info?: string | null;
  clock_note?: string | null;
};

function employeeName(employee: EmployeeRow | null | undefined) {
  if (!employee) return "Unknown employee";
  return `${employee.first_name || ""} ${employee.last_name || ""}`.trim();
}

function isClockIn(value: string | null | undefined) {
  const normalised = String(value || "").toLowerCase();
  return normalised === "clock_in" || normalised === "in";
}

function isClockOut(value: string | null | undefined) {
  const normalised = String(value || "").toLowerCase();
  return normalised === "clock_out" || normalised === "out";
}

function formatTime(value: string | null | undefined) {
  if (!value) return "--:--";
  try {
    return new Date(value).toLocaleTimeString("en-ZA", {
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "--:--";
  }
}

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

function todayRange() {
  const start = new Date();
  start.setHours(0, 0, 0, 0);

  const end = new Date(start);
  end.setDate(end.getDate() + 1);

  return {
    startIso: start.toISOString(),
    endIso: end.toISOString(),
  };
}

function currentDateLabel() {
  return new Date().toLocaleDateString("en-ZA", {
    weekday: "long",
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
}

function currentTimeLabel() {
  return new Date().toLocaleTimeString("en-ZA", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function ClockPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [companyId, setCompanyId] = useState("");

  const [employees, setEmployees] = useState<EmployeeRow[]>([]);
  const [stores, setStores] = useState<StoreRow[]>([]);
  const [todayEvents, setTodayEvents] = useState<ClockEventRow[]>([]);

  const [employeeSearch, setEmployeeSearch] = useState("");
  const [staffCode, setStaffCode] = useState("");
  const [pinCode, setPinCode] = useState("");
  const [selectedEmployeeId, setSelectedEmployeeId] = useState("");
  const [storeId, setStoreId] = useState("");
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoPreviewUrl, setPhotoPreviewUrl] = useState<string | null>(null);
  const [cameraActive, setCameraActive] = useState(false);
  const [cameraLoading, setCameraLoading] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const cameraStreamRef = useRef<MediaStream | null>(null);

  const [loading, setLoading] = useState(true);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const [message, setMessage] = useState<string | null>(null);
  const [gpsMessage, setGpsMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const selectedEmployee = useMemo(
    () => employees.find((employee) => employee.id === selectedEmployeeId) || null,
    [employees, selectedEmployeeId]
  );

  const selectedStore = useMemo(
    () => stores.find((store) => store.id === storeId) || null,
    [stores, storeId]
  );

  const activeEmployees = useMemo(
    () => employees.filter((employee) => employee.active !== false),
    [employees]
  );

  const matchedEmployees = useMemo(() => {
    const term = employeeSearch.trim().toLowerCase();

    if (!term) return activeEmployees;

    return activeEmployees.filter((employee) =>
      [
        employee.employee_number || "",
        employee.first_name || "",
        employee.last_name || "",
        employee.job_title || "",
        employee.email || "",
        employee.phone || "",
      ]
        .join(" ")
        .toLowerCase()
        .includes(term)
    );
  }, [activeEmployees, employeeSearch]);

  const hasSearchTerm = employeeSearch.trim().length > 0;
  const searchHasMatches = matchedEmployees.length > 0;
  const visibleEmployees = (searchHasMatches ? matchedEmployees : activeEmployees).slice(0, 80);

  const lastEvent = todayEvents[0] || null;
  const currentlyClockedIn = lastEvent ? isClockIn(lastEvent.event_type) : false;
  const nextAction: "clock_in" | "clock_out" = currentlyClockedIn ? "clock_out" : "clock_in";

  const firstClockInToday = [...todayEvents].reverse().find((event) => isClockIn(event.event_type));
  const lastClockOutToday = todayEvents.find((event) => isClockOut(event.event_type));

  useEffect(() => {
    void initKiosk();

    return () => {
      stopCamera();
      if (photoPreviewUrl) URL.revokeObjectURL(photoPreviewUrl);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  async function initKiosk() {
    const resolved = await resolveKioskCompanyId(supabase, searchParams.get("company"));
    setCompanyId(resolved.companyId);
    if (resolved.error) {
      setError(resolved.error);
      setLoading(false);
      return;
    }
    await loadBaseData(resolved.companyId);
  }

  useEffect(() => {
    if (selectedEmployeeId) {
      loadTodayEvents(selectedEmployeeId);
    } else {
      setTodayEvents([]);
    }
  }, [selectedEmployeeId]);

  async function loadBaseData(activeCompanyId: string) {
    setLoading(true);
    setError(null);

    const [employeeResult, storeResult] = await Promise.all([
      supabase
        .from("employees")
        .select("id,company_id,employee_number,first_name,last_name,job_title,default_store_id,active,email,phone,pin_code")
        .eq("company_id", activeCompanyId)
        .order("first_name", { ascending: true }),
      supabase
        .from("stores")
        .select("id,name,city,region,status")
        .eq("company_id", activeCompanyId)
        .order("name", { ascending: true }),
    ]);

    if (employeeResult.error) {
      setError(formatClientSafeError(employeeResult.error.message));
      setLoading(false);
      return;
    }

    if (storeResult.error) {
      setError(formatClientSafeError(storeResult.error.message));
      setLoading(false);
      return;
    }

    setEmployees((employeeResult.data || []) as EmployeeRow[]);
    setStores((storeResult.data || []) as StoreRow[]);
    setLoading(false);
  }

  async function loadTodayEvents(employeeId: string) {
    setHistoryLoading(true);
    setError(null);

    const { startIso, endIso } = todayRange();

    let clockQuery = supabase
      .from("clock_events")
      .select("*")
      .eq("employee_id", employeeId)
      .gte("event_time", startIso)
      .lt("event_time", endIso);

    if (companyId) {
      clockQuery = clockQuery.eq("company_id", companyId);
    }

    const { data, error: eventError } = await clockQuery.order("event_time", { ascending: false });

    if (eventError) {
      setError(formatClientSafeError(eventError.message));
      setTodayEvents([]);
      setHistoryLoading(false);
      return;
    }

    setTodayEvents((data || []) as ClockEventRow[]);
    setHistoryLoading(false);
  }

  function selectEmployee(employee: EmployeeRow) {
    setSelectedEmployeeId(employee.id);
    setEmployeeSearch(employeeName(employee));
    setStaffCode("");
    setPinCode("");
    clearPhoto();
    setMessage(null);
    setGpsMessage(null);
    setError(null);

    if (employee.default_store_id) {
      setStoreId(employee.default_store_id);
    }
  }

  function findEmployeeByCode() {
    const code = staffCode.trim().toLowerCase();

    if (!code) {
      setError("Type your staff code, employee number, phone number or PIN first.");
      return;
    }

    const match = employees.find((employee) => {
      const pin = String(employee.pin_code || "").trim().toLowerCase();
      const number = String(employee.employee_number || "").trim().toLowerCase();
      const phone = String(employee.phone || "").trim().toLowerCase();

      return employee.active !== false && (code === pin || code === number || code === phone);
    });

    if (!match) {
      setError("No active employee found for that code/PIN.");
      return;
    }

    selectEmployee(match);
  }


  async function startCamera() {
    setCameraLoading(true);
    setError(null);

    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error("Camera is not available on this browser/device.");
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: "user",
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: false,
      });

      cameraStreamRef.current = stream;
      setCameraActive(true);

      setTimeout(() => {
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.play().catch(() => undefined);
        }
      }, 50);
    } catch (cameraError: any) {
      setError(cameraError?.message || "Could not start camera.");
    }

    setCameraLoading(false);
  }

  function stopCamera() {
    if (cameraStreamRef.current) {
      cameraStreamRef.current.getTracks().forEach((track) => track.stop());
      cameraStreamRef.current = null;
    }

    setCameraActive(false);

    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  }

  async function captureLivePhoto() {
    setError(null);

    if (!videoRef.current) {
      setError("Camera preview is not ready yet.");
      return;
    }

    const video = videoRef.current;
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth || 1280;
    canvas.height = video.videoHeight || 720;

    const context = canvas.getContext("2d");

    if (!context) {
      setError("Could not capture photo from camera.");
      return;
    }

    context.drawImage(video, 0, 0, canvas.width, canvas.height);

    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob((createdBlob) => resolve(createdBlob), "image/jpeg", 0.92);
    });

    if (!blob) {
      setError("Could not create captured photo.");
      return;
    }

    const nextFile = new File([blob], `clock-photo-${Date.now()}.jpg`, {
      type: "image/jpeg",
    });

    if (photoPreviewUrl) URL.revokeObjectURL(photoPreviewUrl);

    setPhotoFile(nextFile);
    setPhotoPreviewUrl(URL.createObjectURL(nextFile));
    stopCamera();
  }

  function clearPhoto() {
    if (photoPreviewUrl) URL.revokeObjectURL(photoPreviewUrl);
    setPhotoPreviewUrl(null);
    setPhotoFile(null);
  }


  async function getCurrentPosition(): Promise<GeolocationPosition> {
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) {
        reject(new Error("GPS is not available on this device."));
        return;
      }

      navigator.geolocation.getCurrentPosition(resolve, reject, {
        enableHighAccuracy: true,
        timeout: 15000,
        maximumAge: 0,
      });
    });
  }


  async function capturePhotoAutomatically() {
    setError(null);

    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error("Camera is not available on this browser/device.");
    }

    const stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: "user",
        width: { ideal: 1280 },
        height: { ideal: 720 },
      },
      audio: false,
    });

    try {
      const video = document.createElement("video");
      video.srcObject = stream;
      video.muted = true;
      video.playsInline = true;

      await video.play();

      await new Promise((resolve) => setTimeout(resolve, 650));

      const canvas = document.createElement("canvas");
      canvas.width = video.videoWidth || 1280;
      canvas.height = video.videoHeight || 720;

      const context = canvas.getContext("2d");

      if (!context) {
        throw new Error("Could not capture photo from camera.");
      }

      context.drawImage(video, 0, 0, canvas.width, canvas.height);

      const blob = await new Promise<Blob | null>((resolve) => {
        canvas.toBlob((createdBlob) => resolve(createdBlob), "image/jpeg", 0.92);
      });

      if (!blob) {
        throw new Error("Could not create captured photo.");
      }

      const nextFile = new File([blob], `clock-photo-${Date.now()}.jpg`, {
        type: "image/jpeg",
      });

      if (photoPreviewUrl) URL.revokeObjectURL(photoPreviewUrl);

      setPhotoFile(nextFile);
      setPhotoPreviewUrl(URL.createObjectURL(nextFile));

      return nextFile;
    } finally {
      stream.getTracks().forEach((track) => track.stop());
    }
  }

  async function uploadPhoto(employeeId: string, eventType: string, providedPhotoFile?: File | null) {
    const fileToUpload = providedPhotoFile || photoFile;

    if (!fileToUpload) return { photo_bucket: null, photo_path: null, photo_url: null };

    const extension = fileToUpload.name.includes(".") ? fileToUpload.name.split(".").pop() : "jpg";
    const filePath = `${employeeId}/${new Date().toISOString().slice(0, 10)}/${Date.now()}-${eventType}.${extension}`;

    const { error: uploadError } = await supabase.storage
      .from("clock-event-photos")
      .upload(filePath, fileToUpload, {
        contentType: fileToUpload.type || "image/jpeg",
        upsert: false,
      });

    if (uploadError) {
      throw new Error(uploadError.message);
    }

    return {
      photo_bucket: "clock-event-photos",
      photo_path: filePath,
      photo_url: filePath,
    };
  }

  async function openPhoto(event: ClockEventRow) {
    if (!event.photo_bucket || !event.photo_path) {
      setError("No photo saved for this clock event.");
      return;
    }

    const { data, error: signedError } = await supabase.storage
      .from(event.photo_bucket)
      .createSignedUrl(event.photo_path, 60 * 10);

    if (signedError || !data?.signedUrl) {
      setError(signedError?.message || "Could not open clock photo.");
      return;
    }

    window.open(data.signedUrl, "_blank");
  }

  async function saveClockEvent() {
    setSaving(true);
    setError(null);
    setMessage(null);
    setGpsMessage(null);

    if (!selectedEmployee) {
      setError("Select your name or type your staff code first.");
      setSaving(false);
      return;
    }

    if (!selectedEmployee.pin_code) {
      setError("This employee does not have a PIN set up yet. A manager must create one first.");
      setSaving(false);
      return;
    }

    if (!pinCode.trim()) {
      setError("Enter your PIN before clocking.");
      setSaving(false);
      return;
    }

    if (pinCode.trim() !== selectedEmployee.pin_code) {
      await supabase.from("attendance_pin_failures").insert({
        company_id: selectedEmployee.company_id || companyId || null,
        employee_id: selectedEmployee.id,
        failure_reason: "incorrect_pin",
        source: "kiosk",
      });
      setError("Incorrect PIN. Clocking was not saved.");
      setSaving(false);
      return;
    }

    if (!storeId) {
      setError("Select the store/location first.");
      setSaving(false);
      return;
    }

    try {
      const { startIso, endIso } = todayRange();

      let freshQuery = supabase
        .from("clock_events")
        .select("*")
        .eq("employee_id", selectedEmployee.id)
        .gte("event_time", startIso)
        .lt("event_time", endIso);

      const scopedCompanyId = selectedEmployee.company_id || companyId;
      if (scopedCompanyId) {
        freshQuery = freshQuery.eq("company_id", scopedCompanyId);
      }

      const { data: freshEvents, error: freshError } = await freshQuery.order("event_time", {
        ascending: false,
      });

      if (freshError) {
        throw new Error(freshError.message);
      }

      const freshTodayEvents = (freshEvents || []) as ClockEventRow[];
      const freshLastEvent = freshTodayEvents[0] || null;
      const freshCurrentlyClockedIn = freshLastEvent ? isClockIn(freshLastEvent.event_type) : false;
      const eventType = nextAction;

      if (eventType === "clock_in" && freshCurrentlyClockedIn) {
        throw new Error("You are already clocked in. Clock out before clocking in again.");
      }

      if (eventType === "clock_out" && !freshCurrentlyClockedIn) {
        throw new Error("You must clock in before you can clock out.");
      }

      const autoPhotoFile = photoFile || (await capturePhotoAutomatically());

      const position = await getCurrentPosition();
      const { latitude, longitude, accuracy } = position.coords;

      const photoEvidence = await uploadPhoto(selectedEmployee.id, eventType, autoPhotoFile);

      const payload: any = {
        company_id: selectedEmployee.company_id || companyId || null,
        employee_id: selectedEmployee.id,
        store_id: storeId,
        roster_shift_id: null,
        event_type: eventType,
        event_time: new Date().toISOString(),
        source: "kiosk",
        latitude,
        longitude,
        gps_accuracy: accuracy,
        photo_bucket: photoEvidence.photo_bucket,
        photo_path: photoEvidence.photo_path,
        photo_url: photoEvidence.photo_url,
        device_info: typeof window !== "undefined" ? window.navigator.userAgent : null,
        clock_note: eventType === "clock_in" ? "Staff clocked in with photo and GPS." : "Staff clocked out with photo and GPS.",
      };

      const { error: insertError } = await supabase.from("clock_events").insert(payload);

      if (insertError) {
        throw new Error(insertError.message);
      }

      setGpsMessage(`GPS saved: ${latitude.toFixed(5)}, ${longitude.toFixed(5)} · accuracy ${Math.round(accuracy)}m`);
      setMessage(`${employeeName(selectedEmployee)} ${eventType === "clock_in" ? "clocked in" : "clocked out"} successfully.`);
      clearPhoto();

      await loadTodayEvents(selectedEmployee.id);
    } catch (clockError: any) {
      setError(clockError?.message || "Clocking failed.");
    }

    setSaving(false);
  }

  return (
    <main className="min-h-screen overflow-hidden bg-[#04100d] text-[#06101f]">
      <section className="relative min-h-screen">
        <div className="pointer-events-none fixed inset-0 z-0">
          <div className="absolute left-[-160px] top-[-220px] h-[620px] w-[620px] rounded-full bg-cyan-400/20 blur-[140px]" />
          <div className="absolute right-[-180px] top-[120px] h-[760px] w-[760px] rounded-full bg-blue-500/20 blur-[160px]" />
          <div className="absolute inset-0 bg-[linear-gradient(135deg,rgba(8,47,73,0.98)_0%,rgba(14,116,144,0.9)_34%,rgba(238,246,255,0.94)_34%,rgba(238,246,255,0.94)_100%)]" />
        </div>

        <div className="relative z-10 mx-auto max-w-7xl px-6 py-7">
          <button
            onClick={() => router.back()}
            className="mb-6 inline-flex items-center gap-2 rounded-full bg-[#06101f] px-5 py-3 text-sm font-black text-cyan-300 shadow-lg"
          >
            <ArrowLeft className="h-4 w-4" />
            Back
          </button>

          <header className="rounded-[2.2rem] border border-white/70 bg-white/95 p-7 shadow-[0_22px_70px_rgba(15,23,42,0.16)] backdrop-blur-xl">
            <div className="inline-flex rounded-full bg-cyan-100 px-4 py-2 text-xs font-black uppercase tracking-[0.35em] text-cyan-700">
              VYRON CORE CLOCKING
            </div>
            <div className="mt-5 flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
              <div>
                <h1 className="text-5xl font-black tracking-tight">Staff Clocking</h1>
                <p className="mt-4 max-w-4xl text-base leading-8 text-slate-600">
                  Search your name or type your staff code. The system checks the database first and only allows the correct next action.
                </p>
              </div>

              <button
                onClick={() => selectedEmployeeId && loadTodayEvents(selectedEmployeeId)}
                className="flex w-fit items-center gap-2 rounded-full bg-[#06101f] px-5 py-3 text-sm font-black text-cyan-300"
              >
                <RefreshCcw className="h-4 w-4" />
                Refresh History
              </button>
            </div>
          </header>

          <section className="mt-6 grid gap-6 xl:grid-cols-[0.9fr_1.1fr]">
            <div className="rounded-[2.2rem] bg-[#06101f] p-7 text-white shadow-[0_22px_70px_rgba(6,16,31,0.35)]">
              <div className="inline-flex rounded-full bg-cyan-400/15 px-4 py-2 text-xs font-black uppercase tracking-[0.25em] text-cyan-300">
                EMPLOYEE IDENTIFICATION
              </div>

              <div className="mt-6 text-6xl font-black">{currentTimeLabel()}</div>
              <div className="mt-2 text-sm font-bold text-slate-300">{currentDateLabel()}</div>

              <div className="mt-6 grid gap-4">
                <label className="text-sm font-black text-slate-200">
                  Staff Code / Employee Number / PIN / Phone
                  <div className="mt-2 flex gap-2">
                    <input
                      value={staffCode}
                      onChange={(event) => setStaffCode(event.target.value)}
                      autoComplete="off"
                      name="vyron-core-staff-code"
                      onKeyDown={(event) => {
                        if (event.key === "Enter") findEmployeeByCode();
                      }}
                      placeholder="Type code..."
                      className="w-full rounded-2xl border border-cyan-400/20 bg-white/10 px-4 py-4 text-sm font-bold text-white outline-none placeholder:text-slate-400 focus:border-cyan-300"
                    />
                    <button
                      onClick={findEmployeeByCode}
                      className="rounded-2xl bg-cyan-400 px-5 py-4 text-sm font-black text-[#06101f]"
                    >
                      Find
                    </button>
                  </div>
                </label>

                <label className="text-sm font-black text-slate-200">
                  Or Search Employee
                  <div className="mt-2 flex items-center gap-3 rounded-2xl border border-cyan-400/20 bg-white/10 px-4 py-3">
                    <Search className="h-5 w-5 text-cyan-300" />
                    <input
                      value={employeeSearch}
                      onChange={(event) => setEmployeeSearch(event.target.value)}
                      autoComplete="off"
                      autoCorrect="off"
                      autoCapitalize="none"
                      spellCheck={false}
                      name="vyron-core-employee-search"
                      placeholder="Search employee by name, employee number or phone..."
                      className="w-full bg-transparent text-sm font-bold text-white outline-none placeholder:text-slate-400"
                    />
                  </div>
                </label>

                {employeeSearch.trim() && (
                  <button
                    type="button"
                    onClick={() => setEmployeeSearch("")}
                    className="rounded-2xl border border-cyan-400/20 bg-white/5 px-4 py-3 text-sm font-black text-cyan-300 transition hover:bg-white/10"
                  >
                    Clear search and show all employees
                  </button>
                )}

                <div className="rounded-[1.5rem] border border-cyan-400/15 bg-white/5 p-3">
                  <div className="mb-3 flex items-center justify-between gap-3 px-1">
                    <div className="text-xs font-black uppercase tracking-[0.22em] text-cyan-300">
                      Employee List
                    </div>
                    <div className="text-xs font-bold text-slate-400">
                      {visibleEmployees.length} shown
                    </div>
                  </div>

                  {hasSearchTerm && !searchHasMatches && activeEmployees.length > 0 && (
                    <div className="mb-2 rounded-2xl border border-amber-300/30 bg-amber-400/10 p-3 text-xs font-black text-amber-200">
                      No match for "{employeeSearch}". Showing all employees below.
                    </div>
                  )}

                  <div className="max-h-[360px] space-y-2 overflow-y-auto pr-1">
                    {loading ? (
                      <div className="rounded-2xl border border-cyan-400/15 bg-white/5 p-4 text-sm font-bold text-slate-300">
                        Loading employees...
                      </div>
                    ) : visibleEmployees.length === 0 ? (
                      <div className="rounded-2xl border border-cyan-400/15 bg-white/5 p-4 text-sm font-bold text-slate-300">
                        No active employees found in the database.
                      </div>
                    ) : (
                      visibleEmployees.map((employee) => (
                        <button
                          key={employee.id}
                          onClick={() => selectEmployee(employee)}
                          className={`w-full rounded-2xl px-4 py-3 text-left text-sm font-black transition ${
                            employee.id === selectedEmployeeId
                              ? "bg-cyan-400 text-[#06101f]"
                              : "border border-cyan-400/15 bg-white/5 text-slate-200 hover:bg-white/10"
                          }`}
                        >
                          <div>{employeeName(employee)}</div>
                          <div className="mt-1 text-xs opacity-70">
                            {employee.employee_number || "No number"} · {employee.job_title || "No job title"}
                          </div>
                        </button>
                      ))
                    )}
                  </div>
                </div>


              </div>
            </div>

            <div className="rounded-[2.2rem] border border-white/70 bg-white/95 p-7 shadow-[0_22px_70px_rgba(15,23,42,0.16)] backdrop-blur-xl">
              <div className="grid gap-4">
                <div className="rounded-[2rem] border border-white/80 bg-white p-5 shadow-[0_16px_45px_rgba(15,23,42,0.08)]">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <div className="text-xs font-black uppercase tracking-[0.25em] text-slate-400">Selected Employee</div>
                      <div className="mt-2 text-2xl font-black text-[#06101f]">
                        {selectedEmployee ? employeeName(selectedEmployee) : "No employee selected"}
                      </div>
                      <div className="mt-2 text-sm font-bold text-slate-500">
                        {selectedEmployee?.employee_number || "Select by search or code"}
                      </div>
                    </div>
                    <UserRound className="h-7 w-7 text-cyan-700" />
                  </div>
                </div>

                <label className="text-sm font-black text-slate-700">
                  Employee PIN
                  <input
                    value={pinCode}
                    onChange={(event) => setPinCode(event.target.value)}
                    type="password"
                    autoComplete="new-password"
                    name="vyron-core-clock-pin"
                    inputMode="numeric"
                    placeholder="Enter PIN before clocking"
                    className="mt-2 w-full rounded-2xl border border-white/80 bg-white px-4 py-4 font-bold shadow-sm outline-none focus:border-cyan-400"
                  />
                </label>

                <label className="text-sm font-black text-slate-700">
                  Store / Location
                  <select
                    value={storeId}
                    onChange={(event) => setStoreId(event.target.value)}
                    className="mt-2 w-full rounded-2xl border border-white/80 bg-white px-4 py-4 font-bold shadow-sm outline-none focus:border-cyan-400"
                  >
                    <option value="">Select store</option>
                    {stores.map((store) => (
                      <option key={store.id} value={store.id}>
                        {store.name}
                      </option>
                    ))}
                  </select>
                </label>

                <div className="rounded-[2rem] border border-white/80 bg-white p-5 shadow-[0_16px_45px_rgba(15,23,42,0.08)]">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <div className="text-xs font-black uppercase tracking-[0.25em] text-slate-400">
                        Live Photo Required
                      </div>
                      <div className="mt-2 text-lg font-black text-[#06101f]">
                        {photoFile ? "Photo captured" : "Photo will be taken automatically"}
                      </div>
                      <div className="mt-1 text-sm font-bold text-slate-500">
                        When you click Clock In or Clock Out, VYRON will automatically open the camera, take a photo, capture GPS and save the event.
                      </div>
                    </div>
                    <Camera className="h-7 w-7 text-cyan-700" />
                  </div>

                  <div className="mt-4 overflow-hidden rounded-[1.5rem] bg-slate-950">
                    {cameraActive ? (
                      <video
                        ref={videoRef}
                        autoPlay
                        playsInline
                        muted
                        className="h-72 w-full object-cover"
                      />
                    ) : photoPreviewUrl ? (
                      <img
                        src={photoPreviewUrl}
                        alt="Captured clocking photo"
                        className="h-72 w-full object-cover"
                      />
                    ) : (
                      <div className="flex h-72 flex-col items-center justify-center gap-3 text-center text-slate-300">
                        <Camera className="h-10 w-10 text-cyan-300" />
                        <div className="text-sm font-black">No live photo captured yet</div>
                      </div>
                    )}
                  </div>

                  <div className="mt-4 grid gap-2 md:grid-cols-3">
                    {!cameraActive && (
                      <button
                        type="button"
                        onClick={startCamera}
                        disabled={cameraLoading}
                        className="rounded-2xl bg-[#06101f] px-4 py-3 text-sm font-black text-cyan-300 disabled:bg-slate-300 disabled:text-slate-500"
                      >
                        {cameraLoading ? "Starting..." : "Preview Camera"}
                      </button>
                    )}

                    {cameraActive && (
                      <button
                        type="button"
                        onClick={captureLivePhoto}
                        className="rounded-2xl bg-cyan-400 px-4 py-3 text-sm font-black text-[#06101f]"
                      >
                        Capture Photo
                      </button>
                    )}

                    {cameraActive && (
                      <button
                        type="button"
                        onClick={stopCamera}
                        className="rounded-2xl bg-slate-100 px-4 py-3 text-sm font-black text-slate-700"
                      >
                        Stop Camera
                      </button>
                    )}

                    {photoFile && (
                      <button
                        type="button"
                        onClick={clearPhoto}
                        className="rounded-2xl bg-rose-50 px-4 py-3 text-sm font-black text-rose-700"
                      >
                        Retake / Clear
                      </button>
                    )}


                  </div>
                </div>

                <div className={`rounded-[2rem] p-5 ${
                  currentlyClockedIn
                    ? "border border-amber-200 bg-amber-50 text-amber-900"
                    : "border border-emerald-200 bg-emerald-50 text-emerald-900"
                }`}>
                  <div className="text-xs font-black uppercase tracking-[0.25em] opacity-70">
                    Current Status
                  </div>
                  <div className="mt-2 text-3xl font-black">
                    {selectedEmployee ? (currentlyClockedIn ? "Clocked In" : "Clocked Out") : "Waiting for Employee"}
                  </div>
                  <div className="mt-2 text-sm font-bold opacity-80">
                    {selectedEmployee
                      ? currentlyClockedIn
                        ? "Only Clock Out is available now."
                        : "Only Clock In is available now."
                      : "Select employee to continue."}
                  </div>
                </div>

                {error && (
                  <div className="rounded-2xl bg-rose-50 p-4 text-sm font-black text-rose-700">
                    <AlertTriangle className="mr-2 inline h-4 w-4" />
                    {error}
                  </div>
                )}

                {gpsMessage && (
                  <div className="rounded-2xl bg-cyan-50 p-4 text-sm font-black text-cyan-700">
                    <MapPin className="mr-2 inline h-4 w-4" />
                    {gpsMessage}
                  </div>
                )}

                {message && (
                  <div className="rounded-2xl bg-emerald-50 p-4 text-sm font-black text-emerald-700">
                    <CheckCircle2 className="mr-2 inline h-4 w-4" />
                    {message}
                  </div>
                )}

                <button
                  onClick={saveClockEvent}
                  disabled={saving || !selectedEmployee || !pinCode.trim()}
                  className={`flex items-center justify-center gap-2 rounded-2xl px-5 py-5 text-sm font-black shadow-lg disabled:bg-slate-300 disabled:text-slate-500 ${
                    nextAction === "clock_in"
                      ? "bg-emerald-600 text-white"
                      : "bg-amber-500 text-[#06101f]"
                  }`}
                >
                  <ShieldCheck className="h-5 w-5" />
                  {saving ? "Taking photo + saving..." : nextAction === "clock_in" ? "Clock In" : "Clock Out"}
                </button>
              </div>
            </div>
          </section>

          <section className="mt-6 rounded-[2.2rem] border border-white/70 bg-white/95 p-7 shadow-[0_22px_70px_rgba(15,23,42,0.16)] backdrop-blur-xl">
            <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
              <div>
                <div className="text-xs font-black uppercase tracking-[0.35em] text-cyan-700">Today’s Clocking History</div>
                <h2 className="mt-2 text-3xl font-black text-[#06101f]">
                  {selectedEmployee ? employeeName(selectedEmployee) : "Select an employee"}
                </h2>
              </div>

              <div className="text-sm font-bold text-slate-500">
                In: {firstClockInToday ? formatTime(firstClockInToday.event_time) : "--:--"} · Out: {lastClockOutToday ? formatTime(lastClockOutToday.event_time) : "--:--"}
              </div>
            </div>

            <div className="mt-6 space-y-3">
              {!selectedEmployee ? (
                <div className="rounded-2xl bg-slate-50 p-5 text-sm font-bold text-slate-500">
                  Search or enter a staff code to view today’s clocking history.
                </div>
              ) : historyLoading ? (
                <div className="rounded-2xl bg-slate-50 p-5 text-sm font-bold text-slate-500">
                  Loading today’s clocking history...
                </div>
              ) : todayEvents.length === 0 ? (
                <div className="rounded-2xl bg-slate-50 p-5 text-sm font-bold text-slate-500">
                  No clocking events for today yet.
                </div>
              ) : (
                todayEvents.map((event) => (
                  <div key={event.id} className="rounded-[2rem] border border-white/80 bg-white p-5 shadow-[0_16px_45px_rgba(15,23,42,0.08)]">
                    <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                      <div>
                        <div className="text-xl font-black text-[#06101f]">
                          {isClockIn(event.event_type) ? "Clock In" : "Clock Out"} · {formatDateTime(event.event_time)}
                        </div>
                        <div className="mt-1 text-sm font-bold text-slate-500">
                          {stores.find((store) => store.id === event.store_id)?.name || selectedStore?.name || "No store"} · Source: {event.source || "kiosk"}
                        </div>
                      </div>

                      <div className="flex flex-wrap gap-2">
                        {event.latitude && event.longitude && (
                          <a
                            href={`https://www.google.com/maps?q=${event.latitude},${event.longitude}`}
                            target="_blank"
                            rel="noreferrer"
                            className="rounded-full bg-cyan-50 px-4 py-2 text-xs font-black text-cyan-700"
                          >
                            GPS
                          </a>
                        )}

                        {event.photo_path && (
                          <button
                            onClick={() => openPhoto(event)}
                            className="rounded-full bg-slate-950 px-4 py-2 text-xs font-black text-cyan-300"
                          >
                            Photo
                          </button>
                        )}
                      </div>
                    </div>

                    <div className="mt-3 grid gap-3 md:grid-cols-3">
                      <div className="rounded-2xl bg-slate-50 p-4">
                        <div className="text-xs font-black uppercase tracking-[0.18em] text-slate-400">Latitude</div>
                        <div className="mt-2 text-sm font-bold">{event.latitude ?? "Not saved"}</div>
                      </div>
                      <div className="rounded-2xl bg-slate-50 p-4">
                        <div className="text-xs font-black uppercase tracking-[0.18em] text-slate-400">Longitude</div>
                        <div className="mt-2 text-sm font-bold">{event.longitude ?? "Not saved"}</div>
                      </div>
                      <div className="rounded-2xl bg-slate-50 p-4">
                        <div className="text-xs font-black uppercase tracking-[0.18em] text-slate-400">Photo</div>
                        <div className="mt-2 text-sm font-bold">{event.photo_path ? "Saved" : "Not saved"}</div>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </section>

          <ClockingAttendanceEnterprisePanel companyId={companyId} />
        </div>
      </section>
    </main>
  );
}

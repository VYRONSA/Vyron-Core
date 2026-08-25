/**
 * The native bridge, expressed as capabilities rather than platforms.
 *
 * WHY THIS FILE EXISTS
 *
 *   The employee app has to run in three places: a desktop browser, an Android
 *   WebView and — once a Mac exists — an iOS WebView. If the screens ask
 *   "am I on Android?" then every screen has to be revisited to add iOS, and
 *   the browser build slowly rots because nobody runs it.
 *
 *   So nothing above this file ever asks what platform it is on. It asks for a
 *   photograph, or a position, or permission to send notifications, and this
 *   module answers using whatever the host can actually do. The web
 *   implementations are not stubs — they are the real behaviour the existing
 *   Road & Recovery driver screen already relies on, which is why the same code
 *   keeps working in a browser after this is added.
 *
 * WHAT DELIBERATELY IS NOT HERE
 *
 *   No business rules. This module does not know what an incident is, when an
 *   arrival counts, or whether an operation may be deferred. It moves bytes and
 *   coordinates across the platform boundary and stops. Every rule about what
 *   those values MEAN lives in lib/road-recovery and lib/mobile/incidents.
 */

export type RrPlatform = "web" | "android" | "ios";

export type CapturedPhoto = {
  /** The image itself, ready for the existing evidence queue. */
  blob: Blob;
  /** image/jpeg unless the platform insists otherwise. */
  contentType: string;
  /** Where it came from, for the evidence metadata. */
  source: "camera" | "library";
};

export type Position = {
  latitude: number;
  longitude: number;
  /** Metres. Null when the platform will not say — never 0 as a stand-in. */
  accuracy: number | null;
  capturedAt: number;
};

export type PushRegistration = {
  token: string;
  platform: RrPlatform;
  provider: "fcm" | "apns" | "webpush";
};

/** Set when running inside a Capacitor shell, absent in a plain browser. */
type CapacitorGlobal = {
  Capacitor?: {
    isNativePlatform?: () => boolean;
    getPlatform?: () => string;
  };
};

function capacitor(): CapacitorGlobal["Capacitor"] | undefined {
  if (typeof window === "undefined") return undefined;
  return (window as unknown as CapacitorGlobal).Capacitor;
}

/** True only inside the installed app. A browser tab is never "native". */
export function isNativeApp(): boolean {
  return capacitor()?.isNativePlatform?.() === true;
}

export function platform(): RrPlatform {
  const name = capacitor()?.getPlatform?.();
  return name === "android" || name === "ios" ? name : "web";
}

/**
 * Loads a Capacitor plugin only when running natively.
 *
 * The dynamic import matters: a browser build must never pull native plugin
 * code into its bundle, and a server render must never touch it at all.
 */
async function nativePlugin<T>(load: () => Promise<T>): Promise<T | null> {
  if (!isNativeApp()) return null;
  try {
    return await load();
  } catch {
    // A plugin missing from a particular build is a capability we do not have,
    // not a crash. The caller falls back to the web path.
    return null;
  }
}

/* ── Camera ───────────────────────────────────────────────────────────────── */

/**
 * Takes a photograph.
 *
 * Native gets the real camera. The browser falls back to the file input the
 * driver screen already uses, which is why `webFallbackFile` exists: the web
 * caller has already collected a File and simply hands it through, so there is
 * one code path above this line instead of two.
 */
export async function capturePhoto(webFallbackFile?: File | null): Promise<CapturedPhoto | null> {
  const camera = await nativePlugin(() => import("@capacitor/camera"));

  if (camera) {
    const { Camera, CameraResultType, CameraSource } = camera;
    const photo = await Camera.getPhoto({
      quality: 70,
      allowEditing: false,
      resultType: CameraResultType.Uri,
      source: CameraSource.Camera,
      // A scene photograph is evidence; saving it to the employee's gallery
      // would put company evidence on a personal device roll.
      saveToGallery: false,
    });
    if (!photo.webPath) return null;
    const response = await fetch(photo.webPath);
    const blob = await response.blob();
    return { blob, contentType: blob.type || "image/jpeg", source: "camera" };
  }

  if (!webFallbackFile) return null;
  return {
    blob: webFallbackFile,
    contentType: webFallbackFile.type || "image/jpeg",
    source: "library",
  };
}

/* ── Position ─────────────────────────────────────────────────────────────── */

/**
 * The device's position, or null.
 *
 * Null is a real answer and callers must handle it: the Road & Recovery arrival
 * path refuses to fabricate coordinates and asks the driver for a reason
 * instead. Nothing here ever invents a position or reports accuracy 0.
 */
export async function currentPosition(timeoutMs = 10_000): Promise<Position | null> {
  const geo = await nativePlugin(() => import("@capacitor/geolocation"));

  if (geo) {
    try {
      const position = await geo.Geolocation.getCurrentPosition({
        enableHighAccuracy: true,
        timeout: timeoutMs,
        maximumAge: 0,
      });
      return {
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        accuracy: Number.isFinite(position.coords.accuracy) ? position.coords.accuracy : null,
        capturedAt: position.timestamp || Date.now(),
      };
    } catch {
      return null;
    }
  }

  if (typeof navigator === "undefined" || !navigator.geolocation) return null;
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (position) =>
        resolve({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracy: Number.isFinite(position.coords.accuracy) ? position.coords.accuracy : null,
          capturedAt: position.timestamp || Date.now(),
        }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 0 }
    );
  });
}

/* ── Push ─────────────────────────────────────────────────────────────────── */

/**
 * Asks for notification permission and returns the device token.
 *
 * The token is handed straight to the server and never stored in the WebView:
 * it is a capability to reach this handset, and the only place it belongs is
 * mobile_device_registrations, behind service_role.
 */
export async function registerForPush(): Promise<PushRegistration | null> {
  const push = await nativePlugin(() => import("@capacitor/push-notifications"));
  if (!push) return null;

  const { PushNotifications } = push;
  const permission = await PushNotifications.requestPermissions();
  if (permission.receive !== "granted") return null;

  return new Promise((resolve) => {
    // Resolve once, whichever way the platform answers first.
    let settled = false;
    const finish = (value: PushRegistration | null) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };

    PushNotifications.addListener("registration", (token: { value: string }) => {
      const current = platform();
      finish({
        token: token.value,
        platform: current,
        provider: current === "ios" ? "apns" : "fcm",
      });
    });
    PushNotifications.addListener("registrationError", () => finish(null));
    void PushNotifications.register();

    // A platform that never answers must not hang the sign-in.
    setTimeout(() => finish(null), 15_000);
  });
}

/** Called when a push is tapped. The payload's `link` decides where to go. */
export async function onPushOpened(handler: (link: string) => void): Promise<() => void> {
  const push = await nativePlugin(() => import("@capacitor/push-notifications"));
  if (!push) return () => {};
  const listener = await push.PushNotifications.addListener(
    "pushNotificationActionPerformed",
    (action: { notification: { data?: Record<string, unknown> } }) => {
      const link = action.notification?.data?.link;
      if (typeof link === "string" && link.length > 0) handler(link);
    }
  );
  return () => void listener.remove();
}

/* ── Deep links ───────────────────────────────────────────────────────────── */

/** Fires when the OS hands the app a vyroncore:// or https:// link. */
export async function onDeepLink(handler: (url: string) => void): Promise<() => void> {
  const app = await nativePlugin(() => import("@capacitor/app"));
  if (!app) return () => {};
  const listener = await app.App.addListener("appUrlOpen", (event: { url: string }) => {
    if (event.url) handler(event.url);
  });
  return () => void listener.remove();
}

/* ── Network ──────────────────────────────────────────────────────────────── */

/**
 * Connectivity, from the platform that actually knows.
 *
 * navigator.onLine in a WebView is famously optimistic; the native Network
 * plugin reports what the radio is doing. Callers get one boolean either way.
 */
export async function onConnectivityChange(
  handler: (online: boolean) => void
): Promise<() => void> {
  const net = await nativePlugin(() => import("@capacitor/network"));

  if (net) {
    const listener = await net.Network.addListener(
      "networkStatusChange",
      (status: { connected: boolean }) => handler(status.connected)
    );
    const initial = await net.Network.getStatus();
    handler(initial.connected);
    return () => void listener.remove();
  }

  if (typeof window === "undefined") return () => {};
  const notify = () => handler(navigator.onLine);
  window.addEventListener("online", notify);
  window.addEventListener("offline", notify);
  notify();
  return () => {
    window.removeEventListener("online", notify);
    window.removeEventListener("offline", notify);
  };
}

/* ── App lifecycle ────────────────────────────────────────────────────────── */

/** Fires when the app returns to the foreground — a good moment to drain queues. */
export async function onResume(handler: () => void): Promise<() => void> {
  const app = await nativePlugin(() => import("@capacitor/app"));

  if (app) {
    const listener = await app.App.addListener(
      "appStateChange",
      (state: { isActive: boolean }) => {
        if (state.isActive) handler();
      }
    );
    return () => void listener.remove();
  }

  if (typeof document === "undefined") return () => {};
  const notify = () => {
    if (!document.hidden) handler();
  };
  document.addEventListener("visibilitychange", notify);
  return () => document.removeEventListener("visibilitychange", notify);
}

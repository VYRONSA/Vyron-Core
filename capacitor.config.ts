import type { CapacitorConfig } from "@capacitor/cli";

/**
 * VYRON CORE Employee App — native shell configuration.
 *
 * WHY THE WEBVIEW POINTS AT A SERVER RATHER THAN A BUNDLE
 *
 *   This application has 162 server routes and authenticates with an httpOnly
 *   server cookie. It cannot be statically exported, so the shell is served
 *   rather than bundled. `server.url` is set at build time from
 *   VYRON_APP_URL — never hard-coded — so the same source produces a QA build
 *   and a production build without editing this file.
 *
 * WHAT STILL WORKS WITHOUT A CONNECTION
 *
 *   Everything that matters operationally. The outbox, the evidence queue and
 *   incident drafts live in IndexedDB inside the WebView and survive app
 *   termination; native camera and GPS do not touch the network at all. What a
 *   cold start cannot currently do is repaint the shell itself — see
 *   lib/mobile/offline-shell.ts for the design that addresses it and the
 *   tenant-safety constraints it must respect.
 */

const appUrl = process.env.VYRON_APP_URL || "https://vyron-core-rr-pilot.vercel.app";

const config: CapacitorConfig = {
  appId: "za.co.vyronsoft.core",
  appName: "VYRON CORE",
  // Present because the CLI requires it. The shell is served from `server.url`,
  // so this directory only ever holds the offline bootstrap document.
  webDir: "mobile/public",

  server: {
    url: appUrl,
    /**
     * What the app shows when it starts with no connection.
     *
     * Capacitor loads `url` on every launch, so without this a cold start with
     * no signal lands on the WebView's own network-error page — a driver opens
     * VYRON CORE and sees a browser dinosaur. `errorPath` points at a document
     * bundled INSIDE the app, so the shell is always available from the device
     * itself.
     *
     * It deliberately contains no tenant data. A shared yard tablet must never
     * render the previous employee's work from a local cache, which is the same
     * rule public/rr-sw.js follows by caching nothing.
     */
    errorPath: "offline.html",
    // HTTPS only. A cleartext WebView would let anything on the same Wi-Fi read
    // a driver's session cookie.
    cleartext: false,
    androidScheme: "https",
    // The app is allowed to navigate to its own origin and to Supabase (auth
    // and storage). Anything else opens in the system browser instead of
    // inside a WebView that carries the session.
    allowNavigation: [
      new URL(appUrl).host,
      "*.supabase.co",
    ],
  },

  android: {
    // Mixed content off: no plaintext subresource may ride inside an https page.
    allowMixedContent: false,
    captureInput: true,
    webContentsDebuggingEnabled: false,
  },

  ios: {
    // Prepared, not built. See PHASE 15A: iOS compilation requires macOS.
    contentInset: "always",
    limitsNavigationsToAppBoundDomains: true,
  },

  plugins: {
    SplashScreen: {
      launchShowDuration: 1200,
      backgroundColor: "#07101f",
      androidScaleType: "CENTER_CROP",
      showSpinner: false,
      splashFullScreen: true,
      splashImmersive: false,
    },
    PushNotifications: {
      // The app asks at the moment a notification would first matter, not on
      // first launch when the employee has no context for the request.
      presentationOptions: ["badge", "sound", "alert"],
    },
    Geolocation: {
      // Arrival is evidence. A cached fix from twenty minutes ago is not.
      permissions: ["location"],
    },
  },
};

export default config;

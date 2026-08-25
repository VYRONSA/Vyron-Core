import type { Viewport } from "next";

/**
 * Viewport rules for the native Employee App surface only.
 *
 * Android 15 (targetSdk 35) draws every app edge-to-edge and no longer reserves
 * space for the status and navigation bars — the app is expected to inset
 * itself. Without `viewportFit: "cover"` the WebView never reports those insets
 * at all, so `env(safe-area-inset-*)` resolves to zero and the app header ends
 * up underneath the clock and the battery icon. Declaring cover here is what
 * makes the real inset values available to the CSS that consumes them.
 *
 * This is scoped to /app rather than the root layout on purpose: the desktop
 * console and the marketing site are laid out for browser chrome that already
 * accounts for its own insets, and opting them into edge-to-edge would push
 * their content under a notch for no benefit.
 */
export const viewport: Viewport = {
  themeColor: "#07101f",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover",
};

export default function EmployeeAppLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return children;
}

import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "VYRON CORE",
  description:
    "AI-powered workforce management, HR, clocking, rostering, payroll readiness and workforce intelligence platform.",
  applicationName: "VYRON CORE",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [
      { url: "/vyron-core-favicon.ico", type: "image/x-icon" },
      { url: "/vyron-core-icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/vyron-core-icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    shortcut: "/vyron-core-favicon.ico",
    apple: [
      {
        url: "/vyron-core-apple-touch-icon.png",
        sizes: "180x180",
        type: "image/png",
      },
    ],
  },
  appleWebApp: {
    capable: true,
    title: "VYRON CORE",
    statusBarStyle: "black-translucent",
  },
};

export const viewport: Viewport = {
  themeColor: "#020617",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
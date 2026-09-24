import type { Metadata, Viewport } from "next";
import "./globals.css";
import { productBrand } from "@/lib/brand";

// Base for resolving relative metadata URLs (Open Graph image, canonical).
// The public site is UMORA; internal application identifiers are unaffected.
const siteUrl = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "") || "https://umora.co.za";

export const metadata: Metadata = {
  title: productBrand.appTitle,
  description: productBrand.appDescription,
  metadataBase: new URL(siteUrl),
  applicationName: productBrand.name,
  alternates: {
    canonical: "/",
  },
  openGraph: {
    title: productBrand.appTitle,
    description: productBrand.appDescription,
    type: "website",
    url: "/",
    siteName: productBrand.name,
  },
  twitter: {
    card: "summary_large_image",
    title: productBrand.appTitle,
    description: productBrand.appDescription,
  },
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [
      { url: "/umora-mark.svg", type: "image/svg+xml" },
      { url: "/umora-icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/umora-icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    shortcut: "/favicon.ico",
    apple: [
      {
        url: "/umora-apple-touch-icon.png",
        sizes: "180x180",
        type: "image/png",
      },
    ],
  },
  appleWebApp: {
    capable: true,
    title: productBrand.name,
    statusBarStyle: "black-translucent",
  },
};

export const viewport: Viewport = {
  themeColor: "#04201b",
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
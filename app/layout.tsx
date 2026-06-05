import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "VYRON CORE - Workforce Operations",
  description:
    "Enterprise workforce control: clocking, roster, HR risk, payroll readiness, and intelligence in one system.",
  icons: {
    icon: "/vyron-core-favicon.ico",
    shortcut: "/vyron-core-favicon.ico",
    apple: "/vyron-core-apple-touch-icon.png",
  },
  appleWebApp: {
    capable: true,
    title: "VYRON CORE",
    statusBarStyle: "black-translucent",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="vyron-shell min-h-full flex flex-col font-sans antialiased">
        {children}
      </body>
    </html>
  );
}